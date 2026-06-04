import { useRef, useEffect, useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${PROTOCOL}//${window.location.hostname}:4000/ws`;

class ClientCRDT {
  constructor() {
    this.state = {};
  }

  importState(state) {
    this.state = { ...state };
  }

  exportState() {
    return { ...this.state };
  }

  applyOp(op) {
    const key = op.type.includes('Node')
      ? `node:${op.payload.id}`
      : `edge:${op.payload.id}`;

    const isDelete = op.type.startsWith('delete');
    const existing = this.state[key];

    if (existing && op.timestamp < existing.timestamp) {
      return false;
    }

    this.state[key] = {
      value: isDelete ? null : op.payload,
      timestamp: op.timestamp,
      userId: op.userId,
      deleted: isDelete,
    };

    return true;
  }

  getNodes() {
    const nodes = {};
    for (const [key, entry] of Object.entries(this.state)) {
      if (key.startsWith('node:') && !entry.deleted) {
        nodes[entry.value.id] = entry.value;
      }
    }
    return nodes;
  }

  getEdges() {
    const edges = {};
    for (const [key, entry] of Object.entries(this.state)) {
      if (key.startsWith('edge:') && !entry.deleted) {
        edges[entry.value.id] = entry.value;
      }
    }
    return edges;
  }

  isEdgeDeleted(edgeId) {
    const entry = this.state[`edge:${edgeId}`];
    return entry?.deleted || false;
  }

  isNodeDeleted(nodeId) {
    const entry = this.state[`node:${nodeId}`];
    return entry?.deleted || false;
  }
}

function getOrCreateSessionId() {
  let sid = localStorage.getItem('story_graph_session_id');
  if (!sid) {
    sid = uuidv4();
    localStorage.setItem('story_graph_session_id', sid);
  }
  return sid;
}

export function useCollab(userName, role) {
  const wsRef = useRef(null);
  const crdtRef = useRef(new ClientCRDT());
  const sessionIdRef = useRef(getOrCreateSessionId());
  const [connected, setConnected] = useState(false);
  const [nodes, setNodes] = useState({});
  const [edges, setEdges] = useState({});
  const [cursors, setCursors] = useState({});
  const [userNames, setUserNames] = useState({});
  const [userRoles, setUserRoles] = useState({});
  const [heatStats, setHeatStats] = useState({
    nodeVisits: {},
    edgeSelections: {},
    maxNodeVisits: 0,
    maxEdgeSelections: 0,
    totalPaths: 0,
  });
  const [history, setHistory] = useState([]);
  const [clientId, setClientId] = useState(null);
  const [users, setUsers] = useState({});
  const userIdRef = useRef(uuidv4());

  const refreshGraph = useCallback(() => {
    setNodes(crdtRef.current.getNodes());
    setEdges(crdtRef.current.getEdges());
  }, []);

  const applyOp = useCallback(
    (op) => {
      const applied = crdtRef.current.applyOp(op);
      if (applied) {
        refreshGraph();
      }
      return applied;
    },
    [refreshGraph]
  );

  useEffect(() => {
    if (!userName) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          userId: userIdRef.current,
          userName,
          role,
        })
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'sync':
          if (msg.crdtState) {
            crdtRef.current.importState(msg.crdtState);
            refreshGraph();
          }
          setCursors(msg.cursors || {});
          setUserNames(msg.userNames || {});
          setUserRoles(msg.userRoles || {});
          setHeatStats(msg.heatStats || heatStats);
          setClientId(msg.clientId);
          setConnected(true);
          setHistory(msg.history || []);
          if (msg.userRoles) {
            setUsers(
              Object.fromEntries(
                Object.entries(msg.userRoles).map(([id, r]) => [
                  id,
                  { name: msg.userNames?.[id] || 'Unknown', role: r },
                ])
              )
            );
          }
          break;
        case 'op':
          applyOp(msg.op);
          break;
        case 'cursor':
          setCursors((prev) => ({
            ...prev,
            [msg.userId]: { x: msg.x, y: msg.y },
          }));
          setUserNames((prev) => ({ ...prev, [msg.userId]: msg.userName }));
          break;
        case 'user-joined':
          setUserNames((prev) => ({ ...prev, [msg.userId]: msg.userName }));
          setUserRoles((prev) => ({ ...prev, [msg.userId]: msg.role }));
          setUsers((prev) => ({
            ...prev,
            [msg.userId]: { name: msg.userName, role: msg.role },
          }));
          break;
        case 'user-left': {
          const leftId = msg.userId;
          setCursors((prev) => {
            const next = { ...prev };
            delete next[leftId];
            return next;
          });
          setUserNames((prev) => {
            const next = { ...prev };
            delete next[leftId];
            return next;
          });
          setUserRoles((prev) => {
            const next = { ...prev };
            delete next[leftId];
            return next;
          });
          setUsers((prev) => {
            const next = { ...prev };
            delete next[leftId];
            return next;
          });
          break;
        }
        case 'heat-update':
          setHeatStats(msg.heatStats);
          break;
        case 'role-change':
          setUserRoles((prev) => ({ ...prev, [msg.userId]: msg.role }));
          setUsers((prev) => ({
            ...prev,
            [msg.userId]: { ...(prev[msg.userId] || {}), role: msg.role },
          }));
          break;
        case 'error':
          console.error('Server error:', msg.message);
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [userName, role, applyOp]);

  const sendOp = useCallback(
    (op) => {
      if (!wsRef.current || wsRef.current.readyState !== 1) return;
      const fullOp = { ...op, timestamp: Date.now(), userId: clientId };
      wsRef.current.send(JSON.stringify({ type: 'op', op: fullOp }));
      applyOp(fullOp);
    },
    [clientId, applyOp]
  );

  const sendCursor = useCallback(
    (x, y) => {
      if (!wsRef.current || wsRef.current.readyState !== 1) return;
      wsRef.current.send(JSON.stringify({ type: 'cursor', x, y }));
    },
    []
  );

  const sendPlayPath = useCallback((path) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    wsRef.current.send(
      JSON.stringify({
        type: 'play-path',
        path,
        sessionId: sessionIdRef.current,
      })
    );
  }, []);

  const changeRole = useCallback(
    (targetUserId, newRole) => {
      if (!wsRef.current || wsRef.current.readyState !== 1) return;
      wsRef.current.send(
        JSON.stringify({ type: 'role-change', targetUserId, role: newRole })
      );
    },
    []
  );

  const addNode = useCallback(
    (nodeData) => {
      sendOp({
        type: 'addNode',
        payload: { ...nodeData, id: uuidv4() },
      });
    },
    [sendOp]
  );

  const updateNode = useCallback(
    (nodeData) => {
      sendOp({ type: 'updateNode', payload: nodeData });
    },
    [sendOp]
  );

  const deleteNode = useCallback(
    (nodeId) => {
      sendOp({ type: 'deleteNode', payload: { id: nodeId } });
      Object.values(edges).forEach((edge) => {
        if (edge.from === nodeId || edge.to === nodeId) {
          sendOp({ type: 'deleteEdge', payload: { id: edge.id } });
        }
      });
    },
    [sendOp, edges]
  );

  const addEdge = useCallback(
    (edgeData) => {
      sendOp({
        type: 'addEdge',
        payload: { ...edgeData, id: uuidv4() },
      });
    },
    [sendOp]
  );

  const updateEdge = useCallback(
    (edgeData) => {
      sendOp({ type: 'updateEdge', payload: edgeData });
    },
    [sendOp]
  );

  const deleteEdge = useCallback(
    (edgeId) => {
      sendOp({ type: 'deleteEdge', payload: { id: edgeId } });
    },
    [sendOp]
  );

  return {
    connected,
    clientId,
    nodes,
    edges,
    cursors,
    userNames,
    userRoles,
    heatStats,
    history,
    users,
    addNode,
    updateNode,
    deleteNode,
    addEdge,
    updateEdge,
    deleteEdge,
    sendCursor,
    sendPlayPath,
    changeRole,
    isEditor: role === 'editor',
  };
}
