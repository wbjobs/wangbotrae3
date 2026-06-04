import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, message } from 'antd';
import { RiseOutlined, EnvironmentOutlined, ShoppingOutlined, BarChartOutlined } from '@ant-design/icons';
import { bomApi, supplierApi } from '../services/api';
import ReactECharts from 'echarts-for-react';

function Dashboard() {
  const [stats, setStats] = useState({
    totalBOMs: 0,
    totalSuppliers: 0,
    totalCarbon: 0,
    avgCarbon: 0,
  });
  const [recentBOMs, setRecentBOMs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [bomRes, supplierRes] = await Promise.all([
        bomApi.list(),
        supplierApi.list(),
      ]);

      const boms = bomRes.data;
      const suppliers = supplierRes.data;
      const totalCarbon = boms.reduce((sum, bom) => sum + (bom.total_carbon || 0), 0);

      setStats({
        totalBOMs: boms.length,
        totalSuppliers: suppliers.length,
        totalCarbon: totalCarbon.toFixed(2),
        avgCarbon: boms.length > 0 ? (totalCarbon / boms.length).toFixed(2) : 0,
      });

      setRecentBOMs(boms.slice(0, 5).map(bom => ({
        ...bom,
        key: bom.id,
      })));
    } catch (error) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const chartOption = {
    title: {
      text: '碳排放趋势',
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
    },
    xAxis: {
      type: 'category',
      data: ['1月', '2月', '3月', '4月', '5月', '6月'],
    },
    yAxis: {
      type: 'value',
      name: 'kg CO₂e',
    },
    series: [
      {
        name: '碳排放量',
        type: 'bar',
        data: [1200, 1500, 1800, 1650, 2100, stats.totalCarbon],
        itemStyle: {
          color: '#1890ff',
        },
      },
    ],
  };

  const columns = [
    {
      title: '产品名称',
      dataIndex: 'product_name',
      key: 'product_name',
    },
    {
      title: '总碳排放',
      dataIndex: 'total_carbon',
      key: 'total_carbon',
      render: (val) => `${val?.toFixed(2) || 0} kg CO₂e`,
    },
    {
      title: '状态',
      dataIndex: 'is_validated',
      key: 'is_validated',
      render: (val) => (
        <Tag color={val ? 'success' : 'warning'}>
          {val ? '已验证' : '待验证'}
        </Tag>
      ),
    },
  ];

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>数据看板</h1>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="产品BOM数"
              value={stats.totalBOMs}
              prefix={<ShoppingOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="供应商数量"
              value={stats.totalSuppliers}
              prefix={<EnvironmentOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="总碳排放量"
              value={stats.totalCarbon}
              suffix="kg CO₂e"
              prefix={<BarChartOutlined />}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均碳排放"
              value={stats.avgCarbon}
              suffix="kg CO₂e"
              prefix={<RiseOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="碳排放趋势" loading={loading}>
            <ReactECharts option={chartOption} style={{ height: 350 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="最近BOM" loading={loading}>
            <Table
              columns={columns}
              dataSource={recentBOMs}
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default Dashboard;
