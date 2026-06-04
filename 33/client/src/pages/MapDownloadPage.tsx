import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TileSource, TILE_SOURCE_LABELS, MapDownloadRegion } from '@shared/types';
import { tileDownloadManager, calculateTileBounds } from '../lib/mapTileManager';
import { getAllMapRegions, getAllMapTiles } from '../lib/indexedDB';

export function MapDownloadPage() {
  const navigate = useNavigate();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const rectangleRef = useRef<L.Rectangle | null>(null);
  const [tileSource, setTileSource] = useState<TileSource>('osm');
  const [minZoom, setMinZoom] = useState(10);
  const [maxZoom, setMaxZoom] = useState(15);
  const [regionName, setRegionName] = useState('');
  const [regions, setRegions] = useState<MapDownloadRegion[]>([]);
  const [cachedTiles, setCachedTiles] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { downloaded: number; total: number }>>({});

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [39.9042, 116.4074],
      zoom: 12,
      zoomControl: true
    });

    mapInstanceRef.current = map;

    const tileUrl = tileSource === 'osm'
      ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      : 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

    L.tileLayer(tileUrl, {
      attribution: tileSource === 'osm' 
        ? '&copy; OpenStreetMap contributors' 
        : '&copy; 高德地图',
      minZoom: 1,
      maxZoom: 18
    }).addTo(map);

    map.on('moveend', updateSelection);
    map.on('zoomend', updateSelection);

    loadRegions();
    loadCachedTiles();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current) {
      updateSelection();
    }
  }, [minZoom, maxZoom]);

  const updateSelection = () => {
    if (!mapInstanceRef.current) return;

    const bounds = mapInstanceRef.current.getBounds();
    const rectBounds: L.LatLngBoundsExpression = [
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()]
    ];

    if (rectangleRef.current) {
      rectangleRef.current.setBounds(rectBounds);
    } else {
      rectangleRef.current = L.rectangle(rectBounds, {
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.2,
        weight: 2,
        interactive: false
      }).addTo(mapInstanceRef.current);
    }
  };

  const loadRegions = async () => {
    const allRegions = await getAllMapRegions();
    setRegions(allRegions);
  };

  const loadCachedTiles = async () => {
    const tiles = await getAllMapTiles();
    setCachedTiles(tiles.length);
  };

  const getEstimatedTileCount = (): number => {
    if (!mapInstanceRef.current) return 0;
    
    const bounds = mapInstanceRef.current.getBounds();
    const tiles = calculateTileBounds(
      bounds.getSouth(),
      bounds.getNorth(),
      bounds.getWest(),
      bounds.getEast(),
      minZoom,
      maxZoom
    );
    return tiles.length;
  };

  const handleCreateRegion = async () => {
    if (!mapInstanceRef.current || !regionName.trim()) return;

    const bounds = mapInstanceRef.current.getBounds();
    
    const region = await tileDownloadManager.createDownloadRegion(
      regionName.trim(),
      tileSource,
      bounds.getSouth(),
      bounds.getNorth(),
      bounds.getWest(),
      bounds.getEast(),
      minZoom,
      maxZoom
    );

    setRegions(prev => [...prev, region]);
    setRegionName('');

    await tileDownloadManager.startDownload(region.id);
    await loadRegions();
  };

  const handleResumeDownload = async (regionId: string) => {
    await tileDownloadManager.startDownload(regionId);
    await loadRegions();
  };

  const handleDeleteRegion = async (regionId: string) => {
    await tileDownloadManager.deleteRegion(regionId);
    await loadRegions();
    await loadCachedTiles();
  };

  const handleClearAll = async () => {
    if (confirm('确定要清除所有离线地图缓存吗？')) {
      await tileDownloadManager.clearAllTiles();
      await loadRegions();
      await loadCachedTiles();
    }
  };

  useEffect(() => {
    const unsubscribe = tileDownloadManager.subscribeToProgress((regionId, downloaded, total) => {
      setDownloadProgress(prev => ({
        ...prev,
        [regionId]: { downloaded, total }
      }));
      
      if (downloaded === total) {
        loadRegions();
        loadCachedTiles();
      }
    });

    return unsubscribe;
  }, []);

  const estimatedTiles = getEstimatedTileCount();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button 
          className="btn btn-secondary" 
          onClick={() => navigate('/map')}
          style={{ padding: '0.5rem' }}
        >
          ←
        </button>
        <h2 style={{ fontSize: '1.25rem' }}>离线地图管理</h2>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
          下载新区域
        </h3>

        <div className="form-group">
          <label className="form-label">区域名称</label>
          <input
            type="text"
            className="form-input"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
            placeholder="例如: 北京朝阳区"
          />
        </div>

        <div className="form-group">
          <label className="form-label">地图源</label>
          <select
            className="form-select"
            value={tileSource}
            onChange={(e) => setTileSource(e.target.value as TileSource)}
          >
            {Object.entries(TILE_SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label className="form-label">最小缩放: {minZoom}</label>
            <input
              type="range"
              min="1"
              max="18"
              value={minZoom}
              onChange={(e) => setMinZoom(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group">
            <label className="form-label">最大缩放: {maxZoom}</label>
            <input
              type="range"
              min="1"
              max="18"
              value={maxZoom}
              onChange={(e) => setMaxZoom(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ 
          height: '200px', 
          borderRadius: '8px', 
          overflow: 'hidden',
          marginBottom: '1rem',
          border: '1px solid var(--border-color)'
        }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }}></div>
        </div>

        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1rem' 
        }}>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            预计瓦片数量: <strong>{estimatedTiles}</strong>
          </span>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            已缓存瓦片: <strong>{cachedTiles}</strong>
          </span>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleCreateRegion}
          disabled={!regionName.trim()}
        >
          开始下载
        </button>
      </div>

      <div className="card">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '1rem' 
        }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
            下载队列 ({regions.length})
          </h3>
          {regions.length > 0 && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}
              onClick={handleClearAll}
            >
              清除全部
            </button>
          )}
        </div>

        {regions.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem 1rem' }}>
            <div className="empty-icon">🗺️</div>
            <div className="empty-title">暂无下载任务</div>
            <div className="empty-subtitle">选择区域并开始下载离线地图</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {regions.map(region => {
              const progress = downloadProgress[region.id] || {
                downloaded: region.downloadedTiles,
                total: region.totalTiles
              };
              const percentage = Math.round((progress.downloaded / progress.total) * 100);

              return (
                <div 
                  key={region.id} 
                  style={{
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)'
                  }}
                >
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '0.5rem'
                  }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{region.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {TILE_SOURCE_LABELS[region.source]} · 缩放 {region.minZoom}-{region.maxZoom}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {region.status === 'pending' && (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => handleResumeDownload(region.id)}
                        >
                          开始
                        </button>
                      )}
                      {region.status === 'downloading' && (
                        <span className="badge badge-info">下载中</span>
                      )}
                      {region.status === 'completed' && (
                        <span className="badge badge-success">已完成</span>
                      )}
                      {region.status === 'error' && (
                        <span className="badge badge-error">失败</span>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => handleDeleteRegion(region.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  
                  <div style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: 'var(--bg-tertiary)',
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${percentage}%`,
                      height: '100%',
                      backgroundColor: region.status === 'completed' 
                        ? 'var(--success-color)' 
                        : 'var(--primary-color)',
                      transition: 'width 0.3s'
                    }}></div>
                  </div>
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--text-secondary)',
                    marginTop: '0.25rem',
                    textAlign: 'right'
                  }}>
                    {progress.downloaded} / {progress.total} ({percentage}%)
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
