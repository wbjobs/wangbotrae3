const pool = require('../config/db');
const memoryStore = require('../utils/memoryStore');

class Comment {
  static async create(sessionId, userId, content, timestamp = null) {
    try {
      const result = await pool.query(
        'INSERT INTO comments (session_id, user_id, content, timestamp) VALUES ($1, $2, $3, $4) RETURNING *',
        [sessionId, userId, content, timestamp]
      );
      return result.rows[0];
    } catch (err) {
      console.log('Using memory store for Comment.create');
      const comment = {
        id: memoryStore.generateId(),
        session_id: sessionId,
        user_id: userId,
        content,
        timestamp: timestamp || Date.now(),
        created_at: new Date().toISOString()
      };
      if (!memoryStore.comments.has(sessionId)) {
        memoryStore.comments.set(sessionId, []);
      }
      memoryStore.comments.get(sessionId).push(comment);
      return comment;
    }
  }

  static async getBySession(sessionId) {
    try {
      const result = await pool.query(
        'SELECT c.*, u.name as user_name, u.role as user_role FROM comments c JOIN users u ON c.user_id = u.id WHERE c.session_id = $1 ORDER BY c.timestamp ASC',
        [sessionId]
      );
      return result.rows;
    } catch (err) {
      const comments = memoryStore.comments.get(sessionId) || [];
      return comments
        .map(c => ({
          ...c,
          user_name: memoryStore.users.get(c.user_id)?.name || 'Unknown',
          user_role: memoryStore.users.get(c.user_id)?.role || 'student'
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    }
  }

  static async delete(commentId, userId) {
    try {
      const result = await pool.query(
        'DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING *',
        [commentId, userId]
      );
      return result.rows[0];
    } catch (err) {
      for (const [sessionId, comments] of memoryStore.comments.entries()) {
        const idx = comments.findIndex(c => c.id === commentId && c.user_id === userId);
        if (idx !== -1) {
          return comments.splice(idx, 1)[0];
        }
      }
      return null;
    }
  }
}

module.exports = Comment;
