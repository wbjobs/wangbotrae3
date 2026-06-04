import React, { useState, useEffect } from 'react';
import { Card, Form, Select, Button, Table, message, Space, Row, Col, Statistic, Divider } from 'antd';
import { BarChartOutlined, ArrowDownOutlined, ArrowUpOutlined, SwapOutlined } from '@ant-design/icons';
import { bomApi, analysisApi } from '../services/api';
import ReactECharts from 'echarts-for-react';

function HypothesisAnalysis() {
  const [boms, setBoms] = useState([]);
  const [comparisons, setComparisons] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadBOMs();
    loadComparisons();
  }, []);

  const loadBOMs = async () => {
    try {
      const response = await bomApi.list();
      setBoms(response.data);
    } catch (error) {
      message.error('加载BOM列表失败');
    }
  };

  const loadComparisons = async () => {
    try {
      const response = await analysisApi.listComparisons();
      setComparisons(response.data.map(c => ({ ...c, key: c.id })));
    } catch (error) {
      message.error('加载对比记录失败');
    }
  };

  const handleCompare = async (values) => {
    try {
      setLoading(true);
      const response = await analysisApi.compare({
        ...values,
        name: `对比分析 - ${new Date().toLocaleString()}`,
      });
      setResult(response.data);
      message.success('对比分析完成');
      loadComparisons();
    } catch (error) {
      message.error('对比分析失败: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const chartOption = result ? {
    title: {
      text: '碳排放对比',
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
    },
    legend: {
      data: ['原始方案', '修改方案'],
      top: 30,
    },
    xAxis: {
      type: 'category',
      data: ['总碳排放量 (kg CO₂e)'],
    },
    yAxis: {
      type: 'value',
      name: 'kg CO₂e',
    },
    series: [
      {
        name: '原始方案',
        type: 'bar',
        data: [result.original_total],
        itemStyle: {
          color: '#1890ff',
        },
        barWidth: 60,
      },
      {
        name: '修改方案',
        type: 'bar',
        data: [result.modified_total],
        itemStyle: {
          color: '#3f8600',
        },
        barWidth: 60,
      },
    ],
  } : null;

  const columns = [
    {
      title: '分析名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '原始碳排放',
      dataIndex: 'original_total',
      key: 'original_total',
      render: (val) => `${val?.toFixed(2)} kg`,
    },
    {
      title: '修改后碳排放',
      dataIndex: 'modified_total',
      key: 'modified_total',
      render: (val) => `${val?.toFixed(2)} kg`,
    },
    {
      title: '差值',
      dataIndex: 'difference',
      key: 'difference',
      render: (val) => (
        <span style={{ color: val > 0 ? '#cf1322' : '#3f8600' }}>
          {val > 0 ? '+' : ''}{val?.toFixed(2)} kg
        </span>
      ),
    },
    {
      title: '变化率',
      dataIndex: 'percentage_change',
      key: 'percentage_change',
      render: (val) => (
        <span style={{ color: val > 0 ? '#cf1322' : '#3f8600' }}>
          {val > 0 ? '+' : ''}{val?.toFixed(2)}%
        </span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val).toLocaleString(),
    },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>假设分析</h1>

      <Card title="方案对比" style={{ marginBottom: 24 }}>
        <Form
          form={form}
          layout="inline"
          onFinish={handleCompare}
          style={{ marginBottom: 24 }}
        >
          <Form.Item
            label="原始BOM"
            name="original_bom_id"
            rules={[{ required: true, message: '请选择原始BOM' }]}
          >
            <Select
              placeholder="请选择原始BOM"
              style={{ width: 250 }}
            >
              {boms.map(bom => (
                <Select.Option key={bom.id} value={bom.id}>
                  {bom.product_name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="修改后BOM"
            name="modified_bom_id"
            rules={[{ required: true, message: '请选择修改后BOM' }]}
          >
            <Select
              placeholder="请选择修改后BOM"
              style={{ width: 250 }}
            >
              {boms.map(bom => (
                <Select.Option key={bom.id} value={bom.id}>
                  {bom.product_name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={<SwapOutlined />}
            >
              开始对比
            </Button>
          </Form.Item>
        </Form>

        {result && (
          <div>
            <Divider />
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="原始方案碳排放"
                    value={result.original_total}
                    suffix="kg CO₂e"
                    valueStyle={{ color: '#1890ff' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="修改方案碳排放"
                    value={result.modified_total}
                    suffix="kg CO₂e"
                    valueStyle={{ color: '#3f8600' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="差值"
                    value={result.difference}
                    prefix={result.difference > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                    suffix="kg CO₂e"
                    valueStyle={{ color: result.difference > 0 ? '#cf1322' : '#3f8600' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card>
                  <Statistic
                    title="变化率"
                    value={result.percentage_change}
                    suffix="%"
                    valueStyle={{ color: result.percentage_change > 0 ? '#cf1322' : '#3f8600' }}
                  />
                </Card>
              </Col>
            </Row>

            <ReactECharts option={chartOption} style={{ height: 350 }} />
          </div>
        )}
      </Card>

      <Card title="历史对比记录">
        <Table
          columns={columns}
          dataSource={comparisons}
          rowKey="id"
          pagination={{
            pageSize: 10,
          }}
        />
      </Card>
    </div>
  );
}

export default HypothesisAnalysis;
