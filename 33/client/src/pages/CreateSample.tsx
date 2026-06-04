import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { RockType, ROCK_TYPE_LABELS, SamplePhotoFull, GeoLocation } from '@shared/types';
import { capturePhoto, selectPhoto } from '../lib/camera';
import { getCurrentPosition } from '../lib/geolocation';
import { createSample } from '../lib/syncManager';
import { formatCoordinate } from '@shared/utils';

export function CreateSample() {
  const navigate = useNavigate();
  const locationState = useLocation().state as { preselectedLocation?: GeoLocation } | null;
  const [sampleNumber, setSampleNumber] = useState('');
  const [rockType, setRockType] = useState<RockType>('unknown');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<SamplePhotoFull[]>([]);
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPreselectedLocation, setIsPreselectedLocation] = useState(false);

  useEffect(() => {
    if (locationState?.preselectedLocation) {
      setLocation(locationState.preselectedLocation);
      setIsPreselectedLocation(true);
    } else {
      fetchLocation();
    }
  }, [locationState]);

  const fetchLocation = async () => {
    setLocationLoading(true);
    setLocationError(null);
    setIsPreselectedLocation(false);
    try {
      const loc = await getCurrentPosition();
      setLocation(loc);
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : '获取位置失败');
    } finally {
      setLocationLoading(false);
    }
  };

  const handleCapturePhoto = async () => {
    try {
      const photo = await capturePhoto();
      setPhotos(prev => [...prev, photo]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '拍照失败');
    }
  };

  const handleSelectPhoto = async () => {
    try {
      const photo = await selectPhoto();
      setPhotos(prev => [...prev, photo]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '选择照片失败');
    }
  };

  const handleRemovePhoto = (photoId: string) => {
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!sampleNumber.trim()) {
      setError('请输入采样编号');
      return;
    }

    if (!location) {
      setError('请获取GPS坐标');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await createSample({
        sampleNumber: sampleNumber.trim(),
        rockType,
        location,
        description: description.trim() || undefined,
        photos
      });
      
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>新建采样点</h2>
      
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            基本信息
          </h3>
          
          <div className="form-group">
            <label className="form-label">采样编号 *</label>
            <input
              type="text"
              className="form-input"
              value={sampleNumber}
              onChange={(e) => setSampleNumber(e.target.value)}
              placeholder="例如: HQ-2024-001"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">岩石类型</label>
            <select
              className="form-select"
              value={rockType}
              onChange={(e) => setRockType(e.target.value as RockType)}
            >
              {Object.entries(ROCK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">描述备注</label>
            <textarea
              className="form-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选：填写岩石特征、采集环境等信息"
            />
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            GPS 坐标
          </h3>
          
          {locationLoading ? (
            <div className="loading">
              <div className="spinner"></div>
            </div>
          ) : location ? (
            <div>
              {isPreselectedLocation && (
                <div className="badge badge-info" style={{ marginBottom: '0.5rem' }}>
                  📍 地图选择位置
                </div>
              )}
              <div className="location-info" style={{ marginBottom: '1rem' }}>
                <div className="location-row">
                  <span className="location-icon">📍</span>
                  <span>{formatCoordinate(location.latitude, location.longitude)}</span>
                </div>
                {location.altitude !== undefined && (
                  <div className="location-row">
                    <span>📏</span>
                    <span>海拔: {location.altitude.toFixed(1)} m</span>
                  </div>
                )}
                {location.accuracy !== undefined && (
                  <div className="location-row">
                    <span>🎯</span>
                    <span>精度: ±{location.accuracy.toFixed(0)} m</span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={fetchLocation}
                >
                  重新获取位置
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate('/map', { state: { returnToCreate: true } })}
                >
                  在地图上选择
                </button>
              </div>
            </div>
          ) : (
            <div>
              {locationError && (
                <div className="error-message" style={{ marginBottom: '1rem' }}>
                  {locationError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={fetchLocation}
                >
                  获取GPS坐标
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate('/map', { state: { returnToCreate: true } })}
                >
                  在地图上选择
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            照片 ({photos.length})
          </h3>
          
          <div className="photo-grid">
            {photos.map((photo) => (
              <div key={photo.id} className="photo-item">
                <img src={photo.data} alt="采样照片" />
                <button
                  type="button"
                  className="photo-delete"
                  onClick={() => handleRemovePhoto(photo.id)}
                >
                  ×
                </button>
              </div>
            ))}
            
            {photos.length < 9 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="add-photo" onClick={handleCapturePhoto}>
                  <span className="add-photo-icon">📷</span>
                  <span className="add-photo-text">拍照</span>
                </div>
                <div className="add-photo" onClick={handleSelectPhoto}>
                  <span className="add-photo-icon">🖼️</span>
                  <span className="add-photo-text">相册</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="button-group">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/')}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !location}
          >
            {submitting ? '保存中...' : '保存采样点'}
          </button>
        </div>
      </form>
    </div>
  );
}
