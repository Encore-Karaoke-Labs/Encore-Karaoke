import Html from "/libs/html.js";

/**
 * Utility function to encode an AudioBuffer into a standard 16-bit PCM WAV ArrayBuffer.
 *
 * @param {AudioBuffer} audioBuffer - The decoded audio data.
 * @returns {Promise<ArrayBuffer>} The formatted WAV file as an ArrayBuffer.
 */
async function audioBufferToWavBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (view, offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // Write standard WAV Header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Fast write for PCM Data mapping using Int16Array (Native Little Endian)
  const offset = 44;
  const int16View = new Int16Array(arrayBuffer, offset);

  if (numChannels === 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0, j = 0; i < audioBuffer.length; i++, j += 2) {
      let sL = Math.max(-1, Math.min(1, left[i]));
      let sR = Math.max(-1, Math.min(1, right[i]));
      int16View[j] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;
      int16View[j + 1] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
    }
  } else {
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0, j = 0; i < audioBuffer.length; i++, j++) {
      let sample = Math.max(-1, Math.min(1, channel[i]));
      int16View[j] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
  }

  return arrayBuffer;
}

/**
 * Helper to process a recorded Blob (e.g., webm/opus) into a standard WAV array buffer.
 * It uses the browser's native AudioContext to decode the compressed audio.
 *
 * @param {Blob} blob - The recorded compressed audio blob.
 * @returns {Promise<ArrayBuffer|null>} The WAV ArrayBuffer, or null if empty/failed.
 */
async function processAudioBlobToWav(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return null;

    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await actx.decodeAudioData(arrayBuffer);
    const wavBuffer = await audioBufferToWavBuffer(audioBuffer);
    await actx.close();

    return wavBuffer;
  } catch (e) {
    console.warn("[RECORDER] Audio decoding skipped for empty/invalid stem", e);
    return null;
  }
}

/**
 * RecorderModule - Handles video recording of karaoke performances inside Encore
 * with real-time UI overlay and multi-track audio stem exporting.
 * @class
 */
export class RecorderModule {
  /**
   * @param {Object} forteSvc - The Forte Sound Engine Service.
   * @param {Object} bgvModule - The Background Video Player module.
   * @param {Object} infoBarModule - The UI Info bar module for notifications.
   * @param {Function} dialogShow - Function to trigger on-screen text dialogs.
   */
  constructor(forteSvc, bgvModule, infoBarModule, dialogShow) {
    this.forteSvc = forteSvc;
    this.bgvPlayer = bgvModule;
    this.infoBar = infoBarModule;
    this.dialogShow = dialogShow;

    this.isRecording = false;

    this.mediaRecorder = null;
    this.micRecorder = null;
    this.musicRecorder = null;

    this.recordedChunks = [];
    this.micChunks = [];
    this.musicChunks = [];

    this.recordingStartTime = 0;
    this.recordingInterval = null;
    this.animationFrameId = null;
    this.currentSongInfo = null;
    this.uiRefs = null;
    this.parentContainer = null;
    this.currentStream = null;
    this.outputResolution = { width: 1280, height: 720 };

    this.canvas = null;
    this.ctx = null;
    this.offscreenCanvas = null;
    this.oCtx = null;

    this.lyricCaches = new WeakMap();
    this.metaCanvas = null;
    this.bgvCanvas = null;
    this.bgvCtx = null;

    this.lyricGradient = null;
    this.countdownGradient = null;

    this.bgvCurrentOpacity = 1.0;
    this.lyricOpacity = 1.0;

    this.frameCounter = 0;
    this.isInterludeVisible = false;
    this.cachedInterludeTip = "";

    console.log("[RECORDER] Video Recording feature initialized.");
  }

  /**
   * Calculates formatted elapsed recording time (MM:SS)
   * @returns {string} Formatted time string.
   */
  getRecordingTimeString() {
    if (!this.isRecording) return "00:00";
    const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const secs = (elapsed % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }

  /**
   * Mounts the recorder module to a DOM container.
   * @param {HTMLElement} container - The parent DOM container for canvas elements.
   */
  mount(container) {
    this.parentContainer = container;
  }

  /**
   * Initialize canvas elements for recording - output canvas, offscreen buffer, and BGV cache.
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

    if (typeof OffscreenCanvas !== "undefined") {
      this.offscreenCanvas = new OffscreenCanvas(
        this.outputResolution.width,
        this.outputResolution.height,
      );
    } else {
      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenCanvas.width = this.outputResolution.width;
      this.offscreenCanvas.height = this.outputResolution.height;
    }
    this.oCtx = this.offscreenCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false,
    });

    this.bgvCanvas = document.createElement("canvas");
    this.bgvCanvas.width = this.outputResolution.width;
    this.bgvCanvas.height = this.outputResolution.height;
    this.bgvCtx = this.bgvCanvas.getContext("2d", { alpha: false });
    this.bgvCtx.fillStyle = "black";
    this.bgvCtx.fillRect(0, 0, this.bgvCanvas.width, this.bgvCanvas.height);

    this._preRenderGradients();
  }

  /**
   * Pre-render gradient patterns for lyric and countdown displays.
   * @private
   */
  _preRenderGradients() {
    const w = this.outputResolution.width;
    const h = this.outputResolution.height;

    this.lyricGradient = this.oCtx.createLinearGradient(0, h * 0.4, 0, h);
    this.lyricGradient.addColorStop(0, "rgba(0,0,0,0)");
    this.lyricGradient.addColorStop(1, "rgba(0,0,0,0.9)");

    const cx = w / 2;
    const cy = h * 0.52;
    const radius = h * 0.08;
    this.countdownGradient = this.oCtx.createRadialGradient(
      cx,
      cy + radius * 0.2,
      0,
      cx,
      cy + radius * 0.2,
      radius * 1.2,
    );
    this.countdownGradient.addColorStop(0, "#f7b733");
    this.countdownGradient.addColorStop(1, "#fc4a1a");
  }

  /**
   * Sets references to UI elements for rendering.
   * @param {Object} refs - Object containing UI element references.
   */
  setUiRefs(refs) {
    this.uiRefs = refs;
  }

  /**
   * Sets the current song information and pre-renders metadata.
   * @param {Object} song - Song object with title and artist properties.
   */
  setSongInfo(song) {
    if (song) {
      this.currentSongInfo = { title: song.title, artist: song.artist };
      this._preRenderMeta();
    }
  }

  /**
   * Clears song information and associated metadata canvas.
   */
  clearSongInfo() {
    this.currentSongInfo = null;
    this.metaCanvas = null;
  }

  /**
   * Toggles recording state between active and inactive.
   */
  toggle() {
    this.isRecording ? this.stop() : this.start();
  }

  /**
   * Starts video recording along with multi-track audio mapping.
   * Initializes canvas, media recorders, and begins frame rendering.
   */
  start() {
    if (this.isRecording || !this.forteSvc || !this.bgvPlayer) return;

    this._initCanvas();
    this.bgvCurrentOpacity = 1.0;
    this.lyricOpacity = 1.0;
    this.frameCounter = 0;

    let mixAudioStream, micAudioStream, musicAudioStream;
    try {
      mixAudioStream = this.forteSvc.getRecordingAudioStream();
      micAudioStream = this.forteSvc.getMicAudioStream();
      musicAudioStream = this.forteSvc.getMusicAudioStream();

      if (!mixAudioStream || mixAudioStream.getAudioTracks().length === 0) {
        throw new Error("No primary audio stream found.");
      }
    } catch (e) {
      this.infoBar.showTemp("RECORDING", `Error: ${e.message}`, 4000);
      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
        2000,
      );
      return;
    }

    const videoStream = this.canvas.captureStream(30);

    this.currentStream = new MediaStream([
      videoStream.getVideoTracks()[0],
      mixAudioStream.getAudioTracks()[0],
    ]);

    this.recordedChunks = [];
    this.micChunks = [];
    this.musicChunks = [];

    try {
      const videoMimes = [
        "video/webm; codecs=h264,opus",
        "video/webm; codecs=h264",
        "video/webm; codecs=vp8,opus",
        "video/webm",
      ];
      const selectedVideoMime =
        videoMimes.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";

      this.mediaRecorder = new MediaRecorder(this.currentStream, {
        mimeType: selectedVideoMime,
        videoBitsPerSecond: 2500000,
      });

      const audioMimes = ["audio/webm; codecs=opus", "audio/webm", "audio/ogg"];
      const selectedAudioMime =
        audioMimes.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";

      this.micRecorder = new MediaRecorder(micAudioStream, {
        mimeType: selectedAudioMime,
      });
      this.musicRecorder = new MediaRecorder(musicAudioStream, {
        mimeType: selectedAudioMime,
      });

      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("RECORD STARTED"),
        2000,
      );
    } catch (e) {
      console.error("Failed to create MediaRecorders:", e);
      this.infoBar.showTemp(
        "RECORDING",
        "Error: Could not start recorders.",
        4000,
      );
      return;
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.micRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.micChunks.push(e.data);
    };
    this.musicRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.musicChunks.push(e.data);
    };

    const mixMime = this.mediaRecorder.mimeType;
    const micMime = this.micRecorder.mimeType;
    const musicMime = this.musicRecorder.mimeType;

    const mixPromise = new Promise((resolve) => {
      this.mediaRecorder.onstop = () =>
        resolve(new Blob(this.recordedChunks, { type: mixMime }));
    });
    const micPromise = new Promise((resolve) => {
      this.micRecorder.onstop = () =>
        resolve(new Blob(this.micChunks, { type: micMime }));
    });
    const musicPromise = new Promise((resolve) => {
      this.musicRecorder.onstop = () =>
        resolve(new Blob(this.musicChunks, { type: musicMime }));
    });

    Promise.all([mixPromise, micPromise, musicPromise]).then(
      async ([mixBlob, micBlob, musicBlob]) => {
        this.infoBar.showTemp(
          "RECORDING",
          "Processing audio stems and saving...",
          60000,
        );

        try {
          const mixVideoBuffer = await mixBlob.arrayBuffer();
          const micWavBuffer = await processAudioBlobToWav(micBlob);
          const musicWavBuffer = await processAudioBlobToWav(musicBlob);

          const songTitle = this.currentSongInfo?.title || "Unknown";

          const result = await window.desktopIntegration.ipc.invoke(
            "save-recording",
            {
              videoBuffer: mixVideoBuffer,
              micBuffer: micWavBuffer,
              musicBuffer: musicWavBuffer,
              songTitle,
            },
          );

          if (result.success) {
            this.infoBar.showTemp(
              "RECORDING",
              "Saved session to Encore Recordings!",
              5000,
            );
          } else {
            this.infoBar.showTemp(
              "RECORDING",
              "Failed to save recording.",
              5000,
            );
          }
        } catch (e) {
          console.error("Save error:", e);
          this.infoBar.showTemp(
            "RECORDING",
            "Failed to process audio stems.",
            5000,
          );
        }
      },
    );

    this.recordingStartTime = Date.now();
    if (this.recordingInterval) clearInterval(this.recordingInterval);
    this.recordingInterval = setInterval(() => {
      if (this.isRecording) this.infoBar.showDefault();
    }, 1000);

    this.mediaRecorder.start();
    this.micRecorder.start();
    this.musicRecorder.start();

    this.isRecording = true;
    this.drawFrame();
    this.infoBar.showDefault();
  }

  /**
   * Stops all active recordings, triggering the encoding and export pipeline.
   */
  stop() {
    if (!this.isRecording || !this.mediaRecorder) return;

    this.mediaRecorder.stop();
    if (this.micRecorder && this.micRecorder.state !== "inactive")
      this.micRecorder.stop();
    if (this.musicRecorder && this.musicRecorder.state !== "inactive")
      this.musicRecorder.stop();

    this.isRecording = false;

    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => {
        if (track.kind === "video") track.stop();
      });
      this.currentStream = null;
    }

    this.mediaRecorder = null;
    this.micRecorder = null;
    this.musicRecorder = null;

    this.infoBar.showDefault();
    this.dialogShow(
      new Html("div").classOn("temp-dialog-text").text("RECORD STOPPED"),
      2000,
    );
  }

  /**
   * Pre-renders metadata canvas with song title and artist.
   * @private
   */
  _preRenderMeta() {
    if (!this.currentSongInfo) return;
    const w = this.outputResolution.width;
    const h = this.outputResolution.height;

    this.metaCanvas = document.createElement("canvas");
    this.metaCanvas.width = w;
    this.metaCanvas.height = h;
    const mCtx = this.metaCanvas.getContext("2d");

    const x = 50,
      y = 50,
      maxWidth = w * 0.4,
      padding = 25;
    const boxHeight = h * 0.11;

    mCtx.fillStyle = "rgba(0, 0, 0, 0.6)";
    mCtx.beginPath();
    mCtx.roundRect(
      x - padding,
      y - padding,
      maxWidth + padding * 2,
      boxHeight + padding,
      15,
    );
    mCtx.fill();

    mCtx.font = `bold ${Math.floor(h * 0.044)}px Rajdhani, sans-serif`;
    mCtx.fillStyle = "white";
    mCtx.textAlign = "left";
    mCtx.textBaseline = "top";
    mCtx.shadowColor = "black";
    mCtx.shadowBlur = 5;
    mCtx.fillText(this.currentSongInfo.title, x, y, maxWidth);

    mCtx.font = `${Math.floor(h * 0.03)}px Rajdhani, sans-serif`;
    mCtx.fillStyle = "rgba(255, 255, 255, 0.8)";
    mCtx.shadowBlur = 0;
    mCtx.fillText(this.currentSongInfo.artist, x, y + h * 0.06, maxWidth);
  }

  /**
   * Renders a single frame to the recording canvas.
   * Handles background video, lyrics, countdown, score, and interlude overlays.
   */
  drawFrame() {
    if (!this.isRecording) return;
    const w = this.outputResolution.width;
    const h = this.outputResolution.height;

    const ctx = this.oCtx;

    const sourceVideo = this.bgvPlayer.videoElement;

    this.frameCounter++;
    if (this.frameCounter % 10 === 0) {
      const interludeEl = document.querySelector(".interlude-overlay");
      this.isInterludeVisible =
        interludeEl && interludeEl.classList.contains("visible");
      if (this.isInterludeVisible) {
        const tipEl = interludeEl.querySelector(".interlude-tip-box");
        this.cachedInterludeTip = tipEl ? tipEl.textContent : "";
      }
    }

    let targetBgvOpacity = 0;
    if (sourceVideo) {
      // Direct style property read is faster than getComputedStyle
      targetBgvOpacity = sourceVideo.style.opacity
        ? parseFloat(sourceVideo.style.opacity)
        : 1;
    }
    this.bgvCurrentOpacity +=
      (targetBgvOpacity - this.bgvCurrentOpacity) * 0.15;

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, w, h);

    if (sourceVideo && sourceVideo.readyState >= 2 && !sourceVideo.paused) {
      this.bgvCtx.drawImage(sourceVideo, 0, 0, w, h);
    }

    if (this.bgvCurrentOpacity > 0.01) {
      ctx.globalAlpha = this.bgvCurrentOpacity;
      ctx.drawImage(this.bgvCanvas, 0, 0, w, h);
      ctx.globalAlpha = 1.0;
    }

    this.lyricOpacity +=
      ((this.isInterludeVisible ? 0 : 1) - this.lyricOpacity) * 0.15;

    if (this.isInterludeVisible) {
      const iw = w * 0.6;
      const ih = h * 0.4;
      const ix = (w - iw) / 2;
      const iy = (h - ih) / 2;

      ctx.fillStyle = "rgba(10, 10, 20, 0.85)";
      ctx.beginPath();
      ctx.roundRect(ix, iy, iw, ih, 20);
      ctx.fill();

      ctx.strokeStyle = "#89CFF0";
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.font = `900 ${Math.floor(h * 0.08)}px Rajdhani, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFF";
      ctx.fillText("INTERLUDE", w / 2, iy + ih * 0.3);

      ctx.beginPath();
      ctx.moveTo(w / 2 - iw * 0.25, iy + ih * 0.45);
      ctx.lineTo(w / 2 + iw * 0.25, iy + ih * 0.45);
      ctx.strokeStyle = "rgba(137, 207, 240, 0.5)";
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = `500 ${Math.floor(h * 0.03)}px "Radio Canada", sans-serif`;
      ctx.fillStyle = "#FFD700";

      const maxTipWidth = iw * 0.85;
      const lineHeight = h * 0.04;
      const words = this.cachedInterludeTip.split(" ");
      let line = "";
      const lines = [];

      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTipWidth && n > 0) {
          lines.push(line.trim());
          line = words[n] + " ";
        } else {
          line = testLine;
        }
      }
      lines.push(line.trim());

      const totalBlockHeight = (lines.length - 1) * lineHeight;
      let startY = iy + ih * 0.7 - totalBlockHeight / 2;

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], w / 2, startY + i * lineHeight);
      }
    }

    if (this.uiRefs && !this.uiRefs.playerUi.elm.classList.contains("hidden")) {
      if (this.lyricOpacity > 0.01) {
        ctx.globalAlpha = this.lyricOpacity;

        ctx.fillStyle = this.lyricGradient;
        ctx.fillRect(0, h * 0.4, w, h * 0.6);

        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        if (this.uiRefs.lyricsCanvas) {
          const sourceCanvas = this.uiRefs.lyricsCanvas.elm;

          const targetWidth = w * 0.9;
          const scaleRatio = targetWidth / sourceCanvas.width;
          const drawHeight = sourceCanvas.height * scaleRatio;

          const drawX = (w - targetWidth) / 2;
          const drawY = h - drawHeight + 60;

          ctx.drawImage(sourceCanvas, drawX, drawY, targetWidth, drawHeight);
        }
        ctx.globalAlpha = 1.0;
      }

      if (
        this.uiRefs.scoreDisplay.elm.parentElement.classList.contains("visible")
      ) {
        const hudX = w * 0.04;
        const hudY = h * 0.92;

        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";

        ctx.font = `bold ${Math.floor(h * 0.02)}px Rajdhani, sans-serif`;
        ctx.fillStyle = "#FFD700";
        ctx.fillText("SCORE", hudX, hudY);

        const scoreLabelWidth = ctx.measureText("SCORE").width;

        ctx.font = `bold ${Math.floor(h * 0.045)}px Rajdhani, sans-serif`;
        ctx.fillStyle = "#89CFF0";
        ctx.fillText(
          this.uiRefs.scoreDisplay.getText(),
          hudX + scoreLabelWidth + 10,
          hudY,
        );
      }

      const countdownEl =
        this.uiRefs.playerUi.elm.querySelector(".countdown-display");
      if (countdownEl && countdownEl.classList.contains("visible")) {
        const text = countdownEl.textContent;
        const cx = w / 2;
        const cy = h * 0.52;
        const radius = h * 0.08;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = this.countdownGradient;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#4d4d4d";
        ctx.stroke();

        ctx.font = `900 ${Math.floor(h * 0.095)}px Rajdhani, sans-serif`;
        ctx.fillStyle = "#000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, cx, cy + h * 0.004);
      }
    }

    if (this.metaCanvas) {
      ctx.drawImage(this.metaCanvas, 0, 0);
    }

    this.ctx.drawImage(this.offscreenCanvas || this.canvas, 0, 0);

    this.animationFrameId = requestAnimationFrame(() => this.drawFrame());
  }
}
