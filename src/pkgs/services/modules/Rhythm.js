import {
  BasicMIDI,
  MIDIControllers as midiControllers,
  MIDIMessageTypes as midiMessageTypes,
} from "spessasynth_core";
import { logVerbose, logVerboseWarn } from "../core/State.js";

const RHYTHM_ASSET_ROOT = "/assets/audio/rhythms/";
const DEFAULT_BEATS_PER_BAR = 4;
const SONG_DRUM_CHANNEL = 9;
const EXTERNAL_DRUM_CHANNEL = 9;

/**
 * How far ahead of the playhead rhythm notes are scheduled, in seconds
 */
const SCHEDULE_LOOKAHEAD_SECONDS = 0.12;

/**
 * If the playhead moves further than this (in beats) away from the scheduler
 * cursor, the pending timers are rebuilt from scratch.
 */
const RESYNC_THRESHOLD_BEATS = 0.75;

/**
 * Reads a time-signature meta event and returns its length in quarter notes.
 *
 * @param {ArrayLike<number>} data - Raw meta event data.
 * @returns {number} Beats per bar, expressed in quarter notes.
 */
function beatsPerBarFromTimeSignature(data) {
  if (!data || data.length < 2) return DEFAULT_BEATS_PER_BAR;

  const numerator = Math.max(1, Math.floor(data[0] || 4));
  const denominator = Math.pow(2, Math.max(0, Math.min(6, data[1] ?? 2)));

  return Math.max(0.25, (numerator * 4) / denominator);
}

/**
 * Finds the first time signature in a MIDI file.
 *
 * @param {Object} midi - Parsed BasicMIDI instance.
 * @returns {number} Beats per bar in quarter notes.
 */
function findFirstBeatsPerBar(midi) {
  let first = null;

  for (const track of midi.tracks || []) {
    for (const event of track.events || []) {
      if (
        event.statusByte === midiMessageTypes.timeSignature &&
        event.data &&
        event.data.length >= 2
      ) {
        if (!first || event.ticks < first.ticks) {
          first = event;
        }
      }
    }
  }

  return first
    ? beatsPerBarFromTimeSignature(first.data)
    : DEFAULT_BEATS_PER_BAR;
}

/**
 * Builds a piecewise meter map for a song.
 *
 * @param {Object} midi - Parsed BasicMIDI instance.
 * @param {number} ppq - Ticks per quarter note.
 * @returns {{segments: Array<Object>, ppq: number}}
 */
export function buildMeterMap(midi, ppq) {
  const signatures = [];

  for (const track of midi.tracks || []) {
    for (const event of track.events || []) {
      if (
        event.statusByte === midiMessageTypes.timeSignature &&
        event.data &&
        event.data.length >= 2
      ) {
        signatures.push({
          ticks: event.ticks,
          beatsPerBar: beatsPerBarFromTimeSignature(event.data),
        });
      }
    }
  }

  signatures.sort((a, b) => a.ticks - b.ticks);

  const unique = [];
  for (const signature of signatures) {
    const previous = unique[unique.length - 1];
    if (previous && previous.ticks === signature.ticks) {
      unique[unique.length - 1] = signature;
    } else {
      unique.push(signature);
    }
  }

  if (unique.length === 0 || unique[0].ticks > 0) {
    unique.unshift({ ticks: 0, beatsPerBar: DEFAULT_BEATS_PER_BAR });
  }

  const segments = [];
  let barOffset = 0;

  for (let i = 0; i < unique.length; i++) {
    const startTick = Math.max(0, unique[i].ticks);
    const beatsPerBar = unique[i].beatsPerBar;

    if (i > 0) {
      const previous = segments[i - 1];
      const barTicks = previous.beatsPerBar * ppq;
      barOffset += Math.max(
        0,
        Math.round((startTick - previous.startTick) / barTicks),
      );
    }

    segments.push({ startTick, beatsPerBar, barOffset });
  }

  return { segments, ppq };
}

/**
 * Returns the absolute bar number containing a MIDI tick.
 *
 * @param {{segments: Array<Object>, ppq: number}} meterMap
 * @param {number} tick
 * @returns {number}
 */
export function getBarIndexAtTick(meterMap, tick) {
  const segments = meterMap?.segments;
  if (!segments || segments.length === 0) return 0;

  let segment = segments[0];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].startTick <= tick) segment = segments[i];
    else break;
  }

  const barTicks = Math.max(1, segment.beatsPerBar * meterMap.ppq);
  return (
    segment.barOffset +
    Math.floor(Math.max(0, tick - segment.startTick) / barTicks)
  );
}

/**
 * Returns the start tick and meter of an absolute bar.
 *
 * @param {{segments: Array<Object>, ppq: number}} meterMap
 * @param {number} barIndex
 * @returns {{startTick: number, beatsPerBar: number}|null}
 */
export function getBarInfo(meterMap, barIndex) {
  const segments = meterMap?.segments;
  if (!segments || segments.length === 0 || barIndex < 0) return null;

  let segment = segments[0];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].barOffset <= barIndex) segment = segments[i];
    else break;
  }

  const barTicks = Math.max(1, segment.beatsPerBar * meterMap.ppq);
  const relativeBar = barIndex - segment.barOffset;

  return {
    startTick: segment.startTick + relativeBar * barTicks,
    beatsPerBar: segment.beatsPerBar,
  };
}

/**
 * Normalises a rhythm MIDI file into bar-relative drum events.
 *
 * @param {string} name - Display name from the manifest.
 * @param {string} path - Manifest path, used for logging.
 * @param {Object} midi - Parsed BasicMIDI instance.
 * @returns {Object|null}
 */
export function buildRhythmDefinition(name, path, midi) {
  const ppq =
    midi.timeDivision && midi.timeDivision > 0 ? midi.timeDivision : 480;
  const beatsPerBar = findFirstBeatsPerBar(midi);
  const noteChannels =
    typeof midi.getNoteTimes === "function" ? midi.getNoteTimes() : [];

  let drumChannels = [SONG_DRUM_CHANNEL];
  if (!noteChannels[SONG_DRUM_CHANNEL]?.length) {
    drumChannels = [];
    for (let channel = 0; channel < 16; channel++) {
      if (noteChannels[channel]?.length) drumChannels.push(channel);
    }
  }

  const events = [];
  let maxEndTick = 0;

  for (const channel of drumChannels) {
    for (const note of noteChannels[channel] || []) {
      const startTick = midi.secondsToMIDITicks(note.start);
      const endTick = Math.max(
        startTick + 1,
        midi.secondsToMIDITicks(note.start + note.length),
      );

      const beat = startTick / ppq;
      const rawBar = Math.floor(beat / beatsPerBar);
      const beatInBar = beat - rawBar * beatsPerBar;

      events.push({
        bar: rawBar,
        beatInBar,
        lengthBeats: Math.max(0.01, (endTick - startTick) / ppq),
        note: note.midiNote,
        velocity: Math.max(1, Math.min(127, note.velocity || 100)),
      });

      maxEndTick = Math.max(maxEndTick, endTick);
    }
  }

  if (events.length === 0) {
    logVerboseWarn(`Rhythm "${name}" contains no drum notes.`);
    return null;
  }

  const totalBeats = maxEndTick / ppq;
  const barCount = Math.max(1, Math.ceil(totalBeats / beatsPerBar - 1e-6));

  const eventsByBar = Array.from({ length: barCount }, () => []);
  for (const event of events) {
    const bar = ((event.bar % barCount) + barCount) % barCount;
    const beatInBar =
      event.bar * beatsPerBar + event.beatInBar - bar * beatsPerBar;

    if (!eventsByBar[bar]) eventsByBar[bar] = [];
    eventsByBar[bar].push({
      beatInBar,
      lengthBeats: event.lengthBeats,
      note: event.note,
      velocity: event.velocity,
    });
  }

  return {
    name,
    path,
    ppq,
    beatsPerBar,
    barCount,
    eventsByBar,
    eventCount: events.length,
  };
}

export class ForteRhythm {
  /**
   * Creates the rhythm engine.
   *
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - ForteAudioCore instance.
   * @param {Object} synthesizer - ForteSynthesizer instance.
   * @param {Function} dispatchUpdate - Playback update callback.
   */
  constructor(state, audioCore, synthesizer, dispatchUpdate) {
    this.state = state;
    this.audioCore = audioCore;
    this.synthesizer = synthesizer;
    this.dispatchUpdate = dispatchUpdate;

    this.rhythms = [];
    this.currentIndex = -1;
    this.isActive = false;

    this.rhythmChannel = null;
    this.songMidi = null;
    this.meterMap = null;
    this.songPpq = 480;

    this.pendingTimers = new Set();
    this.activeNotes = new Map();
    this.lastScheduledTick = null;
    this.lastKitSignature = "";
    this.lastKitCheck = 0;

    this.previousSongDrumMute = false;
    this.muteCaptured = false;
  }

  /**
   * Loads the rhythm manifest and pre-allocates the dedicated internal drum
   * channel.
   */
  async initialize() {
    await this.loadManifest();
    await this.ensureRhythmChannel();
  }

  async loadManifest() {
    try {
      const response = await fetch(`${RHYTHM_ASSET_ROOT}manifest.json`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} while loading rhythm manifest`,
        );
      }

      const entries = await response.json();
      if (!Array.isArray(entries)) return;

      const loaded = [];

      for (const entry of entries) {
        const name = String(entry?.LOOP_NAME || entry?.name || "").trim();
        const path = String(entry?.PATH || entry?.path || "").trim();
        if (!name || !path) continue;

        try {
          const midiResponse = await fetch(
            `${RHYTHM_ASSET_ROOT}${encodeURI(path)}`,
          );
          if (!midiResponse.ok) {
            throw new Error(`HTTP ${midiResponse.status}`);
          }

          const arrayBuffer = await midiResponse.arrayBuffer();
          const midi = BasicMIDI.fromArrayBuffer(arrayBuffer, path);
          const definition = buildRhythmDefinition(name, path, midi);

          if (definition) loaded.push(definition);
        } catch (e) {
          logVerboseWarn(`Could not load rhythm "${name}" (${path}):`, e);
        }
      }

      this.rhythms = loaded;
      logVerbose(`Loaded ${loaded.length} rhythm pattern(s).`, loaded);
    } catch (e) {
      logVerboseWarn("Could not load the rhythm manifest:", e);
      this.rhythms = [];
    }
  }

  /**
   * Adds one dedicated internal MIDI channel for rhythm playback.
   *
   * @returns {Promise<number|null>}
   */
  async ensureRhythmChannel() {
    const synth = this.state.playback.synthesizer;
    if (!synth) return null;

    if (
      this.rhythmChannel !== null &&
      synth.midiChannels?.[this.rhythmChannel]
    ) {
      return this.rhythmChannel;
    }

    const previousLength = synth.midiChannels?.length || 16;
    const targetChannel = previousLength;

    try {
      synth.addNewChannel();
    } catch (e) {
      logVerboseWarn("Could not allocate a rhythm MIDI channel:", e);
      return null;
    }

    const deadline = Date.now() + 750;
    while (Date.now() < deadline) {
      if (synth.midiChannels?.[targetChannel]) {
        this.rhythmChannel = targetChannel;
        return this.rhythmChannel;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    logVerboseWarn("Timed out while allocating the rhythm MIDI channel.");
    return null;
  }

  getRhythmList() {
    return [
      { name: "Original Drums", original: true },
      ...this.rhythms.map((rhythm) => ({
        name: rhythm.name,
        original: false,
      })),
    ];
  }

  getCurrentIndex() {
    return this.currentIndex;
  }

  getCurrentRhythm() {
    return this.currentIndex >= 0 ? this.rhythms[this.currentIndex] : null;
  }

  getCurrentRhythmName() {
    if (this.currentIndex < 0) return "Original Drums";
    return this.rhythms[this.currentIndex]?.name || "Original Drums";
  }

  getState() {
    return {
      rhythmIndex: this.currentIndex,
      rhythmName: this.getCurrentRhythmName(),
      rhythmCount: this.rhythms.length,
      rhythmActive: this.isActive,
    };
  }

  /**
   * Cycles between the original drums and the available rhythm patterns.
   *
   * @param {"left"|"right"} direction
   * @returns {Promise<Object>}
   */
  async cycleRhythm(direction) {
    if (this.rhythms.length === 0) {
      return { success: false, reason: "No rhythm patterns available." };
    }

    const step = direction === "left" ? -1 : 1;
    let nextIndex = this.currentIndex + step;

    if (nextIndex < -1) nextIndex = this.rhythms.length - 1;
    if (nextIndex >= this.rhythms.length) nextIndex = -1;

    return await this.setRhythm(nextIndex);
  }

  /**
   * Applies a rhythm by index. -1 selects the original drum track.
   *
   * @param {number} index
   * @returns {Promise<Object>}
   */
  async setRhythm(index) {
    const safeIndex = Math.max(-1, Math.min(this.rhythms.length - 1, index));

    if (
      safeIndex === this.currentIndex &&
      (safeIndex === -1 || this.isActive)
    ) {
      return {
        success: true,
        rhythmIndex: this.currentIndex,
        rhythmName: this.getCurrentRhythmName(),
        rhythmCount: this.rhythms.length,
        isOriginal: this.currentIndex < 0,
      };
    }

    this.cancelScheduledNotes();

    if (safeIndex < 0) {
      this.deactivate();
      this.currentIndex = -1;
      this.dispatchUpdate();
      return {
        success: true,
        rhythmIndex: -1,
        rhythmName: "Original Drums",
        rhythmCount: this.rhythms.length,
        isOriginal: true,
      };
    }

    this.currentIndex = safeIndex;
    const activated = await this.activate();

    if (!activated) {
      this.currentIndex = -1;
      this.deactivate();
      this.dispatchUpdate();
      return {
        success: false,
        reason: "Could not start the selected rhythm.",
      };
    }

    this.dispatchUpdate();
    return {
      success: true,
      rhythmIndex: this.currentIndex,
      rhythmName: this.getCurrentRhythmName(),
      rhythmCount: this.rhythms.length,
      isOriginal: false,
    };
  }

  /**
   * Mutes the song's drum channel and starts scheduling the selected rhythm.
   *
   * @returns {Promise<boolean>}
   */
  async activate() {
    const synth = this.state.playback.synthesizer;
    const midi = this.state.playback.currentMidi;
    const rhythm = this.getCurrentRhythm();

    if (!synth || !midi || !rhythm) return false;

    const channel = await this.ensureRhythmChannel();
    if (channel === null) return false;

    this.songMidi = midi;
    this.songPpq =
      midi.timeDivision && midi.timeDivision > 0 ? midi.timeDivision : 480;
    this.meterMap = buildMeterMap(midi, this.songPpq);

    const songDrumChannel = synth.midiChannels?.[SONG_DRUM_CHANNEL] || null;

    if (!this.muteCaptured) {
      this.previousSongDrumMute =
        songDrumChannel?.systemParameters?.isMuted ?? false;
      this.muteCaptured = true;
    }

    try {
      synth.controllerChange(SONG_DRUM_CHANNEL, midiControllers.allSoundOff, 0);
      songDrumChannel?.setSystemParameter("isMuted", true);
    } catch (e) {
      logVerboseWarn("Could not mute the song drum channel:", e);
    }

    this.synthesizer.setExternalDrumReplacement(true, EXTERNAL_DRUM_CHANNEL);
    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.allNotesOff, 0],
      0,
    );

    this.lastKitSignature = "";
    this.applyKitToRhythmChannel(this.synthesizer.getCurrentDrumPreset(9));

    this.isActive = true;
    this.lastScheduledTick = null;
    this.lastKitCheck = 0;

    logVerbose(`Rhythm activated: ${rhythm.name}`);
    return true;
  }

  /**
   * Restores the original drum track.
   */
  deactivate() {
    this.cancelScheduledNotes();
    this.isActive = false;
    this.lastScheduledTick = null;
    this.songMidi = null;
    this.meterMap = null;

    this.synthesizer.setExternalDrumReplacement(false, EXTERNAL_DRUM_CHANNEL);
    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.allNotesOff, 0],
      0,
    );

    const synth = this.state.playback.synthesizer;
    const songDrumChannel = synth?.midiChannels?.[SONG_DRUM_CHANNEL];

    if (synth && songDrumChannel) {
      try {
        synth.controllerChange(
          SONG_DRUM_CHANNEL,
          midiControllers.allSoundOff,
          0,
        );
        songDrumChannel.setSystemParameter(
          "isMuted",
          this.previousSongDrumMute,
        );
      } catch (e) {
        logVerboseWarn("Could not restore the song drum channel:", e);
      }
    }

    this.muteCaptured = false;
    logVerbose("Rhythm returned to the original drum track.");
  }

  /**
   * Mirrors the song's current drum kit onto the dedicated rhythm channel.
   *
   * @param {Object|null} preset
   */
  applyKitToRhythmChannel(preset) {
    const synth = this.state.playback.synthesizer;
    const channel = this.rhythmChannel;

    if (!synth || channel === null || !synth.midiChannels?.[channel]) return;

    const midiChannel = synth.midiChannels[channel];
    const safePreset = preset || {
      program: 0,
      bankMSB: 0,
      bankLSB: 0,
      isGMGSDrum: true,
    };

    const program = Math.max(
      0,
      Math.min(127, Math.floor(safePreset.program ?? 0)),
    );
    const rawBankMSB = Math.floor(safePreset.bankMSB ?? 0);
    const bankMSB =
      rawBankMSB >= 128 ? 0 : Math.max(0, Math.min(127, rawBankMSB));
    const bankLSB = Math.max(
      0,
      Math.min(127, Math.floor(safePreset.bankLSB ?? 0)),
    );

    try {
      midiChannel.setSystemParameter("presetLock", false);
      midiChannel.setDrums(true);

      if (safePreset.isGMGSDrum) {
        synth.controllerChange(channel, midiControllers.bankSelect, 0);
        synth.controllerChange(channel, midiControllers.bankSelectLSB, 0);
      } else {
        synth.controllerChange(channel, midiControllers.bankSelect, bankMSB);
        synth.controllerChange(channel, midiControllers.bankSelectLSB, bankLSB);
      }

      synth.programChange(channel, program);
      midiChannel.setSystemParameter("presetLock", true);

      this.lastKitSignature = `${program}:${bankMSB}:${bankLSB}:${Boolean(
        safePreset.isGMGSDrum,
      )}`;
    } catch (e) {
      logVerboseWarn(
        "Could not mirror the drum kit onto the rhythm channel:",
        e,
      );
    }
  }

  /**
   * Called by ForteSynthesizer when the user changes the song's drum kit.
   *
   * @param {number} channelNumber
   * @param {Object|null} preset
   */
  handleKitChange(channelNumber, preset) {
    if (channelNumber !== SONG_DRUM_CHANNEL || !this.isActive) return;

    const current =
      preset || this.synthesizer.getCurrentDrumPreset(SONG_DRUM_CHANNEL);
    this.applyKitToRhythmChannel(current);
  }

  /**
   * Schedules all rhythm events in the next lookahead window.
   *
   * @param {number} songTime - Current song position in seconds.
   */
  tick(songTime) {
    if (!this.isActive || this.currentIndex < 0) return;
    if (this.state.playback.status !== "playing") return;

    const midi = this.state.playback.currentMidi;
    if (!midi || midi !== this.songMidi) {
      this.songMidi = midi;
      this.songPpq =
        midi?.timeDivision && midi.timeDivision > 0 ? midi.timeDivision : 480;
      this.meterMap = midi ? buildMeterMap(midi, this.songPpq) : null;
      this.lastScheduledTick = null;
    }

    if (!this.meterMap || !Number.isFinite(songTime) || songTime < 0) return;

    const currentTick = midi.secondsToMIDITicks(songTime);
    const threshold = this.songPpq * RESYNC_THRESHOLD_BEATS;

    if (this.lastScheduledTick === null) {
      this.lastScheduledTick = currentTick - 0.001;
    } else if (
      currentTick < this.lastScheduledTick - threshold ||
      currentTick > this.lastScheduledTick + threshold
    ) {
      this.cancelScheduledNotes();
      this.lastScheduledTick = currentTick - 0.001;
    }

    if (currentTick > this.lastScheduledTick) {
      this.lastScheduledTick = currentTick - 0.001;
    }

    const windowEndTick = midi.secondsToMIDITicks(
      songTime + SCHEDULE_LOOKAHEAD_SECONDS,
    );

    if (windowEndTick > this.lastScheduledTick) {
      this.scheduleWindow(songTime, currentTick, windowEndTick);
    }

    this.refreshKitIfNeeded();
  }

  /**
   * Schedules every rhythm event in an absolute MIDI tick window.
   *
   * @param {number} songTime
   * @param {number} startTick
   * @param {number} endTick
   */
  scheduleWindow(songTime, startTick, endTick) {
    const midi = this.state.playback.currentMidi;
    const rhythm = this.getCurrentRhythm();
    const meterMap = this.meterMap;

    if (!midi || !rhythm || !meterMap) return;

    const firstBar = getBarIndexAtTick(meterMap, startTick);
    const lastBar = getBarIndexAtTick(meterMap, endTick);

    const barLimit = Math.min(lastBar, firstBar + 128);

    for (let barIndex = firstBar; barIndex <= barLimit; barIndex++) {
      const bar = getBarInfo(meterMap, barIndex);
      if (!bar) break;

      const rhythmBar =
        ((barIndex % rhythm.barCount) + rhythm.barCount) % rhythm.barCount;
      const events = rhythm.eventsByBar[rhythmBar] || [];

      for (const event of events) {
        const targetTick = Math.round(
          bar.startTick +
            (event.beatInBar / rhythm.beatsPerBar) *
              bar.beatsPerBar *
              this.songPpq,
        );

        if (targetTick <= this.lastScheduledTick || targetTick > endTick) {
          continue;
        }

        const endTargetTick = Math.max(
          targetTick + 1,
          Math.round(
            bar.startTick +
              ((event.beatInBar + event.lengthBeats) / rhythm.beatsPerBar) *
                bar.beatsPerBar *
                this.songPpq,
          ),
        );

        this.scheduleNote(
          midi,
          songTime,
          targetTick,
          endTargetTick,
          event.note,
          event.velocity,
        );
      }
    }

    this.lastScheduledTick = endTick;
  }

  scheduleNote(midi, songTime, startTick, endTick, note, velocity) {
    const startTime = midi.midiTicksToSeconds(startTick);
    const endTime = Math.max(
      startTime + 0.01,
      midi.midiTicksToSeconds(endTick),
    );

    const startDelay = Math.max(0, (startTime - songTime) * 1000);
    const endDelay = Math.max(startDelay + 5, (endTime - songTime) * 1000);

    const onTimer = setTimeout(() => {
      this.pendingTimers.delete(onTimer);
      this.startRhythmNote(note, velocity);
    }, startDelay);

    const offTimer = setTimeout(() => {
      this.pendingTimers.delete(offTimer);
      this.stopRhythmNote(note);
    }, endDelay);

    this.pendingTimers.add(onTimer);
    this.pendingTimers.add(offTimer);
  }

  startRhythmNote(note, velocity) {
    const synth = this.state.playback.synthesizer;

    if (synth && this.rhythmChannel !== null) {
      try {
        synth.noteOn(this.rhythmChannel, note, velocity);
      } catch (e) {
        logVerboseWarn("Could not play internal rhythm note:", e);
      }
    }

    this.synthesizer.sendExternalMidiMessage(
      [0x90 | EXTERNAL_DRUM_CHANNEL, note, velocity],
      0,
    );

    this.activeNotes.set(note, (this.activeNotes.get(note) || 0) + 1);
  }

  stopRhythmNote(note) {
    const synth = this.state.playback.synthesizer;

    if (synth && this.rhythmChannel !== null) {
      try {
        synth.noteOff(this.rhythmChannel, note);
      } catch (e) {
        logVerboseWarn("Could not stop internal rhythm note:", e);
      }
    }

    this.synthesizer.sendExternalMidiMessage(
      [0x80 | EXTERNAL_DRUM_CHANNEL, note, 0],
      0,
    );

    const remaining = (this.activeNotes.get(note) || 0) - 1;
    if (remaining > 0) this.activeNotes.set(note, remaining);
    else this.activeNotes.delete(note);
  }

  cancelScheduledNotes() {
    const hadActivity =
      this.pendingTimers.size > 0 || this.activeNotes.size > 0 || this.isActive;

    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();

    for (const [note, count] of this.activeNotes.entries()) {
      for (let i = 0; i < count; i++) this.stopRhythmNote(note);
    }
    this.activeNotes.clear();

    if (!hadActivity) return;

    const synth = this.state.playback.synthesizer;
    if (synth && this.rhythmChannel !== null) {
      try {
        synth.controllerChange(
          this.rhythmChannel,
          midiControllers.allNotesOff,
          0,
        );
      } catch (e) {}
    }

    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.allNotesOff, 0],
      0,
    );
  }

  refreshKitIfNeeded() {
    const now = performance.now();
    if (now - this.lastKitCheck < 500) return;
    this.lastKitCheck = now;

    const preset = this.synthesizer.getCurrentDrumPreset(SONG_DRUM_CHANNEL);
    if (!preset) return;

    const signature = `${preset.program}:${preset.bankMSB}:${preset.bankLSB}:${Boolean(
      preset.isGMGSDrum,
    )}`;

    if (signature !== this.lastKitSignature) {
      this.applyKitToRhythmChannel(preset);
    }
  }

  pause() {
    this.cancelScheduledNotes();
    this.lastScheduledTick = null;
  }

  resume() {
    this.lastScheduledTick = null;
  }

  /**
   * Stops rhythm playback and restores the original drum track.
   */
  stop() {
    const wasSelected = this.currentIndex !== -1;
    const wasActive = this.isActive || this.muteCaptured;

    this.cancelScheduledNotes();

    if (wasActive) {
      this.deactivate();
    } else {
      this.isActive = false;
      this.lastScheduledTick = null;
      this.songMidi = null;
      this.meterMap = null;
    }

    this.currentIndex = -1;

    if (wasSelected) this.dispatchUpdate();
  }

  cleanup() {
    this.stop();
    this.rhythms = [];
  }
}
