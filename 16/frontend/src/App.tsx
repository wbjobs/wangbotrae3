import React, { useState, useEffect, useCallback } from 'react';
import {
  IpcMessage,
  MessageFilter,
  ProcessTree as ProcessTreeType,
  InjectRequest,
  IpcType,
  BufferStats,
  CaptureConfig,
  BUFFER_SIZE_OPTIONS,
  DEFAULT_BUFFER_SIZE,
} from './types';
import {
  fetchMessages,
  fetchProcessTree,
  startCapture,
  stopCapture,
  injectMessage,
  createWsConnection,
  closeWsConnection,
  getBufferStats,
  resetDroppedCount,
  getConfig,
  updateConfig,
} from './services/api';
import ProcessTree from './components/ProcessTree';
import MessageList from './components/MessageList';
import MessageDetail from './components/MessageDetail';
import TimeTravel from './components/TimeTravel';

const App: React.FC = () => {
  const [messages, setMessages] = useState<IpcMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<IpcMessage | null>(null);
  const [processTree, setProcessTree] = useState<ProcessTreeType>({ nodes: [] });
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [ipcFilter, setIpcFilter] = useState<IpcType | ''>('');
  const [replayMessage, setReplayMessage] = useState<IpcMessage | null>(null);
  const [bufferStats, setBufferStats] = useState<BufferStats | null>(null);
  const [bufferSize, setBufferSize] = useState<number>(DEFAULT_BUFFER_SIZE);
  const [showBufferConfig, setShowBufferConfig] = useState(false);

  useEffect(() => {
    createWsConnection((msg: IpcMessage) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
    return () => {
      closeWsConnection();
    };
  }, []);

  useEffect(() => {
    fetchProcessTree().then(setProcessTree);
    const interval = setInterval(() => {
      fetchProcessTree().then(setProcessTree);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (capturing) {
      startCapture();
    } else {
      stopCapture();
    }
  }, [capturing]);

  useEffect(() => {
    if (!capturing) return;
    const interval = setInterval(() => {
      getBufferStats().then(setBufferStats).catch(() => {});
    }, 2000);
    getBufferStats().then(setBufferStats).catch(() => {});
    return () => clearInterval(interval);
  }, [capturing]);

  useEffect(() => {
    getConfig().then(cfg => {
      setBufferSize(cfg.max_ring_buffer_size);
    }).catch(() => {});
  }, []);

  const handleSelectMessage = useCallback((msg: IpcMessage) => {
    setSelectedMessage(msg);
    setReplayMessage(null);
  }, []);

  const handleSelectPid = useCallback((pid: number) => {
    setSelectedPid(prev => prev === pid ? null : pid);
  }, []);

  const handleInject = useCallback(async (msg: IpcMessage, modifiedContent: number[]) => {
    const req: InjectRequest = {
      original_message_id: msg.id,
      modified_content: modifiedContent,
      target_pid: msg.target_pid,
      ipc_type: msg.ipc_type,
      fd: msg.fd,
    };
    const result = await injectMessage(req);
    console.log('Injection result:', result);
  }, []);

  const handleReplayMessage = useCallback((msg: IpcMessage) => {
    setReplayMessage(msg);
    setSelectedMessage(msg);
  }, []);

  const handleBufferSizeChange = useCallback(async (newSize: number) => {
    setBufferSize(newSize);
    try {
      const cfg = await getConfig();
      cfg.max_ring_buffer_size = newSize;
      await updateConfig(cfg);
    } catch {}
  }, []);

  const handleResetDropped = useCallback(async () => {
    try {
      await resetDroppedCount();
      if (bufferStats) {
        setBufferStats({ ...bufferStats, dropped_total: 0 });
      }
    } catch {}
  }, [bufferStats]);

  const filteredMessages = messages.filter(msg => {
    if (selectedPid !== null) {
      if (msg.source_pid !== selectedPid && msg.target_pid !== selectedPid) return false;
    }
    if (ipcFilter && msg.ipc_type !== ipcFilter) return false;
    if (searchText) {
      const text = new TextDecoder().decode(new Uint8Array(msg.content));
      if (!text.toLowerCase().includes(searchText.toLowerCase())) return false;
    }
    return true;
  });

  const currentDetail = replayMessage || selectedMessage;

  const filterForReplay: MessageFilter = {
    source_pid: selectedPid ?? undefined,
    ipc_type: ipcFilter || undefined,
    search_text: searchText || undefined,
    limit: 1000,
  };

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className={`capture-dot ${capturing ? '' : 'stopped'}`} />
          <h2>Processes</h2>
          <button
            className="tt-btn"
            style={{ marginLeft: 'auto', fontSize: 11 }}
            onClick={() => setCapturing(c => !c)}
          >
            {capturing ? 'Stop' : 'Start'}
          </button>
        </div>
        <ProcessTree
          tree={processTree}
          selectedPid={selectedPid}
          onSelectPid={handleSelectPid}
        />
      </div>

      <div className="main-content">
        <div className="toolbar">
          <div className="capture-indicator">
            <div className={`capture-dot ${capturing ? '' : 'stopped'}`} />
            <span style={{ fontSize: 12 }}>{capturing ? 'Capturing' : 'Stopped'}</span>
          </div>

          <input
            className="search"
            type="text"
            placeholder="Search messages..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />

          <select
            value={ipcFilter}
            onChange={e => setIpcFilter(e.target.value as IpcType | '')}
          >
            <option value="">All Types</option>
            <option value="UnixDomainSocket">Unix Socket</option>
            <option value="DBus">DBus</option>
            <option value="Pipe">Pipe</option>
          </select>

          {selectedPid !== null && (
            <button
              className="tt-btn"
              onClick={() => setSelectedPid(null)}
            >
              Clear PID Filter ({selectedPid})
            </button>
          )}

          <span style={{ fontSize: 12, color: '#8b949e', marginLeft: 'auto', fontFamily: 'monospace' }}>
            {filteredMessages.length} messages
          </span>

          {bufferStats && bufferStats.dropped_total > 0 && (
            <span className="buffer-dropped-badge" title={`${bufferStats.dropped_total} messages dropped`}>
              ⚠ {bufferStats.dropped_total} dropped
            </span>
          )}

          {bufferStats && bufferStats.backpressure_active && (
            <span className="buffer-backpressure-badge">
              ⏸ Backpressure
            </span>
          )}

          <button
            className="tt-btn"
            onClick={() => setShowBufferConfig(v => !v)}
            title="Buffer configuration"
          >
            ⚙ Buffer
          </button>
        </div>

        {showBufferConfig && (
          <div className="buffer-config-bar">
            <div className="buffer-config-item">
              <label>Ring Buffer Size:</label>
              <select
                value={bufferSize}
                onChange={e => handleBufferSizeChange(Number(e.target.value))}
              >
                {BUFFER_SIZE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {bufferStats && (
              <>
                <div className="buffer-config-item">
                  <span className="buffer-stat-label">Current:</span>
                  <span className="buffer-stat-value">{(bufferStats.current_size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
                <div className="buffer-config-item">
                  <span className="buffer-stat-label">Dropped:</span>
                  <span className={`buffer-stat-value ${bufferStats.dropped_total > 0 ? 'stat-warning' : ''}`}>{bufferStats.dropped_total}</span>
                </div>
                <div className="buffer-config-item">
                  <span className="buffer-stat-label">Consumers:</span>
                  <span className="buffer-stat-value">{bufferStats.consumer_threads}</span>
                </div>
                {bufferStats.dropped_total > 0 && (
                  <button className="tt-btn" onClick={handleResetDropped} style={{ fontSize: 11 }}>
                    Reset Dropped
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="message-panel">
          <MessageList
            messages={filteredMessages}
            selectedId={currentDetail?.id ?? null}
            onSelect={handleSelectMessage}
          />
          <MessageDetail
            message={currentDetail}
            onInject={handleInject}
          />
        </div>

        <TimeTravel
          onReplayMessage={handleReplayMessage}
          filter={filterForReplay}
        />
      </div>
    </div>
  );
};

export default App;
