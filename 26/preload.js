const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pcapAPI', {
  openFile: () => ipcRenderer.invoke('open-file'),
  getFlows: (filters) => ipcRenderer.invoke('get-flows', filters),
  getFlowDetail: (flowKey, maxPackets) => ipcRenderer.invoke('get-flow-detail', flowKey, maxPackets),
  exportFlowJSON: (flowKey) => ipcRenderer.invoke('export-flow-json', flowKey),
  exportFlowBinary: (flowKey) => ipcRenderer.invoke('export-flow-binary', flowKey),
  onParseProgress: (callback) => {
    ipcRenderer.on('parse-progress', (_, data) => callback(data));
    return () => ipcRenderer.removeListener('parse-progress', callback);
  },
  onParseComplete: (callback) => {
    ipcRenderer.on('parse-complete', () => callback());
    return () => ipcRenderer.removeListener('parse-complete', callback);
  },
  getStatistics: () => ipcRenderer.invoke('get-statistics'),
  listPlugins: () => ipcRenderer.invoke('list-plugins'),
  loadPlugin: (path) => ipcRenderer.invoke('load-plugin', path),
  unloadPlugin: (pluginId) => ipcRenderer.invoke('unload-plugin', pluginId),
  setPluginEnabled: (pluginId, enabled) => ipcRenderer.invoke('set-plugin-enabled', pluginId, enabled),
  openPluginFile: () => ipcRenderer.invoke('open-plugin-file')
});
