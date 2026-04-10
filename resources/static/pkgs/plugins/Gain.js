import BasePlugin from "/libs/BasePlugin.js";

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
   * Disconnects and cleans up the plugin
   */
  disconnect() {
    super.disconnect();
    this.gainNode.disconnect();
  }
}
