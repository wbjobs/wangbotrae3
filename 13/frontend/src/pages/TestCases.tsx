import React, { useEffect, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Descriptions,
  Drawer,
  Empty,
  List,
  Statistic,
  Row,
  Col,
} from 'antd';
import {
  PlayCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { testCaseApi, injectionRecordApi, workflowApi } from '@/services/api';
import type { TestCase, InjectionRecord, Workflow } from '@/types';

const { TextArea } = Input;

const TestCases: React.FC = () => {
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [injectionRecords, setInjectionRecords] = useState<InjectionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedTestCase, setSelectedTestCase] = useState<TestCase | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);

  useEffect(() => {
    loadTestCases();
    loadInjectionRecords();
  }, []);

  const loadTestCases = async () => {
    try {
      setLoading(true);
      const response = await testCaseApi.getAll();
      setTestCases(response.data);
    } catch (e) {
      console.error('Failed to load test cases:', e);
      message.error('加载测试用例失败');
    } finally {
      setLoading(false);
    }
  };

  const loadInjectionRecords = async () => {
    try {
      setRecordsLoading(true);
      const response = await injectionRecordApi.getAll(undefined, 200);
      setInjectionRecords(response.data);
    } catch (e) {
      console.error('Failed to load injection records:', e);
    } finally {
      setRecordsLoading(false);
    }
  };

  const handleViewDetail = async (testCase: TestCase) => {
    setSelectedTestCase(testCase);
    setDetailVisible(true);
  };

  const handleDelete = async (testCaseId: number) => {
    try {
      await testCaseApi.delete(testCaseId);
      message.success('测试用例已删除');
      await loadTestCases();
    } catch (e) {
      console.error('Failed to delete test case:', e);
      message.error('删除失败');
    }
  };

  const handleRunTestCase = async (testCase: TestCase) => {
    try {
      const workflowData = testCase.workflow_data as Workflow;
      if (!workflowData.id) {
        workflowData.id = testCase.workflow_id;
      }
      await workflowApi.create(workflowData);
      await workflowApi.start(testCase.workflow_id);
      message.success('测试用例已启动');
    } catch (e) {
      console.error('Failed to run test case:', e);
      message.error('启动失败');
    }
  };

  const handleExport = (testCase: TestCase) => {
    const dataStr = JSON.stringify(testCase, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${testCase.name}-${testCase.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  };

  const anomalyTypeLabels: Record<string, { color: string; label: string }> = {
    packet_loss: { color: 'red', label: '丢包' },
    out_of_order: { color: 'orange', label: '乱序' },
    delay: { color: 'gold', label: '延迟' },
    value_spike: { color: 'magenta', label: '数值突变' },
    timestamp_drift: { color: 'geekblue', label: '时间戳漂移' },
    value_drift: { color: 'purple', label: '数值漂移' },
    data_stagnation: { color: 'cyan', label: '数据停滞' },
    noise_injection: { color: 'lime', label: '噪声注入' },
    time_travel_start: { color: 'blue', label: '时间旅行开始' },
    time_travel_complete: { color: 'green', label: '时间旅行完成' },
    time_travel_stopped: { color: 'red', label: '时间旅行停止' },
    timestamp_monotonicity_correction: { color: 'volcano', label: '时间戳修正' },
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: TestCase) => (
        <Space>
          <ExperimentOutlined className="text-blue-400" />
          <span>{text}</span>
          {record.workflow_data?.nodes && (
            <Tag color="blue">{record.workflow_data.nodes.length} 节点</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (text: string) => text || '-',
    },
    {
      title: '目标设备',
      dataIndex: 'device_ids',
      key: 'device_ids',
      render: (ids: string[]) => (
        <Space wrap size={[4, 4]}>
          {ids.length > 0 ? (
            ids.map((id) => <Tag key={id}>{id}</Tag>)
          ) : (
            <span className="text-slate-500">-</span>
          )}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm:ss'),
      width: 180,
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_: any, record: TestCase) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            查看
          </Button>
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined />}
            onClick={() => handleRunTestCase(record)}
            type="primary"
            ghost
          >
            执行
          </Button>
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleExport(record)}
          >
            导出
          </Button>
          <Popconfirm
            title="确定删除此测试用例？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const stats = {
    total: testCases.length,
    totalRecords: injectionRecords.length,
    affectedData: injectionRecords.reduce((sum, r) => sum + r.affected_data_count, 0),
    anomalyTypes: new Set(injectionRecords.map((r) => r.anomaly_type)).size,
  };

  return (
    <div className="space-y-6">
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="测试用例总数"
              value={stats.total}
              prefix={<ExperimentOutlined />}
              valueStyle={{ color: '#3b82f6' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="注入记录总数"
              value={stats.totalRecords}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#ef4444' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="异常类型"
              value={stats.anomalyTypes}
              prefix={<ExperimentOutlined />}
              valueStyle={{ color: '#f59e0b' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="影响数据点"
              value={stats.affectedData}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#10b981' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="测试用例列表">
        <Table
          columns={columns}
          dataSource={testCases}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: <Empty description="暂无测试用例，在异常编排中保存工作流为测试用例" /> }}
        />
      </Card>

      <Card title="异常注入记录" loading={recordsLoading}>
        {injectionRecords.length === 0 ? (
          <Empty description="暂无注入记录" />
        ) : (
          <List
            dataSource={injectionRecords.slice(0, 50)}
            renderItem={(record) => (
              <List.Item>
                <List.Item.Meta
                  avatar={
                    <div className="w-10 h-10 bg-red-900/30 rounded-full flex items-center justify-center">
                      <ThunderboltOutlined className="text-red-400" />
                    </div>
                  }
                  title={
                    <Space>
                      <span className="font-medium">{record.device_id}</span>
                      <Tag
                        color={anomalyTypeLabels[record.anomaly_type]?.color || 'default'}
                      >
                        {anomalyTypeLabels[record.anomaly_type]?.label || record.anomaly_type}
                      </Tag>
                      {record.workflow_id && (
                        <Tag color="blue">工作流: {record.workflow_id.slice(0, 8)}...</Tag>
                      )}
                    </Space>
                  }
                  description={
                    <div className="text-sm text-slate-400">
                      <div>
                        时间: {dayjs(record.start_time).format('YYYY-MM-DD HH:mm:ss')}
                        {record.end_time && ` - ${dayjs(record.end_time).format('HH:mm:ss')}`}
                      </div>
                      <div className="mt-1">
                        原始数据: {record.original_data_count} 条 · 
                        受影响: {record.affected_data_count} 条
                      </div>
                      {Object.keys(record.parameters).length > 0 && (
                        <div className="mt-1">
                          参数: {JSON.stringify(record.parameters)}
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Drawer
        title="测试用例详情"
        width={720}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        extra={
          <Space>
            <Button onClick={() => setDetailVisible(false)}>关闭</Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => selectedTestCase && handleRunTestCase(selectedTestCase)}
            >
              执行测试
            </Button>
          </Space>
        }
      >
        {selectedTestCase && (
          <div className="space-y-6">
            <Descriptions title="基本信息" bordered column={1}>
              <Descriptions.Item label="ID">{selectedTestCase.id}</Descriptions.Item>
              <Descriptions.Item label="名称">
                {selectedTestCase.name}
              </Descriptions.Item>
              <Descriptions.Item label="描述">
                {selectedTestCase.description || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="工作流ID">
                {selectedTestCase.workflow_id}
              </Descriptions.Item>
              <Descriptions.Item label="目标设备">
                {selectedTestCase.device_ids.join(', ')}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(selectedTestCase.created_at).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
            </Descriptions>

            <Card title="工作流节点" size="small">
              {selectedTestCase.workflow_data?.nodes?.map((node: any, index: number) => (
                <div
                  key={node.id}
                  className="bg-slate-700/30 rounded p-3 mb-2"
                >
                  <div className="flex justify-between items-center">
                    <Space>
                      <Tag color={node.type === 'device' ? 'blue' : node.type === 'output' ? 'green' : 'orange'}>
                        {node.type}
                      </Tag>
                      <span className="font-medium">节点 {index + 1}</span>
                    </Space>
                    <span className="text-xs text-slate-400">
                      位置: ({node.position.x}, {node.position.y})
                    </span>
                  </div>
                  {node.anomaly_config && (
                    <div className="mt-2 text-sm">
                      <div>
                        <span className="text-slate-400">异常类型:</span>{' '}
                        <Tag color={anomalyTypeLabels[node.anomaly_config.anomaly_type]?.color}>
                          {anomalyTypeLabels[node.anomaly_config.anomaly_type]?.label || node.anomaly_config.anomaly_type}
                        </Tag>
                      </div>
                      <div className="mt-1">
                        <span className="text-slate-400">参数:</span>{' '}
                        <code className="text-xs bg-slate-800 px-2 py-1 rounded">
                          {JSON.stringify(node.anomaly_config.parameters)}
                        </code>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Card>

            <Card title="工作流结构" size="small">
              <pre className="bg-slate-800 rounded p-4 overflow-auto text-xs max-h-96">
                {JSON.stringify(selectedTestCase.workflow_data, null, 2)}
              </pre>
            </Card>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default TestCases;
