import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Row, Col, Statistic, Button, Space, Tabs, Table, Alert, Spin, message, Progress } from 'antd';
import { ArrowLeftOutlined, CalculatorOutlined, CheckCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bomApi } from '../services/api';
import ReactECharts from 'echarts-for-react';

const { TabPane } = Tabs;

function BOMDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bom, setBom] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sankeyData, setSankeyData] = useState(null);
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBOMData();
  }, [id]);

  const loadBOMData = async () => {
    try {
      setLoading(true);
      const [bomRes, summaryRes, sankeyRes, validateRes] = await Promise.all([
        bomApi.get(id),
        bomApi.summary(id).catch(() => ({ data: null })),
        bomApi.sankey(id).catch(() => ({ data: null })),
        bomApi.validate(id),
      ]);

      setBom(bomRes.data);
      setSummary(summaryRes.data);
      setSankeyData(sankeyRes.data);
      setValidation(validateRes.data);
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async () => {
    try {
      await bomApi.calculate(id);
      message.success('计算任务已启动');
      setTimeout(() => loadBOMData(), 2000);
    } catch (error) {
      message.error('启动计算失败');
    }
  };

  const handleDownloadReport = () => {
    window.open(bomApi.downloadReport(id), '_blank');
  };

  const sankeyOption = sankeyData ? {
    title: {
      text: '碳足迹流向图',
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} kg CO₂e',
    },
    series: [
      {
        type: 'sankey',
        layout: 'none',
        emphasis: {
          focus: 'adjacency',
        },
        data: sankeyData.nodes,
        links: sankeyData.links,
        lineStyle: {
          color: 'gradient',
          curveness: 0.5,
        },
        label: {
          show: true,
          fontSize: 12,
        },
      },
    ],
  } : null;

  const pieOption = summary ? {
    title: {
      text: '碳排放构成',
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} kg CO₂e ({d}%)',
    },
    legend: {
      orient: 'vertical',
      left: 'left',
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        data: [
          { value: summary.raw_material_total, name: '原材料获取' },
          { value: summary.production_total, name: '生产制造' },
          { value: summary.transport_total, name: '运输配送' },
        ],
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  } : null;

  const partColumns = [
    {
      title: '零件编号',
      dataIndex: 'part_number',
      key: 'part_number',
    },
    {
      title: '零件名称',
      dataIndex: 'part_name',
      key: 'part_name',
    },
    {
      title: '原材料',
      dataIndex: 'raw_material_carbon',
      key: 'raw_material_carbon',
      render: (val) => val?.toFixed(2),
    },
    {
      title: '生产',
      dataIndex: 'production_carbon',
      key: 'production_carbon',
      render: (val) => val?.toFixed(2),
    },
    {
      title: '运输',
      dataIndex: 'transport_carbon',
      key: 'transport_carbon',
      render: (val) => val?.toFixed(2),
    },
    {
      title: '子部件',
      dataIndex: 'children_carbon',
      key: 'children_carbon',
      render: (val) => val?.toFixed(2),
    },
    {
      title: '总计',
      dataIndex: 'total_carbon',
      key: 'total_carbon',
      render: (val) => <b>{val?.toFixed(2)}</b>,
    },
  ];

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/bom/list')}
            style={{ marginRight: 16 }}
          >
            返回列表
          </Button>
          <span style={{ fontSize: 24, fontWeight: 'bold' }}>{bom?.product_name}</span>
        </div>
        <Space>
          <Button
            icon={<CheckCircleOutlined />}
            type={validation?.is_valid ? 'default' : 'warning'}
            onClick={loadBOMData}
          >
            {validation?.is_valid ? '已验证' : '未验证'}
          </Button>
          <Button
            icon={<CalculatorOutlined />}
            type="primary"
            onClick={handleCalculate}
          >
            计算碳排放
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={handleDownloadReport}
          >
            导出报告
          </Button>
        </Space>
      </div>

      {validation && !validation.is_valid && (
        <Alert
          message="数据校验警告"
          description={
            <div>
              {validation.errors?.map((err, i) => (
                <div key={i} style={{ color: '#ff4d4f' }}>错误: {err}</div>
              ))}
              {validation.warnings?.map((warn, i) => (
                <div key={i} style={{ color: '#faad14' }}>警告: {warn}</div>
              ))}
            </div>
          }
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总碳排放量"
              value={summary?.total_carbon || 0}
              suffix="kg CO₂e"
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="原材料获取"
              value={summary?.raw_material_total || 0}
              suffix="kg CO₂e"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="生产制造"
              value={summary?.production_total || 0}
              suffix="kg CO₂e"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="运输配送"
              value={summary?.transport_total || 0}
              suffix="kg CO₂e"
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      <Tabs defaultActiveKey="sankey">
        <TabPane tab="碳足迹流向" key="sankey">
          <Card>
            {sankeyOption ? (
              <ReactECharts option={sankeyOption} style={{ height: 500 }} />
            ) : (
              <div style={{ textAlign: 'center', padding: 100, color: '#999' }}>
                请先计算碳排放数据
              </div>
            )}
          </Card>
        </TabPane>

        <TabPane tab="碳排放构成" key="composition">
          <Row gutter={16}>
            <Col span={12}>
              <Card>
                {pieOption ? (
                  <ReactECharts option={pieOption} style={{ height: 400 }} />
                ) : (
                  <div style={{ textAlign: 'center', padding: 100, color: '#999' }}>
                    请先计算碳排放数据
                  </div>
                )}
              </Card>
            </Col>
            <Col span={12}>
              <Card title="阶段占比">
                <div style={{ padding: '20px 0' }}>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span>原材料获取</span>
                      <span>{((summary?.raw_material_total || 0) / (summary?.total_carbon || 1) * 100).toFixed(1)}%</span>
                    </div>
                    <Progress
                      percent={((summary?.raw_material_total || 0) / (summary?.total_carbon || 1) * 100)}
                      strokeColor="#1890ff"
                      showInfo={false}
                    />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span>生产制造</span>
                      <span>{((summary?.production_total || 0) / (summary?.total_carbon || 1) * 100).toFixed(1)}%</span>
                    </div>
                    <Progress
                      percent={((summary?.production_total || 0) / (summary?.total_carbon || 1) * 100)}
                      strokeColor="#3f8600"
                      showInfo={false}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span>运输配送</span>
                      <span>{((summary?.transport_total || 0) / (summary?.total_carbon || 1) * 100).toFixed(1)}%</span>
                    </div>
                    <Progress
                      percent={((summary?.transport_total || 0) / (summary?.total_carbon || 1) * 100)}
                      strokeColor="#fa8c16"
                      showInfo={false}
                    />
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
        </TabPane>

        <TabPane tab="零件详情" key="parts">
          <Card>
            <Table
              columns={partColumns}
              dataSource={summary?.part_details || []}
              rowKey="part_id"
              pagination={false}
              scroll={{ x: 800 }}
            />
          </Card>
        </TabPane>
      </Tabs>
    </div>
  );
}

export default BOMDetail;
