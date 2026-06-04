import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 300000
})

api.interceptors.response.use(
  response => response.data,
  error => {
    console.error('API Error:', error)
    return Promise.reject(error)
  }
)

export const roomApi = {
  create: (data) => api.post('/rooms', data),
  get: (id) => api.get(`/rooms/${id}`),
  list: (params) => api.get('/rooms', { params }),
  update: (id, data) => api.put(`/rooms/${id}`, data),
  delete: (id) => api.delete(`/rooms/${id}`)
}

export const audioApi = {
  upload: (formData, onUploadProgress) => api.post('/audio/upload', formData, { onUploadProgress }),
  get: (id) => api.get(`/audio/${id}`),
  listByRoom: (roomId) => api.get(`/audio/room/${roomId}`),
  getWaveform: (id) => api.get(`/audio/${id}/waveform`),
  delete: (id) => api.delete(`/audio/${id}`)
}

export const syncApi = {
  calculate: (data) => api.post('/sync', data),
  get: (id) => api.get(`/sync/session/${id}`),
  listByRoom: (roomId) => api.get(`/sync/room/${roomId}`),
  quick: (data) => api.post('/sync/quick', data),
  getMatrix: (id) => api.get(`/sync/matrix/${id}`),
  listMatricesByRoom: (roomId) => api.get(`/sync/matrix/room/${roomId}`),
  getPoolStatus: () => api.get('/sync/pool-status')
}

export default api
