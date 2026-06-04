import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';

type ExportFormat = 'excel' | 'geojson';

export function ExportPage() {
  const { samples, isOnline } = useAppContext();
  const [format, setFormat] = useState<ExportFormat>('excel');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleExport = async () => {
    if (!isOnline) {
      setError('离线状态无法导出，请连接网络后重试');
      return;
    }

    setExporting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format })
      });

      if (!response.ok) {
        throw new Error('导出失败');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'excel' ? 'xlsx' : 'geojson';
      a.download = `geology-samples-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setSuccess(`成功导出 ${samples.length} 条记录`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>数据导出</h2>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="card">
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
          导出设置
        </h3>
        
        <div className="form-group">
          <label className="form-label">导出格式</label>
          <select
            className="form-select"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <option value="excel">Excel (.xlsx)</option>
            <option value="geojson">GeoJSON (.geojson)</option>
          </select>
        </div>

        <div className="detail-row">
          <span className="detail-label">待导出记录数</span>
          <span className="detail-value">{samples.length} 条</span>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
          格式说明
        </h3>
        
        {format === 'excel' ? (
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <p>• 导出为 Excel 电子表格格式</p>
            <p>• 包含采样编号、岩石类型、GPS坐标、照片数量等信息</p>
            <p>• 适用于数据分析和报告生成</p>
          </div>
        ) : (
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            <p>• 导出为 GeoJSON 地理数据格式</p>
            <p>• 包含采样点的空间坐标和属性信息</p>
            <p>• 可直接导入 GIS 软件（如 QGIS、ArcGIS）进行地图可视化</p>
          </div>
        )}
      </div>

      <button
        className="btn btn-primary btn-block btn-lg"
        onClick={handleExport}
        disabled={exporting || samples.length === 0 || !isOnline}
      >
        {exporting ? '导出中...' : !isOnline ? '离线不可导出' : `导出 ${samples.length} 条记录`}
      </button>
    </div>
  );
}
