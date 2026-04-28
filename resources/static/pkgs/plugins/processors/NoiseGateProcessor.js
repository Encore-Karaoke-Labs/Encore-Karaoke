// src/pkgs/plugins/processors/NoiseGateProcessor.js
function dbToLinear(db) {
  return Math.pow(10, db / 20);
}
var NoiseGateProcessor = class extends AudioWorkletProcessor {
  // Define the parameters that can be controlled from the main thread.
  static get parameterDescriptors() {
    return [
      {
        name: "threshold",
        defaultValue: dbToLinear(-50),
        minValue: dbToLinear(-100),
        maxValue: dbToLinear(0)
      },
      {
        name: "attack",
        defaultValue: 5e-3,
        // 5ms
        minValue: 1e-3,
        maxValue: 0.2
      },
      {
        name: "release",
        defaultValue: 0.1,
        // 100ms
        minValue: 0.01,
        maxValue: 1
      }
    ];
  }
  constructor(options) {
    super(options);
    this._gateState = "closed";
    this._currentGain = 0;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const threshold = parameters.threshold[0];
    const attackTime = parameters.attack[0];
    const releaseTime = parameters.release[0];
    const attackCoeff = Math.exp(-1 / (attackTime * sampleRate));
    const releaseCoeff = Math.exp(-1 / (releaseTime * sampleRate));
    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];
      for (let i = 0; i < inputChannel.length; ++i) {
        const sample = inputChannel[i];
        const sampleAbs = Math.abs(sample);
        if (sampleAbs > threshold) {
          this._gateState = "opening";
        } else {
          this._gateState = "closing";
        }
        if (this._gateState === "opening") {
          this._currentGain = 1 + (this._currentGain - 1) * attackCoeff;
        } else {
          this._currentGain = 0 + (this._currentGain - 0) * releaseCoeff;
        }
        outputChannel[i] = sample * (this._currentGain < 1e-4 ? 0 : this._currentGain);
      }
    }
    return true;
  }
};
registerProcessor("noise-gate-processor", NoiseGateProcessor);
//# sourceMappingURL=NoiseGateProcessor.js.map
