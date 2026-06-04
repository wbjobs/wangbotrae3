import axios from 'axios';
import type { ApiResponse, DiagnosisResult, BatchTask, Device, PaginatedResponse, HistoryFilter } from '../../shared/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

axiosInstance.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

export const diagnosisApi = {
  getDevices: async (): Promise<ApiResponse<Device[]>> => {
    return axiosInstance.get('/devices');
  },

  getDevice: async (id: string): Promise<ApiResponse<Device>> => {
    return axiosInstance.get(`/devices/${id}`);
  },

  createDevice: async (device: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<Device>> => {
    return axiosInstance.post('/devices', device);
  },

  updateDevice: async (id: string, device: Partial<Device>): Promise<ApiResponse<Device>> => {
    return axiosInstance.put(`/devices/${id}`, device);
  },

  deleteDevice: async (id: string): Promise<ApiResponse<void>> => {
    return axiosInstance.delete(`/devices/${id}`);
  },

  getDiagnosisHistory: async (filter: HistoryFilter): Promise<ApiResponse<PaginatedResponse<DiagnosisResult>>> => {
    return axiosInstance.get('/diagnosis/history', { params: filter });
  },

  getDiagnosisById: async (id: string): Promise<ApiResponse<DiagnosisResult>> => {
    return axiosInstance.get(`/diagnosis/${id}`);
  },

  uploadFile: async (
    file: File,
    deviceId: string,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<BatchTask>> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('deviceId', deviceId);

    return axiosInstance.post('/diagnosis/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
  },

  startBatchDiagnosis: async (deviceId: string, fileIds: string[]): Promise<ApiResponse<BatchTask>> => {
    return axiosInstance.post('/diagnosis/batch', { deviceId, fileIds });
  },

  getBatchTasks: async (): Promise<ApiResponse<BatchTask[]>> => {
    return axiosInstance.get('/diagnosis/batch');
  },

  getBatchTask: async (id: string): Promise<ApiResponse<BatchTask>> => {
    return axiosInstance.get(`/diagnosis/batch/${id}`);
  },

  cancelBatchTask: async (id: string): Promise<ApiResponse<void>> => {
    return axiosInstance.post(`/diagnosis/batch/${id}/cancel`);
  },

  downloadResult: async (taskId: string): Promise<Blob> => {
    return axiosInstance.get(`/diagnosis/batch/${taskId}/download`, {
      responseType: 'blob',
    });
  },

  getStatistics: async (startTime: number, endTime: number): Promise<ApiResponse<{
    totalCount: number;
    normalCount: number;
    faultCount: number;
    warningCount: number;
    byStatus: Record<string, number>;
    byDevice: Record<string, number>;
  }>> => {
    return axiosInstance.get('/diagnosis/statistics', { params: { startTime, endTime } });
  },

  exportHistory: async (filter: HistoryFilter): Promise<Blob> => {
    return axiosInstance.get('/diagnosis/history/export', {
      params: filter,
      responseType: 'blob',
    });
  },
};

export default diagnosisApi;
