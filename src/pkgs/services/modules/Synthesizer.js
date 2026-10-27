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
  if (!handler || typeof handler.addEvent !== "function") {
    console.warn(`Invalid SpessaSynth handler for event '${eventName}'`);
    return;
  }

  try {
    handler.addEvent(eventName, id, callback);
  } catch (e) {
    console.warn(`Error binding event '${eventName}':`, e);
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

    if (!this.state.playback.currentMidiDeviceIds) {
      this.state.playback.currentMidiDeviceIds = [
        this.state.playback.currentMidiDeviceId || "internal",
        "none",
        "none",
        "none",
      ];
    }
  }

  /**
   * Returns true if external MIDI playback is currently active (Port 1 is external).
   * @returns {boolean}
   */
  hasExternalMidiDevice() {
    const mainId =
      this.state.playback.currentMidiDeviceIds?.[0] ||
      this.state.playback.currentMidiDeviceId;
    return Boolean(mainId && mainId !== "internal" && mainId !== "none");
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
        const midiTimeout = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("MIDI device initialization timed out")),
            2500,
          ),
        );

        this.midiDeviceHandler = await Promise.race([
          MIDIDeviceHandler.createMIDIDeviceHandler(),
          midiTimeout,
        ]);
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
   * Connects an active sequencer to all configured external MIDI output ports.
   * @param {Object} sequencer - Active SpessaSynth Sequencer instance.
   */
  connectSequencerToMidiOutput(sequencer) {
    if (!sequencer || !this.midiDeviceHandler) return;

    if (!this.hasExternalMidiDevice()) {
      sequencer.externalMIDIPlayback = false;
      return;
    }

    sequencer.externalMIDIPlayback = true;

    const deviceIds = this.state.playback.currentMidiDeviceIds || [
      this.state.playback.currentMidiDeviceId,
    ];

    for (let port = 0; port < 4; port++) {
      const deviceId = deviceIds[port];
      if (!deviceId || deviceId === "internal" || deviceId === "none") continue;

      const output = this.midiDeviceHandler.outputs.get(deviceId);
      if (output) {
        try {
          output.connect(sequencer, port * 16);
          logVerbose(
            `Connected sequencer to external MIDI Port ${port + 1} (offset ${port * 16}): ${output.name || deviceId}`,
          );
        } catch (e) {
          console.error(
            `[FORTE SVC] Failed to connect sequencer to Port ${port + 1}:`,
            e,
          );
        }
      }
    }
  }

  /**
   * Disconnects a sequencer from all external MIDI outputs.
   * @param {Object} sequencer - Active SpessaSynth Sequencer instance.
   */
  disconnectSequencerFromMidiOutput(sequencer) {
    if (!sequencer || !this.midiDeviceHandler) return;

    const deviceIds = this.state.playback.currentMidiDeviceIds || [
      this.state.playback.currentMidiDeviceId,
    ];

    for (let port = 0; port < 4; port++) {
      const deviceId = deviceIds[port];
      if (!deviceId || deviceId === "internal" || deviceId === "none") continue;

      const output = this.midiDeviceHandler.outputs.get(deviceId);
      if (output) {
        try {
          output.disconnect(sequencer);
          logVerbose(
            `Disconnected sequencer from external MIDI Port ${port + 1}: ${output.name || deviceId}`,
          );
        } catch (e) {
          console.warn(
            `[FORTE SVC] Failed to disconnect sequencer from Port ${port + 1}:`,
            e,
          );
        }
      }
    }

    sequencer.externalMIDIPlayback = false;
  }

  /**
   * Sends initial channel controllers, drum kits, transpose, and volume to a newly connected port.
   */
  initExternalDevicePort(deviceId, portIndex) {
    if (
      !this.midiDeviceHandler ||
      !deviceId ||
      deviceId === "internal" ||
      deviceId === "none"
    )
      return;
    const output = this.midiDeviceHandler.outputs.get(deviceId);
    if (!output?.port?.send) return;

    const channelOffset = portIndex * 16;

    if (
      this.state.playback.guideVolume !== undefined &&
      Array.isArray(this.state.playback.guideChannels)
    ) {
      for (const ch of this.state.playback.guideChannels) {
        if (ch.index >= channelOffset && ch.index < channelOffset + 16) {
          const portCh = ch.index - channelOffset;
          output.port.send([0xb0 | portCh, midiControllers.expression, 127]);
          output.port.send([
            0xb0 | portCh,
            midiControllers.mainVolume,
            Math.floor(this.state.playback.guideVolume),
          ]);
        }
      }
    }

    if (this.state.playback.lockedDrumPresets) {
      for (const [chStr, preset] of Object.entries(
        this.state.playback.lockedDrumPresets,
      )) {
        const ch = parseInt(chStr, 10);
        if (ch >= channelOffset && ch < channelOffset + 16) {
          const portCh = ch - channelOffset;
          const prog = Math.max(0, Math.min(127, preset.program ?? 0));
          const rawB = Math.floor(preset.bankMSB ?? 0);
          const bMSB = rawB >= 128 ? 0 : Math.max(0, Math.min(127, rawB));
          const bLSB = Math.max(
            0,
            Math.min(127, Math.floor(preset.bankLSB ?? 0)),
          );

          output.port.send([0xb0 | portCh, midiControllers.bankSelect, bMSB]);
          output.port.send([
            0xb0 | portCh,
            midiControllers.bankSelectLSB,
            bLSB,
          ]);
          output.port.send([0xc0 | portCh, prog]);
        }
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
  }

  /**
   * Sets the active MIDI output destination for a specific port (0-3).
   * @param {string} deviceId - Hardware port ID, "internal", or "none".
   * @param {number} [port=0] - Port index (0 = Main / Port 1, 1 = Port 2, etc.)
   */
  setMidiOutputDevice(deviceId, port = 0) {
    const portIndex = Math.max(0, Math.min(3, Math.floor(port || 0)));

    if (!this.state.playback.currentMidiDeviceIds) {
      this.state.playback.currentMidiDeviceIds = [
        this.state.playback.currentMidiDeviceId || "internal",
        "none",
        "none",
        "none",
      ];
    }

    const prevDeviceId = this.state.playback.currentMidiDeviceIds[portIndex];
    const currentSequencer = this.state.playback.sequencer;

    if (portIndex === 0) {
      if (prevDeviceId === deviceId) return true;

      if (deviceId === "internal") {
        if (currentSequencer) {
          this.disconnectSequencerFromMidiOutput(currentSequencer);
        }
        this.state.playback.currentMidiDeviceId = "internal";
        this.state.playback.currentMidiDeviceIds[0] = "internal";

        logVerbose(
          "Switched Main MIDI Output to Internal Synthesizer (disabling external MIDI).",
        );
        this.dispatchUpdate();
        return true;
      }

      if (
        prevDeviceId &&
        prevDeviceId !== "internal" &&
        prevDeviceId !== "none" &&
        this.midiDeviceHandler &&
        currentSequencer
      ) {
        const prevOutput = this.midiDeviceHandler.outputs.get(prevDeviceId);
        if (prevOutput) {
          try {
            prevOutput.disconnect(currentSequencer);
          } catch (e) {}
        }
      }

      this.state.playback.currentMidiDeviceId = deviceId;
      this.state.playback.currentMidiDeviceIds[0] = deviceId;

      if (currentSequencer) {
        this.connectSequencerToMidiOutput(currentSequencer);
      }

      this.initExternalDevicePort(deviceId, 0);
      this.dispatchUpdate();
      return true;
    }

    if (prevDeviceId === deviceId) return true;

    if (
      prevDeviceId &&
      prevDeviceId !== "internal" &&
      prevDeviceId !== "none" &&
      this.midiDeviceHandler &&
      currentSequencer
    ) {
      const prevOutput = this.midiDeviceHandler.outputs.get(prevDeviceId);
      if (prevOutput) {
        try {
          prevOutput.disconnect(currentSequencer);
        } catch (e) {
          console.warn(
            `[FORTE SVC] Error disconnecting Port ${portIndex + 1}:`,
            e,
          );
        }
      }
    }

    this.state.playback.currentMidiDeviceIds[portIndex] = deviceId;

    if (
      this.hasExternalMidiDevice() &&
      deviceId &&
      deviceId !== "none" &&
      deviceId !== "internal" &&
      this.midiDeviceHandler &&
      currentSequencer
    ) {
      const newOutput = this.midiDeviceHandler.outputs.get(deviceId);
      if (newOutput) {
        try {
          newOutput.connect(currentSequencer, portIndex * 16);
          logVerbose(
            `Connected Port ${portIndex + 1} (offset ${portIndex * 16}) to: ${newOutput.name || deviceId}`,
          );
          this.initExternalDevicePort(deviceId, portIndex);
        } catch (e) {
          console.error(
            `[FORTE SVC] Failed to connect Port ${portIndex + 1}:`,
            e,
          );
          return false;
        }
      }
    }

    this.dispatchUpdate();
    return true;
  }

  /**
   * Replaces the running SoundFont buffer used in SpessaSynth.
   *
   * @param {string} url - Target SF2/SF3 endpoint structure URL.
   * @param {Object} playback - Reference to the playback module to stop active tracks.
   * @returns {Promise<boolean>} True indicating the buffer rebuilt completely, false otherwise.
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
      playback?.stopTrack?.();
    }

    logVerbose(`Swapping SoundBank with: ${url}`);

    try {
      const response = await fetch(url, { signal });

      if (!response.ok) {
        throw new Error(
          `Server returned HTTP ${response.status} (${response.statusText || "Error"}) for: ${url}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();

      if (signal.aborted) {
        return false;
      }

      if (arrayBuffer.byteLength < 12) {
        throw new Error(
          `SoundBank payload is too small (${arrayBuffer.byteLength} bytes).`,
        );
      }

      const header = new TextDecoder().decode(
        new Uint8Array(arrayBuffer, 0, 4),
      );
      if (header !== "RIFF" && header !== "RIFS") {
        throw new Error(
          `Invalid SoundFont file header: Expected 'RIFF' or 'RIFS', received '${header}'`,
        );
      }

      if (this.state.playback.synthesizer) {
        const sbm = this.state.playback.synthesizer.soundBankManager;

        if (sbm) {
          const oldBankIds = Array.isArray(sbm.soundBankList)
            ? sbm.soundBankList.map((b) => b.id)
            : [];

          const workletTimeout = new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "AudioWorklet timed out while processing SoundBank",
                  ),
                ),
              10000,
            ),
          );

          await Promise.race([sbm.addSoundBank(arrayBuffer), workletTimeout]);

          for (const bankId of oldBankIds) {
            if (typeof sbm.deleteSoundBank === "function") {
              try {
                sbm.deleteSoundBank(bankId);
              } catch (delErr) {
                logVerboseWarn(
                  `Could not remove previous SoundBank ${bankId}:`,
                  delErr,
                );
              }
            }
          }

          if (this.state.playback.transpose !== 0) {
            this.state.playback.synthesizer.setSystemParameter(
              "keyShift",
              this.state.playback.transpose,
            );
          }

          logVerbose("New SoundBank loaded into existing Synthesizer.");
          this.currentLoadController = null;
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
      this.currentLoadController = null;
      return true;
    } catch (e) {
      if (e.name === "AbortError") {
        logVerbose(`SoundBank load dynamically aborted for: ${url}`);
        return false;
      }

      console.error(`[FORTE SVC] Failed to load custom SoundBank: ${url}`, e);
      this.currentLoadController = null;
      return false;
    }
  }

  /**
   * Sends raw MIDI message bytes to an external MIDI port or broadcasts to all ports.
   * @param {number[]|Uint8Array} message - Raw MIDI bytes.
   * @param {number|null} [targetPort=null] - Target port (0-3). If null, broadcasts to all unique external ports.
   */
  sendExternalMidiMessage(message, targetPort = null) {
    if (!this.midiDeviceHandler || !this.hasExternalMidiDevice()) return;

    const deviceIds = this.state.playback.currentMidiDeviceIds || [
      this.state.playback.currentMidiDeviceId,
    ];

    if (targetPort !== null && targetPort >= 0 && targetPort < 4) {
      const deviceId = deviceIds[targetPort];
      if (deviceId && deviceId !== "internal" && deviceId !== "none") {
        const output = this.midiDeviceHandler.outputs.get(deviceId);
        if (output?.port?.send) {
          try {
            output.port.send(message);
          } catch (e) {
            logVerboseWarn(
              `[FORTE SVC] Failed to send MIDI to Port ${targetPort + 1}:`,
              e,
            );
          }
        }
      }
      return;
    }

    const sentDevices = new Set();
    for (let p = 0; p < 4; p++) {
      const deviceId = deviceIds[p];
      if (
        deviceId &&
        deviceId !== "internal" &&
        deviceId !== "none" &&
        !sentDevices.has(deviceId)
      ) {
        sentDevices.add(deviceId);
        const output = this.midiDeviceHandler.outputs.get(deviceId);
        if (output?.port?.send) {
          try {
            output.port.send(message);
          } catch (e) {
            logVerboseWarn(
              `[FORTE SVC] Failed to broadcast MIDI to ${deviceId}:`,
              e,
            );
          }
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
    if (channelNumber < 0 || channelNumber > 63) {
      throw new Error(`Invalid MIDI channel: ${channelNumber}. Must be 0-63.`);
    }
    if (volume < 0 || volume > 127) {
      throw new Error(`Invalid volume level: ${volume}. Must be 0-127.`);
    }

    const intVolume = Math.floor(volume);
    const port = Math.floor(channelNumber / 16);
    const portChannel = channelNumber % 16;

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

    this.sendExternalMidiMessage(
      [0xb0 | portChannel, midiControllers.mainVolume, intVolume],
      port,
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
    if (channelNumber < 0 || channelNumber > 63) {
      throw new Error(`Invalid MIDI channel: ${channelNumber}. Must be 0-63.`);
    }
    if (expression < 0 || expression > 127) {
      throw new Error(
        `Invalid expression level: ${expression}. Must be 0-127.`,
      );
    }

    const intExpression = Math.floor(expression);
    const port = Math.floor(channelNumber / 16);
    const portChannel = channelNumber % 16;

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

    this.sendExternalMidiMessage(
      [0xb0 | portChannel, midiControllers.expression, intExpression],
      port,
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
      `Sent external transpose: ${clamped > 0 ? "+" : ""}${clamped} semitones.`,
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
      `Sent external master volume: ${Math.round(clamped * 100)}% (${val7}/127)`,
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
    if (channelNumber < 0 || channelNumber > 63) {
      console.error("[FORTE SVC] Invalid channel number:", channelNumber);
      return false;
    }

    const port = Math.floor(channelNumber / 16);
    const portChannel = channelNumber % 16;

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

      this.sendExternalMidiMessage(
        [0xb0 | portChannel, midiControllers.bankSelect, bankMSB],
        port,
      );
      this.sendExternalMidiMessage(
        [0xb0 | portChannel, midiControllers.bankSelectLSB, bankLSB],
        port,
      );
      this.sendExternalMidiMessage([0xc0 | portChannel, program], port);

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
    if (this.hasExternalMidiDevice()) {
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
      const totalChannels = Math.min(
        64,
        this.state.playback.synthesizer.midiChannels.length || 16,
      );
      for (let i = 0; i < totalChannels; i++) {
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

    if (this.midiDeviceHandler) {
      const deviceIds = this.state.playback.currentMidiDeviceIds || [
        this.state.playback.currentMidiDeviceId || "internal",
      ];

      for (let port = 0; port < 4; port++) {
        const deviceId = deviceIds[port];
        if (deviceId && deviceId !== "internal" && deviceId !== "none") {
          const output = this.midiDeviceHandler.outputs.get(deviceId);
          if (output?.port?.send) {
            try {
              for (let ch = 0; ch < 16; ch++) {
                output.port.send([0xb0 | ch, 120, 0]); // All Sound Off
                output.port.send([0xb0 | ch, 123, 0]); // All Notes Off
                output.port.send([0xb0 | ch, 121, 0]); // Reset All Controllers
              }
            } catch (e) {
              console.warn(
                `[FORTE SVC] Failed to send MIDI reset to Port ${port + 1}:`,
                e,
              );
            }
          }
        }
      }
      this.sendExternalTranspose(0);
      this.sendExternalMasterVolume(this.state.playback.volume ?? 1);
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
