const { contextBridge, ipcRenderer, webUtils } = require('electron');

// No raw IPC, arbitrary path reads, shell access, or caller-supplied output paths.
contextBridge.exposeInMainWorld('desktop', {
  open: () => ipcRenderer.invoke('desktop:open'),
  newDocument: () => ipcRenderer.invoke('desktop:new'),
  session: () => ipcRenderer.invoke('desktop:session'),
  pendingOpens: () => ipcRenderer.invoke('desktop:pending-opens'),
  openDroppedFiles: files => {
    if(!Array.isArray(files)||!files.length||files.length>32)throw Error('每次最多拖入 32 个文件或文件夹');
    // Only native File objects retain a filesystem path across the bridge.
    const paths=files.map(file=>webUtils.getPathForFile(file));
    if(paths.some(value=>!value))throw Error('拖放对象没有本机文件路径，请从系统文件管理器拖入');
    return ipcRenderer.invoke('desktop:drop',paths);
  },
  openPending: id => ipcRenderer.invoke('desktop:open-pending', id),
  onExternalOpen: handler => {
    const listener=()=>handler();ipcRenderer.on('desktop:external-open',listener);
    return ()=>ipcRenderer.removeListener('desktop:external-open',listener);
  },
  appInfo: () => ipcRenderer.invoke('desktop:app-info'),
  preferences: (operation, payload) => ipcRenderer.invoke('desktop:preferences', operation, payload),
  cancelPreview: () => ipcRenderer.invoke('desktop:cancel-preview'),
  recent: () => ipcRenderer.invoke('desktop:recent-list'),
  clearRecent: () => ipcRenderer.invoke('desktop:recent-clear'),
  openRecent: id => ipcRenderer.invoke('desktop:recent-open', id),
  search: payload => ipcRenderer.invoke('desktop:search', payload),
  cancelSearch: id => ipcRenderer.invoke('desktop:search-cancel', id),
  activate: id => ipcRenderer.invoke('desktop:activate', id),
  openLocalLink: payload => ipcRenderer.invoke('desktop:local-link',payload),
  summaryIndex: payload => ipcRenderer.invoke('desktop:summary-index',payload),
  closeTab: id => ipcRenderer.invoke('desktop:close-tab', id),
  closeTabs: payload => ipcRenderer.invoke('desktop:close-tabs',payload),
  updateDraft: payload => ipcRenderer.invoke('desktop:draft', payload),
  save: payload => ipcRenderer.invoke('desktop:save', payload),
  reload: id => ipcRenderer.invoke('desktop:reload', id),
  onFileChange: handler => {
    const listener = (_event, change) => handler(change);
    ipcRenderer.on('desktop:file-change', listener);
    return () => ipcRenderer.removeListener('desktop:file-change', listener);
  },
  openWorkspace: () => ipcRenderer.invoke('desktop:workspace-open'),
  listWorkspace: payload => ipcRenderer.invoke('desktop:workspace-list', payload),
  openWorkspaceFile: payload => ipcRenderer.invoke('desktop:workspace-file', payload),
  closeWorkspace: id => ipcRenderer.invoke('desktop:workspace-close', id),
  exportDocument: payload => ipcRenderer.invoke('desktop:export', payload),
  cancelExport: () => ipcRenderer.invoke('desktop:cancel-export'),
  render: payload => ipcRenderer.invoke('desktop:render', payload),
  state: (operation, payload) => ipcRenderer.invoke('desktop:state', { operation, payload }),
  service: envelope => ipcRenderer.invoke('desktop:service', envelope),
  onService: handler => {
    const listener = (_event, message) => handler(message);
    ipcRenderer.on('desktop:service-event', listener);
    return () => ipcRenderer.removeListener('desktop:service-event', listener);
  },
});
