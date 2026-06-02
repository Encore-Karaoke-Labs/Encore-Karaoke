/**
 * Converts a dB value to a linear amplitude value.
 * @param {number} db - The value in decibels.
 * @returns {number} The corresponding linear amplitude (0.0 to 1.0).
 */
function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * Audio worklet processor implementing a noise gate effect.
 * Silences audio below a threshold and applies attack/release envelope.
 * @extends AudioWorkletProcessor
 */
class NoiseGateProcessor extends AudioWorkletProcessor {
  /**
   * Defines the audio parameters for the noise gate.
   * @returns {Array<Object>} Array of parameter descriptors (threshold, attack, release).
   */
  static get parameterDescriptors() {
    return [
      {
        name: "threshold",
        defaultValue: dbToLinear(-50),
        minValue: dbToLinear(-100),
        maxValue: dbToLinear(0),
      },
      {
        name: "attack",
        defaultValue: 0.005,
        minValue: 0.001,
        maxValue: 0.2,
      },
      {
        name: "release",
        defaultValue: 0.1,
        minValue: 0.01,
        maxValue: 1.0,
      },
    ];
  }

  /**
   * Initializes the noise gate processor.
   * @param {Object} options - AudioWorkletProcessor options.
   */
  constructor(options) {
    super(options);
    this._gateState = "closed";
    this._currentGain = 0.0;
  }

  /**
   * Processes audio samples through the noise gate.
   * @param {Float32Array[][]} inputs - Input audio buffers.
   * @param {Float32Array[][]} outputs - Output audio buffers.
   * @param {Object} parameters - Audio parameters (threshold, attack, release).
   * @returns {boolean} Always returns true to keep the processor alive.
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    const threshold = parameters.threshold[0];
    const attackTime = parameters.attack[0];
    const releaseTime = parameters.release[0];

    const attackCoeff = Math.exp(-1.0 / (attackTime * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (releaseTime * sampleRate));

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
          this._currentGain = 1.0 + (this._currentGain - 1.0) * attackCoeff;
        } else {
          this._currentGain = 0.0 + (this._currentGain - 0.0) * releaseCoeff;
        }

        outputChannel[i] =
          sample * (this._currentGain < 0.0001 ? 0 : this._currentGain);
      }
    }

    return true;
  }
}

registerProcessor("noise-gate-processor", NoiseGateProcessor);
