const axios = require('axios');
const config = require('../config');

class APIClient {
  constructor() {
    this.baseURL = `http://localhost:${config.PORT}/api`;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 5000,
    });
  }

  async checkDaemon() {
    try {
      await this.client.get('/health');
      return true;
    } catch (err) {
      return false;
    }
  }

  async getHistory(limit = 20, offset = 0) {
    const response = await this.client.get('/history', {
      params: { limit, offset },
    });
    return response.data;
  }

  async getById(id) {
    const response = await this.client.get(`/history/${id}`);
    return response.data;
  }

  async search(keyword) {
    const response = await this.client.get('/search', {
      params: { q: keyword },
    });
    return response.data;
  }

  async replay(id) {
    const response = await this.client.post(`/replay/${id}`);
    return response.data;
  }

  async getStats(days = 7) {
    const response = await this.client.get('/stats', {
      params: { days },
    });
    return response.data;
  }
}

module.exports = APIClient;
