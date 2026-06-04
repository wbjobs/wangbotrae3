import React, { useEffect, useState } from 'react';
import {
  Row,
  Col,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Card,
  message,
  Tag,
  Divider,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import DeviceCard from '@/components/DeviceCard';
import { deviceApi, anomalyApi } from '@/services/api';
import { useAppStore } from '@/store';
import type { DeviceSimulatorConfig, DeviceStatus } from '@/types';

const { Option } = Select;

const DeviceManager: React.FC = () => {
  const devices = useAppStore((state) => state.devices);
  const deviceData = useAppStore((state) => state.deviceData);
  const deviceStatuses = useAppStore((state) => state.deviceStatuses);
  const selectedDeviceId = useAppStore((state) => state.selectedDeviceId);
  const setSelectedDevice = useAppStore((state) => state.setSelectedDevice);
  const setDevices = useAppStore((state) => state.setDevices);
  const addDevice = useAppStore((state) => state.addDevice);
  const updateDeviceStatus = useAppStore((state) => state.updateDeviceStatus);

  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const loadDevices = async () => {
    try {
      const response = await deviceApi.getAll();
      setDevices(response.data);
    } catch (e) {
      console.error('Failed to load devices:', e);
      message.error('加载设备失败');
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

  const handleCreateDevice = async (values: any) => {
    setLoading(true);
    try {
      const config: DeviceSimulatorConfig = {
        device_id: values.device_id,
        metrics: values.metrics,
        interval: values.interval,
        temperature_base: values.temperature_base,
        temperature_variance: values.temperature_variance,
        humidity_base: values.humidity_base,
        humidity_variance: values.humidity_variance,
        voltage_base: values.voltage_base,
        voltage_variance: values.voltage_variance,
        current_base: values.current_base,
        current_variance: values.current_variance,
        pressure_base: values.pressure_base,
        pressure_variance: values.pressure_variance,
      };

      const response = await deviceApi.create(config);
      addDevice(response.data);
      
      updateDeviceStatus(config.device_id, {
        device_id: config.device_id,
        is_running: false,
        stats: { processed: 0, injected: 0 },
      });

      message.success('设备创建成功');
      setModalVisible(false);
      form.resetFields();
    } catch (e: any) {
      console.error('Failed to create device:', e);
      message.error(e.response?.data?.detail || '创建设备失败');
    } finally {
      setLoading(false);
    }
  };

  const getLatestData = (deviceId: string) => {
    const data = deviceData[deviceId];
    return data && data.length > 0 ? data[data.length - 1] : undefined;
  };

  const metricOptions = [
    { label: '温度 (temperature)', value: 'temperature' },
    { label: '湿度 (humidity)', value: 'humidity' },
    { label: '电压 (voltage)', value: 'voltage' },
    { label: '电流 (current)', value: 'current' },
    { label: '压力 (pressure)', value: 'pressure' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold m-0">设备管理</h2>
          <p className="text-slate-400 text-sm mt-1">
            共 {devices.length} 个设备，
            {Object.values(deviceStatuses).filter((s) => s?.is_running).length} 个运行中
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          size="large"
          onClick={() => setModalVisible(true)}
        >
          创建设备
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {devices.length === 0 ? (
          <Col span={24}>
            <Card className="text-center py-12">
              <div className="text-6xl mb-4">📱</div>
              <p className="text-slate-400 mb-4">暂无设备，点击上方按钮创建模拟设备</p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setModalVisible(true)}
              >
                创建设备
              </Button>
            </Card>
          </Col>
        ) : (
          devices.map((device) => (
            <Col key={device.device_id} xs={24} sm={12} lg={8} xl={6}>
              <DeviceCard
                device={device}
                status={deviceStatuses[device.device_id]}
                latestData={getLatestData(device.device_id) as any}
                onSelect={setSelectedDevice}
                isSelected={selectedDeviceId === device.device_id}
              />
            </Col>
          ))
        )}
      </Row>

      <Modal
        title="创建模拟设备"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreateDevice}
          initialValues={{
            interval: 1.0,
            metrics: ['temperature', 'humidity', 'voltage'],
            temperature_base: 25.0,
            temperature_variance: 2.0,
            humidity_base: 50.0,
            humidity_variance: 5.0,
            voltage_base: 3.7,
            voltage_variance: 0.1,
            current_base: 0.5,
            current_variance: 0.05,
            pressure_base: 1013.25,
            pressure_variance: 5.0,
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="device_id"
                label="设备ID"
                rules={[{ required: true, message: '请输入设备ID' }]}
              >
                <Input placeholder="例如: sensor-001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="interval"
                label="数据上报间隔 (秒)"
                rules={[{ required: true, message: '请输入上报间隔' }]}
              >
                <InputNumber min={0.1} max={60} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="metrics"
            label="上报指标"
            rules={[{ required: true, message: '请选择至少一个指标' }]}
          >
            <Select mode="multiple" placeholder="选择要上报的指标">
              {metricOptions.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Divider orientation="left">指标参数配置</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="temperature_base" label="温度基准值 (°C)">
                <InputNumber step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="temperature_variance" label="温度波动范围 (±°C)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="humidity_base" label="湿度基准值 (%)">
                <InputNumber step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="humidity_variance" label="湿度波动范围 (±%)">
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="voltage_base" label="电压基准值 (V)">
                <InputNumber step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="voltage_variance" label="电压波动范围 (±V)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="current_base" label="电流基准值 (A)">
                <InputNumber step={0.001} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="current_variance" label="电流波动范围 (±A)">
                <InputNumber min={0} step={0.001} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="pressure_base" label="压力基准值 (hPa)">
                <InputNumber step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="pressure_variance" label="压力波动范围 (±hPa)">
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item className="mb-0">
            <Space className="w-full" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={loading}>
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DeviceManager;
