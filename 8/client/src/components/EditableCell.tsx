import { useState, useRef, useEffect } from 'react';

interface EditableCellProps {
  value: any;
  columnType: 'text' | 'number' | 'date' | 'select' | 'attachment';
  columnConfig?: Record<string, any>;
  onChange: (newValue: any, oldValue: any) => void;
}

export default function EditableCell({
  value,
  columnType,
  columnConfig,
  onChange,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (columnType !== 'select') {
        inputRef.current.select();
      }
    }
  }, [isEditing, columnType]);

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue !== value) {
      onChange(editValue, value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
      if (editValue !== value) {
        onChange(editValue, value);
      }
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (columnType === 'date' && val) {
      return new Date(val).toLocaleDateString();
    }
    return String(val);
  };

  if (isEditing) {
    if (columnType === 'select') {
      const options = columnConfig?.options || [];
      return (
        <select
          value={editValue || ''}
          onChange={(e) => {
            setEditValue(e.target.value);
            setIsEditing(false);
            if (e.target.value !== value) {
              onChange(e.target.value, value);
            }
          }}
          onBlur={handleBlur}
          className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        >
          <option value="">-- 请选择 --</option>
          {options.map((opt: string, idx: number) => (
            <option key={idx} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        ref={inputRef}
        type={columnType === 'number' ? 'number' : columnType === 'date' ? 'date' : 'text'}
        value={editValue ?? ''}
        onChange={(e) =>
          setEditValue(
            columnType === 'number'
              ? e.target.value
                ? Number(e.target.value)
                : null
              : e.target.value
          )
        }
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className="px-2 py-1 text-sm text-gray-700 min-h-[32px] flex items-center cursor-text hover:bg-gray-100 rounded"
      title="双击编辑"
    >
      {formatValue(value) || <span className="text-gray-400">--</span>}
    </div>
  );
}
