import {
  BasePlugin
} from "../../chunk-CSEMMDI5.js";
import "../../chunk-7D4SUZUM.js";

// src/pkgs/plugins/ParametricEQ.js
var getFilterType = (typeString) => {
  const validTypes = [
    "lowshelf",
    "highshelf",
    "peaking",
    "highpass",
    "lowpass"
  ];
  return validTypes.includes(typeString) ? typeString : "peaking";
};
var ParametricEQPlugin = class extends BasePlugin {
  constructor(audioContext) {
    super(audioContext);
    this.name = "Parametric EQ";
    this.filters = [];
    this.parameters = {};
    this.input.connect(this.output);
  }
  /**
   * Builds the internal filter chain based on a configuration array.
   * @param {Array<object>} bandConfigs - Array of band configuration objects.
   */
  buildChain(bandConfigs) {
    this.input.disconnect();
    this.filters.forEach((f) => f.disconnect());
    this.filters = [];
    this.parameters = {};
    if (!bandConfigs || bandConfigs.length === 0) {
      this.input.connect(this.output);
      return;
    }
    bandConfigs.forEach((bandConfig, index) => {
      const filter = this.audioContext.createBiquadFilter();
      const type = getFilterType(bandConfig.type);
      filter.type = type;
      let defaultFreq = 1e3;
      if (type === "lowshelf" || type === "highpass") defaultFreq = 100;
      if (type === "highshelf" || type === "lowpass") defaultFreq = 1e4;
      const freq = bandConfig.freq !== void 0 ? bandConfig.freq : defaultFreq;
      const gain = bandConfig.gain !== void 0 ? bandConfig.gain : 0;
      const q = bandConfig.q !== void 0 ? bandConfig.q : 1;
      filter.frequency.value = freq;
      if (type === "peaking" || type === "lowshelf" || type === "highshelf") {
        filter.gain.value = gain;
      }
      if (type === "peaking" || type === "highpass" || type === "lowpass") {
        filter.Q.value = q;
      }
      this.filters.push(filter);
      const paramPrefix = `band${index}`;
      this.parameters[`${paramPrefix}_freq`] = {
        type: "slider",
        min: 20,
        max: 2e4,
        step: 1,
        unit: "Hz",
        value: freq,
        affectsChain: false
      };
      if (type === "peaking" || type === "lowshelf" || type === "highshelf") {
        this.parameters[`${paramPrefix}_gain`] = {
          type: "slider",
          min: -18,
          max: 18,
          step: 0.1,
          unit: "dB",
          value: gain,
          affectsChain: false
        };
      }
      if (type === "peaking" || type === "highpass" || type === "lowpass") {
        this.parameters[`${paramPrefix}_q`] = {
          type: "slider",
          min: 0.1,
          max: 18,
          step: 0.1,
          unit: "Q",
          value: q,
          affectsChain: false
        };
      }
    });
    let lastNode = this.input;
    this.filters.forEach((filter) => {
      lastNode.connect(filter);
      lastNode = filter;
    });
    lastNode.connect(this.output);
  }
  /**
   * Sets a parameter value and applies it to the corresponding filter.
   * @param {string} key - The parameter key (e.g., 'band0_freq', 'band1_gain', or 'bands').
   * @param {*} value - The new value to set.
   */
  setParameter(key, value) {
    const now = this.audioContext.currentTime;
    const smoothTime = 0.02;
    if (key === "bands") {
      this.parameters.bands = value;
      this.buildChain(value);
      return;
    }
    if (this.parameters[key]) {
      this.parameters[key].value = value;
    }
    const parts = key.split("_");
    if (parts.length !== 2) return;
    const bandIndex = parseInt(parts[0].replace("band", ""), 10);
    const paramType = parts[1];
    const filter = this.filters[bandIndex];
    if (!filter) return;
    switch (paramType) {
      case "freq":
        filter.frequency.setTargetAtTime(value, now, smoothTime);
        break;
      case "gain":
        if (filter.gain) {
          filter.gain.setTargetAtTime(value, now, smoothTime);
        }
        break;
      case "q":
        if (filter.Q) {
          filter.Q.setTargetAtTime(value, now, smoothTime);
        }
        break;
    }
  }
  /**
   * Disconnects all filters and cleans up resources.
   */
  disconnect() {
    super.disconnect();
    this.filters.forEach((f) => f.disconnect());
  }
};
export {
  ParametricEQPlugin as default
};
//# sourceMappingURL=ParametricEQ.js.map
