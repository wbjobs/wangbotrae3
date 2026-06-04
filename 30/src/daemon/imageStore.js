const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

class ImageStore {
  constructor() {
    this.imageDir = config.IMAGE_DIR;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.imageDir)) {
      fs.mkdirSync(this.imageDir, { recursive: true });
    }
  }

  saveImage(base64Data) {
    return new Promise((resolve, reject) => {
      try {
        const match = base64Data.match(/^data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,(.+)$/);
        if (!match) {
          return reject(new Error('无效的图片base64格式'));
        }

        const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
        const data = match[2];
        const buffer = Buffer.from(data, 'base64');

        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        const filename = `${hash}.${ext}`;
        const filepath = path.join(this.imageDir, filename);
        const relativePath = `clip_images/${filename}`;

        if (fs.existsSync(filepath)) {
          return resolve({ filepath, relativePath, hash, size: buffer.length });
        }

        fs.writeFile(filepath, buffer, (err) => {
          if (err) reject(err);
          else resolve({ filepath, relativePath, hash, size: buffer.length });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  getImagePath(relativePath) {
    if (relativePath.startsWith('data:image/')) {
      return relativePath;
    }
    const filename = path.basename(relativePath);
    return path.join(this.imageDir, filename);
  }

  getImageBase64(relativePath) {
    return new Promise((resolve, reject) => {
      if (relativePath.startsWith('data:image/')) {
        return resolve(relativePath);
      }

      const filepath = this.getImagePath(relativePath);
      fs.readFile(filepath, (err, data) => {
        if (err) return reject(err);
        
        const ext = path.extname(filepath).slice(1);
        const mimeType = ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        const base64 = `data:${mimeType};base64,${data.toString('base64')}`;
        resolve(base64);
      });
    });
  }

  getImageSize(relativePath) {
    return new Promise((resolve, reject) => {
      if (relativePath.startsWith('data:image/')) {
        const match = relativePath.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (match) {
          return resolve(Buffer.byteLength(match[2], 'base64'));
        }
        return reject(new Error('无效的base64格式'));
      }

      const filepath = this.getImagePath(relativePath);
      fs.stat(filepath, (err, stats) => {
        if (err) reject(err);
        else resolve(stats.size);
      });
    });
  }
}

module.exports = ImageStore;
