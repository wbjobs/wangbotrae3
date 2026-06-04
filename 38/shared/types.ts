export enum DeviceStatus {
  NORMAL = 'normal',
  BEARING_FAULT = 'bearing_fault',
  GEAR_FAULT = 'gear_fault',
  IMBALANCE = 'imbalance'
}

export const DeviceStatusLabels: Record<DeviceStatus, string> = {
  [DeviceStatus.NORMAL]: '正常',
  [DeviceStatus.BEARING_FAULT]: '轴承故障',
  [DeviceStatus.GEAR_FAULT]: '齿轮故障',
  [DeviceStatus.IMBALANCE]: '不平衡'
};

export const DeviceStatusColors: Record<DeviceStatus, string> = {
  [DeviceStatus.NORMAL]: '#00B42A',
  [DeviceStatus.BEARING_FAULT]: '#F53F3F',
  [DeviceStatus.GEAR_FAULT]: '#F53F3F',
  [DeviceStatus.IMBALANCE]: '#FF7D00'
};

export interface DiagnosisResult {
  id: string;
  deviceId: string;
  timestamp: number;
  status: DeviceStatus;
  confidence: number;
  probabilities: Record<DeviceStatus, number>;
  signalDuration: number;
  sampleRate: number;
}

export interface RealtimeSignalData {
  type: 'signal_data';
  deviceId: string;
  timestamp: number;
  signal: number[];
}

export interface RealtimeDiagnosisData {
  type: 'diagnosis_result';
  data: DiagnosisResult;
}

export type WebSocketMessage = RealtimeSignalData | RealtimeDiagnosisData;

export interface BatchTask {
  id: string;
  deviceId: string;
  fileName: string;
  fileSize: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalCount: number;
  completedCount: number;
  resultPath?: string;
  errorMessage?: string;
  createdAt: number;
  completedAt?: number;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  location: string;
  sampleRate: number;
  sensorCount: number;
  status: 'online' | 'offline' | 'maintenance';
  createdAt: number;
  updatedAt: number;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HistoryFilter {
  deviceId?: string;
  status?: DeviceStatus;
  startTime?: number;
  endTime?: number;
  page?: number;
  pageSize?: number;
}
