import {
  BasePlugin
} from "../../chunk-CSEMMDI5.js";
import "../../chunk-7D4SUZUM.js";

// src/pkgs/plugins/NoiseGate.js
var WORKLET_PATH = "/pkgs/plugins/processors/NoiseGateProcessor.js";
var isWorkletLoaded = false;
function dbToLinear(db) {
  return Math.pow(10, db / 20);
}
var NoiseGatePlugin = class _NoiseGatePlugin extends BasePlugin {
  /**
   * Private constructor. Use the static `create` method instead.
   * @param {AudioContext} audioContext - The audio context.
   * @param {AudioWorkletNode} workletNode - The noise gate processing node.
   */
  constructor(audioContext, workletNode) {
    super(audioContext);
    this.name = "Noise Gate";
    this.workletNode = workletNode;
    this.parameters = {
      threshold: {
        type: "slider",
        min: -100,
        max: 0,
        step: 1,
        unit: "dB",
        value: -50
      },
      attack: {
        type: "slider",
        min: 1,
        max: 200,
        step: 1,
        unit: "ms",
        value: 5
      },
      release: {
        type: "slider",
        min: 10,
        max: 1e3,
        step: 10,
        unit: "ms",
        value: 100
      }
    };
    this.input.connect(this.workletNode).connect(this.output);
  }
  /**
   * Asynchronous factory method for creating an instance of the NoiseGatePlugin.
   * This is necessary because we need to load the AudioWorklet module before instantiation.
   */
  static async create(audioContext) {
    if (!isWorkletLoaded) {
      try {
        await audioContext.audioWorklet.addModule(WORKLET_PATH);
        isWorkletLoaded = true;
        console.log(
          "[FORTE SVC] NoiseGateProcessor worklet loaded successfully."
        );
      } catch (e) {
        console.error(
          `[FORTE SVC] Failed to load NoiseGateProcessor worklet from ${WORKLET_PATH}`,
          e
        );
        throw e;
      }
    }
    const workletNode = new AudioWorkletNode(
      audioContext,
      "noise-gate-processor"
    );
    return new _NoiseGatePlugin(audioContext, workletNode);
  }
  /**
   * Sets a parameter. Converts UI-friendly values (dB, ms) to the linear/seconds
   * values required by the AudioWorkletProcessor.
   */
  setParameter(key, value) {
    if (!this.workletNode) return;
    const param = this.workletNode.parameters.get(key);
    if (!param) return;
    this.parameters[key].value = value;
    let processedValue = value;
    if (key === "threshold") {
      processedValue = dbToLinear(value);
    } else if (key === "attack" || key === "release") {
      processedValue = value / 1e3;
    }
    param.setTargetAtTime(processedValue, this.audioContext.currentTime, 0.01);
  }
  /**
   * Disconnects the plugin from the audio graph and cleans up resources.
   */
  disconnect() {
    super.disconnect();
    if (this.workletNode) {
      this.workletNode.disconnect();
    }
  }
};
export {
  NoiseGatePlugin as default
};
//# sourceMappingURL=NoiseGate.js.map
