const ClipboardDatabase = require('./db');
const Deduper = require('./deduper');
const ClipboardListener = require('./clipboardListener');
const SourceDetector = require('./sourceDetector');
const ImageStore = require('./imageStore');
const APIServer = require('./api');
const SmartClassifier = require('./plugins/smartClassifier');
const ImageOCR = require('./plugins/imageOCR');
const CrossDeviceSync = require('./plugins/crossDeviceSync');

class Daemon {
  constructor() {
    this.db = new ClipboardDatabase();
    this.deduper = new Deduper(this.db);
    this.sourceDetector = new SourceDetector();
    this.imageStore = new ImageStore();
    this.clipboardListener = new ClipboardListener(this.db, this.deduper, this.sourceDetector, this.imageStore);
    this.apiServer = new APIServer(this.db, this.clipboardListener, this.imageStore);
    this.plugins = {};
  }

  async _initPlugins() {
    console.log('\n初始化插件系统...');

    try {
      this.plugins.smartClassifier = new SmartClassifier(this.db);
      this.clipboardListener.addPlugin(this.plugins.smartClassifier);
      await this.plugins.smartClassifier.init();
    } catch (err) {
      console.error('[智能分类] 初始化失败:', err.message);
    }

    try {
      this.plugins.imageOCR = new ImageOCR(this.db, this.imageStore);
      this.clipboardListener.addPlugin(this.plugins.imageOCR);
      await this.plugins.imageOCR.init();
    } catch (err) {
      console.error('[图片OCR] 初始化失败:', err.message);
    }

    try {
      this.plugins.crossDeviceSync = new CrossDeviceSync(this.db);
      await this.plugins.crossDeviceSync.init();
    } catch (err) {
      console.error('[跨设备同步] 初始化失败:', err.message);
    }
  }

  async start() {
    console.log('========================================');
    console.log('  剪贴板历史中心守护服务启动中...');
    console.log('========================================');

    await this._initPlugins();

    await this.apiServer.start();
    this.clipboardListener.start();

    this._setupGracefulShutdown();

    console.log('\n守护服务运行中，按 Ctrl+C 停止');
    console.log('========================================');
  }

  async stop() {
    console.log('\n正在停止守护服务...');
    this.clipboardListener.stop();
    
    if (this.plugins.crossDeviceSync) {
      this.plugins.crossDeviceSync.stop();
    }
    if (this.plugins.imageOCR) {
      await this.plugins.imageOCR.destroy?.();
    }

    await this.apiServer.stop();
    this.db.close();
    console.log('守护服务已停止');
    process.exit(0);
  }

  _setupGracefulShutdown() {
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    process.on('uncaughtException', (err) => {
      console.error('未捕获的异常:', err);
      this.stop();
    });
  }
}

if (require.main === module) {
  const daemon = new Daemon();
  daemon.start().catch((err) => {
    console.error('启动失败:', err);
    process.exit(1);
  });
}

module.exports = Daemon;
