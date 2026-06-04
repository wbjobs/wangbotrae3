import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { verifyChunkHash } from './validator.js';

const MAX_MEMORY_CACHE_SIZE = 256 * 1024 * 1024;

export class ChunkStorage {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.memoryCache = new Map();
    this.memoryCacheSize = 0;

    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
  }

  _chunkPath(hash) {
    const prefix = hash.substring(0, 2);
    const dir = path.join(this.storageDir, prefix);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, hash);
  }

  async store(buffer, expectedHash) {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    if (expectedHash && hash !== expectedHash) {
      throw new Error(`Hash mismatch: expected ${expectedHash}, got ${hash}`);
    }

    if (!verifyChunkHash(buffer, hash)) {
      throw new Error(`Integrity check failed for chunk ${hash}`);
    }

    const filePath = this._chunkPath(hash);
    if (!fs.existsSync(filePath)) {
      await fs.promises.writeFile(filePath, buffer);
    }

    this._addToMemoryCache(hash, buffer);

    return hash;
  }

  async retrieve(hash) {
    const cached = this._getFromMemoryCache(hash);
    if (cached) {
      return cached;
    }

    const filePath = this._chunkPath(hash);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const buffer = await fs.promises.readFile(filePath);

    if (!verifyChunkHash(buffer, hash)) {
      await fs.promises.unlink(filePath).catch(() => {});
      this._removeFromMemoryCache(hash);
      throw new Error(`Integrity check failed for chunk ${hash} on retrieval`);
    }

    this._addToMemoryCache(hash, buffer);
    return buffer;
  }

  hasLocal(hash) {
    if (this.memoryCache.has(hash)) return true;
    return fs.existsSync(this._chunkPath(hash));
  }

  async delete(hash) {
    this._removeFromMemoryCache(hash);
    const filePath = this._chunkPath(hash);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }

  _addToMemoryCache(hash, buffer) {
    if (this.memoryCache.has(hash)) return;

    while (this.memoryCacheSize + buffer.length > MAX_MEMORY_CACHE_SIZE && this.memoryCache.size > 0) {
      const oldestKey = this.memoryCache.keys().next().value;
      const oldBuf = this.memoryCache.get(oldestKey);
      this.memoryCacheSize -= oldBuf.length;
      this.memoryCache.delete(oldestKey);
    }

    if (this.memoryCacheSize + buffer.length <= MAX_MEMORY_CACHE_SIZE) {
      this.memoryCache.set(hash, buffer);
      this.memoryCacheSize += buffer.length;
    }
  }

  _getFromMemoryCache(hash) {
    const buf = this.memoryCache.get(hash);
    if (buf) {
      this.memoryCache.delete(hash);
      this.memoryCache.set(hash, buf);
      return buf;
    }
    return null;
  }

  _removeFromMemoryCache(hash) {
    const buf = this.memoryCache.get(hash);
    if (buf) {
      this.memoryCacheSize -= buf.length;
      this.memoryCache.delete(hash);
    }
  }
}
