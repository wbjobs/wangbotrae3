import { Router } from 'express';
import multer from 'multer';
import { computeHash } from './validator.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }
});

const PRIORITY_MIN = 0;
const PRIORITY_MAX = 5;

function clampPriority(val) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return 0;
  return Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, n));
}

export function createRouter(storage, database, p2pNode, sessionManager) {
  const router = Router();

  router.post('/chunk/upload', upload.single('chunk'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No chunk data provided' });
      }

      const buffer = req.file.buffer;
      const sessionId = req.body.sessionId || null;
      const fileIndex = parseInt(req.body.fileIndex, 10);
      const fileName = req.body.fileName || 'unknown';
      const fileSize = parseInt(req.body.fileSize, 10) || 0;
      const totalChunks = parseInt(req.body.totalChunks, 10) || 0;
      const expectedHash = req.body.expectedHash || null;
      const priority = clampPriority(req.body.priority);

      const hash = await storage.store(buffer, expectedHash);

      let fileId = null;
      if (sessionId) {
        let session = await sessionManager.getSession(sessionId);
        if (!session) {
          fileId = database.insertFile(fileName, fileSize, totalChunks);
          await sessionManager.createSession(sessionId, {
            fileName,
            fileSize,
            totalChunks
          });
        } else {
          const existingChunk = database.getChunkByHash(hash);
          if (existingChunk) {
            fileId = existingChunk.file_id;
          } else {
            fileId = database.insertFile(fileName, fileSize, totalChunks);
          }
        }

        await sessionManager.addUploadedChunk(sessionId, isNaN(fileIndex) ? 0 : fileIndex, hash);
        await sessionManager.refreshSessionTTL(sessionId);
      } else {
        fileId = database.insertFile(fileName, fileSize, totalChunks);
      }

      database.insertChunk(hash, fileId, isNaN(fileIndex) ? 0 : fileIndex, buffer.length, priority);
      database.markChunkStoredLocally(hash);

      await p2pNode.announceChunks([hash]);

      const progress = sessionId ? await sessionManager.getSessionProgress(sessionId) : null;

      res.json({
        hash,
        size: buffer.length,
        priority,
        sessionId,
        progress
      });
    } catch (err) {
      console.error('Upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/chunk/:hash', async (req, res) => {
    try {
      const { hash } = req.params;

      if (!/^[a-f0-9]{64}$/.test(hash)) {
        return res.status(400).json({ error: 'Invalid hash format, expected 64-char hex SHA-256' });
      }

      let chunkData = await storage.retrieve(hash);

      if (!chunkData) {
        chunkData = await p2pNode.fetchChunkFromNetwork(hash);

        if (chunkData) {
          await storage.store(chunkData, hash);
          database.markChunkStoredLocally(hash);
        }
      }

      if (!chunkData) {
        return res.status(404).json({
          error: 'Chunk not found',
          hash,
          hint: 'Chunk is not available locally or on any known peer'
        });
      }

      const chunkMeta = database.getChunkByHash(hash);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Chunk-Hash', hash);
      res.setHeader('X-Chunk-Size', chunkData.length.toString());
      if (chunkMeta) {
        res.setHeader('X-Chunk-Priority', chunkMeta.priority.toString());
        res.setHeader('X-Chunk-Index', chunkMeta.chunk_index.toString());
      }
      res.send(Buffer.from(chunkData));
    } catch (err) {
      console.error('Retrieve error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/file/:fileId/next-chunk', (req, res) => {
    try {
      const { fileId } = req.params;
      const file = database.getFile(parseInt(fileId, 10));
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      const chunk = database.getNextPriorityChunk(file.id);
      if (!chunk) {
        return res.json({
          fileId: file.id,
          fileName: file.file_name,
          status: 'complete',
          message: 'All chunks have been fetched'
        });
      }

      res.json({
        fileId: file.id,
        fileName: file.file_name,
        nextChunk: {
          hash: chunk.hash,
          chunkIndex: chunk.chunk_index,
          priority: chunk.priority,
          chunkSize: chunk.chunk_size,
          storedLocally: !!chunk.stored_locally
        }
      });
    } catch (err) {
      console.error('Next chunk error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/file/:fileId/fetch-priority', async (req, res) => {
    try {
      const { fileId } = req.params;
      const file = database.getFile(parseInt(fileId, 10));
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      const results = await p2pNode.fetchChunksByPriority(file.id);

      res.json({
        fileId: file.id,
        fileName: file.file_name,
        fetchedCount: results.fetched.length,
        failedCount: results.failed.length,
        fetched: results.fetched,
        failed: results.failed
      });
    } catch (err) {
      console.error('Priority fetch error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/file/:fileId/chunks', (req, res) => {
    try {
      const { fileId } = req.params;
      const file = database.getFile(parseInt(fileId, 10));
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      const chunks = database.getChunksByFileId(file.id);

      const stored = chunks.filter(c => c.stored_locally).length;
      const missing = chunks.length - stored;

      res.json({
        fileId: file.id,
        fileName: file.file_name,
        fileSize: file.file_size,
        totalChunks: file.total_chunks,
        storedLocally: stored,
        missing,
        progress: chunks.length > 0 ? ((stored / chunks.length) * 100).toFixed(2) : '0.00',
        chunks: chunks.map(c => ({
          hash: c.hash,
          chunkIndex: c.chunk_index,
          chunkSize: c.chunk_size,
          priority: c.priority,
          storedLocally: !!c.stored_locally
        }))
      });
    } catch (err) {
      console.error('File chunks error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/chunk/:hash/priority', (req, res) => {
    try {
      const { hash } = req.params;
      const priority = clampPriority(req.body.priority);

      const chunk = database.getChunkByHash(hash);
      if (!chunk) {
        return res.status(404).json({ error: 'Chunk not found' });
      }

      database.updateChunkPriority(hash, priority);

      res.json({
        hash,
        previousPriority: chunk.priority,
        newPriority: priority
      });
    } catch (err) {
      console.error('Priority update error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/peer/list', (req, res) => {
    try {
      const peers = p2pNode.getPeerList();
      const selfId = p2pNode.getPeerId();

      res.json({
        selfPeerId: selfId,
        peerCount: peers.length,
        peers
      });
    } catch (err) {
      console.error('Peer list error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/session/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const progress = await sessionManager.getSessionProgress(sessionId);

      if (!progress) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json(progress);
    } catch (err) {
      console.error('Session progress error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
