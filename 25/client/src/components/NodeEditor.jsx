import React, { useState, useEffect } from 'react';

export default function NodeEditor({ node, onUpdate, onDelete, isEditor, edges, nodes }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isStart, setIsStart] = useState(false);

  useEffect(() => {
    if (node) {
      setTitle(node.title || '');
      setContent(node.content || '');
      setIsStart(node.isStart || false);
    }
  }, [node]);

  if (!node) return null;

  const handleSave = () => {
    if (!isEditor) return;
    onUpdate({
      ...node,
      title,
      content,
      isStart,
    });
  };

  const incomingEdges = Object.values(edges).filter((e) => e.to === node.id);
  const outgoingEdges = Object.values(edges).filter((e) => e.from === node.id);

  return (
    <div className="node-editor">
      <div className="editor-header">
        <h3>节点编辑</h3>
        <span className="node-id">{node.id.slice(0, 8)}</span>
      </div>

      <div className="editor-field">
        <label>标题</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSave}
          disabled={!isEditor}
        />
      </div>

      <div className="editor-field">
        <label>内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          disabled={!isEditor}
          rows={4}
        />
      </div>

      <div className="editor-field">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isStart}
            onChange={(e) => {
              setIsStart(e.target.checked);
              if (isEditor) {
                onUpdate({ ...node, title, content, isStart: e.target.checked });
              }
            }}
            disabled={!isEditor}
          />
          设为开始节点
        </label>
      </div>

      <div className="editor-section">
        <h4>连接</h4>
        <div className="connections-list">
          <div className="conn-group">
            <span className="conn-label">入边 ({incomingEdges.length})</span>
            {incomingEdges.map((e) => {
              const src = nodes[e.from];
              return (
                <div key={e.id} className="conn-item">
                  {src?.title || e.from.slice(0, 6)} → 此节点
                  <span className="conn-edge-label">"{e.label}"</span>
                </div>
              );
            })}
          </div>
          <div className="conn-group">
            <span className="conn-label">出边 ({outgoingEdges.length})</span>
            {outgoingEdges.map((e) => {
              const tgt = nodes[e.to];
              return (
                <div key={e.id} className="conn-item">
                  此节点 → {tgt?.title || e.to.slice(0, 6)}
                  <span className="conn-edge-label">"{e.label}"</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {isEditor && (
        <button className="delete-btn" onClick={() => onDelete(node.id)}>
          🗑️ 删除节点
        </button>
      )}
    </div>
  );
}
