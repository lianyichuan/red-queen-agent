'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const SEND = ['javis:send', 'javis:stop', 'javis:audioEnded', 'javis:getConfig', 'javis:saveConfig', 'javis:openSettings', 'javis:hide', 'javis:quit', 'javis:menu', 'javis:resize', 'javis:dragStart', 'javis:dragEnd', 'javis:focusWin'];
const RECV = ['javis:mode', 'javis:state', 'javis:outline', 'javis:reply', 'javis:error', 'javis:busy', 'javis:config', 'javis:dictation', 'javis:dictationStatus', 'javis:rex'];

contextBridge.exposeInMainWorld('javis', {
  send: (text) => ipcRenderer.send('javis:send', text),
  openRex: () => ipcRenderer.invoke('javis:openRex'),
  getDictationStatus: () => ipcRenderer.invoke('javis:getDictationStatus'),
  setDictationEnabled: (enabled) => ipcRenderer.invoke('javis:setDictationEnabled', enabled),
  stop: () => ipcRenderer.send('javis:stop'),
  islandStatus: (status) => ipcRenderer.send('javis:islandStatus', status),
  audioLevel: (level) => ipcRenderer.send('javis:audioLevel', level),
  audioEnded: () => ipcRenderer.send('javis:audioEnded'),
  getConfig: () => ipcRenderer.invoke('javis:getConfig'),
  saveConfig: (patch) => ipcRenderer.invoke('javis:saveConfig', patch),
  openSettings: () => ipcRenderer.send('javis:openSettings'),
  hide: () => ipcRenderer.send('javis:hide'),
  quit: () => ipcRenderer.send('javis:quit'),
  menu: () => ipcRenderer.send('javis:menu'),
  resize: (w, h) => ipcRenderer.send('javis:resize', w, h),
  dragStart: () => ipcRenderer.send('javis:dragStart'),
  dragEnd: () => ipcRenderer.send('javis:dragEnd'),
  focusWin: () => ipcRenderer.send('javis:focusWin'),
  boot: (info) => ipcRenderer.send('javis:boot', info),
  on: (channel, cb) => {
    if (!RECV.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  SEND,
  RECV,
});
