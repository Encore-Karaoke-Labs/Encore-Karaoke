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
    this.streamInterval = null;

    const cfg = this.ctx.config?.streamConfig || {};
    this.rtmpUrl = cfg.rtmpUrl || "";
    this.streamKey = cfg.streamKey || "";
    this.videoBitrate = cfg.videoBitrate || 3500000;
    this.isKeyVisible = false;

    this.latestStats = null;
    this.statEls = {};
    this.statsTimer = null;
    this.totalBytesSent = 0;
    this.currentBitrateKbps = 0;
    this.lastChunkTime = null;

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
  }

  /**
   * Opens or closes the RTMP Live Stream Modal.
   */
  toggleStreamModal(forceState = null) {
    const state = this.ctx.state;
    const shouldOpen =
      forceState !== null ? forceState : !state.isStreamModalOpen;

    if (shouldOpen && state.isSessionActive) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Live streaming is not allowed during an active Session.",
        4000,
      );
      return;
    }

    state.isStreamModalOpen = shouldOpen;

    if (shouldOpen) {
      this.ctx.dom.streamModal.classOff("hidden");
      this.renderStreamModal();
    } else {
      this.ctx.dom.streamModal.classOn("hidden");
    }
  }

  /**
   * Renders the RTMP Configuration Modal UI.
   */
  renderStreamModal() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();

    new Html("h1").text("LIVE BROADCAST").appendTo(dom.streamHeader);
    new Html("p")
      .text("Stream live karaoke performances.")
      .appendTo(dom.streamHeader);

    const leftCol = new Html("div")
      .classOn("stream-col")
      .appendTo(dom.streamContentArea);
    const rightCol = new Html("div")
      .classOn("stream-col")
      .appendTo(dom.streamContentArea);

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

    urlInput.on("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") urlInput.elm.blur();
    });

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

    keyInput.on("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") keyInput.elm.blur();
    });

    keyInput.on("input", () => {
      this.streamKey = keyInput.getValue().trim();
    });

    const keyActions = new Html("div")
      .classOn("stream-key-actions")
      .styleJs({
        position: "absolute",
        right: "10px",
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        zIndex: "10",
      })
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
        .text(b.label)
        .appendTo(bitrateRow);

      if (this.videoBitrate === b.value) bChip.classOn("active");

      bChip.on("click", () => {
        if (this.isStreaming) return;
        this.videoBitrate = b.value;
        this.renderStreamModal();
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
      .on("click", () => this.toggleStreamModal(false))
      .appendTo(btnRow);

    new Html("button")
      .classOn("session-btn", this.isStreaming ? "danger" : "primary")
      .text(this.isStreaming ? "STOP STREAM" : "START STREAM")
      .on("click", async () => {
        if (this.isStreaming) {
          await this.stopStream();
          this.renderStreamModal();
        } else {
          this.saveConfig();
          const ok = await this.startStream();
          if (ok) this.renderStreamModal();
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

  /**
   * Starts broadcasting by hooking the live canvas & mixed audio to FFmpeg.
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
   * Updates the telemetry labels in-place without rebuilding the DOM.
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
    if (e.key === "Escape") {
      e.preventDefault();
      this.toggleStreamModal(false);
    }
  }

  destroy() {
    if (this.isStreaming) {
      this.stopStream();
    }
  }
}
