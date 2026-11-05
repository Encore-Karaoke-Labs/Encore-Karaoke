import { contextBridge, ipcRenderer } from "electron";

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
    off: (channel, callback) => {
      ipcRenderer.removeListener(channel, callback);
    },
  },
  openExternal: (url) => {
    ipcRenderer.send("open-external", url);
  },
});

contextBridge.exposeInMainWorld("deepLink", {
  onDeepLink: (callback) => {
    const listener = (event, url) => callback(url);
    ipcRenderer.on("deep-link", listener);
    return () => ipcRenderer.removeListener("deep-link", listener);
  },
  signalReady: () => ipcRenderer.send("deep-link-ready"),
});

contextBridge.exposeInMainWorld("karaoke", {
  togglePlayPause: () => ipcRenderer.invoke("karaoke:play-pause"),
  playOrReserveSong: (songOrCode) =>
    ipcRenderer.invoke("karaoke:play-or-reserve-song", songOrCode),
  getPlaybackInfo: () => ipcRenderer.invoke("karaoke:get-playback-info"),
  getSongList: (options = { offset: 0, limit: 100 }) =>
    ipcRenderer.invoke("karaoke:get-song-list", options),
  searchSongs: (query, limit = 50) =>
    ipcRenderer.invoke("karaoke:search-songs", { query, limit }),
  keyChange: (payload = "up") =>
    ipcRenderer.invoke("karaoke:key-change", payload),
  changeTempo: (direction = "up") =>
    ipcRenderer.invoke("karaoke:tempo-change", direction),
  toggleChorus: (enabled) =>
    ipcRenderer.invoke("karaoke:toggle-chorus", enabled),
  setGuideMelody: (level = "cycle") =>
    ipcRenderer.invoke("karaoke:guide-melody", level),
  adjustVolume: (direction = "up") =>
    ipcRenderer.invoke("karaoke:adjust-volume", direction),
  adjustMicVolume: (direction = "up") =>
    ipcRenderer.invoke("karaoke:adjust-mic-volume", direction),
  cycleRhythm: (direction = "right") =>
    ipcRenderer.invoke("karaoke:cycle-rhythm", direction),
  cycleBgv: (direction = 1) =>
    ipcRenderer.invoke("karaoke:cycle-bgv", direction),
  toggleRecording: () => ipcRenderer.invoke("karaoke:toggle-recording"),
  getQueue: () => ipcRenderer.invoke("karaoke:get-queue"),
  getAlbumArt: (song) => ipcRenderer.invoke("album-art:get", song),
  isAppReady: () => ipcRenderer.invoke("karaoke:app-ready"),
  onAppState: (callback) => {
    const listener = (_event, ready) => callback(Boolean(ready));
    ipcRenderer.on("karaoke:app-state", listener);
    return () => ipcRenderer.removeListener("karaoke:app-state", listener);
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

contextBridge.exposeInMainWorld("lyricsOverlay", {
  sendUpdate: (payload) => ipcRenderer.send("overlay-lyrics-update", payload),
  sendClear: () => ipcRenderer.send("overlay-lyrics-clear"),
});

contextBridge.exposeInMainWorld("setlistOverlay", {
  sendUpdate: (payload) => ipcRenderer.send("overlay-setlist-update", payload),
  sendClear: () => ipcRenderer.send("overlay-setlist-clear"),
});

contextBridge.exposeInMainWorld("obs", {
  connect: (config) => ipcRenderer.invoke("obs-connect", config),
  disconnect: () => ipcRenderer.invoke("obs-disconnect"),
  getStatus: () => ipcRenderer.invoke("obs-get-status"),
  setScene: (sceneName) => ipcRenderer.invoke("obs-set-scene", sceneName),
  triggerState: (state) => ipcRenderer.send("obs-trigger-state", state),
  onStatusUpdate: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("obs-status-update", listener);
    return () => ipcRenderer.removeListener("obs-status-update", listener);
  },
  onScenesUpdate: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("obs-scenes-update", listener);
    return () => ipcRenderer.removeListener("obs-scenes-update", listener);
  },
  onSceneChanged: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("obs-scene-changed", listener);
    return () => ipcRenderer.removeListener("obs-scene-changed", listener);
  },
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

contextBridge.exposeInMainWorld("platformHints", {
  get: async () => ipcRenderer.invoke("get-platform-hints"),
  has: async (hint) => {
    const state = await ipcRenderer.invoke("get-platform-hints");
    return Array.isArray(state?.hints) && state.hints.includes(hint);
  },
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
