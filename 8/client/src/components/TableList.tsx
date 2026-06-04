import { useState } from 'react';
import { useStore } from '../store/useStore';
import { dataService } from '../services/dataService';

interface TableListProps {
  onSelectTable: (table: any) => void;
}

export default function TableList({ onSelectTable }: TableListProps) {
  const { tables, setTables, currentUser } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newTableName, setNewTableName] = useState('');

  const handleCreateTable = async () => {
    if (!newTableName.trim() || !currentUser) return;

    const newTable = await dataService.createTable(newTableName.trim());
    setTables([newTable, ...tables]);
    setNewTableName('');
    setShowCreate(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-800">我的数据表</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 创建新表格
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 bg-white rounded-lg shadow border">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            表格名称
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              className="flex-1 rounded-md border-gray-300 border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="输入表格名称..."
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateTable()}
            />
            <button
              onClick={handleCreateTable}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              创建
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {tables.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">还没有创建任何表格</p>
          <p className="text-sm text-gray-400 mt-1">点击上方按钮创建第一个表格</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((table) => (
            <div
              key={table.id}
              onClick={() => onSelectTable(table)}
              className="bg-white p-4 rounded-lg shadow border cursor-pointer hover:shadow-md transition-shadow"
            >
              <h3 className="font-medium text-gray-800 truncate">{table.name}</h3>
              <p className="text-sm text-gray-500 mt-1">
                创建于 {new Date(table.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
