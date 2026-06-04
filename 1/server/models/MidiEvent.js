const pool = require('../config/db');
const memoryStore = require('../utils/memoryStore');

class MidiEvent {
  static async create(sessionId, userId, eventType, noteNumber, velocity, timestamp, serverTimestamp) {
    try {
      const result = await pool.query(
        'INSERT INTO midi_events (session_id, user_id, event_type, note_number, velocity, timestamp, server_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [sessionId, userId, eventType, noteNumber, velocity, timestamp, serverTimestamp]
      );
      return result.rows[0];
    } catch (err) {
      console.log('Using memory store for MidiEvent.create');
      const event = {
        id: memoryStore.generateId(),
        session_id: sessionId,
        user_id: userId,
        event_type: eventType,
        note_number: noteNumber,
        velocity,
        timestamp,
        server_timestamp: serverTimestamp,
        created_at: new Date().toISOString()
      };
      if (!memoryStore.midiEvents.has(sessionId)) {
        memoryStore.midiEvents.set(sessionId, []);
      }
      memoryStore.midiEvents.get(sessionId).push(event);
      return event;
    }
  }

  static async getBySession(sessionId, startTime = null, endTime = null) {
    try {
      let query = 'SELECT * FROM midi_events WHERE session_id = $1';
      let params = [sessionId];
      
      if (startTime !== null) {
        query += ' AND timestamp >= $2';
        params.push(startTime);
      }
      if (endTime !== null) {
        query += ' AND timestamp <= $' + (params.length + 1);
        params.push(endTime);
      }
      
      query += ' ORDER BY timestamp ASC';
      
      const result = await pool.query(query, params);
      return result.rows;
    } catch (err) {
      let events = memoryStore.midiEvents.get(sessionId) || [];
      if (startTime !== null) {
        events = events.filter(e => e.timestamp >= startTime);
      }
      if (endTime !== null) {
        events = events.filter(e => e.timestamp <= endTime);
      }
      return events.sort((a, b) => a.timestamp - b.timestamp);
    }
  }
}

module.exports = MidiEvent;
