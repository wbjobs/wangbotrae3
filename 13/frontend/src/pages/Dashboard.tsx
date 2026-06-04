import React, { useEffect, useState } from 'react';
import { Row, Col, Select, Card, Space, Button, Statistic, Tag } from 'antd';
import {
  ThunderboltOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import RealTimeChart from '@/components/RealTimeChart';
import AnomalyTimeline from '@/components/AnomalyTimeline';
import { deviceApi, anomalyApi } from '@/services/api';
import { useAppStore } from '@/store';
import type { DeviceSimulatorConfig, DeviceData, AnomalyEvent } from '@/types';

const { Option } = Select;

const Dashboard: React.FC = () => {
  const devices = useAppStore((state) => state.devices);
  const deviceData = useAppStore((state) => state.deviceData);
  const anomalyEvents = useAppStore((state) => state.anomalyEvents);
  const selectedDeviceId = useAppStore((state) => state.selectedDeviceId);
  const setSelectedDevice = useAppStore((state) => state.setSelectedDevice);
  const setDevices = useAppStore((state) => state.setDevices);
  const updateDeviceStatus = useAppStore((state) => state.updateDeviceStatus);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadDevices = async () => {
    try {
      const response = await deviceApi.getAll();
      setDevices(response.data);
      if (response.data.length > 0 && !selectedDeviceId) {
        setSelectedDevice(response.data[0].device_id);
      }
    } catch (e) {
      console.error('Failed to load devices:', e);
    }
  };

  const loadStatus = async () => {
    for (const device of devices) {
      try {
        const response = await deviceApi.status(device.device_id);
        updateDeviceStatus(device.device_id, response.data);
      } catch (e) {
        // Ignore
      }
    }
  };

  const handleStartAll = async () => {
    setLoading(true);
    try {
      await deviceApi.startAll();
      await loadDevices();
    } catch (e) {
      console.error('Failed to start all:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleStopAll = async () => {
    setLoading(true);
    try {
      await deviceApi.stopAll();
      await loadDevices();
    } catch (e) {
      console.error('Failed to stop all:', e);
    } finally {
      setLoading(false);
    }
  };

  const selectedData: (DeviceData & { is_injected: boolean })[] = selectedDeviceId
    ? (deviceData[selectedDeviceId] as any) || []
    : [];

  const totalProcessed = Object.values(useAppStore.getState().deviceStatuses).reduce(
    (sum, s) => sum + (s?.stats?.processed || 0),
    0
  );
  const totalInjected = Object.values(useAppStore.getState().deviceStatuses).reduce(
    (sum, s) => sum + (s?.stats?.injected || 0),
    0
  );
  const runningDevices = devices.filter(
    (d) => useAppStore.getState().deviceStatuses[d.device_id]?.is_running
  ).length;

  const metrics = [
    { key: 'temperature', title: '温度', unit: '°C', color: '#ef4444' },
    { key: 'humidity', title: '湿度', unit: '%', color: '#3b82f6' },
    { key: 'voltage', title: '电压', unit: 'V', color: '#f59e0b' },
    { key: 'current', title: '电流', unit: 'A', color: '#10b981' },
    { key: 'pressure', title: '压力', unit: 'hPa', color: '#8b5cf6' },
  ] as const;

  const selectedDevice = devices.find((d) => d.device_id === selectedDeviceId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Select
            placeholder="选择设备"
            style={{ width: 240 }}
            value={selectedDeviceId}
            onChange={setSelectedDevice}
            allowClear
          >
            {devices.map((d) => (
              <Option key={d.device_id} value={d.device_id}>
                {d.device_id}
              </Option>
            ))}
          </Select>
          {selectedDevice && (
            <Tag color={selectedDevice.metrics.includes('temperature') ? 'red' : 'default'}>
              {selectedDevice.metrics.join(', ')}
            </Tag>
          )}
        </div>
        <Space>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleStartAll}
            loading={loading}
          >
            全部启动
          </Button>
          <Button
            icon={<PauseCircleOutlined />}
            onClick={handleStopAll}
            loading={loading}
          >
            全部停止
          </Button>
        </Space>
      </div>

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="运行设备"
              value={runningDevices}
              suffix={`/ ${devices.length}`}
              prefix={<DatabaseOutlined />}
              valueStyle={{ color: '#3b82f6' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已处理数据点"
              value={totalProcessed}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#10b981' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已注入异常"
              value={totalInjected}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#ef4444' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日事件"
              value={anomalyEvents.length}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#f59e0b' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={18}>
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {selectedDeviceId && selectedData.length > 0 ? (
              metrics
                .filter((m) => selectedDevice?.metrics.includes(m.key))
                .map((metric) => (
                  <RealTimeChart
                    key={metric.key}
                    data={selectedData}
                    metric={metric.key}
                    title={`${metric.title} (${metric.unit})`}
                    unit={metric.unit}
                    color={metric.color}
                  />
                ))
            ) : (
              <Card className="text-center py-12">
                <DatabaseOutlined className="text-6xl text-slate-600 mb-4" />
                <p className="text-slate-400">
                  {selectedDeviceId
                    ? '暂无数据，请先启动设备'
                    : '请选择一个设备查看实时数据'}
                </p>
              </Card>
            )}
          </Space>
        </Col>
        <Col span={6}>
          <AnomalyTimeline events={anomalyEvents} limit={50} />
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
