import Html from "../../../libs/html.js";

const PIXELS_PER_SECOND = 150;
const NOTE_HEIGHT = 16;

export class FortePianoRoll {
  constructor(state) {
    this.state = state;

    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.cachedWidth = 0;

    this.pageCanvas = null;
    this.pageCtx = null;
    this.sparkCanvas = null;

    this.cachedPageIndex = -1;
    this.cachedNotesLength = -1;
    this.cachedNotes = null;
    this.lastTime = -1;

    this.noteStartIndex = 0;

    // Cache to avoid evaluating typeof
    this.hasRoundRect =
      typeof CanvasRenderingContext2D.prototype.roundRect === "function";

    this.gradHit = null;
    this.gradMiss = null;
    this.gradNeutral = null;
    this.gradSweep = null;

    this.resizeHandler = this.handleResize.bind(this);
  }

  /**
   * Creates DOM instances for the piano roll and sets up event listeners.
   */
  initialize() {
    this.container = new Html("div")
      .classOn("forte-piano-roll-container")
      .appendTo("body");

    this.canvas = new Html("canvas")
      .classOn("forte-piano-roll-canvas")
      .appendTo(this.container);

    this.ctx = this.canvas.elm.getContext("2d", {
      alpha: true,
    });

    this.pageCanvas = document.createElement("canvas");
    this.pageCtx = this.pageCanvas.getContext("2d", { alpha: true });

    this.sparkCanvas = document.createElement("canvas");
    this.sparkCanvas.width = 40;
    this.sparkCanvas.height = 40;

    this.cachedWidth = window.innerWidth;
    window.addEventListener("resize", this.resizeHandler);

    this.handleResize();
  }

  generateGradients() {
    if (!this.ctx) return;

    const createNoteGrad = (c1, c2) => {
      const g = this.ctx.createLinearGradient(
        0,
        -(NOTE_HEIGHT / 2),
        0,
        NOTE_HEIGHT / 2,
      );
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      return g;
    };

    this.gradHit = createNoteGrad("#a3e635", "#4d7c0f");
    this.gradMiss = createNoteGrad("#fca5a5", "#991b1b");
    this.gradNeutral = createNoteGrad("#7dd3fc", "#0284c7");

    this.gradSweep = this.ctx.createLinearGradient(-120, 0, 0, 0);
    this.gradSweep.addColorStop(0, "transparent");
    this.gradSweep.addColorStop(1, "rgba(255, 215, 0, 0.15)");

    const sCtx = this.sparkCanvas.getContext("2d", { alpha: true });
    sCtx.clearRect(0, 0, 40, 40);
    const gradSpark = sCtx.createRadialGradient(20, 20, 0, 20, 20, 20);
    gradSpark.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradSpark.addColorStop(0.3, "rgba(163, 230, 53, 0.8)");
    gradSpark.addColorStop(1, "rgba(163, 230, 53, 0)");
    sCtx.fillStyle = gradSpark;
    sCtx.fillRect(0, 0, 40, 40);
  }

  handleResize() {
    if (this.canvas && this.container) {
      this.cachedWidth = this.container.elm.clientWidth || window.innerWidth;

      this.canvas.elm.width = this.cachedWidth;
      this.canvas.elm.height = 250;
      if (this.pageCanvas) {
        this.pageCanvas.width = this.cachedWidth;
        this.pageCanvas.height = 250;
      }

      this.generateGradients();
      this.cachedPageIndex = -1;

      if (this.state.playback.status !== "playing") {
        this.render(this.state.playback.smoothedTime);
      }
    }
  }

  /**
   * Sets the container element for piano roll UI components.
   * Moves the piano roll elements from their current parent to the specified container.
   *
   * @param {HTMLElement|string} containerSelector - DOM element or CSS selector string.
   * @returns {boolean} True if successfully moved, false if container not found.
   */
  setContainer(containerSelector) {
    try {
      let targetContainer =
        typeof containerSelector === "string"
          ? Html.qs(containerSelector)
          : containerSelector;
      if (!targetContainer) return false;
      if (this.container) this.container.appendTo(targetContainer);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Determines CSS layout presentation showing the pitch mapping visualization layer.
   *
   * @param {boolean} bool - True enforcing visible traits.
   */
  toggleVisibility(bool) {
    this.state.ui.pianoRollVisible = bool;
    if (bool && this.container) this.container.classOn("visible");
    else if (this.container) this.container.classOff("visible");
  }

  drawNote(ctxToUse, note, startX, y, noteWidth, isActive) {
    ctxToUse.save();
    ctxToUse.translate(startX | 0, y | 0);
    const halfHeight = NOTE_HEIGHT / 2;

    if (isActive) {
      if (note.hitStatus === "hit") {
        ctxToUse.fillStyle = "rgba(163, 230, 53, 0.4)"; // Green
      } else if (note.hitStatus === "miss") {
        ctxToUse.fillStyle = "rgba(248, 113, 113, 0.4)"; // Red
      } else {
        ctxToUse.fillStyle = "rgba(56, 189, 248, 0.4)"; // Blue
      }

      ctxToUse.beginPath();
      if (this.hasRoundRect) {
        ctxToUse.roundRect(
          -4,
          -halfHeight - 4,
          noteWidth + 8,
          NOTE_HEIGHT + 8,
          halfHeight + 4,
        );
      } else {
        ctxToUse.rect(-4, -halfHeight - 4, noteWidth + 8, NOTE_HEIGHT + 8);
      }
      ctxToUse.fill();
    }

    if (note.hitStatus === "hit") {
      ctxToUse.fillStyle = this.gradHit;
    } else if (note.hitStatus === "miss") {
      ctxToUse.fillStyle = this.gradMiss;
    } else {
      ctxToUse.fillStyle = this.gradNeutral;
    }

    ctxToUse.beginPath();
    if (this.hasRoundRect) {
      ctxToUse.roundRect(0, -halfHeight, noteWidth, NOTE_HEIGHT, halfHeight);
    } else {
      ctxToUse.rect(0, -halfHeight, noteWidth, NOTE_HEIGHT);
    }
    ctxToUse.fill();

    ctxToUse.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctxToUse.beginPath();
    if (this.hasRoundRect) {
      ctxToUse.roundRect(2, -halfHeight + 1, noteWidth - 4, NOTE_HEIGHT / 3, 3);
    } else {
      ctxToUse.rect(2, -halfHeight + 1, noteWidth - 4, NOTE_HEIGHT / 3);
    }
    ctxToUse.fill();

    ctxToUse.restore();
  }

  render(currentTime) {
    if (!this.canvas || !this.ctx || !this.container) return;

    const expectedWidth = this.container.elm.clientWidth || window.innerWidth;
    if (
      this.canvas.elm.width !== expectedWidth ||
      this.canvas.elm.height !== 250
    ) {
      this.cachedWidth = expectedWidth;
      this.canvas.elm.width = expectedWidth;
      this.canvas.elm.height = 250;
      if (this.pageCanvas) {
        this.pageCanvas.width = expectedWidth;
        this.pageCanvas.height = 250;
      }
      this.generateGradients();
      this.cachedPageIndex = -1;
    }

    const ctx = this.ctx;
    const width = this.canvas.elm.width;
    const height = this.canvas.elm.height;
    if (width === 0 || height === 0) return;

    const notes = this.state.playback.guideNotes || [];

    if (this.cachedNotes !== notes || this.cachedNotesLength !== notes.length) {
      this.cachedNotes = notes;
      this.cachedPageIndex = -1;
      this.cachedNotesLength = notes.length;
      this.noteStartIndex = 0;
    }

    if (currentTime < this.lastTime) {
      this.noteStartIndex = 0;
      this.cachedPageIndex = -1;
    }
    this.lastTime = currentTime;

    const PRE_ROLL_SECONDS = 2.5;
    const firstNoteTime = notes.length > 0 ? notes[0].startTime : 0;
    const globalOffset = Math.max(0, firstNoteTime - PRE_ROLL_SECONDS);
    const adjustedTime = currentTime - globalOffset;
    const PAGE_DURATION = width / PIXELS_PER_SECOND;

    const pageIndex = Math.floor(Math.max(0, adjustedTime) / PAGE_DURATION);
    const pageRealStartTime = pageIndex * PAGE_DURATION + globalOffset;
    const pageRealEndTime = pageRealStartTime + PAGE_DURATION;

    const playheadX =
      ((adjustedTime - pageIndex * PAGE_DURATION) * PIXELS_PER_SECOND) | 0;

    const minMidi =
      (this.state.playback.guideRange?.min ?? 42) +
      this.state.playback.transpose;
    const maxMidi =
      (this.state.playback.guideRange?.max ?? 90) +
      this.state.playback.transpose;
    const rangeDiff = Math.max(1, maxMidi - minMidi);

    const pitchToY = (pitch) => {
      if (pitch < minMidi) return height;
      if (pitch > maxMidi) return 0;
      return height - ((pitch - minMidi) / rangeDiff) * height;
    };

    if (pageIndex !== this.cachedPageIndex) {
      this.cachedPageIndex = pageIndex;
      this.pageCtx.clearRect(0, 0, width, height);

      this.pageCtx.lineWidth = 1;
      this.pageCtx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      this.pageCtx.beginPath();
      for (let i = 1; i < 8; i++) {
        const lineY = ((height / 8) * i) | 0;
        this.pageCtx.moveTo(0, lineY);
        this.pageCtx.lineTo(width, lineY);
      }
      this.pageCtx.stroke();

      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (note.startTime + note.duration < pageRealStartTime) continue;
        if (note.startTime > pageRealEndTime) break;

        const startX = (note.startTime - pageRealStartTime) * PIXELS_PER_SECOND;
        const noteWidth = Math.max(note.duration * PIXELS_PER_SECOND, 8);
        const y = pitchToY(note.pitch + this.state.playback.transpose);

        note._cachedStatus = note.hitStatus || "neutral";
        this.drawNote(this.pageCtx, note, startX, y, noteWidth, false);
      }
    }

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.pageCanvas, 0, 0);

    while (
      this.noteStartIndex < notes.length &&
      notes[this.noteStartIndex].startTime +
        notes[this.noteStartIndex].duration <
        pageRealStartTime
    ) {
      this.noteStartIndex++;
    }

    let currentStatus = "neutral";

    for (let i = this.noteStartIndex; i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > pageRealEndTime) break;

      const startX =
        ((note.startTime - pageRealStartTime) * PIXELS_PER_SECOND) | 0;
      const noteWidth = Math.max(note.duration * PIXELS_PER_SECOND, 8) | 0;
      const y = pitchToY(note.pitch + this.state.playback.transpose) | 0;

      const isActive = playheadX >= startX && playheadX <= startX + noteWidth;

      if (isActive) {
        currentStatus = note.hitStatus || "neutral";
        this.drawNote(ctx, note, startX, y, noteWidth, true);

        if (
          note.hitStatus === "hit" &&
          this.state.scoring.isSinging &&
          !this.state.scoring.userDisabled
        ) {
          ctx.drawImage(this.sparkCanvas, playheadX - 20, y - 20);
        }
      } else if (note.hitStatus !== note._cachedStatus) {
        this.drawNote(this.pageCtx, note, startX, y, noteWidth, false);
        note._cachedStatus = note.hitStatus;
      }
    }

    if (playheadX >= 0) {
      ctx.save();
      ctx.translate(playheadX, 0);
      ctx.fillStyle = this.gradSweep;
      ctx.fillRect(-120, 0, 120, height);
      ctx.restore();

      ctx.fillStyle = "rgba(255, 215, 0, 0.3)";
      ctx.fillRect(playheadX - 4, 0, 8, height);
      ctx.fillStyle = "rgba(255, 215, 0, 0.6)";
      ctx.fillRect(playheadX - 2, 0, 4, height);
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(playheadX - 1, 0, 2, height);
    }

    let trailOutline = "rgba(56, 189, 248, 0.25)";
    let trailCore = "rgba(137, 207, 240, 0.8)";
    let dotOuter = "rgba(137, 207, 240, 0.3)";
    let dotInner = "rgba(56, 189, 248, 0.5)";

    if (currentStatus === "hit") {
      trailOutline = "rgba(163, 230, 53, 0.25)";
      trailCore = "rgba(190, 242, 100, 0.8)";
      dotOuter = "rgba(163, 230, 53, 0.3)";
      dotInner = "rgba(101, 163, 13, 0.5)";
    } else if (currentStatus === "miss") {
      trailOutline = "rgba(248, 113, 113, 0.25)";
      trailCore = "rgba(252, 165, 165, 0.8)";
      dotOuter = "rgba(248, 113, 113, 0.3)";
      dotInner = "rgba(220, 38, 38, 0.5)";
    }

    const history = this.state.scoring.micPitchHistory;
    if (
      !this.state.scoring.userDisabled &&
      history &&
      history.length > 0 &&
      playheadX >= 0
    ) {
      let low = 0;
      let high = history.length - 1;
      let hStartIndex = 0;
      const targetTime = pageRealStartTime - 1.0;

      while (low <= high) {
        const mid = (low + high) >> 1;
        if (history[mid].time < targetTime) {
          hStartIndex = mid + 1;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      let isDrawing = false;
      let lastTime = 0;
      let lastPx = -1000;
      let lastPy = -1000;

      for (let i = hStartIndex; i < history.length; i++) {
        const pt = history[i];
        if (pt.time > pageRealEndTime + 1.0) break;

        if (pt.isSinging && pt.pitch > 0) {
          const px = ((pt.time - pageRealStartTime) * PIXELS_PER_SECOND) | 0;
          const py = pitchToY(pt.pitch) | 0;

          if (px !== lastPx || py !== lastPy) {
            if (!isDrawing || pt.time - lastTime > 0.15) {
              ctx.moveTo(px, py);
            } else {
              ctx.lineTo(px, py);
            }
            lastPx = px;
            lastPy = py;
          }

          isDrawing = true;
          lastTime = pt.time;
        } else {
          isDrawing = false;
        }
      }

      ctx.lineWidth = 10;
      ctx.strokeStyle = trailOutline;
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = trailCore;
      ctx.stroke();
    }

    if (
      !this.state.scoring.userDisabled &&
      this.state.scoring.isSinging &&
      this.state.scoring.currentMicMidi > 0 &&
      playheadX >= 0
    ) {
      const userY = pitchToY(this.state.scoring.currentMicMidi) | 0;
      if (isFinite(userY)) {
        const pulse = (Math.sin(performance.now() / 100) * 3) | 0;

        ctx.beginPath();
        ctx.arc(playheadX, userY, 12 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = dotOuter;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(playheadX, userY, 9, 0, Math.PI * 2);
        ctx.fillStyle = dotInner;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(playheadX, userY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(playheadX, userY, 8, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  /**
   * Destroys DOM nodes and listeners.
   */
  cleanup() {
    window.removeEventListener("resize", this.resizeHandler);
    if (this.container) {
      this.container.cleanup();
      this.container = null;
    }
  }
}
