const { contextBridge, ipcRenderer, webUtils } = require('electron');

// No raw IPC, arbitrary path reads, shell access, or caller-supplied output paths.
contextBridge.exposeInMainWorld('desktop', {
  open: () => ipcRenderer.invoke('desktop:open'),
  encodings: () => ipcRenderer.invoke('desktop:encodings'),
  openWithEncoding: encoding => ipcRenderer.invoke('desktop:open', encoding),
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
  htmlPreview: (operation, payload) => ipcRenderer.invoke('desktop:html-preview', operation, payload),
  htmlImport: (operation, payload) => ipcRenderer.invoke('desktop:html-import', operation, payload),
  resourceFolders: payload => ipcRenderer.invoke('desktop:resource-folders', payload),
  onHtmlPreviewFailure: handler => {
    const listener = (_event, document) => handler(document);
    ipcRenderer.on('desktop:html-preview-failed', listener);
    return () => ipcRenderer.removeListener('desktop:html-preview-failed', listener);
  },
  fullscreen: operation => ipcRenderer.invoke('desktop:fullscreen', operation),
  onFullscreen: handler => {
    const listener = (_event, active) => handler(active);
    ipcRenderer.on('desktop:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('desktop:fullscreen-changed', listener);
  },
  preferences: (operation, payload) => ipcRenderer.invoke('desktop:preferences', operation, payload),
  annotations: (operation, payload) => ipcRenderer.invoke('desktop:annotations', operation, payload),
  cancelPreview: () => ipcRenderer.invoke('desktop:cancel-preview'),
  recent: () => ipcRenderer.invoke('desktop:recent-list'),
  recentWorkspaces: () => ipcRenderer.invoke('desktop:recent-workspaces'),
  openRecentWorkspace: id => ipcRenderer.invoke('desktop:recent-workspace-open', id),
  clearRecent: () => ipcRenderer.invoke('desktop:recent-clear'),
  openRecent: id => ipcRenderer.invoke('desktop:recent-open', id),
  search: payload => ipcRenderer.invoke('desktop:search', payload),
  cancelSearch: id => ipcRenderer.invoke('desktop:search-cancel', id),
  onSearchProgress: handler => {
    const listener = (_event, progress) => handler(progress);
    ipcRenderer.on('desktop:search-progress', listener);
    return () => ipcRenderer.removeListener('desktop:search-progress', listener);
  },
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
  revealWorkspaceFile: documentId => ipcRenderer.invoke('desktop:workspace-reveal', documentId),
  openWorkspaceFile: payload => ipcRenderer.invoke('desktop:workspace-file', payload),
  closeWorkspace: id => ipcRenderer.invoke('desktop:workspace-close', id),
  exportDocument: payload => ipcRenderer.invoke('desktop:export', payload),
  cancelPdfPreview: requestId => ipcRenderer.invoke('desktop:cancel-pdf-preview', requestId),
  imageAction: payload => ipcRenderer.invoke('desktop:image-action', payload),
  copyCode: payload => ipcRenderer.invoke('desktop:copy-code', payload),
  tableAction: payload => ipcRenderer.invoke('desktop:table-action', payload),
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
