import React from 'react';
import { Card, Form, Slider, Select, InputNumber, Button, Row, Col, Typography, Space } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { Option } = Select;

export default function ParameterPanel({ onSubmit, onReset, loading, taskId }) {
  const [form] = Form.useForm();

  const handleFinish = (values) => {
    onSubmit(values);
  };

  return (
    <Card
      title={<Title level={4}>⚙️ 参数设置</Title>}
      style={{ marginBottom: 24 }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          brdfType: 'disney',
          imageSize: 256,
          numIterations: 200,
          learningRate: 0.01,
          exportFormat: 'materialx',
          initialRoughness: 0.5,
          initialMetallic: 0.0,
        }}
        onFinish={handleFinish}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="BRDF模型" name="brdfType">
              <Select>
                <Option value="disney">Disney Principled (推荐)</Option>
                <Option value="ggx">GGX</Option>
                <Option value="lambertian">Lambertian</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="输出格式" name="exportFormat">
              <Select>
                <Option value="materialx">MaterialX (.mtlx)</Option>
                <Option value="mdl">NVIDIA MDL (.mdl)</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="图像分辨率" name="imageSize">
              <Select>
                <Option value={128}>128×128</Option>
                <Option value={256}>256×256</Option>
                <Option value={512}>512×512</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="迭代次数" name="numIterations">
              <InputNumber min={50} max={2000} step={50} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="学习率" name="learningRate">
              <InputNumber min={0.001} max={0.1} step={0.005} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Title level={5}>初始参数估计</Title>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="初始粗糙度 (Roughness)">
              <Form.Item name="initialRoughness" noStyle>
                <Slider min={0} max={1} step={0.01} marks={{ 0: '光滑', 0.5: '中等', 1: '粗糙' }} />
              </Form.Item>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="初始金属度 (Metallic)">
              <Form.Item name="initialMetallic" noStyle>
                <Slider min={0} max={1} step={0.01} marks={{ 0: '非金属', 0.5: '半金属', 1: '金属' }} />
              </Form.Item>
            </Form.Item>
          </Col>
        </Row>

        <Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              icon={<ExperimentOutlined />}
              size="large"
              loading={loading}
              disabled={!taskId}
            >
              开始逆向估计
            </Button>
            <Button onClick={() => form.resetFields()} size="large">
              重置参数
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
