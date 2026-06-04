import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, Row, Col, Slider, Typography, Space, Select } from 'antd';
import { SwapOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function ComparisonView({ taskId, resultData }) {
  const canvasRef = useRef(null);
  const [splitPos, setSplitPos] = useState(0.5);
  const [selectedView, setSelectedView] = useState(0);
  const [originalImg, setOriginalImg] = useState(null);
  const [renderedImg, setRenderedImg] = useState(null);

  useEffect(() => {
    if (!resultData || !taskId) return;

    const origUrl = resultData.original_image;
    if (origUrl) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setOriginalImg(img);
      img.src = origUrl;
    }

    if (resultData.base_color_map) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setRenderedImg(img);
      img.src = resultData.base_color_map;
    }
  }, [resultData, taskId, selectedView]);

  useEffect(() => {
    if (!canvasRef.current || !originalImg || !renderedImg) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const splitX = Math.floor(w * splitPos);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, splitX, h);
    ctx.clip();
    ctx.drawImage(originalImg, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(splitX, 0, w - splitX, h);
    ctx.clip();
    ctx.drawImage(renderedImg, 0, 0, w, h);
    ctx.restore();

    ctx.strokeStyle = '#1890ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, h);
    ctx.stroke();

    ctx.fillStyle = 'rgba(24, 144, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(splitX, h / 2, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⟺', splitX, h / 2);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('原始照片', 10, 24);
    ctx.textAlign = 'right';
    ctx.fillText('渲染结果', w - 10, 24);
  }, [originalImg, renderedImg, splitPos]);

  const handleCanvasClick = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    setSplitPos(Math.max(0.02, Math.min(0.98, ratio)));
  }, []);

  return (
    <Card
      title={<Title level={4}>🔍 对比模式：原始照片 vs 渲染结果</Title>}
      style={{ marginBottom: 24 }}
    >
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Text>视角选择：</Text>
          <Select
            value={selectedView}
            onChange={setSelectedView}
            style={{ width: 120, marginLeft: 8 }}
            options={Array.from({ length: 8 }, (_, i) => ({
              label: `视角 ${i + 1}`,
              value: i,
            }))}
          />
        </Col>
        <Col span={12}>
          <Space>
            <Text>分割线位置：</Text>
            <Slider
              min={0}
              max={100}
              value={Math.round(splitPos * 100)}
              onChange={(v) => setSplitPos(v / 100)}
              style={{ width: 200 }}
            />
          </Space>
        </Col>
      </Row>

      <div style={{ position: 'relative', width: '100%', cursor: 'col-resize' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={400}
          onClick={handleCanvasClick}
          style={{
            width: '100%',
            borderRadius: 8,
            border: '1px solid #303030',
          }}
        />
        {!originalImg && !renderedImg && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', color: '#888',
            fontSize: 16,
          }}>
            请先完成材质估计以查看对比结果
          </div>
        )}
      </div>

      {resultData && (
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={6}>
            <Text strong>纹理贴图：</Text>
          </Col>
          {['base_color_map', 'roughness_map', 'metallic_map', 'normal_map'].map((key) => (
            <Col span={6} key={key}>
              <div style={{ textAlign: 'center' }}>
                <img
                  src={resultData[key]}
                  alt={key}
                  style={{
                    width: '100%', maxHeight: 100,
                    objectFit: 'contain', borderRadius: 4,
                    border: '1px solid #333',
                  }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {key.replace('_map', '').replace(/_/g, ' ')}
                </Text>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </Card>
  );
}
