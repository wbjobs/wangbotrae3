const pool = require('../config/db');
const memoryStore = require('../utils/memoryStore');
const MusicXMLUtils = require('../utils/musicxml');

class Score {
  static async create(title, musicxml, createdBy) {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const result = await client.query(
          'INSERT INTO scores (title, musicxml, created_by) VALUES ($1, $2, $3) RETURNING *',
          [title, musicxml, createdBy]
        );
        
        await client.query(
          'INSERT INTO score_versions (score_id, version_number, musicxml, user_id) VALUES ($1, 1, $2, $3)',
          [result.rows[0].id, musicxml, createdBy]
        );
        
        await client.query('COMMIT');
        return result.rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.log('Using memory store for Score.create');
      const score = {
        id: memoryStore.generateId(),
        title,
        musicxml: musicxml || MusicXMLUtils.createEmpty(title),
        created_by: createdBy,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      memoryStore.scores.set(score.id, score);
      
      const version = {
        id: memoryStore.generateId(),
        score_id: score.id,
        version_number: 1,
        musicxml: score.musicxml,
        operation: null,
        user_id: createdBy,
        created_at: new Date().toISOString()
      };
      if (!memoryStore.scoreVersions.has(score.id)) {
        memoryStore.scoreVersions.set(score.id, []);
      }
      memoryStore.scoreVersions.get(score.id).push(version);
      
      return score;
    }
  }

  static async findById(id) {
    try {
      const result = await pool.query(
        'SELECT * FROM scores WHERE id = $1',
        [id]
      );
      return result.rows[0];
    } catch (err) {
      return memoryStore.scores.get(id);
    }
  }

  static async findByUserId(userId) {
    try {
      const result = await pool.query(
        'SELECT * FROM scores WHERE created_by = $1 ORDER BY updated_at DESC',
        [userId]
      );
      return result.rows;
    } catch (err) {
      return Array.from(memoryStore.scores.values())
        .filter(s => s.created_by === userId)
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }
  }

  static async update(id, musicxml, userId, operation) {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const versionResult = await client.query(
          'SELECT COALESCE(MAX(version_number), 0) + 1 as next_version FROM score_versions WHERE score_id = $1',
          [id]
        );
        const nextVersion = versionResult.rows[0].next_version;
        
        await client.query(
          'INSERT INTO score_versions (score_id, version_number, musicxml, operation, user_id) VALUES ($1, $2, $3, $4, $5)',
          [id, nextVersion, musicxml, operation, userId]
        );
        
        const result = await client.query(
          'UPDATE scores SET musicxml = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
          [musicxml, id]
        );
        
        await client.query('COMMIT');
        return result.rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.log('Using memory store for Score.update');
      const score = memoryStore.scores.get(id);
      if (!score) throw new Error('Score not found');
      
      const versions = memoryStore.scoreVersions.get(id) || [];
      const nextVersion = versions.length + 1;
      
      const version = {
        id: memoryStore.generateId(),
        score_id: id,
        version_number: nextVersion,
        musicxml,
        operation,
        user_id: userId,
        created_at: new Date().toISOString()
      };
      versions.push(version);
      memoryStore.scoreVersions.set(id, versions);
      
      score.musicxml = musicxml;
      score.updated_at = new Date().toISOString();
      memoryStore.scores.set(id, score);
      
      return score;
    }
  }

  static async getVersions(scoreId) {
    try {
      const result = await pool.query(
        'SELECT sv.*, u.name as user_name FROM score_versions sv LEFT JOIN users u ON sv.user_id = u.id WHERE sv.score_id = $1 ORDER BY sv.version_number DESC',
        [scoreId]
      );
      return result.rows;
    } catch (err) {
      const versions = memoryStore.scoreVersions.get(scoreId) || [];
      return versions.map(v => ({
        ...v,
        user_name: memoryStore.users.get(v.user_id)?.name || 'Unknown'
      })).sort((a, b) => b.version_number - a.version_number);
    }
  }

  static async getLatestVersion(scoreId) {
    try {
      const result = await pool.query(
        'SELECT * FROM score_versions WHERE score_id = $1 ORDER BY version_number DESC LIMIT 1',
        [scoreId]
      );
      return result.rows[0];
    } catch (err) {
      const versions = memoryStore.scoreVersions.get(scoreId) || [];
      return versions[versions.length - 1];
    }
  }
}

module.exports = Score;
