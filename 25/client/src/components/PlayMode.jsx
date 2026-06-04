import React, { useState, useMemo, useRef, useEffect } from 'react';

export default function PlayMode({
  nodes,
  edges,
  onComplete,
  onCancel,
}) {
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [path, setPath] = useState([]);
  const [finished, setFinished] = useState(false);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const lastChoiceRef = useRef({ nodeId: null, time: 0 });
  const lastFinishRef = useRef(0);
  const cooldownTimerRef = useRef(null);

  const DEBOUNCE_MS = 3000;

  const clearCooldown = () => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    setCooldownActive(false);
    setCooldownSeconds(0);
  };

  const startCooldown = () => {
    clearCooldown();
    setCooldownActive(true);
    setCooldownSeconds(Math.ceil(DEBOUNCE_MS / 1000));

    const start = Date.now();
    cooldownTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.ceil((DEBOUNCE_MS - elapsed) / 1000);
      if (remaining <= 0) {
        clearCooldown();
      } else {
        setCooldownSeconds(remaining);
      }
    }, 100);
  };

  useEffect(() => {
    return () => clearCooldown();
  }, []);

  const startNode = useMemo(
    () => Object.values(nodes).find((n) => n.isStart),
    [nodes]
  );

  const currentNode = useMemo(
    () => nodes[currentNodeId],
    [nodes, currentNodeId]
  );

  const outgoingEdges = useMemo(() => {
    if (!currentNodeId) return [];
    return Object.values(edges).filter((e) => e.from === currentNodeId);
  }, [edges, currentNodeId]);

  React.useEffect(() => {
    if (startNode && !currentNodeId) {
      setCurrentNodeId(startNode.id);
      setPath([startNode.id]);
      lastChoiceRef.current = { nodeId: startNode.id, time: Date.now() };
    }
  }, [startNode, currentNodeId]);

  const handleChoice = (edge) => {
    const now = Date.now();
    const last = lastChoiceRef.current;

    if (
      last.nodeId === currentNodeId &&
      now - last.time < DEBOUNCE_MS
    ) {
      console.log(`[PlayMode] Debounced: ${DEBOUNCE_MS}ms cooldown at node ${currentNodeId}`);
      return;
    }

    lastChoiceRef.current = { nodeId: currentNodeId, time: now };
    startCooldown();
    const newPath = [...path, edge.to];
    setPath(newPath);
    setCurrentNodeId(edge.to);
  };

  const handleFinish = () => {
    const now = Date.now();
    if (now - lastFinishRef.current < DEBOUNCE_MS) {
      console.log(`[PlayMode] Finish debounced: ${DEBOUNCE_MS}ms cooldown`);
      return;
    }
    lastFinishRef.current = now;
    setFinished(true);
    if (onComplete) {
      onComplete(path);
    }
  };

  if (!startNode) {
    return (
      <div className="play-mode-overlay">
        <div className="play-card">
          <h2>⚠️ 没有开始节点</h2>
          <p>请先在编辑模式下设置一个"开始节点"</p>
          <button className="play-btn" onClick={onCancel}>
            返回编辑
          </button>
        </div>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="play-mode-overlay">
        <div className="play-card">
          <h2>🎊 故事结束</h2>
          <div className="play-path-summary">
            <h3>你的路径</h3>
            <div className="path-chain">
              {path.map((nid, i) => {
                const n = nodes[nid];
                return (
                  <React.Fragment key={nid}>
                    <span className="path-node">{n?.title || nid}</span>
                    {i < path.length - 1 && <span className="path-arrow">→</span>}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <div className="play-actions">
            <button
              className={`play-btn ${cooldownActive ? 'disabled' : ''}`}
              disabled={cooldownActive}
              onClick={() => {
                const now = Date.now();
                if (now - lastFinishRef.current < DEBOUNCE_MS) {
                  return;
                }
                lastChoiceRef.current = { nodeId: startNode.id, time: now };
                lastFinishRef.current = now;
                setCurrentNodeId(startNode.id);
                setPath([startNode.id]);
                setFinished(false);
                startCooldown();
              }}
            >
              {cooldownActive ? `⏱ ${cooldownSeconds}s` : '重新游玩'}
            </button>
            <button className="play-btn secondary" onClick={onCancel}>
              返回编辑
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="play-mode-overlay">
      <div className="play-card">
        {currentNode && (
          <>
            <div className="play-node-title">{currentNode.title}</div>
            <div className="play-node-content">{currentNode.content}</div>
          </>
        )}

        {outgoingEdges.length > 0 ? (
          <div className="play-choices">
            <p className="choices-label">选择你的下一步：</p>
            {outgoingEdges.map((edge) => {
              const targetNode = nodes[edge.to];
              return (
                <button
                  key={edge.id}
                  className={`choice-btn ${cooldownActive ? 'disabled' : ''}`}
                  onClick={() => handleChoice(edge)}
                  disabled={cooldownActive}
                >
                  <span className="choice-label">{edge.label}</span>
                  {cooldownActive ? (
                    <span className="cooldown-badge">⏱ {cooldownSeconds}s</span>
                  ) : targetNode ? (
                    <span className="choice-target">→ {targetNode.title}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="play-end">
            <p>你已经到达了故事的一个终点。</p>
            <button
              className={`play-btn ${cooldownActive ? 'disabled' : ''}`}
              onClick={handleFinish}
              disabled={cooldownActive}
            >
              {cooldownActive ? `⏱ ${cooldownSeconds}s 后可结束` : '结束旅程'}
            </button>
          </div>
        )}

        <div className="play-path-trail">
          {path.map((nid, i) => {
            const n = nodes[nid];
            return (
              <React.Fragment key={i}>
                <span className="trail-dot" title={n?.title}>{i + 1}</span>
                {i < path.length - 1 && <span className="trail-line" />}
              </React.Fragment>
            );
          })}
        </div>

        <button className="play-exit-btn" onClick={onCancel}>
          ✕ 退出游玩
        </button>
      </div>
    </div>
  );
}
