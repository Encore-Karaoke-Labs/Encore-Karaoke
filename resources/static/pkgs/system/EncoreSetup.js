import Html from "/libs/html.js";

/**
 * Controller for the Encore Setup environment.
 * Handles system configuration, including audio/video settings, library selection, and security.
 */
class EncoreSetupController {
  /**
   * Initializes a new EncoreSetupController.
   *
   * @param {Object} Root - The CherryTree system context.
   */
  constructor(Root) {
    this.Root = Root;
    this.Pid = Root.Pid;
    this.Ui = Root.Processes.getService("UiLib").data;
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
      dialog: null,
      previewingVideo: false,
      manualCalib: null,
    };

    this.previewVideoEl = null;
    this.offsetDisplay = null;
    this.previewSyncFrame = null;

    this.boundKeydown = this.handleKeyDown.bind(this);
  }

  /**
   * Bootstraps the setup interface, fetching configurations, device lists, and libraries.
   *
   * @returns {Promise<void>}
   */
  async init() {
    this.config = await window.config.getAll();
    this.micDevices = await this.Forte.getMicDevices();
    this.playbackDevices = await this.Forte.getPlaybackDevices();

    const micDevice = this.config.audioConfig?.mix?.scoring?.inputDevice;
    if (micDevice) {
      await this.Forte.setMicDevice(micDevice);
    } else {
      await this.Forte.setMicDevice("default");
    }

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

  /**
   * Verifies the provided PIN against the securely stored hash.
   *
   * @param {string} input - The 4-digit PIN to check.
   * @returns {Promise<boolean>} True if the PIN is valid or no PIN is set, otherwise false.
   */
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

  /**
   * Generates a new salt and hash combination for a new PIN.
   *
   * @param {string} input - The new 4-digit PIN.
   * @returns {Promise<Object|null>} An object containing the generated salt and hash.
   */
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

  /**
   * Constructs the data maps for the dashboard tiles and submenus based on the current configuration.
   */
  /**
   * Builds the settings configuration maps for dashboard tiles and submenus.
   * Initializes device lists and configuration options for the UI.
   */
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
            id: "buffer_size",
            label: "Buffer Size (ms) (restart required)",
            type: "range",
            min: 10,
            max: 1000,
            step: 10,
            get: () =>
              Math.round((this.config.audioConfig?.bufferSize ?? 0.1) * 1000),
            set: (v) => {
              const val = v / 1000;
              this.config.audioConfig ??= {};
              this.config.audioConfig.bufferSize = val;
              window.config.setItem("audioConfig.bufferSize", val);
            },
          },
          {
            id: "test",
            label: "Test Audio Output",
            type: "action",
            action: () => {
              this.Forte.playSfx("/assets/audio/fanfare.mid");
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

  /**
   * Catches and dispatches keyboard events for system setup navigation.
   *
   * @param {KeyboardEvent} e - The active keydown event.
   */
  handleKeyDown(e) {
    if (this.state.manualCalib && this.state.manualCalib.active) {
      e.preventDefault();

      if (this.state.manualCalib.phase === "input") {
        if (e.key >= "0" && e.key <= "9") {
          if (this.state.manualCalib.songInput.length < 5) {
            this.state.manualCalib.songInput += e.key;
            this.renderView();
          }
        } else if (e.key === "Backspace") {
          this.state.manualCalib.songInput =
            this.state.manualCalib.songInput.slice(0, -1);
          this.renderView();
        } else if (e.key === "Enter") {
          const displayCode = this.state.manualCalib.songInput.padStart(5, "0");
          const song = this.songList.find((s) => s.code === displayCode);
          if (song) {
            this.startCalibrationRecording(song);
          }
        } else if (e.key === "Escape") {
          this.exitManualCalibration();
        }
      } else if (this.state.manualCalib.phase === "recording") {
        if (e.key === "Enter") this.stopCalibrationRecording();
        else if (e.key === "Escape") {
          this.exitManualCalibration();
        }
      } else if (this.state.manualCalib.phase === "playing") {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const dir = e.key === "ArrowRight" ? 1 : -1;

          this.state.manualCalib.offset = Math.max(
            0,
            Math.min(1000, this.state.manualCalib.offset + 10 * dir),
          );

          if (this.calibOffsetDisplay) {
            this.calibOffsetDisplay.text(`${this.state.manualCalib.offset} ms`);
          }
          this.updateCalibrationDelay();
        } else if (e.key === "Enter") this.saveManualCalibration();
        else if (e.key === "Escape") this.exitManualCalibration();
      }
      return;
    }

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

  /**
   * Parses LRC (lyrics) file format for the calibration screen.
   * Extracts timestamps and lyric text from LRC format strings.
   *
   * @param {string} text - The LRC file content to parse
   * @returns {Array<{time: number, text: string}>} Array of lyric entries with timestamps
   */
  parseLrc(text) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    if (!text) return [];
    const lines = text.split("\n");
    return lines
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

  /**
   * Initializes manual microphone latency calibration mode.
   * Sets up the state object for capturing and synchronizing audio streams.
   */
  startManualCalibration() {
    this.state.manualCalib = {
      active: true,
      phase: "input",
      songInput: "",
      offset: Math.round((this.config.audioConfig?.micLatency ?? 0) * 1000),
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
      lrcData: [],
      midiLines: [],
    };
    this.renderView();
  }

  /**
   * Begins recording calibration audio for the selected song.
   * Captures both microphone and music streams, parses lyrics for display.
   *
   * @param {Object} song - The song object containing path and metadata
   * @returns {Promise<void>}
   */
  async startCalibrationRecording(song) {
    this.state.manualCalib.phase = "recording";
    this.renderView();

    this.Forte.setLatency(0);

    const fileUrl = new URL("http://127.0.0.1:9864/getFile");
    fileUrl.searchParams.append("path", song.path);
    await this.Forte.loadTrack(fileUrl.href);

    const pbState = this.Forte.getPlaybackState();
    this.state.manualCalib.isMidi = pbState.isMidi;
    this.state.manualCalib.lrcData = [];
    this.state.manualCalib.midiLines = [];
    if (pbState.isMidi) {
      let currentLineText = "";
      let startIndex = 0;
      let displayIndex = 0;

      let lyricsToParse = [...pbState.decodedLyrics];
      while (
        lyricsToParse.length > 0 &&
        (lyricsToParse[0].trim().startsWith("{@") ||
          lyricsToParse[0].trim().startsWith("{#"))
      ) {
        lyricsToParse.shift();
      }

      for (let i = 0; i < lyricsToParse.length; i++) {
        const syllable = lyricsToParse[i];
        const clean = syllable.replace(/[\r\n\/\\]/g, "");
        const startsWithNewLine = /^[\r\n\/\\\\]/.test(syllable);
        const endsWithNewLine = /[\r\n\/\\\\]$/.test(syllable);

        if (startsWithNewLine && currentLineText.trim() !== "") {
          this.state.manualCalib.midiLines.push({
            text: currentLineText.trim(),
            startIndex,
            endIndex: displayIndex - 1,
          });
          currentLineText = "";
          startIndex = displayIndex;
        }

        if (clean) {
          currentLineText += clean.replace(/\[.*?\]/g, "");
          displayIndex++;
        }

        if (endsWithNewLine && currentLineText.trim() !== "") {
          this.state.manualCalib.midiLines.push({
            text: currentLineText.trim(),
            startIndex,
            endIndex: displayIndex - 1,
          });
          currentLineText = "";
          startIndex = displayIndex;
        }
      }
      if (currentLineText.trim() !== "") {
        this.state.manualCalib.midiLines.push({
          text: currentLineText.trim(),
          startIndex,
          endIndex: displayIndex - 1,
        });
      }
    } else if (song.lrcPath) {
      const lrcText = await this.FsSvc.readFile(song.lrcPath);
      this.state.manualCalib.lrcData = this.parseLrc(lrcText);
    }

    let currentLineIdx = -1;

    this.boundCalibTimeUpdate = (e) => {
      if (this.state.manualCalib.isMidi) return;
      const currentTime = e.detail.currentTime;

      if (this.state.manualCalib.lrcData.length > 0) {
        let activeIdx = -1;
        for (let i = this.state.manualCalib.lrcData.length - 1; i >= 0; i--) {
          if (currentTime >= this.state.manualCalib.lrcData[i].time) {
            activeIdx = i;
            break;
          }
        }

        if (activeIdx !== currentLineIdx) {
          currentLineIdx = activeIdx;
          const activeLine =
            activeIdx >= 0
              ? this.state.manualCalib.lrcData[activeIdx].text
              : "Start singing!";
          const nextLine =
            activeIdx >= 0 &&
            activeIdx + 1 < this.state.manualCalib.lrcData.length
              ? this.state.manualCalib.lrcData[activeIdx + 1].text
              : "";

          if (this.calibLyricLine1) this.calibLyricLine1.text(activeLine);
          if (this.calibLyricLine2) this.calibLyricLine2.text(nextLine);
        }
      }
    };

    this.boundCalibLyricEvent = (e) => {
      if (!this.state.manualCalib.isMidi) return;
      const idx = e.detail.index;

      const lines = this.state.manualCalib.midiLines;
      const activeIdx = lines.findIndex(
        (l) => idx >= l.startIndex && idx <= l.endIndex,
      );

      if (activeIdx !== -1 && activeIdx !== currentLineIdx) {
        currentLineIdx = activeIdx;
        const activeLine = lines[activeIdx].text;
        const nextLine =
          activeIdx + 1 < lines.length ? lines[activeIdx + 1].text : "";

        if (this.calibLyricLine1) this.calibLyricLine1.text(activeLine);
        if (this.calibLyricLine2) this.calibLyricLine2.text(nextLine);
      }
    };

    document.addEventListener(
      "CherryTree.Forte.Playback.TimeUpdate",
      this.boundCalibTimeUpdate,
    );
    document.addEventListener(
      "CherryTree.Forte.Playback.LyricEvent",
      this.boundCalibLyricEvent,
    );

    if (this.calibLyricLine1) this.calibLyricLine1.text("Start singing!");
    if (this.calibLyricLine2) {
      if (
        this.state.manualCalib.isMidi &&
        this.state.manualCalib.midiLines.length > 0
      ) {
        this.calibLyricLine2.text(this.state.manualCalib.midiLines[0].text);
      } else if (
        !this.state.manualCalib.isMidi &&
        this.state.manualCalib.lrcData.length > 0
      ) {
        this.calibLyricLine2.text(this.state.manualCalib.lrcData[0].text);
      }
    }

    const micStream = this.Forte.getMicAudioStream();
    const musicStream = this.Forte.getMusicAudioStream();

    this.state.manualCalib.micChunks = [];
    this.state.manualCalib.musicChunks = [];
    this.state.manualCalib.micRecorder = new MediaRecorder(micStream);
    this.state.manualCalib.musicRecorder = new MediaRecorder(musicStream);

    this.state.manualCalib.micRecorder.ondataavailable = (e) => {
      if (e.data.size) this.state.manualCalib.micChunks.push(e.data);
    };
    this.state.manualCalib.musicRecorder.ondataavailable = (e) => {
      if (e.data.size) this.state.manualCalib.musicChunks.push(e.data);
    };

    this.state.manualCalib.musicRecorder.start();
    this.state.manualCalib.micRecorder.start();
    this.Forte.playTrack();
  }

  /**
   * Stops the active calibration recording and processes the captured audio.
   */
  stopCalibrationRecording() {
    this.state.manualCalib.phase = "processing";
    this.renderView();

    this.Forte.stopTrack();
    if (this.boundCalibTimeUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundCalibTimeUpdate,
      );
    if (this.boundCalibLyricEvent)
      document.removeEventListener(
        "CherryTree.Forte.Playback.LyricEvent",
        this.boundCalibLyricEvent,
      );

    const p1 = new Promise((resolve) => {
      this.state.manualCalib.micRecorder.onstop = async () => {
        const blob = new Blob(this.state.manualCalib.micChunks, {
          type: "audio/webm",
        });
        resolve(await blob.arrayBuffer());
      };
      this.state.manualCalib.micRecorder.stop();
    });

    const p2 = new Promise((resolve) => {
      this.state.manualCalib.musicRecorder.onstop = async () => {
        const blob = new Blob(this.state.manualCalib.musicChunks, {
          type: "audio/webm",
        });
        resolve(await blob.arrayBuffer());
      };
      this.state.manualCalib.musicRecorder.stop();
    });

    Promise.all([p1, p2])
      .then(async ([micArray, musicArray]) => {
        const ctx = this.state.manualCalib.audioContext;
        this.state.manualCalib.micBuffer = await ctx.decodeAudioData(micArray);
        this.state.manualCalib.trackBuffer =
          await ctx.decodeAudioData(musicArray);
        this.startCalibrationPlayback();
      })
      .catch((e) => {
        console.error(e);
        this.showToast("FAILED TO PROCESS RECORDING", "error");
        this.exitManualCalibration();
      });
  }

  /**
   * Begins playback of recorded audio streams for synchronization comparison.
   * Sets up audio nodes with delay for offset adjustment.
   */
  startCalibrationPlayback() {
    this.state.manualCalib.phase = "playing";
    this.renderView();

    const ctx = this.state.manualCalib.audioContext;
    if (ctx.state === "suspended") ctx.resume();

    this.stopCalibrationNodes();

    this.state.manualCalib.trackSource = ctx.createBufferSource();
    this.state.manualCalib.trackSource.buffer =
      this.state.manualCalib.trackBuffer;
    this.state.manualCalib.trackSource.loop = true;

    this.state.manualCalib.micSource = ctx.createBufferSource();
    this.state.manualCalib.micSource.buffer = this.state.manualCalib.micBuffer;
    this.state.manualCalib.micSource.loop = true;

    this.state.manualCalib.trackDelayNode = ctx.createDelay(2.0);
    this.updateCalibrationDelay();

    this.state.manualCalib.trackSource
      .connect(this.state.manualCalib.trackDelayNode)
      .connect(ctx.destination);
    this.state.manualCalib.micSource.connect(ctx.destination);

    this.state.manualCalib.trackSource.start(0);
    this.state.manualCalib.micSource.start(0);

    this.renderWaveforms();
  }

  /**
   * Updates the delay node with current offset value (0-1000ms).
   * Re-renders waveforms to reflect the new delay.
   */
  updateCalibrationDelay() {
    if (!this.state.manualCalib.trackDelayNode) return;

    const offsetSeconds = Math.max(0, this.state.manualCalib.offset / 1000);
    this.state.manualCalib.trackDelayNode.delayTime.value = offsetSeconds;
    this.renderWaveforms();
  }

  /**
   * Safely disconnects and stops all audio nodes used in calibration playback.
   */
  stopCalibrationNodes() {
    if (this.state.manualCalib.trackSource) {
      try {
        this.state.manualCalib.trackSource.stop();
        this.state.manualCalib.trackSource.disconnect();
      } catch (e) {}
    }
    if (this.state.manualCalib.micSource) {
      try {
        this.state.manualCalib.micSource.stop();
        this.state.manualCalib.micSource.disconnect();
      } catch (e) {}
    }
    if (this.state.manualCalib.trackDelayNode) {
      try {
        this.state.manualCalib.trackDelayNode.disconnect();
      } catch (e) {}
    }
  }

  /**
   * Renders waveform visualization of microphone and music audio streams.
   * Uses canvas to display audio amplitudes for visual sync alignment.
   */
  renderWaveforms() {
    if (!this.calibCanvas) return;
    const canvas = this.calibCanvas.elm;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const trackBuffer = this.state.manualCalib.trackBuffer;
    const micBuffer = this.state.manualCalib.micBuffer;
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

        let min = 1.0;
        let max = -1.0;

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
      this.state.manualCalib.offset,
    );

    drawBuffer(micBuffer, "#ffd700", height / 2, height / 4, 0);
  }

  /**
   * Exits calibration mode, cleans up audio nodes and event listeners.
   * Restores the previous latency setting from configuration.
   */
  exitManualCalibration() {
    if (this.state.manualCalib) {
      this.stopCalibrationNodes();
      if (this.state.manualCalib.audioContext)
        this.state.manualCalib.audioContext.close();
      if (this.boundCalibTimeUpdate)
        document.removeEventListener(
          "CherryTree.Forte.Playback.TimeUpdate",
          this.boundCalibTimeUpdate,
        );
      if (this.boundCalibLyricEvent)
        document.removeEventListener(
          "CherryTree.Forte.Playback.LyricEvent",
          this.boundCalibLyricEvent,
        );

      this.Forte.stopTrack();
      const currentConfigLatency = this.config.audioConfig?.micLatency ?? 0;
      this.Forte.setLatency(currentConfigLatency);

      this.state.manualCalib.active = false;
    }
    this.renderView();
  }

  /**
   * Persists the calibrated microphone latency offset to configuration.
   * Applies the new latency setting to the audio engine.
   */
  saveManualCalibration() {
    const val = this.state.manualCalib.offset / 1000;
    this.config.audioConfig ??= {};
    this.config.audioConfig.micLatency = val;
    window.config.setItem("audioConfig.micLatency", val);
    this.Forte.setLatency(val);
    this.showToast("CALIBRATION SAVED", "success");

    this.state.manualCalib.active = false;
    this.exitManualCalibration();
  }

  /**
   * Processes PIN verification and entry flow.
   * Handles both initial authentication and PIN changes based on the current state.
   *
   * @returns {Promise<void>}
   */
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

  /**
   * Executes a dashboard action.
   * Handles reboot, security PIN change, and navigation to configuration submenus.
   *
   * @param {string} id - The action ID corresponding to a dashboard tile
   */
  executeAction(id) {
    if (id === "reboot") {
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

  /**
   * Scans storage for Encore libraries and sets the active library.
   * Updates song list and configuration based on the discovered library.
   *
   * @returns {Promise<void>}
   */
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

    await this.FsSvc.buildSongList(newLib.path);
    this.songList = this.FsSvc.getSongList();

    this.showToast(`LIBRARY SET TO: ${newLib.manifest.title}`, "success");
    this.renderView();
  }

  /**
   * Initializes video preview playback for sync calibration.
   * Loads the first MTV song with playback synchronization.
   *
   * @returns {Promise<void>}
   */
  async startVideoPreview() {
    if (!this.songList || this.songList.length === 0) {
      this.showToast("LIBRARY EMPTY OR NOT LOADED", "error");
      return;
    }

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

  /**
   * Synchronizes video playback with audio track during preview.
   * Adjusts video time and playback rate based on configured sync offset.
   * Runs as a continuous animation frame loop.
   */
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

  /**
   * Stops video preview and cleans up playback resources.
   * Cancels animation frames and removes event listeners.
   */
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

  /**
   * Displays a temporary toast notification.
   *
   * @param {string} msg - The notification text
   * @param {string} type - Notification type: "success", "error", or "info"
   */
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

  /**
   * Main rendering function that delegates to view-specific renderers.
   * Handles state-based UI updates for auth, dashboard, calibration, and video preview.
   */
  renderView() {
    this.container.clear();

    if (this.state.manualCalib?.active) {
      this.renderManualCalibrationOverlay(this.container);
      return;
    }

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

  /**
   * Renders the manual calibration overlay with phase-specific UI.
   * Displays input, recording, processing, or playback screens.
   *
   * @param {Object} container - Parent DOM element
   */
  renderManualCalibrationOverlay(container) {
    const overlay = new Html("div")
      .classOn("setup-manual-calib-overlay")
      .appendTo(container);

    new Html("h2").text("MANUAL SYNC CALIBRATION").appendTo(overlay);

    if (this.state.manualCalib.phase === "input") {
      new Html("p")
        .text(
          "Enter a 5-digit song number from your library to use for testing.",
        )
        .appendTo(overlay);
      new Html("br").appendTo(overlay);

      const displayCode = this.state.manualCalib.songInput.padStart(5, "0");
      new Html("div")
        .classOn("calib-value-display")
        .text(displayCode)
        .appendTo(overlay);

      const song = this.songList.find((s) => s.code === displayCode);
      if (song) {
        new Html("p")
          .styleJs({ color: "#89cff0", fontWeight: "bold", fontSize: "1.5rem" })
          .text(`${song.title} - ${song.artist}`)
          .appendTo(overlay);
      } else if (this.state.manualCalib.songInput.length > 0) {
        new Html("p")
          .styleJs({ color: "#ff5555", fontWeight: "bold", fontSize: "1.5rem" })
          .text("Song not found in library.")
          .appendTo(overlay);
      }

      new Html("p")
        .styleJs({ marginTop: "2rem", opacity: "0.6" })
        .text("Use Number Keys to type | ENTER to Start | ESC to Cancel")
        .appendTo(overlay);
    } else if (this.state.manualCalib.phase === "recording") {
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
    } else if (this.state.manualCalib.phase === "processing") {
      new Html("h2").text("PROCESSING AUDIO...").appendTo(overlay);
    } else if (this.state.manualCalib.phase === "playing") {
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

      const offset = this.state.manualCalib.offset;
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

  /**
   * Renders the video preview overlay with sync offset display.
   *
   * @param {Object} container - Parent DOM element
   */
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

  /**
   * Renders a modal dialog box.
   *
   * @param {Object} container - Parent DOM element
   */
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

  /**
   * Renders the PIN authentication screen.
   * Displays input dots based on entered PIN length.
   *
   * @param {Object} container - Parent DOM element
   */
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

  /**
   * Renders the dashboard grid with configuration tiles.
   * Highlights the currently selected tile.
   *
   * @param {Object} container - Parent DOM element
   */
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

  /**
   * Renders a configuration submenu with items and controls.
   * Handles range sliders, select dropdowns, and action buttons.
   *
   * @param {Object} container - Parent DOM element
   */
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

  /**
   * Cleans up the setup interface.
   * Removes event listeners and destroys the UI.
   */
  destroy() {
    window.removeEventListener("keydown", this.boundKeydown);
    if (this.previewSyncFrame) cancelAnimationFrame(this.previewSyncFrame);
    if (this.state.manualCalib?.active) this.exitManualCalibration();
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
