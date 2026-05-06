/**
 * Microphone monitor AudioWorkletProcessor.
 * This processor passes microphone audio through a simple volume control.
 */
class MicMonitorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "volume", defaultValue: 0, minValue: 0, maxValue: 2 }];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const volume =
      parameters.volume.length > 1 ? parameters.volume : parameters.volume[0];

    if (!input || !input.length) return true;

    for (let channel = 0; channel < input.length; channel++) {
      const inChannel = input[channel];
      const outChannel = output[channel];
      for (let i = 0; i < inChannel.length; i++) {
        let sample =
          inChannel[i] * (parameters.volume.length > 1 ? volume[i] : volume);

        if (sample > 1.0) sample = 1.0;
        else if (sample < -1.0) sample = -1.0;

        outChannel[i] = sample;
      }
    }

    return true;
  }
}

registerProcessor("mic-monitor-processor", MicMonitorProcessor);
