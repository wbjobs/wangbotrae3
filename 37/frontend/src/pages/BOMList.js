import React, { useState, useEffect } from 'react';
import { Table, Button, Space, Tag, Modal, message, Popconfirm } from 'antd';
import { PlusOutlined, EyeOutlined, DeleteOutlined, FileTextOutlined, CalculatorOutlined } from '@ant-design/icons';
import { bomApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

function BOMList() {
  const [boms, setBoms] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadBOMs();
  }, []);

  const loadBOMs = async () => {
    try {
      setLoading(true);
      const response = await bomApi.list();
      setBoms(response.data.map(bom => ({ ...bom, key: bom.id })));
    } catch (error) {
      message.error('加载BOM列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await bomApi.delete(id);
      message.success('删除成功');
      loadBOMs();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleCalculate = async (id) => {
    try {
      const response = await bomApi.calculate(id);
      message.success('计算任务已启动，请稍候...');
      setTimeout(() => loadBOMs(), 2000);
    } catch (error) {
      message.error('启动计算失败');
    }
  };

  const handleDownloadReport = (id) => {
    window.open(bomApi.downloadReport(id), '_blank');
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
    },
    {
      title: '产品名称',
      dataIndex: 'product_name',
      key: 'product_name',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
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
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/bom/${record.id}`)}
          >
            详情
          </Button>
          <Button
            type="link"
            icon={<CalculatorOutlined />}
            onClick={() => handleCalculate(record.id)}
          >
            计算
          </Button>
          <Button
            type="link"
            icon={<FileTextOutlined />}
            onClick={() => handleDownloadReport(record.id)}
          >
            报告
          </Button>
          <Popconfirm
            title="确定删除此BOM吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>BOM管理</h1>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => navigate('/bom/upload')}
        >
          上传BOM
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={boms}
        loading={loading}
        rowKey="id"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
      />
    </div>
  );
}

export default BOMList;
