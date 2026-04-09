import Html from "/libs/html.js";

/**
 * RecorderModule - Handles video recording of karaoke performances with real-time UI overlay.
 * Records video from BGV player with synchronized audio from the Forte audio engine.
 * Supports both LRC (lyrics with romanization) and MIDI (with furigana) rendering modes.
 * @class
 */
export class RecorderModule {
  /**
   * @param {Object} forteSvc - Forte audio service for recording stream
   * @param {Object} bgvModule - BGV player module for video source
   * @param {Object} infoBarModule - Info bar module for status messages
   * @param {Function} dialogShow - Dialog display function for notifications
   */
  constructor(forteSvc, bgvModule, infoBarModule, dialogShow) {
    this.forteSvc = forteSvc;
    this.bgvPlayer = bgvModule;
    this.infoBar = infoBarModule;
    this.dialogShow = dialogShow;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.canvas = null;
    this.ctx = null;
    this.animationFrameId = null;
    this.currentSongInfo = null;
    this.uiRefs = null;
    this.parentContainer = null;
    this.currentStream = null;
    this.outputResolution = { width: 1280, height: 720 }; // 720p 30fps
    console.log("[RECORDER] Video Recording feature initialized.");
  }

  /**
   * Mount the recorder to a parent container element.
   * @param {HTMLElement} container - Parent container for internal canvas element
   */
  mount(container) {
    this.parentContainer = container;
  }

  /**
   * Initialize the hidden canvas element for frame capture.
   * @private
   */
  _initCanvas() {
    if (this.canvas) return;

    this.canvas = new Html("canvas")
      .attr({
        width: this.outputResolution.width,
        height: this.outputResolution.height,
      })
      .styleJs({ display: "none" })
      .appendTo(this.parentContainer).elm;

    this.ctx = this.canvas.getContext("2d", { alpha: false });
  }

  /**
   * Set UI references for overlay rendering.
   * @param {Object} refs - UI element references
   */
  setUiRefs(refs) {
    this.uiRefs = refs;
  }

  /**
   * Set current song metadata for overlay display.
   * @param {Object} song - Song object with title and artist
   */
  setSongInfo(song) {
    if (song) this.currentSongInfo = { title: song.title, artist: song.artist };
  }

  /**
   * Clear current song metadata.
   */
  clearSongInfo() {
    this.currentSongInfo = null;
  }

  /**
   * Toggle recording state (start if stopped, stop if recording).
   */
  toggle() {
    this.isRecording ? this.stop() : this.start();
  }

  /**
   * Start video recording with audio and UI overlay.
   * Combines video from canvas capture with audio from Forte service.
   * Initializes MediaRecorder and starts frame drawing loop.
   */
  start() {
    if (this.isRecording || !this.forteSvc || !this.bgvPlayer) return;

    this._initCanvas();

    let audioStream;

    try {
      audioStream = this.forteSvc.getRecordingAudioStream();
      if (!audioStream || audioStream.getAudioTracks().length === 0) {
        this.infoBar.showTemp(
          "RECORDING",
          "Error: No audio stream found.",
          4000,
        );
        return;
      }
    } catch (e) {
      this.infoBar.showTemp("RECORDING", e, 4000);
      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
        2000,
      );
      return;
    }

    const videoStream = this.canvas.captureStream(30);

    // Combine video and audio streams. Audio track from Forte must NOT be stopped later
    // as stopping it would kill audio output for the rest of the app session.
    this.currentStream = new MediaStream([
      videoStream.getVideoTracks()[0],
      audioStream.getAudioTracks()[0],
    ]);

    this.recordedChunks = [];
    try {
      this.mediaRecorder = new MediaRecorder(this.currentStream, {
        mimeType: "video/webm; codecs=vp9,opus",
        videoBitsPerSecond: 2500000,
      });
      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("RECORD STARTED"),
        2000,
      );
    } catch (e) {
      console.error("Failed to create MediaRecorder:", e);
      this.infoBar.showTemp(
        "RECORDING",
        "Error: Could not start recorder.",
        4000,
      );
      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
        2000,
      );
      return;
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recordedChunks.push(event.data);
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: "video/webm" });
      this.recordedChunks = [];

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      document.body.appendChild(a);
      a.style = "display: none";
      a.href = url;
      a.download = `Encore-Recording-${new Date()
        .toISOString()
        .replace(/:/g, "-")}.webm`;
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      this.infoBar.showTemp(
        "RECORDING",
        "Recording saved to Downloads folder.",
        5000,
      );
    };

    this.mediaRecorder.start();
    this.isRecording = true;
    this.drawFrame();
    this.infoBar.showDefault();
  }

  /**
   * Stop video recording and clean up resources.
   * Preserves audio tracks to prevent disrupting Forte audio engine.
   */
  stop() {
    if (!this.isRecording || !this.mediaRecorder) return;

    this.mediaRecorder.stop();
    this.isRecording = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => {
        // Only stop video tracks (canvas capture). Do NOT stop audio tracks,
        // as they belong to the persistent Forte engine. Stopping audio kills
        // audio output for the rest of the app session.
        if (track.kind === "video") {
          track.stop();
        }
      });
      this.currentStream = null;
    }

    this.mediaRecorder = null;
    this.infoBar.showDefault();
    this.dialogShow(
      new Html("div").classOn("temp-dialog-text").text("RECORD STOPPED"),
      2000,
    );
  }

  /**
   * Draw a frame of the recording, compositing BGV video, lyrics, and metadata overlay.
   * Supports both LRC (with romanization) and MIDI (with furigana) rendering.
   * Renders score HUD and song info when available. Loops via requestAnimationFrame.
   */
  drawFrame() {
    if (!this.isRecording) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.clearRect(0, 0, w, h);

    const sourceVideo = this.bgvPlayer.videoElement;

    if (sourceVideo && sourceVideo.readyState >= 2 && !sourceVideo.paused) {
      this.ctx.drawImage(sourceVideo, 0, 0, w, h);
    } else {
      this.ctx.fillStyle = "black";
      this.ctx.fillRect(0, 0, w, h);
    }

    if (this.uiRefs && !this.uiRefs.playerUi.elm.classList.contains("hidden")) {
      const gradient = this.ctx.createLinearGradient(0, h * 0.5, 0, h);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0.9)");
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, h * 0.5, w, h * 0.5);

      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "bottom";

      const isMidi =
        this.uiRefs.midiContainer &&
        this.uiRefs.midiContainer.elm.style.display === "flex";

      if (isMidi) {
        const line1Y = h * 0.81;
        const line2Y = h * 0.94;

        this.drawMidiLine(this.uiRefs.midiLineDisplay1.elm, line1Y, h);
        this.drawMidiLine(this.uiRefs.midiLineDisplay2.elm, line2Y, h);
      } else {
        const line1BaseY = h * 0.85;
        const line2BaseY = h * 0.93;

        const line1HasRomanized = this.uiRefs.lrcLineDisplay1.elm.querySelector(
          ".lyric-line-romanized",
        )?.textContent;
        const line2HasRomanized = this.uiRefs.lrcLineDisplay2.elm.querySelector(
          ".lyric-line-romanized",
        )?.textContent;

        const romOffset = h * 0.04;

        const line1Y = line1HasRomanized
          ? line2HasRomanized
            ? line1BaseY - romOffset * 2
            : line1BaseY - romOffset
          : line1BaseY;
        const line2Y = line2HasRomanized ? line2BaseY - romOffset : line2BaseY;

        this.drawLyricLine(this.uiRefs.lrcLineDisplay1.elm, line1Y, h);
        this.drawLyricLine(this.uiRefs.lrcLineDisplay2.elm, line2Y, h);
      }

      if (
        this.uiRefs.scoreDisplay.elm.parentElement.classList.contains("visible")
      ) {
        const bigFont = `${Math.floor(h * 0.04)}px`;
        const smallFont = `${Math.floor(h * 0.015)}px`;

        this.ctx.font = `bold ${bigFont} Rajdhani, sans-serif`;
        this.ctx.fillStyle = "#89CFF0";
        this.ctx.textAlign = "right";
        this.ctx.fillText(this.uiRefs.scoreDisplay.getText(), w - 50, h - 80);
        this.ctx.font = `bold ${smallFont} Rajdhani, sans-serif`;
        this.ctx.fillStyle = "#FFD700";
        this.ctx.fillText("SCORE", w - 150, h - 85);
      }
    }

    if (this.currentSongInfo) {
      const x = 50,
        y = 50,
        maxWidth = w * 0.4,
        padding = 25;

      const boxHeight = h * 0.11;

      this.ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      this.ctx.beginPath();
      this.ctx.roundRect(
        x - padding,
        y - padding,
        maxWidth + padding * 2,
        boxHeight + padding,
        15,
      );
      this.ctx.fill();

      const titleSize = `${Math.floor(h * 0.044)}px`;
      const artistSize = `${Math.floor(h * 0.03)}px`;

      this.ctx.font = `bold ${titleSize} Rajdhani, sans-serif`;
      this.ctx.fillStyle = "white";
      this.ctx.textAlign = "left";
      this.ctx.textBaseline = "top";
      this.ctx.shadowColor = "black";
      this.ctx.shadowBlur = 5;
      this.ctx.fillText(this.currentSongInfo.title, x, y, maxWidth);

      this.ctx.font = `${artistSize} Rajdhani, sans-serif`;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      this.ctx.fillText(this.currentSongInfo.artist, x, y + h * 0.06, maxWidth);
      this.ctx.shadowBlur = 0;
    }

    this.animationFrameId = requestAnimationFrame(() => this.drawFrame());
  }

  /**
   * Render a lyric line with optional romanized text.
   * @param {HTMLElement} element - Container with .lyric-line-original and .lyric-line-romanized
   * @param {number} y - Vertical baseline position
   * @param {number} h - Canvas height (used for scaling)
   */
  drawLyricLine(element, y, h) {
    const originalEl = element.querySelector(".lyric-line-original");
    const romanizedEl = element.querySelector(".lyric-line-romanized");
    if (!originalEl || !originalEl.textContent) return;

    const isActive = element.classList.contains("active");
    const defaultOpacity = element.classList.contains("next") ? 0.5 : 0.4;

    const mainFontSize = `${Math.floor(h * 0.066)}px`;
    const subFontSize = `${Math.floor(h * 0.022)}px`;

    this.ctx.font = `bold ${mainFontSize} Rajdhani, sans-serif`;
    this.ctx.fillStyle = isActive
      ? "#FFFFFF"
      : `rgba(255, 255, 255, ${defaultOpacity})`;
    if (isActive) {
      this.ctx.strokeStyle = "#010141";
      this.ctx.lineWidth = h * 0.01;
      this.ctx.lineJoin = "round";
      this.ctx.strokeText(originalEl.textContent, this.canvas.width / 2, y);
    }
    this.ctx.fillText(originalEl.textContent, this.canvas.width / 2, y);

    if (romanizedEl && romanizedEl.textContent) {
      this.ctx.font = `500 ${subFontSize} Rajdhani, sans-serif`;
      this.ctx.fillStyle = isActive
        ? "#FFFFFF"
        : `rgba(255, 255, 255, ${defaultOpacity + 0.1})`;
      this.ctx.fillText(
        romanizedEl.textContent,
        this.canvas.width / 2,
        y + h * 0.04,
      );
    }
  }

  /**
   * Render a MIDI lyric line with syllables, romanization, and furigana.
   * Calculates layout to center syllable blocks and applies active state styling.
   * @param {HTMLElement} element - Container with .lyric-syllable-container children
   * @param {number} y - Vertical baseline position for original text
   * @param {number} h - Canvas height (used for scaling)
   */
  drawMidiLine(element, y, h) {
    const syllableEls = Array.from(
      element.querySelectorAll(".lyric-syllable-container"),
    );
    if (syllableEls.length === 0) return;

    const isLineActive = element.classList.contains("active");
    const isLineNext = element.classList.contains("next");

    const mainFontSize = `${Math.floor(h * 0.066)}px`;
    const subFontSize = `${Math.floor(h * 0.022)}px`;

    // Calculate total layout width for centered rendering
    const layoutSyllables = [];
    let totalWidth = 0;
    const padding = h * 0.008;

    for (const container of syllableEls) {
      // Remove NBSP characters that HTML elements use as placeholders
      const origText =
        container
          .querySelector(".lyric-syllable-original")
          ?.textContent.replace(/\u00A0/g, "")
          .trim() || "";
      const romText =
        container
          .querySelector(".lyric-syllable-romanized")
          ?.textContent.replace(/\u00A0/g, "")
          .trim() || "";
      const furiText =
        container
          .querySelector(".lyric-syllable-furigana")
          ?.textContent.replace(/\u00A0/g, "")
          .trim() || "";

      const isActive = container.classList.contains("active");

      // Measure text dimensions
      this.ctx.font = `bold ${mainFontSize} Rajdhani, sans-serif`;
      const origW = origText ? this.ctx.measureText(origText).width : 0;

      this.ctx.font = `500 ${subFontSize} Rajdhani, sans-serif`;
      const romW = romText ? this.ctx.measureText(romText).width : 0;
      const furiW = furiText ? this.ctx.measureText(furiText).width : 0;

      const blockWidth = Math.max(origW, romW, furiW) + padding;

      layoutSyllables.push({
        origText,
        romText,
        furiText,
        isActive,
        width: blockWidth,
      });
      totalWidth += blockWidth;
    }

    // Render syllables starting from calculated centered position
    let currentX = (this.canvas.width - totalWidth) / 2;

    for (const s of layoutSyllables) {
      const centerX = currentX + s.width / 2;

      let drawColor;
      if (s.isActive) {
        drawColor = "#FFFFFF";
      } else if (isLineNext) {
        drawColor = "rgba(255, 255, 255, 0.5)";
      } else if (isLineActive) {
        drawColor = "rgba(255, 255, 255, 0.8)";
      } else {
        drawColor = "rgba(255, 255, 255, 0.5)";
      }

      // Romanized text (below)
      if (s.romText) {
        this.ctx.font = `500 ${subFontSize} Rajdhani, sans-serif`;
        this.ctx.fillStyle = drawColor;
        this.ctx.fillText(s.romText, centerX, y + h * 0.04);
      }

      // Furigana text (above)
      if (s.furiText) {
        this.ctx.font = `500 ${subFontSize} Rajdhani, sans-serif`;
        this.ctx.fillStyle = drawColor;
        this.ctx.fillText(s.furiText, centerX, y - h * 0.08);
      }

      // Original text with highlight stroke when active
      if (s.origText) {
        this.ctx.font = `bold ${mainFontSize} Rajdhani, sans-serif`;
        this.ctx.fillStyle = drawColor;

        if (s.isActive) {
          this.ctx.strokeStyle = "#010141";
          this.ctx.lineWidth = h * 0.01;
          this.ctx.lineJoin = "round";
          this.ctx.strokeText(s.origText, centerX, y);
        }

        this.ctx.fillText(s.origText, centerX, y);
      }

      currentX += s.width;
    }
  }
}
