import BasePlugin from "../../libs/BasePlugin.js";

const CONTROLS = [
  { key: "gain", label: "GAIN", format: (v) => Math.round(v * 100) + " %" },
];

/**
 * GainPlugin - Controls the volume/gain of the audio signal
 * @extends BasePlugin
 */
export default class GainPlugin extends BasePlugin {
  /**
   * Creates a new GainPlugin instance
   * @param {AudioContext} audioContext - The Web Audio API context
   */
  constructor(audioContext) {
    super(audioContext);
    this.name = "Gain";
    this.gainNode = this.audioContext.createGain();

    this.parameters = {
      gain: {
        type: "slider",
        min: 0,
        max: 2,
        step: 0.01,
        unit: "",
        value: 1.0,
      },
    };

    this.input.connect(this.gainNode).connect(this.output);
    this.isDragging = false;
    this.currentDragIndex = -1;
  }

  /**
   * Sets a parameter value for the plugin
   * @param {string} key - Parameter name
   * @param {number} value - Parameter value to set
   */
  setParameter(key, value) {
    if (key === "gain") {
      this.parameters.gain.value = value;
      this.gainNode.gain.setTargetAtTime(
        value,
        this.audioContext.currentTime,
        0.01,
      );
    }
  }

  /**
   * Renders the custom fader-based GUI for the plugin.
   * @param {HTMLElement} wrapper - Container element for the GUI
   * @param {Object} Html - HTML builder utility class
   */
  renderGUI(wrapper, Html) {
    this.activeControlIndex = 0;
    this.controlElements = [];

    const container = new Html("div")
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
      const col = new Html("div")
        .styleJs({
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.5rem",
          flex: "1",
        })
        .appendTo(container);

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

      const hitArea = new Html("div")
        .styleJs({
          position: "absolute",
          top: "-15px",
          bottom: "-15px",
          left: "-25px",
          right: "-25px",
          cursor: "var(--cursor-pointer)",
          zIndex: 5,
        })
        .appendTo(trackContainer);

      hitArea.on("mousedown", (e) => {
        this.isDragging = true;
        this.currentDragIndex = idx;
        this.activeControlIndex = idx;
        this._updatePluginHighlight();
        this._handleMouseFader(e, idx);
      });

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

  /**
   * Registers global mouse event handlers for fader dragging.
   * @private
   */
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

  /**
   * Updates fader position based on mouse movement.
   * @private
   * @param {MouseEvent} e - Mouse event with clientY position
   * @param {number} idx - Control index being adjusted
   */
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

    const step = this.parameters[key].step || 0.01;
    const inv = 1.0 / step;
    val = Math.round(val * inv) / inv;

    this.setParameter(key, val);
    this._updateControlVisuals(idx);
  }

  /**
   * Updates visual representation of a control.
   * @private
   * @param {number} idx - Control index to update
   */
  _updateControlVisuals(idx) {
    const elData = this.controlElements[idx];
    const key = elData.ctrl.key;
    const val = this.parameters[key].value;

    elData.valLabel.text(elData.ctrl.format(val));

    const min = this.parameters[key].min;
    const max = this.parameters[key].max;
    const percentage = ((val - min) / (max - min)) * 100;

    elData.faderThumb.styleJs({ bottom: `calc(${percentage}% - 8px)` });
    elData.trackFill.styleJs({ height: `${percentage}%` });
  }

  /**
   * Updates styling to highlight the active control and reset others.
   * @private
   */
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

  /**
   * Processes keyboard input for control navigation and value adjustment.
   * @param {KeyboardEvent} e - Keyboard event
   * @returns {boolean} True if event was consumed, false otherwise
   */
  handleKeyDown(e) {
    if (e.key === "ArrowLeft") {
      if (this.activeControlIndex > 0) {
        this.activeControlIndex--;
        this._updatePluginHighlight();
        return true;
      }
      return false;
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

      const range = this.parameters[key].max - this.parameters[key].min;
      const step = range / 20;

      val += e.key === "ArrowUp" ? step : -step;
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

  /**
   * Disconnects and cleans up the plugin
   */
  disconnect() {
    super.disconnect();
    this.gainNode.disconnect();

    if (this._mouseMoveHandler) {
      window.removeEventListener("mousemove", this._mouseMoveHandler);
    }
    if (this._mouseUpHandler) {
      window.removeEventListener("mouseup", this._mouseUpHandler);
    }
  }
}
