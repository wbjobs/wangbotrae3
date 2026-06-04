const config = require('../config');

class ClipboardListener {
  constructor(db, deduper, sourceDetector, imageStore) {
    this.db = db;
    this.deduper = deduper;
    this.sourceDetector = sourceDetector;
    this.imageStore = imageStore;
    this.clipboardy = null;
    this.lastContent = null;
    this.lastType = null;
    this.intervalId = null;
    this.isRunning = false;
    this.debounceTimer = null;
    this.pendingContent = null;
    this.pendingType = null;
    this.isProcessing = false;
    this.initPromise = null;
    this.plugins = {
      onNewRecord: [],
    };
  }

  addPlugin(plugin) {
    if (plugin.onNewRecord) {
      this.plugins.onNewRecord.push(plugin.onNewRecord.bind(plugin));
    }
  }

  async _initClipboardy() {
    if (this.clipboardy) return this.clipboardy;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = (async () => {
      const mod = await import('clipboardy');
      this.clipboardy = mod.default;
      return this.clipboardy;
    })();
    
    return this.initPromise;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('剪贴板监听器已启动');

    this.intervalId = setInterval(
      () => this.checkClipboard(),
      config.CLIPBOARD_POLL_INTERVAL
    );
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    console.log('剪贴板监听器已停止');
  }

  async checkClipboard() {
    if (this.isProcessing) return;

    try {
      const { content, type } = await this.readClipboard();
      
      if (!content || content === this.lastContent) {
        return;
      }

      if (type === 'text' && content.length > config.MAX_TEXT_LENGTH) {
        console.log('文本内容过大，跳过');
        return;
      }

      this.pendingContent = content;
      this.pendingType = type;

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(
        () => this._processPending(),
        config.DEBOUNCE_DELAY
      );
    } catch (err) {
      console.error('检查剪贴板出错:', err.message);
    }
  }

  async _processPending() {
    if (!this.pendingContent || this.isProcessing) return;

    this.isProcessing = true;
    const content = this.pendingContent;
    const type = this.pendingType;
    this.pendingContent = null;
    this.pendingType = null;
    this.debounceTimer = null;

    try {
      const isDuplicate = this.deduper.isDuplicate(content, type);
      if (isDuplicate) {
        this.lastContent = content;
        this.lastType = type;
        return;
      }

      let storedContent = content;
      if (type === 'image') {
        try {
          const imageInfo = await this.imageStore.saveImage(content);
          storedContent = imageInfo.relativePath;
          console.log(`图片已保存到文件: ${imageInfo.relativePath} (${Math.round(imageInfo.size / 1024)} KB)`);
        } catch (imgErr) {
          console.error('保存图片失败，使用base64存储:', imgErr.message);
        }
      }

      const sourceApp = await this.sourceDetector.getActiveWindow();
      const result = this.db.addRecord({ type, content: storedContent, sourceApp });
      const recordId = result.id || result;

      this.lastContent = content;
      this.lastType = type;

      console.log(`已记录 [${recordId}] ${type} 来自: ${sourceApp}`);

      const newRecord = {
        id: recordId,
        type,
        content,
        storedContent,
        timestamp: Date.now(),
        sourceApp,
      };

      for (const callback of this.plugins.onNewRecord) {
        try {
          callback(newRecord);
        } catch (err) {
          console.error('插件回调失败:', err.message);
        }
      }
    } catch (err) {
      console.error('处理剪贴板内容出错:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  async readClipboard() {
    try {
      const clipboardy = await this._initClipboardy();
      const text = await clipboardy.read();
      if (this._isBase64Image(text)) {
        return { content: text, type: 'image' };
      }
      return { content: text, type: 'text' };
    } catch (err) {
      return { content: null, type: null };
    }
  }

  _isBase64Image(str) {
    if (!str || str.length < 100) return false;
    const base64Pattern = /^data:image\/(png|jpeg|jpg|gif|bmp|webp);base64,/;
    return base64Pattern.test(str);
  }

  async writeClipboard(content, type) {
    try {
      const clipboardy = await this._initClipboardy();
      let writeContent = content;
      
      if (type === 'image' && !content.startsWith('data:image/')) {
        writeContent = await this.imageStore.getImageBase64(content);
      }

      if (type === 'text') {
        await clipboardy.write(writeContent);
      } else if (type === 'image') {
        await clipboardy.write(writeContent);
      }
      this.lastContent = writeContent;
      this.lastType = type;
      return true;
    } catch (err) {
      console.error('写入剪贴板出错:', err.message);
      return false;
    }
  }

  async getContentForDisplay(item) {
    if (item.type === 'image' && !item.content.startsWith('data:image/')) {
      try {
        return await this.imageStore.getImageBase64(item.content);
      } catch (err) {
        console.error('读取图片失败:', err.message);
        return item.content;
      }
    }
    return item.content;
  }
}

module.exports = ClipboardListener;
