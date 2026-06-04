import React, { useState, useEffect } from 'react';

export default function Toolbar({
  isEditor,
  mode,
  onModeChange,
  onAddNode,
  showHeatMap,
  onToggleHeatMap,
  history,
  connected,
  clientId,
  userRoles,
  users,
  userName,
  onChangeRole,
  disabled = false,
  onShowTimeline,
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showUsers, setShowUsers] = useState(false);

  return (
    <div className={`toolbar ${disabled ? 'disabled' : ''}`}>
      <div className="toolbar-left">
        <div className={`connection-badge ${connected ? 'connected' : ''}`}>
          <span className="connection-dot" />
          {connected ? '已连接' : '连接中...'}
        </div>
        <span className="user-badge">
          {userName} ({userRoles?.[clientId] === 'editor' ? '编辑者' : '游客'})
        </span>
      </div>

      <div className="toolbar-center">
        <button
          className={`tool-btn ${mode === 'edit' ? 'active' : ''}`}
          onClick={() => onModeChange('edit')}
          title="编辑模式"
          disabled={disabled}
        >
          ✏️ 编辑
        </button>
        <button
          className={`tool-btn ${mode === 'play' ? 'active' : ''}`}
          onClick={() => onModeChange('play')}
          title="游玩模式"
          disabled={disabled}
        >
          🎮 游玩
        </button>
        <div className="toolbar-divider" />
        {isEditor && mode === 'edit' && (
          <button
            className="tool-btn"
            onClick={() => {
              onAddNode({
                x: 300 + Math.random() * 200,
                y: 200 + Math.random() * 150,
                width: 220,
                height: 80,
                title: '新片段',
                content: '在这里写下故事...',
                isStart: false,
              });
            }}
            title="添加节点"
            disabled={disabled}
          >
            ➕ 添加节点
          </button>
        )}
        <button
          className={`tool-btn ${showHeatMap ? 'active' : ''}`}
          onClick={onToggleHeatMap}
          title="热力图"
          disabled={disabled}
        >
          🔥 热力图
        </button>
      </div>

      <div className="toolbar-right">
        <button
          className="tool-btn"
          onClick={() => setShowUsers(!showUsers)}
          title="在线用户"
          disabled={disabled}
        >
          👥 {Object.keys(users || {}).length}
        </button>
        <button
          className={`tool-btn ${disabled ? 'active' : ''}`}
          onClick={onShowTimeline}
          title="时间轴回放"
        >
          ⏱️ {disabled ? '历史模式' : '时间轴'}
        </button>
      </div>

      {showUsers && (
        <div className="dropdown-panel users-panel">
          <h3>在线用户</h3>
          {Object.entries(users || {}).map(([uid, info]) => (
            <div key={uid} className="user-item">
              <span className="user-item-name">{info.name}</span>
              <span className={`user-item-role ${info.role}`}>
                {info.role === 'editor' ? '编辑者' : '游客'}
              </span>
              {userRoles?.[clientId] === 'editor' && uid !== clientId && (
                <button
                  className="role-toggle-btn"
                  onClick={() =>
                    onChangeRole(uid, info.role === 'editor' ? 'visitor' : 'editor')
                  }
                >
                  切换
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showHistory && !disabled && (
        <div className="dropdown-panel history-panel">
          <h3>版本历史</h3>
          {history.length === 0 ? (
            <p className="empty-hint">暂无历史记录</p>
          ) : (
            history
              .slice()
              .reverse()
              .map((v) => (
                <div key={v.id} className="history-item">
                  <span className="history-version">v{v.id}</span>
                  <span className="history-desc">{v.description}</span>
                  <span className="history-meta">
                    {v.nodeCount}节点 / {v.edgeCount}边
                  </span>
                  <span className="history-time">
                    {new Date(v.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
