import BasePlugin from "../../libs/BasePlugin.js";

const CONTROLS = [
  {
    key: "inputGain",
    label: "IN GAIN",
    step: 0.5,
    format: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + " dB",
    hasCenter: true,
  },
  {
    key: "threshold",
    label: "THRESH",
    step: 1.0,
    format: (v) => v.toFixed(1) + " dB",
    hasCenter: false,
  },
  {
    key: "ratio",
    label: "RATIO",
    step: 0.5,
    format: (v) => v.toFixed(1) + " : 1",
    hasCenter: false,
  },
  {
    key: "attack",
    label: "ATTACK",
    step: 1.0,
    format: (v) => Math.round(v) + " ms",
    hasCenter: false,
  },
  {
    key: "release",
    label: "RELEASE",
    step: 10.0,
    format: (v) => Math.round(v) + " ms",
    hasCenter: false,
  },
  {
    key: "outputGain",
    label: "OUT GAIN",
    step: 0.5,
    format: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + " dB",
    hasCenter: true,
  },
];

/**
 * CompressorPlugin
 * A classic vocal compressor with input gain, standard compressor controls, and make-up gain.
 */
export default class CompressorPlugin extends BasePlugin {
  constructor(audioContext) {
    super(audioContext);
    this.name = "Compressor";

    this.inputGain = this.audioContext.createGain();
    this.compressorNode = this.audioContext.createDynamicsCompressor();
    this.outputGain = this.audioContext.createGain();

    this.parameters = {
      inputGain: { min: -24, max: 24, value: 0 },
      threshold: { min: -100, max: 0, value: -24 },
      ratio: { min: 1, max: 20, value: 4 },
      attack: { min: 0, max: 200, value: 5 },
      release: { min: 10, max: 1000, value: 250 },
      outputGain: { min: -24, max: 24, value: 0 },
    };

    this.updateAllParameters();

    this.input
      .connect(this.inputGain)
      .connect(this.compressorNode)
      .connect(this.outputGain)
      .connect(this.output);

    this.isDragging = false;
    this.currentDragIndex = -1;
  }

  /**
   * Converts decibels to linear gain value
   * @param {number} db - Decibel value to convert
   * @returns {number} Linear gain value
   */
  dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  /**
   * Updates all compressor parameters based on current values
   */
  updateAllParameters() {
    this.inputGain.gain.value = this.dbToLinear(
      this.parameters.inputGain.value,
    );
    this.compressorNode.threshold.value = this.parameters.threshold.value;
    this.compressorNode.ratio.value = this.parameters.ratio.value;
    this.compressorNode.attack.value = this.parameters.attack.value / 1000;
    this.compressorNode.release.value = this.parameters.release.value / 1000;
    this.outputGain.gain.value = this.dbToLinear(
      this.parameters.outputGain.value,
    );
  }

  /**
   * Sets a specific parameter value with smooth transition
   * @param {string} key - Parameter key to update
   * @param {number} value - New parameter value
   */
  setParameter(key, value) {
    if (this.parameters[key] === undefined) return;

    const now = this.audioContext.currentTime;
    const smoothTime = 0.02;

    this.parameters[key].value = value;

    switch (key) {
      case "inputGain":
        this.inputGain.gain.setTargetAtTime(
          this.dbToLinear(value),
          now,
          smoothTime,
        );
        break;
      case "threshold":
        this.compressorNode.threshold.setTargetAtTime(value, now, smoothTime);
        break;
      case "ratio":
        this.compressorNode.ratio.setTargetAtTime(value, now, smoothTime);
        break;
      case "attack":
        this.compressorNode.attack.setTargetAtTime(
          value / 1000,
          now,
          smoothTime,
        );
        break;
      case "release":
        this.compressorNode.release.setTargetAtTime(
          value / 1000,
          now,
          smoothTime,
        );
        break;
      case "outputGain":
        this.outputGain.gain.setTargetAtTime(
          this.dbToLinear(value),
          now,
          smoothTime,
        );
        break;
    }
  }

  /**
   * Renders the custom GUI for the compressor plugin
   * @param {HTMLElement} wrapper - Container element for the GUI
   * @param {Html} Html - HTML builder utility class
   */
  renderGUI(wrapper, Html) {
    this.activeControlIndex = 0;
    this.controlElements = [];

    const compContainer = new Html("div")
      .styleJs({
        display: "flex",
        gap: "0.75rem",
        justifyContent: "space-evenly",
        alignItems: "center",
        padding: "2rem 1rem",
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
          gap: "1.25rem",
          flex: "1",
        })
        .appendTo(compContainer);

      const valLabel = new Html("div")
        .styleJs({
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "700",
          fontSize: "1.1rem",
          color: "#89cff0",
          height: "1.5rem",
          transition: "color 0.2s ease",
          whiteSpace: "nowrap",
        })
        .appendTo(col);

      const trackContainer = new Html("div")
        .styleJs({
          position: "relative",
          width: "12px",
          height: "200px",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          borderRadius: "6px",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          display: "flex",
          justifyContent: "center",
        })
        .appendTo(col);

      if (ctrl.hasCenter) {
        new Html("div")
          .styleJs({
            position: "absolute",
            top: "50%",
            width: "24px",
            height: "2px",
            backgroundColor: "rgba(255, 255, 255, 0.3)",
            transform: "translateY(-50%)",
            zIndex: 1,
            pointerEvents: "none",
          })
          .appendTo(trackContainer);
      }

      const trackFill = new Html("div")
        .styleJs({
          position: "absolute",
          bottom: "0",
          width: "100%",
          backgroundColor: "rgba(137, 207, 240, 0.2)",
          borderRadius: "6px",
          transition: "height 0.1s linear, background-color 0.2s ease",
          zIndex: 1,
        })
        .appendTo(trackContainer);

      const faderThumb = new Html("div")
        .styleJs({
          position: "absolute",
          width: "30px",
          height: "14px",
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
          top: "-10px",
          bottom: "-10px",
          left: "-20px",
          right: "-20px",
          cursor: "pointer",
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
          fontSize: "1rem",
          color: "rgba(255, 255, 255, 0.5)",
          padding: "0.25rem 0.5rem",
          borderRadius: "6px",
          letterSpacing: "0.05em",
          transition: "all 0.2s ease",
          whiteSpace: "nowrap",
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
   * Sets up global mouse event listeners for fader interaction
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
   * Handles mouse movement on fader elements
   * @private
   * @param {MouseEvent} e - Mouse event
   * @param {number} idx - Control index
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
    const step = elData.ctrl.step;

    let val = min + percent * (max - min);

    val = Math.round(val / step) * step;
    val = Math.max(min, Math.min(max, val));

    this.setParameter(key, val);
    this._updateControlVisuals(idx);
  }

  /**
   * Updates all visual elements for a specific control
   * @private
   * @param {number} idx - Control index
   */
  _updateControlVisuals(idx) {
    const elData = this.controlElements[idx];
    const key = elData.ctrl.key;
    const val = this.parameters[key].value;

    elData.valLabel.text(elData.ctrl.format(val));

    const min = this.parameters[key].min;
    const max = this.parameters[key].max;
    const percentage = ((val - min) / (max - min)) * 100;

    elData.faderThumb.styleJs({ bottom: `calc(${percentage}% - 7px)` });
    elData.trackFill.styleJs({ height: `${percentage}%` });
  }

  /**
   * Updates the visual highlight for the active control
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
   * Handles keyboard input for control navigation and adjustment
   * @param {KeyboardEvent} e - Keyboard event
   * @returns {boolean} True if event was handled, false otherwise
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
      const step = elData.ctrl.step;

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
    this.inputGain.disconnect();
    this.compressorNode.disconnect();
    this.outputGain.disconnect();

    if (this._mouseMoveHandler) {
      window.removeEventListener("mousemove", this._mouseMoveHandler);
    }
    if (this._mouseUpHandler) {
      window.removeEventListener("mouseup", this._mouseUpHandler);
    }
  }
}
