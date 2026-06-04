import { useState } from 'react';
import { useStore } from '../store/useStore';

interface CreateViewModalProps {
  onClose: () => void;
  onSubmit: (name: string, query: string) => Promise<void>;
}

const EXAMPLE_QUERIES = [
  { label: '简单过滤', query: "SELECT * FROM table WHERE status = 'active'" },
  { label: '数字比较', query: 'SELECT * FROM table WHERE age >= 18' },
  { label: '计数聚合', query: 'SELECT COUNT(*) FROM table' },
  { label: '分组求和', query: 'SELECT category, SUM(amount) FROM table GROUP BY category' },
  { label: '多条件', query: "SELECT name, email FROM table WHERE age >= 18 AND status = 'active'" },
];

export default function CreateViewModal({ onClose, onSubmit }: CreateViewModalProps) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('SELECT * FROM table');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const { currentTable } = useStore();

  const handleTest = async () => {
    if (!currentTable) return;
    setTesting(true);
    setError(null);
    try {
      const response = await fetch(`/api/tables/${currentTable.id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setPreview(result);
    } catch (err: any) {
      setError(err.message || '查询错误');
      setPreview(null);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('请输入视图名称');
      return;
    }
    try {
      setError(null);
      await onSubmit(name.trim(), query);
    } catch (err: any) {
      setError(err.message || '创建失败');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          创建查询视图
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              视图名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border-gray-300 border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例如：活跃用户列表"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              SQL 查询
            </label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border-gray-300 border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={4}
              placeholder="SELECT * FROM table WHERE status = 'active'"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              查询示例（点击使用）
            </label>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUERIES.map((example, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setQuery(example.query)}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded"
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {testing ? '测试中...' : '🧪 测试查询'}
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          {preview && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                预览结果 ({preview.data.length} 行)
              </p>
              <div className="max-h-40 overflow-auto bg-gray-50 rounded p-2">
                <pre className="text-xs text-gray-600">
                  {JSON.stringify(preview.data.slice(0, 5), null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              创建视图
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
