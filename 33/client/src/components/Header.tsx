import { useAppContext } from '../context/AppContext';
import { formatDate } from '@shared/utils';

export function Header() {
  const { isOnline, syncState, triggerSync } = useAppContext();

  const getSyncStatusText = () => {
    if (syncState.status === 'syncing') return '同步中...';
    if (syncState.status === 'error') return '同步失败';
    if (syncState.pendingCount > 0) return `${syncState.pendingCount} 项待同步`;
    if (syncState.status === 'success' || syncState.lastSyncTime) return '已同步';
    return '离线';
  };

  const getSyncStatusColor = () => {
    if (!isOnline) return 'var(--text-light)';
    if (syncState.status === 'error') return 'var(--error-color)';
    if (syncState.status === 'syncing' || syncState.pendingCount > 0) return 'var(--warning-color)';
    return 'var(--success-color)';
  };

  return (
    <header className="header">
      <div className="header-content">
        <h1>地质采集系统</h1>
        <div 
          className="sync-status" 
          onClick={() => isOnline && triggerSync()}
          style={{ cursor: isOnline ? 'pointer' : 'default' }}
          title={syncState.lastSyncTime ? `上次同步: ${formatDate(syncState.lastSyncTime)}` : ''}
        >
          <svg 
            className={`sync-icon ${syncState.status === 'syncing' ? 'syncing' : ''}`}
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            style={{ color: getSyncStatusColor() }}
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
          <span style={{ color: getSyncStatusColor() }}>{getSyncStatusText()}</span>
        </div>
      </div>
    </header>
  );
}
