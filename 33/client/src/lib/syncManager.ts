import { 
  getPendingSyncSamples, 
  bulkUpsertSamples, 
  getDeviceId,
  getSetting,
  setSetting,
  addSample,
  updateSample,
  updateSampleSyncStatus,
  getPhotosByIds,
  bulkUpsertPhotos
} from './indexedDB';
import { SamplePoint, SyncRequest, SyncResponse, SamplePhotoFull, SyncStatus } from '@shared/types';

const API_BASE = '/api';
const LAST_SYNC_KEY = 'lastSyncTimestamp';
const MAX_SYNC_ATTEMPTS = 5;
const SYNC_LOCK_KEY = 'syncLock';

type SyncManagerStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface SyncState {
  status: SyncManagerStatus;
  pendingCount: number;
  syncingCount: number;
  lastSyncTime?: number;
  error?: string;
}

class SyncManager {
  private state: SyncState = {
    status: 'idle',
    pendingCount: 0,
    syncingCount: 0
  };
  private listeners: Set<(state: SyncState) => void> = new Set();
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private isOnline: boolean = true;
  private isSyncing: boolean = false;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.isOnline = navigator.onLine;
    
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.triggerSync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.updateState({ status: 'idle' });
    });

    const lastSyncTime = await getSetting<number>(LAST_SYNC_KEY);
    const pendingSamples = await getPendingSyncSamples();
    
    this.state = {
      ...this.state,
      pendingCount: pendingSamples.length,
      lastSyncTime
    };

    if (this.isOnline && pendingSamples.length > 0) {
      this.triggerSync();
    }
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return { ...this.state };
  }

  private async acquireLock(): Promise<boolean> {
    const lockId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const existingLock = await getSetting<string>(SYNC_LOCK_KEY);
    
    if (existingLock) {
      const lockTime = parseInt(existingLock.split('-')[0], 10);
      if (Date.now() - lockTime < 60000) {
        return false;
      }
    }
    
    await setSetting(SYNC_LOCK_KEY, lockId);
    return true;
  }

  private async releaseLock(): Promise<void> {
    await setSetting(SYNC_LOCK_KEY, null);
  }

  async triggerSync(): Promise<void> {
    if (this.isSyncing || !this.isOnline) {
      return;
    }

    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      return;
    }

    this.isSyncing = true;
    this.updateState({ status: 'syncing', error: undefined });

    try {
      const deviceId = await getDeviceId();
      const pendingSamples = await getPendingSyncSamples();

      if (pendingSamples.length === 0) {
        this.updateState({ status: 'success', pendingCount: 0, syncingCount: 0 });
        await this.releaseLock();
        this.isSyncing = false;
        return;
      }

      const syncingSampleIds: string[] = [];
      for (const sample of pendingSamples) {
        if (sample.syncAttempts >= MAX_SYNC_ATTEMPTS) {
          await updateSampleSyncStatus(sample.id, 'error', { 
            syncError: '超过最大重试次数',
            syncAttempts: sample.syncAttempts
          });
          continue;
        }
        
        await updateSampleSyncStatus(sample.id, 'syncing', {
          syncAttempts: (sample.syncAttempts || 0) + 1
        });
        syncingSampleIds.push(sample.id);
      }

      const samplesToSync = pendingSamples.filter(s => syncingSampleIds.includes(s.id));
      
      if (samplesToSync.length === 0) {
        this.updateState({ status: 'success', pendingCount: 0, syncingCount: 0 });
        await this.releaseLock();
        this.isSyncing = false;
        return;
      }

      this.updateState({ syncingCount: samplesToSync.length });

      const allPhotoIds = samplesToSync.flatMap(s => s.photos.map(p => p.id));
      const photos = await getPhotosByIds(allPhotoIds);

      const samplesWithPhotos = samplesToSync.map(sample => ({
        ...sample,
        photos: sample.photos.map(photoRef => {
          const photo = photos.find(p => p.id === photoRef.id);
          return photo || photoRef;
        })
      }));

      const lastSyncTime = await getSetting<number>(LAST_SYNC_KEY) || 0;

      const request: SyncRequest = {
        deviceId,
        samples: samplesWithPhotos,
        lastSyncTimestamp: lastSyncTime
      };

      const response = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      const result: SyncResponse = await response.json();

      const syncTimestamp = result.syncTimestamp;
      
      for (const sampleId of result.updatedSampleIds) {
        await updateSampleSyncStatus(sampleId, 'synced', {
          lastSyncAt: syncTimestamp
        });
      }

      if (result.conflicts && result.conflicts.length > 0) {
        for (const sampleId of result.conflicts) {
          await updateSampleSyncStatus(sampleId, 'error', {
            syncError: '服务器冲突'
          });
        }
      }

      if (result.serverSamples && result.serverSamples.length > 0) {
        await bulkUpsertSamples(result.serverSamples);
        
        const serverPhotos = result.serverSamples.flatMap(s => 
          (s.photos as SamplePhotoFull[]).filter(p => 'data' in p)
        );
        if (serverPhotos.length > 0) {
          await bulkUpsertPhotos(serverPhotos);
        }
      }

      await setSetting(LAST_SYNC_KEY, syncTimestamp);

      const remainingPending = await getPendingSyncSamples();
      
      this.updateState({
        status: 'success',
        pendingCount: remainingPending.length,
        syncingCount: 0,
        lastSyncTime: syncTimestamp
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const pendingSamples = await getPendingSyncSamples();
      for (const sample of pendingSamples) {
        if (sample.syncStatus === 'syncing') {
          await updateSampleSyncStatus(sample.id, 'error', {
            syncError: errorMessage
          });
        }
      }

      this.updateState({ status: 'error', error: errorMessage, syncingCount: 0 });
      
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
      }
      this.retryTimeout = setTimeout(() => this.triggerSync(), 10000);
    } finally {
      await this.releaseLock();
      this.isSyncing = false;
    }
  }

  async refreshPendingCount(): Promise<void> {
    const pending = await getPendingSyncSamples();
    this.updateState({ pendingCount: pending.length });
  }

  destroy(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }
}

export const syncManager = new SyncManager();

export async function createSample(sample: Omit<SamplePoint, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'syncAttempts' | 'deviceId' | 'photos'> & { photos: SamplePhotoFull[] }): Promise<SamplePoint> {
  const deviceId = await getDeviceId();
  const now = Date.now();

  const photoRefs = sample.photos.map(photo => ({
    id: photo.id,
    name: photo.name,
    timestamp: photo.timestamp
  }));

  for (const photo of sample.photos) {
    await import('./indexedDB').then(m => m.addPhoto(photo));
  }

  const newSample: SamplePoint = {
    ...sample,
    photos: photoRefs,
    id: `sample-${now}-${Math.random().toString(36).substring(2, 11)}`,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'pending' as SyncStatus,
    syncAttempts: 0,
    deviceId
  };

  await addSample(newSample);
  
  await syncManager.refreshPendingCount();
  syncManager.triggerSync();

  return newSample;
}

export async function updateSampleData(sample: SamplePoint, newPhotos?: SamplePhotoFull[], deletedPhotoIds?: string[]): Promise<void> {
  if (newPhotos && newPhotos.length > 0) {
    for (const photo of newPhotos) {
      await import('./indexedDB').then(m => m.addPhoto(photo));
    }
  }

  if (deletedPhotoIds && deletedPhotoIds.length > 0) {
    for (const photoId of deletedPhotoIds) {
      await import('./indexedDB').then(m => m.deletePhoto(photoId));
    }
  }

  const updatedSample: SamplePoint = {
    ...sample,
    updatedAt: Date.now(),
    syncStatus: 'pending' as SyncStatus
  };

  await updateSample(updatedSample);
  
  await syncManager.refreshPendingCount();
  syncManager.triggerSync();
}
