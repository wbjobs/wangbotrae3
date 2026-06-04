import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Typography, Steps, message, Divider, ConfigProvider, theme } from 'antd';
import ImageUploader from './components/ImageUploader';
import ParameterPanel from './components/ParameterPanel';
import TaskMonitor from './components/TaskMonitor';
import MaterialPreview from './components/MaterialPreview';
import ComparisonView from './components/ComparisonView';
import { uploadImages, startEstimation, getTaskStatus, getResult, getPreviewComparison, getResultFileUrl } from './api';

const { Header, Content } = Layout;
const { Title, Paragraph } = Typography;

const STEPS = [
  { title: '上传图片', description: '上传至少8张多视角照片' },
  { title: '参数设置', description: '配置BRDF模型和初始参数' },
  { title: '逆向估计', description: '运行可微分渲染优化' },
  { title: '结果查看', description: '3D预览与对比分析' },
];

export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [taskId, setTaskId] = useState(null);
  const [taskStatus, setTaskStatus] = useState(null);
  const [resultData, setResultData] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [textureUrls, setTextureUrls] = useState(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  const pollStatus = useCallback(async (id) => {
    try {
      const status = await getTaskStatus(id);
      setTaskStatus(status);

      if (status.status === 'COMPLETED') {
        setPolling(false);
        setCurrentStep(3);
        message.success('材质估计完成！');

        const result = await getResult(id);
        setResultData(result);

        const preview = await getPreviewComparison(id, 0);
        setPreviewData(preview);

        const urls = {};
        if (preview.base_color_map) urls.baseColor = preview.base_color_map;
        if (preview.roughness_map) urls.roughness = preview.roughness_map;
        if (preview.metallic_map) urls.metallic = preview.metallic_map;
        if (preview.normal_map) urls.normal = preview.normal_map;
        setTextureUrls(urls);
      } else if (status.status === 'FAILED') {
        setPolling(false);
        message.error('估计任务失败: ' + (status.message || '未知错误'));
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, []);

  useEffect(() => {
    if (!polling || !taskId) return;
    const interval = setInterval(() => pollStatus(taskId), 2000);
    return () => clearInterval(interval);
  }, [polling, taskId, pollStatus]);

  const handleImagesSelected = async (files) => {
    setLoading(true);
    try {
      const result = await uploadImages(files);
      setTaskId(result.task_id);
      setCurrentStep(1);
      message.success(`成功上传 ${result.num_images} 张图片`);
    } catch (err) {
      message.error('上传失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleEstimate = async (params) => {
    if (!taskId) {
      message.warning('请先上传图片');
      return;
    }
    setLoading(true);
    try {
      const estimationParams = {
        brdfType: params.brdfType,
        imageSize: params.imageSize,
        numIterations: params.numIterations,
        learningRate: params.learningRate,
        exportFormat: params.exportFormat,
        initialRoughness: params.initialRoughness,
        initialMetallic: params.initialMetallic,
      };

      await startEstimation(taskId, estimationParams);
      setCurrentStep(2);
      setPolling(true);
      message.info('逆向估计任务已提交，请等待...');
    } catch (err) {
      message.error('启动估计失败: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <Layout style={{ minHeight: '100vh', background: '#0d0d1a' }}>
        <Header style={{
          background: 'linear-gradient(135deg, #0d0d2b, #1a1a4e)',
          borderBottom: '1px solid #2a2a5a',
          padding: '0 40px',
          display: 'flex',
          alignItems: 'center',
        }}>
          <Title level={3} style={{ color: '#e0e0ff', margin: 0 }}>
            🧊 材质逆向估计服务
          </Title>
          <Paragraph style={{ color: '#8888bb', margin: '0 0 0 20px', fontSize: 13 }}>
            基于可微分渲染的未知光源下多视角材质参数估计
          </Paragraph>
        </Header>

        <Content style={{ padding: '24px 40px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
          <Steps
            current={currentStep}
            items={STEPS}
            style={{ marginBottom: 32 }}
            size="small"
          />

          {currentStep === 0 && (
            <ImageUploader
              onImagesSelected={handleImagesSelected}
              uploadedFiles={uploadedFiles}
              setUploadedFiles={setUploadedFiles}
              taskId={taskId}
            />
          )}

          {(currentStep >= 1) && (
            <ParameterPanel
              onSubmit={handleEstimate}
              onReset={() => {}}
              loading={loading}
              taskId={taskId}
            />
          )}

          {(currentStep >= 2) && (
            <TaskMonitor
              taskId={taskId}
              status={taskStatus}
              onStatusUpdate={setTaskStatus}
            />
          )}

          {currentStep === 3 && (
            <>
              <Divider />
              <MaterialPreview
                taskId={taskId}
                textureUrls={textureUrls}
              />
              <ComparisonView
                taskId={taskId}
                resultData={previewData}
              />
            </>
          )}
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
