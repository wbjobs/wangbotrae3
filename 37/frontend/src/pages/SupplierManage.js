import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, message, Space, Card, Upload } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { supplierApi } from '../services/api';

function SupplierManage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const response = await supplierApi.list();
      setSuppliers(response.data.map(s => ({ ...s, key: s.id })));
    } catch (error) {
      message.error('加载供应商列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values) => {
    try {
      await supplierApi.create(values);
      message.success('添加供应商成功');
      setModalVisible(false);
      form.resetFields();
      loadSuppliers();
    } catch (error) {
      message.error('添加失败: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleUpload = async (file) => {
    try {
      const response = await supplierApi.upload(file);
      message.success(`成功导入 ${response.data.count} 个供应商`);
      loadSuppliers();
    } catch (error) {
      message.error('导入失败: ' + (error.response?.data?.detail || error.message));
    }
    return false;
  };

  const columns = [
    {
      title: '供应商代码',
      dataIndex: 'code',
      key: 'code',
    },
    {
      title: '供应商名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '地点',
      dataIndex: 'location',
      key: 'location',
    },
    {
      title: '原材料碳排放',
      dataIndex: 'material_raw_carbon',
      key: 'material_raw_carbon',
      render: (val) => `${val} kg/unit`,
    },
    {
      title: '生产碳排放',
      dataIndex: 'production_carbon',
      key: 'production_carbon',
      render: (val) => `${val} kg/unit`,
    },
    {
      title: '运输碳排放',
      dataIndex: 'transport_carbon_per_km',
      key: 'transport_carbon_per_km',
      render: (val, record) => `${val * record.transport_distance} kg`,
    },
    {
      title: '运输距离',
      dataIndex: 'transport_distance',
      key: 'transport_distance',
      render: (val) => `${val} km`,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1>供应商管理</h1>
        <Space>
          <Upload
            beforeUpload={handleUpload}
            accept=".xlsx,.xls"
            showUploadList={false}
          >
            <Button icon={<UploadOutlined />}>
              批量导入
            </Button>
          </Upload>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalVisible(true)}
          >
            添加供应商
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={suppliers}
          loading={loading}
          rowKey="id"
          pagination={{
            pageSize: 10,
          }}
        />
      </Card>

      <Modal
        title="添加供应商"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            label="供应商代码"
            name="code"
            rules={[{ required: true, message: '请输入供应商代码' }]}
          >
            <Input placeholder="请输入供应商代码" />
          </Form.Item>

          <Form.Item
            label="供应商名称"
            name="name"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="请输入供应商名称" />
          </Form.Item>

          <Form.Item
            label="地点"
            name="location"
          >
            <Input placeholder="请输入地点" />
          </Form.Item>

          <Form.Item
            label="原材料碳排放 (kg/unit)"
            name="material_raw_carbon"
            initialValue={0}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
          </Form.Item>

          <Form.Item
            label="生产碳排放 (kg/unit)"
            name="production_carbon"
            initialValue={0}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
          </Form.Item>

          <Form.Item
            label="运输碳排放 (kg/km)"
            name="transport_carbon_per_km"
            initialValue={0}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={0.001} />
          </Form.Item>

          <Form.Item
            label="运输距离 (km)"
            name="transport_distance"
            initialValue={0}
          >
            <InputNumber style={{ width: '100%' }} min={0} step={1} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default SupplierManage;
