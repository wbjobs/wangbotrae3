import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { dataService } from '../services/dataService';
import EditableCell from './EditableCell';
import AddColumnModal from './AddColumnModal';

interface TableViewProps {
  onSelectRow: (rowId: string) => void;
  onOpenViews: () => void;
}

const COLUMN_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '单选' },
];

export default function TableView({ onSelectRow, onOpenViews }: TableViewProps) {
  const {
    currentTable,
    columns,
    rows,
    setColumns,
    setRows,
    addRow,
    updateCell,
    markRowDeleted,
    currentUser,
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);

  const visibleRows = rows.filter((row) => !row.is_deleted);

  useEffect(() => {
    if (currentTable) {
      setLoading(true);
      dataService.fetchTableData(currentTable.id).then((data) => {
        setColumns(data.columns);
        setRows(data.rows);
        setLoading(false);
      });
    }
  }, [currentTable?.id, setColumns, setRows]);

  const handleAddColumn = async (name: string, type: string) => {
    if (!currentTable) return;
    const newColumn = await dataService.createColumn(
      currentTable.id,
      name,
      type,
      columns.length
    );
    setColumns([...columns, newColumn]);
    setShowAddColumn(false);
  };

  const handleAddRow = async () => {
    if (!currentTable) return;
    const newRow = await dataService.createRow(currentTable.id);
    addRow(newRow);
  };

  const handleCellChange = async (rowId: string, columnId: string, newValue: any, oldValue: any) => {
    if (!currentTable || !currentUser) return;

    await dataService.updateCell(currentTable.id, rowId, columnId, newValue, oldValue);
    
    const lamportTimestamp = await (await import('../db/indexedDB')).db.getLamportTimestamp();
    updateCell(rowId, columnId, newValue, lamportTimestamp, currentUser.id);
  };

  const handleDeleteRow = async (rowId: string) => {
    if (!currentTable || !currentUser) return;

    await dataService.deleteRow(currentTable.id, rowId);
    const lamportTimestamp = await (await import('../db/indexedDB')).db.getLamportTimestamp();
    markRowDeleted(rowId, lamportTimestamp, currentUser.id);
    setConfirmDeleteRowId(null);
  };

  const handleCleanupTombstones = async () => {
    if (!currentTable) return;
    const result = await dataService.cleanupTombstones(currentTable.id, 30);
    alert(`已清理 ${result.purgedCount} 条超过30天的已删除记录`);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">{currentTable?.name}</h2>
        <div className="flex gap-3">
          <button
            onClick={onOpenViews}
            className="text-sm text-purple-600 hover:text-purple-800"
          >
            📊 查询视图
          </button>
          <button
            onClick={() => setShowAddColumn(true)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            + 添加列
          </button>
          <button
            onClick={handleAddRow}
            className="text-sm text-green-600 hover:text-green-800"
          >
            + 添加行
          </button>
          <button
            onClick={handleCleanupTombstones}
            className="text-sm text-orange-600 hover:text-orange-800"
            title="物理清理超过30天的已删除记录"
          >
            🧹 清理回收站
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                #
              </th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l border-gray-200"
                >
                  <div className="flex items-center gap-2">
                    {column.name}
                    <span className="text-gray-400 text-xs font-normal">
                      ({COLUMN_TYPES.find((t) => t.value === column.type)?.label})
                    </span>
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20 border-l border-gray-200">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  暂无数据，点击右上角添加行
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr
                  key={row.id}
                  className="hover:bg-gray-50"
                >
                  <td
                    className="px-4 py-3 text-sm text-gray-500 cursor-pointer"
                    onClick={() => onSelectRow(row.id)}
                  >
                    {index + 1}
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className="px-4 py-2 border-l border-gray-100"
                    >
                      <EditableCell
                        value={row.cells?.[column.id]?.value ?? null}
                        columnType={column.type as any}
                        columnConfig={column.config}
                        onChange={(newValue, oldValue) =>
                          handleCellChange(row.id, column.id, newValue, oldValue)
                        }
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2 border-l border-gray-100">
                    {confirmDeleteRowId === row.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDeleteRow(row.id)}
                          className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setConfirmDeleteRowId(null)}
                          className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteRowId(row.id)}
                        className="text-xs text-red-500 hover:text-red-700 opacity-0 group-hover:opacity-100 hover:opacity-100"
                        title="删除此行"
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}
                        style={{ opacity: 0.4 }}
                      >
                        🗑️
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddColumn && (
        <AddColumnModal
          onClose={() => setShowAddColumn(false)}
          onSubmit={handleAddColumn}
        />
      )}
    </div>
  );
}
