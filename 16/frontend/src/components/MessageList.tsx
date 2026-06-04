import React, { useRef, useEffect } from 'react';
import { IpcMessage } from '../types';
import { formatTimestamp, ipcTypeClass, ipcTypeLabel, truncateBytes } from '../utils';

interface Props {
  messages: IpcMessage[];
  selectedId: string | null;
  onSelect: (msg: IpcMessage) => void;
}

const MessageList: React.FC<Props> = ({ messages, selectedId, onSelect }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (autoScroll.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const overrunCount = messages.filter(m => m.has_overrun).length;

  return (
    <div className="message-list-container" ref={containerRef} onScroll={handleScroll}>
      {messages.length === 0 && (
        <div className="empty-state">Waiting for messages...</div>
      )}
      {overrunCount > 0 && (
        <div className="overflow-banner">
          <span className="overflow-banner-icon">⚠</span>
          <span>{overrunCount} message{overrunCount > 1 ? 's' : ''} lost due to buffer overflow</span>
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`message-item ${selectedId === msg.id ? 'selected' : ''} ${msg.has_overrun ? 'has-overrun' : ''}`}
          onClick={() => onSelect(msg)}
        >
          <div className="message-item-header">
            {msg.has_overrun && (
              <span className="message-overflow-warning" title={`${msg.dropped_count} message(s) dropped - data incomplete`}>
                ⚠
              </span>
            )}
            <span className={`message-direction ${msg.direction.toLowerCase()}`}>
              {msg.direction}
            </span>
            <span className="message-pid">PID {msg.source_pid}</span>
            <span className="message-arrow">→</span>
            <span className="message-pid">PID {msg.target_pid}</span>
            <span className={`message-ipc-type ${ipcTypeClass(msg.ipc_type)}`}>
              {ipcTypeLabel(msg.ipc_type)}
            </span>
            <span className="message-timestamp">
              {formatTimestamp(msg.timestamp)}
            </span>
          </div>
          <div className="message-preview">
            {msg.has_overrun && (
              <span className="preview-overflow-tag">INCOMPLETE</span>
            )}
            {truncateBytes(msg.content)}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

export default MessageList;
