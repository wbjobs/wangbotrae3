import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SamplePoint, TileSource, TILE_SOURCE_LABELS, GeoLocation } from '@shared/types';
import { useAppContext } from '../context/AppContext';
import { getCachedTile } from '../lib/mapTileManager';

export function MapPage() {
  const navigate = useNavigate();
  const locationState = useLocation().state as { returnToCreate?: boolean } | null;
  const { samples } = useAppContext();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const [tileSource, setTileSource] = useState<TileSource>('osm');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [clickLocation, setClickLocation] = useState<GeoLocation | null>(null);

  const createCustomIcon = (color: string = '#3b82f6') => {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background: ${color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        transform: translate(-50%, -50%);
      "></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  };

  const initMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [39.9042, 116.4074],
      zoom: 10,
      zoomControl: true
    });

    mapInstanceRef.current = map;

    map.on('click', (e) => {
      setClickLocation({
        latitude: e.latlng.lat,
        longitude: e.latlng.lng
      });
      setShowCreateDialog(true);
    });

    updateTileLayer(map, tileSource);
    updateMarkers(map, samples);
  }, [tileSource, samples]);

  const updateTileLayer = (map: L.Map, source: TileSource) => {
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl = source === 'osm'
      ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      : 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';

    const layer = L.tileLayer(tileUrl, {
      attribution: source === 'osm' 
        ? '&copy; OpenStreetMap contributors' 
        : '&copy; 高德地图',
      minZoom: 1,
      maxZoom: 18
    });

    layer.addTo(map);
    tileLayerRef.current = layer;
  };

  const updateMarkers = (map: L.Map, sampleList: SamplePoint[]) => {
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current = [];

    sampleList.forEach(sample => {
      const marker = L.marker(
        [sample.location.latitude, sample.location.longitude],
        { icon: createCustomIcon() }
      ).bindPopup(`
        <div style="padding: 8px;">
          <strong style="font-size: 14px;">${sample.sampleNumber}</strong>
          <p style="margin: 4px 0; font-size: 12px; color: #666;">${sample.description || '无描述'}</p>
          <button onclick="window.location.hash='#/sample/${sample.id}'" style="
            margin-top: 8px;
            padding: 4px 12px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          ">查看详情</button>
        </div>
      `);
      
      marker.addTo(map);
      markersRef.current.push(marker);
    });
  };

  useEffect(() => {
    initMap();
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [initMap]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      updateTileLayer(mapInstanceRef.current, tileSource);
    }
  }, [tileSource]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      updateMarkers(mapInstanceRef.current, samples);
    }
  }, [samples]);

  const handleCreateSample = () => {
    if (clickLocation) {
      if (locationState?.returnToCreate) {
        navigate('/create', { state: { preselectedLocation: clickLocation }, replace: true });
      } else {
        navigate('/create', { state: { preselectedLocation: clickLocation } });
      }
    }
    setShowCreateDialog(false);
  };

  const locateUser = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.locate({ setView: true, maxZoom: 16 });
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 57px)', position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }}></div>
      
      <div style={{
        position: 'absolute',
        top: '1rem',
        right: '1rem',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }}>
        <div className="card" style={{ padding: '0.5rem', margin: 0 }}>
          <select
            className="form-select"
            style={{ fontSize: '0.875rem', padding: '0.5rem' }}
            value={tileSource}
            onChange={(e) => setTileSource(e.target.value as TileSource)}
          >
            {Object.entries(TILE_SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <button
          className="btn btn-primary"
          style={{ padding: '0.5rem' }}
          onClick={locateUser}
        >
          📍 定位
        </button>

        <button
          className="btn btn-secondary"
          style={{ padding: '0.5rem' }}
          onClick={() => navigate('/map-download')}
        >
          📦 离线地图
        </button>
      </div>

      <div style={{
        position: 'absolute',
        bottom: '1rem',
        left: '1rem',
        right: '1rem',
        zIndex: 1000,
        textAlign: 'center'
      }}>
        <div className="card" style={{ display: 'inline-block', padding: '0.5rem 1rem' }}>
          <small style={{ color: 'var(--text-secondary)' }}>
            共 {samples.length} 个采样点 · 点击地图创建新采样点
          </small>
        </div>
      </div>

      {showCreateDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div className="card" style={{ width: '90%', maxWidth: '320px', margin: 0 }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>创建采样点</h3>
            <p style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              是否在此位置创建新的采样点？
            </p>
            {clickLocation && (
              <p style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
                📍 {clickLocation.latitude.toFixed(6)}°, {clickLocation.longitude.toFixed(6)}°
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setShowCreateDialog(false)}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={handleCreateSample}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
