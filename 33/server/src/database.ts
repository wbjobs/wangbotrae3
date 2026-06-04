import * as fs from 'fs';
import * as path from 'path';
import { SamplePoint, SamplePhotoFull, SyncStatus } from '../../shared/types';

const DATA_DIR = path.join(__dirname, '../data');
const SAMPLES_FILE = path.join(DATA_DIR, 'samples.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

interface SamplesDataStore {
  samples: SamplePoint[];
  lastModified: number;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  }
}

function readSamplesData(): SamplesDataStore {
  ensureDataDir();
  if (!fs.existsSync(SAMPLES_FILE)) {
    return { samples: [], lastModified: 0 };
  }
  try {
    const content = fs.readFileSync(SAMPLES_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { samples: [], lastModified: 0 };
  }
}

function writeSamplesData(data: SamplesDataStore): void {
  ensureDataDir();
  data.lastModified = Date.now();
  fs.writeFileSync(SAMPLES_FILE, JSON.stringify(data, null, 2));
}

function getPhotoPath(photoId: string): string {
  return path.join(PHOTOS_DIR, `${photoId}.json`);
}

export function savePhoto(photo: SamplePhotoFull): void {
  ensureDataDir();
  const photoPath = getPhotoPath(photo.id);
  fs.writeFileSync(photoPath, JSON.stringify(photo));
}

export function getPhoto(photoId: string): SamplePhotoFull | null {
  const photoPath = getPhotoPath(photoId);
  if (!fs.existsSync(photoPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(photoPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function getAllSamples(): SamplePoint[] {
  const data = readSamplesData();
  return data.samples;
}

export function getSampleById(id: string): SamplePoint | undefined {
  const data = readSamplesData();
  return data.samples.find(s => s.id === id);
}

export function getSamplesByDeviceId(deviceId: string): SamplePoint[] {
  const data = readSamplesData();
  return data.samples.filter(s => s.deviceId === deviceId);
}

export function upsertSample(sample: SamplePoint): SamplePoint {
  const data = readSamplesData();
  const index = data.samples.findIndex(s => s.id === sample.id);
  
  const now = Date.now();
  const sampleToStore: SamplePoint = {
    ...sample,
    syncStatus: 'synced' as SyncStatus,
    lastSyncAt: now,
    photos: sample.photos.map(p => ({
      id: p.id,
      name: p.name,
      timestamp: p.timestamp
    }))
  };
  
  if ('data' in (sample.photos[0] || {})) {
    (sample.photos as SamplePhotoFull[]).forEach(photo => {
      if ('data' in photo) {
        savePhoto(photo);
      }
    });
  }
  
  if (index >= 0) {
    const existing = data.samples[index];
    if (sample.updatedAt >= existing.updatedAt) {
      data.samples[index] = sampleToStore;
    }
  } else {
    data.samples.push(sampleToStore);
  }
  
  writeSamplesData(data);
  return sample;
}

export function bulkUpsertSamples(samples: SamplePoint[]): { updated: string[]; conflicts: string[] } {
  const data = readSamplesData();
  const updated: string[] = [];
  const conflicts: string[] = [];
  const now = Date.now();
  
  samples.forEach(sample => {
    const index = data.samples.findIndex(s => s.id === sample.id);
    
    const sampleToStore: SamplePoint = {
      ...sample,
      syncStatus: 'synced' as SyncStatus,
      lastSyncAt: now,
      photos: sample.photos.map(p => ({
        id: p.id,
        name: p.name,
        timestamp: p.timestamp
      }))
    };
    
    if ('data' in (sample.photos[0] || {})) {
      (sample.photos as SamplePhotoFull[]).forEach(photo => {
        if ('data' in photo) {
          savePhoto(photo);
        }
      });
    }
    
    if (index >= 0) {
      const existing = data.samples[index];
      if (sample.updatedAt >= existing.updatedAt) {
        data.samples[index] = sampleToStore;
        updated.push(sample.id);
      } else {
        conflicts.push(sample.id);
      }
    } else {
      data.samples.push(sampleToStore);
      updated.push(sample.id);
    }
  });
  
  writeSamplesData(data);
  return { updated, conflicts };
}

export function deleteSample(id: string): boolean {
  const data = readSamplesData();
  const index = data.samples.findIndex(s => s.id === id);
  if (index >= 0) {
    const sample = data.samples[index];
    sample.photos.forEach(photo => {
      const photoPath = getPhotoPath(photo.id);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    });
    data.samples.splice(index, 1);
    writeSamplesData(data);
    return true;
  }
  return false;
}

export function getSampleWithPhotos(id: string): (SamplePoint & { fullPhotos: SamplePhotoFull[] }) | undefined {
  const sample = getSampleById(id);
  if (!sample) {
    return undefined;
  }
  
  const fullPhotos: SamplePhotoFull[] = [];
  sample.photos.forEach(photoRef => {
    const photo = getPhoto(photoRef.id);
    if (photo) {
      fullPhotos.push(photo);
    }
  });
  
  return { ...sample, fullPhotos };
}

