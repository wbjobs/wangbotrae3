import React, { useState, useMemo } from 'react';
import { IpcMessage } from '../types';
import { formatHexView, bytesToText, textToBytes, formatTimestamp, ipcTypeClass, ipcTypeLabel } from '../utils';

interface Props {
  message: IpcMessage | null;
  onInject: (msg: IpcMessage, modifiedContent: number[]) => void;
}

type ViewMode = 'hex' | 'text' | 'edit';

const MessageDetail: React.FC<Props> = ({ message, onInject }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('hex');
  const [editText, setEditText] = useState('');

  const hexLines = useMemo(() => {
    if (!message) return [];
    return formatHexView(message.content);
  }, [message]);

  if (!message) {
    return (
      <div className="detail-panel">
        <div className="empty-state">Select a message to view details</div>
      </div>
    );
  }

  const handleEdit = () => {
    setEditText(bytesToText(message.content));
    setViewMode('edit');
  };

  const handleInject = () => {
    const modifiedBytes = textToBytes(editText);
    onInject(message, modifiedBytes);
  };

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h3>Message Detail</h3>
        {viewMode !== 'edit' && (
          <button className="inject-btn" onClick={handleEdit}>Edit & Inject</button>
        )}
        {viewMode === 'edit' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="tt-btn primary" onClick={handleInject}>Inject</button>
            <button className="tt-btn" onClick={() => setViewMode('hex')}>Cancel</button>
          </div>
        )}
      </div>

      <table className="meta-table" style={{ padding: '0 16px' }}>
        <tbody>
          <tr><td>ID</td><td>{message.id}</td></tr>
          <tr><td>Timestamp</td><td>{formatTimestamp(message.timestamp)}</td></tr>
          <tr><td>Direction</td><td>{message.direction}</td></tr>
          <tr><td>Source PID</td><td>{message.source_pid}</td></tr>
          <tr><td>Target PID</td><td>{message.target_pid}</td></tr>
          <tr><td>IPC Type</td><td><span className={`message-ipc-type ${ipcTypeClass(message.ipc_type)}`}>{ipcTypeLabel(message.ipc_type)}</span></td></tr>
          <tr><td>FD</td><td>{message.fd}</td></tr>
          <tr><td>Length</td><td>{message.content.length} bytes</td></tr>
          <tr><td>Captured At</td><td>{message.captured_at}</td></tr>
        </tbody>
      </table>

      <div className="detail-tabs">
        <div className={`detail-tab ${viewMode === 'hex' ? 'active' : ''}`} onClick={() => setViewMode('hex')}>Hex</div>
        <div className={`detail-tab ${viewMode === 'text' ? 'active' : ''}`} onClick={() => setViewMode('text')}>Text</div>
        <div className={`detail-tab ${viewMode === 'edit' ? 'active' : ''}`} onClick={handleEdit}>Edit</div>
      </div>

      <div className="detail-content">
        {viewMode === 'hex' && (
          <div className="hex-view">
            {hexLines.map((line, i) => (
              <div key={i} className="hex-line">
                <span className="hex-offset">{line.offset}</span>
                <span className="hex-bytes">{line.hex}</span>
                <span className="hex-ascii">{line.ascii}</span>
              </div>
            ))}
          </div>
        )}
        {viewMode === 'text' && (
          <div className="text-view">{bytesToText(message.content)}</div>
        )}
        {viewMode === 'edit' && (
          <div>
            <textarea
              className="edit-area"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
            <div style={{ marginTop: 8, fontSize: 11, color: '#8b949e' }}>
              {editText.length} chars / {textToBytes(editText).length} bytes
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageDetail;
