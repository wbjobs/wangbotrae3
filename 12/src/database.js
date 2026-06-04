import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  file_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  priority INTEGER DEFAULT 0,
  stored_locally INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_id) REFERENCES files(id)
);

CREATE TABLE IF NOT EXISTS peer_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  peer_id TEXT NOT NULL,
  chunk_hash TEXT NOT NULL,
  discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_verified_at DATETIME,
  FOREIGN KEY (chunk_hash) REFERENCES chunks(hash)
);

CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash);
CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_priority ON chunks(priority);
CREATE INDEX IF NOT EXISTS idx_peer_chunks_peer ON peer_chunks(peer_id);
CREATE INDEX IF NOT EXISTS idx_peer_chunks_hash ON peer_chunks(chunk_hash);
`;

export class ChunkDatabase {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this._migratePriorityColumn();
  }

  _migratePriorityColumn() {
    const cols = this.db.pragma('table_info(chunks)');
    const hasPriority = cols.some(c => c.name === 'priority');
    if (!hasPriority) {
      this.db.exec('ALTER TABLE chunks ADD COLUMN priority INTEGER DEFAULT 0');
    }
  }

  insertFile(fileName, fileSize, totalChunks) {
    const stmt = this.db.prepare(
      'INSERT INTO files (file_name, file_size, total_chunks) VALUES (?, ?, ?)'
    );
    const result = stmt.run(fileName, fileSize, totalChunks);
    return result.lastInsertRowid;
  }

  getFile(fileId) {
    return this.db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  }

  getFileByName(fileName) {
    return this.db.prepare('SELECT * FROM files WHERE file_name = ?').get(fileName);
  }

  insertChunk(hash, fileId, chunkIndex, chunkSize, priority = 0) {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO chunks (hash, file_id, chunk_index, chunk_size, priority) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(hash, fileId, chunkIndex, chunkSize, priority);
  }

  updateChunkPriority(hash, priority) {
    this.db.prepare('UPDATE chunks SET priority = ? WHERE hash = ?').run(priority, hash);
  }

  getChunkByHash(hash) {
    return this.db.prepare('SELECT * FROM chunks WHERE hash = ?').get(hash);
  }

  getChunksByFileId(fileId) {
    return this.db.prepare('SELECT * FROM chunks WHERE file_id = ? ORDER BY chunk_index').all(fileId);
  }

  getMissingChunksByPriority(fileId) {
    return this.db.prepare(
      `SELECT * FROM chunks
       WHERE file_id = ? AND stored_locally = 0
       ORDER BY priority DESC, chunk_index ASC`
    ).all(fileId);
  }

  getMissingChunksGroupedByPriority(fileId) {
    const rows = this.db.prepare(
      `SELECT * FROM chunks
       WHERE file_id = ? AND stored_locally = 0
       ORDER BY priority DESC, chunk_index ASC`
    ).all(fileId);

    const groups = new Map();
    for (const row of rows) {
      const p = row.priority;
      if (!groups.has(p)) {
        groups.set(p, []);
      }
      groups.get(p).push(row);
    }
    return groups;
  }

  getNextPriorityChunk(fileId) {
    return this.db.prepare(
      `SELECT * FROM chunks
       WHERE file_id = ? AND stored_locally = 0
       ORDER BY priority DESC, chunk_index ASC
       LIMIT 1`
    ).get(fileId);
  }

  getChunksByFileIdAndPriority(fileId, minPriority = 0) {
    return this.db.prepare(
      `SELECT * FROM chunks
       WHERE file_id = ? AND priority >= ?
       ORDER BY priority DESC, chunk_index ASC`
    ).all(fileId, minPriority);
  }

  markChunkStoredLocally(hash) {
    this.db.prepare('UPDATE chunks SET stored_locally = 1 WHERE hash = ?').run(hash);
  }

  insertPeerChunk(peerId, chunkHash) {
    const stmt = this.db.prepare(
      `INSERT INTO peer_chunks (peer_id, chunk_hash, discovered_at, last_verified_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`
    );
    stmt.run(peerId, chunkHash);
  }

  getPeersForChunk(chunkHash) {
    return this.db.prepare(
      `SELECT peer_id FROM peer_chunks WHERE chunk_hash = ?`
    ).all(chunkHash);
  }

  getChunksForPeer(peerId) {
    return this.db.prepare(
      `SELECT chunk_hash FROM peer_chunks WHERE peer_id = ?`
    ).all(peerId);
  }

  updatePeerChunkVerification(peerId, chunkHash) {
    this.db.prepare(
      `UPDATE peer_chunks SET last_verified_at = datetime('now') WHERE peer_id = ? AND chunk_hash = ?`
    ).run(peerId, chunkHash);
  }

  removeStalePeers(maxAgeSeconds = 3600) {
    this.db.prepare(
      `DELETE FROM peer_chunks WHERE last_verified_at < datetime('now', '-${maxAgeSeconds} seconds')`
    ).run();
  }

  removeAllPeerChunks(peerId) {
    const result = this.db.prepare(
      'DELETE FROM peer_chunks WHERE peer_id = ?'
    ).run(peerId);
    return result.changes;
  }

  removePeerChunk(peerId, chunkHash) {
    const result = this.db.prepare(
      'DELETE FROM peer_chunks WHERE peer_id = ? AND chunk_hash = ?'
    ).run(peerId, chunkHash);
    return result.changes;
  }

  getActivePeersForChunk(chunkHash) {
    return this.db.prepare(
      `SELECT pc.peer_id FROM peer_chunks pc
       WHERE pc.chunk_hash = ?`
    ).all(chunkHash);
  }

  close() {
    this.db.close();
  }
}
