import axios from 'axios';

const API_BASE_URL = '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const windApi = {
  getParams: () => api.get('/wind'),
  updateParams: (params) => api.put('/wind', params),
  setSpeed: (speed) => api.put(`/wind/speed/${speed}`),
  setDirection: (x, y, z) => api.put(`/wind/direction/${x}/${y}/${z}`),
  setTurbulence: (turbulence) => api.put(`/wind/turbulence/${turbulence}`),
  startAuto: () => api.post('/wind/auto/start'),
  stopAuto: () => api.post('/wind/auto/stop'),

  getAdvancedParams: () => api.get('/wind/advanced'),
  updateAdvancedParams: (params) => api.put('/wind/advanced', params),

  getFieldState: () => api.get('/wind/field/state'),
  getVoxelWind: (x, y, z) => api.get(`/wind/field/voxel/${x}/${y}/${z}`),
  getAllUpdatedVoxels: () => api.get('/wind/field/voxels'),
  sampleWindAt: (x, y, z) => api.get(`/wind/field/sample/${x}/${y}/${z}`),
  batchSampleWind: (positions) => api.post('/wind/field/batch-sample', { positions }),
  getFieldConfig: () => api.get('/wind/field/config'),
  updateFieldConfig: (config) => api.put('/wind/field/config', config),

  getStreamlineParticles: () => api.get('/wind/streamline/particles'),
  getStreamlineParticlesInRegion: (minX, minY, minZ, maxX, maxY, maxZ) =>
    api.get(`/wind/streamline/particles/${minX}/${minY}/${minZ}/${maxX}/${maxY}/${maxZ}`),
  spawnStreamlineParticles: (position, count) =>
    api.post('/wind/streamline/spawn', { position, count }),

  getObstacles: () => api.get('/wind/obstacles'),
  setObstacle: (voxelX, voxelY, voxelZ, active, playerId = '') =>
    api.post('/wind/obstacles', { voxelX, voxelY, voxelZ, active, playerId }),

  triggerGust: (strength, duration, directionX, directionY, directionZ) =>
    api.post('/wind/gust', { strength, duration, directionX, directionY, directionZ }),
  triggerGust3s: (strength, directionX, directionY, directionZ) =>
    api.post('/wind/gust/3s', { strength, directionX, directionY, directionZ }),
  getCurrentGust: () => api.get('/wind/gust/current'),
  cancelGust: () => api.post('/wind/gust/cancel'),
};

export const destructionApi = {
  getHistory: (limit = 100, offset = 0) =>
    api.get(`/destruction/history?limit=${limit}&offset=${offset}`),
};

export const statsApi = {
  getStats: () => api.get('/stats'),
  setTotalVoxels: (total) => api.put(`/stats/total/${total}`),
};

export default api;
