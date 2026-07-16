const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopIntegration", {
  ipc: {
    send: (channel, data) => {
      ipcRenderer.send(channel, data);
    },
    invoke: (channel, data) => {
      return ipcRenderer.invoke(channel, data);
    },
    on: (channel, callback) => {
      ipcRenderer.on(channel, callback);
    },
  },
});

contextBridge.exposeInMainWorld("config", {
  getAll: () => ipcRenderer.invoke("config-get-all"),
  getItem: (key) => ipcRenderer.invoke("config-get-item", key),
  setItem: (key, value) => ipcRenderer.send("config-set-item", { key, value }),
  merge: (dataObject) => ipcRenderer.send("config-merge", dataObject),
});

contextBridge.exposeInMainWorld("romanization", {
  romanize: async (rawJapanese) => ipcRenderer.invoke("romanize", rawJapanese),
});

contextBridge.exposeInMainWorld("networking", {
  port: async () => ipcRenderer.invoke("get-port"),
  accessToken: async () => ipcRenderer.invoke("get-file-token"),
});

contextBridge.exposeInMainWorld("volume", {
  getVolume: async () => ipcRenderer.invoke("get-volume"),
  setVolume: async (vol) => ipcRenderer.send("set-volume", vol),
});

contextBridge.exposeInMainWorld("version", {
  getVersionInformation: async () => ipcRenderer.invoke("get-version"),
});

contextBridge.exposeInMainWorld("kiosk", {
  isEnabled: async () => ipcRenderer.invoke("get-kiosk-enabled"),
});

contextBridge.exposeInMainWorld("fullscreen", {
  get: async () => ipcRenderer.invoke("fullscreen-get"),
  set: async (value) => ipcRenderer.invoke("fullscreen-set", value),
  toggle: async () => ipcRenderer.invoke("fullscreen-toggle"),
});

contextBridge.exposeInMainWorld("zoom", {
  get: async () => ipcRenderer.invoke("zoom-get"),
  set: async (value) => ipcRenderer.invoke("zoom-set", value),
  reset: async () => ipcRenderer.invoke("zoom-reset"),
  in: async () => ipcRenderer.invoke("zoom-in"),
  out: async () => ipcRenderer.invoke("zoom-out"),
});
