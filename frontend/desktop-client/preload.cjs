"use strict";
const { contextBridge, ipcRenderer } = require('electron');
// Only the trusted local setup document needs these methods.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('tmpDesktop', Object.freeze({
    currentServer: () => ipcRenderer.invoke('server:read'),
    connect: (server) => ipcRenderer.invoke('server:save', server),
  }));
}
