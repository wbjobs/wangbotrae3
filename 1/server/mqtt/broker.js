const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const websocket = require('websocket-stream');
const mqtt = require('mqtt');
const MidiEvent = require('../models/MidiEvent');
const Session = require('../models/Session');

function setupMqttBroker(pool, sessionManager) {
  const MQTT_PORT = process.env.MQTT_PORT || 1883;
  const MQTT_WS_PORT = process.env.MQTT_WS_PORT || 9001;
  
  const clients = new Map();
  const clientSessions = new Map();

  aedes.authenticate = function(client, username, password, callback) {
    try {
      const credentials = JSON.parse(password.toString());
      const { sessionId, userId, role } = credentials;
      
      if (sessionId === 'internal' && userId === 'system') {
        client.sessionId = sessionId;
        client.userId = userId;
        client.role = role;
        clients.set(client.id, client);
        return callback(null, true);
      }
      
      Session.findById(sessionId).then(session => {
        if (!session || session.status !== 'active') {
          callback(new Error('Invalid or inactive session'), false);
          return;
        }
        
        client.sessionId = sessionId;
        client.userId = userId;
        client.role = role;
        
        clients.set(client.id, client);
        clientSessions.set(client.id, sessionId);
        
        callback(null, true);
      }).catch(err => {
        callback(err, false);
      });
    } catch (err) {
      callback(new Error('Invalid credentials'), false);
    }
  };

  aedes.authorizePublish = function(client, packet, callback) {
    const topic = packet.topic;
    
    if (!client.sessionId) {
      callback(new Error('Not authenticated'));
      return;
    }
    
    if (client.userId === 'system') {
      return callback(null);
    }
    
    const allowedTopics = [
      `session/${client.sessionId}/midi`,
      `session/${client.sessionId}/sync`,
      `session/${client.sessionId}/chat`
    ];
    
    if (allowedTopics.includes(topic)) {
      callback(null);
    } else {
      callback(new Error('Not authorized to publish to this topic'));
    }
  };

  aedes.authorizeSubscribe = function(client, sub, callback) {
    const topic = sub.topic;
    
    if (!client.sessionId) {
      callback(new Error('Not authenticated'));
      return;
    }
    
    if (client.userId === 'system') {
      return callback(null, sub);
    }
    
    const allowedTopics = [
      `session/${client.sessionId}/midi`,
      `session/${client.sessionId}/sync`,
      `session/${client.sessionId}/chat`,
      `session/${client.sessionId}/control`
    ];
    
    if (allowedTopics.includes(topic)) {
      callback(null, sub);
    } else {
      callback(new Error('Not authorized to subscribe to this topic'));
    }
  };

  aedes.on('client', (client) => {
    console.log(`MQTT client connected: ${client.id}`);
  });

  aedes.on('clientDisconnect', (client) => {
    console.log(`MQTT client disconnected: ${client.id}`);
    clients.delete(client.id);
    clientSessions.delete(client.id);
  });

  aedes.on('publish', async (packet, client) => {
    if (!client || !client.sessionId) return;
    
    try {
      const topicParts = packet.topic.split('/');
      const sessionId = topicParts[1];
      const messageType = topicParts[2];
      
      if (messageType === 'midi') {
        const midiData = JSON.parse(packet.payload.toString());
        
        const serverTimestamp = Date.now();
        const sessionStartTime = sessionManager.getStartTime(sessionId);
        
        let alignedTimestamp = midiData.timestamp;
        if (sessionStartTime) {
          alignedTimestamp = serverTimestamp - sessionStartTime + (midiData.timestamp - midiData.clientStartTime);
        }
        
        const alignedEvent = {
          ...midiData,
          userId: client.userId,
          timestamp: alignedTimestamp,
          serverTimestamp
        };
        
        await MidiEvent.create(
          sessionId,
          client.userId,
          midiData.type,
          midiData.note,
          midiData.velocity,
          alignedTimestamp,
          serverTimestamp
        );
        
        const broadcastPayload = JSON.stringify(alignedEvent);
        aedes.publish({
          topic: `session/${sessionId}/midi`,
          payload: broadcastPayload,
          qos: 0,
          retain: false
        });
      }
      
      if (messageType === 'sync') {
        const syncData = JSON.parse(packet.payload.toString());
        
        if (syncData.type === 'start' && client.role === 'teacher') {
          const startTime = sessionManager.setStartTime(sessionId);
          const startMessage = {
            type: 'start',
            serverTime: startTime,
            bpm: syncData.bpm || 120
          };
          
          aedes.publish({
            topic: `session/${sessionId}/control`,
            payload: JSON.stringify(startMessage),
            qos: 1,
            retain: false
          });
        }
      }
      
    } catch (err) {
      console.error('Error processing MQTT message:', err);
    }
  });

  const server = net.createServer(aedes.handle);
  
  server.listen(MQTT_PORT, () => {
    console.log(`MQTT broker (TCP) running on port ${MQTT_PORT}`);
  });

  server.on('error', (err) => {
    console.error('MQTT broker error:', err);
  });

  const httpServer = http.createServer();
  websocket.createServer({ server: httpServer }, aedes.handle);
  
  httpServer.listen(MQTT_WS_PORT, () => {
    console.log(`MQTT broker (WebSocket) running on port ${MQTT_WS_PORT}`);
  });

  httpServer.on('error', (err) => {
    console.error('MQTT WebSocket server error:', err);
  });

  setTimeout(() => {
    try {
      const internalClient = mqtt.connect(`mqtt://localhost:${MQTT_PORT}`, {
        password: JSON.stringify({ sessionId: 'internal', userId: 'system', role: 'system' }),
        reconnectPeriod: 1000,
        connectTimeout: 5000
      });
      
      internalClient.on('connect', () => {
        console.log('Internal MQTT client connected');
      });
      
      internalClient.on('error', (err) => {
        console.warn('Internal MQTT client warning:', err.message);
      });
    } catch (err) {
      console.warn('Could not create internal MQTT client:', err.message);
    }
  }, 2000);

  return { aedes, server, httpServer };
}

module.exports = setupMqttBroker;
