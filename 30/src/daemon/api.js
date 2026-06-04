const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class APIServer {
  constructor(db, clipboardListener, imageStore) {
    this.db = db;
    this.clipboardListener = clipboardListener;
    this.imageStore = imageStore;
    this.app = express();
    this.server = null;
    this._setupMiddleware();
    this._setupRoutes();
  }

  _setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use('/clip_images', express.static(config.IMAGE_DIR, {
      maxAge: '1d',
    }));
    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  _setupRoutes() {
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    this.app.get('/api/history', (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const type = req.query.type;
        const category = req.query.category;
        const startDate = req.query.startDate ? parseInt(req.query.startDate) : null;
        const endDate = req.query.endDate ? parseInt(req.query.endDate) : null;

        const filters = { limit, offset, type, category, startDate, endDate };
        const items = this.db.getByFilters(filters);
        const total = this.db.getCount();

        const processedItems = items.map(item => this._processItemForResponse(item, req));
        res.json({ items: processedItems, total, limit, offset });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/categories', (req, res) => {
      try {
        const categories = this.db.getCategories();
        res.json({ categories });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/history/:id/category', (req, res) => {
      try {
        const { category } = req.body;
        const success = this.db.updateCategory(req.params.id, category);
        if (!success) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json({ success, category });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/history/:id', (req, res) => {
      try {
        const item = this.db.getById(req.params.id);
        if (!item) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json(this._processItemForResponse(item, req));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/search', (req, res) => {
      try {
        const keyword = req.query.q;
        if (!keyword) {
          return res.status(400).json({ error: 'Missing query parameter q' });
        }
        const items = this.db.search(keyword);
        const processedItems = items.map(item => this._processItemForResponse(item, req));
        res.json({ items: processedItems, keyword });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/image/:id', async (req, res) => {
      try {
        const item = this.db.getById(req.params.id);
        if (!item || item.type !== 'image') {
          return res.status(404).json({ error: 'Not found' });
        }

        if (item.content.startsWith('data:image/')) {
          const match = item.content.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            const buffer = Buffer.from(match[2], 'base64');
            res.set('Content-Type', match[1]);
            return res.send(buffer);
          }
        }

        const filepath = this.imageStore.getImagePath(item.content);
        if (fs.existsSync(filepath)) {
          return res.sendFile(filepath);
        }

        res.status(404).json({ error: 'Image not found' });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/replay/:id', async (req, res) => {
      try {
        const item = this.db.getById(req.params.id);
        if (!item) {
          return res.status(404).json({ error: 'Not found' });
        }
        const success = await this.clipboardListener.writeClipboard(item.content, item.type);
        res.json({ success, item: { id: item.id, type: item.type } });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/stats', (req, res) => {
      try {
        const days = parseInt(req.query.days) || 7;
        const stats = this.db.getStats(days);
        const total = this.db.getCount();
        res.json({ stats, total, days });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/history/:id/pin', (req, res) => {
      try {
        const { isPinned } = req.body;
        const success = this.db.updatePinned(req.params.id, isPinned);
        if (!success) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json({ success, isPinned });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.patch('/api/history/:id/order', (req, res) => {
      try {
        const { sortOrder } = req.body;
        const success = this.db.updateSortOrder(req.params.id, sortOrder);
        if (!success) {
          return res.status(404).json({ error: 'Not found' });
        }
        res.json({ success, sortOrder });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/reorder', (req, res) => {
      try {
        const { items } = req.body;
        items.forEach((item, index) => {
          this.db.updateSortOrder(item.id, index);
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  _processItemForResponse(item, req) {
    if (!item) return item;
    
    const processed = { ...item };
    
    if (item.type === 'image' && !item.content.startsWith('data:image/')) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      processed.content = `${baseUrl}/api/image/${item.id}`;
      processed.imagePath = item.content;
    }
    
    return processed;
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(config.PORT, () => {
        console.log(`API 服务器运行在 http://localhost:${config.PORT}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = APIServer;
