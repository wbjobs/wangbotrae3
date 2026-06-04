import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Form,
  Select,
  DatePicker,
  InputNumber,
  Button,
  Space,
  List,
  Progress,
  Tag,
  message,
  Popconfirm,
  Statistic,
} from 'antd';
import {
  HistoryOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { deviceApi, timeTravelApi, dataApi } from '@/services/api';
import type { DeviceSimulatorConfig, PlaybackStatus } from '@/types';

const { RangePicker } = DatePicker;
const { Option } = Select;

const TimeTravel: React.FC = () => {
  const [form] = Form.useForm();
  const [devices, setDevices] = useState<DeviceSimulatorConfig[]>([]);
  const [playbacks, setPlaybacks] = useState<PlaybackStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  useEffect(() => {
    loadDevices();
    loadPlaybacks();
    const interval = setInterval(loadPlaybacks, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadDevices = async () => {
    try {
      const response = await deviceApi.getAll();
      setDevices(response.data);
    } catch (e) {
      console.error('Failed to load devices:', e);
    }
  };

  const loadPlaybacks = async () => {
    try {
      const response = await timeTravelApi.getAll();
      setPlaybacks(response.data);
    } catch (e) {
      console.error('Failed to load playbacks:', e);
    }
  };

  const handlePreview = async () => {
    if (!selectedDevice || !dateRange) {
      message.warning('请选择设备和时间范围');
      return;
    }

    try {
      setLoading(true);
      const response = await dataApi.query(
        selectedDevice,
        dateRange[0].toISOString(),
        dateRange[1].toISOString()
      );
      setPreviewData(response.data);
      message.success(`找到 ${response.data.length} 条历史数据`);
    } catch (e) {
      console.error('Failed to preview data:', e);
      message.error('查询历史数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStartPlayback = async (values: any) => {
    if (!selectedDevice || !dateRange) {
      message.warning('请选择设备和时间范围');
      return;
    }

    try {
      setLoading(true);
      const response = await timeTravelApi.start({
        device_id: selectedDevice,
        start_time: dateRange[0].toISOString(),
        end_time: dateRange[1].toISOString(),
        playback_speed: values.playback_speed || 1.0,
      });
      message.success(`回放已启动，ID: ${response.data.playback_id}`);
      await loadPlaybacks();
    } catch (e: any) {
      console.error('Failed to start playback:', e);
      message.error(e.response?.data?.detail || '启动回放失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStopPlayback = async (playbackId: string) => {
    try {
      await timeTravelApi.stop(playbackId);
      message.success('回放已停止');
      await loadPlaybacks();
    } catch (e) {
      console.error('Failed to stop playback:', e);
      message.error('停止回放失败');
    }
  };

  const dataPointsByMetric: Record<string, number> = {};
  previewData.forEach((d) => {
    dataPointsByMetric[d.metric] = (dataPointsByMetric[d.metric] || 0) + 1;
  });

  const startTime = previewData.length > 0 ? previewData[0]?.timestamp : null;
  const endTime = previewData.length > 0 ? previewData[previewData.length - 1]?.timestamp : null;

  return (
    <div className="space-y-6">
      <Row gutter={16}>
        <Col span={12}>
          <Card title="时间旅行配置" icon={<HistoryOutlined />}>
            <Form
              form={form}
              layout="vertical"
              onFinish={handleStartPlayback}
              initialValues={{ playback_speed: 1.0 }}
            >
              <Form.Item
                name="device_id"
                label="选择设备"
                rules={[{ required: true, message: '请选择设备' }]}
              >
                <Select
                  placeholder="选择要回放的设备"
                  value={selectedDevice}
                  onChange={(val) => {
                    setSelectedDevice(val);
                    setPreviewData([]);
                  }}
                >
                  {devices.map((d) => (
                    <Option key={d.device_id} value={d.device_id}>
                      {d.device_id}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                label="选择历史时间范围"
                rules={[{ required: true, message: '请选择时间范围' }]}
              >
                <RangePicker
                  showTime
                  style={{ width: '100%' }}
                  value={dateRange}
                  onChange={(val) => {
                    setDateRange(val as [Dayjs, Dayjs]);
                    setPreviewData([]);
                  }}
                  disabledDate={(current) => current && current > dayjs().endOf('day')}
                />
              </Form.Item>

              <Form.Item
                name="playback_speed"
                label="回放速度"
                tooltip="1.0 表示实时速度，2.0 表示2倍速"
              >
                <InputNumber
                  min={0.1}
                  max={10}
                  step={0.1}
                  style={{ width: '100%' }}
                  addonAfter="x"
                />
              </Form.Item>

              <Form.Item>
                <Space className="w-full">
                  <Button
                    icon={<HistoryOutlined />}
                    onClick={handlePreview}
                    loading={loading}
                    block
                  >
                    预览数据
                  </Button>
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    htmlType="submit"
                    loading={loading}
                    disabled={previewData.length === 0}
                    block
                  >
                    开始回放
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="数据预览">
            {previewData.length > 0 ? (
              <div className="space-y-4">
                <Row gutter={16}>
                  <Col span={12}>
                    <Statistic
                      title="数据点总数"
                      value={previewData.length}
                      prefix={<ClockCircleOutlined />}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="指标种类"
                      value={Object.keys(dataPointsByMetric).length}
                      prefix={<ThunderboltOutlined />}
                    />
                  </Col>
                </Row>

                <div className="space-y-2">
                  <div className="text-sm text-slate-400">各指标数据量:</div>
                  {Object.entries(dataPointsByMetric).map(([metric, count]) => (
                    <div key={metric}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{metric}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                      <Progress
                        percent={(count / previewData.length) * 100}
                        size="small"
                        showInfo={false}
                        strokeColor="#3b82f6"
                      />
                    </div>
                  ))}
                </div>

                {startTime && endTime && (
                  <div className="bg-slate-700/50 rounded p-3 text-sm">
                    <div className="text-slate-400 mb-1">时间范围:</div>
                    <div>开始: {dayjs(startTime).format('YYYY-MM-DD HH:mm:ss')}</div>
                    <div>结束: {dayjs(endTime).format('YYYY-MM-DD HH:mm:ss')}</div>
                    <div className="mt-2 text-slate-400">
                      时长: {dayjs(endTime).diff(dayjs(startTime), 'minute')} 分钟
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500">
                <HistoryOutlined className="text-5xl mb-4 opacity-50" />
                <p>选择设备和时间范围后点击"预览数据"</p>
                <p className="text-sm mt-1">系统将查询该时间段的历史数据</p>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Card title="运行中的回放任务">
        {playbacks.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <PlayCircleOutlined className="text-4xl mb-3 opacity-50" />
            <p>暂无运行中的回放任务</p>
          </div>
        ) : (
          <List
            dataSource={playbacks}
            renderItem={(playback) => (
              <List.Item
                actions={[
                  playback.is_running ? (
                    <Popconfirm
                      title="确定停止此回放？"
                      onConfirm={() => handleStopPlayback(playback.id)}
                    >
                      <Button
                        type="text"
                        danger
                        icon={<StopOutlined />}
                        size="small"
                      />
                    </Popconfirm>
                  ) : null,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <div className="w-10 h-10 bg-blue-900/50 rounded-full flex items-center justify-center">
                      <HistoryOutlined className="text-blue-400" />
                    </div>
                  }
                  title={
                    <Space>
                      <span>{playback.device_id}</span>
                      <Tag color={playback.is_running ? 'processing' : 'default'}>
                        {playback.is_running ? '回放中' : '已完成'}
                      </Tag>
                      <Tag color="blue">{playback.playback_speed}x 速度</Tag>
                    </Space>
                  }
                  description={
                    <div className="mt-2">
                      <div className="text-xs text-slate-400 mb-1">
                        进度: {playback.current_index} / {playback.total_points}
                      </div>
                      <Progress
                        percent={playback.progress * 100}
                        size="small"
                        status={playback.is_running ? 'active' : 'success'}
                        strokeColor={playback.is_running ? '#3b82f6' : '#10b981'}
                      />
                      <div className="text-xs text-slate-400 mt-2">
                        原始时间: {dayjs(playback.original_start).format('MM-DD HH:mm')} - {dayjs(playback.original_end).format('MM-DD HH:mm')}
                      </div>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card title="功能说明" type="inner">
        <ul className="text-sm text-slate-400 space-y-2">
          <li>• <strong>时间旅行</strong> 允许您将历史某段时间的异常模式重放到当前数据流</li>
          <li>• 选择设备和历史时间范围，系统将查询该时间段内的所有数据</li>
          <li>• 调整回放速度可以加快或减慢数据回放</li>
          <li>• 回放的数据将通过异常注入引擎，可以叠加其他异常</li>
          <li>• 回放过程中可以在"实时监控"页面查看数据</li>
        </ul>
      </Card>
    </div>
  );
};

export default TimeTravel;
