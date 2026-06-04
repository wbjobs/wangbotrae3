const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');

class CrossDeviceSync {
  constructor(db) {
    this.db = db;
    this.config = config.plugins.crossDeviceSync;
    this.client = null;
    this.syncTimer = null;
    this.deviceId = this._getDeviceId();
    this.isSyncing = false;
  }

  _getDeviceId() {
    if (this.config.deviceId) {
      return this.config.deviceId;
    }
    
    const macAddress = this._getMacAddress();
    return `cli-${macAddress.slice(0, 8)}`;
  }

  _getMacAddress() {
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      for (const iface of Object.values(interfaces)) {
        for (const { mac, internal } of iface) {
          if (!internal && mac !== '00:00:00:00:00:00') {
            return mac.replace(/:/g, '');
          }
        }
      }
    } catch (err) {
    }
    return uuidv4().slice(0, 12);
  }

  async init() {
    if (!this.config.enabled) {
      console.log('[跨设备同步] 插件已禁用');
      return false;
    }

    console.log('[跨设备同步] 初始化中...');
    console.log(`[跨设备同步] 设备ID: ${this.deviceId}`);

    try {
      if (this.config.mode === 'webdav') {
        await this._initWebDAV();
      }

      this._startSyncLoop();
      
      console.log('[跨设备同步] 初始化完成');
      return true;
    } catch (err) {
      console.error('[跨设备同步] 初始化失败:', err.message);
      return false;
    }
  }

  async _initWebDAV() {
    if (!this.config.webdav.url || !this.config.webdav.username) {
      throw new Error('WebDAV配置不完整，请配置url、username、password');
    }

    const { createClient } = await import('webdav');
    this.client = createClient(
      this.config.webdav.url,
      {
        username: this.config.webdav.username,
        password: this.config.webdav.password,
      }
    );

    const basePath = this.config.webdav.basePath;
    try {
      await this.client.createDirectory(basePath, { recursive: true });
      await this.client.createDirectory(`${basePath}/devices`, { recursive: true });
      await this.client.createDirectory(`${basePath}/history`, { recursive: true });
    } catch (err) {
    }
  }

  _startSyncLoop() {
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.config.syncInterval);

    setTimeout(() => this.sync(), 5000);
  }

  async sync() {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;

    try {
      console.log('[跨设备同步] 开始同步...');

      if (this.config.mode === 'webdav') {
        await this._syncWebDAV();
      }

      console.log('[跨设备同步] 同步完成');
    } catch (err) {
      console.error('[跨设备同步] 同步失败:', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  async _syncWebDAV() {
    const basePath = this.config.webdav.basePath;

    await this._pushLocalChanges(basePath);
    await this._pullRemoteChanges(basePath);
  }

  async _pushLocalChanges(basePath) {
    const lastSync = this.config.lastSyncTime || 0;
    
    const pendingItems = this.db.getPendingSyncItems(lastSync);
    
    if (pendingItems.length === 0) {
      return;
    }

    console.log(`[跨设备同步] 推送 ${pendingItems.length} 条本地变更`);

    const deviceDir = `${basePath}/devices/${this.deviceId}`;
    
    try {
      await this.client.createDirectory(deviceDir, { recursive: true });
    } catch (err) {
    }

    for (const item of pendingItems) {
      const itemData = {
        ...item,
        deviceId: this.deviceId,
        syncedAt: Date.now(),
      };

      const filename = `${item.id}_${item.timestamp}.json`;
      const filePath = `${deviceDir}/${filename}`;

      try {
        await this.client.putFileContents(
          filePath,
          JSON.stringify(itemData, null, 2)
        );
        
        this.db.markAsSynced(item.id);
      } catch (err) {
        console.warn(`[跨设备同步] 推送项目 ${item.id} 失败:`, err.message);
      }
    }

    this.config.lastSyncTime = Date.now();
  }

  async _pullRemoteChanges(basePath) {
    const devicesDir = `${basePath}/devices`;
    
    try {
      const contents = await this.client.getDirectoryContents(devicesDir);
      const deviceDirs = contents.filter(item => item.type === 'directory' && item.basename !== this.deviceId);

      for (const deviceDir of deviceDirs) {
        await this._pullFromDevice(deviceDir.filename);
      }
    } catch (err) {
    }
  }

  async _pullFromDevice(devicePath) {
    try {
      const files = await this.client.getDirectoryContents(devicePath);
      const jsonFiles = files.filter(f => f.type === 'file' && f.basename.endsWith('.json'));

      console.log(`[跨设备同步] 从 ${path.basename(devicePath)} 拉取 ${jsonFiles.length} 条记录`);

      for (const file of jsonFiles) {
        try {
          const content = await this.client.getFileContents(file.filename);
          const item = JSON.parse(content.toString());
          
          await this._mergeRemoteItem(item);
        } catch (err) {
        }
      }
    } catch (err) {
    }
  }

  async _mergeRemoteItem(remoteItem) {
    const localItem = this.db.getById(remoteItem.id);

    if (!localItem) {
      this.db.insertRemoteItem(remoteItem);
      console.log(`[跨设备同步] 新增远程记录: #${remoteItem.id}`);
      return;
    }

    if (this.config.conflictResolution === 'newerWins') {
      if (remoteItem.timestamp > localItem.timestamp) {
        this.db.updateItem(remoteItem.id, {
          content: remoteItem.content,
          timestamp: remoteItem.timestamp,
          sourceApp: remoteItem.sourceApp,
        });
        console.log(`[跨设备同步] 更新记录: #${remoteItem.id} (远程较新)`);
      }
    } else if (this.config.conflictResolution === 'localWins') {
    }
  }

  stop() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

module.exports = CrossDeviceSync;
