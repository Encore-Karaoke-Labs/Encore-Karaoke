/**
 * Converts a dB value to a linear amplitude value.
 * @param {number} db - The value in decibels.
 * @returns {number} The corresponding linear amplitude (0.0 to 1.0).
 */
function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

class NoiseGateProcessor extends AudioWorkletProcessor {
  // Define the parameters that can be controlled from the main thread.
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
        defaultValue: 0.005, // 5ms
        minValue: 0.001,
        maxValue: 0.2,
      },
      {
        name: "release",
        defaultValue: 0.1, // 100ms
        minValue: 0.01,
        maxValue: 1.0,
      },
    ];
  }

  constructor(options) {
    super(options);
    this._gateState = "closed"; // Can be 'closed', 'opening', 'open', 'closing'
    this._currentGain = 0.0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    // Get parameter values for this processing block.
    const threshold = parameters.threshold[0];
    const attackTime = parameters.attack[0];
    const releaseTime = parameters.release[0];

    // Calculate attack and release coefficients.
    // These determine how quickly the gain changes per sample.
    const attackCoeff = Math.exp(-1.0 / (attackTime * sampleRate));
    const releaseCoeff = Math.exp(-1.0 / (releaseTime * sampleRate));

    for (let channel = 0; channel < input.length; ++channel) {
      const inputChannel = input[channel];
      const outputChannel = output[channel];

      for (let i = 0; i < inputChannel.length; ++i) {
        const sample = inputChannel[i];
        const sampleAbs = Math.abs(sample);

        // --- State Machine for the Gate ---
        if (sampleAbs > threshold) {
          this._gateState = "opening";
        } else {
          this._gateState = "closing";
        }

        // --- Envelope Following (Gain Calculation) ---
        if (this._gateState === "opening") {
          // Move gain towards 1.0 (open)
          this._currentGain = 1.0 + (this._currentGain - 1.0) * attackCoeff;
        } else {
          // 'closing'
          // Move gain towards 0.0 (closed)
          this._currentGain = 0.0 + (this._currentGain - 0.0) * releaseCoeff;
        }

        // Apply the calculated gain to the output sample.
        // The check prevents floating point inaccuracies from making silent audio non-zero.
        outputChannel[i] =
          sample * (this._currentGain < 0.0001 ? 0 : this._currentGain);
      }
    }

    // Return true to keep the processor alive.
    return true;
  }
}

registerProcessor("noise-gate-processor", NoiseGateProcessor);
