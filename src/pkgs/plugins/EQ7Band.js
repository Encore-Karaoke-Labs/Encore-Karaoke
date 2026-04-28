import BasePlugin from "../../libs/BasePlugin.js";

const BANDS = [60, 150, 400, 1000, 2400, 6000, 15000];

export default class EQ7BandPlugin extends BasePlugin {
  constructor(audioContext) {
    super(audioContext);
    this.name = "7-Band Graphic EQ";

    this.filters = BANDS.map((freq) => {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = freq;
      filter.Q.value = 1.41;
      filter.gain.value = 0;
      return filter;
    });

    this.parameters = {};
    BANDS.forEach((freq) => {
      const paramName = `gain${freq}Hz`;
      this.parameters[paramName] = {
        type: "slider",
        min: -12,
        max: 12,
        step: 0.1,
        unit: "dB",
        value: 0,
      };
    });

    // Chain the filters together
    this.input.connect(this.filters[0]);
    for (let i = 0; i < this.filters.length - 1; i++) {
      this.filters[i].connect(this.filters[i + 1]);
    }
    this.filters[this.filters.length - 1].connect(this.output);

    // Mouse drag state
    this.isDragging = false;
    this.currentDragIndex = -1;
  }

  setParameter(key, value) {
    const index = BANDS.findIndex((freq) => `gain${freq}Hz` === key);
    if (index !== -1) {
      this.parameters[key].value = value;
      this.filters[index].gain.setTargetAtTime(
        value,
        this.audioContext.currentTime,
        0.01,
      );
    }
  }

  // ======================================================================
  // --- CUSTOM GUI IMPLEMENTATION ---
  // ======================================================================

  renderGUI(wrapper, Html) {
    this.activeBandIndex = 0;
    this.bandElements = [];

    // Main EQ Panel Container
    const eqContainer = new Html("div")
      .styleJs({
        display: "flex",
        gap: "1rem",
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

    BANDS.forEach((freq, idx) => {
      // Column for each band
      const bandCol = new Html("div")
        .styleJs({
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1rem",
        })
        .appendTo(eqContainer);

      // 1. Top Label (Current dB Value)
      const valLabel = new Html("div")
        .styleJs({
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "700",
          fontSize: "1.2rem",
          color: "#89cff0",
          height: "1.5rem",
          transition: "color 0.2s ease",
        })
        .appendTo(bandCol);

      // 2. Fader Track Container
      const trackContainer = new Html("div")
        .styleJs({
          position: "relative",
          width: "12px",
          height: "220px",
          backgroundColor: "rgba(0, 0, 0, 0.6)",
          borderRadius: "6px",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          display: "flex",
          justifyContent: "center",
        })
        .appendTo(bandCol);

      // 2a. Zero dB Center Line Marker
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

      // 2b. Fader Thumb
      const faderThumb = new Html("div")
        .styleJs({
          position: "absolute",
          width: "28px",
          height: "14px",
          backgroundColor: "#89cff0",
          borderRadius: "4px",
          boxShadow: "0 0 10px rgba(137, 207, 240, 0.4)",
          zIndex: 2,
          pointerEvents: "none",
          transition: "background-color 0.2s ease, box-shadow 0.2s ease", // Removed 'bottom' transition for instant 1:1 mouse tracking
        })
        .appendTo(trackContainer);

      // 2c. Invisible Hit Area for easier clicking/dragging
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

      // --- MOUSE EVENTS ---
      hitArea.on("mousedown", (e) => {
        this.isDragging = true;
        this.currentDragIndex = idx;
        this.activeBandIndex = idx;
        this._updatePluginHighlight();
        this._handleMouseFader(e, idx);
      });

      // 3. Bottom Label (Frequency)
      const freqLabel = new Html("div")
        .styleJs({
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "600",
          fontSize: "1.1rem",
          color: "rgba(255, 255, 255, 0.5)",
          padding: "0.25rem 0.5rem",
          borderRadius: "6px",
          transition: "all 0.2s ease",
        })
        .text(`${freq >= 1000 ? freq / 1000 + "k" : freq}Hz`)
        .appendTo(bandCol);

      this.bandElements.push({
        valLabel,
        trackContainer,
        faderThumb,
        freqLabel,
        freq,
      });

      // Initialize the visual position
      this._updateBandVisuals(idx);
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
    const band = this.bandElements[idx];
    const rect = band.trackContainer.elm.getBoundingClientRect();

    // Calculate mouse Y position relative to the track's bounding box
    let y = e.clientY - rect.top;

    // Clamp Y to the track's boundaries (0 to height)
    y = Math.max(0, Math.min(rect.height, y));

    // Convert Y position to a percentage (0.0 at bottom, 1.0 at top)
    const percent = 1 - y / rect.height;

    const key = `gain${band.freq}Hz`;
    const min = this.parameters[key].min;
    const max = this.parameters[key].max;

    // Calculate new value based on percentage
    let val = min + percent * (max - min);

    // Snap to standard 0.1 steps
    val = Math.round(val * 10) / 10;

    this.setParameter(key, val);
    this._updateBandVisuals(idx);
  }

  // --- VISUAL UPDATES ---

  // Helper: Updates the text and thumb position of a specific band
  _updateBandVisuals(idx) {
    const band = this.bandElements[idx];
    const key = `gain${band.freq}Hz`;
    const val = this.parameters[key].value;

    // Format text (e.g., "+3.0", "0.0", "-2.5")
    const sign = val > 0 ? "+" : "";
    band.valLabel.text(`${sign}${val.toFixed(1)}`);

    // Calculate thumb vertical percentage (-12 to +12 maps to 0% to 100%)
    const min = this.parameters[key].min;
    const max = this.parameters[key].max;
    const percentage = ((val - min) / (max - min)) * 100;

    // -7px centers the 14px tall thumb on the exact percentage line
    band.faderThumb.styleJs({ bottom: `calc(${percentage}% - 7px)` });
  }

  // Helper: Visually highlights the currently keyboard-focused band
  _updatePluginHighlight() {
    this.bandElements.forEach((band, idx) => {
      if (idx === this.activeBandIndex) {
        band.valLabel.styleJs({ color: "#ffd700" }); // Gold
        band.faderThumb.styleJs({
          backgroundColor: "#ffd700",
          boxShadow: "0 0 15px rgba(255, 215, 0, 0.6)",
        });
        band.freqLabel.styleJs({
          color: "#010141",
          backgroundColor: "#ffd700",
        });
      } else {
        band.valLabel.styleJs({ color: "#89cff0" }); // Blue
        band.faderThumb.styleJs({
          backgroundColor: "#89cff0",
          boxShadow: "0 0 10px rgba(137, 207, 240, 0.4)",
        });
        band.freqLabel.styleJs({
          color: "rgba(255, 255, 255, 0.5)",
          backgroundColor: "transparent",
        });
      }
    });
  }

  // --- KEYBOARD INTERACTION ---

  handleKeyDown(e) {
    if (e.key === "ArrowLeft") {
      if (this.activeBandIndex > 0) {
        this.activeBandIndex--;
        this._updatePluginHighlight();
        return true;
      }
      return false; // Exit plugin focus, go back to mixer list
    } else if (e.key === "ArrowRight") {
      if (this.activeBandIndex < BANDS.length - 1) {
        this.activeBandIndex++;
        this._updatePluginHighlight();
        return true;
      }
      return false; // Hit right edge
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();

      const freq = BANDS[this.activeBandIndex];
      const key = `gain${freq}Hz`;
      let val = this.parameters[key].value;

      // Fine-tune by 1 dB on up/down
      val += e.key === "ArrowUp" ? 1 : -1;
      val = Math.max(
        this.parameters[key].min,
        Math.min(this.parameters[key].max, val),
      );

      this.setParameter(key, val); // Update the audio engine
      this._updateBandVisuals(this.activeBandIndex); // Animate the thumb and text
      return true;
    }

    return false; // Let "Escape" or "Tab" fall through to Mixer.js
  }

  disconnect() {
    super.disconnect();
    this.filters.forEach((f) => f.disconnect());

    // Clean up global window events to prevent memory leaks
    if (this._mouseMoveHandler) {
      window.removeEventListener("mousemove", this._mouseMoveHandler);
    }
    if (this._mouseUpHandler) {
      window.removeEventListener("mouseup", this._mouseUpHandler);
    }
  }
}
