import Html from "../../../libs/html.js";

const PIXELS_PER_SECOND = 150;

export class FortePianoRoll {
  /**
   * Initializes the Piano Roll visualizer class.
   * @param {Object} state - The centralized Forte state object.
   */
  constructor(state) {
    this.state = state;

    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.cachedWidth = 0;

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

    this.ctx = this.canvas.elm.getContext("2d");
    this.cachedWidth = window.innerWidth;

    window.addEventListener("resize", this.resizeHandler);
  }

  /**
   * Adjusts the canvas sizing dynamically on window resize events.
   */
  handleResize() {
    if (this.canvas && this.container) {
      this.cachedWidth = this.container.elm.clientWidth || window.innerWidth;
      this.canvas.elm.width = this.cachedWidth;
      this.canvas.elm.height = 250;

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
      let targetContainer;
      if (typeof containerSelector === "string") {
        targetContainer = Html.qs(containerSelector);
      } else {
        targetContainer = containerSelector;
      }

      if (!targetContainer) {
        console.error(
          "[FORTE SVC] Invalid piano roll container",
          containerSelector,
        );
        return false;
      }

      if (this.container) {
        this.container.appendTo(targetContainer);
      }
      return true;
    } catch (e) {
      console.error("[FORTE SVC] Failed to move piano roll container:", e);
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
    if (bool && this.container) {
      this.container.classOn("visible");
    } else if (this.container) {
      this.container.classOff("visible");
    }
  }

  /**
   * Draws the active viewport of the piano roll directly onto the canvas.
   *
   * @param {number} currentTime - Current track playback time in seconds.
   */
  render(currentTime) {
    if (!this.canvas || !this.ctx || !this.container) return;

    const canvasEl = this.canvas.elm;
    const ctx = this.ctx;

    const expectedWidth = this.cachedWidth;
    if (canvasEl.width !== expectedWidth) canvasEl.width = expectedWidth;
    if (canvasEl.height !== 250) canvasEl.height = 250;

    const width = canvasEl.width;
    const height = canvasEl.height;
    if (width === 0 || height === 0) return;

    ctx.clearRect(0, 0, width, height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    const numGridLines = 8;
    ctx.beginPath();
    for (let i = 1; i < numGridLines; i++) {
      const lineY = (height / numGridLines) * i;
      ctx.moveTo(0, lineY);
      ctx.lineTo(width, lineY);
    }
    ctx.stroke();

    const notes = this.state.playback.guideNotes || [];
    const PRE_ROLL_SECONDS = 2.5;
    let firstNoteTime = 0;

    if (notes.length > 0) {
      firstNoteTime = notes[0].startTime;
    }

    const globalOffset = Math.max(0, firstNoteTime - PRE_ROLL_SECONDS);
    const adjustedTime = currentTime - globalOffset;
    const PAGE_DURATION = width / PIXELS_PER_SECOND;

    const pageIndex = Math.floor(Math.max(0, adjustedTime) / PAGE_DURATION);
    const pageAdjustedStartTime = pageIndex * PAGE_DURATION;

    const pageRealStartTime = pageAdjustedStartTime + globalOffset;
    const pageRealEndTime = pageRealStartTime + PAGE_DURATION;

    const playheadX =
      (adjustedTime - pageAdjustedStartTime) * PIXELS_PER_SECOND;

    const minMidi =
      (this.state.playback.guideRange?.min ?? 42) +
      this.state.playback.transpose;
    const maxMidi =
      (this.state.playback.guideRange?.max ?? 90) +
      this.state.playback.transpose;
    const rangeDiff = Math.max(1, maxMidi - minMidi);
    const NOTE_HEIGHT = 16;

    const pitchToY = (pitch) => {
      if (pitch < minMidi) return height;
      if (pitch > maxMidi) return 0;
      const normalized = (pitch - minMidi) / rangeDiff;
      return height - normalized * height;
    };

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime + note.duration < pageRealStartTime) continue;
      if (note.startTime > pageRealEndTime) break;

      const startX = (note.startTime - pageRealStartTime) * PIXELS_PER_SECOND;
      const noteWidth = Math.max(note.duration * PIXELS_PER_SECOND, 8);
      const y = pitchToY(note.pitch + this.state.playback.transpose);

      if (!isFinite(startX) || !isFinite(y) || !isFinite(noteWidth)) continue;

      const isActive = playheadX >= startX && playheadX <= startX + noteWidth;

      const grad = ctx.createLinearGradient(
        0,
        y - NOTE_HEIGHT / 2,
        0,
        y + NOTE_HEIGHT / 2,
      );

      if (note.hitStatus === "hit") {
        grad.addColorStop(0, "#a3e635");
        grad.addColorStop(1, "#4d7c0f");
        ctx.shadowColor = "#a3e635";
        ctx.shadowBlur = isActive ? 15 : 5;
      } else if (note.hitStatus === "miss") {
        grad.addColorStop(0, "#fca5a5");
        grad.addColorStop(1, "#991b1b");
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      } else {
        grad.addColorStop(0, "#7dd3fc");
        grad.addColorStop(1, "#0284c7");
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = isActive ? 10 : 0;
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(
          startX,
          y - NOTE_HEIGHT / 2,
          noteWidth,
          NOTE_HEIGHT,
          NOTE_HEIGHT / 2,
        );
      } else {
        ctx.rect(startX, y - NOTE_HEIGHT / 2, noteWidth, NOTE_HEIGHT);
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(
          startX + 2,
          y - NOTE_HEIGHT / 2 + 1,
          noteWidth - 4,
          NOTE_HEIGHT / 3,
          3,
        );
      } else {
        ctx.rect(
          startX + 2,
          y - NOTE_HEIGHT / 2 + 1,
          noteWidth - 4,
          NOTE_HEIGHT / 3,
        );
      }
      ctx.fill();

      if (
        isActive &&
        note.hitStatus === "hit" &&
        this.state.scoring.isSinging
      ) {
        const sparkGrad = ctx.createRadialGradient(
          playheadX,
          y,
          0,
          playheadX,
          y,
          20,
        );
        sparkGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
        sparkGrad.addColorStop(0.3, "rgba(163, 230, 53, 0.8)");
        sparkGrad.addColorStop(1, "rgba(163, 230, 53, 0)");
        ctx.fillStyle = sparkGrad;
        ctx.fillRect(playheadX - 20, y - 20, 40, 40);
      }
    }

    if (playheadX >= 0) {
      const sweepWidth = 120;
      const sweepGrad = ctx.createLinearGradient(
        playheadX - sweepWidth,
        0,
        playheadX,
        0,
      );
      sweepGrad.addColorStop(0, "transparent");
      sweepGrad.addColorStop(1, "rgba(255, 215, 0, 0.15)");
      ctx.fillStyle = sweepGrad;
      ctx.fillRect(playheadX - sweepWidth, 0, sweepWidth, height);

      ctx.fillStyle = "#ffd700";
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 15;
      ctx.fillRect(playheadX - 1, 0, 2, height);
      ctx.shadowBlur = 0;
    }

    if (
      this.state.scoring.micPitchHistory &&
      this.state.scoring.micPitchHistory.length > 0 &&
      playheadX >= 0
    ) {
      const activeSegments = [];
      let currentSegment = [];

      for (let i = 0; i < this.state.scoring.micPitchHistory.length; i++) {
        const pt = this.state.scoring.micPitchHistory[i];

        if (pt.time < pageRealStartTime - 1.0) continue;
        if (pt.time > pageRealEndTime + 1.0) break;

        if (pt.isSinging && pt.pitch > 0) {
          if (currentSegment.length > 0) {
            const prevPt = currentSegment[currentSegment.length - 1];
            if (pt.time - prevPt.time > 0.15) {
              activeSegments.push(currentSegment);
              currentSegment = [];
            }
          }
          currentSegment.push({ time: pt.time, pitch: pt.pitch });
        } else {
          if (currentSegment.length > 0) {
            activeSegments.push(currentSegment);
            currentSegment = [];
          }
        }
      }
      if (currentSegment.length > 0) activeSegments.push(currentSegment);

      if (activeSegments.length > 0) {
        ctx.beginPath();
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(137, 207, 240, 0.6)";
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 8;

        for (const segment of activeSegments) {
          if (segment.length === 1) {
            const ptX =
              (segment[0].time - pageRealStartTime) * PIXELS_PER_SECOND;
            const ptY = pitchToY(segment[0].pitch);
            ctx.moveTo(ptX, ptY);
            ctx.lineTo(ptX + 1, ptY);
            continue;
          }

          const getScreenPt = (idx) => ({
            x: (segment[idx].time - pageRealStartTime) * PIXELS_PER_SECOND,
            y: pitchToY(segment[idx].pitch),
          });

          const startPt = getScreenPt(0);
          ctx.moveTo(startPt.x, startPt.y);

          for (let i = 0; i < segment.length - 1; i++) {
            const p0 = getScreenPt(i);
            const p1 = getScreenPt(i + 1);
            const midX = (p0.x + p1.x) / 2;
            const midY = (p0.y + p1.y) / 2;
            ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
          }

          const lastPt = getScreenPt(segment.length - 1);
          ctx.lineTo(lastPt.x, lastPt.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    if (
      this.state.scoring.isSinging &&
      this.state.scoring.currentMicMidi > 0 &&
      playheadX >= 0
    ) {
      const userY = pitchToY(this.state.scoring.currentMicMidi);
      if (isFinite(userY)) {
        const time = performance.now();
        const pulse = Math.sin(time / 100) * 3;

        ctx.beginPath();
        ctx.arc(playheadX, userY, 12 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(137, 207, 240, 0.3)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(playheadX, userY, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.shadowBlur = 0;

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
