import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSampleById, getPhotosByIds } from '../lib/indexedDB';
import { SamplePoint, SamplePhotoFull, ROCK_TYPE_LABELS } from '@shared/types';
import { formatDate, formatCoordinate } from '@shared/utils';

export function SampleDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sample, setSample] = useState<SamplePoint | null>(null);
  const [photos, setPhotos] = useState<SamplePhotoFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadSample();
    }
  }, [id]);

  const loadSample = async () => {
    if (!id) return;
    const data = await getSampleById(id);
    setSample(data || null);
    
    if (data && data.photos.length > 0) {
      const photoIds = data.photos.map(p => p.id);
      const loadedPhotos = await getPhotosByIds(photoIds);
      setPhotos(loadedPhotos);
    }
    
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!sample) {
    return (
      <div className="empty-state">
        <div className="empty-icon">❓</div>
        <div className="empty-title">采样点不存在</div>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
    );
  }

  const getSyncBadge = () => {
    switch (sample.syncStatus) {
      case 'synced':
        return <span className="badge badge-success">已同步</span>;
      case 'pending':
        return <span className="badge badge-warning">待同步</span>;
      case 'syncing':
        return <span className="badge badge-info">同步中</span>;
      case 'error':
        return <span className="badge badge-error">同步失败</span>;
      default:
        return <span className="badge badge-error">未同步</span>;
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button 
          className="btn btn-secondary" 
          onClick={() => navigate('/')}
          style={{ padding: '0.5rem' }}
        >
          ←
        </button>
        <h2 style={{ fontSize: '1.25rem' }}>采样点详情</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title" style={{ fontSize: '1.25rem' }}>{sample.sampleNumber}</div>
            <div className="card-subtitle">{formatDate(sample.createdAt)}</div>
          </div>
          {getSyncBadge()}
        </div>

        <div className="detail-row">
          <span className="detail-label">岩石类型</span>
          <span className="detail-value">{ROCK_TYPE_LABELS[sample.rockType]}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">GPS坐标</span>
          <span className="detail-value">
            {formatCoordinate(sample.location.latitude, sample.location.longitude)}
          </span>
        </div>

        {sample.location.altitude !== undefined && (
          <div className="detail-row">
            <span className="detail-label">海拔</span>
            <span className="detail-value">{sample.location.altitude.toFixed(1)} m</span>
          </div>
        )}

        {sample.location.accuracy !== undefined && (
          <div className="detail-row">
            <span className="detail-label">定位精度</span>
            <span className="detail-value">±{sample.location.accuracy.toFixed(0)} m</span>
          </div>
        )}

        {sample.description && (
          <div className="detail-row">
            <span className="detail-label">描述</span>
            <span className="detail-value" style={{ textAlign: 'right' }}>{sample.description}</span>
          </div>
        )}

        <div className="detail-row">
          <span className="detail-label">设备ID</span>
          <span className="detail-value" style={{ fontSize: '0.75rem' }}>{sample.deviceId}</span>
        </div>

        {sample.lastSyncAt && (
          <div className="detail-row">
            <span className="detail-label">上次同步</span>
            <span className="detail-value">{formatDate(sample.lastSyncAt)}</span>
          </div>
        )}
      </div>

      {photos.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            照片 ({photos.length})
          </h3>
          <div className="photo-grid">
            {photos.map((photo) => (
              <div 
                key={photo.id} 
                className="photo-item"
                onClick={() => setSelectedPhoto(photo.data)}
                style={{ cursor: 'pointer' }}
              >
                <img src={photo.data} alt="采样照片" />
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedPhoto && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            cursor: 'pointer'
          }}
          onClick={() => setSelectedPhoto(null)}
        >
          <img 
            src={selectedPhoto} 
            alt="放大照片" 
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
          <span style={{ position: 'absolute', top: '1rem', right: '1rem', color: 'white', fontSize: '2rem' }}>
            ×
          </span>
        </div>
      )}
    </div>
  );
}
