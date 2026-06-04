require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const pool = require('./config/db');
const setupMqttBroker = require('./mqtt/broker');
const setupSignalingServer = require('./webrtc/signaling');
const setupApiRoutes = require('./routes');
const sessionManager = require('./utils/sessionManager');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

setupApiRoutes(app, pool);

const wss = new WebSocket.Server({ server });
setupSignalingServer(wss, pool, sessionManager);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  
  try {
    setupMqttBroker(pool, sessionManager);
    console.log(`MQTT: mqtt://localhost:${process.env.MQTT_PORT || 1883}`);
    console.log(`MQTT (WS): ws://localhost:${process.env.MQTT_WS_PORT || 9001}`);
  } catch (err) {
    console.error('Failed to start MQTT broker:', err.message);
    console.warn('MQTT features will be disabled, using WebSocket fallback');
  }
});
