import { logVerbose } from "./State.js";

export class ForteAudioCore {
  /**
   * Initializes the core audio routing class.
   * @param {Object} state - The centralized Forte state object.
   * @param {Object} config - The application configuration object.
   */
  constructor(state, config) {
    this.state = state;
    this.config = config;

    this.context = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.sfxGain = null;
  }

  /**
   * Instantiates the global audio context and base pipeline nodes.
   */
  async initialize() {
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
        sampleRate: 44100,
      });

      // Load specific custom audio processors
      const monitorWorkletPath = "/libs/micMonitorProcessor.js";
      await this.context.audioWorklet.addModule(monitorWorkletPath);

      const pitchShifterPath = "/libs/pitch-shifter-processor.js";
      await this.context.audioWorklet.addModule(pitchShifterPath);

      // Setup Master Out
      this.masterGain = this.context.createGain();
      this.sfxGain = this.context.createGain();

      this.masterCompressor = this.context.createDynamicsCompressor();
      this.masterCompressor.threshold.setValueAtTime(
        -24,
        this.context.currentTime,
      );
      this.masterCompressor.knee.setValueAtTime(40, this.context.currentTime);
      this.masterCompressor.ratio.setValueAtTime(4, this.context.currentTime);
      this.masterCompressor.attack.setValueAtTime(
        0.01,
        this.context.currentTime,
      );
      this.masterCompressor.release.setValueAtTime(
        0.25,
        this.context.currentTime,
      );

      this.masterGain.connect(this.masterCompressor);
      this.masterCompressor.connect(this.context.destination);

      this.sfxGain.connect(this.context.destination);
      this.sfxGain.gain.value = this.state.playback.volume;

      this.state.recording.destinationNode =
        this.context.createMediaStreamDestination();
      this.state.recording.audioStream =
        this.state.recording.destinationNode.stream;
      this.state.recording.micDestinationNode =
        this.context.createMediaStreamDestination();
      this.state.recording.musicDestinationNode =
        this.context.createMediaStreamDestination();

      this.state.recording.micAudioStream =
        this.state.recording.micDestinationNode.stream;
      this.state.recording.musicAudioStream =
        this.state.recording.musicDestinationNode.stream;

      this.state.effects.micChainInput = this.context.createGain();
      this.state.effects.micChainOutput = this.context.createGain();

      this.state.effects.micMonitorNode = new AudioWorkletNode(
        this.context,
        "mic-monitor-processor",
      );

      this.state.effects.micMonitorNode.connect(this.context.destination);

      this.state.effects.chorusPitchNode = new AudioWorkletNode(
        this.context,
        "pitch-shifter-processor",
      );
      this.state.playback.chorusGain = this.context.createGain();

      this.state.effects.chorusPitchNode.connect(
        this.state.playback.chorusGain,
      );
      this.state.playback.chorusGain.connect(this.masterGain);

      this.state.effects.micMonitorNode.parameters.get("volume").value =
        this.config.audioConfig?.micMonitorVolume ?? 1.0;

      this.state.effects.enableMicMonitor =
        this.config.audioConfig?.enableMicMonitor ?? false;

      this.state.effects.micChainInput.connect(
        this.state.effects.micChainOutput,
      );
      this.state.effects.micChainOutput.connect(
        this.state.recording.destinationNode,
      );
      this.state.effects.micChainOutput.connect(
        this.state.recording.micDestinationNode,
      );

      this.state.playback.midiGain = this.context.createGain();
      this.state.playback.midiGain.connect(this.masterGain);

      this.state.scoring.musicAnalyser = this.context.createAnalyser();
      this.state.scoring.musicAnalyser.fftSize = 2048;
      this.state.playback.midiGain.connect(this.state.scoring.musicAnalyser);

      logVerbose("Audio pipelines initialized.");
      logVerbose("AudioContext sinkId", this.context.sinkId || "default");
      logVerbose("AudioContext baseLatency", this.context.baseLatency);
      logVerbose("AudioContext outputLatency", this.context.outputLatency);
      logVerbose(
        "AudioContext total latency",
        this.context.baseLatency + this.context.outputLatency,
      );

      this.state.playback.currentDeviceId = this.context.sinkId || "default";
      await this.getPlaybackDevices();
    } catch (e) {
      console.error("[FORTE SVC] FATAL: Web Audio API is not supported.", e);
    }
  }

  /**
   * Retrieves available hardware output devices mapping them to system identifiers.
   *
   * @returns {Promise<Array<{deviceId: string, label: string}>>} List of detected output pairs.
   */
  async getPlaybackDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = allDevices
        .filter((device) => device.kind === "audiooutput")
        .map((device) => ({
          deviceId: device.deviceId,
          label:
            device.label || `Output Device ${device.deviceId.substring(0, 8)}`,
        }));
      this.state.playback.devices = audioOutputs;
      return audioOutputs;
    } catch (e) {
      return [];
    }
  }

  /**
   * Points audio graph out towards a specific hardware boundary via API.
   *
   * @param {string} deviceId - Local device token.
   * @param {Function} dispatchCallback - Notification method from DI container.
   * @returns {Promise<boolean>} Indication of success mapping out.
   */
  async setPlaybackDevice(deviceId, dispatchCallback) {
    if (!this.context || typeof this.context.setSinkId !== "function")
      return false;
    try {
      await this.context.setSinkId(deviceId);
      this.state.playback.currentDeviceId = deviceId;
      logVerbose("Playback device set", deviceId);
      if (typeof dispatchCallback === "function") dispatchCallback();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Updates the effective SFX gain based on main volume and SFX-specific volume.
   * The effective gain is the product of both volumes, allowing SFX to react relatively to main volume.
   */
  updateSfxGain() {
    if (!this.sfxGain || !this.context) return;
    const effectiveGain =
      this.state.playback.volume * this.state.playback.sfxVolume;
    this.sfxGain.gain.setValueAtTime(effectiveGain, this.context.currentTime);
  }

  /**
   * Adjusts the overall music tracking output level via compressor thresholding.
   *
   * @param {number} level - Gain volume factor from 0.0 to 1.0.
   */
  setTrackVolume(level) {
    if (!this.masterGain) return;
    const clampedLevel = Math.max(0, Math.min(1, level));
    this.masterGain.gain.setValueAtTime(clampedLevel, this.context.currentTime);
    this.state.playback.volume = clampedLevel;
    this.updateSfxGain();
    logVerbose("Track volume set", clampedLevel);
  }

  /**
   * Sets the sound effects volume independently from main track volume.
   *
   * @param {number} level - SFX volume factor from 0.0 to 1.0.
   */
  setSfxVolume(level) {
    const clampedLevel = Math.max(0, Math.min(1, level));
    this.state.playback.sfxVolume = clampedLevel;
    this.updateSfxGain();
    logVerbose("SFX volume set", clampedLevel);
  }

  /**
   * Shuts down context and disconnects master graphs.
   */
  cleanup() {
    if (this.context && this.context.state !== "closed") {
      if (this.state.effects.micChainInput)
        this.state.effects.micChainInput.disconnect();
      if (this.state.effects.micChainOutput)
        this.state.effects.micChainOutput.disconnect();
      if (this.state.effects.micMonitorNode)
        this.state.effects.micMonitorNode.disconnect();
      if (this.masterCompressor) this.masterCompressor.disconnect();
      if (this.masterGain) this.masterGain.disconnect();
      if (this.sfxGain) this.sfxGain.disconnect();
      if (this.state.recording.destinationNode)
        this.state.recording.destinationNode.disconnect();

      this.context.close();
    }
  }
}
