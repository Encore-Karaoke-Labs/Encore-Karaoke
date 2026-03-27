import Html from "/libs/html.js";

class EncoreSetupController {
  constructor(Root) {
    this.Root = Root;
    this.Pid = Root.Pid;
    this.Ui = Root.Processes.getService("UiLib").data; // Added UiLib
    this.Forte = Root.Processes.getService("ForteSvc").data;
    this.FsSvc = Root.Processes.getService("FsSvc").data;

    this.config = {};
    this.micDevices = [];
    this.playbackDevices = [];
    this.songList = [];

    this.state = {
      view: "auth",
      authInput: "",
      dashboardIndex: 0,
      submenuIndex: 0,
      activeMenuId: null,
      pinChangeStep: 0,
      newPinTemp: "",
      isVerifying: false,
      dialog: null, // { title, content }
      previewingVideo: false, // Active when in Video Sync Preview mode
    };

    // Video Sync state refs
    this.previewVideoEl = null;
    this.offsetDisplay = null;
    this.previewSyncFrame = null;

    this.boundKeydown = this.handleKeyDown.bind(this);
  }

  async init() {
    this.config = await window.config.getAll();
    this.micDevices = await this.Forte.getMicDevices();
    this.playbackDevices = await this.Forte.getPlaybackDevices();

    if (this.config.libraryPath) {
      await this.FsSvc.buildSongList(this.config.libraryPath);
      this.songList = this.FsSvc.getSongList();
    }

    const foundLibs = await this.FsSvc.findEncoreLibraries();
    const activeLib = foundLibs.find((l) => l.path === this.config.libraryPath);
    this.currentManifest = activeLib
      ? activeLib.manifest
      : { title: "Unknown", description: "No metadata available." };

    this.buildSettingsMap();

    this.wrapper = new Html("div").class("full-ui").appendTo("body").styleJs({
      background: "linear-gradient(135deg, #05050A 0%, #1A1A2E 100%)",
      color: "white",
      fontFamily: "'Rajdhani', sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: 0,
    });

    this.container = new Html("div")
      .classOn("setup-container")
      .appendTo(this.wrapper);

    window.addEventListener("keydown", this.boundKeydown);
    this.renderView();

    setTimeout(() => {
      window.desktopIntegration.ipc.send("setRPC", {
        details: `In setup`,
      });
      this.wrapper.styleJs({ opacity: 1 });
      this.Ui.transition("fadeIn", this.wrapper);
    }, 100);
  }

  async verifyPin(input) {
    const pinData = this.config.security?.pinData;
    if (!pinData) return input === "0000";
    try {
      const res = await fetch("http://127.0.0.1:9864/auth/verify-hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: input,
          salt: pinData.salt,
          hash: pinData.hash,
        }),
      });
      const data = await res.json();
      return data.valid;
    } catch (e) {
      console.error("PIN Verification Error:", e);
      return false;
    }
  }

  async createPinHash(input) {
    try {
      const res = await fetch("http://127.0.0.1:9864/auth/create-hash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      });
      return await res.json();
    } catch (e) {
      console.error("PIN Creation Error:", e);
      return null;
    }
  }

  buildSettingsMap() {
    this.DASHBOARD_TILES = [
      { id: "library", label: "Library & Storage", icon: "📁" },
      { id: "audio", label: "Sound Settings", icon: "🔊" },
      { id: "mic", label: "Microphone Settings", icon: "🎤" },
      { id: "video", label: "Video Settings", icon: "📺" },
      { id: "security", label: "User Security", icon: "🔒" },
      { id: "reboot", label: "System Reboot", icon: "🔄" },
    ];

    const micOptions = this.micDevices.map((d) => ({
      label: d.label || "Default",
      value: d.deviceId,
    }));
    const playbackOptions = this.playbackDevices.map((d) => ({
      label: d.label || "Default",
      value: d.deviceId,
    }));

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
              this.state.dialog = {
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
            get: () => this.config.libraryPath || "Not Set",
          },
          {
            id: "scan",
            label: "Rescan & Change Library",
            type: "action",
            action: async () => await this.handleLibraryScan(),
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
              this.config.audioConfig?.mix?.instrumental?.outputDevice ||
              "default",
            set: (v) => {
              this.config.audioConfig ??= {};
              this.config.audioConfig.mix ??= {};
              this.config.audioConfig.mix.instrumental ??= {};
              this.config.audioConfig.mix.instrumental.outputDevice = v;
              window.config.setItem(
                "audioConfig.mix.instrumental.outputDevice",
                v,
              );
              this.Forte.setPlaybackDevice(v);
            },
          },
          {
            id: "test",
            label: "Test Audio Output",
            type: "action",
            action: () => {
              this.Forte.playSfx("/assets/audio/fanfare.wav");
              this.showToast("PLAYING TEST SOUND...", "info");
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
                (this.config.audioConfig?.mix?.instrumental?.volume ?? 1) * 100,
              ),
            set: (v) => {
              const val = v / 100;
              this.config.audioConfig ??= {};
              this.config.audioConfig.mix ??= {};
              this.config.audioConfig.mix.instrumental ??= {};
              this.config.audioConfig.mix.instrumental.volume = val;
              window.config.setItem("audioConfig.mix.instrumental.volume", val);
              this.Forte.setTrackVolume(val);
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
              this.config.audioConfig?.mix?.scoring?.inputDevice || "default",
            set: (v) => {
              this.config.audioConfig ??= {};
              this.config.audioConfig.mix ??= {};
              this.config.audioConfig.mix.scoring ??= {};
              this.config.audioConfig.mix.scoring.inputDevice = v;
              window.config.setItem("audioConfig.mix.scoring.inputDevice", v);
              this.Forte.setMicDevice(v);
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
              Math.round((this.config.audioConfig?.micLatency ?? 0) * 1000),
            set: (v) => {
              const val = v / 1000;
              this.config.audioConfig ??= {};
              this.config.audioConfig.micLatency = val;
              window.config.setItem("audioConfig.micLatency", val);
              this.Forte.setLatency(val);
            },
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
            get: () => this.config.videoConfig?.syncOffset ?? 0,
            set: (v) => {
              this.config.videoConfig ??= {};
              this.config.videoConfig.syncOffset = v;
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
    if (this.state.previewingVideo) {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const currentOffset = this.config.videoConfig?.syncOffset || 0;
        const newOffset = Math.max(
          -1000,
          Math.min(1000, currentOffset + 10 * dir),
        );

        this.config.videoConfig ??= {};
        this.config.videoConfig.syncOffset = newOffset;
        window.config.setItem("videoConfig.syncOffset", newOffset);

        if (this.offsetDisplay) {
          this.offsetDisplay.text(
            `OFFSET: ${newOffset > 0 ? "+" : ""}${newOffset} ms`,
          );
        }
      } else if (e.key === "Enter" || e.key === "Escape") {
        this.stopVideoPreview();
      }
      return;
    }

    if (this.state.dialog) {
      if (e.key === "Enter" || e.key === "Escape") {
        this.state.dialog = null;
        this.renderView();
      }
      return;
    }

    if (e.key === "Escape") {
      if (this.state.view === "submenu" || this.state.view === "pin_change") {
        this.state.view = "dashboard";
        this.renderView();
      } else if (
        this.state.view === "dashboard" ||
        this.state.view === "auth"
      ) {
        this.executeAction("reboot");
      }
      return;
    }

    if (this.state.view === "auth" || this.state.view === "pin_change") {
      if (this.state.isVerifying) return;

      if (e.key >= "0" && e.key <= "9") {
        if (this.state.authInput.length >= 4) return;
        this.state.authInput += e.key;
        this.renderView();

        if (this.state.authInput.length === 4) {
          this.state.isVerifying = true;
          setTimeout(() => this.processAuth(), 200);
        }
      } else if (e.key === "Backspace") {
        this.state.authInput = this.state.authInput.slice(0, -1);
        this.renderView();
      }
      return;
    }

    if (this.state.view === "dashboard") {
      const cols = 3;
      const total = this.DASHBOARD_TILES.length;
      if (e.key === "ArrowRight")
        this.state.dashboardIndex = (this.state.dashboardIndex + 1) % total;
      if (e.key === "ArrowLeft")
        this.state.dashboardIndex =
          (this.state.dashboardIndex - 1 + total) % total;
      if (e.key === "ArrowDown")
        this.state.dashboardIndex = Math.min(
          total - 1,
          this.state.dashboardIndex + cols,
        );
      if (e.key === "ArrowUp")
        this.state.dashboardIndex = Math.max(
          0,
          this.state.dashboardIndex - cols,
        );
      if (e.key === "Enter") {
        const selected = this.DASHBOARD_TILES[this.state.dashboardIndex];
        this.executeAction(selected.id);
      }
      this.renderView();
      return;
    }

    if (this.state.view === "submenu") {
      const menu = this.SUBMENUS[this.state.activeMenuId];
      const items = menu.items;
      const currentItem = items[this.state.submenuIndex];

      if (e.key === "ArrowDown") {
        this.state.submenuIndex = Math.min(
          items.length - 1,
          this.state.submenuIndex + 1,
        );
      } else if (e.key === "ArrowUp") {
        this.state.submenuIndex = Math.max(0, this.state.submenuIndex - 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
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

  async processAuth() {
    if (this.state.view === "auth") {
      const isValid = await this.verifyPin(this.state.authInput);
      if (isValid) {
        this.state.view = "dashboard";
      } else {
        this.showToast("INCORRECT PIN", "error");
      }
      this.state.authInput = "";
    } else if (this.state.view === "pin_change") {
      if (this.state.pinChangeStep === 0) {
        const isValid = await this.verifyPin(this.state.authInput);
        if (isValid) {
          this.state.pinChangeStep = 1;
        } else {
          this.state.pinChangeStep = 0;
          this.state.view = "dashboard";
          this.showToast("AUTHORIZATION FAILED", "error");
        }
        this.state.authInput = "";
      } else if (this.state.pinChangeStep === 1) {
        this.state.newPinTemp = this.state.authInput;
        this.state.pinChangeStep = 2;
        this.state.authInput = "";
      } else if (this.state.pinChangeStep === 2) {
        if (this.state.authInput === this.state.newPinTemp) {
          const newPinData = await this.createPinHash(this.state.authInput);
          if (newPinData) {
            this.config.security ??= {};
            this.config.security.pinData = newPinData;
            window.config.setItem("security.pinData", newPinData);
            this.showToast("PIN UPDATED", "success");
          } else {
            this.showToast("HASHING FAILED", "error");
          }
        } else {
          this.showToast("PIN MISMATCH", "error");
        }
        this.state.view = "dashboard";
        this.state.authInput = "";
      }
    }
    this.state.isVerifying = false;
    this.renderView();
  }

  executeAction(id) {
    if (id === "reboot") {
      // Create a massive black overlay over everything for a seamless fade to black
      const fadeOverlay = new Html("div")
        .styleJs({
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "black",
          zIndex: 99999,
          opacity: 0,
          pointerEvents: "all",
        })
        .appendTo(document.body);

      if (typeof anime !== "undefined") {
        anime({
          targets: fadeOverlay.elm,
          opacity: [0, 1],
          duration: 600,
          easing: "easeInOutQuad",
          complete: () => window.location.reload(),
        });
      } else {
        window.location.reload();
      }
    } else if (id === "security") {
      this.state.view = "pin_change";
      this.state.pinChangeStep = 0;
      this.state.authInput = "";
    } else if (this.SUBMENUS[id]) {
      this.state.activeMenuId = id;
      this.state.submenuIndex = 0;
      this.state.view = "submenu";
    }
  }

  async handleLibraryScan() {
    this.showToast("SCANNING DRIVES...", "info");
    const foundLibs = await this.FsSvc.findEncoreLibraries();
    if (foundLibs.length === 0) {
      this.showToast("NO LIBRARIES FOUND", "error");
      return;
    }

    const newLib = foundLibs[0];
    this.config.libraryPath = newLib.path;
    this.currentManifest = newLib.manifest;
    window.config.setItem("libraryPath", newLib.path);

    // Refresh the song list based on the new library
    await this.FsSvc.buildSongList(newLib.path);
    this.songList = this.FsSvc.getSongList();

    this.showToast(`LIBRARY SET TO: ${newLib.manifest.title}`, "success");
    this.renderView();
  }

  async startVideoPreview() {
    if (!this.songList || this.songList.length === 0) {
      this.showToast("LIBRARY EMPTY OR NOT LOADED", "error");
      return;
    }

    // Find a track that specifically has an MTV
    const mtvSong = this.songList.find((s) => s.videoPath);
    if (!mtvSong) {
      this.showToast("NO MTV SONGS FOUND IN LIBRARY", "error");
      return;
    }

    this.state.previewingVideo = true;
    this.renderView();

    const audioUrl = new URL("http://127.0.0.1:9864/getFile");
    audioUrl.searchParams.append("path", mtvSong.path);

    this.showToast("LOADING TRACK...", "info");
    await this.Forte.loadTrack(audioUrl.href);

    const videoUrl = new URL("http://127.0.0.1:9864/getFile");
    videoUrl.searchParams.append("path", mtvSong.videoPath);

    this.previewVideoEl.attr({ src: videoUrl.href });
    this.previewVideoEl.elm.play().catch((e) => console.error(e));

    this.Forte.playTrack();
    this.previewSyncFrame = requestAnimationFrame(() => this.syncVideoLoop());
  }

  syncVideoLoop() {
    if (!this.state.previewingVideo) return;
    const pbState = this.Forte.getPlaybackState();

    if (
      pbState.status === "playing" &&
      this.previewVideoEl &&
      this.previewVideoEl.elm.readyState >= 2
    ) {
      const vid = this.previewVideoEl.elm;
      const offsetSec = (this.config.videoConfig?.syncOffset || 0) / 1000;
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
    this.state.previewingVideo = false;
    if (this.previewSyncFrame) cancelAnimationFrame(this.previewSyncFrame);

    this.Forte.stopTrack();
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
      .appendTo(this.wrapper);
    setTimeout(() => toast.classOn("visible"), 50);
    setTimeout(() => {
      toast.classOff("visible");
      setTimeout(() => toast.cleanup(), 300);
    }, 3000);
  }

  renderView() {
    this.container.clear();

    if (this.state.previewingVideo) {
      this.renderVideoPreviewOverlay(this.container);
      return;
    }

    const header = new Html("div")
      .classOn("setup-header")
      .appendTo(this.container);
    new Html("h1").text("ENCORE SYSTEM CONFIGURATION").appendTo(header);

    const body = new Html("div").classOn("setup-body").appendTo(this.container);

    if (this.state.view === "auth" || this.state.view === "pin_change") {
      this.renderAuthScreen(body);
    } else if (this.state.view === "dashboard") {
      this.renderDashboard(body);
    } else if (this.state.view === "submenu") {
      this.renderSubmenu(body);
    }

    const footer = new Html("div")
      .classOn("setup-footer")
      .appendTo(this.container);
    let hint = "ARROWS: Navigate | ENTER: Select";
    if (this.state.view === "submenu" || this.state.view === "pin_change")
      hint += " | ESC: Back";
    if (this.state.view === "auth")
      hint = "Enter 4-digit PIN using number keys | ESC: Exit Setup";
    new Html("p").text(hint).appendTo(footer);

    if (this.state.dialog) {
      this.renderDialog(this.container);
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

    const currentOffset = this.config.videoConfig?.syncOffset || 0;
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

    new Html("h2").text(this.state.dialog.title).appendTo(box);
    new Html("div")
      .classOn("setup-dialog-content")
      .text(this.state.dialog.content)
      .appendTo(box);
    new Html("p")
      .classOn("setup-dialog-hint")
      .text("Press ENTER or ESC to close")
      .appendTo(box);
  }

  renderAuthScreen(container) {
    const authBox = new Html("div").classOn("auth-box").appendTo(container);

    let title = "SYSTEM AUTHENTICATION";
    let sub = "ENTER CURRENT PIN CODE";

    if (this.state.view === "pin_change") {
      if (this.state.pinChangeStep === 1) {
        title = "CHANGE PIN";
        sub = "ENTER NEW 4-DIGIT PIN";
      }
      if (this.state.pinChangeStep === 2) {
        title = "CHANGE PIN";
        sub = "CONFIRM NEW PIN";
      }
    }

    new Html("h2").text(title).appendTo(authBox);
    new Html("p").text(sub).appendTo(authBox);

    const dotsWrapper = new Html("div").classOn("auth-dots").appendTo(authBox);
    for (let i = 0; i < 4; i++) {
      const dot = new Html("div").classOn("auth-dot").appendTo(dotsWrapper);
      if (i < this.state.authInput.length) dot.classOn("filled");
    }
  }

  renderDashboard(container) {
    const grid = new Html("div").classOn("setup-grid").appendTo(container);
    this.DASHBOARD_TILES.forEach((tile, idx) => {
      const tileEl = new Html("div").classOn("setup-tile").appendTo(grid);
      if (idx === this.state.dashboardIndex) tileEl.classOn("active");

      new Html("div")
        .classOn("setup-tile-icon")
        .text(tile.icon)
        .appendTo(tileEl);
      new Html("div")
        .classOn("setup-tile-label")
        .text(tile.label)
        .appendTo(tileEl);
    });
  }

  renderSubmenu(container) {
    const menuData = this.SUBMENUS[this.state.activeMenuId];

    const panel = new Html("div").classOn("submenu-panel").appendTo(container);
    new Html("h2")
      .classOn("submenu-title")
      .text(menuData.title)
      .appendTo(panel);

    const list = new Html("div").classOn("submenu-list").appendTo(panel);
    menuData.items.forEach((item, idx) => {
      const row = new Html("div").classOn("submenu-item").appendTo(list);
      if (idx === this.state.submenuIndex) row.classOn("active");

      new Html("div").classOn("submenu-label").text(item.label).appendTo(row);

      const valWrap = new Html("div").classOn("submenu-value").appendTo(row);

      if (item.type === "info") {
        valWrap.html(`<span class="info-text">${item.get()}</span>`);
      } else if (item.type === "info-action") {
        valWrap.html(
          `<span class="info-text">${item.get()}</span> <span style="opacity: 0.5; font-size: 0.8em; margin-left: 10px;">↵</span>`,
        );
      } else if (item.type === "action") {
        valWrap.text("Press Enter to execute");
      } else if (item.type === "range") {
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
  }

  destroy() {
    window.removeEventListener("keydown", this.boundKeydown);
    if (this.previewSyncFrame) cancelAnimationFrame(this.previewSyncFrame);
    this.Ui.giveUpUi(this.Pid);
    this.wrapper.cleanup();
  }
}

const pkg = {
  name: "Encore Setup",
  type: "app",
  privs: 0,
  start: async function (Root) {
    const controller = new EncoreSetupController(Root);
    await controller.init();
    Root.controller = controller;
  },
  end: async function () {
    if (this.controller) this.controller.destroy();
  },
};

export default pkg;
