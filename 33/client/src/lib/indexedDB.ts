import { openDB, IDBPDatabase } from 'idb';
import { SamplePoint, SamplePhotoFull, SyncStatus, MapTile, MapDownloadRegion } from '@shared/types';

interface GeologyDB {
  samples: {
    key: string;
    value: SamplePoint;
  };
  photos: {
    key: string;
    value: SamplePhotoFull;
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
  mapTiles: {
    key: string;
    value: MapTile;
    indexes: { 'by-source-z-x': [string, number, number] };
  };
  mapRegions: {
    key: string;
    value: MapDownloadRegion;
  };
}

const DB_NAME = 'geology-db-v8';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<GeologyDB> | null = null;

async function getDB(): Promise<IDBPDatabase<GeologyDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<GeologyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('samples')) {
        db.createObjectStore('samples', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('mapTiles')) {
        const tileStore = db.createObjectStore('mapTiles', { keyPath: 'id' });
        tileStore.createIndex('by-source-z-x', ['source', 'z', 'x']);
      }

      if (!db.objectStoreNames.contains('mapRegions')) {
        db.createObjectStore('mapRegions', { keyPath: 'id' });
      }
    }
  });

  return dbInstance;
}

export async function getAllSamples(): Promise<SamplePoint[]> {
  const db = await getDB();
  const allSamples = await db.getAll('samples');
  return allSamples.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSampleById(id: string): Promise<SamplePoint | undefined> {
  const db = await getDB();
  return db.get('samples', id);
}

export async function getPendingSyncSamples(): Promise<SamplePoint[]> {
  const db = await getDB();
  const allSamples = await db.getAll('samples');
  return allSamples.filter(s => {
    if (!s.syncStatus) {
      return true;
    }
    return s.syncStatus === 'pending' || s.syncStatus === 'error';
  });
}

export async function addSample(sample: SamplePoint): Promise<string> {
  const db = await getDB();
  return db.add('samples', sample) as Promise<string>;
}

export async function updateSample(sample: SamplePoint): Promise<string> {
  const db = await getDB();
  return db.put('samples', sample) as Promise<string>;
}

export async function bulkUpsertSamples(samples: SamplePoint[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('samples', 'readwrite');
  
  await Promise.all([
    ...samples.map(sample => tx.store.put(sample)),
    tx.done
  ]);
}

export async function updateSampleSyncStatus(
  sampleId: string, 
  syncStatus: SyncStatus, 
  options?: { syncError?: string; lastSyncAt?: number; syncAttempts?: number }
): Promise<void> {
  const db = await getDB();
  const sample = await db.get('samples', sampleId);
  if (sample) {
    sample.syncStatus = syncStatus;
    sample.lastSyncAttemptAt = Date.now();
    if (options?.syncError !== undefined) {
      sample.syncError = options.syncError;
    }
    if (options?.lastSyncAt !== undefined) {
      sample.lastSyncAt = options.lastSyncAt;
    }
    if (options?.syncAttempts !== undefined) {
      sample.syncAttempts = options.syncAttempts;
    }
    await db.put('samples', sample);
  }
}

export async function deleteSample(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('samples', id);
}

export async function clearAllSamples(): Promise<void> {
  const db = await getDB();
  await db.clear('samples');
}

export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const result = await db.get('settings', key);
  return result?.value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key, value });
}

export async function getDeviceId(): Promise<string> {
  let deviceId = await getSetting<string>('deviceId');
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    await setSetting('deviceId', deviceId);
  }
  return deviceId;
}

export async function addPhoto(photo: SamplePhotoFull): Promise<string> {
  const db = await getDB();
  return db.add('photos', photo) as Promise<string>;
}

export async function getPhotoById(id: string): Promise<SamplePhotoFull | undefined> {
  const db = await getDB();
  return db.get('photos', id);
}

export async function getPhotosByIds(ids: string[]): Promise<SamplePhotoFull[]> {
  const db = await getDB();
  const photos: SamplePhotoFull[] = [];
  for (const id of ids) {
    const photo = await db.get('photos', id);
    if (photo) {
      photos.push(photo);
    }
  }
  return photos;
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('photos', id);
}

export async function bulkUpsertPhotos(photos: SamplePhotoFull[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('photos', 'readwrite');
  
  await Promise.all([
    ...photos.map(photo => tx.store.put(photo)),
    tx.done
  ]);
}

export async function addMapTile(tile: MapTile): Promise<string> {
  const db = await getDB();
  return db.add('mapTiles', tile) as Promise<string>;
}

export async function getMapTile(source: string, z: number, x: number, y: number): Promise<MapTile | undefined> {
  const db = await getDB();
  const id = `${source}-${z}-${x}-${y}`;
  return db.get('mapTiles', id);
}

export async function getAllMapTiles(): Promise<MapTile[]> {
  const db = await getDB();
  return db.getAll('mapTiles');
}

export async function deleteMapTile(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('mapTiles', id);
}

export async function clearMapTiles(): Promise<void> {
  const db = await getDB();
  await db.clear('mapTiles');
}

export async function addMapRegion(region: MapDownloadRegion): Promise<string> {
  const db = await getDB();
  return db.add('mapRegions', region) as Promise<string>;
}

export async function updateMapRegion(region: MapDownloadRegion): Promise<string> {
  const db = await getDB();
  return db.put('mapRegions', region) as Promise<string>;
}

export async function getMapRegion(id: string): Promise<MapDownloadRegion | undefined> {
  const db = await getDB();
  return db.get('mapRegions', id);
}

export async function getAllMapRegions(): Promise<MapDownloadRegion[]> {
  const db = await getDB();
  return db.getAll('mapRegions');
}

export async function deleteMapRegion(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('mapRegions', id);
}

export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
