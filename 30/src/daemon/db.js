const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class ClipboardDatabase {
  constructor() {
    const dbDir = path.dirname(config.DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    this.db = new Database(config.DB_PATH);
    this.init();
    this._prepareStatements();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('text', 'image')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        source_app TEXT,
        is_pinned INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        category TEXT,
        ocr_text TEXT,
        is_synced INTEGER DEFAULT 0,
        device_id TEXT,
        remote_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_history(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_type ON clipboard_history(type);
      CREATE INDEX IF NOT EXISTS idx_pinned ON clipboard_history(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_category ON clipboard_history(category);
      CREATE INDEX IF NOT EXISTS idx_synced ON clipboard_history(is_synced);
      CREATE INDEX IF NOT EXISTS idx_ocr ON clipboard_history(ocr_text);
    `);

    this._migrate();
  }

  _migrate() {
    const columns = this.db.pragma('table_info(clipboard_history)').map(col => col.name);
    
    const newColumns = ['category', 'ocr_text', 'is_synced', 'device_id', 'remote_id'];
    for (const col of newColumns) {
      if (!columns.includes(col)) {
        try {
          this.db.exec(`ALTER TABLE clipboard_history ADD COLUMN ${col} TEXT`);
        } catch (err) {
        }
      }
    }
  }

  _prepareStatements() {
    this._addRecord = this.db.prepare(
      'INSERT INTO clipboard_history (type, content, timestamp, source_app) VALUES (?, ?, ?, ?)'
    );

    this._addRecordWithMeta = this.db.prepare(
      'INSERT INTO clipboard_history (type, content, timestamp, source_app, category, ocr_text, is_synced, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    this._getRecent = this.db.prepare(
      `SELECT * FROM clipboard_history 
       ORDER BY is_pinned DESC, sort_order ASC, timestamp DESC 
       LIMIT ? OFFSET ?`
    );

    this._getRecentForDedup = this.db.prepare(
      `SELECT id, type, content, timestamp FROM clipboard_history 
       ORDER BY timestamp DESC LIMIT ?`
    );

    this._search = this.db.prepare(
      `SELECT * FROM clipboard_history 
       WHERE (type = 'text' AND content LIKE ?) OR (ocr_text LIKE ?)
       ORDER BY is_pinned DESC, timestamp DESC 
       LIMIT ?`
    );

    this._getById = this.db.prepare(
      'SELECT * FROM clipboard_history WHERE id = ?'
    );

    this._updatePinned = this.db.prepare(
      'UPDATE clipboard_history SET is_pinned = ? WHERE id = ?'
    );

    this._updateSortOrder = this.db.prepare(
      'UPDATE clipboard_history SET sort_order = ? WHERE id = ?'
    );

    this._updateCategory = this.db.prepare(
      'UPDATE clipboard_history SET category = ? WHERE id = ?'
    );

    this._updateOCRText = this.db.prepare(
      'UPDATE clipboard_history SET ocr_text = ? WHERE id = ?'
    );

    this._markSynced = this.db.prepare(
      'UPDATE clipboard_history SET is_synced = 1 WHERE id = ?'
    );

    this._getStats = this.db.prepare(
      `SELECT 
         DATE(timestamp / 1000, 'unixepoch', 'localtime') as date,
         COUNT(*) as count,
         SUM(CASE WHEN type = 'text' THEN 1 ELSE 0 END) as text_count,
         SUM(CASE WHEN type = 'image' THEN 1 ELSE 0 END) as image_count
       FROM clipboard_history 
       WHERE timestamp > ?
       GROUP BY DATE(timestamp / 1000, 'unixepoch', 'localtime')
       ORDER BY date ASC`
    );

    this._getCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM clipboard_history'
    );

    this._getPendingSync = this.db.prepare(
      `SELECT * FROM clipboard_history 
       WHERE is_synced = 0 AND timestamp > ?
       ORDER BY timestamp DESC`
    );

    this._getByRemoteId = this.db.prepare(
      'SELECT * FROM clipboard_history WHERE remote_id = ?'
    );

    this._updateItem = this.db.prepare(
      'UPDATE clipboard_history SET content = ?, timestamp = ?, source_app = ? WHERE id = ?'
    );
  }

  addRecord(record) {
    const { type, content, sourceApp, category, ocrText, deviceId } = record;
    const timestamp = Date.now();
    
    if (category || ocrText || deviceId) {
      const result = this._addRecordWithMeta.run(
        type, content, timestamp, sourceApp, 
        category || null, ocrText || null, 0, deviceId || null
      );
      return { id: result.lastInsertRowid, timestamp };
    }

    const result = this._addRecord.run(type, content, timestamp, sourceApp);
    return { id: result.lastInsertRowid, timestamp };
  }

  getRecent(limit = 20, offset = 0) {
    const rows = this._getRecent.all(limit, offset);
    return rows.map(this._formatRow);
  }

  getRecentForDedup(limit = 10) {
    const rows = this._getRecentForDedup.all(limit);
    return rows.map(this._formatRow);
  }

  search(keyword, limit = 50) {
    const rows = this._search.all(`%${keyword}%`, `%${keyword}%`, limit);
    return rows.map(this._formatRow);
  }

  getById(id) {
    const row = this._getById.get(id);
    return row ? this._formatRow(row) : null;
  }

  updatePinned(id, isPinned) {
    const result = this._updatePinned.run(isPinned ? 1 : 0, id);
    return result.changes > 0;
  }

  updateSortOrder(id, sortOrder) {
    const result = this._updateSortOrder.run(sortOrder, id);
    return result.changes > 0;
  }

  updateCategory(id, category) {
    const result = this._updateCategory.run(category, id);
    return result.changes > 0;
  }

  updateOCRText(id, ocrText) {
    const result = this._updateOCRText.run(ocrText, id);
    return result.changes > 0;
  }

  markAsSynced(id) {
    const result = this._markSynced.run(id);
    return result.changes > 0;
  }

  getPendingSyncItems(lastSyncTime = 0) {
    const rows = this._getPendingSync.all(lastSyncTime);
    return rows.map(this._formatRow);
  }

  getByRemoteId(remoteId) {
    const row = this._getByRemoteId.get(remoteId);
    return row ? this._formatRow(row) : null;
  }

  insertRemoteItem(item) {
    const result = this._addRecordWithMeta.run(
      item.type,
      item.content,
      item.timestamp,
      item.sourceApp || null,
      item.category || null,
      item.ocrText || null,
      1,
      item.deviceId
    );
    return result.lastInsertRowid;
  }

  updateItem(id, updates) {
    const row = this._getById.get(id);
    if (!row) return false;

    const content = updates.content ?? row.content;
    const timestamp = updates.timestamp ?? row.timestamp;
    const sourceApp = updates.sourceApp ?? row.source_app;

    const result = this._updateItem.run(content, timestamp, sourceApp, id);
    return result.changes > 0;
  }

  getStats(days = 7) {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
    return this._getStats.all(startTime);
  }

  getCount() {
    const row = this._getCount.get();
    return row.count;
  }

  getByFilters(filters = {}) {
    const { type, startDate, endDate, category, limit = 100, offset = 0 } = filters;
    const conditions = [];
    const params = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }
    if (startDate) {
      conditions.push('timestamp >= ?');
      params.push(startDate);
    }
    if (endDate) {
      conditions.push('timestamp <= ?');
      params.push(endDate);
    }
    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    const sql = `
      SELECT * FROM clipboard_history 
      ${whereClause}
      ORDER BY is_pinned DESC, sort_order ASC, timestamp DESC 
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(this._formatRow);
  }

  getCategories() {
    const rows = this.db.prepare(
      `SELECT DISTINCT category FROM clipboard_history 
       WHERE category IS NOT NULL AND category != ''
       ORDER BY category`
    ).all();
    return rows.map(r => r.category);
  }

  _formatRow(row) {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      timestamp: row.timestamp,
      sourceApp: row.source_app,
      isPinned: row.is_pinned === 1,
      sortOrder: row.sort_order,
      category: row.category,
      ocrText: row.ocr_text,
      isSynced: row.is_synced === 1,
      deviceId: row.device_id,
      remoteId: row.remote_id,
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = ClipboardDatabase;
