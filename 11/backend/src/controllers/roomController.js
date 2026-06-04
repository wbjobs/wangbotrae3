const db = require('../config/database');

class RoomController {
  async createRoom(req, res) {
    try {
      const { name, createdBy } = req.body;
      
      if (!name || !createdBy) {
        return res.status(400).json({ error: '房间名称和创建者不能为空' });
      }

      const result = await db.query(
        `INSERT INTO rooms (name, created_by, status)
         VALUES ($1, $2, 'active')
         RETURNING id, name, created_by as "createdBy", created_at as "createdAt", status`,
        [name, createdBy]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error('创建房间失败:', error);
      res.status(500).json({ error: '创建房间失败' });
    }
  }

  async getRoom(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        `SELECT id, name, created_by as "createdBy", created_at as "createdAt", 
                status, reference_audio_id as "referenceAudioId"
         FROM rooms WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '房间不存在' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('获取房间信息失败:', error);
      res.status(500).json({ error: '获取房间信息失败' });
    }
  }

  async listRooms(req, res) {
    try {
      const { status = 'active' } = req.query;

      const result = await db.query(
        `SELECT id, name, created_by as "createdBy", created_at as "createdAt", 
                status, reference_audio_id as "referenceAudioId"
         FROM rooms 
         WHERE status = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [status]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('获取房间列表失败:', error);
      res.status(500).json({ error: '获取房间列表失败' });
    }
  }

  async updateRoom(req, res) {
    try {
      const { id } = req.params;
      const { status, referenceAudioId } = req.body;

      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(status);
      }

      if (referenceAudioId !== undefined) {
        updates.push(`reference_audio_id = $${paramIndex++}`);
        values.push(referenceAudioId);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: '没有更新内容' });
      }

      values.push(id);

      const result = await db.query(
        `UPDATE rooms SET ${updates.join(', ')}
         WHERE id = $${paramIndex}
         RETURNING id, name, created_by as "createdBy", created_at as "createdAt", 
                   status, reference_audio_id as "referenceAudioId"`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '房间不存在' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('更新房间失败:', error);
      res.status(500).json({ error: '更新房间失败' });
    }
  }

  async deleteRoom(req, res) {
    try {
      const { id } = req.params;

      const result = await db.query(
        'DELETE FROM rooms WHERE id = $1 RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: '房间不存在' });
      }

      res.json({ message: '房间已删除', id: result.rows[0].id });
    } catch (error) {
      console.error('删除房间失败:', error);
      res.status(500).json({ error: '删除房间失败' });
    }
  }
}

module.exports = new RoomController();
