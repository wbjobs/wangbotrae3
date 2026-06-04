import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { viewService } from '../services/viewService';
import { View, ViewUpdate } from '../types';
import CreateViewModal from './CreateViewModal';
import ViewTable from './ViewTable';

interface ViewPanelProps {
  onClose: () => void;
}

export default function ViewPanel({ onClose }: ViewPanelProps) {
  const { currentTable, currentUser } = useStore();
  const [views, setViews] = useState<View[]>([]);
  const [selectedView, setSelectedView] = useState<View | null>(null);
  const [viewData, setViewData] = useState<Record<string, any>[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentTable) {
      loadViews();
    }
  }, [currentTable?.id]);

  useEffect(() => {
    if (!selectedView || !currentUser) return;

    const unsubscribe = viewService.subscribe(
      selectedView.id,
      currentUser.id,
      (update: ViewUpdate) => {
        setViewData(update.data);
      }
    );

    loadViewData(selectedView.id);

    return unsubscribe;
  }, [selectedView?.id, currentUser?.id]);

  const loadViews = async () => {
    if (!currentTable) return;
    setLoading(true);
    const result = await viewService.fetchViews(currentTable.id);
    setViews(result);
    setLoading(false);
  };

  const loadViewData = async (viewId: string) => {
    const result = await viewService.getViewData(viewId);
    setViewData(result.data || []);
  };

  const handleCreateView = async (name: string, query: string) => {
    if (!currentTable) return;
    const newView = await viewService.createView(currentTable.id, name, query);
    setViews([newView, ...views]);
    setShowCreateModal(false);
  };

  const handleDeleteView = async (viewId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await viewService.deleteView(viewId);
    setViews(views.filter(v => v.id !== viewId));
    if (selectedView?.id === viewId) {
      setSelectedView(null);
      setViewData([]);
    }
  };

  const handleRefreshView = async () => {
    if (!selectedView) return;
    await viewService.refreshView(selectedView.id);
    await loadViewData(selectedView.id);
  };

  if (!currentTable) return null;

  return (
    <div className="w-[500px] bg-white rounded-lg shadow-lg border flex flex-col max-h-[calc(100vh-120px)]">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">📊 查询视图</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl"
        >
          ×
        </button>
      </div>

      <div className="p-3 border-b">
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + 创建新视图
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-40 border-r overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500 text-sm">加载中...</div>
          ) : views.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              暂无视图
            </div>
          ) : (
            views.map((view) => (
              <div
                key={view.id}
                onClick={() => setSelectedView(view)}
                className={`p-3 cursor-pointer hover:bg-gray-100 border-b ${
                  selectedView?.id === view.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{view.name}</span>
                  <button
                    onClick={(e) => handleDeleteView(view.id, e)}
                    className="text-red-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 hover:opacity-100"
                    style={{ opacity: selectedView?.id === view.id ? 1 : 0.4 }}
                  >
                    🗑️
                  </button>
                </div>
                {view.is_aggregate && (
                  <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
                    聚合
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedView ? (
            <>
              <div className="p-3 border-b flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-gray-800">{selectedView.name}</h4>
                  <p className="text-xs text-gray-500 mt-0.5 truncate font-mono">
                    {selectedView.query_text}
                  </p>
                </div>
                <button
                  onClick={handleRefreshView}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  🔄 刷新
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                <ViewTable data={viewData} isAggregate={selectedView.is_aggregate} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              选择左侧视图查看结果
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <CreateViewModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateView}
        />
      )}
    </div>
  );
}
