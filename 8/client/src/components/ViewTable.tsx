interface ViewTableProps {
  data: Record<string, any>[];
  isAggregate?: boolean;
}

export default function ViewTable({ data, isAggregate }: ViewTableProps) {
  if (data.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        暂无数据
      </div>
    );
  }

  const columns = Object.keys(data[0]).filter(k => k !== '_id');

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(2);
    }
    return String(value);
  };

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            {!isAggregate && (
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-12">
                #
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col}
                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase border-l border-gray-200"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {data.map((row, idx) => (
            <tr key={row._id || idx} className="hover:bg-gray-50">
              {!isAggregate && (
                <td className="px-3 py-2 text-gray-500">
                  {idx + 1}
                </td>
              )}
              {columns.map((col) => (
                <td
                  key={col}
                  className="px-3 py-2 border-l border-gray-100"
                >
                  {formatValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
