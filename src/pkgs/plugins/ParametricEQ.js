import BasePlugin from "../../libs/BasePlugin.js";

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_GAIN = -18;
const MAX_GAIN = 18;

/**
 * Validates and coerces a filter type string to a valid BiquadFilterType.
 * @param {string} typeString - The filter type to validate
 * @returns {string} A valid BiquadFilterType or "peaking" as default
 */
const getFilterType = (typeString) => {
  const validTypes = [
    "lowshelf",
    "highshelf",
    "peaking",
    "highpass",
    "lowpass",
  ];
  return validTypes.includes(typeString) ? typeString : "peaking";
};

/**
 * ParametricEQ - Encore's multi-band parametric equalizer.
 */
export default class ParametricEQPlugin extends BasePlugin {
  /**
   * @param {AudioContext} audioContext - The Web Audio API context
   */
  constructor(audioContext) {
    super(audioContext);
    this.name = "Parametric EQ";

    this.filters = [];
    this.parameters = {};

    this.postAnalyser = this.audioContext.createAnalyser();
    this.postAnalyser.fftSize = 2048;
    this.postAnalyser.smoothingTimeConstant = 0.8;

    this.postData = new Float32Array(this.postAnalyser.frequencyBinCount);

    this.input.connect(this.postAnalyser);
    this.postAnalyser.connect(this.output);

    this._isGuiMounted = false;
    this.activeNodeIndex = 0;
    this.hoveredNodeIndex = -1;
    this.isDragging = false;
    this._drawRafId = null;
    this.activeReadouts = {};
  }

  /**
   * Retrieves the current configuration of all active bands.
   * @returns {Array<Object>} Array of band configurations with type, freq, gain, and q
   */
  getCurrentBandsConfig() {
    return this.filters.map((f) => ({
      type: f.type,
      freq: f.frequency.value,
      gain: f.gain ? f.gain.value : 0,
      q: f.Q ? f.Q.value : 1.0,
    }));
  }

  /**
   * Rebuilds the internal BiquadFilter chain based on band configurations.
   * @param {Array<Object>} bandConfigs - Array of band configuration objects
   */
  buildChain(bandConfigs) {
    this.input.disconnect();
    this.postAnalyser.disconnect();
    this.filters.forEach((f) => f.disconnect());
    this.filters = [];
    this.parameters = {};

    if (!bandConfigs || bandConfigs.length === 0) {
      this.input.connect(this.postAnalyser);
      this.postAnalyser.connect(this.output);
      this._rebuildGUIBottomPanel();
      return;
    }

    bandConfigs.forEach((bandConfig, index) => {
      const filter = this.audioContext.createBiquadFilter();
      const type = getFilterType(bandConfig.type);
      filter.type = type;

      const freq = bandConfig.freq !== undefined ? bandConfig.freq : 1000;
      const gain = bandConfig.gain !== undefined ? bandConfig.gain : 0;
      const q = bandConfig.q !== undefined ? bandConfig.q : 1.0;

      filter.frequency.value = freq;
      if (["peaking", "lowshelf", "highshelf"].includes(type))
        filter.gain.value = gain;
      if (["peaking", "highpass", "lowpass"].includes(type)) filter.Q.value = q;

      this.filters.push(filter);

      const paramPrefix = `band${index}`;
      this.parameters[`${paramPrefix}_freq`] = {
        min: 20,
        max: 20000,
        value: freq,
      };
      this.parameters[`${paramPrefix}_gain`] = {
        min: -18,
        max: 18,
        value: gain,
      };
      this.parameters[`${paramPrefix}_q`] = { min: 0.1, max: 18, value: q };
    });

    let lastNode = this.input;
    this.filters.forEach((filter) => {
      lastNode.connect(filter);
      lastNode = filter;
    });
    lastNode.connect(this.postAnalyser);
    this.postAnalyser.connect(this.output);

    this.activeNodeIndex = Math.min(
      this.activeNodeIndex,
      Math.max(0, this.filters.length - 1),
    );
    this._rebuildGUIBottomPanel();
  }

  /**
   * Sets a parameter value and updates the corresponding audio filter.
   * @param {string} key - Parameter key (e.g., "bands", "band0_freq", "band0_gain")
   * @param {*} value - The value to set
   */
  setParameter(key, value) {
    if (key === "bands") {
      this.parameters.bands = value;
      this.buildChain(value);
      return;
    }

    if (this.parameters[key]) this.parameters[key].value = value;

    const parts = key.split("_");
    if (parts.length !== 2) return;

    const bandIndex = parseInt(parts[0].replace("band", ""), 10);
    const paramType = parts[1];
    const filter = this.filters[bandIndex];
    if (!filter) return;

    const now = this.audioContext.currentTime;
    const smooth = 0.02;

    switch (paramType) {
      case "freq":
        filter.frequency.setTargetAtTime(value, now, smooth);
        break;
      case "gain":
        if (filter.gain) filter.gain.setTargetAtTime(value, now, smooth);
        break;
      case "q":
        if (filter.Q) filter.Q.setTargetAtTime(value, now, smooth);
        break;
    }

    this._updateBottomPanelText();
  }

  /**
   * Adds a new peaking band to the equalizer.
   */
  addNewBand() {
    const bands = this.getCurrentBandsConfig();
    if (bands.length >= 8) return;
    bands.push({ type: "peaking", freq: 1000, gain: 0, q: 1.0 });
    this.setParameter("bands", bands);
    this.activeNodeIndex = bands.length - 1;
    this._rebuildGUIBottomPanel();
  }

  /**
   * Removes a band at the specified index.
   * @param {number} index - The band index to remove
   */
  removeBand(index) {
    const bands = this.getCurrentBandsConfig();
    bands.splice(index, 1);
    this.activeNodeIndex = Math.max(0, index - 1);
    this.setParameter("bands", bands);
  }

  /**
   * Cycles the filter type of a band to the next type in the sequence.
   * @param {number} index - The band index
   */
  cycleBandType(index) {
    const bands = this.getCurrentBandsConfig();
    const types = ["peaking", "lowshelf", "highshelf", "highpass", "lowpass"];
    const currentIdx = types.indexOf(bands[index].type);
    bands[index].type = types[(currentIdx + 1) % types.length];
    this.setParameter("bands", bands);
  }

  /**
   * Renders the GUI with canvas visualization and control panel.
   * @param {HTMLElement} wrapper - The container element
   * @param {Object} Html - The Html utility object for creating elements
   */
  renderGUI(wrapper, Html) {
    this._guiWrapper = wrapper;
    this._Html = Html;
    this._isGuiMounted = true;

    this.mainContainer = new Html("div")
      .styleJs({
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1.5rem",
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        borderRadius: "12px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        boxShadow: "inset 0 5px 20px rgba(0,0,0,0.5)",
        width: "100%",
        boxSizing: "border-box",
      })
      .appendTo(this._guiWrapper);

    const canvasWrapper = new Html("div")
      .styleJs({
        width: "100%",
        height: "260px",
        backgroundColor: "rgba(10, 10, 15, 0.8)",
        borderRadius: "8px",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        overflow: "hidden",
        position: "relative",
        cursor: "crosshair",
        boxSizing: "border-box",
      })
      .appendTo(this.mainContainer);

    this.canvas = new Html("canvas")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        display: "block",
      })
      .appendTo(canvasWrapper);

    this.canvasCtx = this.canvas.elm.getContext("2d");

    this.bottomPanel = new Html("div")
      .styleJs({
        display: "flex",
        flexDirection: "column",
        gap: "0.8rem",
        width: "100%",
        boxSizing: "border-box",
      })
      .appendTo(this.mainContainer);

    this._setupCanvasInteraction();
    this._rebuildGUIBottomPanel();
    this._startRenderLoop();
  }

  _rebuildGUIBottomPanel() {
    if (!this.bottomPanel) return;
    this.bottomPanel.clear();
    const Html = this._Html;
    this.activeReadouts = {};

    const tabsRow = new Html("div")
      .styleJs({
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
      })
      .appendTo(this.bottomPanel);

    this.filters.forEach((filter, index) => {
      const isActive = index === this.activeNodeIndex;
      const tab = new Html("div")
        .styleJs({
          padding: "0.5rem 1.2rem",
          borderRadius: "6px",
          cursor: "var(--cursor-pointer)",
          background: isActive
            ? "rgba(255, 215, 0, 0.2)"
            : "rgba(255, 255, 255, 0.05)",
          border: isActive ? "1px solid #ffd700" : "1px solid transparent",
          color: isActive ? "#ffd700" : "rgba(255,255,255,0.7)",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "700",
          fontSize: "1.1rem",
          transition: "all 0.1s ease",
        })
        .text(`BAND ${index + 1}`)
        .appendTo(tabsRow);

      tab.on("click", () => {
        this.activeNodeIndex = index;
        this._rebuildGUIBottomPanel();
      });
    });

    if (this.filters.length < 8) {
      const addTab = new Html("div")
        .styleJs({
          padding: "0.5rem 1.2rem",
          borderRadius: "6px",
          cursor: "var(--cursor-pointer)",
          background: "rgba(137, 207, 240, 0.1)",
          border: "1px dashed rgba(137, 207, 240, 0.5)",
          color: "#89cff0",
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: "700",
          fontSize: "1.1rem",
          transition: "all 0.1s ease",
        })
        .text("+ ADD BAND")
        .appendTo(tabsRow);

      addTab.on("click", () => this.addNewBand());
    }

    const controlsPanel = new Html("div")
      .styleJs({
        display: "flex",
        gap: "2rem",
        padding: "1.2rem",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "8px",
        flexWrap: "wrap",
      })
      .appendTo(this.bottomPanel);

    if (this.filters.length === 0) {
      controlsPanel.styleJs({ justifyContent: "center" });
      new Html("div")
        .styleJs({
          color: "rgba(255,255,255,0.5)",
          fontStyle: "italic",
          textAlign: "center",
        })
        .text(
          "Double click the graph above or click '+ ADD BAND' to start shaping.",
        )
        .appendTo(controlsPanel);
      return;
    }

    const filter = this.filters[this.activeNodeIndex];

    const leftGroup = new Html("div")
      .styleJs({ display: "flex", gap: "2rem", alignItems: "center" })
      .appendTo(controlsPanel);

    const typeWrap = new Html("div")
      .styleJs({ display: "flex", flexDirection: "column", gap: "0.3rem" })
      .appendTo(leftGroup);
    new Html("span")
      .styleJs({
        fontSize: "0.8rem",
        color: "rgba(255,255,255,0.5)",
        fontWeight: "bold",
      })
      .text("FILTER TYPE")
      .appendTo(typeWrap);
    const typeBtn = new Html("div")
      .styleJs({
        background: "rgba(0,0,0,0.5)",
        border: "1px solid rgba(137,207,240,0.3)",
        padding: "0.4rem 1rem",
        borderRadius: "4px",
        fontSize: "0.9rem",
        color: "#89cff0",
        fontWeight: "bold",
        cursor: "var(--cursor-pointer)",
        textAlign: "center",
      })
      .text(filter.type.toUpperCase())
      .appendTo(typeWrap);
    typeBtn.on("click", () => this.cycleBandType(this.activeNodeIndex));

    const freqWrap = new Html("div")
      .styleJs({ display: "flex", flexDirection: "column", gap: "0.3rem" })
      .appendTo(leftGroup);
    new Html("span")
      .styleJs({
        fontSize: "0.8rem",
        color: "rgba(255,255,255,0.5)",
        fontWeight: "bold",
      })
      .text("FREQUENCY")
      .appendTo(freqWrap);
    this.activeReadouts.freq = new Html("div")
      .styleJs({
        fontSize: "1.2rem",
        fontWeight: "bold",
        color: "#fff",
        fontFamily: "'Rajdhani', sans-serif",
      })
      .appendTo(freqWrap);

    const midGroup = new Html("div")
      .styleJs({ display: "flex", gap: "2rem", alignItems: "center" })
      .appendTo(controlsPanel);

    const gainWrap = new Html("div")
      .styleJs({ display: "flex", flexDirection: "column", gap: "0.3rem" })
      .appendTo(midGroup);
    new Html("span")
      .styleJs({
        fontSize: "0.8rem",
        color: "rgba(255,255,255,0.5)",
        fontWeight: "bold",
      })
      .text("GAIN")
      .appendTo(gainWrap);
    this.activeReadouts.gain = new Html("div")
      .styleJs({
        fontSize: "1.2rem",
        fontWeight: "bold",
        color: "#fff",
        fontFamily: "'Rajdhani', sans-serif",
      })
      .appendTo(gainWrap);

    const qWrap = new Html("div")
      .styleJs({ display: "flex", flexDirection: "column", gap: "0.3rem" })
      .appendTo(midGroup);
    new Html("span")
      .styleJs({
        fontSize: "0.8rem",
        color: "rgba(255,255,255,0.5)",
        fontWeight: "bold",
      })
      .text("Q / BANDWIDTH")
      .appendTo(qWrap);
    this.activeReadouts.q = new Html("div")
      .styleJs({
        fontSize: "1.2rem",
        fontWeight: "bold",
        color: "#fff",
        fontFamily: "'Rajdhani', sans-serif",
      })
      .appendTo(qWrap);

    const rightGroup = new Html("div")
      .styleJs({ display: "flex", alignItems: "center" })
      .appendTo(controlsPanel);
    const delBtn = new Html("div")
      .styleJs({
        background: "rgba(255, 85, 85, 0.1)",
        border: "1px solid rgba(255, 85, 85, 0.4)",
        padding: "0.4rem 1rem",
        borderRadius: "4px",
        fontSize: "0.85rem",
        color: "#ff5555",
        fontWeight: "bold",
        cursor: "var(--cursor-pointer)",
      })
      .text("REMOVE BAND")
      .appendTo(rightGroup);
    delBtn.on("click", () => this.removeBand(this.activeNodeIndex));

    this._updateBottomPanelText();
  }

  _updateBottomPanelText() {
    if (!this.activeReadouts || this.filters.length === 0) return;

    const idx = this.activeNodeIndex;
    const filter = this.filters[idx];

    if (this.activeReadouts.freq) {
      const freq = this.parameters[`band${idx}_freq`].value;
      const fStr =
        freq >= 1000 ? (freq / 1000).toFixed(2) + "k" : Math.round(freq);
      this.activeReadouts.freq.text(`${fStr} Hz`);
    }

    if (this.activeReadouts.gain) {
      if (["peaking", "lowshelf", "highshelf"].includes(filter.type)) {
        const gain = this.parameters[`band${idx}_gain`].value;
        this.activeReadouts.gain.text(
          `${gain > 0 ? "+" : ""}${gain.toFixed(1)} dB`,
        );
        this.activeReadouts.gain.styleJs({ opacity: "1" });
      } else {
        this.activeReadouts.gain.text("N/A");
        this.activeReadouts.gain.styleJs({ opacity: "0.3" });
      }
    }

    if (this.activeReadouts.q) {
      if (["peaking", "highpass", "lowpass"].includes(filter.type)) {
        const q = this.parameters[`band${idx}_q`].value;
        this.activeReadouts.q.text(q.toFixed(2));
        this.activeReadouts.q.styleJs({ opacity: "1" });
      } else {
        this.activeReadouts.q.text("N/A");
        this.activeReadouts.q.styleJs({ opacity: "0.3" });
      }
    }
  }

  _freqToX(freq, width) {
    return (Math.log(freq / MIN_FREQ) / Math.log(MAX_FREQ / MIN_FREQ)) * width;
  }

  _xToFreq(x, width) {
    return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, x / width);
  }

  _gainToY(gain, height) {
    return height / 2 - (gain / MAX_GAIN) * (height / 2);
  }

  _yToGain(y, height) {
    return ((height / 2 - y) / (height / 2)) * MAX_GAIN;
  }

  _setupCanvasInteraction() {
    const getMousePos = (e) => {
      const rect = this.canvas.elm.getBoundingClientRect();
      const scaleX = this.canvas.elm.width / rect.width;
      const scaleY = this.canvas.elm.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    this.canvas.elm.addEventListener("dblclick", (e) => {
      if (this.filters.length >= 8) return;
      const pos = getMousePos(e);
      const freq = Math.round(this._xToFreq(pos.x, this.canvas.elm.width));
      const gain =
        Math.round(this._yToGain(pos.y, this.canvas.elm.height) * 10) / 10;

      const bands = this.getCurrentBandsConfig();
      bands.push({ type: "peaking", freq, gain, q: 1.0 });
      this.setParameter("bands", bands);
      this.activeNodeIndex = bands.length - 1;
      this._rebuildGUIBottomPanel();
    });

    this.canvas.elm.addEventListener("mousedown", (e) => {
      const pos = getMousePos(e);
      let closestIdx = -1;
      let closestDist = 35;

      this.filters.forEach((filter, idx) => {
        const x = this._freqToX(filter.frequency.value, this.canvas.elm.width);
        const y = ["highpass", "lowpass"].includes(filter.type)
          ? this.canvas.elm.height / 2
          : this._gainToY(filter.gain.value, this.canvas.elm.height);
        const dist = Math.hypot(pos.x - x, pos.y - y);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      if (closestIdx !== -1) {
        if (this.activeNodeIndex !== closestIdx) {
          this.activeNodeIndex = closestIdx;
          this._rebuildGUIBottomPanel(); // Update bottom panel to newly clicked node
        }
        this.isDragging = true;
      }
    });

    this.canvas.elm.addEventListener("mousemove", (e) => {
      const pos = getMousePos(e);

      if (!this.isDragging) {
        let hIdx = -1;
        let cDist = 35;
        this.filters.forEach((f, idx) => {
          const x = this._freqToX(f.frequency.value, this.canvas.elm.width);
          const y = ["highpass", "lowpass"].includes(f.type)
            ? this.canvas.elm.height / 2
            : this._gainToY(f.gain.value, this.canvas.elm.height);
          const dist = Math.hypot(pos.x - x, pos.y - y);
          if (dist < cDist) {
            cDist = dist;
            hIdx = idx;
          }
        });
        this.hoveredNodeIndex = hIdx;
        this.canvas.elm.style.cursor = hIdx !== -1 ? "pointer" : "crosshair";
        return;
      }

      if (this.activeNodeIndex !== -1 && this.filters[this.activeNodeIndex]) {
        const type = this.filters[this.activeNodeIndex].type;

        let newFreq = this._xToFreq(pos.x, this.canvas.elm.width);
        newFreq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, newFreq));
        this.setParameter(
          `band${this.activeNodeIndex}_freq`,
          Math.round(newFreq),
        );

        if (["peaking", "lowshelf", "highshelf"].includes(type)) {
          let newGain = this._yToGain(pos.y, this.canvas.elm.height);
          newGain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, newGain));
          this.setParameter(
            `band${this.activeNodeIndex}_gain`,
            Math.round(newGain * 10) / 10,
          );
        }
      }
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    this.canvas.elm.addEventListener("wheel", (e) => {
      e.preventDefault();
      const targetIdx =
        this.hoveredNodeIndex !== -1
          ? this.hoveredNodeIndex
          : this.isDragging
            ? this.activeNodeIndex
            : -1;

      if (
        targetIdx !== -1 &&
        ["peaking", "highpass", "lowpass"].includes(
          this.filters[targetIdx].type,
        )
      ) {
        const currentQ = this.parameters[`band${targetIdx}_q`].value;
        let newQ = currentQ + (e.deltaY > 0 ? -0.2 : 0.2);
        newQ = Math.max(0.1, Math.min(18, newQ));
        this.setParameter(`band${targetIdx}_q`, Math.round(newQ * 10) / 10);
      }
    });
  }

  _startRenderLoop() {
    if (this._drawRafId) cancelAnimationFrame(this._drawRafId);

    const draw = () => {
      if (!this._isGuiMounted || !this.canvasCtx) return;
      this._renderCanvasFrame();
      this._drawRafId = requestAnimationFrame(draw);
    };
    draw();
  }

  _renderCanvasFrame() {
    const parentWidth = this.canvas.elm.parentElement.clientWidth;
    const parentHeight = this.canvas.elm.parentElement.clientHeight;

    if (this.canvas.elm.width !== parentWidth)
      this.canvas.elm.width = parentWidth;
    if (this.canvas.elm.height !== parentHeight)
      this.canvas.elm.height = parentHeight;

    const width = this.canvas.elm.width;
    const height = this.canvas.elm.height;
    const ctx = this.canvasCtx;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const gridFreqs = [50, 100, 500, 1000, 5000, 10000];
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.font = "12px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";

    gridFreqs.forEach((f) => {
      const x = this._freqToX(f, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? f / 1000 + "k" : f, x, height - 6);
    });

    this._renderFFT(ctx, width, height);
    this._renderEQCurve(ctx, width, height);
    this._renderNodes(ctx, width, height);
  }

  _renderFFT(ctx, width, height) {
    this.postAnalyser.getFloatFrequencyData(this.postData);

    const nyquist = this.audioContext.sampleRate / 2;
    const binCount = this.postAnalyser.frequencyBinCount;

    ctx.fillStyle = "rgba(137, 207, 240, 0.25)";
    ctx.beginPath();
    ctx.moveTo(0, height);

    for (let i = 0; i < binCount; i++) {
      const freq = (i * nyquist) / binCount;
      if (freq < MIN_FREQ) continue;
      if (freq > MAX_FREQ) break;

      const x = this._freqToX(freq, width);
      let db = this.postData[i];
      let y = height - ((db + 100) / 70) * height;
      y = Math.max(0, Math.min(height, y));

      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.fill();
  }

  _renderEQCurve(ctx, width, height) {
    if (this.filters.length === 0) return;

    const numPoints = width;
    const freqs = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      freqs[i] = this._xToFreq(i, width);
    }

    const totalMagDb = new Float32Array(numPoints);

    this.filters.forEach((filter) => {
      const mag = new Float32Array(numPoints);
      const phase = new Float32Array(numPoints);
      filter.getFrequencyResponse(freqs, mag, phase);
      for (let i = 0; i < numPoints; i++) {
        totalMagDb[i] += 20 * Math.log10(Math.max(mag[i], 1e-10));
      }
    });

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.shadowColor = "#89cff0";
    ctx.shadowBlur = 8;
    ctx.beginPath();

    for (let i = 0; i < numPoints; i++) {
      const x = i;
      let y = this._gainToY(totalMagDb[i], height);
      y = Math.max(0, Math.min(height, y));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _renderNodes(ctx, width, height) {
    this.filters.forEach((filter, idx) => {
      const x = this._freqToX(filter.frequency.value, width);
      const y = ["highpass", "lowpass"].includes(filter.type)
        ? height / 2
        : this._gainToY(filter.gain.value, height);

      const isActive = idx === this.activeNodeIndex;
      const isHovered = idx === this.hoveredNodeIndex;

      if (["peaking", "highpass", "lowpass"].includes(filter.type)) {
        const qLen = 60 / filter.Q.value;
        ctx.strokeStyle = isActive
          ? "rgba(255, 215, 0, 0.6)"
          : "rgba(137, 207, 240, 0.4)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - qLen, y);
        ctx.lineTo(x + qLen, y);
        ctx.stroke();
      }

      const radius = isHovered || isActive ? 14 : 10;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? "#ffd700" : isHovered ? "#ffffff" : "#89cff0";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.stroke();

      ctx.fillStyle = "#000";
      ctx.font = "bold 12px 'Rajdhani', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((idx + 1).toString(), x, y + 1);
    });
  }

  // --- KEYBOARD INTERACTION ---

  /**
   * Handles keyboard input for band selection and parameter adjustment.
   * @param {KeyboardEvent} e - The keyboard event
   * @returns {boolean} Whether the key was handled
   */
  handleKeyDown(e) {
    if (this.filters.length === 0) return false;

    if (e.key === "ArrowLeft") {
      if (this.activeNodeIndex > 0) {
        this.activeNodeIndex--;
        this._rebuildGUIBottomPanel();
        return true;
      }
      return false;
    } else if (e.key === "ArrowRight") {
      if (this.activeNodeIndex < this.filters.length - 1) {
        this.activeNodeIndex++;
        this._rebuildGUIBottomPanel();
        return true;
      }
      return false;
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const filter = this.filters[this.activeNodeIndex];
      const type = filter.type;

      if (["peaking", "lowshelf", "highshelf"].includes(type)) {
        let gain = this.parameters[`band${this.activeNodeIndex}_gain`].value;
        gain += e.key === "ArrowUp" ? 0.5 : -0.5;
        gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain));
        this.setParameter(`band${this.activeNodeIndex}_gain`, gain);
      } else {
        let freq = this.parameters[`band${this.activeNodeIndex}_freq`].value;
        freq *= e.key === "ArrowUp" ? 1.05 : 0.95;
        freq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, freq));
        this.setParameter(`band${this.activeNodeIndex}_freq`, Math.round(freq));
      }
      return true;
    } else if (e.key === "Enter") {
      this.cycleBandType(this.activeNodeIndex);
      return true;
    }

    return false;
  }

  /**
   * Cleans up resources and disconnects all audio nodes.
   */
  disconnect() {
    this._isGuiMounted = false;
    if (this._drawRafId) cancelAnimationFrame(this._drawRafId);

    super.disconnect();
    this.postAnalyser.disconnect();
    this.filters.forEach((f) => f.disconnect());
  }
}
