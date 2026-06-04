export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
}

export type RockType = 
  | 'igneous'
  | 'sedimentary'
  | 'metamorphic'
  | 'unknown';

export const ROCK_TYPE_LABELS: Record<RockType, string> = {
  igneous: '火成岩',
  sedimentary: '沉积岩',
  metamorphic: '变质岩',
  unknown: '未知'
};

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';

export interface SamplePhoto {
  id: string;
  name: string;
  timestamp: number;
}

export interface SamplePhotoFull extends SamplePhoto {
  data: string;
}

export interface SamplePoint {
  id: string;
  sampleNumber: string;
  rockType: RockType;
  location: GeoLocation;
  description?: string;
  photos: SamplePhoto[];
  createdAt: number;
  updatedAt: number;
  syncStatus: SyncStatus;
  syncError?: string;
  lastSyncAt?: number;
  lastSyncAttemptAt?: number;
  syncAttempts: number;
  deviceId: string;
  syncLock?: string;
}

export interface SyncRequest {
  deviceId: string;
  samples: SamplePoint[];
  lastSyncTimestamp: number;
}

export interface SyncResponse {
  success: boolean;
  message: string;
  serverSamples: SamplePoint[];
  conflicts: string[];
  syncTimestamp: number;
  updatedSampleIds: string[];
}

export interface ExportOptions {
  format: 'excel' | 'geojson';
  startDate?: number;
  endDate?: number;
  sampleIds?: string[];
}

export type TileSource = 'osm' | 'amap';

export const TILE_SOURCE_LABELS: Record<TileSource, string> = {
  osm: 'OpenStreetMap',
  amap: '高德地图'
};

export interface MapTile {
  id: string;
  source: TileSource;
  z: number;
  x: number;
  y: number;
  data: string;
  timestamp: number;
}

export interface MapDownloadRegion {
  id: string;
  name: string;
  source: TileSource;
  minZoom: number;
  maxZoom: number;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  totalTiles: number;
  downloadedTiles: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  createdAt: number;
}
