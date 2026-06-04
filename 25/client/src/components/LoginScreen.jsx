import React, { useState } from 'react';

const CURSOR_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#e91e63',
];

export default function LoginScreen({ onLogin }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('editor');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const color = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
    onLogin(name.trim(), role, color);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">📖</div>
        <h1>故事图谱编辑器</h1>
        <p className="login-subtitle">协同式分支叙事引擎</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>用户名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入你的名字..."
              maxLength={20}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>角色</label>
            <div className="role-selector">
              <button
                type="button"
                className={`role-btn ${role === 'editor' ? 'active' : ''}`}
                onClick={() => setRole('editor')}
              >
                <span className="role-icon">✏️</span>
                <span>编辑者</span>
                <span className="role-desc">编辑图谱</span>
              </button>
              <button
                type="button"
                className={`role-btn ${role === 'visitor' ? 'active' : ''}`}
                onClick={() => setRole('visitor')}
              >
                <span className="role-icon">🎮</span>
                <span>游客</span>
                <span className="role-desc">只能游玩</span>
              </button>
            </div>
          </div>
          <button type="submit" className="login-btn" disabled={!name.trim()}>
            进入图谱
          </button>
        </form>
      </div>
    </div>
  );
}
