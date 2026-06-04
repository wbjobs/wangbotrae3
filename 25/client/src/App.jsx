import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import LoginScreen from './components/LoginScreen';
import GraphCanvas from './components/GraphCanvas';
import Toolbar from './components/Toolbar';
import PlayMode from './components/PlayMode';
import NodeEditor from './components/NodeEditor';
import EdgeEditor from './components/EdgeEditor';
import Timeline from './components/Timeline';
import { useCollab } from './hooks/useCollab';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('edit');
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [showHeatMap, setShowHeatMap] = useState(true);
  const [playPath, setPlayPath] = useState(null);
  const [isViewingHistory, setIsViewingHistory] = useState(false);
  const [isPlayingReplay, setIsPlayingReplay] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState(null);
  const [highlightDiff, setHighlightDiff] = useState(null);
  const [replaySteps, setReplaySteps] = useState([]);
  const [historyTimeRange, setHistoryTimeRange] = useState({ earliest: Date.now(), latest: Date.now() });

  const collab = useCollab(user?.name || '', user?.role || 'visitor');
  const replayTimerRef = useRef(null);

  const handleLogin = useCallback((name, role, color) => {
    setUser({ name, role, color });
  }, []);

  const handleMoveNode = useCallback(
    (nodeId, pos) => {
      const node = collab.nodes[nodeId];
      if (node) {
        collab.updateNode({ ...node, x: pos.x, y: pos.y });
      }
    },
    [collab]
  );

  const handleDeleteNode = useCallback(
    (nodeId) => {
      collab.deleteNode(nodeId);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [collab, selectedNodeId]
  );

  const handleDeleteEdge = useCallback(
    (edgeId) => {
      collab.deleteEdge(edgeId);
      if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    },
    [collab, selectedEdgeId]
  );

  const handlePlayComplete = useCallback(
    (path) => {
      collab.sendPlayPath(path);
      setPlayPath(path);
    },
    [collab]
  );

  const selectedNode = useMemo(
    () => (selectedNodeId ? collab.nodes[selectedNodeId] : null),
    [selectedNodeId, collab.nodes]
  );

  const selectedEdge = useMemo(
    () => (selectedEdgeId ? collab.edges[selectedEdgeId] : null),
    [selectedEdgeId, collab.edges]
  );

  const effectiveHeatStats = showHeatMap ? collab.heatStats : {
    nodeVisits: {},
    edgeSelections: {},
    maxNodeVisits: 0,
    maxEdgeSelections: 0,
    totalPaths: 0,
  };

  const displayNodes = isViewingHistory && historySnapshot ? historySnapshot.nodes : collab.nodes;
  const displayEdges = isViewingHistory && historySnapshot ? historySnapshot.edges : collab.edges;

  const loadHistorySnapshot = useCallback(async (timestamp) => {
    try {
      const res = await fetch(`/api/history/snapshot?timestamp=${timestamp}`);
      const data = await res.json();
      setHistorySnapshot(data.graph);
      setHighlightDiff(null);
    } catch (e) {
      console.error('Failed to load history snapshot:', e);
    }
  }, []);

  const loadReplaySteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/history/range?start=0&end=${Date.now()}`);
      const data = await res.json();
      setReplaySteps(data.steps || []);
      setHistoryTimeRange({ earliest: data.earliest, latest: data.latest });
    } catch (e) {
      console.error('Failed to load replay steps:', e);
    }
  }, []);

  const handleSeek = useCallback(
    (timestamp) => {
      loadHistorySnapshot(timestamp);
      setIsPlayingReplay(false);
    },
    [loadHistorySnapshot]
  );

  const handlePlay = useCallback(async () => {
    setIsPlayingReplay(true);
    setHighlightDiff(null);
    setHistorySnapshot({ nodes: {}, edges: {} });

    let stepIndex = 0;
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
    }

    replayTimerRef.current = setInterval(() => {
      setReplaySteps((steps) => {
        if (stepIndex >= steps.length) {
          clearInterval(replayTimerRef.current);
          setIsPlayingReplay(false);
          return steps;
        }
        const step = steps[stepIndex];
        setHistorySnapshot(step.graph);
        setHighlightDiff(step.diff);
        stepIndex++;
        return steps;
      });
    }, 800);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlayingReplay(false);
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
    }
  }, []);

  const handleStopHistory = useCallback(() => {
    setIsViewingHistory(false);
    setIsPlayingReplay(false);
    setHistorySnapshot(null);
    setHighlightDiff(null);
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
    }
  }, []);

  const handleStartHistory = useCallback(async () => {
    setIsViewingHistory(true);
    await loadReplaySteps();
    await loadHistorySnapshot(Date.now());
  }, [loadReplaySteps, loadHistorySnapshot]);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current) {
        clearInterval(replayTimerRef.current);
      }
    };
  }, []);

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <Toolbar
        isEditor={collab.isEditor}
        mode={mode}
        onModeChange={setMode}
        onAddNode={collab.addNode}
        showHeatMap={showHeatMap}
        onToggleHeatMap={() => setShowHeatMap(!showHeatMap)}
        history={collab.history}
        connected={collab.connected}
        clientId={collab.clientId}
        userRoles={collab.userRoles}
        users={collab.users}
        userName={user.name}
        onChangeRole={collab.changeRole}
        disabled={isViewingHistory}
        onShowTimeline={isViewingHistory ? handleStopHistory : handleStartHistory}
      />

      <div className="main-area">
        <GraphCanvas
          nodes={displayNodes}
          edges={displayEdges}
          cursors={collab.cursors}
          userNames={collab.userNames}
          heatStats={effectiveHeatStats}
          isEditor={collab.isEditor && mode === 'edit' && !isViewingHistory}
          selectedNodeId={selectedNodeId}
          selectedEdgeId={selectedEdgeId}
          onSelectNode={setSelectedNodeId}
          onSelectEdge={setSelectedEdgeId}
          onDeselect={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          onMoveNode={handleMoveNode}
          onAddEdge={collab.addEdge}
          onDeleteNode={handleDeleteNode}
          onDeleteEdge={handleDeleteEdge}
          sendCursor={collab.sendCursor}
          clientId={collab.clientId}
          highlightPath={playPath}
          isViewingHistory={isViewingHistory}
          highlightDiff={highlightDiff}
        />

        {mode === 'edit' && !isViewingHistory && (
          <div className="side-panel">
            {selectedNode && (
              <NodeEditor
                node={selectedNode}
                onUpdate={collab.updateNode}
                onDelete={handleDeleteNode}
                isEditor={collab.isEditor}
                edges={collab.edges}
                nodes={collab.nodes}
              />
            )}
            {selectedEdge && !selectedNode && (
              <EdgeEditor
                edge={selectedEdge}
                nodes={collab.nodes}
                onUpdate={collab.updateEdge}
                onDelete={handleDeleteEdge}
                isEditor={collab.isEditor}
              />
            )}
            {!selectedNode && !selectedEdge && (
              <div className="side-panel-empty">
                <div className="empty-icon">🗺️</div>
                <p>选择一个节点或边进行编辑</p>
                <p className="empty-hint">
                  点击节点选中，拖拽右侧端口到另一节点创建边
                </p>
                <p className="empty-hint">
                  Alt+拖拽 或 中键拖拽来平移画布
                </p>
                {collab.isEditor && (
                  <p className="empty-hint">
                    按 Delete 键删除选中的元素
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {isViewingHistory && highlightDiff && (
          <div className="side-panel">
            <div className="node-editor">
              <div className="editor-header">
                <h3>📊 变化摘要</h3>
              </div>
              <div className="diff-summary">
                {highlightDiff.addedNodes?.length > 0 && (
                  <div className="diff-item added">
                    <span className="diff-label">✓ 新增节点</span>
                    <span className="diff-count">{highlightDiff.addedNodes.length}</span>
                  </div>
                )}
                {highlightDiff.removedNodes?.length > 0 && (
                  <div className="diff-item removed">
                    <span className="diff-label">✗ 删除节点</span>
                    <span className="diff-count">{highlightDiff.removedNodes.length}</span>
                  </div>
                )}
                {highlightDiff.updatedNodes?.length > 0 && (
                  <div className="diff-item updated">
                    <span className="diff-label">↻ 更新节点</span>
                    <span className="diff-count">{highlightDiff.updatedNodes.length}</span>
                  </div>
                )}
                {highlightDiff.addedEdges?.length > 0 && (
                  <div className="diff-item added">
                    <span className="diff-label">✓ 新增边</span>
                    <span className="diff-count">{highlightDiff.addedEdges.length}</span>
                  </div>
                )}
                {highlightDiff.removedEdges?.length > 0 && (
                  <div className="diff-item removed">
                    <span className="diff-label">✗ 删除边</span>
                    <span className="diff-count">{highlightDiff.removedEdges.length}</span>
                  </div>
                )}
                {highlightDiff.updatedEdges?.length > 0 && (
                  <div className="diff-item updated">
                    <span className="diff-label">↻ 更新边</span>
                    <span className="diff-count">{highlightDiff.updatedEdges.length}</span>
                  </div>
                )}
              </div>
              <div className="diff-legend">
                <p><span style={{color: '#2ecc71'}}>■ 绿色</span> = 新增</p>
                <p><span style={{color: '#e74c3c'}}>■ 红色</span> = 删除</p>
                <p><span style={{color: '#f1c40f'}}>■ 黄色</span> = 更新</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <Timeline
        earliest={historyTimeRange.earliest}
        latest={historyTimeRange.latest}
        currentTime={isViewingHistory ? (historySnapshot ? Date.now() : historyTimeRange.latest) : historyTimeRange.latest}
        onSeek={handleSeek}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStopHistory}
        isPlaying={isPlayingReplay}
        isViewingHistory={isViewingHistory}
      />

      {mode === 'play' && (
        <PlayMode
          nodes={displayNodes}
          edges={displayEdges}
          onComplete={handlePlayComplete}
          onCancel={() => {
            setMode('edit');
            setPlayPath(null);
          }}
        />
      )}
    </div>
  );
}
