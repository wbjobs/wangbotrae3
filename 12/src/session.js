import Redis from 'ioredis';

const SESSION_TTL = 86400;

export class SessionManager {
  constructor(redisUrl = 'redis://localhost:6379') {
    this.redis = new Redis(redisUrl);
    this.keyPrefix = 'p2p:session:';
  }

  async createSession(sessionId, metadata) {
    const key = `${this.keyPrefix}${sessionId}`;
    const data = {
      fileName: metadata.fileName || 'unknown',
      fileSize: metadata.fileSize || 0,
      totalChunks: metadata.totalChunks || 0,
      uploadedChunks: JSON.stringify([]),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.redis.hset(key, data);
    await this.redis.expire(key, SESSION_TTL);
    return sessionId;
  }

  async getSession(sessionId) {
    const key = `${this.keyPrefix}${sessionId}`;
    const data = await this.redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      sessionId,
      fileName: data.fileName,
      fileSize: parseInt(data.fileSize, 10),
      totalChunks: parseInt(data.totalChunks, 10),
      uploadedChunks: JSON.parse(data.uploadedChunks || '[]'),
      createdAt: parseInt(data.createdAt, 10),
      updatedAt: parseInt(data.updatedAt, 10)
    };
  }

  async addUploadedChunk(sessionId, chunkIndex, chunkHash) {
    const key = `${this.keyPrefix}${sessionId}`;
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const uploadedChunks = session.uploadedChunks;
    const exists = uploadedChunks.some(c => c.index === chunkIndex);
    if (!exists) {
      uploadedChunks.push({ index: chunkIndex, hash: chunkHash });
    }

    await this.redis.hset(key, {
      uploadedChunks: JSON.stringify(uploadedChunks),
      updatedAt: Date.now()
    });

    await this.redis.expire(key, SESSION_TTL);

    return uploadedChunks;
  }

  async getSessionProgress(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      fileName: session.fileName,
      totalChunks: session.totalChunks,
      uploadedCount: session.uploadedChunks.length,
      remainingCount: session.totalChunks - session.uploadedChunks.length,
      progress: session.totalChunks > 0
        ? (session.uploadedChunks.length / session.totalChunks * 100).toFixed(2)
        : 0,
      uploadedChunks: session.uploadedChunks,
      isComplete: session.uploadedChunks.length === session.totalChunks
    };
  }

  async deleteSession(sessionId) {
    const key = `${this.keyPrefix}${sessionId}`;
    await this.redis.del(key);
  }

  async refreshSessionTTL(sessionId) {
    const key = `${this.keyPrefix}${sessionId}`;
    await this.redis.expire(key, SESSION_TTL);
  }

  disconnect() {
    this.redis.disconnect();
  }
}
