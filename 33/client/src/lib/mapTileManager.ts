import { TileSource, MapTile, MapDownloadRegion } from '@shared/types';
import { getMapTile, addMapTile, addMapRegion, updateMapRegion, getAllMapRegions, deleteMapRegion, clearMapTiles } from './indexedDB';

function getTileUrl(source: TileSource, z: number, x: number, y: number): string {
  switch (source) {
    case 'osm':
      return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    case 'amap':
      return `https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}`;
    default:
      return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }
}

function lonToTileX(lon: number, zoom: number): number {
  return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
}

function latToTileY(lat: number, zoom: number): number {
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
}

function tileXToLon(x: number, zoom: number): number {
  return x / Math.pow(2, zoom) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function calculateTileBounds(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  minZoom: number,
  maxZoom: number
): { z: number; x: number; y: number }[] {
  const tiles: { z: number; x: number; y: number }[] = [];
  
  for (let z = minZoom; z <= maxZoom; z++) {
    const minX = lonToTileX(minLng, z);
    const maxX = lonToTileX(maxLng, z);
    const minY = latToTileY(maxLat, z);
    const maxY = latToTileY(minLat, z);
    
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  
  return tiles;
}

export async function downloadTile(source: TileSource, z: number, x: number, y: number): Promise<MapTile | null> {
  const cachedTile = await getMapTile(source, z, x, y);
  if (cachedTile) {
    return cachedTile;
  }

  try {
    const url = getTileUrl(source, z, x, y);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to download tile: ${response.status}`);
    }

    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const tile: MapTile = {
      id: `${source}-${z}-${x}-${y}`,
      source,
      z,
      x,
      y,
      data: dataUrl,
      timestamp: Date.now()
    };

    await addMapTile(tile);
    return tile;
  } catch (error) {
    console.error('Error downloading tile:', error);
    return null;
  }
}

export async function getCachedTile(source: TileSource, z: number, x: number, y: number): Promise<string | null> {
  const tile = await getMapTile(source, z, x, y);
  return tile?.data || null;
}

export class TileDownloadManager {
  private activeDownloads: Map<string, AbortController> = new Map();
  private progressListeners: Set<(regionId: string, downloaded: number, total: number) => void> = new Set();

  async createDownloadRegion(
    name: string,
    source: TileSource,
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    minZoom: number,
    maxZoom: number
  ): Promise<MapDownloadRegion> {
    const tiles = calculateTileBounds(minLat, maxLat, minLng, maxLng, minZoom, maxZoom);
    
    const region: MapDownloadRegion = {
      id: `region-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name,
      source,
      minZoom,
      maxZoom,
      bounds: { minLat, maxLat, minLng, maxLng },
      totalTiles: tiles.length,
      downloadedTiles: 0,
      status: 'pending',
      createdAt: Date.now()
    };

    await addMapRegion(region);
    return region;
  }

  async startDownload(regionId: string): Promise<void> {
    const regions = await getAllMapRegions();
    const region = regions.find(r => r.id === regionId);
    
    if (!region) {
      throw new Error('Region not found');
    }

    if (region.status === 'downloading') {
      return;
    }

    const abortController = new AbortController();
    this.activeDownloads.set(regionId, abortController);

    region.status = 'downloading';
    await updateMapRegion(region);

    const tiles = calculateTileBounds(
      region.bounds.minLat,
      region.bounds.maxLat,
      region.bounds.minLng,
      region.bounds.maxLng,
      region.minZoom,
      region.maxZoom
    );

    try {
      for (let i = region.downloadedTiles; i < tiles.length; i++) {
        if (abortController.signal.aborted) {
          break;
        }

        const { z, x, y } = tiles[i];
        await downloadTile(region.source, z, x, y);
        
        region.downloadedTiles = i + 1;
        await updateMapRegion(region);
        
        this.notifyProgress(regionId, i + 1, region.totalTiles);

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (!abortController.signal.aborted) {
        region.status = 'completed';
        await updateMapRegion(region);
      }
    } catch (error) {
      region.status = 'error';
      await updateMapRegion(region);
      throw error;
    } finally {
      this.activeDownloads.delete(regionId);
    }
  }

  stopDownload(regionId: string): void {
    const abortController = this.activeDownloads.get(regionId);
    if (abortController) {
      abortController.abort();
      this.activeDownloads.delete(regionId);
    }
  }

  async deleteRegion(regionId: string): Promise<void> {
    this.stopDownload(regionId);
    await deleteMapRegion(regionId);
  }

  async clearAllTiles(): Promise<void> {
    this.activeDownloads.forEach((controller) => controller.abort());
    this.activeDownloads.clear();
    await clearMapTiles();
  }

  subscribeToProgress(listener: (regionId: string, downloaded: number, total: number) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private notifyProgress(regionId: string, downloaded: number, total: number): void {
    this.progressListeners.forEach(listener => listener(regionId, downloaded, total));
  }
}

export const tileDownloadManager = new TileDownloadManager();
