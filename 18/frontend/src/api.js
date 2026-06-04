import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_BASE || '/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 300000,
});

export async function uploadImages(files) {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('images', file);
  });
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function startEstimation(taskId, params = {}) {
  const formData = new FormData();
  formData.append('task_id', taskId);
  formData.append('brdf_type', params.brdfType || 'disney');
  formData.append('image_size', params.imageSize || 256);
  formData.append('num_iterations', params.numIterations || 200);
  formData.append('learning_rate', params.learningRate || 0.01);
  formData.append('export_format', params.exportFormat || 'materialx');

  if (params.cameras) {
    formData.append('cameras_json', JSON.stringify(params.cameras));
  }
  if (params.initialBaseColor) {
    formData.append('initial_base_color', JSON.stringify(params.initialBaseColor));
  }
  if (params.initialRoughness !== undefined) {
    formData.append('initial_roughness', params.initialRoughness);
  }
  if (params.initialMetallic !== undefined) {
    formData.append('initial_metallic', params.initialMetallic);
  }

  const response = await api.post('/estimate', formData);
  return response.data;
}

export async function getTaskStatus(taskId) {
  const response = await api.get(`/status/${taskId}`);
  return response.data;
}

export async function getResult(taskId) {
  const response = await api.get(`/results/${taskId}`);
  return response.data;
}

export async function getPreviewComparison(taskId, viewIndex = 0) {
  const response = await api.get(`/results/${taskId}/preview`, {
    params: { view_index: viewIndex },
  });
  return response.data;
}

export async function deleteTask(taskId) {
  const response = await api.delete(`/tasks/${taskId}`);
  return response.data;
}

export async function getSupportedFormats() {
  const response = await api.get('/formats');
  return response.data;
}

export function getResultFileUrl(taskId, filename) {
  return `${API_BASE}/results/${taskId}/download/${filename}`;
}
