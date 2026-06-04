import { useState } from 'react';

interface AddColumnModalProps {
  onClose: () => void;
  onSubmit: (name: string, type: string, config?: Record<string, any>) => void;
}

const COLUMN_TYPES = [
  { value: 'text', label: '文本', icon: '📝' },
  { value: 'number', label: '数字', icon: '🔢' },
  { value: 'date', label: '日期', icon: '📅' },
  { value: 'select', label: '单选', icon: '📋' },
  { value: 'attachment', label: '附件', icon: '📎' },
];

export default function AddColumnModal({ onClose, onSubmit }: AddColumnModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const config: Record<string, any> = {};
    if (type === 'select' && options.trim()) {
      config.options = options.split('\n').filter((o) => o.trim());
    }

    onSubmit(name.trim(), type, config);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          添加新列
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              列名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border-gray-300 border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="输入列名称..."
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              列类型
            </label>
            <div className="grid grid-cols-2 gap-2">
              {COLUMN_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => setType(ct.value)}
                  className={`px-3 py-2 rounded-lg border text-sm ${
                    type === ct.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="mr-1">{ct.icon}</span>
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          {type === 'select' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                选项（每行一个选项）
              </label>
              <textarea
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                className="w-full rounded-md border-gray-300 border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="选项1&#10;选项2&#10;选项3"
                rows={4}
              />
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
              disabled={!name.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
