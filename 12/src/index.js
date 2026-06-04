import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChunkDatabase } from './database.js';
import { ChunkStorage } from './storage.js';
import { P2PNode } from './p2p.js';
import { SessionManager } from './session.js';
import { createRouter } from './routes.js';

if (typeof Promise.withResolvers === 'undefined') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3000', 10);
const P2P_PORT = parseInt(process.env.P2P_PORT || '4001', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const STORAGE_DIR = path.join(DATA_DIR, 'chunks');
const DB_PATH = path.join(DATA_DIR, 'metadata.db');

async function main() {
  const database = new ChunkDatabase(DB_PATH);
  const storage = new ChunkStorage(STORAGE_DIR);
  const sessionManager = new SessionManager(REDIS_URL);
  const p2pNode = new P2PNode(storage, database, { port: P2P_PORT });

  await p2pNode.start();

  const app = express();
  app.use(express.json());

  const router = createRouter(storage, database, p2pNode, sessionManager);
  app.use(router);

  app.use((err, req, res, _next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'Chunk size exceeds 1MB limit'
        });
      }
      return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(HTTP_PORT, () => {
    console.log(`HTTP server listening on port ${HTTP_PORT}`);
    console.log(`P2P node listening on port ${P2P_PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
    console.log(`Peer ID: ${p2pNode.getPeerId()}`);
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    await p2pNode.stop();
    sessionManager.disconnect();
    database.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
