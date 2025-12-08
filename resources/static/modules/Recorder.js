import Html from "/libs/html.js";

export class RecorderModule {
  constructor(forteSvc, bgvModule, infoBarModule) {
    this.forteSvc = forteSvc;
    this.bgvPlayer = bgvModule;
    this.infoBar = infoBarModule;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.canvas = null;
    this.ctx = null;
    this.animationFrameId = null;
    this.currentSongInfo = null;
    this.uiRefs = null;
    this.outputResolution = { width: 1920, height: 1080 };
    console.log("[RECORDER] Video Recording feature initialized.");
  }

  mount(container) {
    this.canvas = new Html("canvas")
      .attr({
        width: this.outputResolution.width,
        height: this.outputResolution.height,
      })
      .styleJs({ display: "none" })
      .appendTo(container).elm;
    this.ctx = this.canvas.getContext("2d");
  }

  setUiRefs(refs) {
    this.uiRefs = refs;
  }

  setSongInfo(song) {
    if (song) this.currentSongInfo = { title: song.title, artist: song.artist };
  }

  clearSongInfo() {
    this.currentSongInfo = null;
  }

  toggle() {
    this.isRecording ? this.stop() : this.start();
  }

  start() {
    if (this.isRecording || !this.forteSvc || !this.bgvPlayer) return;

    const audioStream = this.forteSvc.getRecordingAudioStream();
    if (!audioStream || audioStream.getAudioTracks().length === 0) {
      this.infoBar.showTemp("RECORDING", "Error: No audio stream found.", 4000);
      return;
    }

    const videoStream = this.canvas.captureStream(30);
    const combinedStream = new MediaStream([
      videoStream.getVideoTracks()[0],
      audioStream.getAudioTracks()[0],
    ]);

    this.recordedChunks = [];
    try {
      this.mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: "video/webm; codecs=vp9,opus",
        videoBitsPerSecond: 5000000,
      });
    } catch (e) {
      console.error("Failed to create MediaRecorder:", e);
      this.infoBar.showTemp(
        "RECORDING",
        "Error: Could not start recorder.",
        4000,
      );
      return;
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.recordedChunks.push(event.data);
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: "video/webm" });
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

  stop() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.mediaRecorder.stop();
    this.isRecording = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.infoBar.showDefault();
  }

  drawFrame() {
    if (!this.isRecording) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    // Draw BGV
    let sourceVideo = this.bgvPlayer.isManualMode
      ? this.bgvPlayer.activeManualPlayer
      : this.bgvPlayer.videoElements[this.bgvPlayer.activePlayerIndex];
    if (sourceVideo && sourceVideo.readyState >= 2 && !sourceVideo.paused) {
      this.ctx.drawImage(sourceVideo, 0, 0, w, h);
    } else {
      this.ctx.fillStyle = "black";
      this.ctx.fillRect(0, 0, w, h);
    }

    // Draw UI
    if (this.uiRefs && !this.uiRefs.playerUi.elm.classList.contains("hidden")) {
      const gradient = this.ctx.createLinearGradient(0, h * 0.5, 0, h);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0.9)");
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, h * 0.5, w, h * 0.5);

      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "bottom";

      const line1BaseY = h - 180;
      const line2BaseY = h - 90;
      const line1HasRomanized = this.uiRefs.lrcLineDisplay1.elm.querySelector(
        ".lyric-line-romanized",
      )?.textContent;
      const line2HasRomanized = this.uiRefs.lrcLineDisplay2.elm.querySelector(
        ".lyric-line-romanized",
      )?.textContent;
      const line1Y = line1HasRomanized
        ? line2HasRomanized
          ? line1BaseY - 40
          : line1BaseY - 20
        : line1BaseY;
      const line2Y = line2HasRomanized ? line2BaseY - 20 : line2BaseY;

      this.drawLyricLine(this.uiRefs.lrcLineDisplay1.elm, line1Y);
      this.drawLyricLine(this.uiRefs.lrcLineDisplay2.elm, line2Y);

      const progressWidth = parseFloat(
        this.uiRefs.progressBar.elm.style.width || "0%",
      );
      const barY = h - 60;
      const barW = w * 0.8;
      const barX = (w - barW) / 2;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      this.ctx.fillRect(barX, barY, barW, 10);
      this.ctx.fillStyle = "#89CFF0";
      this.ctx.fillRect(barX, barY, barW * (progressWidth / 100), 10);

      if (
        this.uiRefs.scoreDisplay.elm.parentElement.classList.contains("visible")
      ) {
        this.ctx.font = "bold 2.5rem Rajdhani, sans-serif";
        this.ctx.fillStyle = "#89CFF0";
        this.ctx.textAlign = "right";
        this.ctx.fillText(this.uiRefs.scoreDisplay.getText(), w - 50, h - 80);
        this.ctx.font = "bold 1rem Rajdhani, sans-serif";
        this.ctx.fillStyle = "#FFD700";
        this.ctx.fillText("SCORE", w - 150, h - 85);
      }
    }

    // Song Info Overlay
    if (this.currentSongInfo) {
      const x = 50,
        y = 50,
        maxWidth = w * 0.4,
        padding = 25;
      this.ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      this.ctx.beginPath();
      this.ctx.roundRect(
        x - padding,
        y - padding,
        maxWidth + padding * 2,
        120 + padding,
        15,
      );
      this.ctx.fill();

      this.ctx.font = "bold 48px Rajdhani, sans-serif";
      this.ctx.fillStyle = "white";
      this.ctx.textAlign = "left";
      this.ctx.textBaseline = "top";
      this.ctx.shadowColor = "black";
      this.ctx.shadowBlur = 5;
      this.ctx.fillText(this.currentSongInfo.title, x, y, maxWidth);

      this.ctx.font = "32px Rajdhani, sans-serif";
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      this.ctx.fillText(this.currentSongInfo.artist, x, y + 65, maxWidth);
      this.ctx.shadowBlur = 0;
    }

    this.animationFrameId = requestAnimationFrame(() => this.drawFrame());
  }

  drawLyricLine(element, y) {
    const originalEl = element.querySelector(".lyric-line-original");
    const romanizedEl = element.querySelector(".lyric-line-romanized");
    if (!originalEl || !originalEl.textContent) return;

    const isActive = element.classList.contains("active");
    const defaultOpacity = element.classList.contains("next") ? 0.5 : 0.4;

    this.ctx.font = "bold 4.5rem Rajdhani, sans-serif";
    this.ctx.fillStyle = isActive
      ? "#FFFFFF"
      : `rgba(255, 255, 255, ${defaultOpacity})`;
    if (isActive) {
      this.ctx.strokeStyle = "#010141";
      this.ctx.lineWidth = 12;
      this.ctx.lineJoin = "round";
      this.ctx.strokeText(originalEl.textContent, this.canvas.width / 2, y);
    }
    this.ctx.fillText(originalEl.textContent, this.canvas.width / 2, y);

    if (romanizedEl && romanizedEl.textContent) {
      this.ctx.font = "500 1.5rem Rajdhani, sans-serif";
      this.ctx.fillStyle = isActive
        ? "#FFFFFF"
        : `rgba(255, 255, 255, ${defaultOpacity + 0.1})`;
      this.ctx.fillText(romanizedEl.textContent, this.canvas.width / 2, y + 40);
    }
  }
}
