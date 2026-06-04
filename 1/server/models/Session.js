const pool = require('../config/db');
const crypto = require('crypto');
const memoryStore = require('../utils/memoryStore');
const Score = require('./Score');

class Session {
  static generateInviteCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  static async create(scoreId, teacherId) {
    try {
      const inviteCode = this.generateInviteCode();
      const result = await pool.query(
        'INSERT INTO sessions (score_id, teacher_id, invite_code) VALUES ($1, $2, $3) RETURNING *',
        [scoreId, teacherId, inviteCode]
      );
      
      await pool.query(
        'INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)',
        [result.rows[0].id, teacherId]
      );
      
      return result.rows[0];
    } catch (err) {
      console.log('Using memory store for Session.create');
      const inviteCode = memoryStore.generateInviteCode();
      const session = {
        id: memoryStore.generateId(),
        score_id: scoreId,
        teacher_id: teacherId,
        invite_code: inviteCode,
        status: 'active',
        created_at: new Date().toISOString(),
        ended_at: null
      };
      memoryStore.sessions.set(session.id, session);
      
      if (!memoryStore.sessionParticipants.has(session.id)) {
        memoryStore.sessionParticipants.set(session.id, []);
      }
      memoryStore.sessionParticipants.get(session.id).push({
        id: memoryStore.generateId(),
        session_id: session.id,
        user_id: teacherId,
        joined_at: new Date().toISOString(),
        left_at: null
      });
      
      return session;
    }
  }

  static async findByInviteCode(inviteCode) {
    try {
      const result = await pool.query(
        'SELECT s.*, sc.title as score_title, sc.musicxml as score_musicxml FROM sessions s JOIN scores sc ON s.score_id = sc.id WHERE s.invite_code = $1 AND s.status = $2',
        [inviteCode.toUpperCase(), 'active']
      );
      return result.rows[0];
    } catch (err) {
      for (const session of memoryStore.sessions.values()) {
        if (session.invite_code === inviteCode.toUpperCase() && session.status === 'active') {
          const score = memoryStore.scores.get(session.score_id);
          return {
            ...session,
            score_title: score?.title || 'Untitled',
            score_musicxml: score?.musicxml || ''
          };
        }
      }
      return null;
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query(
        'SELECT s.*, sc.title as score_title, sc.musicxml as score_musicxml FROM sessions s JOIN scores sc ON s.score_id = sc.id WHERE s.id = $1',
        [id]
      );
      return result.rows[0];
    } catch (err) {
      const session = memoryStore.sessions.get(id);
      if (!session) return null;
      const score = memoryStore.scores.get(session.score_id);
      return {
        ...session,
        score_title: score?.title || 'Untitled',
        score_musicxml: score?.musicxml || ''
      };
    }
  }

  static async addParticipant(sessionId, userId) {
    try {
      await pool.query(
        'INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2) ON CONFLICT (session_id, user_id) DO UPDATE SET left_at = NULL',
        [sessionId, userId]
      );
      return true;
    } catch (err) {
      const participants = memoryStore.sessionParticipants.get(sessionId) || [];
      const existing = participants.find(p => p.user_id === userId);
      if (existing) {
        existing.left_at = null;
      } else {
        participants.push({
          id: memoryStore.generateId(),
          session_id: sessionId,
          user_id: userId,
          joined_at: new Date().toISOString(),
          left_at: null
        });
      }
      memoryStore.sessionParticipants.set(sessionId, participants);
      return true;
    }
  }

  static async removeParticipant(sessionId, userId) {
    try {
      await pool.query(
        'UPDATE session_participants SET left_at = CURRENT_TIMESTAMP WHERE session_id = $1 AND user_id = $2',
        [sessionId, userId]
      );
    } catch (err) {
      const participants = memoryStore.sessionParticipants.get(sessionId) || [];
      const existing = participants.find(p => p.user_id === userId);
      if (existing) {
        existing.left_at = new Date().toISOString();
      }
    }
  }

  static async getParticipants(sessionId) {
    try {
      const result = await pool.query(
        'SELECT sp.*, u.name, u.role FROM session_participants sp JOIN users u ON sp.user_id = u.id WHERE sp.session_id = $1 AND sp.left_at IS NULL ORDER BY sp.joined_at',
        [sessionId]
      );
      return result.rows;
    } catch (err) {
      const participants = memoryStore.sessionParticipants.get(sessionId) || [];
      return participants
        .filter(p => p.left_at === null)
        .map(p => ({
          ...p,
          name: memoryStore.users.get(p.user_id)?.name || 'Unknown',
          role: memoryStore.users.get(p.user_id)?.role || 'student'
        }))
        .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
    }
  }

  static async endSession(sessionId) {
    try {
      const result = await pool.query(
        'UPDATE sessions SET status = $1, ended_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        ['ended', sessionId]
      );
      return result.rows[0];
    } catch (err) {
      const session = memoryStore.sessions.get(sessionId);
      if (session) {
        session.status = 'ended';
        session.ended_at = new Date().toISOString();
      }
      return session;
    }
  }

  static async findActiveByTeacher(teacherId) {
    try {
      const result = await pool.query(
        'SELECT s.*, sc.title as score_title FROM sessions s JOIN scores sc ON s.score_id = sc.id WHERE s.teacher_id = $1 AND s.status = $2 ORDER BY s.created_at DESC',
        [teacherId, 'active']
      );
      return result.rows;
    } catch (err) {
      return Array.from(memoryStore.sessions.values())
        .filter(s => s.teacher_id === teacherId && s.status === 'active')
        .map(s => ({
          ...s,
          score_title: memoryStore.scores.get(s.score_id)?.title || 'Untitled'
        }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }

  static async findAllByTeacher(teacherId) {
    try {
      const result = await pool.query(
        'SELECT s.*, sc.title as score_title FROM sessions s JOIN scores sc ON s.score_id = sc.id WHERE s.teacher_id = $1 ORDER BY s.created_at DESC',
        [teacherId]
      );
      return result.rows;
    } catch (err) {
      return Array.from(memoryStore.sessions.values())
        .filter(s => s.teacher_id === teacherId)
        .map(s => ({
          ...s,
          score_title: memoryStore.scores.get(s.score_id)?.title || 'Untitled'
        }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }

  static async getSessionStats(sessionId) {
    try {
      const result = await pool.query(
        `SELECT 
          COUNT(DISTINCT me.user_id) as participant_count,
          COUNT(*) as event_count,
          MIN(me.timestamp) as first_event_time,
          MAX(me.timestamp) as last_event_time
        FROM midi_events me 
        WHERE me.session_id = $1`,
        [sessionId]
      );
      return result.rows[0];
    } catch (err) {
      const events = memoryStore.midiEvents.get(sessionId) || [];
      const uniqueUsers = new Set(events.map(e => e.user_id));
      return {
        participant_count: uniqueUsers.size,
        event_count: events.length,
        first_event_time: events.length > 0 ? Math.min(...events.map(e => e.timestamp)) : null,
        last_event_time: events.length > 0 ? Math.max(...events.map(e => e.timestamp)) : null
      };
    }
  }
}

module.exports = Session;
