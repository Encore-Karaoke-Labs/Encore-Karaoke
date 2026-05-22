import { Sequencer } from "spessasynth_lib";
import { BasicMIDI } from "spessasynth_core";
import { bindSpessaEvent } from "./Synthesizer.js";
import { logVerbose } from "../core/State.js";

export class ForteSFX {
  /**
   * Initializes the SFX and Remote Stream manager.
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   * @param {Object} synthesizer - Reference to the ForteSynthesizer instance.
   */
  constructor(state, audioCore, synthesizer) {
    this.state = state;
    this.audioCore = audioCore;
    this.synthesizer = synthesizer;

    this.sfxCache = new Map();
    this.sfxSourceNode = null;
    this.sfxSequencer = null;
    this.sfxResolve = null;
    this.sfxMidiOriginalVolume = null;
    this.currentSfxMidi = null;
  }

  /**
   * Loads a short sound effect into the global buffer cache.
   *
   * @param {string} url - Audio endpoint.
   * @returns {Promise<boolean>} True if loaded.
   */
  async loadSfx(url) {
    if (!this.audioCore.context) return false;
    if (this.sfxCache.has(url)) return true;

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();

      const isMidi =
        url.toLowerCase().endsWith(".mid") ||
        url.toLowerCase().endsWith(".midi") ||
        url.toLowerCase().endsWith(".kar");

      if (isMidi) {
        this.sfxCache.set(url, { isMidi: true, buffer: arrayBuffer });
        return true;
      }

      const audioBuffer =
        await this.audioCore.context.decodeAudioData(arrayBuffer);
      this.sfxCache.set(url, { isMidi: false, buffer: audioBuffer });
      return true;
    } catch (e) {
      console.error(`[FORTE SVC] Failed to load SFX: ${url}`, e);
      return false;
    }
  }

  /**
   * Fires a previously cached sound effect immediately.
   * Resolves when the effect has fully completed playing.
   *
   * @param {string} url - Target URL matching the cache dictionary.
   * @param {number} [volume=1] - Optional volume multiplier from 0.0 to 1.0 for this specific play.
   * @returns {Promise<boolean>} Resolves to true when completed naturally, false if interrupted.
   */
  async playSfx(url, volume = 1) {
    await this.stopSfx();

    return new Promise(async (resolve) => {
      if (!this.audioCore.context) return resolve(false);
      if (this.audioCore.context.state === "suspended")
        await this.audioCore.context.resume();

      let cached = this.sfxCache.get(url);
      if (!cached) {
        const success = await this.loadSfx(url);
        if (!success) return resolve(false);
        cached = this.sfxCache.get(url);
      }

      const clampedVolume = Math.max(0, Math.min(1, volume));

      if (cached) {
        this.sfxResolve = resolve;

        if (cached.isMidi) {
          if (!this.state.playback.synthesizer || !this.state.playback.midiGain)
            return resolve(false);

          logVerbose("Unlocking channels");
          this.synthesizer.unlockAllChannels();

          logVerbose("Resetting synth just in case");
          this.synthesizer.reset();

          this.sfxMidiOriginalVolume = this.state.playback.midiGain.gain.value;
          const sfxTargetVolume =
            this.state.playback.volume *
            this.state.playback.sfxVolume *
            clampedVolume;

          this.state.playback.midiGain.gain.setTargetAtTime(
            sfxTargetVolume,
            this.audioCore.context.currentTime,
            0.01,
          );

          this.sfxSequencer = new Sequencer(this.state.playback.synthesizer);
          this.sfxSequencer.loop = false;

          try {
            this.currentSfxMidi = BasicMIDI.fromArrayBuffer(cached.buffer);
          } catch (e) {
            this.currentSfxMidi = { binary: cached.buffer };
          }
          this.sfxSequencer.loadNewSongList([this.currentSfxMidi]);
          this.sfxSequencer.play();

          bindSpessaEvent(
            this.sfxSequencer.eventHandler,
            "songEnded",
            "forte-sfx-end",
            () => {
              if (
                this.sfxMidiOriginalVolume !== null &&
                this.state.playback.midiGain
              ) {
                this.state.playback.midiGain.gain.setTargetAtTime(
                  this.sfxMidiOriginalVolume,
                  this.audioCore.context.currentTime,
                  0.01,
                );
                this.sfxMidiOriginalVolume = null;
              }

              logVerbose("Unlocking channels");
              this.synthesizer.unlockAllChannels();

              logVerbose("Resetting synth just in case");
              this.synthesizer.reset();

              if (
                this.currentSfxMidi &&
                typeof this.currentSfxMidi.flush === "function"
              ) {
                try {
                  logVerbose("Flushing current midi sound effect");
                  this.currentSfxMidi.flush();
                } catch (e) {
                  console.warn("[FORTE SVC] Failed to flush MIDI data:", e);
                }
              }

              this.currentSfxMidi = null;

              if (this.sfxResolve) {
                this.sfxResolve(true);
                this.sfxResolve = null;
              }
              if (this.sfxSequencer) {
                try {
                  this.sfxSequencer.pause();
                } catch (e) {}
                this.sfxSequencer = null;
              }
            },
          );
        } else {
          this.sfxSourceNode = this.audioCore.context.createBufferSource();
          this.sfxSourceNode.buffer = cached.buffer;

          const sfxIndividualGain = this.audioCore.context.createGain();
          sfxIndividualGain.gain.value = clampedVolume;
          this.sfxSourceNode.connect(sfxIndividualGain);
          sfxIndividualGain.connect(this.audioCore.sfxGain);

          this.sfxSourceNode.onended = () => {
            if (this.sfxResolve) {
              this.sfxResolve(true);
              this.sfxResolve = null;
            }
          };
          this.sfxSourceNode.start(0);
        }
      } else {
        resolve(false);
      }
    });
  }

  /**
   * Stops currently playing sound effect and restores volumes if needed.
   */
  async stopSfx() {
    if (this.sfxSourceNode) {
      this.sfxSourceNode.onended = null;
      this.sfxSourceNode.stop();
      this.sfxSourceNode = null;
    }

    if (this.sfxSequencer) {
      try {
        this.sfxSequencer.pause();
      } catch (e) {}
      try {
        this.sfxSequencer.currentTime = 0;
      } catch (e) {}
      this.sfxSequencer = null;

      if (this.sfxMidiOriginalVolume !== null && this.state.playback.midiGain) {
        this.state.playback.midiGain.gain.setTargetAtTime(
          this.sfxMidiOriginalVolume,
          this.audioCore.context.currentTime,
          0.01,
        );
        this.sfxMidiOriginalVolume = null;
      }
    }

    if (
      this.currentSfxMidi &&
      typeof this.currentSfxMidi.flush === "function"
    ) {
      logVerbose("Unlocking channels");
      this.synthesizer.unlockAllChannels();

      logVerbose("Resetting synth just in case");
      this.synthesizer.reset();
      try {
        logVerbose("Flushing current midi sound effect");
        this.currentSfxMidi.flush();
      } catch (e) {
        console.warn("[FORTE SVC] Failed to flush MIDI data:", e);
      }
      this.currentSfxMidi = null;
    }

    if (this.sfxResolve) {
      this.sfxResolve(false);
      this.sfxResolve = null;
    }
  }

  /**
   * Attaches an incoming remote WebRTC audio stream to the Forte audio context.
   * @param {string} peerId - Unique ID of the peer
   * @param {MediaStream} stream - Remote audio stream
   */
  playRemoteStream(peerId, stream) {
    if (!this.audioCore.context) return;
    this.stopRemoteStream(peerId);

    if (!this.state.playback.remoteSources)
      this.state.playback.remoteSources = new Map();
    if (!this.state.playback.remoteAudioElements)
      this.state.playback.remoteAudioElements = new Map();

    // i'm still spiteful, Google
    // why the F*CK do I have to do this?
    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.muted = true;
    audioEl.srcObject = stream;
    this.state.playback.remoteAudioElements.set(peerId, audioEl);

    const source = this.audioCore.context.createMediaStreamSource(stream);
    source.connect(this.audioCore.masterGain);

    this.state.playback.remoteSources.set(peerId, source);
    logVerbose(`Started playing remote stream for ${peerId}`);
  }

  /**
   * Disconnects a specific remote WebRTC audio stream.
   * @param {string} peerId - Unique ID of the peer
   */
  stopRemoteStream(peerId) {
    if (
      this.state.playback.remoteSources &&
      this.state.playback.remoteSources.has(peerId)
    ) {
      const source = this.state.playback.remoteSources.get(peerId);
      source.disconnect();
      this.state.playback.remoteSources.delete(peerId);
      logVerbose(`Stopped remote stream for ${peerId}`);
    }

    if (
      this.state.playback.remoteAudioElements &&
      this.state.playback.remoteAudioElements.has(peerId)
    ) {
      const audioEl = this.state.playback.remoteAudioElements.get(peerId);
      audioEl.pause();
      audioEl.srcObject = null;
      this.state.playback.remoteAudioElements.delete(peerId);
    }
  }

  /**
   * Clears all incoming remote streams.
   */
  clearRemoteStreams() {
    if (this.state.playback.remoteSources) {
      for (let [id, source] of this.state.playback.remoteSources.entries()) {
        source.disconnect();
      }
      this.state.playback.remoteSources.clear();
    }

    if (this.state.playback.remoteAudioElements) {
      for (let audioEl of this.state.playback.remoteAudioElements.values()) {
        audioEl.pause();
        audioEl.srcObject = null;
      }
      this.state.playback.remoteAudioElements.clear();
    }
  }

  /**
   * Destroy and unbind all related nodes.
   */
  cleanup() {
    this.stopSfx();
    this.clearRemoteStreams();
    this.sfxCache.clear();
  }
}
