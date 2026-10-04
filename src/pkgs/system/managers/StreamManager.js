import Html from "../../../libs/html.js";

export default class StreamManager {
  /**
   * @param {Object} context - The shared Encore context
   */
  constructor(context) {
    this.ctx = context;
    this.isStreaming = false;
    this.streamRecorder = null;
    this.streamStartTime = null;
    this.modalView = "selection"; // "selection" | "obs" | "direct"

    // Direct RTMP Configuration
    const cfg = this.ctx.config?.streamConfig || {};
    this.rtmpUrl = cfg.rtmpUrl || "";
    this.streamKey = cfg.streamKey || "";
    this.videoBitrate = cfg.videoBitrate || 3500000;
    this.isKeyVisible = false;

    // OBS WebSocket Configuration
    const obsCfg = this.ctx.config?.obsConfig || {};
    this.obsHost = obsCfg.host || "127.0.0.1";
    this.obsPort = obsCfg.port || 4455;
    this.obsPassword = obsCfg.password || "";
    this.obsAutoReconnect = obsCfg.autoReconnect ?? true;
    this.obsScenesConfig = obsCfg.scenes || {
      idle: "",
      singing: "",
      score: "",
    };
    this.isObsPasswordVisible = false;

    this.obsStatus = {
      connected: false,
      reconnecting: false,
      currentScene: "",
      scenes: [],
      error: null,
    };

    // Telemetry & Stats
    this.latestStats = null;
    this.statEls = {};
    this.statsTimer = null;
    this.totalBytesSent = 0;
    this.currentBitrateKbps = 0;
    this.lastChunkTime = null;
    this.lastNavSfxTime = 0;

    // Direct RTMP Telemetry Listeners
    window.desktopIntegration?.ipc?.on?.("stream-stats", (_e, stats) => {
      this.latestStats = stats;
      this.updateStatsUI();
    });

    window.desktopIntegration?.ipc?.on?.(
      "stream-status-changed",
      (_e, isStreaming) => {
        if (!isStreaming && this.isStreaming) {
          this.stopStream();
        }
      },
    );

    window.obs?.getStatus?.().then((status) => {
      if (status) this.obsStatus = status;
    });

    window.obs?.onStatusUpdate?.((status) => {
      this.obsStatus = status;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "obs") {
        this.renderObsView();
      }
    });

    window.obs?.onScenesUpdate?.((scenes) => {
      this.obsStatus.scenes = scenes;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "obs") {
        this.renderObsView();
      }
    });

    window.obs?.onSceneChanged?.((sceneName) => {
      this.obsStatus.currentScene = sceneName;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "obs") {
        this.renderObsView();
      }
    });
  }

  /**
   * Plays a navigation sound effect.
   * @param {string} sfxName - The name of the wav file (without extension)
   */
  playNavSfx(sfxName) {
    if (this.ctx.state.isNavSfxEnabled === false) return;

    const now = Date.now();
    if (now - this.lastNavSfxTime < 80) return;

    this.lastNavSfxTime = now;
    this.ctx.services.Forte?.playSfx(`/assets/audio/${sfxName}.wav`);
  }

  /**
   * Opens or closes the Broadcast Modal.
   */
  toggleStreamModal(forceState = null) {
    const state = this.ctx.state;
    const shouldOpen =
      forceState !== null ? forceState : !state.isStreamModalOpen;

    state.isStreamModalOpen = shouldOpen;

    if (shouldOpen) {
      this.ctx.dom.streamModal.classOff("hidden");
      this.modalView = this.isStreaming ? "direct" : "selection";
      this.render();
    } else {
      this.ctx.dom.streamModal.classOn("hidden");
    }
  }

  /**
   * Renders the current view inside the modal.
   */
  render() {
    if (this.modalView === "obs") {
      this.renderObsView();
    } else if (this.modalView === "direct") {
      this.renderDirectView();
    } else {
      this.renderSelectionView();
    }
  }

  /**
   * Mode Selection Screen
   */
  renderSelectionView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();

    new Html("h1").text("BROADCAST & STREAMING").appendTo(dom.streamHeader);
    new Html("p")
      .text("Configure tools for live streaming.")
      .appendTo(dom.streamHeader);

    const selectionArea = new Html("div")
      .classOn("stream-selection-area")
      .appendTo(dom.streamContentArea);

    const tileContainer = new Html("div")
      .classOn("session-tile-container")
      .appendTo(selectionArea);

    // OBS Tile
    const obsTile = new Html("div")
      .classOn("session-tile")
      .attr({ tabindex: "0" })
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html(
        '<ion-icon name="desktop-outline" style="font-size: 3rem;"></ion-icon>',
      )
      .appendTo(obsTile);

    new Html("div")
      .classOn("session-tile-title")
      .text("OBS INTEGRATION")
      .appendTo(obsTile);

    new Html("div")
      .classOn("session-tile-desc")
      .text("Automate scene switching and manage live browser overlays")
      .appendTo(obsTile);

    obsTile.on("click", () => {
      this.modalView = "obs";
      this.render();
    });

    const directTile = new Html("div")
      .classOn("session-tile")
      .attr({ tabindex: "0" })
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html(
        '<ion-icon name="radio-outline" style="font-size: 3rem;"></ion-icon>',
      )
      .appendTo(directTile);

    new Html("div")
      .classOn("session-tile-title")
      .text("DIRECT BROADCAST")
      .appendTo(directTile);

    new Html("div")
      .classOn("session-tile-desc")
      .text("Stream your Encore session directly.")
      .appendTo(directTile);

    directTile.on("click", () => {
      this.modalView = "direct";
      this.render();
    });

    const btnRow = new Html("div")
      .classOn("session-btn-row")
      .appendTo(selectionArea);

    new Html("button")
      .classOn("session-btn", "danger")
      .text("CANCEL")
      .on("click", () => this.toggleStreamModal(false))
      .appendTo(btnRow);
  }

  /**
   * OBS Integration View.
   */
  renderObsView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();

    new Html("h1").text("OBS INTEGRATION").appendTo(dom.streamHeader);
    new Html("p")
      .text("Automate scene changes and get browser overlays.")
      .appendTo(dom.streamHeader);

    const contentArea = new Html("div")
      .classOn("stream-content-area")
      .styleJs({ padding: "0" })
      .appendTo(dom.streamContentArea);

    const leftCol = new Html("div").classOn("stream-col").appendTo(contentArea);
    const rightCol = new Html("div")
      .classOn("stream-col")
      .appendTo(contentArea);

    new Html("div")
      .classOn("stream-section-title")
      .text("CONNECTION CONFIGURATION")
      .appendTo(leftCol);

    const hostRow = new Html("div")
      .styleJs({ display: "flex", gap: "1rem" })
      .appendTo(leftCol);

    const hostGroup = new Html("div")
      .classOn("stream-form-group")
      .styleJs({ flex: "2" })
      .appendTo(hostRow);

    new Html("label")
      .classOn("stream-form-label")
      .text("Server IP / Host")
      .appendTo(hostGroup);

    const hostInput = new Html("input")
      .classOn("stream-input")
      .attr({ type: "text", value: this.obsHost, placeholder: "127.0.0.1" })
      .appendTo(hostGroup);

    hostInput.on("input", () => {
      this.obsHost = hostInput.getValue().trim();
      this.saveObsConfig();
    });

    const portGroup = new Html("div")
      .classOn("stream-form-group")
      .styleJs({ flex: "1" })
      .appendTo(hostRow);

    new Html("label")
      .classOn("stream-form-label")
      .text("Port")
      .appendTo(portGroup);

    const portInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: "number",
        value: String(this.obsPort),
        placeholder: "4455",
      })
      .appendTo(portGroup);

    portInput.on("input", () => {
      this.obsPort = parseInt(portInput.getValue().trim(), 10) || 4455;
      this.saveObsConfig();
    });

    const pwGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(leftCol);
    new Html("label")
      .classOn("stream-form-label")
      .text("Server Password")
      .appendTo(pwGroup);

    const pwWrapper = new Html("div")
      .classOn("stream-input-wrapper")
      .styleJs({
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "center",
      })
      .appendTo(pwGroup);

    const pwInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: this.isObsPasswordVisible ? "text" : "password",
        value: this.obsPassword,
        placeholder: "Leave empty if password is disabled in OBS",
      })
      .appendTo(pwWrapper);

    pwInput.on("input", () => {
      this.obsPassword = pwInput.getValue();
      this.saveObsConfig();
    });

    const togglePwBtn = new Html("button")
      .classOn("stream-key-action-btn")
      .styleJs({ position: "absolute", right: "10px" })
      .text(this.isObsPasswordVisible ? "HIDE" : "SHOW")
      .on("click", (e) => {
        e.stopPropagation();
        this.isObsPasswordVisible = !this.isObsPasswordVisible;
        pwInput.attr({ type: this.isObsPasswordVisible ? "text" : "password" });
        togglePwBtn.text(this.isObsPasswordVisible ? "HIDE" : "SHOW");
      })
      .appendTo(pwWrapper);

    const autoRecRow = new Html("label")
      .classOn("stream-checkbox-row")
      .appendTo(leftCol);

    const autoRecCheckbox = new Html("input")
      .attr({ type: "checkbox" })
      .appendTo(autoRecRow);

    if (this.obsAutoReconnect) autoRecCheckbox.elm.checked = true;

    autoRecCheckbox.on("change", () => {
      this.obsAutoReconnect = autoRecCheckbox.elm.checked;
      this.saveObsConfig();
    });

    new Html("span")
      .text("Automatically reconnect if OBS starts later or restarts")
      .appendTo(autoRecRow);

    new Html("div")
      .classOn("stream-section-title")
      .styleJs({ marginTop: "0.25rem" })
      .text("CONNECTION STATUS")
      .appendTo(leftCol);

    const statusBox = new Html("div")
      .classOn("stream-status-box")
      .appendTo(leftCol);

    let statusTitle = "DISCONNECTED";
    let statusClass = "status-disconnected";
    let statusDesc = "Not connected to OBS Studio.";

    if (this.obsStatus.connected) {
      statusTitle = "CONNECTED TO OBS STUDIO";
      statusClass = "status-connected";
      statusDesc = `Target: ws://${this.obsHost}:${this.obsPort} | Active Scene: ${this.obsStatus.currentScene || "None"}`;
    } else if (this.obsStatus.reconnecting) {
      statusTitle = "CONNECTING / RECONNECTING...";
      statusClass = "status-connecting";
      statusDesc = `Attempting connection to ws://${this.obsHost}:${this.obsPort}. Make sure OBS is running with WebSocket enabled.`;
    } else if (this.obsStatus.error) {
      statusTitle = "CONNECTION FAILED";
      statusClass = "status-error";
      statusDesc = this.obsStatus.error;
    }

    statusBox.classOn(statusClass);
    new Html("div")
      .classOn("stream-status-header-text")
      .text(statusTitle)
      .appendTo(statusBox);
    new Html("div")
      .classOn("stream-status-desc-text")
      .text(statusDesc)
      .appendTo(statusBox);

    const connBtnRow = new Html("div")
      .styleJs({ display: "flex", gap: "1rem", marginTop: "auto" })
      .appendTo(leftCol);

    if (!this.obsStatus.connected) {
      new Html("button")
        .classOn("session-btn", "primary")
        .text("CONNECT TO OBS")
        .on("click", async () => {
          this.saveObsConfig(true);
          await window.obs?.connect({
            host: this.obsHost,
            port: this.obsPort,
            password: this.obsPassword,
          });
        })
        .appendTo(connBtnRow);
    } else {
      new Html("button")
        .classOn("session-btn", "danger")
        .text("DISCONNECT")
        .on("click", async () => {
          this.saveObsConfig(false);
          await window.obs?.disconnect();
        })
        .appendTo(connBtnRow);
    }

    new Html("div")
      .classOn("stream-section-title")
      .text("AUTOMATED SCENE SWITCHING")
      .appendTo(rightCol);

    const scenesAvailable =
      this.obsStatus.connected && this.obsStatus.scenes.length > 0;

    const buildSceneSelect = (label, stateKey) => {
      const row = new Html("div")
        .classOn("stream-scene-row")
        .appendTo(rightCol);
      new Html("span").classOn("stream-scene-label").text(label).appendTo(row);

      const select = new Html("select")
        .classOn("stream-select", "stream-scene-select")
        .appendTo(row);

      if (!scenesAvailable) {
        select.elm.disabled = true;
        new Html("option")
          .text(this.obsStatus.connected ? "No scenes" : "Connect to OBS first")
          .appendTo(select);
        return;
      }

      const defaultOpt = new Html("option")
        .attr({ value: "__none__" })
        .text("— None / Keep Scene —")
        .appendTo(select);

      const currentSelected = this.obsScenesConfig[stateKey] || "__none__";

      this.obsStatus.scenes.forEach((sc) => {
        const opt = new Html("option")
          .attr({ value: sc })
          .text(sc)
          .appendTo(select);
        if (sc === currentSelected) {
          opt.elm.selected = true;
        }
      });

      if (currentSelected === "__none__") defaultOpt.elm.selected = true;

      select.on("change", () => {
        this.obsScenesConfig[stateKey] = select.getValue();
        this.saveObsConfig();
      });
    };

    buildSceneSelect("Idle (Main Menu)", "idle");
    buildSceneSelect("Singing (Playing)", "singing");
    buildSceneSelect("Score Screen", "score");

    new Html("div")
      .classOn("stream-section-title")
      .styleJs({ marginTop: "0.25rem" })
      .text("BROWSER OVERLAY SOURCES")
      .appendTo(rightCol);

    const port = this.ctx.state.actualPort || 9864;
    const lyricsUrl = `http://127.0.0.1:${port}/overlay/lyrics`;
    const setlistUrl = `http://127.0.0.1:${port}/overlay/setlist`;

    const buildOverlayCard = (title, url) => {
      const row = new Html("div")
        .classOn("stream-overlay-row")
        .appendTo(rightCol);
      const textGroup = new Html("div")
        .classOn("stream-overlay-text-group")
        .appendTo(row);
      new Html("span")
        .classOn("stream-overlay-name")
        .text(title)
        .appendTo(textGroup);
      new Html("span")
        .classOn("stream-overlay-url")
        .text(url)
        .appendTo(textGroup);

      const copyBtn = new Html("button")
        .classOn("stream-key-action-btn", "stream-overlay-copy-btn")
        .text("COPY")
        .on("click", async () => {
          try {
            await navigator.clipboard.writeText(url);
            copyBtn.text("COPIED!");
            setTimeout(() => copyBtn.text("COPY"), 2000);
          } catch {}
        })
        .appendTo(row);
    };

    buildOverlayCard("Live Lyrics", lyricsUrl);
    buildOverlayCard("Queue & Setlist", setlistUrl);

    const btnRow = new Html("div").classOn("stream-btn-row").appendTo(rightCol);

    new Html("button")
      .classOn("session-btn")
      .text("CLOSE")
      .on("click", () => {
        this.modalView = "selection";
        this.render();
      })
      .appendTo(btnRow);
  }

  /**
   * Direct RTMP Broadcast View.
   */
  renderDirectView() {
    if (this.ctx.state.isSessionActive) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Streaming is disabled during an active Session.",
        3000,
      );
      return;
    }
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();

    new Html("h1").text("DIRECT RTMP BROADCAST").appendTo(dom.streamHeader);
    new Html("p")
      .text("Stream live karaoke performances.")
      .appendTo(dom.streamHeader);

    const contentArea = new Html("div")
      .classOn("stream-content-area")
      .styleJs({ padding: "0" })
      .appendTo(dom.streamContentArea);

    const leftCol = new Html("div").classOn("stream-col").appendTo(contentArea);
    const rightCol = new Html("div")
      .classOn("stream-col")
      .appendTo(contentArea);

    new Html("div")
      .classOn("stream-section-title")
      .text("INGEST CONFIGURATION")
      .appendTo(leftCol);

    const urlGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(leftCol);

    new Html("label")
      .classOn("stream-form-label")
      .text("RTMP Server URL")
      .appendTo(urlGroup);

    const urlInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: "text",
        placeholder: "rtmp://...",
        value: this.rtmpUrl,
      })
      .appendTo(urlGroup);

    if (this.isStreaming) urlInput.elm.disabled = true;

    urlInput.on("input", () => {
      this.rtmpUrl = urlInput.getValue().trim();
    });

    const keyGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(leftCol);

    new Html("label")
      .classOn("stream-form-label")
      .text("Stream Key")
      .appendTo(keyGroup);

    const keyWrapper = new Html("div")
      .classOn("stream-input-wrapper")
      .styleJs({
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "center",
      })
      .appendTo(keyGroup);

    const keyInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: this.isKeyVisible ? "text" : "password",
        placeholder: "Paste stream key here...",
        value: this.streamKey,
      })
      .appendTo(keyWrapper);

    if (this.isStreaming) keyInput.elm.disabled = true;

    keyInput.on("input", () => {
      this.streamKey = keyInput.getValue().trim();
    });

    const keyActions = new Html("div")
      .classOn("stream-key-actions")
      .appendTo(keyWrapper);

    const pasteKeyBtn = new Html("button")
      .classOn("stream-key-action-btn")
      .text("PASTE")
      .appendTo(keyActions);

    pasteKeyBtn.on("click", async (e) => {
      e.stopPropagation();
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.streamKey = text.trim();
          keyInput.elm.value = this.streamKey;
          this.ctx.modules.infoBar.showTemp(
            "STREAM",
            "Stream key pasted.",
            2000,
          );
        }
      } catch (err) {
        console.error("[STREAM] Paste error:", err);
      }
    });

    const toggleKeyBtn = new Html("button")
      .classOn("stream-key-action-btn")
      .text(this.isKeyVisible ? "HIDE" : "SHOW")
      .appendTo(keyActions);

    toggleKeyBtn.on("click", (e) => {
      e.stopPropagation();
      this.isKeyVisible = !this.isKeyVisible;
      keyInput.attr({ type: this.isKeyVisible ? "text" : "password" });
      toggleKeyBtn.text(this.isKeyVisible ? "HIDE" : "SHOW");
    });

    new Html("div")
      .classOn("stream-section-title")
      .styleJs({ marginTop: "0.5rem" })
      .text("STREAM STATUS")
      .appendTo(leftCol);

    const statsGrid = new Html("div")
      .classOn("stream-stats-grid")
      .appendTo(leftCol);

    const addStat = (id, label, initialVal) => {
      const item = new Html("div")
        .classOn("stream-stat-item")
        .appendTo(statsGrid);
      new Html("span").classOn("stream-stat-label").text(label).appendTo(item);
      this.statEls[id] = new Html("span")
        .classOn("stream-stat-value")
        .text(initialVal)
        .appendTo(item);
    };

    addStat("health", "Health", this.isStreaming ? "Initializing" : "Offline");
    addStat("duration", "Time Live", "00:00");
    addStat("bitrate", "Bitrate", "0 kbps");
    addStat("fps", "Framerate", "0 fps");
    addStat("drops", "Dropped", "0");
    addStat("data", "Transferred", "0.0 MB");

    const meter = new Html("div")
      .classOn("stream-health-meter")
      .appendTo(statsGrid);
    this.statEls.healthBar = new Html("div")
      .classOn("stream-health-bar")
      .appendTo(meter);

    new Html("div")
      .classOn("stream-section-title")
      .text("BITRATE")
      .appendTo(rightCol);

    const bitrateRow = new Html("div")
      .classOn("stream-bitrate-row")
      .appendTo(rightCol);

    const bitrates = [
      { label: "2.5 Mbps", value: 2500000 },
      { label: "3.5 Mbps", value: 3500000 },
      { label: "6.0 Mbps", value: 6000000 },
    ];

    bitrates.forEach((b) => {
      const bChip = new Html("div")
        .classOn("stream-bitrate-chip")
        .attr({ tabindex: "0" })
        .text(b.label)
        .appendTo(bitrateRow);

      if (this.videoBitrate === b.value) bChip.classOn("active");

      bChip.on("click", () => {
        if (this.isStreaming) return;
        this.videoBitrate = b.value;
        this.renderDirectView();
      });
    });

    new Html("div")
      .classOn("stream-section-title")
      .styleJs({ marginTop: "0.5rem" })
      .text("BROADCAST INFORMATION")
      .appendTo(rightCol);

    const infoCard = new Html("div")
      .classOn("stream-info-card")
      .appendTo(rightCol);

    infoCard.html(`
      <strong>Broadcasting Notes:</strong><br>
      • Ensure your RTMP ingest URL points to your nearest streaming server to minimize latency.<br>
      • Live streaming cannot be activated during an active Sessions room due to privacy reasons.<br>
      • <strong>Be sure to take the Mic Latency test in the Setup!</strong>
    `);

    const btnRow = new Html("div").classOn("stream-btn-row").appendTo(rightCol);

    new Html("button")
      .classOn("session-btn")
      .text("CLOSE")
      .on("click", () => {
        if (this.isStreaming) {
          this.toggleStreamModal(false);
        } else {
          this.modalView = "selection";
          this.render();
        }
      })
      .appendTo(btnRow);

    new Html("button")
      .classOn("session-btn", this.isStreaming ? "danger" : "primary")
      .text(this.isStreaming ? "STOP STREAM" : "START STREAM")
      .on("click", async () => {
        if (this.isStreaming) {
          await this.stopStream();
          this.renderDirectView();
        } else {
          this.saveConfig();
          const ok = await this.startStream();
          if (ok) this.renderDirectView();
        }
      })
      .appendTo(btnRow);

    this.updateStatsUI();
  }

  saveConfig() {
    window.config?.setItem?.("streamConfig", {
      rtmpUrl: this.rtmpUrl,
      streamKey: this.streamKey,
      videoBitrate: this.videoBitrate,
    });
  }

  saveObsConfig(enabledOverride = null) {
    const currentStored = this.ctx.config?.obsConfig || {};
    const isEnabled =
      enabledOverride !== null
        ? enabledOverride
        : (currentStored.enabled ?? false);

    const newCfg = {
      host: this.obsHost,
      port: this.obsPort,
      password: this.obsPassword,
      autoReconnect: this.obsAutoReconnect,
      enabled: isEnabled,
      scenes: this.obsScenesConfig,
    };

    this.ctx.config.obsConfig = newCfg;
    window.config?.setItem?.("obsConfig", newCfg);
  }

  /**
   * Starts broadcasting via FFmpeg.
   */
  async startStream() {
    if (this.isStreaming) return false;

    if (this.ctx.state.isSessionActive) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Live streaming is not allowed during an active Session.",
        4000,
      );
      return false;
    }

    if (!this.rtmpUrl) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Please provide a valid RTMP server URL.",
        3000,
      );
      return false;
    }

    const stream = this.ctx.modules.recorder.getBroadcastStream();
    if (!stream) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "No active audio/video stream found.",
        3000,
      );
      return false;
    }

    const res = await window.desktopIntegration.ipc.invoke("stream-start", {
      rtmpUrl: this.rtmpUrl,
      streamKey: this.streamKey,
      videoBitrate: this.videoBitrate,
    });

    if (!res.success) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        `Stream error: ${res.reason || res.error}`,
        4000,
      );
      return false;
    }

    const videoMimes = [
      "video/webm; codecs=h264,opus",
      "video/webm; codecs=h264",
      "video/webm; codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType =
      videoMimes.find((m) => MediaRecorder.isTypeSupported(m)) || "";

    try {
      this.streamRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: this.videoBitrate,
        audioBitsPerSecond: 192000,
      });

      let chunkQueue = Promise.resolve();

      this.totalBytesSent = 0;
      this.currentBitrateKbps = 0;
      this.lastChunkTime = Date.now();

      this.streamRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const now = Date.now();
          const deltaSec = (now - (this.lastChunkTime || now)) / 1000 || 1;
          this.lastChunkTime = now;
          this.totalBytesSent += e.data.size;
          this.currentBitrateKbps = Math.round(
            (e.data.size * 8) / (deltaSec * 1000),
          );

          chunkQueue = chunkQueue
            .then(async () => {
              const buffer = await e.data.arrayBuffer();
              window.desktopIntegration.ipc.send("stream-chunk", buffer);
            })
            .catch((err) => console.error("[STREAM] Queue error:", err));
        }
      };

      this.streamRecorder.start(1000);
      this.isStreaming = true;
      this.streamStartTime = Date.now();

      if (this.statsTimer) clearInterval(this.statsTimer);
      this.statsTimer = setInterval(() => this.updateStatsUI(), 1000);

      this.ctx.modules.dialog(
        new Html("div").classOn("temp-dialog-text").text("STREAM STARTED"),
        2000,
      );
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Broadcasting live to RTMP...",
        3000,
      );
      return true;
    } catch (err) {
      console.error("[STREAM] Failed to start stream recorder:", err);
      await window.desktopIntegration.ipc.invoke("stream-stop");
      this.isStreaming = false;
      return false;
    }
  }

  /**
   * Updates telemetry labels.
   */
  updateStatsUI() {
    if (!this.statEls.health) return;

    if (!this.isStreaming) {
      this.statEls.health.text("Offline").elm.className = "stream-stat-value";
      this.statEls.duration.text("00:00");
      this.statEls.bitrate.text("0 kbps");
      this.statEls.fps.text("0 fps");
      this.statEls.drops.text("0");
      this.statEls.data.text("0.0 MB");
      this.statEls.healthBar.styleJs({ width: "0%", backgroundColor: "#444" });
      return;
    }

    const elapsed = this.streamStartTime
      ? Math.floor((Date.now() - this.streamStartTime) / 1000)
      : 0;
    const mins = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const secs = (elapsed % 60).toString().padStart(2, "0");
    this.statEls.duration.text(`${mins}:${secs}`);

    const s = this.latestStats;
    let health = "excellent";
    if (s && s.health) {
      health = s.health;
    } else if (elapsed < 3) {
      health = "connecting";
    }

    const healthLabels = {
      connecting: "Connecting",
      excellent: "Excellent",
      good: "Good",
      poor: "Poor",
    };

    this.statEls.health.text(
      healthLabels[health] || health.toUpperCase(),
    ).elm.className = `stream-stat-value health-${health}`;

    if (s && s.bitrate && s.bitrate !== "N/A" && s.bitrate !== "0kbits/s") {
      this.statEls.bitrate.text(s.bitrate.replace("kbits/s", " kbps"));
    } else if (this.currentBitrateKbps > 0) {
      this.statEls.bitrate.text(`${this.currentBitrateKbps} kbps`);
    } else {
      this.statEls.bitrate.text(`${Math.round(this.videoBitrate / 1000)} kbps`);
    }

    this.statEls.fps.text(`${s ? Math.round(s.fps) : 30} fps`);
    this.statEls.drops.text(`${s ? s.dropFrames : 0}`);

    const totalBytes = s && s.totalSize > 0 ? s.totalSize : this.totalBytesSent;
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    this.statEls.data.text(`${mb} MB`);

    const healthConfig = {
      connecting: { width: "40%", color: "#ffd700" },
      excellent: { width: "100%", color: "#55ff55" },
      good: { width: "70%", color: "#ffd700" },
      poor: { width: "30%", color: "#ff5555" },
    }[health] || { width: "50%", color: "#89cff0" };

    this.statEls.healthBar.styleJs({
      width: healthConfig.width,
      backgroundColor: healthConfig.color,
    });
  }

  /**
   * Stops the stream and tears down FFmpeg.
   */
  async stopStream() {
    if (!this.isStreaming) return;

    if (this.streamRecorder && this.streamRecorder.state !== "inactive") {
      this.streamRecorder.stop();
      this.streamRecorder = null;
    }

    this.isStreaming = false;
    this.streamStartTime = null;
    this.latestStats = null;
    this.totalBytesSent = 0;
    this.currentBitrateKbps = 0;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    if (this.ctx.modules.recorder) {
      this.ctx.modules.recorder.stopBroadcastStream();
    }

    await window.desktopIntegration.ipc.invoke("stream-stop");

    this.ctx.modules.dialog(
      new Html("div").classOn("temp-dialog-text").text("STREAM STOPPED"),
      2000,
    );
    this.ctx.modules.infoBar.showTemp("STREAM", "Stream closed.", 3000);
  }

  handleKeyDown(e) {
    const dom = this.ctx.dom;

    if (e.key === "Escape") {
      e.preventDefault();
      if (this.modalView !== "selection" && !this.isStreaming) {
        this.modalView = "selection";
        this.render();
      } else {
        this.toggleStreamModal(false);
      }
      return;
    }

    const modalEl = dom.streamContentArea?.elm;
    if (!modalEl) return;

    const focusables = Array.from(
      modalEl.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), .session-tile, .stream-bitrate-chip",
      ),
    );
    if (!focusables.length) return;

    const activeEl = document.activeElement;
    const currentIndex = focusables.indexOf(activeEl);
    const isInput = activeEl && activeEl.tagName === "INPUT";
    const isSelect = activeEl && activeEl.tagName === "SELECT";
    const isCustomClickable =
      activeEl &&
      (activeEl.classList.contains("session-tile") ||
        activeEl.classList.contains("stream-bitrate-chip"));

    if (e.key === "Enter") {
      if (isCustomClickable) {
        e.preventDefault();
        activeEl.click();
      } else if (isInput && activeEl.type === "checkbox") {
        e.preventDefault();
        activeEl.click();
      } else if (isInput) {
        e.preventDefault();
        const primaryBtn = modalEl.querySelector(
          ".session-btn.primary, .session-btn.danger",
        );
        if (primaryBtn) primaryBtn.click();
      }
      return;
    }

    const isTextInput =
      isInput && !["checkbox", "radio", "button"].includes(activeEl.type);
    if (isTextInput && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }

    if (isSelect && ["ArrowUp", "ArrowDown"].includes(e.key)) {
      return;
    }
    if (["ArrowDown", "ArrowRight", "Tab"].includes(e.key)) {
      e.preventDefault();
      this.playNavSfx("nav");
      let nextIndex = currentIndex + 1;
      if (nextIndex >= focusables.length || currentIndex === -1) nextIndex = 0;
      focusables[nextIndex].focus();
    } else if (
      ["ArrowUp", "ArrowLeft"].includes(e.key) ||
      (e.key === "Tab" && e.shiftKey)
    ) {
      e.preventDefault();
      this.playNavSfx("nav");
      let nextIndex = currentIndex - 1;
      if (nextIndex < 0) nextIndex = focusables.length - 1;
      focusables[nextIndex].focus();
    }
  }

  destroy() {
    if (this.isStreaming) {
      this.stopStream();
    }
  }
}
