import { useState } from 'react';
import { Plus, Search, MoreVertical, Edit2, Trash2, Power, Wrench } from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { useDiagnosis } from '../hooks/useDiagnosis';
import type { Device } from '../../shared/types';

export function DeviceManagement() {
  const { devices, currentDevice, selectDevice, fetchDevices } = useDiagnosis();
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const filteredDevices = devices.filter((device) => {
    if (searchText && !device.name.toLowerCase().includes(searchText.toLowerCase()) &&
        !device.id.toLowerCase().includes(searchText.toLowerCase())) {
      return false;
    }
    if (statusFilter !== 'all' && device.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const handleAddDevice = () => {
    setShowAddModal(true);
  };

  const handleEditDevice = (device: Device) => {
    console.log('Edit device:', device);
  };

  const handleDeleteDevice = (device: Device) => {
    if (confirm(`确定要删除设备 "${device.name}" 吗？`)) {
      console.log('Delete device:', device.id);
    }
  };

  const statusCounts = {
    all: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    maintenance: devices.filter(d => d.status === 'maintenance').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">设备管理</h2>
        <button
          onClick={handleAddDevice}
          className="flex items-center gap-2 btn-primary"
        >
          <Plus className="w-4 h-4" />
          添加设备
        </button>
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {[
              { key: 'all', label: '全部设备', color: 'text-white' },
              { key: 'online', label: '在线', color: 'text-[#00B42A]' },
              { key: 'offline', label: '离线', color: 'text-slate-500' },
              { key: 'maintenance', label: '维护中', color: 'text-[#FF7D00]' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setStatusFilter(item.key)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-all ${
                  statusFilter === item.key
                    ? 'bg-slate-700/50'
                    : 'hover:bg-slate-700/30'
                }`}
              >
                <span className={item.color}>{item.label}</span>
                <span className="text-slate-500">({statusCounts[item.key as keyof typeof statusCounts]})</span>
              </button>
            ))}
          </div>

          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索设备名称或ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-10 pr-4 py-2 input-field text-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {filteredDevices.map((device) => (
          <div key={device.id} className="relative group">
            <DeviceCard
              device={device}
              selected={currentDevice?.id === device.id}
              onSelect={selectDevice}
              onEdit={handleEditDevice}
            />
            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-1 bg-slate-800 rounded-lg border border-slate-700 p-1">
                <button
                  onClick={() => handleEditDevice(device)}
                  className="p-1.5 rounded hover:bg-slate-700/50 transition-colors"
                  title="编辑"
                >
                  <Edit2 className="w-4 h-4 text-slate-400" />
                </button>
                <button
                  onClick={() => handleDeleteDevice(device)}
                  className="p-1.5 rounded hover:bg-slate-700/50 transition-colors"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4 text-slate-400" />
                </button>
                <div className="w-px h-4 bg-slate-600" />
                <button
                  className="p-1.5 rounded hover:bg-slate-700/50 transition-colors"
                  title="更多操作"
                >
                  <MoreVertical className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredDevices.length === 0 && (
        <div className="glass-card p-12 text-center">
          <div className="text-slate-400 text-sm">没有找到匹配的设备</div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass-card p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-white mb-4">添加新设备</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">设备名称</label>
                <input type="text" className="w-full input-field" placeholder="例如: 电机组A-01" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">设备类型</label>
                <input type="text" className="w-full input-field" placeholder="例如: 异步电动机" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">安装位置</label>
                <input type="text" className="w-full input-field" placeholder="例如: 1号车间-A区" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">采样率 (Hz)</label>
                  <input type="number" className="w-full input-field" defaultValue={10000} />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">传感器数量</label>
                  <input type="number" className="w-full input-field" defaultValue={3} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowAddModal(false)}
                className="btn-secondary text-sm"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  fetchDevices();
                }}
                className="btn-primary text-sm"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeviceManagement;
