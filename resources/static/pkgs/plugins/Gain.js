import {
  BasePlugin
} from "../../chunk-CSEMMDI5.js";
import "../../chunk-7D4SUZUM.js";

// src/pkgs/plugins/Gain.js
var GainPlugin = class extends BasePlugin {
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
        value: 1
      }
    };
    this.input.connect(this.gainNode).connect(this.output);
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
        0.01
      );
    }
  }
  /**
   * Disconnects and cleans up the plugin
   */
  disconnect() {
    super.disconnect();
    this.gainNode.disconnect();
  }
};
export {
  GainPlugin as default
};
//# sourceMappingURL=Gain.js.map
