import { useState } from 'react';
import { BatchUploader } from '../components/BatchUploader';
import { TaskList } from '../components/TaskList';
import { useDiagnosis } from '../hooks/useDiagnosis';
import type { Device } from '../../shared/types';

export function OfflineAnalysis() {
  const { devices, currentDevice, batchTasks, selectDevice, uploadAndDiagnose } = useDiagnosis();
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(currentDevice);

  const handleDeviceSelect = (device: Device) => {
    setSelectedDevice(device);
    selectDevice(device);
  };

  const handleUpload = async (file: File, deviceId: string) => {
    await uploadAndDiagnose(file, deviceId);
  };

  const handleCancelTask = (id: string) => {
    console.log('Cancel task:', id);
  };

  const handleDownloadResult = (id: string) => {
    console.log('Download result:', id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">离线分析中心</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">选择目标设备:</span>
          <div className="flex gap-2">
            {devices.map((device) => (
              <button
                key={device.id}
                onClick={() => handleDeviceSelect(device)}
                className={`px-4 py-2 text-sm rounded-lg transition-all ${
                  selectedDevice?.id === device.id
                    ? 'bg-[#165DFF] text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                {device.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-3">
          <div className="glass-card p-6">
            <h3 className="text-white font-medium mb-4">批量上传诊断</h3>
            <BatchUploader
              device={selectedDevice}
              onUpload={handleUpload}
            />
          </div>
        </div>

        <div className="col-span-2">
          <TaskList
            tasks={batchTasks}
            onCancel={handleCancelTask}
            onDownload={handleDownloadResult}
          />
        </div>
      </div>

      <div className="glass-card p-6">
        <h3 className="text-white font-medium mb-4">支持的文件格式</h3>
        <div className="grid grid-cols-5 gap-4">
          {[
            { ext: '.wav', name: 'WAVE 音频', desc: '标准音频波形文件' },
            { ext: '.mp3', name: 'MP3 音频', desc: '压缩音频格式' },
            { ext: '.csv', name: 'CSV 数据', desc: '逗号分隔值文本' },
            { ext: '.mat', name: 'MATLAB 数据', desc: 'MATLAB 工作区文件' },
            { ext: '.bin', name: '二进制数据', desc: '原始二进制采样数据' },
          ].map((format) => (
            <div key={format.ext} className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <div className="text-lg font-mono font-bold text-[#165DFF] mb-1">{format.ext}</div>
              <div className="text-sm text-white font-medium mb-0.5">{format.name}</div>
              <div className="text-xs text-slate-500">{format.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default OfflineAnalysis;
