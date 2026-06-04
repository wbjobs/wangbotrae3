import { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { dataService } from './services/dataService';
import { socketManager } from './sync/socket';
import TableList from './components/TableList';
import TableView from './components/TableView';
import UserSelector from './components/UserSelector';
import ConnectionStatus from './components/ConnectionStatus';
import ChangeLogPanel from './components/ChangeLogPanel';
import ViewPanel from './components/ViewPanel';

function App() {
  const {
    currentTable,
    setTables,
    setCurrentTable,
    setUsers,
    setCurrentUser,
    currentUser,
    setOnline,
    isOnline,
    markRowDeleted,
    markRowRestored,
  } = useStore();

  const [showChangeLog, setShowChangeLog] = useState(false);
  const [showViews, setShowViews] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  useEffect(() => {
    socketManager.connect();

    const handleOnline = () => {
      setOnline(true);
      if (currentTable) {
        dataService.syncChanges(currentTable.id);
      }
    };
    
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      socketManager.disconnect();
    };
  }, [currentTable, setOnline]);

  useEffect(() => {
    const init = async () => {
      const users = await dataService.fetchUsers();
      setUsers(users);
      if (users.length > 0) {
        setCurrentUser(users[0]);
        dataService.setUserId(users[0].id);
      }

      const tables = await dataService.fetchTables();
      setTables(tables);
    };

    init();
  }, [setUsers, setCurrentUser, setTables]);

  useEffect(() => {
    const handleDocUpdate = (data: any) => {
      console.log('Received update:', data);
    };

    const handleRowDeleted = async (data: { rowId: string; tableId: string; userId: string; lamportTimestamp: number; deletedAt: string }) => {
      if (data.userId !== currentUser?.id) {
        await dataService.handleRemoteRowDeleted(data);
        markRowDeleted(data.rowId, data.lamportTimestamp, data.userId);
      }
    };

    const handleRowRestored = async (data: { rowId: string; tableId: string; userId: string; lamportTimestamp: number }) => {
      if (data.userId !== currentUser?.id) {
        await dataService.handleRemoteRowRestored(data);
        markRowRestored(data.rowId, data.lamportTimestamp);
      }
    };

    socketManager.on('doc-update', handleDocUpdate);
    socketManager.on('row-deleted', handleRowDeleted);
    socketManager.on('row-restored', handleRowRestored);
    socketManager.on('connect', () => setOnline(true));
    socketManager.on('disconnect', () => setOnline(false));

    return () => {
      socketManager.off('doc-update', handleDocUpdate);
      socketManager.off('row-deleted', handleRowDeleted);
      socketManager.off('row-restored', handleRowRestored);
    };
  }, [setOnline, currentUser?.id, markRowDeleted, markRowRestored]);

  const handleSelectTable = async (table: any) => {
    setCurrentTable(table);
    setSelectedRowId(null);
    socketManager.joinTable(table.id);
  };

  const handleBack = () => {
    if (currentTable) {
      socketManager.leaveTable(currentTable.id);
    }
    setCurrentTable(null);
    setSelectedRowId(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-800">
              📊 离线优先协作数据管理
            </h1>
            <ConnectionStatus isOnline={isOnline} />
          </div>
          <div className="flex items-center gap-4">
            <UserSelector />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {!currentTable ? (
          <TableList onSelectTable={handleSelectTable} />
        ) : (
          <div className="flex gap-4">
            <div className="flex-1">
              <button
                onClick={handleBack}
                className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                ← 返回表格列表
              </button>
              <TableView
                onSelectRow={(rowId) => {
                  setSelectedRowId(rowId);
                  setShowChangeLog(true);
                }}
                onOpenViews={() => setShowViews(true)}
              />
            </div>
            {showChangeLog && (
              <ChangeLogPanel
                rowId={selectedRowId}
                onClose={() => setShowChangeLog(false)}
              />
            )}
            {showViews && (
              <ViewPanel
                onClose={() => setShowViews(false)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
