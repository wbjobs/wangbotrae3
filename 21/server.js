const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();

function generateSessionCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function cleanupSession(code) {
  const session = sessions.get(code);
  if (session) {
    if (session.uploader) {
      session.uploader.leave(code);
    }
    if (session.downloader) {
      session.downloader.leave(code);
    }
    sessions.delete(code);
    console.log(`Session ${code} cleaned up`);
  }
}

app.get('/status/:code', (req, res) => {
  const { code } = req.params;
  const session = sessions.get(code.toUpperCase());
  
  if (!session) {
    return res.json({ active: false, exists: false });
  }
  
  res.json({
    active: true,
    exists: true,
    hasUploader: !!session.uploader,
    hasDownloader: !!session.downloader,
    fileName: session.fileName,
    fileSize: session.fileSize,
    totalChunks: session.totalChunks
  });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('create-session', (data, callback) => {
    const code = generateSessionCode();
    const { fileName, fileSize, fileMd5, totalChunks } = data;
    
    sessions.set(code, {
      uploader: socket,
      downloader: null,
      fileName,
      fileSize,
      fileMd5,
      totalChunks,
      uploadedChunks: new Set(),
      useRelay: false,
      relayChunks: new Map(),
      createdAt: Date.now(),
      relayWindowSize: 10,
      relayUnackedCount: 0,
      relayPendingQueue: []
    });
    
    socket.join(code);
    socket.sessionCode = code;
    socket.role = 'uploader';
    
    console.log(`Session ${code} created by ${socket.id}`);
    callback({ success: true, code });
  });

  socket.on('join-session', (data, callback) => {
    const { code } = data;
    const session = sessions.get(code.toUpperCase());
    
    if (!session) {
      return callback({ success: false, error: 'Session not found' });
    }
    
    if (session.downloader) {
      return callback({ success: false, error: 'Session already has a downloader' });
    }
    
    session.downloader = socket;
    socket.join(code.toUpperCase());
    socket.sessionCode = code.toUpperCase();
    socket.role = 'downloader';
    
    console.log(`Downloader ${socket.id} joined session ${code.toUpperCase()}`);
    
    if (session.uploader) {
      session.uploader.emit('downloader-connected', { 
        downloaderId: socket.id,
        fileName: session.fileName,
        fileSize: session.fileSize,
        fileMd5: session.fileMd5,
        totalChunks: session.totalChunks
      });
    }
    
    callback({
      success: true,
      fileName: session.fileName,
      fileSize: session.fileSize,
      fileMd5: session.fileMd5,
      totalChunks: session.totalChunks,
      uploadedChunks: Array.from(session.uploadedChunks)
    });
  });

  socket.on('webrtc-offer', (data) => {
    const { code, offer } = data;
    const session = sessions.get(code);
    if (session && session.downloader) {
      session.downloader.emit('webrtc-offer', { offer, uploaderId: socket.id });
    }
  });

  socket.on('webrtc-answer', (data) => {
    const { code, answer } = data;
    const session = sessions.get(code);
    if (session && session.uploader) {
      session.uploader.emit('webrtc-answer', { answer, downloaderId: socket.id });
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const { code, candidate, target } = data;
    const session = sessions.get(code);
    if (session) {
      const targetSocket = target === 'downloader' ? session.downloader : session.uploader;
      if (targetSocket) {
        targetSocket.emit('webrtc-ice-candidate', { candidate, from: target === 'downloader' ? 'uploader' : 'downloader' });
      }
    }
  });

  socket.on('probe-relay', (data) => {
    const { code, probeId, sendTime, payload } = data;
    const session = sessions.get(code);
    if (session && session.downloader) {
      session.downloader.emit('probe-relay', {
        probeId,
        sendTime,
        relayTime: Date.now(),
        payload
      });
    }
  });

  socket.on('probe-relay-ack', (data) => {
    const { code, probeId, sendTime, relayTime, payload } = data;
    const session = sessions.get(code);
    if (session && session.uploader) {
      session.uploader.emit('probe-relay-ack', {
        probeId,
        sendTime,
        relayTime,
        ackTime: Date.now(),
        payload
      });
    }
  });

  socket.on('enable-relay', (data) => {
    const { code } = data;
    const session = sessions.get(code);
    if (session) {
      session.useRelay = true;
      console.log(`Session ${code} using relay mode`);
      socket.emit('relay-enabled');
    }
  });

  socket.on('select-channel', (data) => {
    const { code, channel } = data;
    const session = sessions.get(code);
    if (session) {
      session.selectedChannel = channel;
      session.useRelay = (channel === 'relay');
      console.log(`Session ${code} selected channel: ${channel}`);
      if (session.downloader) {
        session.downloader.emit('channel-selected', { channel });
      }
      if (session.uploader) {
        session.uploader.emit('channel-selected', { channel });
      }
    }
  });

  socket.on('relay-chunk', (data) => {
    const { code, chunkIndex, chunkData } = data;
    const session = sessions.get(code);
    if (session && session.useRelay && session.downloader) {
      session.relayChunks.set(chunkIndex, chunkData);
      session.uploadedChunks.add(chunkIndex);
      
      if (session.relayUnackedCount < session.relayWindowSize) {
        session.relayUnackedCount++;
        session.downloader.emit('relay-chunk', { chunkIndex, chunkData });
      } else {
        session.relayPendingQueue.push({ chunkIndex, chunkData });
      }
    }
  });

  socket.on('request-missing-chunks', (data) => {
    const { code, missingChunks } = data;
    const session = sessions.get(code);
    if (session && session.uploader) {
      session.uploader.emit('request-missing-chunks', { missingChunks });
    }
  });

  socket.on('chunk-ack', (data) => {
    const { code, chunkIndex } = data;
    const session = sessions.get(code);
    if (session && session.uploader) {
      session.uploader.emit('chunk-ack', { chunkIndex });
      
      if (session.useRelay) {
        session.relayUnackedCount = Math.max(0, session.relayUnackedCount - 1);
        
        while (session.relayUnackedCount < session.relayWindowSize && 
               session.relayPendingQueue.length > 0) {
          const nextChunk = session.relayPendingQueue.shift();
          session.relayUnackedCount++;
          session.downloader.emit('relay-chunk', nextChunk);
        }
      }
    }
  });

  socket.on('transfer-complete', (data) => {
    const { code } = data;
    const session = sessions.get(code);
    if (session && session.downloader) {
      session.downloader.emit('transfer-complete');
    }
    setTimeout(() => cleanupSession(code), 5000);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const code = socket.sessionCode;
    if (code) {
      const session = sessions.get(code);
      if (session) {
        if (socket.role === 'uploader') {
          if (session.downloader) {
            session.downloader.emit('uploader-disconnected');
          }
          cleanupSession(code);
        } else if (socket.role === 'downloader') {
          session.downloader = null;
          if (session.uploader) {
            session.uploader.emit('downloader-disconnected');
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Uploader: http://localhost:${PORT}/upload.html`);
  console.log(`Downloader: http://localhost:${PORT}/download.html`);
});
