import React, { useState, useEffect } from 'react';

export default function EdgeEditor({ edge, nodes, onUpdate, onDelete, isEditor }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (edge) {
      setLabel(edge.label || '');
    }
  }, [edge]);

  if (!edge) return null;

  const fromNode = nodes[edge.from];
  const toNode = nodes[edge.to];

  const handleSave = () => {
    if (!isEditor) return;
    onUpdate({ ...edge, label });
  };

  return (
    <div className="node-editor edge-editor">
      <div className="editor-header">
        <h3>边编辑</h3>
        <span className="node-id">{edge.id.slice(0, 8)}</span>
      </div>

      <div className="edge-info">
        <div className="edge-endpoint">
          <span className="endpoint-label">从</span>
          <span className="endpoint-name">{fromNode?.title || edge.from.slice(0, 6)}</span>
        </div>
        <span className="edge-arrow">→</span>
        <div className="edge-endpoint">
          <span className="endpoint-label">到</span>
          <span className="endpoint-name">{toNode?.title || edge.to.slice(0, 6)}</span>
        </div>
      </div>

      <div className="editor-field">
        <label>选项标签</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={handleSave}
          disabled={!isEditor}
          placeholder="玩家看到的选项文字"
        />
      </div>

      {isEditor && (
        <button className="delete-btn" onClick={() => onDelete(edge.id)}>
          🗑️ 删除边
        </button>
      )}
    </div>
  );
}
