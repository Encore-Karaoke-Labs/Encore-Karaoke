import { MIDIControllers as midiControllers } from "spessasynth_core";
import {
  MIDIDeviceHandler,
  WorkletSynthesizer as Synthetizer,
} from "spessasynth_lib";
import { logVerbose, logVerboseWarn } from "../core/State.js";

export const STANDARD_GM_DRUM_PRESETS = [
  {
    program: 0,
    bankMSB: 0,
    bankLSB: 0,
    name: "Standard Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 1,
    bankMSB: 0,
    bankLSB: 0,
    name: "Standard 2 Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 8,
    bankMSB: 0,
    bankLSB: 0,
    name: "Room Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 16,
    bankMSB: 0,
    bankLSB: 0,
    name: "Power Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 24,
    bankMSB: 0,
    bankLSB: 0,
    name: "Electronic Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 25,
    bankMSB: 0,
    bankLSB: 0,
    name: "TR-808 / Analog Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 26,
    bankMSB: 0,
    bankLSB: 0,
    name: "Dance Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 27,
    bankMSB: 0,
    bankLSB: 0,
    name: "TR-909 Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 32,
    bankMSB: 0,
    bankLSB: 0,
    name: "Jazz Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 40,
    bankMSB: 0,
    bankLSB: 0,
    name: "Brush Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 48,
    bankMSB: 0,
    bankLSB: 0,
    name: "Orchestra Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
  {
    program: 56,
    bankMSB: 0,
    bankLSB: 0,
    name: "SFX Kit",
    isGMGSDrum: true,
    isAnyDrums: true,
  },
];

/**
 * Safely binds an event callback to a SpessaSynth v4 event handler.
 */
export function bindSpessaEvent(handler, eventName, id, callback) {
  if (!handler || !handler.events) {
    return;
  }

  if (handler.events[eventName] !== undefined) {
    try {
      if (typeof handler.addEvent === "function") {
        handler.addEvent(eventName, id, callback);
        return;
      }
      if (typeof handler.events[eventName].set === "function") {
        handler.events[eventName].set(id, callback);
      } else {
        handler.events[eventName][id] = callback;
      }
    } catch (e) {
      logVerboseWarn(`Error binding event '${eventName}': ${e.message}`);
    }
  } else {
    logVerboseWarn(`Event '${eventName}' does not exist on this handler.`);
  }
}

export class ForteSynthesizer {
  /**
   * Initializes the Synthesizer module.
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   * @param {Function} dispatchUpdate - Callback to notify UI of state changes.
   */
  constructor(state, audioCore, dispatchUpdate) {
    this.state = state;
    this.audioCore = audioCore;
    this.dispatchUpdate = dispatchUpdate;
    this.currentLoadController = null;
    this.midiDeviceHandler = null;
  }

  /**
   * Loads the SpessaSynth processor and the default SoundFont.
   */
  async initialize() {
    try {
      if (!this.audioCore.context) return;

      await this.audioCore.context.audioWorklet.addModule(
        "/libs/spessasynth_lib/dist/spessasynth_processor.min.js",
      );
      const soundFontUrl = "/libs/soundfonts/SAM2634.sf3";
      const soundFontBuffer = await (await fetch(soundFontUrl)).arrayBuffer();

      this.state.playback.synthesizer = new Synthetizer(this.audioCore.context);
      this.state.playback.synthesizer.setLogLevel(true, true, true);
      await this.state.playback.synthesizer.soundBankManager.addSoundBank(
        soundFontBuffer,
      );
      this.state.playback.synthesizer.connect(this.state.playback.midiGain);

      logVerbose("synthion", this.state.playback.synthesizer);
      logVerbose("Preset list", this.state.playback.synthesizer.presetList);

      console.log("[FORTE SVC] MIDI Synthesizer initialized successfully.");

      try {
        this.midiDeviceHandler =
          await MIDIDeviceHandler.createMIDIDeviceHandler();
        logVerbose("MIDIDeviceHandler initialized successfully.");
      } catch (midiErr) {
        logVerboseWarn(
          "Web MIDI / MIDIDeviceHandler could not be initialized:",
          midiErr,
        );
        this.midiDeviceHandler = null;
      }
    } catch (synthError) {
      console.error(
        "[FORTE SVC] FATAL: Could not initialize MIDI Synthesizer.",
        synthError,
      );
      this.state.playback.synthesizer = null;
    }
  }

  /**
   * Retrieves all available MIDI output ports (including internal SoundFont synth).
   * @returns {Array<{id: string, name: string, manufacturer: string}>}
   */
  getMidiOutputDevices() {
    const devices = [
      {
        id: "internal",
        name: "Internal Synthesizer",
        manufacturer: "SpessaSynth",
      },
    ];

    if (this.midiDeviceHandler && this.midiDeviceHandler.outputs) {
      for (const [id, output] of this.midiDeviceHandler.outputs.entries()) {
        devices.push({
          id: output.id || id,
          name: output.name || `External MIDI Device (${id})`,
          manufacturer: output.manufacturer || "Generic",
        });
      }
    }

    this.state.playback.midiOutputs = devices;
    return devices;
  }

  /**
   * Connects an active sequencer to the currently selected MIDI output.
   * @param {Object} sequencer - Active SpessaSynth Sequencer instance.
   */
  connectSequencerToMidiOutput(sequencer) {
    if (!sequencer || !this.midiDeviceHandler) return;

    const deviceId = this.state.playback.currentMidiDeviceId;
    if (!deviceId || deviceId === "internal") return;

    const output = this.midiDeviceHandler.outputs.get(deviceId);
    if (output) {
      try {
        output.connect(sequencer);
        logVerbose(
          `Connected sequencer to external MIDI output: ${output.name || deviceId}`,
        );
      } catch (e) {
        console.error(
          "[FORTE SVC] Failed to connect sequencer to MIDI output:",
          e,
        );
      }
    }
  }

  /**
   * Disconnects a sequencer from an external MIDI output, returning it to internal synth.
   * @param {Object} sequencer - Active SpessaSynth Sequencer instance.
   */
  disconnectSequencerFromMidiOutput(sequencer) {
    if (!sequencer || !this.midiDeviceHandler) return;

    const deviceId = this.state.playback.currentMidiDeviceId;
    if (!deviceId || deviceId === "internal") return;

    const output = this.midiDeviceHandler.outputs.get(deviceId);
    if (output) {
      try {
        output.disconnect(sequencer);
        logVerbose(
          `Disconnected sequencer from external MIDI output: ${output.name || deviceId}`,
        );
      } catch (e) {
        console.warn(
          "[FORTE SVC] Failed to disconnect sequencer from MIDI output:",
          e,
        );
      }
    }
  }

  /**
   * Sets the active MIDI output destination.
   * @param {string} deviceId - Hardware port ID or "internal".
   * @returns {boolean} Success status.
   */
  setMidiOutputDevice(deviceId) {
    const prevDeviceId = this.state.playback.currentMidiDeviceId;
    if (prevDeviceId === deviceId) return true;

    const currentSequencer = this.state.playback.sequencer;

    if (
      prevDeviceId &&
      prevDeviceId !== "internal" &&
      this.midiDeviceHandler &&
      currentSequencer
    ) {
      const prevOutput = this.midiDeviceHandler.outputs.get(prevDeviceId);
      if (prevOutput) {
        try {
          prevOutput.disconnect(currentSequencer);
        } catch (e) {
          console.warn(
            "[FORTE SVC] Error disconnecting previous MIDI output:",
            e,
          );
        }
      }
    }

    this.state.playback.currentMidiDeviceId = deviceId;

    if (
      deviceId &&
      deviceId !== "internal" &&
      this.midiDeviceHandler &&
      currentSequencer
    ) {
      const newOutput = this.midiDeviceHandler.outputs.get(deviceId);
      if (newOutput) {
        try {
          newOutput.connect(currentSequencer);
          logVerbose(`Switched MIDI output to: ${newOutput.name || deviceId}`);

          if (
            this.state.playback.guideVolume !== undefined &&
            Array.isArray(this.state.playback.guideChannels)
          ) {
            for (const ch of this.state.playback.guideChannels) {
              newOutput.port.send([
                0xb0 | ch.index,
                midiControllers.expression,
                127,
              ]);
              newOutput.port.send([
                0xb0 | ch.index,
                midiControllers.mainVolume,
                Math.floor(this.state.playback.guideVolume),
              ]);
            }
          }

          if (this.state.playback.lockedDrumPresets) {
            for (const [chStr, preset] of Object.entries(
              this.state.playback.lockedDrumPresets,
            )) {
              const ch = parseInt(chStr, 10);
              const prog = Math.max(0, Math.min(127, preset.program ?? 0));
              const rawB = Math.floor(preset.bankMSB ?? 0);
              const bMSB = rawB >= 128 ? 0 : Math.max(0, Math.min(127, rawB));
              const bLSB = Math.max(
                0,
                Math.min(127, Math.floor(preset.bankLSB ?? 0)),
              );

              newOutput.port.send([
                0xb0 | ch,
                midiControllers.bankSelect,
                bMSB,
              ]);
              newOutput.port.send([
                0xb0 | ch,
                midiControllers.bankSelectLSB,
                bLSB,
              ]);
              newOutput.port.send([0xc0 | ch, prog]);
            }
          }

          if (
            this.state.playback.transpose !== undefined &&
            this.state.playback.transpose !== 0
          ) {
            this.sendExternalTranspose(this.state.playback.transpose);
          }

          if (this.state.playback.volume !== undefined) {
            this.sendExternalMasterVolume(this.state.playback.volume);
          }
        } catch (e) {
          console.error("[FORTE SVC] Failed to connect to MIDI output:", e);
          return false;
        }
      }
    } else {
      logVerbose("Switched MIDI output to Internal Synthesizer.");
    }

    this.dispatchUpdate();
    return true;
  }

  /**
   * Replaces the running SoundFont buffer used in SpessaSynth.
   *
   * @param {string} url - Target SF2 endpoint structure URL.
   * @param {Object} playback - Reference to the playback module to stop active tracks.
   * @returns {Promise<boolean>} True indicating the buffer rebuilt completely.
   */
  async loadSoundFont(url, playback) {
    if (!this.audioCore.context) return false;

    if (this.currentLoadController) {
      logVerbose(`Aborting previous SoundBank load to load: ${url}`);
      this.currentLoadController.abort();
    }

    this.currentLoadController = new AbortController();
    const signal = this.currentLoadController.signal;

    if (this.state.playback.status !== "stopped") {
      playback.stopTrack();
    }

    logVerbose(`Swapping SoundBank with: ${url}`);

    try {
      const response = await fetch(url, { signal });
      const arrayBuffer = await response.arrayBuffer();

      if (signal.aborted) {
        return false;
      }

      if (this.state.playback.synthesizer) {
        const sbm = this.state.playback.synthesizer.soundBankManager;

        if (sbm) {
          // Clear previous banks directly from memory
          if (Array.isArray(sbm.soundBankList)) {
            const bankIds = sbm.soundBankList.map((b) => b.id);
            for (const bankId of bankIds) {
              if (typeof sbm.deleteSoundBank === "function") {
                sbm.deleteSoundBank(bankId);
              }
            }
          } else if (typeof sbm.destroy === "function") {
            sbm.destroy();
          }

          await sbm.addSoundBank(arrayBuffer);

          if (this.state.playback.transpose !== 0) {
            this.state.playback.synthesizer.setSystemParameter(
              "keyShift",
              this.state.playback.transpose,
            );
          }

          logVerbose("New SoundBank loaded into existing Synthesizer.");

          if (this.currentLoadController === this.currentLoadController) {
            this.currentLoadController = null;
          }
          return true;
        }
      }

      this.state.playback.synthesizer = new Synthetizer(this.audioCore.context);
      await this.state.playback.synthesizer.soundBankManager.addSoundBank(
        arrayBuffer,
      );
      this.state.playback.synthesizer.connect(this.state.playback.midiGain);

      if (this.state.playback.transpose !== 0) {
        this.state.playback.synthesizer.setSystemParameter(
          "keyShift",
          this.state.playback.transpose,
        );
      }

      logVerbose("New SoundBank loaded and Synthesizer recreated.");

      if (this.currentLoadController === this.currentLoadController) {
        this.currentLoadController = null;
      }
      return true;
    } catch (e) {
      if (e.name === "AbortError") {
        logVerbose(`SoundBank load dynamically aborted for: ${url}`);
        return false;
      }

      console.error(`[FORTE SVC] Failed to load custom SoundBank: ${url}`, e);

      if (
        this.currentLoadController &&
        this.currentLoadController.signal === signal
      ) {
        this.currentLoadController = null;
      }
      return false;
    }
  }

  /**
   * Sends raw MIDI message bytes to the currently active external MIDI device.
   * @param {number[]|Uint8Array} message - Raw MIDI bytes.
   */
  sendExternalMidiMessage(message) {
    const deviceId = this.state.playback.currentMidiDeviceId;
    if (deviceId && deviceId !== "internal" && this.midiDeviceHandler) {
      const output = this.midiDeviceHandler.outputs.get(deviceId);
      if (output?.port?.send) {
        try {
          output.port.send(message);
        } catch (e) {
          logVerboseWarn(
            "[FORTE SVC] Failed to send external MIDI message:",
            e,
          );
        }
      }
    }
  }

  /**
   * Sets the volume for a specific MIDI channel via Control Change.
   *
   * @param {number} channelNumber - The MIDI channel (0-15).
   * @param {number} volume - Volume level (0-127).
   */
  setChannelVolume(channelNumber, volume) {
    if (channelNumber < 0 || channelNumber > 15) {
      throw new Error(`Invalid MIDI channel: ${channelNumber}. Must be 0-15.`);
    }

    if (volume < 0 || volume > 127) {
      throw new Error(`Invalid volume level: ${volume}. Must be 0-127.`);
    }

    const intVolume = Math.floor(volume);

    if (this.state.playback.synthesizer) {
      try {
        const midiChannel =
          this.state.playback.synthesizer.midiChannels?.[channelNumber];

        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", false);
        }

        this.state.playback.synthesizer.controllerChange(
          channelNumber,
          midiControllers.mainVolume,
          intVolume,
        );

        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", true);
        }
      } catch (e) {
        console.error(
          `[FORTE SVC] Failed to change volume on channel ${channelNumber + 1}:`,
          e,
        );
      }
    }

    this.sendExternalMidiMessage([
      0xb0 | channelNumber,
      midiControllers.mainVolume,
      intVolume,
    ]);

    logVerbose(
      `Switched volume to ${Math.floor((intVolume / 127) * 100)}% (${intVolume}/127) on channel ${channelNumber + 1}`,
    );
    return true;
  }

  /**
   * Sets the expression for a specific MIDI channel via Control Change.
   *
   * @param {number} channelNumber - The MIDI channel (0-15).
   * @param {number} expression - Expression level (0-127).
   */
  setChannelExpression(channelNumber, expression) {
    if (channelNumber < 0 || channelNumber > 15) {
      throw new Error(`Invalid MIDI channel: ${channelNumber}. Must be 0-15.`);
    }

    if (expression < 0 || expression > 127) {
      throw new Error(
        `Invalid expression level: ${expression}. Must be 0-127.`,
      );
    }

    const intExpression = Math.floor(expression);

    if (this.state.playback.synthesizer) {
      try {
        const midiChannel =
          this.state.playback.synthesizer.midiChannels?.[channelNumber];

        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", false);
        }

        this.state.playback.synthesizer.controllerChange(
          channelNumber,
          midiControllers.expression,
          intExpression,
        );

        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", true);
        }
      } catch (e) {
        console.error(
          `[FORTE SVC] Failed to change expression on channel ${channelNumber + 1}:`,
          e,
        );
      }
    }

    this.sendExternalMidiMessage([
      0xb0 | channelNumber,
      midiControllers.expression,
      intExpression,
    ]);

    logVerbose(
      `Switched expression to ${Math.floor((intExpression / 127) * 100)}% (${intExpression}/127) on channel ${channelNumber + 1}`,
    );
    return true;
  }

  /**
   * Sends real-time Master Transpose SysEx messages to external MIDI hardware (Roland GS, Yamaha XG, and GM2).
   * @param {number} semitones - Transposition in semitones (-24 to 24).
   */
  sendExternalTranspose(semitones) {
    const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
    const midiVal = 64 + clamped; // 64 (0x40) represents neutral / 0 semitones

    const rolandSum = 0x40 + 0x00 + 0x05 + midiVal;
    const rolandChecksum = (128 - (rolandSum % 128)) & 0x7f;
    const rolandGsKeyShift = [
      0xf0,
      0x41,
      0x10,
      0x42,
      0x12,
      0x40,
      0x00,
      0x05,
      midiVal,
      rolandChecksum,
      0xf7,
    ];

    const yamahaXgTranspose = [
      0xf0,
      0x43,
      0x10,
      0x4c,
      0x00,
      0x00,
      0x06,
      midiVal,
      0xf7,
    ];

    const gm2MasterCoarseTune = [
      0xf0,
      0x7f,
      0x7f,
      0x04,
      0x04,
      0x00,
      midiVal,
      0xf7,
    ];

    this.sendExternalMidiMessage(rolandGsKeyShift);
    this.sendExternalMidiMessage(yamahaXgTranspose);
    this.sendExternalMidiMessage(gm2MasterCoarseTune);

    logVerbose(
      `[FORTE SVC] Sent external transpose: ${clamped > 0 ? "+" : ""}${clamped} semitones.`,
    );
  }

  /**
   * Sends real-time Master Volume SysEx messages to external MIDI hardware (Universal SysEx, Roland GS, and Yamaha XG).
   * @param {number} level - Gain volume factor from 0.0 to 1.0.
   */
  sendExternalMasterVolume(level) {
    const clamped = Math.max(0, Math.min(1, level));

    const val14 = Math.round(clamped * 16383);
    const lsb = val14 & 0x7f;
    const msb = (val14 >> 7) & 0x7f;
    const gmMasterVolume = [0xf0, 0x7f, 0x7f, 0x04, 0x01, lsb, msb, 0xf7];

    const val7 = Math.round(clamped * 127);

    const rolandSum = 0x40 + 0x00 + 0x04 + val7;
    const rolandChecksum = (128 - (rolandSum % 128)) & 0x7f;
    const rolandGsMasterVolume = [
      0xf0,
      0x41,
      0x10,
      0x42,
      0x12,
      0x40,
      0x00,
      0x04,
      val7,
      rolandChecksum,
      0xf7,
    ];

    const yamahaXgMasterVolume = [
      0xf0,
      0x43,
      0x10,
      0x4c,
      0x00,
      0x00,
      0x04,
      val7,
      0xf7,
    ];

    this.sendExternalMidiMessage(gmMasterVolume);
    this.sendExternalMidiMessage(rolandGsMasterVolume);
    this.sendExternalMidiMessage(yamahaXgMasterVolume);

    logVerbose(
      `[FORTE SVC] Sent external master volume: ${Math.round(clamped * 100)}% (${val7}/127)`,
    );
  }

  /**
   * Changes the drum kit preset on a specific channel.
   * @param {number} channelNumber - The MIDI channel (0-15)
   * @param {Object} drumPreset - The drum preset object with structure:
   *   { program: number, bankMSB: number, bankLSB: number, name: string, isAnyDrums: boolean }
   * @returns {boolean} Success indicator
   */
  switchDrumPreset(channelNumber, drumPreset) {
    if (channelNumber < 0 || channelNumber > 15) {
      console.error("[FORTE SVC] Invalid channel number:", channelNumber);
      return false;
    }

    if (!this.state.playback.lockedDrumPresets) {
      this.state.playback.lockedDrumPresets = {};
    }

    if (!drumPreset) {
      delete this.state.playback.lockedDrumPresets[channelNumber];
      if (this.state.playback.synthesizer?.midiChannels?.[channelNumber]) {
        try {
          this.state.playback.synthesizer.midiChannels[
            channelNumber
          ].setSystemParameter("presetLock", false);
        } catch (e) {}
      }
      this.dispatchUpdate();
      return true;
    }

    this.state.playback.lockedDrumPresets[channelNumber] = drumPreset;

    const program = Math.max(
      0,
      Math.min(127, Math.floor(drumPreset.program ?? 0)),
    );
    const rawBankMSB = Math.floor(drumPreset.bankMSB ?? 0);
    const bankMSB =
      rawBankMSB >= 128 ? 0 : Math.max(0, Math.min(127, rawBankMSB));
    const bankLSB = Math.max(
      0,
      Math.min(127, Math.floor(drumPreset.bankLSB ?? 0)),
    );

    try {
      logVerbose(`Switching drum preset on channel ${channelNumber + 1}`, {
        preset: drumPreset.name,
        program,
        bankMSB,
        bankLSB,
      });

      if (this.state.playback.synthesizer) {
        const midiChannel =
          this.state.playback.synthesizer.midiChannels?.[channelNumber];

        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", false);
        }

        if (!drumPreset.isGMGSDrum) {
          this.state.playback.synthesizer.controllerChange(
            channelNumber,
            midiControllers.bankSelect,
            rawBankMSB,
          );
          this.state.playback.synthesizer.controllerChange(
            channelNumber,
            midiControllers.bankSelectLSB,
            bankLSB,
          );
        }

        this.state.playback.synthesizer.programChange(channelNumber, program);

        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", true);
        }
      }

      this.sendExternalMidiMessage([
        0xb0 | channelNumber,
        midiControllers.bankSelect,
        bankMSB,
      ]);
      this.sendExternalMidiMessage([
        0xb0 | channelNumber,
        midiControllers.bankSelectLSB,
        bankLSB,
      ]);
      this.sendExternalMidiMessage([0xc0 | channelNumber, program]);

      logVerbose(
        `Drum preset switched successfully on channel ${channelNumber + 1}`,
      );
      this.dispatchUpdate();
      return true;
    } catch (e) {
      console.error(
        `[FORTE SVC] Failed to switch drum preset on channel ${channelNumber + 1}:`,
        e,
      );
      return false;
    }
  }

  /**
   * Gets available drum presets from the loaded SoundFont.
   * @returns {Array<Object>} Array of drum preset objects
   */
  getAvailableDrumPresets() {
    const isExternal =
      this.state.playback.currentMidiDeviceId &&
      this.state.playback.currentMidiDeviceId !== "internal";

    if (isExternal) {
      return STANDARD_GM_DRUM_PRESETS;
    }

    if (!this.state.playback.synthesizer) {
      console.error("[FORTE SVC] Synthesizer not initialized");
      return [];
    }

    try {
      const presetList = this.state.playback.synthesizer.presetList || [];
      return presetList.filter((p) => p.isAnyDrums || p.isGMGSDrum);
    } catch (e) {
      console.error("[FORTE SVC] Failed to get drum presets:", e);
      return [];
    }
  }

  /**
   * Gets the current drum preset on a specific channel.
   * @param {number} channelNumber - The MIDI channel (0-15)
   * @returns {Object|null} Current drum preset or null if not available
   */
  getCurrentDrumPreset(channelNumber) {
    if (this.state.playback.lockedDrumPresets?.[channelNumber]) {
      return this.state.playback.lockedDrumPresets[channelNumber];
    }

    if (!this.state.playback.synthesizer) return null;

    try {
      const channel =
        this.state.playback.synthesizer.channelProperties?.[channelNumber];
      if (!channel) return null;

      return {
        program: channel.program || 0,
        bankMSB: channel.bankMSB || 0,
        bankLSB: channel.bankLSB || 0,
        name: channel.presetName || "Unknown",
        isGMGSDrum:
          channel.isGMGSDrum ??
          (channel.isDrum === true && channel.bankMSB !== undefined
            ? channel.bankMSB === 0
            : false),
      };
    } catch (e) {
      console.error(
        `[FORTE SVC] Failed to get current drum preset on channel ${channelNumber}:`,
        e,
      );
      return null;
    }
  }

  /**
   * Plays a note
   * @param {number} channelNumber - The MIDI channel (0-15)
   * @param {number} midiNote - The MIDI note value
   * @param {number} velocity - The MIDI velocity
   */
  playNote(channelNumber, midiNote, velocity) {
    if (!this.state.playback.synthesizer) return;
    this.state.playback.synthesizer.noteOn(channelNumber, midiNote, velocity);
  }

  /**
   * Stops a note
   * @param {number} channelNumber - The MIDI channel (0-15)
   * @param {number} midiNote - The MIDI note value
   **/
  stopNote(channelNumber, midiNote) {
    this.state.playback.synthesizer.noteOff(channelNumber, midiNote);
  }

  /**
   * Resets the preset locks on all 16 MIDI channels.
   * This ensures the next track can properly assign its own instruments and volumes.
   */
  unlockAllChannels() {
    if (
      !this.state.playback.synthesizer ||
      !this.state.playback.synthesizer.midiChannels
    ) {
      return;
    }

    try {
      for (let i = 0; i < 16; i++) {
        let midiChannel = this.state.playback.synthesizer.midiChannels[i];
        if (
          midiChannel &&
          typeof midiChannel.setSystemParameter === "function"
        ) {
          midiChannel.setSystemParameter("presetLock", false);
        }
      }
      logVerbose("Successfully unlocked all MIDI channel presets.");
    } catch (e) {
      console.error("[FORTE SVC] Failed to reset channel preset locks:", e);
    }
  }

  /**
   * Resets the synthesizer
   */
  reset() {
    if (
      this.state.playback.synthesizer &&
      typeof this.state.playback.synthesizer.reset === "function"
    ) {
      this.state.playback.synthesizer.reset();
    }

    // Send All Sound Off / All Notes Off / Reset All Controllers to external hardware
    if (
      this.state.playback.currentMidiDeviceId !== "internal" &&
      this.midiDeviceHandler
    ) {
      const output = this.midiDeviceHandler.outputs.get(
        this.state.playback.currentMidiDeviceId,
      );
      if (output?.port?.send) {
        try {
          for (let ch = 0; ch < 16; ch++) {
            output.port.send([0xb0 | ch, 120, 0]); // All Sound Off
            output.port.send([0xb0 | ch, 123, 0]); // All Notes Off
            output.port.send([0xb0 | ch, 121, 0]); // Reset All Controllers
          }
          this.sendExternalTranspose(0);
          this.sendExternalMasterVolume(this.state.playback.volume ?? 1);
        } catch (e) {
          console.warn(
            "[FORTE SVC] Failed to send MIDI reset to external port:",
            e,
          );
        }
      }
    }
  }

  /**
   * Destroys synthesizer resources.
   */
  cleanup() {
    if (this.currentLoadController) {
      this.currentLoadController.abort();
      this.currentLoadController = null;
    }

    if (this.state.playback.synthesizer) {
      this.state.playback.synthesizer.disconnect();

      if (
        this.state.playback.synthesizer.port &&
        typeof this.state.playback.synthesizer.port.close === "function"
      ) {
        this.state.playback.synthesizer.port.close();
      }

      if (typeof this.state.playback.synthesizer.dispose === "function") {
        this.state.playback.synthesizer.dispose();
      } else if (
        typeof this.state.playback.synthesizer.destroy === "function"
      ) {
        this.state.playback.synthesizer.destroy();
      }

      this.state.playback.synthesizer = null;
    }
  }
}
