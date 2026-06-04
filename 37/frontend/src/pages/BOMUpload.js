import React, { useState } from 'react';
import { Card, Upload, Button, message, Tabs, Form, Input, Space, Divider } from 'antd';
import { UploadOutlined, InboxOutlined } from '@ant-design/icons';
import { bomApi } from '../services/api';
import { useNavigate } from 'react-router-dom';

const { Dragger } = Upload;
const { TabPane } = Tabs;
const { TextArea } = Input;

function BOMUpload() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const uploadProps = {
    name: 'file',
    accept: '.xlsx,.xls',
    multiple: false,
    showUploadList: true,
    beforeUpload: (file) => {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      if (!isExcel) {
        message.error('仅支持Excel文件！');
        return false;
      }
      return true;
    },
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        setLoading(true);
        const response = await bomApi.upload(file);
        message.success(`BOM上传成功！产品: ${response.data.product_name}`);
        onSuccess(response.data);
        setTimeout(() => {
          navigate(`/bom/${response.data.bom_id}`);
        }, 1500);
      } catch (error) {
        message.error('上传失败: ' + (error.response?.data?.detail || error.message));
        onError(error);
      } finally {
        setLoading(false);
      }
    },
  };

  const handleManualSubmit = async (values) => {
    try {
      setLoading(true);
      const response = await bomApi.create(values);
      message.success('BOM创建成功！');
      navigate(`/bom/${response.data.id}`);
    } catch (error) {
      message.error('创建失败: ' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>上传BOM</h1>

      <Card>
        <Tabs defaultActiveKey="upload">
          <TabPane tab="文件上传" key="upload">
            <Dragger {...uploadProps} disabled={loading}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
              <p className="ant-upload-hint">
                支持 .xlsx, .xls 格式的BOM文件
              </p>
            </Dragger>

            <Divider />

            <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
              <h4>Excel文件格式要求：</h4>
              <ul>
                <li><b>product_name</b>: 产品名称</li>
                <li><b>part_number</b>: 零件编号</li>
                <li><b>part_name</b>: 零件名称</li>
                <li><b>quantity</b>: 数量</li>
                <li><b>unit</b>: 单位</li>
                <li><b>level</b>: 层级</li>
                <li><b>parent_part_number</b>: 父零件编号</li>
                <li><b>material_type</b>: 材料类型</li>
                <li><b>supplier_code</b>: 供应商代码</li>
              </ul>
            </div>
          </TabPane>

          <TabPane tab="手动创建" key="manual">
            <Form
              form={form}
              layout="vertical"
              onFinish={handleManualSubmit}
              style={{ maxWidth: 600 }}
            >
              <Form.Item
                label="产品名称"
                name="product_name"
                rules={[{ required: true, message: '请输入产品名称' }]}
              >
                <Input placeholder="请输入产品名称" />
              </Form.Item>

              <Form.Item label="产品描述" name="description">
                <TextArea rows={4} placeholder="请输入产品描述" />
              </Form.Item>

              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={loading}>
                    创建BOM
                  </Button>
                  <Button onClick={() => form.resetFields()}>
                    重置
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
}

export default BOMUpload;
