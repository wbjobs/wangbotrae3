const config = require('../../config');

class ImageOCR {
  constructor(db, imageStore) {
    this.db = db;
    this.imageStore = imageStore;
    this.config = config.plugins.imageOCR;
    this.worker = null;
    this.queue = [];
    this.isProcessing = false;
  }

  async init() {
    if (!this.config.enabled) {
      console.log('[图片OCR] 插件已禁用');
      return false;
    }

    console.log('[图片OCR] 初始化中...');

    try {
      this._startQueueProcessor();
      console.log('[图片OCR] 初始化完成');
      return true;
    } catch (err) {
      console.error('[图片OCR] 初始化失败:', err.message);
      return false;
    }
  }

  async _getWorker() {
    if (this.worker) {
      return this.worker;
    }

    try {
      const Tesseract = await import('tesseract.js');
      this.worker = await Tesseract.createWorker({
        langPath: this.config.tesseractPath,
      });
      await this.worker.loadLanguage(this.config.language);
      await this.worker.initialize(this.config.language);
      return this.worker;
    } catch (err) {
      console.warn('[图片OCR] Tesseract初始化失败，使用降级模式:', err.message);
      return null;
    }
  }

  queueOCR(record) {
    if (!this.config.enabled) {
      return;
    }

    if (record.type === 'image') {
      this.queue.push(record);
    }
  }

  onNewRecord(record) {
    if (record.type === 'image') {
      this.queueOCR(record);
    }
  }

  _startQueueProcessor() {
    setInterval(() => {
      this._processQueue();
    }, 2000);
  }

  async _processQueue() {
    if (this.queue.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    const batch = this.queue.splice(0, 3);

    for (const record of batch) {
      try {
        const ocrText = await this._performOCR(record);
        if (ocrText) {
          this.db.updateOCRText(record.id, ocrText);
          console.log(`[图片OCR] 图片 #${record.id} OCR完成: ${ocrText.length} 字`);
        }
      } catch (err) {
        console.warn(`[图片OCR] 处理图片 #${record.id} 失败:`, err.message);
      }
    }

    this.isProcessing = false;
  }

  async _performOCR(record) {
    const imageContent = record.content;
    
    if (!imageContent.startsWith('data:image/')) {
      const base64 = await this.imageStore.getImageBase64(imageContent);
      return this._extractTextFromImage(base64);
    }
    
    return this._extractTextFromImage(imageContent);
  }

  async _extractTextFromImage(base64Data) {
    try {
      const worker = await this._getWorker();
      
      if (!worker) {
        return null;
      }

      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('OCR timeout')), this.config.timeout);
      });

      const result = await Promise.race([
        worker.recognize(base64Data),
        timeout,
      ]);

      return result.data.text.trim();
    } catch (err) {
      return null;
    }
  }

  async destroy() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

module.exports = ImageOCR;
