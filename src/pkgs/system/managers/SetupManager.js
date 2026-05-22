import Html from "../../../libs/html.js";

/**
 * Joins path parts with a given separator, normalizing leading and trailing slashes.
 *
 * @author anneb (Modified by community)
 * @license CC BY-SA 4.0
 * @see https://stackoverflow.com/a
 *
 * @param {string[]} parts - The path segments to join.
 * @param {string} [sep="/"] - The separator to use.
 * @returns {string} The normalized joined path.
 */
function pathJoin(parts, sep) {
  const separator = sep || "/";
  parts = parts.map((part, index) => {
    if (index) {
      part = part.replace(new RegExp("^" + separator), "");
    }
    if (index !== parts.length - 1) {
      part = part.replace(new RegExp(separator + "$"), "");
    }
    return part;
  });
  return parts.join(separator);
}

/**
 * Controller for the Encore Setup environment embedded inside Encore Home.
 * Handles system configuration, including audio/video settings, library selection, and security.
 */
export default class SetupManager {
  /**
   * Initializes the Setup Manager within the Encore Context.
   *
   * @param {Object} context - The shared context mapping to Encore state and services.
   */
  constructor(context) {
    this.ctx = context;

    this.micDevices = [];
    this.playbackDevices = [];
    this.updateServers = [];

    this.setupState = {
      view: "auth",
      authInput: "",
      dashboardIndex: 0,
      dashboardScrollTop: 0,
      submenuIndex: 0,
      submenuScrollTop: 0,
      activeMenuId: null,
      pinChangeStep: 0,
      newPinTemp: "",
      isVerifying: false,
      dialog: null,
      previewingVideo: false,
      manualCalib: null,
      syncing: false,
      syncProgress: { current: 0, total: 0, filename: "" },
      buildingLibrary: false,
      buildProgress: { current: 0, total: 0, percentage: 0 },
    };

    this.previewVideoEl = null;
    this.offsetDisplay = null;
    this.previewSyncFrame = null;

    this.boundBuildProgress = (e) => {
      if (!this.setupState.buildingLibrary) return;
      this.setupState.buildProgress = e.detail;

      if (this.buildProgressText) {
        this.buildProgressText.text(
          `Processing: ${e.detail.current} / ${e.detail.total}`,
        );
      }
      if (this.buildProgressBar) {
        this.buildProgressBar.styleJs({ width: `${e.detail.percentage}%` });
      }
    };
  }

  init() {
    document.addEventListener(
      "CherryTree.FsSvc.SongList.Progress",
      this.boundBuildProgress,
    );
  }

  /**
   * Triggers the setup mode, taking over the screen and loading initial configurations.
   */
  async open() {
    this.ctx.modules.bgv.stop();
    this.ctx.services.Forte.stopTrack();

    this.micDevices = await this.ctx.services.Forte.getMicDevices();
    this.playbackDevices = await this.ctx.services.Forte.getPlaybackDevices();
    this.updateServers =
      await window.desktopIntegration.ipc.invoke("get-update-servers");

    const foundLibs = await this.ctx.services.FsSvc.findEncoreLibraries();
    const activeLib = foundLibs.find(
      (l) => l.path === this.ctx.config.libraryPath,
    );
    this.currentManifest = activeLib
      ? activeLib.manifest
      : { title: "Unknown", description: "No metadata available." };

    this.setupState.view = "auth";
    this.setupState.authInput = "";
    this.setupState.dashboardIndex = 0;

    this.buildSettingsMap();
    this.renderView();
  }

  /**
   * Cleans up the view and reverts system back to menu mode.
   */
  exitSetup() {
    if (this.previewSyncFrame) cancelAnimationFrame(this.previewSyncFrame);
    if (this.setupState.manualCalib?.active) this.exitManualCalibration();

    this.ctx.root.ui.setMode("menu");

    this.ctx.root.library.init().then(() => {
      this.ctx.modules.bgv.start();
      this.ctx.modules.bgv.updatePlaylistForCategory();
    });
  }

  async verifyPin(input) {
    const pinData = this.ctx.config.security?.pinData;
    if (!pinData) return input === "0000";
    try {
      const res = await fetch(
        `http://127.0.0.1:${this.ctx.state.actualPort}/auth/verify-hash`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: input,
            salt: pinData.salt,
            hash: pinData.hash,
          }),
        },
      );
      const data = await res.json();
      return data.valid;
    } catch (e) {
      console.error("PIN Verification Error:", e);
      return false;
    }
  }

  async createPinHash(input) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${this.ctx.state.actualPort}/auth/create-hash`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: input }),
        },
      );
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  buildSettingsMap() {
    this.DASHBOARD_TILES = [
      { id: "library", label: "Library & Storage", icon: "folder" },
      { id: "sync", label: "Network Sync", icon: "cloud-download" },
      { id: "audio", label: "Sound Settings", icon: "volume-high" },
      { id: "mic", label: "Microphone Settings", icon: "mic" },
      { id: "video", label: "Video Settings", icon: "tv" },
      { id: "security", label: "User Security", icon: "lock-closed" },
      { id: "exit", label: "Exit Setup", icon: "log-out" },
    ];

    const micOptions = this.micDevices.map((d) => ({
      label: d.label || "Default",
      value: d.deviceId,
    }));
    const playbackOptions = this.playbackDevices.map((d) => ({
      label: d.label || "Default",
      value: d.deviceId,
    }));

    const serverOptions =
      this.updateServers && this.updateServers.length > 0
        ? this.updateServers.map((s) => ({ label: s.host, value: s.id }))
        : [{ label: "No servers found", value: "none" }];
    if (
      !this.setupState.selectedServerId ||
      !serverOptions.find((o) => o.value === this.setupState.selectedServerId)
    ) {
      this.setupState.selectedServerId = serverOptions[0].value;
    }

    this.SUBMENUS = {
      library: {
        title: "Library Configuration",
        items: [
          {
            id: "title",
            label: "Library Name",
            type: "info",
            get: () => this.currentManifest?.title || "Unknown",
          },
          {
            id: "desc",
            label: "Description",
            type: "info-action",
            get: () => this.currentManifest?.description || "N/A",
            action: () => {
              this.setupState.dialog = {
                title: "Library Description",
                content:
                  this.currentManifest?.description ||
                  "No description provided by this library.",
              };
              this.renderView();
            },
          },
          {
            id: "path",
            label: "Path",
            type: "info",
            get: () => this.ctx.config.libraryPath || "Not Set",
          },
          {
            id: "scan",
            label: "Rescan & Change Library",
            type: "action",
            action: async () => await this.handleLibraryScan(),
          },
        ],
      },
      sync: {
        title: "Network Sync",
        items: [
          {
            id: "server_select",
            label: "Target Update Server",
            type: "select",
            options: serverOptions,
            get: () => this.setupState.selectedServerId,
            set: (v) => (this.setupState.selectedServerId = v),
          },
          {
            id: "refresh_servers",
            label: "Refresh Server List",
            type: "action",
            action: async () => {
              this.showToast("REFRESHING...", "info");
              this.updateServers =
                await window.desktopIntegration.ipc.invoke(
                  "get-update-servers",
                );
              this.buildSettingsMap();
              this.renderView();
            },
          },
          {
            id: "start_sync",
            label: "Start Network Download",
            type: "action",
            action: () => this.startNetworkSync(),
          },
        ],
      },
      audio: {
        title: "Sound Settings",
        items: [
          {
            id: "out_device",
            label: "Main Audio Output",
            type: "select",
            options: playbackOptions,
            get: () =>
              this.ctx.config.audioConfig?.mix?.instrumental?.outputDevice ||
              "default",
            set: (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.mix ??= {};
              this.ctx.config.audioConfig.mix.instrumental ??= {};
              this.ctx.config.audioConfig.mix.instrumental.outputDevice = v;
              window.config.setItem(
                "audioConfig.mix.instrumental.outputDevice",
                v,
              );
              this.ctx.services.Forte.setPlaybackDevice(v);
            },
          },
          {
            id: "buffer_size",
            label: "Buffer Size (ms) (restart required)",
            type: "range",
            min: 10,
            max: 1000,
            step: 10,
            get: () =>
              Math.round(
                (this.ctx.config.audioConfig?.bufferSize ?? 0.1) * 1000,
              ),
            set: (v) => {
              const val = v / 1000;
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.bufferSize = val;
              window.config.setItem("audioConfig.bufferSize", val);
            },
          },
          {
            id: "vol",
            label: "Master Volume",
            type: "range",
            min: 0,
            max: 100,
            step: 5,
            get: () =>
              Math.round(
                (this.ctx.config.audioConfig?.mix?.instrumental?.volume ?? 1) *
                  100,
              ),
            set: (v) => {
              const val = v / 100;
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.mix ??= {};
              this.ctx.config.audioConfig.mix.instrumental ??= {};
              this.ctx.config.audioConfig.mix.instrumental.volume = val;
              window.config.setItem("audioConfig.mix.instrumental.volume", val);
              this.ctx.services.Forte.setTrackVolume(val);
            },
          },
          {
            id: "test",
            label: "Test Audio Output",
            type: "action",
            action: () => {
              this.ctx.services.Forte.stopSfx();
              this.ctx.services.Forte.playSfx(
                "/assets/audio/Uta wa I Love You (I Sing I Love You) [Encore Karaoke Jingle].mid",
              );
              this.showToast("PLAYING TEST SOUND...", "info");
            },
          },
          {
            id: "use_library_font",
            label: "Use Library Soundfont",
            type: "select",
            options: [
              { value: false, label: "No" },
              { value: true, label: "Yes" },
            ],
            get: () => this.ctx.config.audioConfig?.useLibraryFont ?? true,
            set: async (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.useLibraryFont = v;
              window.config.setItem("audioConfig.useLibraryFont", v);

              let soundFontUrl = "/libs/soundfonts/SAM2695.sf2";
              if (
                v == true &&
                this.currentManifest?.additionalContents?.soundFont
              ) {
                const url = new URL(
                  `http://127.0.0.1:${this.ctx.state.actualPort}/getFile`,
                );
                const soundFontPath = pathJoin([
                  this.ctx.config.libraryPath,
                  this.currentManifest.additionalContents.soundFont,
                ]);
                url.searchParams.append("path", soundFontPath);
                soundFontUrl = url.href;
              }
              this.showToast("LOADING SOUNDFONT...", "info");
              await this.ctx.services.Forte.loadSoundFont(soundFontUrl);
              this.showToast("LOADED SUCCESSFULLY", "success");
            },
          },
          {
            id: "enable_nav_sfx",
            label: "Enable Navigation Sounds",
            type: "select",
            options: [
              { value: false, label: "No" },
              { value: true, label: "Yes" },
            ],
            get: () => this.ctx.config.audioConfig?.enableNavSfx ?? true,
            set: (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.enableNavSfx = v;
              this.ctx.state.isNavSfxEnabled = v;
              window.config.setItem("audioConfig.enableNavSfx", v);
            },
          },
          {
            id: "enable_score_fanfare",
            label: "Enable Score Fanfare",
            type: "select",
            options: [
              { value: false, label: "No" },
              { value: true, label: "Yes" },
            ],
            get: () => this.ctx.config.audioConfig?.enableScoreFanfare ?? true,
            set: (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.enableScoreFanfare = v;
              this.ctx.state.isScoreFanfareEnabled = v;
              window.config.setItem("audioConfig.enableScoreFanfare", v);
            },
          },
          {
            id: "enable_score_narration",
            label: "Enable Score Narration",
            type: "select",
            options: [
              { value: false, label: "No" },
              { value: true, label: "Yes" },
            ],
            get: () =>
              this.ctx.config.audioConfig?.enableScoreNarration ?? true,
            set: (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.enableScoreNarration = v;
              this.ctx.state.isScoreNarrationEnabled = v;
              window.config.setItem("audioConfig.enableScoreNarration", v);
            },
          },
        ],
      },
      mic: {
        title: "Microphone Settings",
        items: [
          {
            id: "device",
            label: "Scoring Input Device",
            type: "select",
            options: micOptions,
            get: () =>
              this.ctx.config.audioConfig?.mix?.scoring?.inputDevice ||
              "default",
            set: (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.mix ??= {};
              this.ctx.config.audioConfig.mix.scoring ??= {};
              this.ctx.config.audioConfig.mix.scoring.inputDevice = v;
              window.config.setItem("audioConfig.mix.scoring.inputDevice", v);
              this.ctx.services.Forte.setMicDevice(v);
            },
          },
          {
            id: "enable_monitor",
            label: "Enable Real-time Monitoring",
            type: "select",
            options: [
              { value: false, label: "Disabled" },
              { value: true, label: "Enabled" },
            ],
            get: () => this.ctx.config.audioConfig?.enableMicMonitor ?? false,
            set: (v) => {
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.enableMicMonitor = v;
              window.config.setItem("audioConfig.enableMicMonitor", v);
              if (this.ctx.services.Forte.setMicMonitorEnabled)
                this.ctx.services.Forte.setMicMonitorEnabled(v);
            },
          },
          {
            id: "latency",
            label: "Mic Latency Override (ms)",
            type: "range",
            min: 0,
            max: 1000,
            step: 10,
            get: () =>
              Math.round((this.ctx.config.audioConfig?.micLatency ?? 0) * 1000),
            set: (v) => {
              const val = v / 1000;
              this.ctx.config.audioConfig ??= {};
              this.ctx.config.audioConfig.micLatency = val;
              window.config.setItem("audioConfig.micLatency", val);
              this.ctx.services.Forte.setLatency(val);
            },
          },
          {
            id: "manual_calib",
            label: "Manual Calibration (Sing & Sync)",
            type: "action",
            action: () => this.startManualCalibration(),
          },
        ],
      },
      video: {
        title: "Video Settings",
        items: [
          {
            id: "sync",
            label: "Video Sync Offset (ms)",
            type: "range",
            min: -1000,
            max: 1000,
            step: 10,
            get: () => this.ctx.config.videoConfig?.syncOffset ?? 0,
            set: (v) => {
              this.ctx.config.videoConfig ??= {};
              this.ctx.config.videoConfig.syncOffset = v;
              window.config.setItem("videoConfig.syncOffset", v);
            },
          },
          {
            id: "preview",
            label: "Preview & Calibrate Sync",
            type: "action",
            action: () => this.startVideoPreview(),
          },
        ],
      },
    };
  }

  handleKeyDown(e) {
    if (this.setupState.manualCalib && this.setupState.manualCalib.active) {
      e.preventDefault();
      if (this.setupState.manualCalib.phase === "input") {
        if (e.key >= "0" && e.key <= "9") {
          if (this.setupState.manualCalib.songInput.length < 5) {
            this.setupState.manualCalib.songInput += e.key;
            this.renderView();
          }
        } else if (e.key === "Backspace") {
          this.setupState.manualCalib.songInput =
            this.setupState.manualCalib.songInput.slice(0, -1);
          this.renderView();
        } else if (e.key === "Enter") {
          const displayCode = this.setupState.manualCalib.songInput.padStart(
            5,
            "0",
          );
          const song = this.ctx.state.songList.find(
            (s) => s.code === displayCode,
          );
          if (song) this.startCalibrationRecording(song);
        } else if (e.key === "Escape") this.exitManualCalibration();
      } else if (this.setupState.manualCalib.phase === "recording") {
        if (e.key === "Enter") this.stopCalibrationRecording();
        else if (e.key === "Escape") this.exitManualCalibration();
      } else if (this.setupState.manualCalib.phase === "playing") {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const dir = e.key === "ArrowRight" ? 1 : -1;
          this.setupState.manualCalib.offset = Math.max(
            0,
            Math.min(1000, this.setupState.manualCalib.offset + 10 * dir),
          );
          if (this.calibOffsetDisplay)
            this.calibOffsetDisplay.text(
              `${this.setupState.manualCalib.offset} ms`,
            );
          this.updateCalibrationDelay();
        } else if (e.key === "Enter") this.saveManualCalibration();
        else if (e.key === "Escape") this.exitManualCalibration();
      }
      return;
    }

    if (this.setupState.previewingVideo) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const currentOffset = this.ctx.config.videoConfig?.syncOffset || 0;
        const newOffset = Math.max(
          -1000,
          Math.min(1000, currentOffset + 10 * dir),
        );
        this.ctx.config.videoConfig ??= {};
        this.ctx.config.videoConfig.syncOffset = newOffset;
        window.config.setItem("videoConfig.syncOffset", newOffset);
        if (this.offsetDisplay)
          this.offsetDisplay.text(
            `OFFSET: ${newOffset > 0 ? "+" : ""}${newOffset} ms`,
          );
      } else if (e.key === "Enter" || e.key === "Escape") {
        this.stopVideoPreview();
      }
      return;
    }

    if (this.setupState.dialog) {
      if (e.key === "Enter" || e.key === "Escape") {
        this.setupState.dialog = null;
        this.renderView();
      }
      return;
    }

    if (e.key === "Escape") {
      if (
        this.setupState.view === "submenu" ||
        this.setupState.view === "pin_change"
      ) {
        this.ctx.services.Forte.stopSfx();
        this.setupState.view = "dashboard";
        this.renderView();
      } else if (
        this.setupState.view === "dashboard" ||
        this.setupState.view === "auth"
      ) {
        this.exitSetup();
      }
      return;
    }

    if (
      this.setupState.view === "auth" ||
      this.setupState.view === "pin_change"
    ) {
      if (this.setupState.isVerifying) return;
      if (e.key >= "0" && e.key <= "9") {
        if (this.setupState.authInput.length >= 4) return;
        this.setupState.authInput += e.key;
        this.renderView();
        if (this.setupState.authInput.length === 4) {
          this.setupState.isVerifying = true;
          setTimeout(() => this.processAuth(), 200);
        }
      } else if (e.key === "Backspace") {
        this.setupState.authInput = this.setupState.authInput.slice(0, -1);
        this.renderView();
      }
      return;
    }

    if (this.setupState.view === "dashboard") {
      const cols = 2;
      const total = this.DASHBOARD_TILES.length;
      let idx = this.setupState.dashboardIndex;

      if (e.key === "ArrowRight") {
        if (idx % cols < cols - 1 && idx + 1 < total) idx++;
      } else if (e.key === "ArrowLeft") {
        if (idx % cols > 0) idx--;
      } else if (e.key === "ArrowDown") {
        if (idx + cols < total) idx += cols;
        else if (idx < total - 1) idx = total - 1;
      } else if (e.key === "ArrowUp") {
        if (idx - cols >= 0) idx -= cols;
      } else if (e.key === "Enter") {
        const selected = this.DASHBOARD_TILES[this.setupState.dashboardIndex];
        this.executeAction(selected.id);
        return;
      }

      if (idx !== this.setupState.dashboardIndex) {
        this.setupState.dashboardIndex = idx;
        this.renderView();
      }
      return;
    }

    if (this.setupState.view === "submenu") {
      const menu = this.SUBMENUS[this.setupState.activeMenuId];
      const items = menu.items;
      const currentItem = items[this.setupState.submenuIndex];

      const listEl = document.querySelector(".submenu-list");
      if (listEl) this.setupState.submenuScrollTop = listEl.scrollTop;

      if (e.key === "ArrowDown")
        this.setupState.submenuIndex = Math.min(
          items.length - 1,
          this.setupState.submenuIndex + 1,
        );
      else if (e.key === "ArrowUp")
        this.setupState.submenuIndex = Math.max(
          0,
          this.setupState.submenuIndex - 1,
        );
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (currentItem.type === "range") {
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const newVal = Math.max(
            currentItem.min,
            Math.min(
              currentItem.max,
              currentItem.get() + currentItem.step * dir,
            ),
          );
          currentItem.set(newVal);
        } else if (currentItem.type === "select") {
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const currentVal = currentItem.get();
          const currentIndex = currentItem.options.findIndex(
            (o) => o.value === currentVal,
          );
          const nextIndex =
            (currentIndex + dir + currentItem.options.length) %
            currentItem.options.length;
          currentItem.set(currentItem.options[nextIndex].value);
        }
      } else if (
        e.key === "Enter" &&
        (currentItem.type === "action" || currentItem.type === "info-action")
      ) {
        currentItem.action();
      }
      this.renderView();
    }
  }

  parseLrc(text) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    if (!text) return [];
    return text
      .split("\n")
      .map((line) => {
        const match = line.match(regex);
        if (!match) return null;
        const time =
          parseInt(match[1]) * 60 +
          parseInt(match[2]) +
          parseInt(match[3].padEnd(3, "0")) / 1000;
        const txt = line.replace(regex, "").trim();
        return txt ? { time, text: txt } : null;
      })
      .filter(Boolean);
  }

  async triggerLibraryBuild(showOverlay = true) {
    if (showOverlay) {
      this.setupState.buildingLibrary = true;
      this.setupState.buildProgress = { current: 0, total: 0, percentage: 0 };
      this.renderView();
    }
    const success = await this.ctx.services.FsSvc.buildSongList(
      this.ctx.config.libraryPath,
    );
    if (success) {
      this.ctx.state.songList = this.ctx.services.FsSvc.getSongList();
    }
    if (showOverlay) {
      this.setupState.buildingLibrary = false;
      this.renderView();
      if (!success) this.showToast("FAILED TO BUILD SONG LIST", "error");
    }
  }

  renderBuildOverlay(container) {
    const overlay = new Html("div")
      .classOn("setup-manual-calib-overlay")
      .appendTo(container);
    new Html("h2").text("BUILDING SONG LIST").appendTo(overlay);
    new Html("p")
      .text("Scanning library files and extracting metadata...")
      .appendTo(overlay);
    const progressContainer = new Html("div")
      .styleJs({ width: "80%", maxWidth: "600px", marginTop: "2rem" })
      .appendTo(overlay);
    const barBg = new Html("div")
      .classOn("setup-slider-bar")
      .styleJs({ height: "20px" })
      .appendTo(progressContainer);
    this.buildProgressBar = new Html("div")
      .classOn("setup-slider-fill")
      .styleJs({ width: `${this.setupState.buildProgress.percentage}%` })
      .appendTo(barBg);
    this.buildProgressText = new Html("p")
      .styleJs({
        marginTop: "1rem",
        color: "#89cff0",
        fontSize: "1.2rem",
        fontWeight: "bold",
      })
      .text(
        `Processing: ${this.setupState.buildProgress.current} / ${this.setupState.buildProgress.total}`,
      )
      .appendTo(progressContainer);
  }

  async startNetworkSync() {
    if (
      this.setupState.selectedServerId === "none" ||
      !this.updateServers ||
      this.updateServers.length === 0
    ) {
      this.showToast("NO VALID SERVERS FOUND", "error");
      return;
    }
    if (!this.ctx.config.libraryPath) {
      this.showToast("PLEASE SET LIBRARY PATH FIRST", "error");
      return;
    }

    const server = this.updateServers.find(
      (s) => s.id === this.setupState.selectedServerId,
    );
    if (!server) return;

    this.setupState.syncing = true;
    this.setupState.syncProgress = {
      current: 0,
      total: 0,
      filename: "Connecting to Server...",
    };

    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return "0.00 MB";
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    };

    this.boundSyncProgress = (...args) => {
      const data = args.length === 2 ? args[1] : args[0];
      this.setupState.syncProgress = data;

      const pctOverall = data.total > 0 ? (data.current / data.total) * 100 : 0;
      let pctFile = 0;

      if (data.fileTotalBytes > 0)
        pctFile = (data.fileLoadedBytes / data.fileTotalBytes) * 100;
      else if (data.status === "validating") pctFile = 100;

      if (this.syncOverallText)
        this.syncOverallText.text(`File ${data.current} of ${data.total}`);
      if (this.syncProgressBarOverall)
        this.syncProgressBarOverall.styleJs({ width: `${pctOverall}%` });
      if (this.syncProgressText) {
        this.syncProgressText.text(data.filename);
        if (data.status === "validating") {
          this.syncProgressText.styleJs({ color: "#ffd700" });
          this.syncFileBytesText.text("");
          this.syncProgressBarFile.styleJs({
            width: "100%",
            backgroundColor: "#ffd700",
            opacity: "0.4",
          });
        } else {
          this.syncProgressText.styleJs({ color: "#89cff0" });
          this.syncProgressBarFile.styleJs({
            width: `${pctFile}%`,
            backgroundColor: "#89cff0",
            opacity: "1",
          });
          if (data.fileTotalBytes > 0)
            this.syncFileBytesText.text(
              `${formatBytes(data.fileLoadedBytes)} / ${formatBytes(data.fileTotalBytes)}`,
            );
          else
            this.syncFileBytesText.text(`${formatBytes(data.fileLoadedBytes)}`);
        }
      }
    };

    const ipc = window.desktopIntegration.ipc;
    if (ipc.on) ipc.on("sync-progress", this.boundSyncProgress);

    this.renderView();

    try {
      const res = await ipc.invoke("sync-library", {
        serverIp: server.ip,
        serverPort: server.port,
        libraryPath: this.ctx.config.libraryPath,
      });
      this.setupState.syncing = false;
      if (res.success) {
        this.showToast("NETWORK SYNC COMPLETE", "success");
        await this.triggerLibraryBuild(true);
      } else {
        this.showToast("SYNC FAILED: " + res.error, "error");
        this.renderView();
      }
    } catch (error) {
      this.setupState.syncing = false;
      this.showToast("SYNC CRASHED: " + error.message, "error");
    } finally {
      if (ipc.off) ipc.off("sync-progress", this.boundSyncProgress);
      else if (ipc.removeListener)
        ipc.removeListener("sync-progress", this.boundSyncProgress);
      this.renderView();
    }
  }

  renderSyncOverlay(container) {
    const overlay = new Html("div")
      .classOn("setup-manual-calib-overlay")
      .appendTo(container);
    new Html("h2").text("NETWORK LIBRARY SYNC").appendTo(overlay);
    new Html("p")
      .text("Checking for differences and downloading missing files...")
      .appendTo(overlay);
    const progressContainer = new Html("div")
      .styleJs({
        width: "90%",
        maxWidth: "700px",
        marginTop: "2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      })
      .appendTo(overlay);

    const overallWrap = new Html("div").appendTo(progressContainer);
    const overallLabel = new Html("div")
      .styleJs({
        display: "flex",
        justifyContent: "space-between",
        color: "#ffd700",
        fontWeight: "bold",
        fontSize: "1.2rem",
        marginBottom: "0.5rem",
      })
      .appendTo(overallWrap);
    new Html("span").text("OVERALL PROGRESS").appendTo(overallLabel);
    this.syncOverallText = new Html("span")
      .text("0 / 0")
      .appendTo(overallLabel);
    const barBgOverall = new Html("div")
      .classOn("setup-slider-bar")
      .styleJs({ height: "15px", background: "rgba(0,0,0,0.6)" })
      .appendTo(overallWrap);
    this.syncProgressBarOverall = new Html("div")
      .classOn("setup-slider-fill")
      .styleJs({ width: "0%", backgroundColor: "#ffd700" })
      .appendTo(barBgOverall);

    const fileWrap = new Html("div").appendTo(progressContainer);
    const fileLabel = new Html("div")
      .styleJs({
        display: "flex",
        justifyContent: "space-between",
        color: "#89cff0",
        fontWeight: "bold",
        fontSize: "1.1rem",
        marginBottom: "0.5rem",
      })
      .appendTo(fileWrap);
    this.syncProgressText = new Html("span")
      .styleJs({
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "70%",
      })
      .text("Connecting...")
      .appendTo(fileLabel);
    this.syncFileBytesText = new Html("span")
      .text("0.00 MB / 0.00 MB")
      .appendTo(fileLabel);
    const barBgFile = new Html("div")
      .classOn("setup-slider-bar")
      .styleJs({ height: "15px", background: "rgba(0,0,0,0.6)" })
      .appendTo(fileWrap);
    this.syncProgressBarFile = new Html("div")
      .classOn("setup-slider-fill")
      .styleJs({ width: "0%", backgroundColor: "#89cff0" })
      .appendTo(barBgFile);
  }

  startManualCalibration() {
    this.setupState.manualCalib = {
      active: true,
      phase: "input",
      songInput: "",
      offset: Math.round((this.ctx.config.audioConfig?.micLatency ?? 0) * 1000),
      audioContext: new (window.AudioContext || window.webkitAudioContext)(),
      micRecorder: null,
      musicRecorder: null,
      micChunks: [],
      musicChunks: [],
      micBuffer: null,
      trackBuffer: null,
      micSource: null,
      trackSource: null,
      trackDelayNode: null,
      calibrationLyrics: [],
    };
    this.renderView();
  }

  async startCalibrationRecording(song) {
    this.setupState.manualCalib.phase = "recording";
    this.renderView();
    this.ctx.services.Forte.setLatency(0);

    const fileUrl = new URL(
      `http://127.0.0.1:${this.ctx.state.actualPort}/getFile`,
    );
    fileUrl.searchParams.append("path", song.path);
    await this.ctx.services.Forte.loadTrack(fileUrl.href);
    this.ctx.services.Forte.togglePianoRollVisibility(false);

    const pbState = this.ctx.services.Forte.getPlaybackState();
    this.setupState.manualCalib.isMidi = pbState.isMidi;
    this.setupState.manualCalib.calibrationLyrics = [];

    if (pbState.isMidi) {
      const midiInfo = pbState.midiInfo;
      let ppqm = midiInfo.timeDivision || 480;

      const getSecondsForTick = (targetTick, tempoChanges, ppqm) => {
        if (targetTick <= 0) return 0;
        let time = 0,
          currentTick = 0,
          currentBpm = 120;
        if (tempoChanges && tempoChanges.length > 0) {
          let chronologicalChanges = tempoChanges
            .map((tc, index) => {
              let tick = tc.ticks !== undefined ? tc.ticks : tc.tick;
              let val = tc.tempo || tc.bpm || 120;
              let bpm = val > 1000 ? Math.round(60000000 / val) : val;
              if (bpm <= 0) bpm = 120;
              return { tick, bpm, _originalIndex: index };
            })
            .sort((a, b) => {
              if (a.tick !== b.tick) return a.tick - b.tick;
              return b._originalIndex - a._originalIndex;
            });
          for (let tc of chronologicalChanges) {
            if (tc.tick >= targetTick) break;
            if (tc.tick > currentTick) {
              time += ((tc.tick - currentTick) / ppqm) * (60 / currentBpm);
              currentTick = tc.tick;
            }
            currentBpm = tc.bpm;
          }
        }
        let remainingTicks = targetTick - currentTick;
        if (remainingTicks > 0)
          time += (remainingTicks / ppqm) * (60 / currentBpm);
        return time;
      };

      let lyricsToParse = [...pbState.decodedLyrics];
      while (
        lyricsToParse.length > 0 &&
        (lyricsToParse[0].trim().startsWith("{@") ||
          lyricsToParse[0].trim().startsWith("{#"))
      ) {
        lyricsToParse.shift();
      }

      let offsetIndex = pbState.decodedLyrics.length - lyricsToParse.length;
      let currentLineText = "",
        lineStartTime = null;

      for (let i = 0; i < lyricsToParse.length; i++) {
        const syllable = lyricsToParse[i];
        const clean = syllable.replace(/[\r\n\/\\]/g, "");
        const startsWithNewLine = /^[\r\n\/\\\\]/.test(syllable);
        const endsWithNewLine = /[\r\n\/\\\\]$/.test(syllable);
        const tick = midiInfo.ticks[i + offsetIndex];
        const time = getSecondsForTick(tick, midiInfo.tempoChanges, ppqm);

        if (startsWithNewLine && currentLineText.trim() !== "") {
          this.setupState.manualCalib.calibrationLyrics.push({
            time: lineStartTime,
            text: currentLineText.trim(),
          });
          currentLineText = "";
          lineStartTime = null;
        }

        if (clean) {
          if (lineStartTime === null) lineStartTime = time;
          currentLineText += clean.replace(/\[.*?\]/g, "");
        }

        if (endsWithNewLine && currentLineText.trim() !== "") {
          this.setupState.manualCalib.calibrationLyrics.push({
            time: lineStartTime,
            text: currentLineText.trim(),
          });
          currentLineText = "";
          lineStartTime = null;
        }
      }
      if (currentLineText.trim() !== "")
        this.setupState.manualCalib.calibrationLyrics.push({
          time: lineStartTime,
          text: currentLineText.trim(),
        });
    } else if (song.lrcPath) {
      const lrcText = await this.ctx.services.FsSvc.readFile(song.lrcPath);
      this.setupState.manualCalib.calibrationLyrics = this.parseLrc(lrcText);
    }

    let currentLineIdx = -1;
    this.boundCalibTimeUpdate = (e) => {
      const currentTime = e.detail.currentTime;
      if (this.setupState.manualCalib.calibrationLyrics.length > 0) {
        let activeIdx = -1;
        for (
          let i = this.setupState.manualCalib.calibrationLyrics.length - 1;
          i >= 0;
          i--
        ) {
          if (
            currentTime >= this.setupState.manualCalib.calibrationLyrics[i].time
          ) {
            activeIdx = i;
            break;
          }
        }
        if (activeIdx !== currentLineIdx) {
          currentLineIdx = activeIdx;
          const activeLine =
            activeIdx >= 0
              ? this.setupState.manualCalib.calibrationLyrics[activeIdx].text
              : "Start singing!";
          const nextLine =
            activeIdx >= 0 &&
            activeIdx + 1 < this.setupState.manualCalib.calibrationLyrics.length
              ? this.setupState.manualCalib.calibrationLyrics[activeIdx + 1]
                  .text
              : "";
          if (this.calibLyricLine1) this.calibLyricLine1.text(activeLine);
          if (this.calibLyricLine2) this.calibLyricLine2.text(nextLine);
        }
      }
    };

    document.addEventListener(
      "CherryTree.Forte.Playback.TimeUpdate",
      this.boundCalibTimeUpdate,
    );

    if (this.calibLyricLine1) this.calibLyricLine1.text("Start singing!");
    if (this.calibLyricLine2) {
      if (this.setupState.manualCalib.calibrationLyrics.length > 0)
        this.calibLyricLine2.text(
          this.setupState.manualCalib.calibrationLyrics[0].text,
        );
    }

    const micStream = this.ctx.services.Forte.getMicAudioStream();
    const musicStream = this.ctx.services.Forte.getMusicAudioStream();
    this.setupState.manualCalib.micChunks = [];
    this.setupState.manualCalib.musicChunks = [];
    this.setupState.manualCalib.micRecorder = new MediaRecorder(micStream);
    this.setupState.manualCalib.musicRecorder = new MediaRecorder(musicStream);
    this.setupState.manualCalib.micRecorder.ondataavailable = (e) => {
      if (e.data.size) this.setupState.manualCalib.micChunks.push(e.data);
    };
    this.setupState.manualCalib.musicRecorder.ondataavailable = (e) => {
      if (e.data.size) this.setupState.manualCalib.musicChunks.push(e.data);
    };

    this.setupState.manualCalib.musicRecorder.start();
    this.setupState.manualCalib.micRecorder.start();
    this.ctx.services.Forte.playTrack();
  }

  stopCalibrationRecording() {
    this.setupState.manualCalib.phase = "processing";
    this.renderView();
    this.ctx.services.Forte.stopTrack();
    if (this.boundCalibTimeUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundCalibTimeUpdate,
      );

    const p1 = new Promise((resolve) => {
      this.setupState.manualCalib.micRecorder.onstop = async () =>
        resolve(
          await new Blob(this.setupState.manualCalib.micChunks, {
            type: "audio/webm",
          }).arrayBuffer(),
        );
      this.setupState.manualCalib.micRecorder.stop();
    });

    const p2 = new Promise((resolve) => {
      this.setupState.manualCalib.musicRecorder.onstop = async () =>
        resolve(
          await new Blob(this.setupState.manualCalib.musicChunks, {
            type: "audio/webm",
          }).arrayBuffer(),
        );
      this.setupState.manualCalib.musicRecorder.stop();
    });

    Promise.all([p1, p2])
      .then(async ([micArray, musicArray]) => {
        const ctx = this.setupState.manualCalib.audioContext;
        this.setupState.manualCalib.micBuffer =
          await ctx.decodeAudioData(micArray);
        this.setupState.manualCalib.trackBuffer =
          await ctx.decodeAudioData(musicArray);
        this.startCalibrationPlayback();
      })
      .catch((e) => {
        this.showToast("FAILED TO PROCESS RECORDING", "error");
        this.exitManualCalibration();
      });
  }

  startCalibrationPlayback() {
    this.setupState.manualCalib.phase = "playing";
    this.renderView();

    const ctx = this.setupState.manualCalib.audioContext;
    if (ctx.state === "suspended") ctx.resume();
    this.stopCalibrationNodes();

    this.setupState.manualCalib.trackSource = ctx.createBufferSource();
    this.setupState.manualCalib.trackSource.buffer =
      this.setupState.manualCalib.trackBuffer;
    this.setupState.manualCalib.trackSource.loop = true;

    this.setupState.manualCalib.micSource = ctx.createBufferSource();
    this.setupState.manualCalib.micSource.buffer =
      this.setupState.manualCalib.micBuffer;
    this.setupState.manualCalib.micSource.loop = true;

    this.setupState.manualCalib.trackDelayNode = ctx.createDelay(2.0);
    this.updateCalibrationDelay();

    this.setupState.manualCalib.trackSource
      .connect(this.setupState.manualCalib.trackDelayNode)
      .connect(ctx.destination);
    this.setupState.manualCalib.micSource.connect(ctx.destination);

    this.setupState.manualCalib.trackSource.start(0);
    this.setupState.manualCalib.micSource.start(0);

    this.renderWaveforms();
  }

  updateCalibrationDelay() {
    if (!this.setupState.manualCalib.trackDelayNode) return;
    const offsetSeconds = Math.max(
      0,
      this.setupState.manualCalib.offset / 1000,
    );
    this.setupState.manualCalib.trackDelayNode.delayTime.value = offsetSeconds;
    this.renderWaveforms();
  }

  stopCalibrationNodes() {
    if (this.setupState.manualCalib.trackSource) {
      try {
        this.setupState.manualCalib.trackSource.stop();
        this.setupState.manualCalib.trackSource.disconnect();
      } catch (e) {}
    }
    if (this.setupState.manualCalib.micSource) {
      try {
        this.setupState.manualCalib.micSource.stop();
        this.setupState.manualCalib.micSource.disconnect();
      } catch (e) {}
    }
    if (this.setupState.manualCalib.trackDelayNode) {
      try {
        this.setupState.manualCalib.trackDelayNode.disconnect();
      } catch (e) {}
    }
  }

  renderWaveforms() {
    if (!this.calibCanvas) return;
    const canvas = this.calibCanvas.elm;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const trackBuffer = this.setupState.manualCalib.trackBuffer;
    const micBuffer = this.setupState.manualCalib.micBuffer;
    if (!trackBuffer || !micBuffer) return;

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();

    const totalVisibleSeconds = Math.min(trackBuffer.duration, 6);

    const drawBuffer = (
      buffer,
      color,
      yOffset,
      heightScale,
      timeOffsetMs = 0,
    ) => {
      const data = buffer.getChannelData(0);
      const sampleRate = buffer.sampleRate;
      const offsetSeconds = timeOffsetMs / 1000;

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;

      for (let x = 0; x < width; x++) {
        const timeAtPixel = (x / width) * totalVisibleSeconds;
        const bufferTime = timeAtPixel - offsetSeconds;
        const sampleIndex = Math.floor(bufferTime * sampleRate);

        let min = 1.0,
          max = -1.0;
        if (sampleIndex >= 0 && sampleIndex < data.length) {
          const samplesPerPixel = Math.floor(
            (totalVisibleSeconds / width) * sampleRate,
          );
          for (let j = 0; j < samplesPerPixel; j++) {
            const val = data[sampleIndex + j];
            if (val < min) min = val;
            if (val > max) max = val;
          }
        } else {
          min = 0;
          max = 0;
        }

        const yMin = yOffset + (1 - min * 1.5) * heightScale;
        const yMax = yOffset + (1 - max * 1.5) * heightScale;
        if (x === 0) ctx.moveTo(x, yMin);
        else {
          ctx.lineTo(x, yMin);
          ctx.lineTo(x, yMax);
        }
      }
      ctx.stroke();
    };

    drawBuffer(
      trackBuffer,
      "#89cff0",
      0,
      height / 4,
      this.setupState.manualCalib.offset,
    );
    drawBuffer(micBuffer, "#ffd700", height / 2, height / 4, 0);
  }

  exitManualCalibration() {
    if (this.setupState.manualCalib) {
      this.stopCalibrationNodes();
      if (this.setupState.manualCalib.audioContext)
        this.setupState.manualCalib.audioContext.close();
      if (this.boundCalibTimeUpdate)
        document.removeEventListener(
          "CherryTree.Forte.Playback.TimeUpdate",
          this.boundCalibTimeUpdate,
        );
      this.ctx.services.Forte.stopTrack();
      const currentConfigLatency = this.ctx.config.audioConfig?.micLatency ?? 0;
      this.ctx.services.Forte.setLatency(currentConfigLatency);
      this.setupState.manualCalib.active = false;
    }
    this.renderView();
  }

  saveManualCalibration() {
    const val = this.setupState.manualCalib.offset / 1000;
    this.ctx.config.audioConfig ??= {};
    this.ctx.config.audioConfig.micLatency = val;
    window.config.setItem("audioConfig.micLatency", val);
    this.ctx.services.Forte.setLatency(val);
    this.showToast("CALIBRATION SAVED", "success");
    this.setupState.manualCalib.active = false;
    this.exitManualCalibration();
  }

  async processAuth() {
    if (this.setupState.view === "auth") {
      const isValid = await this.verifyPin(this.setupState.authInput);
      if (isValid) this.setupState.view = "dashboard";
      else this.showToast("INCORRECT PIN", "error");
      this.setupState.authInput = "";
    } else if (this.setupState.view === "pin_change") {
      if (this.setupState.pinChangeStep === 0) {
        const isValid = await this.verifyPin(this.setupState.authInput);
        if (isValid) this.setupState.pinChangeStep = 1;
        else {
          this.setupState.pinChangeStep = 0;
          this.setupState.view = "dashboard";
          this.showToast("AUTHORIZATION FAILED", "error");
        }
        this.setupState.authInput = "";
      } else if (this.setupState.pinChangeStep === 1) {
        this.setupState.newPinTemp = this.setupState.authInput;
        this.setupState.pinChangeStep = 2;
        this.setupState.authInput = "";
      } else if (this.setupState.pinChangeStep === 2) {
        if (this.setupState.authInput === this.setupState.newPinTemp) {
          const newPinData = await this.createPinHash(
            this.setupState.authInput,
          );
          if (newPinData) {
            this.ctx.config.security ??= {};
            this.ctx.config.security.pinData = newPinData;
            window.config.setItem("security.pinData", newPinData);
            this.showToast("PIN UPDATED", "success");
          } else this.showToast("HASHING FAILED", "error");
        } else this.showToast("PIN MISMATCH", "error");
        this.setupState.view = "dashboard";
        this.setupState.authInput = "";
      }
    }
    this.setupState.isVerifying = false;
    this.renderView();
  }

  async executeAction(id) {
    if (id === "exit") {
      this.exitSetup();
    } else if (id === "security") {
      this.setupState.view = "pin_change";
      this.setupState.pinChangeStep = 0;
      this.setupState.authInput = "";
      this.renderView();
    } else if (this.SUBMENUS[id]) {
      if (id === "sync") {
        this.updateServers =
          await window.desktopIntegration.ipc.invoke("get-update-servers");
        this.buildSettingsMap();
      }
      this.setupState.activeMenuId = id;
      this.setupState.submenuIndex = 0;
      this.setupState.view = "submenu";
      this.renderView();
    }
  }

  async handleLibraryScan() {
    this.showToast("SCANNING DRIVES...", "info");
    const foundLibs = await this.ctx.services.FsSvc.findEncoreLibraries();
    if (foundLibs.length === 0) {
      this.showToast("NO LIBRARIES FOUND", "error");
      return;
    }
    const newLib = foundLibs[0];
    this.ctx.config.libraryPath = newLib.path;
    this.currentManifest = newLib.manifest;
    window.config.setItem("libraryPath", newLib.path);
    this.showToast(`LIBRARY SET TO: ${newLib.manifest.title}`, "success");
    this.buildSettingsMap();
    await this.triggerLibraryBuild(true);
  }

  async startVideoPreview() {
    if (!this.ctx.state.songList || this.ctx.state.songList.length === 0) {
      this.showToast("LIBRARY IS STILL LOADING... PLEASE WAIT", "error");
      return;
    }
    const mtvSong = this.ctx.state.songList.find((s) => s.videoPath);
    if (!mtvSong) {
      this.showToast("NO MTV SONGS FOUND IN LIBRARY", "error");
      return;
    }

    this.setupState.previewingVideo = true;
    this.renderView();

    const audioUrl = new URL(
      `http://127.0.0.1:${this.ctx.state.actualPort}/getFile`,
    );
    audioUrl.searchParams.append("path", mtvSong.path);
    this.showToast("LOADING TRACK...", "info");
    await this.ctx.services.Forte.loadTrack(audioUrl.href);

    const videoUrl = new URL(
      `http://127.0.0.1:${this.ctx.state.actualPort}/getFile`,
    );
    videoUrl.searchParams.append("path", mtvSong.videoPath);

    this.previewVideoEl.attr({ src: videoUrl.href });
    this.previewVideoEl.elm.play().catch((e) => console.error(e));

    this.ctx.services.Forte.playTrack();
    this.previewSyncFrame = requestAnimationFrame(() => this.syncVideoLoop());
  }

  syncVideoLoop() {
    if (!this.setupState.previewingVideo) return;
    const pbState = this.ctx.services.Forte.getPlaybackState();
    if (
      pbState.status === "playing" &&
      this.previewVideoEl &&
      this.previewVideoEl.elm.readyState >= 2
    ) {
      const vid = this.previewVideoEl.elm;
      const offsetSec = (this.ctx.config.videoConfig?.syncOffset || 0) / 1000;
      const target = pbState.currentTime + offsetSec;
      const drift = (target - vid.currentTime) * 1000;

      if (Math.abs(drift) > 500) {
        vid.currentTime = target;
        vid.playbackRate = 1;
      } else if (Math.abs(drift) > 50) {
        vid.playbackRate = drift > 0 ? 1.05 : 0.95;
      } else {
        vid.playbackRate = 1;
      }
    }
    this.previewSyncFrame = requestAnimationFrame(() => this.syncVideoLoop());
  }

  stopVideoPreview() {
    this.setupState.previewingVideo = false;
    if (this.previewSyncFrame) cancelAnimationFrame(this.previewSyncFrame);
    this.ctx.services.Forte.stopTrack();
    if (this.previewVideoEl) {
      this.previewVideoEl.elm.pause();
      this.previewVideoEl.attr({ src: "" });
    }
    this.renderView();
  }

  showToast(msg, type) {
    const toast = new Html("div")
      .classOn("setup-toast", type)
      .text(msg)
      .appendTo(this.ctx.dom.setupScreen);
    setTimeout(() => toast.classOn("visible"), 50);
    setTimeout(() => {
      toast.classOff("visible");
      setTimeout(() => toast.cleanup(), 300);
    }, 3000);
  }

  renderView() {
    if (!this.ctx.dom.setupContainer) return;
    this.ctx.dom.setupContainer.clear();

    if (this.setupState.manualCalib?.active) {
      this.renderManualCalibrationOverlay(this.ctx.dom.setupContainer);
      return;
    }
    if (this.setupState.previewingVideo) {
      this.renderVideoPreviewOverlay(this.ctx.dom.setupContainer);
      return;
    }
    if (this.setupState.syncing) {
      this.renderSyncOverlay(this.ctx.dom.setupContainer);
      return;
    }
    if (this.setupState.buildingLibrary) {
      this.renderBuildOverlay(this.ctx.dom.setupContainer);
      return;
    }

    const header = new Html("div")
      .classOn("setup-header")
      .appendTo(this.ctx.dom.setupContainer);
    new Html("h1").text("ENCORE SYSTEM CONFIGURATION").appendTo(header);

    const body = new Html("div")
      .classOn("setup-body")
      .appendTo(this.ctx.dom.setupContainer);

    if (
      this.setupState.view === "auth" ||
      this.setupState.view === "pin_change"
    )
      this.renderAuthScreen(body);
    else if (this.setupState.view === "dashboard") this.renderDashboard(body);
    else if (this.setupState.view === "submenu") {
      body.classOn("is-submenu");
      this.renderSubmenu(body);
    }

    const footer = new Html("div")
      .classOn("setup-footer")
      .appendTo(this.ctx.dom.setupContainer);
    let hint = "ARROWS: Navigate | ENTER: Select";
    if (
      this.setupState.view === "submenu" ||
      this.setupState.view === "pin_change"
    )
      hint += " | ESC: Back";
    if (this.setupState.view === "auth")
      hint = "Enter 4-digit PIN using number keys | ESC: Exit Setup";
    new Html("p").text(hint).appendTo(footer);

    if (this.setupState.dialog) this.renderDialog(this.ctx.dom.setupContainer);
  }

  renderManualCalibrationOverlay(container) {
    const overlay = new Html("div")
      .classOn("setup-manual-calib-overlay")
      .appendTo(container);
    new Html("h2").text("MANUAL SYNC CALIBRATION").appendTo(overlay);

    if (this.setupState.manualCalib.phase === "input") {
      new Html("p")
        .text(
          "Enter a 5-digit song number from your library to use for testing.",
        )
        .appendTo(overlay);
      new Html("br").appendTo(overlay);

      const displayCode = this.setupState.manualCalib.songInput.padStart(
        5,
        "0",
      );
      new Html("div")
        .classOn("calib-value-display")
        .text(displayCode)
        .appendTo(overlay);

      const song = this.ctx.state.songList.find((s) => s.code === displayCode);
      if (song)
        new Html("p")
          .styleJs({ color: "#89cff0", fontWeight: "bold", fontSize: "1.5rem" })
          .text(`${song.title} - ${song.artist}`)
          .appendTo(overlay);
      else if (this.setupState.manualCalib.songInput.length > 0)
        new Html("p")
          .styleJs({ color: "#ff5555", fontWeight: "bold", fontSize: "1.5rem" })
          .text("Song not found in library.")
          .appendTo(overlay);

      new Html("p")
        .styleJs({ marginTop: "2rem", opacity: "0.6" })
        .text("Use Number Keys to type | ENTER to Start | ESC to Cancel")
        .appendTo(overlay);
    } else if (this.setupState.manualCalib.phase === "recording") {
      new Html("div")
        .classOn("calib-status-badge")
        .text("RECORDING... SING ALONG!")
        .appendTo(overlay);
      const lrcCont = new Html("div")
        .classOn("calib-lyrics-container")
        .appendTo(overlay);
      this.calibLyricLine1 = new Html("div")
        .classOn("calib-lyric-line", "active")
        .text("Loading track...")
        .appendTo(lrcCont);
      this.calibLyricLine2 = new Html("div")
        .classOn("calib-lyric-line", "next")
        .text("")
        .appendTo(lrcCont);
      new Html("p")
        .styleJs({ marginTop: "1rem" })
        .text("Press ENTER when you are finished singing to begin adjusting.")
        .appendTo(overlay);
    } else if (this.setupState.manualCalib.phase === "processing") {
      new Html("h2").text("PROCESSING AUDIO...").appendTo(overlay);
    } else if (this.setupState.manualCalib.phase === "playing") {
      new Html("p")
        .text(
          "Use the Left or Right arrows until your voice lines up with the music.",
        )
        .appendTo(overlay);
      new Html("br").appendTo(overlay);

      const controls = new Html("div")
        .classOn("calib-controls")
        .appendTo(overlay);
      const layout = new Html("div")
        .classOn("calib-waveform-layout")
        .appendTo(controls);
      const labels = new Html("div")
        .classOn("calib-waveform-labels-side")
        .appendTo(layout);
      new Html("span")
        .classOn("calib-label-music")
        .text("MUSIC")
        .appendTo(labels);
      new Html("span").classOn("calib-label-mic").text("MIC").appendTo(labels);

      this.calibCanvas = new Html("canvas")
        .classOn("calib-waveform-canvas")
        .attr({ width: 800, height: 200 })
        .appendTo(layout);
      const sliderBox = new Html("div")
        .classOn("calib-slider-container")
        .appendTo(controls);
      const offset = this.setupState.manualCalib.offset;
      this.calibOffsetDisplay = new Html("div")
        .classOn("calib-value-display")
        .text(`${offset > 0 ? "+" : ""}${offset} ms`)
        .appendTo(sliderBox);
      const btns = new Html("div").classOn("calib-buttons").appendTo(controls);
      new Html("button")
        .classOn("box", "positive")
        .text("Save & Exit (ENTER)")
        .on("click", () => this.saveManualCalibration())
        .appendTo(btns);
      new Html("button")
        .classOn("box", "negative")
        .text("Discard (ESC)")
        .on("click", () => this.exitManualCalibration())
        .appendTo(btns);
    }
  }

  renderVideoPreviewOverlay(container) {
    const overlay = new Html("div")
      .classOn("setup-video-preview-overlay")
      .appendTo(container);
    this.previewVideoEl = new Html("video")
      .attr({ muted: true })
      .classOn("setup-preview-video")
      .appendTo(overlay);
    const hud = new Html("div").classOn("setup-preview-hud").appendTo(overlay);
    new Html("h2").text("VIDEO SYNC CALIBRATION").appendTo(hud);
    const currentOffset = this.ctx.config.videoConfig?.syncOffset || 0;
    this.offsetDisplay = new Html("div")
      .classOn("setup-preview-offset")
      .text(`OFFSET: ${currentOffset > 0 ? "+" : ""}${currentOffset} ms`)
      .appendTo(hud);
    new Html("p").text("◀ / ▶ to adjust | ENTER / ESC to save").appendTo(hud);
  }

  renderDialog(container) {
    const overlay = new Html("div")
      .classOn("setup-dialog-overlay")
      .appendTo(container);
    const box = new Html("div").classOn("setup-dialog-box").appendTo(overlay);
    new Html("h2").text(this.setupState.dialog.title).appendTo(box);
    new Html("div")
      .classOn("setup-dialog-content")
      .text(this.setupState.dialog.content)
      .appendTo(box);
    new Html("p")
      .classOn("setup-dialog-hint")
      .text("Press ENTER or ESC to close")
      .appendTo(box);
  }

  renderAuthScreen(container) {
    const authBox = new Html("div").classOn("auth-box").appendTo(container);
    let title = "SYSTEM AUTHENTICATION",
      sub = "ENTER CURRENT PIN CODE";

    if (this.setupState.view === "pin_change") {
      if (this.setupState.pinChangeStep === 1) {
        title = "CHANGE PIN";
        sub = "ENTER NEW 4-DIGIT PIN";
      }
      if (this.setupState.pinChangeStep === 2) {
        title = "CHANGE PIN";
        sub = "CONFIRM NEW PIN";
      }
    }

    new Html("h2").text(title).appendTo(authBox);
    new Html("p").text(sub).appendTo(authBox);
    const dotsWrapper = new Html("div").classOn("auth-dots").appendTo(authBox);
    for (let i = 0; i < 4; i++) {
      const dot = new Html("div").classOn("auth-dot").appendTo(dotsWrapper);
      if (i < this.setupState.authInput.length) dot.classOn("filled");
    }
  }

  renderDashboard(container) {
    const scrollWrapper = new Html("div")
      .classOn("dashboard-scroll-wrapper", "submenu-list")
      .styleJs({
        width: "100%",
        maxHeight: "100%",
        overflowY: "auto",
        paddingTop: "0.5rem",
      })
      .appendTo(container);
    const grid = new Html("div")
      .classOn("setup-grid")
      .styleJs({
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1rem",
        width: "90%",
        maxWidth: "1000px",
        margin: "0 auto",
        padding: "2rem 0",
      })
      .appendTo(scrollWrapper);

    this.DASHBOARD_TILES.forEach((tile, idx) => {
      const tileEl = new Html("div")
        .classOn("setup-tile")
        .styleJs({
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "1.5rem 2rem",
          textAlign: "left",
        })
        .appendTo(grid);
      if (idx === this.setupState.dashboardIndex) tileEl.classOn("active");

      new Html("div")
        .classOn("setup-tile-icon")
        .styleJs({
          fontSize: "2rem",
          marginRight: "1.5rem",
          width: "40px",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        })
        .html(`<ion-icon name="${tile.icon}"></ion-icon>`)
        .appendTo(tileEl);

      new Html("div")
        .classOn("setup-tile-label")
        .styleJs({ fontSize: "1.5rem", fontWeight: "600", flex: "1" })
        .text(tile.label)
        .appendTo(tileEl);
    });

    requestAnimationFrame(() => {
      if (scrollWrapper.elm) {
        const activeTile = document.querySelector(".setup-tile.active");
        if (activeTile) {
          if (this.setupState.dashboardIndex < 2)
            scrollWrapper.elm.scrollTop = 0;
          else
            activeTile.scrollIntoView({ block: "nearest", behavior: "auto" });
        }
      }
    });
  }

  renderSubmenu(container) {
    const menuData = this.SUBMENUS[this.setupState.activeMenuId];
    const panel = new Html("div").classOn("submenu-panel").appendTo(container);
    new Html("h2")
      .classOn("submenu-title")
      .text(menuData.title)
      .appendTo(panel);
    const list = new Html("div").classOn("submenu-list").appendTo(panel);

    menuData.items.forEach((item, idx) => {
      const row = new Html("div").classOn("submenu-item").appendTo(list);
      if (idx === this.setupState.submenuIndex) row.classOn("active");
      new Html("div").classOn("submenu-label").text(item.label).appendTo(row);
      const valWrap = new Html("div").classOn("submenu-value").appendTo(row);

      if (item.type === "info")
        valWrap.html(`<span class="info-text">${item.get()}</span>`);
      else if (item.type === "info-action")
        valWrap.html(
          `<span class="info-text">${item.get()}</span> <span style="opacity: 0.5; font-size: 0.8em; margin-left: 10px;">↵</span>`,
        );
      else if (item.type === "action") valWrap.text("Press Enter to execute");
      else if (item.type === "range") {
        const val = item.get();
        const p = ((val - item.min) / (item.max - item.min)) * 100;
        valWrap.html(
          `<div class="setup-slider-bar"><div class="setup-slider-fill" style="width: ${p}%"></div></div><span>${val}</span>`,
        );
      } else if (item.type === "select") {
        const val = item.get();
        const opt = item.options.find((o) => o.value === val);
        valWrap.html(
          `<span>◀</span> <span class="select-text">${opt ? opt.label : val}</span> <span>▶</span>`,
        );
      }
    });

    requestAnimationFrame(() => {
      if (list.elm) {
        list.elm.scrollTop = this.setupState.submenuScrollTop || 0;
        const activeItem = list.elm.children[this.setupState.submenuIndex];
        if (activeItem)
          activeItem.scrollIntoView({ block: "nearest", behavior: "auto" });
      }
    });
  }

  destroy() {
    document.removeEventListener(
      "CherryTree.FsSvc.SongList.Progress",
      this.boundBuildProgress,
    );
    if (this.previewSyncFrame) cancelAnimationFrame(this.previewSyncFrame);
    if (this.setupState.manualCalib?.active) this.exitManualCalibration();
  }
}
