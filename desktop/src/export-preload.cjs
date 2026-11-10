const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  render: payload => ipcRenderer.invoke('desktop:render', payload),
});
