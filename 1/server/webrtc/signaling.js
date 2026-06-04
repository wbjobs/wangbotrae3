const OT = require('../utils/ot');
const Score = require('../models/Score');
const Session = require('../models/Session');

function setupSignalingServer(wss, pool, sessionManager) {
  const peers = new Map();
  
  wss.on('connection', (ws, req) => {
    console.log('WebSocket connection established');
    
    let clientId = null;
    let sessionId = null;
    let userId = null;
    let role = null;
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('Received signaling message:', data.type);
        
        switch (data.type) {
          case 'join':
            await handleJoin(ws, data);
            break;
            
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            handleSignalingMessage(data);
            break;
            
          case 'score-operation':
            await handleScoreOperation(data);
            break;
            
          case 'chat':
            handleChatMessage(data);
            break;
            
          case 'cursor':
            handleCursorUpdate(data);
            break;
            
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Error processing message:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });
    
    ws.on('close', () => {
      handleDisconnect();
    });
    
    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
    
    async function handleJoin(ws, data) {
      const { inviteCode, userId: uid, name, role: userRole } = data;
      
      const session = await Session.findByInviteCode(inviteCode);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid invite code' }));
        return;
      }
      
      userId = uid;
      role = userRole;
      sessionId = session.id;
      clientId = `${sessionId}-${userId}-${Date.now()}`;
      
      peers.set(clientId, { ws, sessionId, userId, role, name });
      
      sessionManager.createSession(sessionId, session.teacher_id);
      
      if (role === 'teacher') {
        sessionManager.setTeacherWebSocket(sessionId, ws);
      } else {
        sessionManager.addStudent(sessionId, userId, ws);
        await Session.addParticipant(sessionId, userId);
      }
      
      const participants = await Session.getParticipants(sessionId);
      const versions = await Score.getVersions(session.score_id);
      
      ws.send(JSON.stringify({
        type: 'joined',
        sessionId,
        score: session.score_musicxml,
        scoreId: session.score_id,
        scoreTitle: session.score_title,
        currentVersion: versions[0]?.version_number || 1,
        participants,
        isTeacher: role === 'teacher',
        iceServers: getIceServers()
      }));
      
      sessionManager.broadcastToAll(sessionId, {
        type: 'participant-joined',
        participant: { id: userId, name, role }
      }, userId);
      
      if (role === 'student') {
        const teacherPeer = [...peers.values()].find(
          p => p.sessionId === sessionId && p.role === 'teacher'
        );
        if (teacherPeer && teacherPeer.ws.readyState === 1) {
          teacherPeer.ws.send(JSON.stringify({
            type: 'new-student',
            studentId: userId,
            studentName: name
          }));
        }
      }
    }
    
    function handleSignalingMessage(data) {
      const { to, from } = data;
      
      const targetPeer = [...peers.values()].find(p => p.userId === to && p.sessionId === sessionId);
      if (targetPeer && targetPeer.ws.readyState === 1) {
        targetPeer.ws.send(JSON.stringify(data));
      }
    }
    
    async function handleScoreOperation(data) {
      const { operation, scoreId, version } = data;
      
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) return;
        
        const latestVersion = await Score.getLatestVersion(scoreId);
        const currentVersion = latestVersion?.version_number || 1;
        
        let transformedOp = operation;
        if (version < currentVersion) {
          const pendingOps = session.pendingOps.filter(op => op.version > version);
          transformedOp = OT.transformOperations(pendingOps.map(p => p.operation), operation);
        }
        
        if (!transformedOp) return;
        
        const score = await Score.findById(scoreId);
        let newMusicxml = score.musicxml;
        
        const MusicXMLUtils = require('../utils/musicxml');
        switch (transformedOp.type) {
          case 'insert':
            newMusicxml = await MusicXMLUtils.addNote(
              newMusicxml,
              transformedOp.measureIndex,
              transformedOp.noteIndex,
              transformedOp.note
            );
            break;
          case 'delete':
            newMusicxml = await MusicXMLUtils.deleteNote(
              newMusicxml,
              transformedOp.measureIndex,
              transformedOp.noteIndex
            );
            break;
          case 'update':
            newMusicxml = await MusicXMLUtils.updateNote(
              newMusicxml,
              transformedOp.measureIndex,
              transformedOp.noteIndex,
              transformedOp.property,
              transformedOp.value
            );
            break;
          case 'metadata':
            if (transformedOp.property === 'timeSignature') {
              newMusicxml = await MusicXMLUtils.updateTimeSignature(
                newMusicxml,
                transformedOp.value.beats,
                transformedOp.value.beatType
              );
            } else if (transformedOp.property === 'keySignature') {
              newMusicxml = await MusicXMLUtils.updateKeySignature(
                newMusicxml,
                transformedOp.value
              );
            }
            break;
        }
        
        const newVersion = currentVersion + 1;
        await Score.update(scoreId, newMusicxml, userId, transformedOp);
        
        session.pendingOps.push({
          version: newVersion,
          operation: transformedOp,
          userId,
          timestamp: Date.now()
        });
        session.scoreVersion = newVersion;
        
        const ackMessage = {
          type: 'score-operation-ack',
          originalVersion: version,
          newVersion,
          operation: transformedOp
        };
        ws.send(JSON.stringify(ackMessage));
        
        const broadcastMessage = {
          type: 'score-operation',
          version: newVersion,
          operation: transformedOp,
          musicxml: newMusicxml,
          userId
        };
        sessionManager.broadcastToAll(sessionId, broadcastMessage, userId);
        
      } catch (err) {
        console.error('Error handling score operation:', err);
        ws.send(JSON.stringify({
          type: 'score-operation-error',
          error: err.message
        }));
      }
    }
    
    function handleChatMessage(data) {
      const { message } = data;
      
      const broadcastMessage = {
        type: 'chat',
        userId,
        name: peers.get(clientId)?.name || 'Anonymous',
        message,
        timestamp: Date.now()
      };
      
      sessionManager.broadcastToAll(sessionId, broadcastMessage);
    }
    
    function handleCursorUpdate(data) {
      const { position } = data;
      
      const broadcastMessage = {
        type: 'cursor',
        userId,
        name: peers.get(clientId)?.name || 'Anonymous',
        position,
        timestamp: Date.now()
      };
      
      sessionManager.broadcastToStudents(sessionId, broadcastMessage, userId);
    }
    
    function handleDisconnect() {
      if (clientId) {
        peers.delete(clientId);
        
        if (sessionId) {
          if (role === 'student') {
            sessionManager.removeStudent(sessionId, userId);
            Session.removeParticipant(sessionId, userId);
          }
          
          sessionManager.broadcastToAll(sessionId, {
            type: 'participant-left',
            userId
          });
          
          const remainingPeers = [...peers.values()].filter(p => p.sessionId === sessionId);
          if (remainingPeers.length === 0) {
            sessionManager.removeSession(sessionId);
          }
        }
      }
      
      console.log('WebSocket disconnected:', clientId);
    }
  });
  
  function getIceServers() {
    const servers = [];
    
    if (process.env.STUN_SERVER) {
      servers.push({ urls: process.env.STUN_SERVER });
    } else {
      servers.push({ urls: 'stun:stun.l.google.com:19302' });
    }
    
    if (process.env.TURN_SERVER && process.env.TURN_USER && process.env.TURN_CREDENTIAL) {
      servers.push({
        urls: process.env.TURN_SERVER,
        username: process.env.TURN_USER,
        credential: process.env.TURN_CREDENTIAL
      });
    }
    
    return servers;
  }
  
  console.log('Signaling server ready');
  return wss;
}

module.exports = setupSignalingServer;
