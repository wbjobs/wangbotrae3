import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  drawNode,
  drawEdge,
  drawCursor,
  drawGrid,
  hitTestNode,
  hitTestNodePort,
} from '../utils/canvas';

const CURSOR_COLORS_MAP = {};

function getColorForUser(userId) {
  if (CURSOR_COLORS_MAP[userId]) return CURSOR_COLORS_MAP[userId];
  const colors = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
    '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffff;
  }
  const color = colors[Math.abs(hash) % colors.length];
  CURSOR_COLORS_MAP[userId] = color;
  return color;
}

export default function GraphCanvas({
  nodes,
  edges,
  cursors,
  userNames,
  heatStats,
  isEditor,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onDeselect,
  onMoveNode,
  onAddEdge,
  onDeleteNode,
  onDeleteEdge,
  sendCursor,
  clientId,
  highlightPath,
  isViewingHistory = false,
  highlightDiff = null,
}) {
  const canvasRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [tempLine, setTempLine] = useState(null);
  const [panStart, setPanStart] = useState(null);
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 });

  const screenToWorld = useCallback(
    (sx, sy) => ({
      x: (sx - pan.x) / zoom,
      y: (sy - pan.y) / zoom,
    }),
    [pan, zoom]
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = isViewingHistory ? '#0a0d14' : '#0d1117';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    drawGrid(ctx, width / zoom, height / zoom, -pan.x / zoom, -pan.y / zoom);

    const maxNV = heatStats.maxNodeVisits || 1;
    const maxES = heatStats.maxEdgeSelections || 1;

    const pathSet = new Set();
    const pathEdgeSet = new Set();
    if (highlightPath) {
      for (const nid of highlightPath) pathSet.add(nid);
      for (let i = 0; i < highlightPath.length - 1; i++) {
        pathEdgeSet.add(`${highlightPath[i]}->${highlightPath[i + 1]}`);
      }
    }

    const addedNodes = new Set(highlightDiff?.addedNodes || []);
    const removedNodes = new Set(highlightDiff?.removedNodes || []);
    const updatedNodes = new Set(highlightDiff?.updatedNodes || []);
    const addedEdges = new Set(highlightDiff?.addedEdges || []);
    const removedEdges = new Set(highlightDiff?.removedEdges || []);
    const updatedEdges = new Set(highlightDiff?.updatedEdges || []);

    Object.values(edges).forEach((edge) => {
      const edgeKey = `${edge.from}->${edge.to}`;
      const heatLevel = heatStats.edgeSelections?.[edgeKey]
        ? heatStats.edgeSelections[edgeKey] / maxES
        : 0;
      let highlightType = null;
      if (addedEdges.has(edge.id)) highlightType = 'added';
      else if (removedEdges.has(edge.id)) highlightType = 'removed';
      else if (updatedEdges.has(edge.id)) highlightType = 'updated';
      drawEdge(ctx, edge, nodes, {
        selected: edge.id === selectedEdgeId,
        heatLevel,
        isPath: pathEdgeSet.has(edgeKey),
        highlightType,
      });
    });

    if (connecting && tempLine && !isViewingHistory) {
      ctx.save();
      ctx.strokeStyle = '#6c5ce7';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(connecting.portX, connecting.portY);
      ctx.lineTo(tempLine.x, tempLine.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    Object.values(nodes).forEach((node) => {
      const heatLevel = heatStats.nodeVisits?.[node.id]
        ? heatStats.nodeVisits[node.id] / maxNV
        : 0;
      let highlightType = null;
      if (addedNodes.has(node.id)) highlightType = 'added';
      else if (removedNodes.has(node.id)) highlightType = 'removed';
      else if (updatedNodes.has(node.id)) highlightType = 'updated';
      drawNode(ctx, node, {
        selected: node.id === selectedNodeId,
        heatLevel,
        isStart: node.isStart,
        highlightType,
      });
    });

    if (!isViewingHistory) {
      Object.entries(cursors).forEach(([userId, cursor]) => {
        if (userId === clientId) return;
        drawCursor(ctx, cursor, userNames[userId], getColorForUser(userId));
      });
    }

    ctx.restore();

    if (isViewingHistory) {
      ctx.fillStyle = 'rgba(108, 92, 231, 0.1)';
      ctx.fillRect(0, 0, width, 36);
      ctx.fillStyle = '#a29bfe';
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('⏱️ 历史查看模式 - 正在查看过去某个时刻的图谱状态', 16, 24);
    }
  }, [
    nodes,
    edges,
    cursors,
    userNames,
    pan,
    zoom,
    heatStats,
    selectedNodeId,
    selectedEdgeId,
    connecting,
    tempLine,
    clientId,
    highlightPath,
    isViewingHistory,
    highlightDiff,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      render();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [render]);

  useEffect(() => {
    render();
  }, [render]);

  const handleMouseDown = useCallback(
    (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);

      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        return;
      }

      if (isViewingHistory) {
        return;
      }

      if (e.button === 0) {
        const port = hitTestNodePort(nodes, world.x, world.y, 12);
        if (port && isEditor) {
          setConnecting(port);
          setTempLine(world);
          return;
        }

        const node = hitTestNode(nodes, world.x, world.y);
        if (node) {
          onSelectNode(node.id);
          if (isEditor) {
            setDragging({ nodeId: node.id, offsetX: world.x - node.x, offsetY: world.y - node.y });
          }
        } else {
          let hitEdge = null;
          for (const edge of Object.values(edges)) {
            const fromNode = nodes[edge.from];
            const toNode = nodes[edge.to];
            if (!fromNode || !toNode) continue;
            const midX = (fromNode.x + (fromNode.width || 220) / 2 + toNode.x + (toNode.width || 220) / 2) / 2;
            const midY = (fromNode.y + (fromNode.height || 80) / 2 + toNode.y + (toNode.height || 80) / 2) / 2;
            const dist = Math.sqrt((world.x - midX) ** 2 + (world.y - midY) ** 2);
            if (dist < 25) {
              hitEdge = edge;
              break;
            }
          }
          if (hitEdge) {
            onSelectEdge(hitEdge.id);
          } else {
            onDeselect();
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
          }
        }
      }
    },
    [nodes, edges, pan, zoom, screenToWorld, isEditor, onSelectNode, onSelectEdge, onDeselect]
  );

  const handleMouseMove = useCallback(
    (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      setMouseWorld(world);

      if (sendCursor) {
        sendCursor(world.x, world.y);
      }

      if (panStart) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
        return;
      }

      if (dragging) {
        onMoveNode(dragging.nodeId, {
          x: world.x - dragging.offsetX,
          y: world.y - dragging.offsetY,
        });
      }

      if (connecting) {
        setTempLine(world);
      }
    },
    [panStart, dragging, connecting, screenToWorld, sendCursor, onMoveNode]
  );

  const handleMouseUp = useCallback(
    (e) => {
      if (connecting) {
        const rect = canvasRef.current.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(sx, sy);
        const targetNode = hitTestNode(nodes, world.x, world.y);
        if (targetNode && targetNode.id !== connecting.node.id) {
          onAddEdge({
            from: connecting.node.id,
            to: targetNode.id,
            label: '选项',
          });
        }
        setConnecting(null);
        setTempLine(null);
      }
      setDragging(null);
      setPanStart(null);
    },
    [connecting, nodes, screenToWorld, onAddEdge]
  );

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.max(0.2, Math.min(3, prev * delta)));
  }, []);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId && isEditor) {
          onDeleteNode(selectedNodeId);
        } else if (selectedEdgeId && isEditor) {
          onDeleteEdge(selectedEdgeId);
        }
      }
    },
    [selectedNodeId, selectedEdgeId, isEditor, onDeleteNode, onDeleteEdge]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
