const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const roomRoutes = require('./routes/rooms');
const audioRoutes = require('./routes/audio');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/rooms', roomRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/sync', syncRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '文件过大' });
  }
  
  if (err.message.includes('只支持音频文件')) {
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ error: '服务器内部错误' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.listen(PORT, () => {
  console.log(`多端音轨同步校对系统 - 后端服务已启动`);
  console.log(`端口: ${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
});

module.exports = app;
