import BasePlugin from "/libs/BasePlugin.js";

const CONTROLS = [
  { key: "time", label: "TIME", format: (v) => v.toFixed(2) + " s" },
  { key: "feedback", label: "FDBK", format: (v) => Math.round(v * 100) + " %" },
  { key: "mix", label: "MIX", format: (v) => Math.round(v * 100) + " %" },
];

/**
 * EchoPlugin
 * A classic feedback delay effect for the Forte engine.
 */
export default class EchoPlugin extends BasePlugin {
  constructor(audioContext) {
    super(audioContext);
    this.name = "Echo";

    // --- Create Web Audio Nodes for the effect ---
    this.delayNode = this.audioContext.createDelay(2.0);
    this.feedbackGain = this.audioContext.createGain();
    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();

    // --- Define the parameters that the UI can control ---
    this.parameters = {
      time: {
        type: "slider",
        min: 0,
        max: 2,
        step: 0.01,
        value: 0.4,
      },
      feedback: {
        type: "slider",
        min: 0,
        max: 0.95,
        step: 0.01,
        value: 0.5,
      },
      mix: {
        type: "slider",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.35,
      },
    };

    // --- Set initial values from the parameters object ---
    this.delayNode.delayTime.value = this.parameters.time.value;
    this.feedbackGain.gain.value = this.parameters.feedback.value;
    this.dryGain.gain.value = 1.0 - this.parameters.mix.value;
    this.wetGain.gain.value = this.parameters.mix.value;

    // --- Connect the audio graph ---
    this.input.connect(this.dryGain);
    this.input.connect(this.delayNode);
    this.delayNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
    this.dryGain.connect(this.output);
    this.delayNode.connect(this.wetGain);
    this.wetGain.connect(this.output);

    // Mouse drag state
    this.isDragging = false;
    this.currentDragIndex = -1;
  }

  setParameter(key, value) {
    const now = this.audioContext.currentTime;
    const smoothTime = 0.02;

    switch (key) {
      case "time":
        this.parameters.time.value = value;
        this.delayNode.delayTime.setTargetAtTime(value, now, smoothTime);
        break;

      case "feedback":
        this.parameters.feedback.value = value;
        this.feedbackGain.gain.setTargetAtTime(value, now, smoothTime);
        break;

      case "mix":
        this.parameters.mix.value = value;
        this.dryGain.gain.setTargetAtTime(1.0 - value, now, smoothTime);
        this.wetGain.gain.setTargetAtTime(value, now, smoothTime);
        break;
    }
  }

  // ======================================================================
  // --- CUSTOM GUI IMPLEMENTATION ---
  // ======================================================================

  renderGUI(wrapper, Html) {
    this.activeControlIndex = 0;
    this.controlElements = [];

    // Main Echo Panel Container
    const echoContainer = new Html("div")
      .styleJs({
        display: "flex",
        gap: "2rem",
        justifyContent: "space-evenly",
        alignItems: "center",
        padding: "2rem 1.5rem",
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        borderRadius: "12px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "inset 0 5px 20px rgba(0,0,0,0.5)",
        height: "100%",
        width: "100%",
        boxSizing: "border-box",
      })
      .appendTo(wrapper);

    CONTROLS.forEach((ctrl, idx) => {
      // Column for each parameter
      const col = new Html("div")
        .styleJs({
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.5rem",
          flex: "1",
        })
        .appendTo(echoContainer);

      // 1. Top Label (Current Value)
      const valLabel = new Html("div")
        .styleJs({
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "700",
          fontSize: "1.4rem",
          color: "#89cff0",
          height: "1.5rem",
          transition: "color 0.2s ease",
        })
        .appendTo(col);

      // 2. Fader Track Container
      const trackContainer = new Html("div")
        .styleJs({
          position: "relative",
          width: "14px",
          height: "200px",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          borderRadius: "7px",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          display: "flex",
          justifyContent: "center",
        })
        .appendTo(col);

      // 2a. Fill indicator (shows volume/intensity from bottom up)
      const trackFill = new Html("div")
        .styleJs({
          position: "absolute",
          bottom: "0",
          width: "100%",
          backgroundColor: "rgba(137, 207, 240, 0.2)",
          borderRadius: "7px",
          transition: "height 0.1s linear, background-color 0.2s ease",
        })
        .appendTo(trackContainer);

      // 2b. Fader Thumb
      const faderThumb = new Html("div")
        .styleJs({
          position: "absolute",
          width: "36px",
          height: "16px",
          backgroundColor: "#89cff0",
          borderRadius: "4px",
          boxShadow: "0 0 10px rgba(137, 207, 240, 0.4)",
          zIndex: 2,
          pointerEvents: "none",
          transition: "background-color 0.2s ease, box-shadow 0.2s ease",
        })
        .appendTo(trackContainer);

      // 2c. Invisible Hit Area for mouse interaction
      const hitArea = new Html("div")
        .styleJs({
          position: "absolute",
          top: "-15px",
          bottom: "-15px",
          left: "-25px",
          right: "-25px",
          cursor: "pointer",
          zIndex: 5,
        })
        .appendTo(trackContainer);

      // --- MOUSE EVENTS ---
      hitArea.on("mousedown", (e) => {
        this.isDragging = true;
        this.currentDragIndex = idx;
        this.activeControlIndex = idx;
        this._updatePluginHighlight();
        this._handleMouseFader(e, idx);
      });

      // 3. Bottom Label (Parameter Name)
      const nameLabel = new Html("div")
        .styleJs({
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "700",
          fontSize: "1.2rem",
          color: "rgba(255, 255, 255, 0.5)",
          padding: "0.4rem 0.8rem",
          borderRadius: "6px",
          letterSpacing: "0.1em",
          transition: "all 0.2s ease",
        })
        .text(ctrl.label)
        .appendTo(col);

      this.controlElements.push({
        valLabel,
        trackContainer,
        trackFill,
        faderThumb,
        nameLabel,
        ctrl,
      });

      this._updateControlVisuals(idx);
    });

    this._updatePluginHighlight();
    this._setupGlobalMouseEvents();
  }

  // --- MOUSE EVENT HANDLERS ---

  _setupGlobalMouseEvents() {
    this._mouseMoveHandler = (e) => {
      if (!this.isDragging || this.currentDragIndex === -1) return;
      this._handleMouseFader(e, this.currentDragIndex);
    };

    this._mouseUpHandler = () => {
      this.isDragging = false;
      this.currentDragIndex = -1;
    };

    window.addEventListener("mousemove", this._mouseMoveHandler);
    window.addEventListener("mouseup", this._mouseUpHandler);
  }

  _handleMouseFader(e, idx) {
    const elData = this.controlElements[idx];
    const rect = elData.trackContainer.elm.getBoundingClientRect();

    let y = e.clientY - rect.top;
    y = Math.max(0, Math.min(rect.height, y));
    const percent = 1 - y / rect.height;

    const key = elData.ctrl.key;
    const min = this.parameters[key].min;
    const max = this.parameters[key].max;

    let val = min + percent * (max - min);
    val = Math.round(val * 100) / 100; // Snap to 2 decimal places

    this.setParameter(key, val);
    this._updateControlVisuals(idx);
  }

  // --- VISUAL UPDATES ---

  _updateControlVisuals(idx) {
    const elData = this.controlElements[idx];
    const key = elData.ctrl.key;
    const val = this.parameters[key].value;

    // Update Text using the specific format function for this parameter
    elData.valLabel.text(elData.ctrl.format(val));

    // Calculate percentage
    const min = this.parameters[key].min;
    const max = this.parameters[key].max;
    const percentage = ((val - min) / (max - min)) * 100;

    // Move Thumb & Fill Track
    elData.faderThumb.styleJs({ bottom: `calc(${percentage}% - 8px)` });
    elData.trackFill.styleJs({ height: `${percentage}%` });
  }

  _updatePluginHighlight() {
    this.controlElements.forEach((elData, idx) => {
      if (idx === this.activeControlIndex) {
        elData.valLabel.styleJs({ color: "#ffd700" });
        elData.faderThumb.styleJs({
          backgroundColor: "#ffd700",
          boxShadow: "0 0 15px rgba(255, 215, 0, 0.6)",
        });
        elData.trackFill.styleJs({ backgroundColor: "rgba(255, 215, 0, 0.2)" });
        elData.nameLabel.styleJs({
          color: "#010141",
          backgroundColor: "#ffd700",
        });
      } else {
        elData.valLabel.styleJs({ color: "#89cff0" });
        elData.faderThumb.styleJs({
          backgroundColor: "#89cff0",
          boxShadow: "0 0 10px rgba(137, 207, 240, 0.4)",
        });
        elData.trackFill.styleJs({
          backgroundColor: "rgba(137, 207, 240, 0.15)",
        });
        elData.nameLabel.styleJs({
          color: "rgba(255, 255, 255, 0.5)",
          backgroundColor: "transparent",
        });
      }
    });
  }

  // --- KEYBOARD INTERACTION ---

  handleKeyDown(e) {
    if (e.key === "ArrowLeft") {
      if (this.activeControlIndex > 0) {
        this.activeControlIndex--;
        this._updatePluginHighlight();
        return true;
      }
      return false; // Exit back to mixer list
    } else if (e.key === "ArrowRight") {
      if (this.activeControlIndex < CONTROLS.length - 1) {
        this.activeControlIndex++;
        this._updatePluginHighlight();
        return true;
      }
      return false;
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();

      const elData = this.controlElements[this.activeControlIndex];
      const key = elData.ctrl.key;
      let val = this.parameters[key].value;

      // Step value (larger increments for keyboard vs mouse)
      const step = 0.05;
      val += e.key === "ArrowUp" ? step : -step;

      // Clamp value
      val = Math.max(
        this.parameters[key].min,
        Math.min(this.parameters[key].max, val),
      );

      this.setParameter(key, val);
      this._updateControlVisuals(this.activeControlIndex);
      return true;
    }

    return false;
  }

  disconnect() {
    super.disconnect();
    this.delayNode.disconnect();
    this.feedbackGain.disconnect();
    this.wetGain.disconnect();
    this.dryGain.disconnect();

    // Clean up global window events
    if (this._mouseMoveHandler) {
      window.removeEventListener("mousemove", this._mouseMoveHandler);
    }
    if (this._mouseUpHandler) {
      window.removeEventListener("mouseup", this._mouseUpHandler);
    }
  }
}
