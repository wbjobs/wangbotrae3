const db = require('../config/database');
const syncCalculator = require('../utils/syncCalculator');
const offsetMatrixCalculator = require('../utils/offsetMatrix');
const { pool } = require('../utils/workerPool');

class SyncController {
  async calculateSync(req, res) {
    try {
      const { roomId, recordedAudioId } = req.body;

      if (!roomId || !recordedAudioId) {
        return res.status(400).json({ error: '房间ID和录制音轨ID不能为空' });
      }

      const refTracksResult = await db.query(
        `SELECT id, fingerprint, source_label, filename 
         FROM audio_tracks 
         WHERE room_id = $1 AND track_type = 'reference'`,
        [roomId]
      );

      if (refTracksResult.rows.length === 0) {
        return res.status(400).json({ error: '房间没有参考音轨' });
      }

      const recAudioResult = await db.query(
        `SELECT id, fingerprint, source_label, filename 
         FROM audio_tracks WHERE id = $1`,
        [recordedAudioId]
      );

      if (recAudioResult.rows.length === 0) {
        return res.status(404).json({ error: '录制音轨不存在' });
      }

      const recordedTrack = {
        id: recAudioResult.rows[0].id,
        fingerprint: recAudioResult.rows[0].fingerprint,
        sourceLabel: recAudioResult.rows[0].source_label,
        filename: recAudioResult.rows[0].filename
      };

      const referenceTracks = refTracksResult.rows.map(row => ({
        id: row.id,
        fingerprint: row.fingerprint,
        sourceLabel: row.source_label,
        filename: row.filename
      }));

      for (const ref of referenceTracks) {
        if (!ref.fingerprint) {
          return res.status(400).json({ error: `参考音轨 ${ref.filename} 指纹数据不完整` });
        }
      }

      if (!recordedTrack.fingerprint) {
        return res.status(400).json({ error: '录制音轨指纹数据不完整' });
      }

      if (referenceTracks.length === 1) {
        const syncResult = syncCalculator.calculateOffset(
          referenceTracks[0].fingerprint,
          recordedTrack.fingerprint
        );

        const sessionResult = await db.query(
          `INSERT INTO sync_sessions 
           (room_id, reference_audio_id, recorded_audio_id, time_offset, confidence, status, completed_at)
           VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
           RETURNING id`,
          [roomId, referenceTracks[0].id, recordedAudioId, syncResult.offset, syncResult.confidence]
        );

        res.json({
          sessionId: sessionResult.rows[0].id,
          timeOffset: syncResult.offset,
          frameOffset: syncResult.frameOffset,
          confidence: syncResult.confidence,
          similarity: syncResult.similarity,
          mode: 'single'
        });
      } else {
        const matrixResult = await offsetMatrixCalculator.computeMatrix(
          referenceTracks,
          recordedTrack
        );

        const formatted = offsetMatrixCalculator.formatMatrixForResponse(matrixResult);

        for (const track of formatted.tracks) {
          await db.query(
            `INSERT INTO sync_sessions 
             (room_id, reference_audio_id, recorded_audio_id, time_offset, confidence, status, completed_at)
             VALUES ($1, $2, $3, $4, $5, 'completed', NOW())`,
            [roomId, track.id, recordedAudioId, track.timeOffset, track.confidence]
          );
        }

        const matrixDbResult = await db.query(
          `INSERT INTO offset_matrices 
           (room_id, recorded_audio_id, matrix, track_ids, track_labels, status, completed_at)
           VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
           RETURNING id`,
          [
            roomId,
            recordedAudioId,
            JSON.stringify(formatted.tracks),
            JSON.stringify(formatted.tracks.map(t => t.id)),
            JSON.stringify(formatted.tracks.map(t => t.label)),
          ]
        );

        res.json({
          matrixId: matrixDbResult.rows[0].id,
          mode: 'multi',
          ...formatted
        });
      }
    } catch (error) {
      console.error('同步计算失败:', error);
      res.status(500).json({ error: '同步计算失败: ' + error.message });
    }
  }

  async getOffsetMatrix(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        `SELECT id, room_id as "roomId", recorded_audio_id as "recordedAudioId",
                matrix, track_ids as "trackIds", track_labels as "trackLabels",
                status, created_at as "createdAt", completed_at as "completedAt"
         FROM offset_matrices WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '偏移量矩阵不存在' });
      }

      const row = result.rows[0];
      const matrix = typeof row.matrix === 'string' ? JSON.parse(row.matrix) : row.matrix;
      const trackIds = typeof row.trackIds === 'string' ? JSON.parse(row.trackIds) : row.trackIds;
      const trackLabels = typeof row.trackLabels === 'string' ? JSON.parse(row.trackLabels) : row.trackLabels;

      res.json({
        id: row.id,
        roomId: row.roomId,
        recordedAudioId: row.recordedAudioId,
        tracks: trackIds.map((id, i) => ({
          id,
          label: trackLabels[i],
          ...matrix[i]
        })),
        status: row.status,
        createdAt: row.createdAt,
        completedAt: row.completedAt
      });
    } catch (error) {
      console.error('获取偏移量矩阵失败:', error);
      res.status(500).json({ error: '获取偏移量矩阵失败' });
    }
  }

  async listRoomMatrices(req, res) {
    try {
      const { roomId } = req.params;

      const result = await db.query(
        `SELECT m.id, m.room_id as "roomId", m.recorded_audio_id as "recordedAudioId",
                m.track_labels as "trackLabels", m.status, 
                m.created_at as "createdAt", m.completed_at as "completedAt",
                a.filename as "recordedFilename"
         FROM offset_matrices m
         LEFT JOIN audio_tracks a ON m.recorded_audio_id = a.id
         WHERE m.room_id = $1
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [roomId]
      );

      res.json(result.rows.map(row => ({
        ...row,
        trackLabels: typeof row.trackLabels === 'string' ? JSON.parse(row.trackLabels) : row.trackLabels
      })));
    } catch (error) {
      console.error('获取房间偏移矩阵列表失败:', error);
      res.status(500).json({ error: '获取房间偏移矩阵列表失败' });
    }
  }

  async getSyncSession(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        `SELECT id, room_id as "roomId", reference_audio_id as "referenceAudioId",
                recorded_audio_id as "recordedAudioId", time_offset as "timeOffset",
                confidence, status, created_at as "createdAt", completed_at as "completedAt"
         FROM sync_sessions WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '同步会话不存在' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('获取同步会话失败:', error);
      res.status(500).json({ error: '获取同步会话失败' });
    }
  }

  async listRoomSyncSessions(req, res) {
    try {
      const { roomId } = req.params;

      const result = await db.query(
        `SELECT s.id, s.room_id as "roomId", s.time_offset as "timeOffset",
                s.confidence, s.status, s.created_at as "createdAt",
                s.completed_at as "completedAt",
                a1.filename as "referenceFilename",
                a2.filename as "recordedFilename"
         FROM sync_sessions s
         LEFT JOIN audio_tracks a1 ON s.reference_audio_id = a1.id
         LEFT JOIN audio_tracks a2 ON s.recorded_audio_id = a2.id
         WHERE s.room_id = $1
         ORDER BY s.created_at DESC
         LIMIT 50`,
        [roomId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('获取房间同步会话列表失败:', error);
      res.status(500).json({ error: '获取房间同步会话列表失败' });
    }
  }

  async getWorkerPoolStatus(req, res) {
    try {
      res.json(pool.getStatus());
    } catch (error) {
      res.status(500).json({ error: '获取Worker池状态失败' });
    }
  }

  async quickSync(req, res) {
    try {
      const { referenceFingerprint, recordedFingerprint } = req.body;

      if (!referenceFingerprint || !recordedFingerprint) {
        return res.status(400).json({ error: '参考指纹和录制指纹不能为空' });
      }

      const syncResult = syncCalculator.calculateOffset(
        referenceFingerprint,
        recordedFingerprint
      );

      res.json({
        timeOffset: syncResult.offset,
        frameOffset: syncResult.frameOffset,
        confidence: syncResult.confidence,
        similarity: syncResult.similarity
      });
    } catch (error) {
      console.error('快速同步计算失败:', error);
      res.status(500).json({ error: '快速同步计算失败: ' + error.message });
    }
  }
}

module.exports = new SyncController();
