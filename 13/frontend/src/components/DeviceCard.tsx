import React, { useState } from 'react';
import { Card, Tag, Button, Space, Statistic, Progress, Popconfirm } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  BarChartOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { DeviceSimulatorConfig, DeviceStatus, DeviceData } from '@/types';
import { deviceApi, anomalyApi } from '@/services/api';
import { useAppStore } from '@/store';

interface DeviceCardProps {
  device: DeviceSimulatorConfig;
  status?: DeviceStatus;
  latestData?: DeviceData;
  onSelect: (deviceId: string) => void;
  isSelected: boolean;
}

const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  status,
  latestData,
  onSelect,
  isSelected,
}) => {
  const [loading, setLoading] = useState(false);
  const removeDevice = useAppStore((state) => state.removeDevice);
  const updateDeviceStatus = useAppStore((state) => state.updateDeviceStatus);

  const handleStart = async () => {
    setLoading(true);
    try {
      await deviceApi.start(device.device_id);
      updateDeviceStatus(device.device_id, {
        device_id: device.device_id,
        is_running: true,
        stats: status?.stats || { processed: 0, injected: 0 },
      });
    } catch (e) {
      console.error('Failed to start device:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await deviceApi.stop(device.device_id);
      updateDeviceStatus(device.device_id, {
        device_id: device.device_id,
        is_running: false,
        stats: status?.stats || { processed: 0, injected: 0 },
      });
    } catch (e) {
      console.error('Failed to stop device:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      await anomalyApi.clear(device.device_id);
      await deviceApi.delete(device.device_id);
      removeDevice(device.device_id);
    } catch (e) {
      console.error('Failed to delete device:', e);
    } finally {
      setLoading(false);
    }
  };

  const injectionRate = status?.stats?.processed
    ? ((status.stats.injected / status.stats.processed) * 100).toFixed(1)
    : '0';

  return (
    <Card
      onClick={() => onSelect(device.device_id)}
      className={`cursor-pointer transition-all hover:shadow-lg ${
        isSelected ? 'ring-2 ring-blue-500' : ''
      }`}
      style={{ background: isSelected ? '#1e3a5f' : undefined }}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h4 className="text-lg font-medium mb-1">{device.device_id}</h4>
          <Space size={[4, 4]} wrap>
            {device.metrics.map((m) => (
              <Tag key={m} color="blue">
                {m}
              </Tag>
            ))}
          </Space>
        </div>
        <Tag color={status?.is_running ? 'success' : 'default'}>
          {status?.is_running ? '运行中' : '已停止'}
        </Tag>
      </div>

      {latestData && (
        <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
          {latestData.temperature !== undefined && (
            <div className="bg-slate-700/50 rounded p-2">
              <span className="text-slate-400">温度</span>
              <span className="float-right font-mono">
                {latestData.temperature.toFixed(1)}°C
              </span>
            </div>
          )}
          {latestData.humidity !== undefined && (
            <div className="bg-slate-700/50 rounded p-2">
              <span className="text-slate-400">湿度</span>
              <span className="float-right font-mono">
                {latestData.humidity.toFixed(1)}%
              </span>
            </div>
          )}
          {latestData.voltage !== undefined && (
            <div className="bg-slate-700/50 rounded p-2">
              <span className="text-slate-400">电压</span>
              <span className="float-right font-mono">
                {latestData.voltage.toFixed(2)}V
              </span>
            </div>
          )}
          {latestData.current !== undefined && (
            <div className="bg-slate-700/50 rounded p-2">
              <span className="text-slate-400">电流</span>
              <span className="float-right font-mono">
                {latestData.current.toFixed(3)}A
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-slate-400">异常注入率</span>
          <span className="font-mono">{injectionRate}%</span>
        </div>
        <Progress
          percent={parseFloat(injectionRate)}
          size="small"
          showInfo={false}
          strokeColor="#ef4444"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <Statistic
          title="已处理"
          value={status?.stats?.processed || 0}
          valueStyle={{ fontSize: '14px', color: '#3b82f6' }}
          prefix={<BarChartOutlined />}
        />
        <Statistic
          title="已注入"
          value={status?.stats?.injected || 0}
          valueStyle={{ fontSize: '14px', color: '#ef4444' }}
          prefix={<ThunderboltOutlined />}
        />
        <Statistic
          title="时间戳修正"
          value={status?.stats?.monotonicity_corrections || 0}
          valueStyle={{ fontSize: '14px', color: '#fa541c' }}
          prefix={<SafetyCertificateOutlined />}
        />
      </div>

      <Space className="w-full">
        {!status?.is_running ? (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleStart();
            }}
            loading={loading}
            block
          >
            启动
          </Button>
        ) : (
          <Button
            icon={<PauseCircleOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleStop();
            }}
            loading={loading}
            block
          >
            停止
          </Button>
        )}
        <Popconfirm
          title="确定删除此设备？"
          onConfirm={(e) => {
          e?.stopPropagation();
          handleDelete();
        }}
          onCancel={(e) => e?.stopPropagation()}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => e.stopPropagation()}
            loading={loading}
          >
            删除
          </Button>
        </Popconfirm>
      </Space>
    </Card>
  );
};

export default DeviceCard;
