const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { LWWRegister } = require('./crdt');
const { GraphStore } = require('./graphStore');
const { HeatStats } = require('./heatStats');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());

const crdt = new LWWRegister();
const graphStore = new GraphStore(crdt);
const heatStats = new HeatStats();

const clients = new Map();
const userRoles = new Map();
const userCursors = new Map();
const userNames = new Map();

const opLog = [];

function broadcast(message, excludeId) {
  const data = JSON.stringify(message);
  for (const [clientId, ws] of clients) {
    if (clientId !== excludeId && ws.readyState === 1) {
      ws.send(data);
    }
  }
}

function sendTo(clientId, message) {
  const ws = clients.get(clientId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function handleJoin(ws, clientId, msg) {
  const userId = msg.userId || uuidv4();
  const userName = msg.userName || 'Anonymous';
  const role = msg.role || 'visitor';

  clients.set(clientId, ws);
  userRoles.set(clientId, role);
  userNames.set(clientId, userName);

  sendTo(clientId, {
    type: 'sync',
    graph: crdt.getFullGraph(),
    crdtState: crdt.exportState(),
    cursors: Object.fromEntries(userCursors),
    userNames: Object.fromEntries(userNames),
    userRoles: Object.fromEntries(userRoles),
    heatStats: heatStats.getStats(),
    userId,
    clientId,
    history: graphStore.getHistory(),
    opLog: opLog.slice(-50),
  });

  broadcast(
    {
      type: 'user-joined',
      userId: clientId,
      userName,
      role,
    },
    clientId
  );
}

function handleOperation(clientId, msg) {
  const role = userRoles.get(clientId);
  if (role !== 'editor') {
    sendTo(clientId, { type: 'error', message: 'Only editors can modify the graph' });
    return;
  }

  const now = Date.now();
  const op = {
    ...msg.op,
    timestamp: now,
    userId: clientId,
  };

  const applied = crdt.applyOperation(op);

  opLog.push(op);
  if (opLog.length > 200) opLog.shift();

  if (applied) {
    const desc = `${op.type}: ${op.payload.id || ''}`;
    graphStore.recordVersion(desc);
  }

  broadcast({ type: 'op', op });
}

function handleCursor(clientId, msg) {
  userCursors.set(clientId, { x: msg.x, y: msg.y });
  broadcast(
    {
      type: 'cursor',
      userId: clientId,
      userName: userNames.get(clientId),
      x: msg.x,
      y: msg.y,
    },
    clientId
  );
}

function handlePlayPath(clientId, msg) {
  heatStats.recordPath(msg.path, clientId, msg.sessionId);
  broadcast({ type: 'heat-update', heatStats: heatStats.getStats() });
}

function handleRoleChange(clientId, msg) {
  if (userRoles.get(clientId) === 'editor') {
    const targetId = msg.targetUserId;
    const newRole = msg.role;
    if (userRoles.has(targetId)) {
      userRoles.set(targetId, newRole);
      broadcast({
        type: 'role-change',
        userId: targetId,
        role: newRole,
      });
    }
  }
}

wss.on('connection', (ws) => {
  const clientId = uuidv4();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'join':
          handleJoin(ws, clientId, msg);
          break;
        case 'op':
          handleOperation(clientId, msg);
          break;
        case 'cursor':
          handleCursor(clientId, msg);
          break;
        case 'play-path':
          handlePlayPath(clientId, msg);
          break;
        case 'role-change':
          handleRoleChange(clientId, msg);
          break;
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    userRoles.delete(clientId);
    userCursors.delete(clientId);
    userNames.delete(clientId);
    broadcast({ type: 'user-left', userId: clientId });
  });
});

app.get('/api/graph', (req, res) => {
  res.json(crdt.getFullGraph());
});

app.get('/api/graph/history', (req, res) => {
  res.json(graphStore.getHistory());
});

app.get('/api/graph/version/:id', (req, res) => {
  const version = graphStore.getVersion(parseInt(req.params.id));
  if (version) {
    res.json(version);
  } else {
    res.status(404).json({ error: 'Version not found' });
  }
});

app.get('/api/heat-stats', (req, res) => {
  res.json(heatStats.getStats());
});

app.post('/api/heat-stats/reset', (req, res) => {
  heatStats.reset();
  broadcast({ type: 'heat-update', heatStats: heatStats.getStats() });
  res.json({ ok: true });
});

app.get('/api/users', (req, res) => {
  const users = [];
  for (const [id] of clients) {
    users.push({
      id,
      name: userNames.get(id),
      role: userRoles.get(id),
    });
  }
  res.json(users);
});

app.get('/api/history/snapshot', (req, res) => {
  const timestamp = parseInt(req.query.timestamp) || Date.now();

  const tempCrdt = new LWWRegister();
  const opsToApply = opLog.filter((op) => op.timestamp <= timestamp);

  for (const op of opsToApply) {
    tempCrdt.applyOperation(op);
  }

  res.json({
    timestamp,
    opCount: opsToApply.length,
    graph: tempCrdt.getFullGraph(),
  });
});

app.get('/api/history/range', (req, res) => {
  const startTime = parseInt(req.query.start) || 0;
  const endTime = parseInt(req.query.end) || Date.now();

  const ops = opLog.filter(
    (op) => op.timestamp >= startTime && op.timestamp <= endTime
  );

  const replaySteps = [];
  let prevNodes = {};
  let prevEdges = {};
  const tempCrdt = new LWWRegister();

  for (const op of ops) {
    tempCrdt.applyOperation(op);
    const newGraph = tempCrdt.getFullGraph();
    const newNodes = newGraph.nodes;
    const newEdges = newGraph.edges;

    const addedNodes = [];
    const removedNodes = [];
    const updatedNodes = [];
    const addedEdges = [];
    const removedEdges = [];
    const updatedEdges = [];

    for (const [id, node] of Object.entries(newNodes)) {
      if (!prevNodes[id]) {
        addedNodes.push(id);
      } else if (JSON.stringify(node) !== JSON.stringify(prevNodes[id])) {
        updatedNodes.push(id);
      }
    }
    for (const id of Object.keys(prevNodes)) {
      if (!newNodes[id]) {
        removedNodes.push(id);
      }
    }

    for (const [id, edge] of Object.entries(newEdges)) {
      if (!prevEdges[id]) {
        addedEdges.push(id);
      } else if (JSON.stringify(edge) !== JSON.stringify(prevEdges[id])) {
        updatedEdges.push(id);
      }
    }
    for (const id of Object.keys(prevEdges)) {
      if (!newEdges[id]) {
        removedEdges.push(id);
      }
    }

    if (
      addedNodes.length ||
      removedNodes.length ||
      updatedNodes.length ||
      addedEdges.length ||
      removedEdges.length ||
      updatedEdges.length
    ) {
      replaySteps.push({
        op,
        graph: { nodes: newNodes, edges: newEdges },
        diff: {
          addedNodes,
          removedNodes,
          updatedNodes,
          addedEdges,
          removedEdges,
          updatedEdges,
        },
      });
    }

    prevNodes = { ...newNodes };
    prevEdges = { ...newEdges };
  }

  res.json({
    startTime,
    endTime,
    totalOps: ops.length,
    steps: replaySteps,
    earliest: opLog.length > 0 ? opLog[0].timestamp : Date.now(),
    latest: opLog.length > 0 ? opLog[opLog.length - 1].timestamp : Date.now(),
  });
});

const PORT = process.env.PORT || 4000;

const startNodeId = uuidv4();
const choiceAId = uuidv4();
const choiceBId = uuidv4();
const edgeAId = uuidv4();
const edgeBId = uuidv4();
const now = Date.now();

function initOp(op) {
  crdt.applyOperation(op);
  opLog.push(op);
}

initOp({
  type: 'addNode',
  payload: {
    id: startNodeId,
    x: 400,
    y: 100,
    width: 220,
    height: 80,
    title: '故事开始',
    content: '你站在一个岔路口，左边是幽暗的森林，右边是闪光的城堡。',
    isStart: true,
  },
  timestamp: now,
  userId: 'system',
});

initOp({
  type: 'addNode',
  payload: {
    id: choiceAId,
    x: 200,
    y: 280,
    width: 220,
    height: 80,
    title: '幽暗森林',
    content: '你走进了森林，树木遮天蔽日，远处传来奇怪的声响...',
    isStart: false,
  },
  timestamp: now + 1,
  userId: 'system',
});

initOp({
  type: 'addNode',
  payload: {
    id: choiceBId,
    x: 600,
    y: 280,
    width: 220,
    height: 80,
    title: '闪光城堡',
    content: '城堡的大门缓缓打开，金色的光芒从内部涌出...',
    isStart: false,
  },
  timestamp: now + 2,
  userId: 'system',
});

initOp({
  type: 'addEdge',
  payload: {
    id: edgeAId,
    from: startNodeId,
    to: choiceAId,
    label: '进入森林',
  },
  timestamp: now + 3,
  userId: 'system',
});

initOp({
  type: 'addEdge',
  payload: {
    id: edgeBId,
    from: startNodeId,
    to: choiceBId,
    label: '走向城堡',
  },
  timestamp: now + 4,
  userId: 'system',
});

graphStore.recordVersion('Initial story graph');

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
