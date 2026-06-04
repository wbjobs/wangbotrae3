const path = require('path');
const os = require('os');

const dataDir = process.env.CLIPBOARD_DATA_DIR || path.join(os.homedir(), '.clipboard-hub');

const config = {
  PORT: 8765,
  WEB_PORT: 3000,
  DB_PATH: path.join(dataDir, 'clipboard.db'),
  IMAGE_DIR: path.join(dataDir, 'clip_images'),
  MODEL_DIR: path.join(dataDir, 'models'),
  DEDUP_THRESHOLD: 0.8,
  DEDUP_RECENT_COUNT: 10,
  CLIPBOARD_POLL_INTERVAL: 500,
  DEBOUNCE_DELAY: 100,
  MAX_TEXT_LENGTH: 100000,
  MAX_HISTORY_DISPLAY: 20,

  plugins: {
    smartClassification: {
      enabled: true,
      trainOnStartup: true,
      autoClassify: true,
      defaultCategories: ['工作', '学习', '娱乐', '代码', '购物', '社交', '其他'],
      minConfidence: 0.3,
    },

    imageOCR: {
      enabled: true,
      tesseractPath: null,
      language: 'chi_sim+eng',
      timeout: 30000,
      quality: 'medium',
    },

    crossDeviceSync: {
      enabled: false,
      mode: 'webdav',
      syncInterval: 300000,
      deviceId: null,
      webdav: {
        url: '',
        username: '',
        password: '',
        basePath: '/clipboard-hub',
      },
      conflictResolution: 'newerWins',
      lastSyncTime: 0,
    },
  },
};

module.exports = config;
