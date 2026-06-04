import axios from 'axios';
import type {
  DeviceSimulatorConfig,
  AnomalyType,
  AnomalyConfig,
  Workflow,
  TimeTravelRequest,
  TestCase,
  InjectionRecord,
  PlaybackStatus,
  DeviceStatus,
  AnomalyEvent,
  AnomalyTemplate,
  TemplateCategory,
  NodeType,
} from '@/types';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const deviceApi = {
  getAll: () => api.get<DeviceSimulatorConfig[]>('/devices'),
  get: (deviceId: string) => api.get<DeviceSimulatorConfig>(`/devices/${deviceId}`),
  create: (config: DeviceSimulatorConfig) => api.post<DeviceSimulatorConfig>('/devices', config),
  delete: (deviceId: string) => api.delete(`/devices/${deviceId}`),
  start: (deviceId: string) => api.post(`/devices/${deviceId}/start`),
  stop: (deviceId: string) => api.post(`/devices/${deviceId}/stop`),
  status: (deviceId: string) => api.get<DeviceStatus>(`/devices/${deviceId}/status`),
  startAll: () => api.post('/devices/start-all'),
  stopAll: () => api.post('/devices/stop-all'),
};

export const anomalyApi = {
  getTypes: () => api.get<AnomalyType[]>('/anomaly-types'),
  add: (deviceId: string, config: AnomalyConfig) => api.post(`/devices/${deviceId}/anomalies`, config),
  remove: (deviceId: string, anomalyType: string) => api.delete(`/devices/${deviceId}/anomalies/${anomalyType}`),
  clear: (deviceId: string) => api.delete(`/devices/${deviceId}/anomalies`),
  getDeviceAnomalies: (deviceId: string) => api.get<AnomalyConfig[]>(`/devices/${deviceId}/anomalies`),
  getAll: () => api.get<Record<string, AnomalyConfig[]>>('/anomalies'),
  getEvents: (limit = 100) => api.get<AnomalyEvent[]>(`/anomaly-events?limit=${limit}`),
};

export const workflowApi = {
  create: (workflow: Workflow) => api.post<{ workflow_id: string }>('/workflows', workflow),
  getAll: () => api.get<Workflow[]>('/workflows'),
  get: (workflowId: string) => api.get<Workflow>(`/workflows/${workflowId}`),
  delete: (workflowId: string) => api.delete(`/workflows/${workflowId}`),
  start: (workflowId: string) => api.post(`/workflows/${workflowId}/start`),
  stop: (workflowId: string) => api.post(`/workflows/${workflowId}/stop`),
  status: (workflowId: string) => api.get<{ workflow_id: string; is_active: boolean }>(`/workflows/${workflowId}/status`),
};

export const testCaseApi = {
  create: (workflow: Workflow, name: string, description = '') =>
    api.post<{ test_case_id: number; workflow_id: string }>(
      `/test-cases?name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}`,
      workflow
    ),
  getAll: () => api.get<TestCase[]>('/test-cases'),
  get: (testCaseId: number) => api.get<TestCase>(`/test-cases/${testCaseId}`),
  delete: (testCaseId: number) => api.delete(`/test-cases/${testCaseId}`),
};

export const injectionRecordApi = {
  getAll: (deviceId?: string, limit = 100) => {
    const params = new URLSearchParams();
    if (deviceId) params.append('device_id', deviceId);
    params.append('limit', String(limit));
    return api.get<InjectionRecord[]>(`/injection-records?${params.toString()}`);
  },
};

export const timeTravelApi = {
  start: (request: TimeTravelRequest) => api.post<{ playback_id: string }>('/time-travel/start', request),
  stop: (playbackId: string) => api.post(`/time-travel/${playbackId}/stop`),
  status: (playbackId: string) => api.get<PlaybackStatus>(`/time-travel/${playbackId}`),
  getAll: () => api.get<PlaybackStatus[]>('/time-travel'),
};

export const dataApi = {
  query: (deviceId: string, startTime: string, endTime: string, metrics?: string[]) => {
    const params = new URLSearchParams();
    params.append('device_id', deviceId);
    params.append('start_time', startTime);
    params.append('end_time', endTime);
    if (metrics) params.append('metrics', metrics.join(','));
    return api.get(`/data/query?${params.toString()}`);
  },
  getRecent: (deviceId: string, minutes = 5, isInjected?: boolean) => {
    const params = new URLSearchParams();
    params.append('device_id', deviceId);
    params.append('minutes', String(minutes));
    if (isInjected !== undefined) params.append('is_injected', String(isInjected));
    return api.get(`/data/recent?${params.toString()}`);
  },
};

export const nodeApi = {
  getTypes: () => api.get<NodeType[]>('/node-types'),
};

export const templateApi = {
  getAll: (category?: string, includeBuiltin = true) => {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    params.append('include_builtin', String(includeBuiltin));
    return api.get<AnomalyTemplate[]>(`/templates?${params.toString()}`);
  },
  get: (templateId: string) => api.get<AnomalyTemplate>(`/templates/${templateId}`),
  create: (template: AnomalyTemplate) =>
    api.post<{ message: string; template_id: string }>('/templates', template),
  delete: (templateId: string) => api.delete(`/templates/${templateId}`),
  apply: (templateId: string, deviceIds: string[]) =>
    api.post<{ message: string; workflow_id: string }>(`/templates/${templateId}/apply`, {
      device_ids: deviceIds,
    }),
  getCategories: () => api.get<TemplateCategory[]>('/template-categories'),
};

export default api;
