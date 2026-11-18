"use strict";
const { contextBridge, ipcRenderer } = require('electron');
// Only the trusted local setup document needs these methods.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('tmpDesktop', Object.freeze({
    currentServer: () => ipcRenderer.invoke('server:read'),
    connect: (server) => ipcRenderer.invoke('server:save', server),
  }));
}

// Only a presentation capability flag; authorization always uses the normal
// user/password login plus a server-issued revocable HttpOnly device grant.
if (location.protocol === 'http:' || location.protocol === 'https:') {
  contextBridge.exposeInMainWorld('tmpCameraDesktop', Object.freeze({
    isDesktop: true,
    clearLocalDeviceGrant: () => ipcRenderer.invoke('desktop:clear-device-grant'),
  }));
}
