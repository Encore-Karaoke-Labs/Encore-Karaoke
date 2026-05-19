import { PitchDetector } from "pitchy";
import { logVerbose } from "../core/State.js";

export class ForteMicrophone {
  /**
   * Initializes the Microphone and Vocal Chain module.
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   */
  constructor(state, audioCore) {
    this.state = state;
    this.audioCore = audioCore;

    this.saveVocalChainTimeout = null;
    this.saveVolumesTimeout = null;
  }

  /**
   * Enumerates local peripheral input targets listing hardware.
   *
   * @returns {Promise<Array<{label: string, deviceId: string}>>} List representing mic devices.
   */
  async getMicDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.state.scoring.micDevices = devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ label: d.label, deviceId: d.deviceId }));
      return this.state.scoring.micDevices;
    } catch (e) {
      return [];
    }
  }

  /**
   * Shifts engine input recording mapping to the chosen microphone device hardware.
   *
   * @param {string} deviceId - Local device token.
   * @param {Object} scoring - Reference to the scoring module.
   */
  async setMicDevice(deviceId, scoring) {
    await this.startMicInput(deviceId, scoring);
    this.state.scoring.currentMicDeviceId = deviceId;
  }

  /**
   * Switches capturing capability enabling system parsing.
   *
   * @param {boolean} enabled - Flag mapping function.
   * @param {Object} scoring - Reference to the scoring module.
   */
  async setMicInputEnabled(enabled, scoring) {
    this.state.scoring.userInputEnabled = enabled;
    if (enabled) {
      await this.startMicInput(this.state.scoring.currentMicDeviceId, scoring);
    } else {
      this.stopMicInput();
    }
  }

  /**
   * Resolves promises establishing physical microphone feeds creating analyzer pipelines.
   *
   * @param {string} deviceId - Selection criteria.
   * @param {Object} scoring - Reference to the scoring module.
   */
  async startMicInput(deviceId = "default", scoring) {
    this.stopMicInput();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.state.scoring.micStream = stream;
      const source = this.audioCore.context.createMediaStreamSource(stream);

      source.connect(this.state.effects.micChainInput);

      const hpFilter = this.audioCore.context.createBiquadFilter();
      hpFilter.type = "highpass";
      hpFilter.frequency.value = 85;

      const lpFilter = this.audioCore.context.createBiquadFilter();
      lpFilter.type = "lowpass";
      lpFilter.frequency.value = 2000;

      const analyser = this.audioCore.context.createAnalyser();
      analyser.fftSize = 2048;

      source.connect(hpFilter);
      hpFilter.connect(lpFilter);
      lpFilter.connect(analyser);

      this.state.scoring.micSourceNode = source;
      this.state.scoring.micHighpassNode = hpFilter;
      this.state.scoring.micLowpassNode = lpFilter;
      this.state.scoring.micAnalyser = analyser;

      if (!this.state.scoring.pitchDetector) {
        this.state.scoring.pitchDetector = PitchDetector.forFloat32Array(
          analyser.fftSize,
        );
      }
      this.state.scoring.enabled = true;
      logVerbose("Microphone input started with isolated scoring filters", {
        deviceId: deviceId,
      });
    } catch (e) {
      console.error("[FORTE SVC] Failed to get microphone input:", e);
    }
  }

  /**
   * Disconnects nodes cutting streams directly from microphones terminating buffers.
   */
  stopMicInput() {
    logVerbose("Stopping microphone input");
    if (this.state.scoring.micStream) {
      this.state.scoring.micStream.getTracks().forEach((track) => track.stop());
      this.state.scoring.micStream = null;
    }
    if (this.state.scoring.micSourceNode) {
      try {
        this.state.scoring.micSourceNode.disconnect();
      } catch (e) {}
      this.state.scoring.micSourceNode = null;
    }
    if (this.state.scoring.micHighpassNode) {
      try {
        this.state.scoring.micHighpassNode.disconnect();
      } catch (e) {}
      this.state.scoring.micHighpassNode = null;
    }
    if (this.state.scoring.micLowpassNode) {
      try {
        this.state.scoring.micLowpassNode.disconnect();
      } catch (e) {}
      this.state.scoring.micLowpassNode = null;
    }
    if (this.state.scoring.micAnalyser) {
      try {
        this.state.scoring.micLowpassNode.disconnect(
          this.state.scoring.micAnalyser,
        );
      } catch (e) {}
      this.state.scoring.micAnalyser = null;
    }
    this.state.scoring.enabled = false;
    console.log("[FORTE SVC] Microphone input stopped (Performance/User req).");
  }

  /**
   * Assembles audio worklets applying effects dynamically generating chains.
   *
   * @param {Array<Object>} chainConfig - Mapped representations configuring instances.
   */
  async loadVocalChain(chainConfig) {
    this.state.effects.vocalChainConfig = JSON.parse(
      JSON.stringify(chainConfig),
    );
    this.state.effects.vocalChain.forEach((plugin) => plugin.disconnect());
    this.state.effects.vocalChain = [];

    for (let i = 0; i < chainConfig.length; i++) {
      const pluginConfig = chainConfig[i];
      try {
        logVerbose("Loading plugin configuration", pluginConfig);
        const pluginModule = await import(pluginConfig.path);
        const PluginClass = pluginModule.default;
        let pluginInstance;

        if (typeof PluginClass.create === "function") {
          pluginInstance = await PluginClass.create(this.audioCore.context);
        } else {
          pluginInstance = new PluginClass(this.audioCore.context);
        }

        if (pluginConfig.params) {
          for (const [key, value] of Object.entries(pluginConfig.params)) {
            pluginInstance.setParameter(key, value);
          }
        }

        const originalSetParameter = pluginInstance.setParameter;
        const self = this;

        if (typeof originalSetParameter === "function") {
          pluginInstance.setParameter = function (paramName, value) {
            originalSetParameter.call(this, paramName, value);

            if (self.state.effects.vocalChainConfig[i]) {
              if (!self.state.effects.vocalChainConfig[i].params) {
                self.state.effects.vocalChainConfig[i].params = {};
              }
              self.state.effects.vocalChainConfig[i].params[paramName] = value;

              if (self.saveVocalChainTimeout)
                clearTimeout(self.saveVocalChainTimeout);
              self.saveVocalChainTimeout = setTimeout(() => {
                if (
                  window.config &&
                  typeof window.config.setItem === "function"
                ) {
                  window.config.setItem(
                    "audioConfig.vocalChain",
                    self.state.effects.vocalChainConfig,
                  );
                  logVerbose("Saved updated vocal chain config to disk.");
                }
              }, 300);
            }
          };
        }

        this.state.effects.vocalChain.push(pluginInstance);
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load plugin.`, e);
      }
    }
    this.rebuildVocalChain();
  }

  /**
   * Bridges disparate nodes constructing one coherent graph modifying stream components.
   * Supports branching the Vocal Chain output into the Real-Time Monitor.
   */
  rebuildVocalChain() {
    logVerbose("Rebuilding vocal chain", {
      chainLength: this.state.effects.vocalChain.length,
    });

    const { micChainInput, micChainOutput, micMonitorNode, vocalChain } =
      this.state.effects;

    micChainInput.disconnect();

    let lastNode = micChainInput;
    if (vocalChain.length > 0) {
      vocalChain.forEach((plugin) => {
        lastNode.connect(plugin.input);
        lastNode = plugin.output;
      });
    }

    lastNode.connect(micChainOutput);

    if (micMonitorNode) {
      try {
        lastNode.disconnect(micMonitorNode);
      } catch (e) {}

      if (this.state.effects.enableMicMonitor) {
        lastNode.connect(micMonitorNode);
      }
    }
  }

  /**
   * Shifts state modifying loaded node specific internal parameter objects.
   *
   * @param {number} pluginIndex - Array location index.
   * @param {string} paramName - Field property designation string.
   * @param {number} value - Floating target logic adjusting module specific traits.
   */
  setPluginParameter(pluginIndex, paramName, value) {
    const plugin = this.state.effects.vocalChain[pluginIndex];
    if (plugin) plugin.setParameter(paramName, value);
  }

  /**
   * Enables or disables real-time microphone monitoring.
   *
   * @param {boolean} enabled - True to enable, False to disable.
   */
  setMicMonitorEnabled(enabled) {
    this.state.effects.enableMicMonitor = !!enabled;

    if (window.config && typeof window.config.setItem === "function") {
      window.config.setItem(
        "audioConfig.enableMicMonitor",
        this.state.effects.enableMicMonitor,
      );
    }

    this.rebuildVocalChain();
  }

  /**
   * Instantly sets the real-time playback volume of the singer's voice.
   *
   * @param {number} level - Monitor mapping gain values from 0.0 to 2.0.
   */
  setMicMonitorVolume(level) {
    const clamped = Math.max(0, Math.min(2, level));
    this.state.effects.micMonitorVolume = clamped;

    if (this.state.effects.micMonitorNode) {
      const volumeParam =
        this.state.effects.micMonitorNode.parameters.get("volume");
      volumeParam.setTargetAtTime(
        clamped,
        this.audioCore.context.currentTime,
        0.01,
      );
    }

    if (this.saveVolumesTimeout) clearTimeout(this.saveVolumesTimeout);
    this.saveVolumesTimeout = setTimeout(() => {
      if (window.config && typeof window.config.setItem === "function") {
        window.config.setItem("audioConfig.micMonitorVolume", clamped);
        logVerbose("Saved mic monitor volume to disk.");
      }
    }, 300);
  }

  /**
   * Target shifting level affecting final recorded volume outputs of microphones.
   *
   * @param {number} level - Target mapping gain values from 0 to 2.
   */
  setMicRecordingVolume(level) {
    const clamped = Math.max(0, Math.min(2, level));
    this.state.effects.micGainInRecording = clamped;

    if (this.state.effects.micChainOutput) {
      this.state.effects.micChainOutput.gain.setTargetAtTime(
        clamped,
        this.audioCore.context.currentTime,
        0.01,
      );
    }

    if (this.saveVolumesTimeout) clearTimeout(this.saveVolumesTimeout);
    this.saveVolumesTimeout = setTimeout(() => {
      if (window.config && typeof window.config.setItem === "function") {
        window.config.setItem("audioConfig.micRecordingVolume", clamped);
        logVerbose("Saved mic recording volume to disk.");
      }
    }, 300);
  }

  /**
   * Target shifting level affecting final recorded volume outputs of background tracks.
   *
   * @param {number} level - Target mapping gain values from 0 to 1.
   */
  setMusicRecordingVolume(level) {
    const clamped = Math.max(0, Math.min(1, level));
    this.state.effects.musicGainInRecording = clamped;

    if (this.state.recording.musicRecordingGainNode) {
      this.state.recording.musicRecordingGainNode.gain.setTargetAtTime(
        clamped,
        this.audioCore.context.currentTime,
        0.01,
      );
    }

    if (this.saveVolumesTimeout) clearTimeout(this.saveVolumesTimeout);
    this.saveVolumesTimeout = setTimeout(() => {
      if (window.config && typeof window.config.setItem === "function") {
        window.config.setItem("audioConfig.musicRecordingVolume", clamped);
        logVerbose("Saved music recording volume to disk.");
      }
    }, 300);
  }

  /**
   * Compiles properties describing effect logic status across chains currently operating.
   *
   * @returns {Object} Data schema reflecting internal values across loaded objects.
   */
  getVocalChainState() {
    const chainState = this.state.effects.vocalChain.map((plugin, i) => ({
      name: plugin.name,
      path: this.state.effects.vocalChainConfig[i]?.path,
      parameters: plugin.parameters,
      instance: plugin,
    }));

    return {
      micGain: this.state.effects.micGainInRecording,
      musicGain: this.state.effects.musicGainInRecording,
      micMonitorVolume: this.state.effects.micMonitorVolume,
      chain: chainState,
      rawConfig: this.state.effects.vocalChainConfig || [],
    };
  }

  /**
   * Destroys streams and timeouts.
   */
  cleanup() {
    this.stopMicInput();
    if (this.saveVocalChainTimeout) clearTimeout(this.saveVocalChainTimeout);
    if (this.saveVolumesTimeout) clearTimeout(this.saveVolumesTimeout);
    this.state.effects.vocalChain.forEach((p) => p.disconnect());
  }
}
