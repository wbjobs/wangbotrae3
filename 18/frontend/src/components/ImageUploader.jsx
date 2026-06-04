import React, { useRef } from 'react';
import { Upload, Button, Card, Image, Space, Typography } from 'antd';
import { InboxOutlined, DeleteOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Dragger } = Upload;

export default function ImageUploader({ onImagesSelected, uploadedFiles, setUploadedFiles, taskId }) {
  const uploadProps = {
    name: 'images',
    multiple: true,
    accept: 'image/png,image/jpeg,image/bmp,image/tiff',
    fileList: uploadedFiles,
    beforeUpload: (file) => {
      setUploadedFiles((prev) => [...prev, file]);
      return false;
    },
    onRemove: (file) => {
      setUploadedFiles((prev) => prev.filter((f) => f.uid !== file.uid));
    },
  };

  const minImages = 8;
  const canProceed = uploadedFiles.length >= minImages;

  return (
    <Card
      title={<Title level={4}>📷 上传多视角图片</Title>}
      style={{ marginBottom: 24 }}
    >
      <Dragger {...uploadProps} style={{ padding: '20px 0' }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
        </p>
        <p className="ant-upload-text">点击或拖拽图片到此区域上传</p>
        <p className="ant-upload-hint">
          请上传至少 {minImages} 张不同视角的照片，支持 PNG/JPG/BMP/TIFF 格式
        </p>
      </Dragger>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Text type={canProceed ? 'success' : 'warning'}>
          已选择 {uploadedFiles.length} / {minImages} 张（最少）图片
        </Text>
      </div>

      {uploadedFiles.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Title level={5}>已上传图片预览</Title>
          <Space wrap size="small">
            {uploadedFiles.map((file, idx) => (
              <div key={file.uid} style={{ position: 'relative', display: 'inline-block' }}>
                <Image
                  src={URL.createObjectURL(file)}
                  width={80}
                  height={80}
                  style={{ objectFit: 'cover', borderRadius: 4 }}
                  preview={false}
                />
                <div style={{
                  position: 'absolute', top: 2, left: 2,
                  background: 'rgba(0,0,0,0.6)', color: '#fff',
                  fontSize: 10, padding: '1px 4px', borderRadius: 2,
                }}>
                  #{idx + 1}
                </div>
              </div>
            ))}
          </Space>
        </div>
      )}

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button
          type="primary"
          size="large"
          disabled={!canProceed}
          onClick={() => onImagesSelected(uploadedFiles)}
        >
          上传并继续
        </Button>
      </div>
    </Card>
  );
}
