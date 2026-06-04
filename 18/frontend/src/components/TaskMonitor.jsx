import React, { useState, useEffect, useRef } from 'react';
import { Card, Typography, Progress, Tag, Space, Button } from 'antd';
import { CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import { getResultFileUrl } from '../api';

const { Title, Text } = Typography;

const STATUS_CONFIG = {
  SUBMITTED: { color: 'blue', icon: <LoadingOutlined />, text: '已提交' },
  RUNNING: { color: 'orange', icon: <LoadingOutlined />, text: '运行中' },
  COMPLETED: { color: 'green', icon: <CheckCircleOutlined />, text: '已完成' },
  FAILED: { color: 'red', icon: <CloseCircleOutlined />, text: '失败' },
  PENDING: { color: 'default', icon: <LoadingOutlined />, text: '等待中' },
};

export default function TaskMonitor({ taskId, status, onStatusUpdate }) {
  const [lossHistory, setLossHistory] = useState([]);
  const canvasRef = useRef(null);

  const config = STATUS_CONFIG[status?.status] || STATUS_CONFIG.PENDING;

  useEffect(() => {
    if (!canvasRef.current || lossHistory.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    const maxLoss = Math.max(...lossHistory);
    const minLoss = Math.min(...lossHistory);
    const range = maxLoss - minLoss || 1;
    const pad = 40;

    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();

    ctx.strokeStyle = '#1890ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    lossHistory.forEach((loss, i) => {
      const x = pad + (i / (lossHistory.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((loss - minLoss) / range) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(maxLoss.toFixed(4), pad - 4, pad + 4);
    ctx.fillText(minLoss.toFixed(4), pad - 4, h - pad);

    ctx.textAlign = 'center';
    ctx.fillText('迭代次数', w / 2, h - 4);
  }, [lossHistory]);

  useEffect(() => {
    if (status?.status === 'COMPLETED' && taskId) {
      fetch(`/api/v1/results/${taskId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.loss_history) {
            setLossHistory(data.loss_history);
          }
        })
        .catch(() => {});
    }
  }, [status?.status, taskId]);

  return (
    <Card
      title={<Title level={4}>📊 任务状态</Title>}
      style={{ marginBottom: 24 }}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Tag color={config.color} icon={config.icon} style={{ fontSize: 14, padding: '4px 12px' }}>
            {config.text}
          </Tag>
          {status?.message && <Text type="secondary" style={{ marginLeft: 8 }}>{status.message}</Text>}
        </div>

        {status?.progress !== undefined && status.status === 'RUNNING' && (
          <Progress
            percent={Math.round(status.progress * 100)}
            status="active"
            strokeColor={{ from: '#108ee9', to: '#87d068' }}
          />
        )}

        {lossHistory.length > 0 && (
          <div>
            <Text strong>Loss收敛曲线</Text>
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              style={{ width: '100%', marginTop: 8, borderRadius: 4 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              最终 Loss: {lossHistory[lossHistory.length - 1]?.toFixed(6)} | 迭代次数: {lossHistory.length}
            </Text>
          </div>
        )}

        {status?.status === 'COMPLETED' && taskId && (
          <Space>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={getResultFileUrl(taskId, 'estimated_material.mtlx')}
              target="_blank"
            >
              下载 MaterialX
            </Button>
            <Button
              icon={<DownloadOutlined />}
              href={getResultFileUrl(taskId, 'estimated_material.mdl')}
              target="_blank"
            >
              下载 MDL
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}
