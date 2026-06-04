const db = require('../config/database');
const audioFingerprint = require('../utils/audioFingerprint');
const path = require('path');
const fs = require('fs');

class AudioController {
  async uploadAudio(req, res) {
    try {
      const { roomId, trackType, sourceLabel } = req.body;
      const file = req.file;

      if (!roomId || !trackType) {
        return res.status(400).json({ error: '房间ID和音轨类型不能为空' });
      }

      if (!file) {
        return res.status(400).json({ error: '没有上传文件' });
      }

      const roomResult = await db.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
      if (roomResult.rows.length === 0) {
        fs.unlinkSync(file.path);
        return res.status(404).json({ error: '房间不存在' });
      }

      if (trackType === 'reference') {
        const refCount = await db.query(
          'SELECT COUNT(*) as count FROM audio_tracks WHERE room_id = $1 AND track_type = $2',
          [roomId, 'reference']
        );
        if (parseInt(refCount.rows[0].count) >= 5) {
          fs.unlinkSync(file.path);
          return res.status(400).json({ error: '参考音轨数量已达上限(5个)' });
        }
      }

      const fingerprint = await audioFingerprint.extractFingerprint(file.path);
      const waveform = this.extractWaveform(fingerprint);

      const audioResult = await db.query(
        `INSERT INTO audio_tracks 
         (room_id, filename, file_path, duration, fingerprint, track_type, sample_rate, source_label, waveform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, room_id as "roomId", filename, duration, track_type as "trackType", 
                   source_label as "sourceLabel", created_at as "createdAt"`,
        [
          roomId,
          file.originalname,
          file.path,
          fingerprint.duration,
          JSON.stringify(fingerprint),
          trackType,
          fingerprint.sampleRate,
          sourceLabel || null,
          JSON.stringify(waveform)
        ]
      );

      res.json({
        ...audioResult.rows[0],
        fingerprint: {
          numFrames: fingerprint.numFrames,
          duration: fingerprint.duration
        }
      });
    } catch (error) {
      console.error('上传音频失败:', error);
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: '上传音频失败: ' + error.message });
    }
  }

  extractWaveform(fingerprint) {
    const features = fingerprint.frameFeatures || [];
    const points = [];
    const step = Math.max(1, Math.floor(features.length / 200));
    
    for (let i = 0; i < features.length; i += step) {
      const frame = features[i];
      const rms = Math.sqrt(frame.reduce((sum, v) => sum + v * v, 0) / frame.length);
      points.push({
        time: i * (fingerprint.frameDuration || 0.032),
        value: rms
      });
    }
    
    return { points, sampleRate: fingerprint.sampleRate, duration: fingerprint.duration };
  }

  async getAudioTrack(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        `SELECT id, room_id as "roomId", filename, duration, 
                track_type as "trackType", source_label as "sourceLabel", created_at as "createdAt"
         FROM audio_tracks WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '音轨不存在' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('获取音轨信息失败:', error);
      res.status(500).json({ error: '获取音轨信息失败' });
    }
  }

  async getAudioWaveform(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        'SELECT waveform FROM audio_tracks WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '音轨不存在' });
      }

      res.json(result.rows[0].waveform || { points: [], sampleRate: 16000, duration: 0 });
    } catch (error) {
      console.error('获取波形数据失败:', error);
      res.status(500).json({ error: '获取波形数据失败' });
    }
  }

  async listRoomAudioTracks(req, res) {
    try {
      const { roomId } = req.params;

      const result = await db.query(
        `SELECT id, room_id as "roomId", filename, duration, 
                track_type as "trackType", source_label as "sourceLabel", created_at as "createdAt"
         FROM audio_tracks 
         WHERE room_id = $1
         ORDER BY created_at DESC`,
        [roomId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('获取房间音轨列表失败:', error);
      res.status(500).json({ error: '获取房间音轨列表失败' });
    }
  }

  async downloadAudio(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        'SELECT file_path, filename FROM audio_tracks WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '音轨不存在' });
      }

      const { file_path: filePath, filename } = result.rows[0];

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '文件不存在' });
      }

      res.download(filePath, filename);
    } catch (error) {
      console.error('下载音频失败:', error);
      res.status(500).json({ error: '下载音频失败' });
    }
  }

  async deleteAudioTrack(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        'SELECT file_path FROM audio_tracks WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '音轨不存在' });
      }

      const { file_path: filePath } = result.rows[0];

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      await db.query('DELETE FROM audio_tracks WHERE id = $1', [id]);

      res.json({ message: '音轨已删除', id });
    } catch (error) {
      console.error('删除音轨失败:', error);
      res.status(500).json({ error: '删除音轨失败' });
    }
  }
}

module.exports = new AudioController();
