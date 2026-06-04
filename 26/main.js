const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { filterFlows } = require('./pcap-parser');
const { globalPluginManager } = require('./plugin-manager');

app.setPath('userData', path.join(__dirname, 'app-data'));
app.commandLine.appendSwitch('no-sandbox');

let mainWindow;
let parsedData = null;
let currentFilePath = null;
let activeWorker = null;
let statistics = null;

globalPluginManager.loadBuiltinPlugins();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Pcap Network Analyzer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0f172a',
    show: false
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (activeWorker) {
    activeWorker.terminate();
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Capture Files', extensions: ['pcap', 'pcapng', 'cap', 'dmp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'No file selected' };
  }

  const filePath = result.filePaths[0];
  return new Promise((resolve) => {
    startParseWorker(filePath, resolve);
  });
});

function startParseWorker(filePath, resolve) {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }

  activeWorker = new Worker(path.join(__dirname, 'pcap-worker.js'), {
    workerData: { filePath }
  });

  let resolved = false;

  activeWorker.on('message', (msg) => {
    if (msg.type === 'progress') {
      if (mainWindow && !msg.done) {
        mainWindow.webContents.send('parse-progress', {
          packetCount: msg.packetCount,
          bytesProcessed: msg.bytesProcessed,
          totalBytes: msg.totalBytes,
          percent: Math.floor((msg.bytesProcessed / msg.totalBytes) * 100)
        });
      }
    } else if (msg.type === 'complete') {
      parsedData = msg.result;
      statistics = msg.result.statistics || null;
      currentFilePath = filePath;
      if (!resolved) {
        resolved = true;
        resolve({
          success: true,
          filePath,
          totalPackets: parsedData.totalPackets,
          flowCount: parsedData.flowCount,
          hasStatistics: !!statistics,
          flows: serializeFlows(parsedData.flows)
        });
      }
      cleanupWorker();
    } else if (msg.type === 'error') {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: msg.error });
      }
      cleanupWorker();
    }
  });

  activeWorker.on('error', (err) => {
    if (!resolved) {
      resolved = true;
      resolve({ success: false, error: err.message });
    }
    cleanupWorker();
  });

  activeWorker.on('exit', (code) => {
    if (code !== 0 && !resolved) {
      resolved = true;
      resolve({ success: false, error: `Worker exited with code ${code}` });
    }
    cleanupWorker();
  });

  function cleanupWorker() {
    activeWorker = null;
    if (mainWindow) {
      mainWindow.webContents.send('parse-complete');
    }
  }
}

ipcMain.handle('get-flows', async (event, filters) => {
  if (!parsedData) {
    return { success: false, error: 'No file loaded' };
  }

  let result;
  if (filters && Object.keys(filters).some(k => filters[k])) {
    result = filterFlows(parsedData, filters);
  } else {
    result = parsedData;
  }

  return {
    success: true,
    totalPackets: result.totalPackets,
    flowCount: result.flowCount,
    flows: serializeFlows(result.flows)
  };
});

ipcMain.handle('get-flow-detail', async (event, flowKey, maxPackets = null) => {
  if (!parsedData) {
    return { success: false, error: 'No file loaded' };
  }

  const flow = parsedData.flows.find(f => f.key === flowKey);
  if (!flow) {
    return { success: false, error: 'Flow not found' };
  }

  let packets = flow.packets;
  let isSampled = false;
  let sampleRate = 1;

  if (maxPackets && packets.length > maxPackets) {
    sampleRate = Math.ceil(packets.length / maxPackets);
    packets = packets.filter((_, i) => i % sampleRate === 0);
    isSampled = true;
  }

  return {
    success: true,
    flow: {
      ...serializeFlow(flow),
      packets,
      isSampled,
      sampleRate,
      actualPacketCount: flow.packets.length
    }
  };
});

ipcMain.handle('export-flow-json', async (event, flowKey) => {
  if (!parsedData) {
    return { success: false, error: 'No file loaded' };
  }

  const flow = parsedData.flows.find(f => f.key === flowKey);
  if (!flow) {
    return { success: false, error: 'Flow not found' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `flow_${flow.srcIp}_${flow.srcPort}_${flow.dstIp}_${flow.dstPort}_${flow.protocol}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled) return { success: false, error: 'Cancelled' };

  const exportData = {
    flowInfo: {
      srcIp: flow.srcIp,
      dstIp: flow.dstIp,
      srcPort: flow.srcPort,
      dstPort: flow.dstPort,
      protocol: flow.protocol,
      packetCount: flow.packetCount,
      startTime: flow.startTime,
      endTime: flow.endTime,
      duration: flow.duration
    },
    packets: flow.packets
  };

  fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
  return { success: true, filePath: result.filePath };
});

ipcMain.handle('export-flow-binary', async (event, flowKey) => {
  if (!parsedData) {
    return { success: false, error: 'No file loaded' };
  }

  const flow = parsedData.flows.find(f => f.key === flowKey);
  if (!flow) {
    return { success: false, error: 'Flow not found' };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `flow_${flow.srcIp}_${flow.srcPort}_${flow.dstIp}_${flow.dstPort}_${flow.protocol}.bin`,
    filters: [{ name: 'Binary', extensions: ['bin'] }]
  });

  if (result.canceled) return { success: false, error: 'Cancelled' };

  const buffers = [];
  for (const pkt of flow.packets) {
    const header = Buffer.alloc(12);
    header.writeUInt32BE(Math.floor(pkt.timestamp), 0);
    header.writeUInt32BE(Math.round((pkt.timestamp % 1) * 1000000), 4);
    header.writeUInt32BE(pkt.capturedLength, 8);
    buffers.push(header);
    buffers.push(Buffer.from(pkt.hexPreview, 'hex'));
  }

  fs.writeFileSync(result.filePath, Buffer.concat(buffers));
  return { success: true, filePath: result.filePath };
});

ipcMain.handle('get-statistics', async () => {
  if (!statistics) {
    return { success: false, error: 'No statistics available' };
  }
  return { success: true, statistics };
});

ipcMain.handle('list-plugins', async () => {
  const plugins = globalPluginManager.listPlugins();
  return { success: true, plugins };
});

ipcMain.handle('load-plugin', async (event, pluginPath) => {
  const result = globalPluginManager.loadPlugin(pluginPath);
  if (result.success) {
    return { success: true, plugin: result.plugin };
  }
  return { success: false, error: result.error };
});

ipcMain.handle('unload-plugin', async (event, pluginId) => {
  return globalPluginManager.unloadPlugin(pluginId);
});

ipcMain.handle('set-plugin-enabled', async (event, pluginId, enabled) => {
  return globalPluginManager.setPluginEnabled(pluginId, enabled);
});

ipcMain.handle('open-plugin-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, error: 'No file selected' };
  }
  return { success: true, filePath: result.filePaths[0] };
});

function serializeFlows(flows) {
  return flows.map(f => serializeFlow(f));
}

function serializeFlow(flow) {
  return {
    key: flow.key,
    srcIp: flow.srcIp,
    dstIp: flow.dstIp,
    srcPort: flow.srcPort,
    dstPort: flow.dstPort,
    protocol: flow.protocol,
    protocolNum: flow.protocolNum,
    packetCount: flow.packetCount,
    startTime: flow.startTime,
    endTime: flow.endTime,
    duration: flow.duration
  };
}
