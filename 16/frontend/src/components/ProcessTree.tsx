import React from 'react';
import { ProcessNode, ProcessTree as ProcessTreeType } from '../types';
import { ipcTypeClass, ipcTypeLabel } from '../utils';

interface Props {
  tree: ProcessTreeType;
  selectedPid: number | null;
  onSelectPid: (pid: number) => void;
}

const ProcessTree: React.FC<Props> = ({ tree, selectedPid, onSelectPid }) => {
  return (
    <div className="sidebar-content">
      {tree.nodes.length === 0 && (
        <div className="empty-state" style={{ height: 200 }}>No processes</div>
      )}
      {tree.nodes.map((node: ProcessNode) => (
        <div
          key={node.pid}
          className={`process-node ${selectedPid === node.pid ? 'selected' : ''}`}
          onClick={() => onSelectPid(node.pid)}
        >
          <div className="process-node-pid">PID {node.pid}</div>
          <div className="process-node-name">{node.name}</div>
          {node.connections.map((conn, i) => (
            <div key={i} className="process-connection">
              <span className={`message-ipc-type ${ipcTypeClass(conn.ipc_type)}`}>
                {ipcTypeLabel(conn.ipc_type)}
              </span>
              <span className="process-connection-arrow">→</span>
              <span>PID {conn.remote_pid}</span>
              <span style={{ marginLeft: 'auto', color: '#8b949e' }}>
                {conn.message_count}msg
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default ProcessTree;
