class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "pitchFactor", defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
    ];
  }

  constructor() {
    super();
    this.bufferSize = 8192;
    this.bufferMask = this.bufferSize - 1;
    this.delayBuffer = [
      new Float32Array(this.bufferSize),
      new Float32Array(this.bufferSize),
    ];
    this.writeIndex = 0;
    this.phase = 0.0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const pitchFactor = parameters.pitchFactor[0];
    const numChannels = Math.min(input.length, output.length);

    if (pitchFactor === 1.0) {
      for (let c = 0; c < numChannels; c++) {
        if (input[c] && output[c]) output[c].set(input[c]);
      }
      return true;
    }

    const windowSize = 4096;
    const phaseIncrement = (1.0 - pitchFactor) / windowSize;

    for (let i = 0; i < input[0].length; i++) {
      for (let c = 0; c < numChannels; c++) {
        this.delayBuffer[c][this.writeIndex] = input[c][i];
      }

      const offset1 = this.phase * windowSize;
      const phase2 = (this.phase + 0.5) % 1.0;
      const offset2 = phase2 * windowSize;

      const gain1 = 0.5 - 0.5 * Math.cos(this.phase * 2 * Math.PI);
      const gain2 = 0.5 - 0.5 * Math.cos(phase2 * 2 * Math.PI);

      for (let c = 0; c < numChannels; c++) {
        let readIdx1 =
          (this.writeIndex - Math.floor(offset1) + this.bufferSize) &
          this.bufferMask;
        let readIdx2 =
          (this.writeIndex - Math.floor(offset2) + this.bufferSize) &
          this.bufferMask;

        output[c][i] =
          this.delayBuffer[c][readIdx1] * gain1 +
          this.delayBuffer[c][readIdx2] * gain2;
      }

      this.writeIndex = (this.writeIndex + 1) & this.bufferMask;
      this.phase = (this.phase + phaseIncrement + 10.0) % 1.0;
    }

    return true;
  }
}
registerProcessor("pitch-shifter-processor", PitchShifterProcessor);
