import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const bomApi = {
  list: () => api.get('/api/boms'),
  get: (id) => api.get(`/api/boms/${id}`),
  create: (data) => api.post('/api/boms', data),
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/api/bom/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  delete: (id) => api.delete(`/api/boms/${id}`),
  validate: (id) => api.get(`/api/boms/${id}/validate`),
  calculate: (id) => api.post(`/api/boms/${id}/calculate`),
  summary: (id) => api.get(`/api/boms/${id}/summary`),
  sankey: (id) => api.get(`/api/boms/${id}/sankey`),
  generateReport: (id) => api.post(`/api/boms/${id}/report`),
  downloadReport: (id) => `${API_BASE_URL}/api/boms/${id}/report/download`,
};

export const supplierApi = {
  list: () => api.get('/api/suppliers'),
  create: (data) => api.post('/api/suppliers', data),
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/api/supplier/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const analysisApi = {
  compare: (data) => api.post('/api/analysis/compare', data),
  listComparisons: () => api.get('/api/analysis/comparisons'),
};

export const taskApi = {
  getStatus: (taskId) => api.get(`/api/tasks/${taskId}`),
};

export default api;
