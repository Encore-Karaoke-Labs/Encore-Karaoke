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
