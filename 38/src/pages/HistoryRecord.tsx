import { useState, useMemo, useEffect } from 'react';
import { Search, Filter, Download, Calendar, ChevronDown } from 'lucide-react';
import { HistoryTable } from '../components/HistoryTable';
import { StatisticsCharts } from '../components/StatisticsCharts';
import { useDiagnosis } from '../hooks/useDiagnosis';
import { DeviceStatus, DeviceStatusLabels } from '../../shared/types';
import type { DiagnosisResult } from '../../shared/types';
import { formatTimestamp } from '../utils/format';

export function HistoryRecord() {
  const { diagnosisHistory, fetchDiagnosisHistory } = useDiagnosis();
  const [activeTab, setActiveTab] = useState<'list' | 'statistics'>('list');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | ''>('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [showFilters, setShowFilters] = useState(false);

  const mockHistory = useMemo((): DiagnosisResult[] => {
    if (diagnosisHistory.length > 0) return diagnosisHistory;

    const statuses: DeviceStatus[] = [
      DeviceStatus.NORMAL,
      DeviceStatus.NORMAL,
      DeviceStatus.NORMAL,
      DeviceStatus.NORMAL,
      DeviceStatus.BEARING_FAULT,
      DeviceStatus.GEAR_FAULT,
      DeviceStatus.IMBALANCE,
    ];

    return Array.from({ length: 100 }, (_, i) => {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const confidence = status === DeviceStatus.NORMAL
        ? 0.85 + Math.random() * 0.15
        : 0.7 + Math.random() * 0.25;

      return {
        id: `hist-${i}`,
        deviceId: `dev-00${(i % 3) + 1}`,
        timestamp: Date.now() - i * 3600000 - Math.random() * 1800000,
        status,
        confidence,
        probabilities: {
          normal: status === DeviceStatus.NORMAL ? confidence : (1 - confidence) * 0.5,
          bearing_fault: status === DeviceStatus.BEARING_FAULT ? confidence : (1 - confidence) * 0.2,
          gear_fault: status === DeviceStatus.GEAR_FAULT ? confidence : (1 - confidence) * 0.15,
          imbalance: status === DeviceStatus.IMBALANCE ? confidence : (1 - confidence) * 0.15,
        },
        signalDuration: 8 + Math.random() * 4,
        sampleRate: 10000,
      };
    });
  }, [diagnosisHistory]);

  const filteredData = useMemo(() => {
    return mockHistory.filter((item) => {
      if (searchText && !item.deviceId.toLowerCase().includes(searchText.toLowerCase())) {
        return false;
      }
      if (statusFilter && item.status !== statusFilter) {
        return false;
      }
      if (deviceFilter && item.deviceId !== deviceFilter) {
        return false;
      }
      return true;
    });
  }, [mockHistory, searchText, statusFilter, deviceFilter]);

  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  useEffect(() => {
    fetchDiagnosisHistory({ page, pageSize });
  }, [fetchDiagnosisHistory, page, pageSize]);

  const handleViewDetail = (item: DiagnosisResult) => {
    console.log('View detail:', item);
  };

  const handleDownload = (item: DiagnosisResult) => {
    const content = JSON.stringify(item, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnosis-${item.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAll = () => {
    const content = JSON.stringify(filteredData, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnosis-history-${formatTimestamp(Date.now()).replace(/[:\s]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">诊断历史记录</h2>
          <div className="flex rounded-lg overflow-hidden border border-slate-600">
            <button
              onClick={() => setActiveTab('list')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'list' ? 'bg-[#165DFF] text-white' : 'bg-transparent text-slate-400 hover:text-white'
              }`}
            >
              记录列表
            </button>
            <button
              onClick={() => setActiveTab('statistics')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'statistics' ? 'bg-[#165DFF] text-white' : 'bg-transparent text-slate-400 hover:text-white'
              }`}
            >
              统计分析
            </button>
          </div>
        </div>

        {activeTab === 'list' && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportAll}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              导出全部
            </button>
          </div>
        )}
      </div>

      {activeTab === 'list' && (
        <>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="搜索设备ID..."
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      setPage(1);
                    }}
                    className="w-full pl-10 pr-4 py-2 input-field text-sm"
                  />
                </div>

                <select
                  value={deviceFilter}
                  onChange={(e) => {
                    setDeviceFilter(e.target.value);
                    setPage(1);
                  }}
                  className="input-field text-sm min-w-32"
                >
                  <option value="">全部设备</option>
                  <option value="dev-001">电机组A-01</option>
                  <option value="dev-002">齿轮箱B-02</option>
                  <option value="dev-003">泵站C-03</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as DeviceStatus | '');
                    setPage(1);
                  }}
                  className="input-field text-sm min-w-32"
                >
                  <option value="">全部状态</option>
                  {Object.entries(DeviceStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                  showFilters ? 'bg-[#165DFF]/20 text-[#165DFF]' : 'bg-slate-700/50 text-slate-400 hover:text-white'
                }`}
              >
                <Filter className="w-4 h-4" />
                更多筛选
                <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {showFilters && (
              <div className="pt-4 border-t border-slate-700/50 grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">开始时间</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="datetime-local"
                      className="w-full pl-10 pr-4 py-2 input-field text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">结束时间</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="datetime-local"
                      className="w-full pl-10 pr-4 py-2 input-field text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">最小置信度</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    defaultValue="70"
                    className="w-full accent-[#165DFF]"
                  />
                  <div className="text-xs text-slate-500 mt-1">70%</div>
                </div>
                <div className="flex items-end">
                  <button className="btn-primary text-sm w-full">
                    应用筛选
                  </button>
                </div>
              </div>
            )}
          </div>

          <HistoryTable
            data={paginatedData}
            total={filteredData.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onView={handleViewDetail}
            onDownload={handleDownload}
          />
        </>
      )}

      {activeTab === 'statistics' && <StatisticsCharts />}
    </div>
  );
}

export default HistoryRecord;
