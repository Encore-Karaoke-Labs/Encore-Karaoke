import {
  BasicMIDI,
  MIDIControllers as midiControllers,
  MIDIMessage,
  MIDIMessageTypes as midiMessageTypes,
  MIDITrack,
} from "spessasynth_core";
import { logVerbose, logVerboseWarn } from "../core/State.js";
import { bindSpessaEvent } from "./Synthesizer.js";

const RHYTHM_ASSET_ROOT = "/assets/audio/rhythms/";
const DEFAULT_BEATS_PER_BAR = 4;
const SONG_DRUM_CHANNEL = 9;
const EXTERNAL_DRUM_CHANNEL = 9;
const LOCAL_DRUM_CHANNEL = 9;
const RHYTHM_CHANNEL_VOLUME = 100;

/**
 * Drum notes used for backbeat / half-time detection.
 * Snare, side stick and hand clap.
 */
const SNARE_NOTES = new Set([37, 38, 39, 40]);

/**
 * Note densities below/above these thresholds are ignored when measuring
 * snare intervals.
 */
const MIN_SNARE_INTERVAL_BEATS = 0.25;
const MAX_SNARE_INTERVAL_BEATS = 8;

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
 * Returns the tempo in effect at the start of the sequence.
 *
 * @param {Object} midi - Parsed BasicMIDI instance.
 * @returns {number} BPM.
 */
function findInitialTempo(midi) {
  const changes = midi?.tempoChanges;
  if (!Array.isArray(changes) || changes.length === 0) return 120;

  const index = changes.findIndex((change) => change.ticks <= 0);
  const entry = index === -1 ? changes[changes.length - 1] : changes[index];

  return entry?.tempo || 120;
}

/**
 * Extracts the drum kit a rhythm file asks for on its percussion channel.
 *
 * @param {Object} midi - Parsed BasicMIDI instance.
 * @returns {{program: number, bankMSB: number, bankLSB: number}}
 */
function readRhythmKit(midi) {
  const kit = { program: 0, bankMSB: 0, bankLSB: 0 };

  for (const track of midi.tracks || []) {
    for (const event of track.events || []) {
      const channel = event.statusByte & 0x0f;
      if (channel !== SONG_DRUM_CHANNEL) continue;

      const status = event.statusByte & 0xf0;
      if (status === 0xc0 && event.data?.length) {
        kit.program = Math.max(0, Math.min(127, event.data[0]));
      } else if (status === 0xb0 && event.data?.length >= 2) {
        if (event.data[0] === midiControllers.bankSelect) {
          kit.bankMSB = Math.max(0, Math.min(127, event.data[1]));
        } else if (event.data[0] === midiControllers.bankSelectLSB) {
          kit.bankLSB = Math.max(0, Math.min(127, event.data[1]));
        }
      }
    }
  }

  return kit;
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
  const meterMap = buildMeterMap(midi, ppq);
  const beatsPerBar =
    getBarInfo(meterMap, 0)?.beatsPerBar || DEFAULT_BEATS_PER_BAR;
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

      const bar = getBarIndexAtTick(meterMap, startTick);
      const barInfo = getBarInfo(meterMap, bar);
      if (!barInfo) continue;

      const beatInBar = (startTick - barInfo.startTick) / Math.max(1, ppq);

      events.push({
        bar,
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

  const maxBar = events.reduce(
    (highest, event) => Math.max(highest, event.bar),
    0,
  );
  const barCount = Math.max(1, maxBar + 1);

  const eventsByBar = Array.from({ length: barCount }, () => []);
  for (const event of events) {
    const bar = ((event.bar % barCount) + barCount) % barCount;

    eventsByBar[bar].push({
      beatInBar: event.beatInBar,
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
    kit: readRhythmKit(midi),
    durationTicks: maxEndTick,
  };
}

/**
 * Collects the song's drum activity and estimates its rhythmic feel.
 *
 * @param {Object} midi - Parsed song MIDI.
 * @param {{segments: Array<Object>, ppq: number}} meterMap
 * @returns {{
 *   activeBars: Set<number>,
 *   snareTicks: number[],
 *   lastDrumTick: number|null,
 *   drumNoteCount: number
 * }}
 */
function analyzeSongDrums(midi, meterMap) {
  const activeBars = new Set();
  const snareTicks = [];
  let lastDrumTick = null;
  let drumNoteCount = 0;

  for (const track of midi.tracks || []) {
    for (const event of track.events || []) {
      if (
        event.statusByte < midiMessageTypes.noteOn ||
        event.statusByte > midiMessageTypes.noteOn + 15
      ) {
        continue;
      }

      const channel = event.statusByte & 0x0f;
      if (channel !== LOCAL_DRUM_CHANNEL) continue;

      const velocity = event.data?.[1] ?? 0;
      if (velocity <= 0) continue;

      const tick = event.ticks;
      activeBars.add(getBarIndexAtTick(meterMap, tick));
      drumNoteCount++;
      lastDrumTick =
        lastDrumTick === null ? tick : Math.max(lastDrumTick, tick);

      if (SNARE_NOTES.has(event.data[0])) snareTicks.push(tick);
    }
  }

  return {
    activeBars,
    snareTicks,
    lastDrumTick,
    drumNoteCount,
  };
}

/**
 * Maps distinct MIDI ports to channel offsets
 *
 * @param {Object} midi - Parsed BasicMIDI instance.
 * @returns {Map<number, number>} Port number -> channel offset.
 */
function computePortOffsets(midi) {
  const offsets = new Map();
  let nextOffset = 0;

  for (const track of midi.tracks || []) {
    if (!track.channels || track.channels.size === 0) continue;
    const port = Number.isFinite(track.port) ? track.port : 0;
    if (!offsets.has(port)) {
      offsets.set(port, nextOffset);
      nextOffset += 16;
    }
  }

  return offsets;
}

/**
 * Estimates how many rhythm bars fit into one song bar.
 *
 * - `1`  : the song reads at its notated tempo.
 * - `0.5`: half-time (trap, half-time rock); one rhythm bar spans two
 *          song bars.
 * - `2`  : double-time; two rhythm bars fit into one song bar.
 *
 * @param {number[]} snareTicks
 * @param {number} ppq
 * @param {number} tempo
 * @param {number} beatsPerBar
 * @returns {number}
 */
function detectRhythmRate(snareTicks, ppq, tempo, beatsPerBar) {
  if (!snareTicks.length || !ppq) return 1;

  const beats = [];
  for (const tick of snareTicks) {
    const beat = tick / ppq;
    const previous = beats[beats.length - 1];
    if (previous === undefined || beat - previous > 0.05) beats.push(beat);
  }

  if (beats.length < 6) return 1;

  const intervals = [];
  for (let i = 1; i < beats.length; i++) {
    const interval = beats[i] - beats[i - 1];
    if (
      interval >= MIN_SNARE_INTERVAL_BEATS &&
      interval <= MAX_SNARE_INTERVAL_BEATS
    ) {
      intervals.push(interval);
    }
  }

  if (intervals.length < 4) return 1;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];

  const halfTimeThreshold =
    beatsPerBar <= 3 ? beatsPerBar * 1.5 : Math.max(2.5, beatsPerBar * 0.75);

  if (tempo >= 100 && median >= halfTimeThreshold) return 0.5;
  if (tempo <= 95 && median <= 1.25) return 2;

  return 1;
}

/**
 * Copies a MIDI
 *
 * @param {Object} midi
 * @returns {Object}
 */
function cloneMidiForPlayback(midi) {
  const embedded = midi.embeddedSoundBank;
  if (embedded) midi.embeddedSoundBank = undefined;

  let copy;
  try {
    copy = BasicMIDI.copyFrom(midi);
  } finally {
    if (embedded) midi.embeddedSoundBank = embedded;
  }

  if (embedded) copy.embeddedSoundBank = embedded;
  return copy;
}

/**
 * Creates a MIDI note/control message.
 *
 * @param {number} ticks
 * @param {number} statusByte
 * @param {number[]} data
 * @returns {Object}
 */
function midiMessage(ticks, statusByte, data) {
  return new MIDIMessage(ticks, statusByte, new Uint8Array(data));
}

/**
 * Writes one bar's worth of rhythm events into absolute song ticks.
 *
 * @param {Object[]} target
 * @param {Object} rhythm
 * @param {number} rhythmBar
 * @param {number} slotStartTick
 * @param {number} slotBeats
 * @param {number} ppq
 * @param {Set<number>} activeBars
 * @param {{segments: Array<Object>, ppq: number}} meterMap
 * @param {number} songEndTick
 */
function appendBarEvents(
  target,
  rhythm,
  rhythmBar,
  slotStartTick,
  slotBeats,
  ppq,
  activeBars,
  meterMap,
  songEndTick,
) {
  const events = rhythm.eventsByBar[rhythmBar] || [];

  for (const event of events) {
    const offsetBeats = (event.beatInBar / rhythm.beatsPerBar) * slotBeats;
    const targetTick = Math.round(slotStartTick + offsetBeats * ppq);

    if (targetTick > songEndTick) continue;

    const bar = getBarIndexAtTick(meterMap, targetTick);
    if (!activeBars.has(bar)) continue;

    const endBeats =
      ((event.beatInBar + event.lengthBeats) / rhythm.beatsPerBar) * slotBeats;
    const endTick = Math.max(
      targetTick + 1,
      Math.min(songEndTick + 1, Math.round(slotStartTick + endBeats * ppq)),
    );

    target.push({
      tick: targetTick,
      endTick,
      note: event.note,
      velocity: event.velocity,
    });
  }
}

/**
 * Converts a rhythm definition into absolute song-tick events.
 *
 * @param {Object} rhythm
 * @param {{segments: Array<Object>, ppq: number}} meterMap
 * @param {Set<number>} activeBars
 * @param {number} rate
 * @param {number} lastBar
 * @param {number} songEndTick
 * @param {number} ppq
 * @returns {Object[]}
 */
function buildRhythmEvents(
  rhythm,
  meterMap,
  activeBars,
  rate,
  lastBar,
  songEndTick,
  ppq,
) {
  const result = [];

  if (rate === 0.5) {
    for (let bar = 0; bar <= lastBar; bar += 2) {
      const info = getBarInfo(meterMap, bar);
      if (!info) continue;

      const next = getBarInfo(meterMap, bar + 1);
      const slotBeats = info.beatsPerBar + (next?.beatsPerBar || 0);
      const rhythmBar =
        ((Math.floor(bar / 2) % rhythm.barCount) + rhythm.barCount) %
        rhythm.barCount;

      appendBarEvents(
        result,
        rhythm,
        rhythmBar,
        info.startTick,
        slotBeats,
        ppq,
        activeBars,
        meterMap,
        songEndTick,
      );
    }

    return result;
  }

  if (rate === 2) {
    for (let bar = 0; bar <= lastBar; bar++) {
      const info = getBarInfo(meterMap, bar);
      if (!info) continue;

      const slotBeats = info.beatsPerBar / 2;

      for (let half = 0; half < 2; half++) {
        const rhythmBar =
          (((bar * 2 + half) % rhythm.barCount) + rhythm.barCount) %
          rhythm.barCount;

        appendBarEvents(
          result,
          rhythm,
          rhythmBar,
          info.startTick + half * slotBeats * ppq,
          slotBeats,
          ppq,
          activeBars,
          meterMap,
          songEndTick,
        );
      }
    }

    return result;
  }

  for (let bar = 0; bar <= lastBar; bar++) {
    const info = getBarInfo(meterMap, bar);
    if (!info) continue;

    const rhythmBar =
      ((bar % rhythm.barCount) + rhythm.barCount) % rhythm.barCount;

    appendBarEvents(
      result,
      rhythm,
      rhythmBar,
      info.startTick,
      info.beatsPerBar,
      ppq,
      activeBars,
      meterMap,
      songEndTick,
    );
  }

  return result;
}

/**
 * Builds the MIDI track that carries one rhythm pattern.
 *
 * @param {Object[]} noteEvents
 * @param {number} port
 * @returns {Object} MIDITrack
 */
function buildRhythmTrack(noteEvents, port) {
  const track = new MIDITrack();
  track.port = port;

  const events = [midiMessage(0, midiMessageTypes.midiPort, [port])];

  const sortedNotes = [...noteEvents].sort(
    (a, b) => a.tick - b.tick || a.note - b.note,
  );

  const lastEventByNote = new Map();
  for (const event of sortedNotes) {
    const previous = lastEventByNote.get(event.note);
    if (previous && event.tick <= previous.endTick) {
      previous.endTick = Math.max(previous.tick + 1, event.tick);
    }
    lastEventByNote.set(event.note, event);
  }

  const noteMessages = [];
  for (const event of sortedNotes) {
    noteMessages.push({
      ticks: event.endTick,
      order: 0,
      message: midiMessage(
        event.endTick,
        midiMessageTypes.noteOff | LOCAL_DRUM_CHANNEL,
        [event.note, 0],
      ),
    });
    noteMessages.push({
      ticks: event.tick,
      order: 1,
      message: midiMessage(
        event.tick,
        midiMessageTypes.noteOn | LOCAL_DRUM_CHANNEL,
        [event.note, event.velocity],
      ),
    });
  }

  noteMessages.sort((a, b) => a.ticks - b.ticks || a.order - b.order);

  for (const item of noteMessages) events.push(item.message);

  track.events = events;
  track.channels = new Set([LOCAL_DRUM_CHANNEL]);
  return track;
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

    this.songMidi = null;
    this.meterMap = null;
    this.songPpq = 480;
    this.songEndTick = 0;
    this.rhythmRate = 1;
    this.patterns = [];
    this.kitOverrides = new Map();

    this.sequencer = null;
    this.activeChannel = null;
    this.channelsApplied = false;
    this.externalRefreshTimer = null;
    this.muteCaptured = false;
    this.previousDrumMutes = new Map();
  }

  /**
   * Loads the rhythm manifest.
   */
  async initialize() {
    await this.loadManifest();
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
   * Returns the available rhythm choices, including the original drum track.
   *
   * @returns {Array<{name: string, original: boolean}>}
   */
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
   * Returns the drum channel the kit shortcut should control.
   *
   * @returns {number}
   */
  getActiveDrumChannel() {
    return this.isActive && this.activeChannel !== null
      ? this.activeChannel
      : SONG_DRUM_CHANNEL;
  }

  /**
   * Returns the kit currently used by the audible drum channel.
   *
   * @returns {Object|null}
   */
  getActiveDrumPreset() {
    if (!this.isActive || this.currentIndex < 0) {
      return this.synthesizer.getCurrentDrumPreset(SONG_DRUM_CHANNEL);
    }

    return this.getPatternKit(this.currentIndex);
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

    if (!this.hasPatterns()) {
      return {
        success: false,
        reason: "This song has no drum track to follow.",
      };
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
      return this.buildResult(true);
    }

    if (safeIndex >= 0 && !this.hasPatterns()) {
      return {
        success: false,
        reason: "This song has no drum track to follow.",
      };
    }

    this.currentIndex = safeIndex;
    this.applyPatternState();

    if (safeIndex >= 0) {
      logVerbose(
        `Rhythm activated: ${this.rhythms[safeIndex]?.name} (${this.rhythmRate}x)`,
      );
    } else {
      logVerbose("Rhythm returned to the original drum track.");
    }

    this.dispatchUpdate();
    return this.buildResult(true);
  }

  /**
   * Builds a cycle result payload.
   *
   * @param {boolean} success
   * @param {string} [reason]
   * @returns {Object}
   */
  buildResult(success, reason) {
    if (!success) return { success: false, reason };

    return {
      success: true,
      rhythmIndex: this.currentIndex,
      rhythmName: this.getCurrentRhythmName(),
      rhythmCount: this.rhythms.length,
      isOriginal: this.currentIndex < 0,
    };
  }

  hasPatterns() {
    return this.patterns.length > 0;
  }

  /**
   * Prepares an augmented copy of the song with one rhythm track per pattern.
   *
   * @param {Object} parsedMidi
   * @returns {Object} MIDI to load into the song sequencer.
   */
  prepareSong(parsedMidi) {
    this.resetRuntime();

    if (!parsedMidi || this.rhythms.length === 0) return parsedMidi;

    const ppq =
      parsedMidi.timeDivision && parsedMidi.timeDivision > 0
        ? parsedMidi.timeDivision
        : 480;
    const meterMap = buildMeterMap(parsedMidi, ppq);
    const analysis = analyzeSongDrums(parsedMidi, meterMap);

    if (analysis.drumNoteCount === 0 || analysis.activeBars.size === 0) {
      logVerbose("Song has no drum track; rhythm patterns stay silent.");
      return parsedMidi;
    }

    const initialBar =
      getBarInfo(meterMap, Math.min(...analysis.activeBars)) || null;
    const beatsPerBar = initialBar?.beatsPerBar || DEFAULT_BEATS_PER_BAR;
    const tempo = findInitialTempo(parsedMidi);
    const rate = detectRhythmRate(analysis.snareTicks, ppq, tempo, beatsPerBar);

    const augmented = cloneMidiForPlayback(parsedMidi);

    // SpessaSynth defaults port-less tracks to the lowest port it finds. Make
    // the song's own port explicit so adding rhythm ports cannot pull those
    // tracks onto a rhythm port.
    for (const track of augmented.tracks) {
      if (!track.channels || track.channels.size === 0) continue;
      const hasPort = track.events.some(
        (event) => event.statusByte === midiMessageTypes.midiPort,
      );
      if (hasPort) continue;

      const port =
        Number.isFinite(track.port) && track.port >= 0 ? track.port : 0;
      track.events.push(midiMessage(0, midiMessageTypes.midiPort, [port]));
    }

    const solution = computePortOffsets(parsedMidi);
    let nextPort = 0;
    for (const port of solution.keys()) nextPort = Math.max(nextPort, port + 1);

    const lastBar = Math.max(...analysis.activeBars);
    const songEndTick = Math.max(
      parsedMidi.lastVoiceEventTick || 0,
      analysis.lastDrumTick || 0,
    );

    const patterns = [];

    for (let i = 0; i < this.rhythms.length; i++) {
      const rhythm = this.rhythms[i];
      const port = nextPort + i;
      const noteEvents = buildRhythmEvents(
        rhythm,
        meterMap,
        analysis.activeBars,
        rate,
        lastBar,
        songEndTick,
        ppq,
      );

      if (noteEvents.length === 0) continue;

      augmented.tracks.push(buildRhythmTrack(noteEvents, port));
      patterns.push({ rhythmIndex: i, port });
    }

    if (patterns.length === 0) return parsedMidi;

    augmented.flush(true);

    const offsets = computePortOffsets(augmented);
    for (const pattern of patterns) {
      pattern.portOffset = offsets.get(pattern.port) ?? 0;
      pattern.channel = pattern.portOffset + LOCAL_DRUM_CHANNEL;
    }

    this.songMidi = parsedMidi;
    this.meterMap = meterMap;
    this.songPpq = ppq;
    this.songEndTick = songEndTick;
    this.rhythmRate = rate;
    this.patterns = patterns;

    logVerbose("Prepared rhythm tracks", {
      rate,
      tempo,
      patterns: patterns.map((p) => ({
        name: this.rhythms[p.rhythmIndex]?.name,
        port: p.port,
        channel: p.channel,
      })),
    });

    return augmented;
  }

  /**
   * Wires the augmented tracks to the running sequencer.
   *
   * @param {Object} sequencer
   */
  attachSequencer(sequencer) {
    this.sequencer = sequencer;
    if (!sequencer) return;

    for (const pattern of this.patterns) {
      const rhythmIndex = pattern.rhythmIndex;
      this.synthesizer.registerSequencerExtraRoute(
        sequencer,
        pattern.portOffset,
        (data) => {
          if (!data || data.length === 0) return null;

          const status = data[0] & 0xf0;
          const channel = data[0] & 0x0f;
          if (channel !== LOCAL_DRUM_CHANNEL) return data;

          if (status === 0x80) return data;
          if (status === 0x90 && (data[2] ?? 0) === 0) return data;
          if (this.currentIndex !== rhythmIndex) return null;
          if (status === 0x90) return data;

          // Kit, volume and bank are managed by the rhythm engine.
          return null;
        },
      );
    }

    this.bindSynthEvents();
    this.channelsApplied = false;
    this.refreshPatternState();
  }

  bindSynthEvents() {
    const synth = this.state.playback.synthesizer;
    if (!synth?.eventHandler) return;

    bindSpessaEvent(
      synth.eventHandler,
      "channelAdded",
      "forte-rhythm-channel-added",
      () => this.handleChannelAdded(),
    );
  }

  /**
   * Applies the current state once every pattern channel exists.
   */
  handleChannelAdded() {
    if (this.channelsApplied || this.patterns.length === 0) return;

    const synth = this.state.playback.synthesizer;
    const channels = synth?.midiChannels;
    if (!channels) return;

    const ready = this.patterns.every(
      (pattern) => channels[pattern.channel] !== undefined,
    );
    if (!ready) return;

    this.channelsApplied = true;
    this.refreshPatternState();
    if (this.isActive) this.scheduleExternalRefresh();
  }

  /**
   * Re-applies pattern state when the main external output changes.
   */
  handleMidiOutputChanged() {
    if (!this.isActive) return;
    this.scheduleExternalRefresh();
  }

  /**
   * Mirrors the synthesizer's drum kit notifications onto the active rhythm.
   *
   * @param {number} channelNumber
   * @param {Object} preset
   */
  handleKitChange(channelNumber, preset) {
    if (!this.isActive || this.currentIndex < 0) return;
    if (channelNumber !== this.activeChannel) return;

    this.kitOverrides.set(this.currentIndex, preset);
  }

  /**
   * Re-reads the runtime state without touching the selected pattern.
   */
  refreshPatternState() {
    if (!this.patterns.length) return;

    if (this.isActive) {
      this.applyPatternState();
      return;
    }

    this.applyInitialPatternSilence();
  }

  applyInitialPatternSilence() {
    for (const pattern of this.patterns) {
      this.sendChannelVolume(pattern.channel, 0);
      this.setChannelMuted(pattern.channel, true);
    }
  }

  scheduleExternalRefresh() {
    if (!this.isActive) return;
    if (this.externalRefreshTimer) {
      clearTimeout(this.externalRefreshTimer);
    }

    this.externalRefreshTimer = setTimeout(() => {
      this.externalRefreshTimer = null;
      if (!this.isActive || this.currentIndex < 0) return;

      this.sendExternalKit(this.getPatternKit(this.currentIndex));
      this.sendExternalRhythmVolume();
    }, 60);
  }

  /**
   * Applies the current selection to the internal synth and external output.
   */
  applyPatternState() {
    const active = this.currentIndex >= 0 && this.hasPatterns();

    this.stopRingOut();

    if (active) {
      this.isActive = true;
      this.activeChannel =
        this.patterns.find((p) => p.rhythmIndex === this.currentIndex)
          ?.channel ?? null;

      for (const pattern of this.patterns) {
        const isCurrent = pattern.rhythmIndex === this.currentIndex;
        this.sendChannelVolume(
          pattern.channel,
          isCurrent ? RHYTHM_CHANNEL_VOLUME : 0,
        );
        this.setChannelMuted(pattern.channel, !isCurrent);
      }

      this.setSongDrumsMuted(true);
      this.applyActiveKit();
      this.sendExternalRhythmVolume();
    } else {
      this.isActive = false;
      this.activeChannel = null;

      this.applyInitialPatternSilence();

      this.setSongDrumsMuted(false);
      this.synthesizer.setExternalDrumReplacement(false, EXTERNAL_DRUM_CHANNEL);
      this.restoreExternalSongDrums();
    }
  }

  /**
   * Stops any ringing rhythm notes before changing pattern.
   */
  stopRingOut() {
    const synth = this.state.playback.synthesizer;

    for (const pattern of this.patterns) {
      if (synth?.midiChannels?.[pattern.channel]) {
        try {
          synth.controllerChange(
            pattern.channel,
            midiControllers.allNotesOff,
            0,
          );
        } catch (e) {}
      }
    }

    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.allNotesOff, 0],
      0,
    );
  }

  /**
   * Sends a channel volume CC to the internal synth.
   *
   * @param {number} channel
   * @param {number} volume
   */
  sendChannelVolume(channel, volume) {
    const synth = this.state.playback.synthesizer;
    if (!synth?.midiChannels?.[channel]) return;

    try {
      synth.controllerChange(channel, midiControllers.mainVolume, volume);
    } catch (e) {
      logVerboseWarn("Could not set rhythm channel volume:", e);
    }
  }

  /**
   * Mutes or unmutes an internal MIDI channel.
   *
   * @param {number} channel
   * @param {boolean} muted
   */
  setChannelMuted(channel, muted) {
    const synth = this.state.playback.synthesizer;
    const midiChannel = synth?.midiChannels?.[channel];
    if (!midiChannel) return;

    try {
      midiChannel.setSystemParameter("isMuted", muted);
    } catch (e) {
      logVerboseWarn("Could not mute rhythm channel:", e);
    }
  }

  /**
   * Mutes the song's own drum channel(s) while a rhythm is playing.
   *
   * @param {boolean} muted
   */
  setSongDrumsMuted(muted) {
    const synth = this.state.playback.synthesizer;
    if (!synth) return;

    if (muted && !this.muteCaptured) {
      this.previousDrumMutes.clear();
      for (const channel of this.getSongDrumChannels()) {
        const midiChannel = synth.midiChannels?.[channel];
        this.previousDrumMutes.set(
          channel,
          midiChannel?.systemParameters?.isMuted ?? false,
        );
      }
      this.muteCaptured = true;
    }

    for (const channel of this.getSongDrumChannels()) {
      if (synth.midiChannels?.[channel]) {
        try {
          synth.controllerChange(channel, midiControllers.allSoundOff, 0);
        } catch (e) {}
      }

      const midiChannel = synth.midiChannels?.[channel];
      if (!midiChannel) continue;

      const target = muted
        ? true
        : (this.previousDrumMutes.get(channel) ?? false);

      try {
        midiChannel.setSystemParameter("isMuted", target);
      } catch (e) {
        logVerboseWarn("Could not mute the song drum channel:", e);
      }
    }

    if (!muted) {
      this.muteCaptured = false;
      this.previousDrumMutes.clear();
    }
  }

  /**
   * Returns the absolute drum channels used by the current song.
   *
   * @returns {number[]}
   */
  getSongDrumChannels() {
    if (!this.songMidi) return [SONG_DRUM_CHANNEL];

    const offsets = computePortOffsets(this.songMidi);
    const channels = new Set();

    for (const track of this.songMidi.tracks || []) {
      for (const event of track.events || []) {
        if (
          event.statusByte < midiMessageTypes.noteOn ||
          event.statusByte > midiMessageTypes.noteOn + 15
        ) {
          continue;
        }
        if ((event.statusByte & 0x0f) !== LOCAL_DRUM_CHANNEL) continue;

        const port = Number.isFinite(track.port) ? track.port : 0;
        channels.add((offsets.get(port) ?? 0) + LOCAL_DRUM_CHANNEL);
      }
    }

    if (channels.size === 0) channels.add(SONG_DRUM_CHANNEL);
    return [...channels];
  }

  /**
   * Applies the selected rhythm's kit to its internal channel and external
   * drum channel.
   */
  applyActiveKit() {
    const pattern = this.patterns.find(
      (p) => p.rhythmIndex === this.currentIndex,
    );
    if (!pattern) return;

    const preset = this.getPatternKit(this.currentIndex);
    const synth = this.state.playback.synthesizer;
    const midiChannel = synth?.midiChannels?.[pattern.channel];

    if (synth && midiChannel) {
      const program = Math.max(
        0,
        Math.min(127, Math.floor(preset?.program ?? 0)),
      );
      const bankMSB = Math.max(
        0,
        Math.min(127, Math.floor(preset?.bankMSB ?? 0)),
      );
      const bankLSB = Math.max(
        0,
        Math.min(127, Math.floor(preset?.bankLSB ?? 0)),
      );

      try {
        midiChannel.setSystemParameter("presetLock", false);
        midiChannel.setDrums(true);
        synth.controllerChange(
          pattern.channel,
          midiControllers.bankSelect,
          bankMSB,
        );
        synth.controllerChange(
          pattern.channel,
          midiControllers.bankSelectLSB,
          bankLSB,
        );
        synth.programChange(pattern.channel, program);
        midiChannel.setSystemParameter("presetLock", true);
      } catch (e) {
        logVerboseWarn("Could not apply the rhythm kit:", e);
      }
    }

    this.sendExternalKit(preset);
  }

  /**
   * Sends a kit selection to the external drum channel.
   *
   * @param {Object|null} preset
   */
  sendExternalKit(preset) {
    const program = Math.max(
      0,
      Math.min(127, Math.floor(preset?.program ?? 0)),
    );
    const bankMSB = Math.max(
      0,
      Math.min(127, Math.floor(preset?.bankMSB ?? 0)),
    );
    const bankLSB = Math.max(
      0,
      Math.min(127, Math.floor(preset?.bankLSB ?? 0)),
    );

    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.bankSelect, bankMSB],
      0,
    );
    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.bankSelectLSB, bankLSB],
      0,
    );
    this.synthesizer.sendExternalMidiMessage(
      [0xc0 | EXTERNAL_DRUM_CHANNEL, program],
      0,
    );
  }

  /**
   * Restores the physical drum channel volume for the active rhythm.
   */
  sendExternalRhythmVolume() {
    this.synthesizer.setExternalDrumReplacement(true, EXTERNAL_DRUM_CHANNEL);
    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.expression, 127],
      0,
    );
    this.synthesizer.sendExternalMidiMessage(
      [
        0xb0 | EXTERNAL_DRUM_CHANNEL,
        midiControllers.mainVolume,
        RHYTHM_CHANNEL_VOLUME,
      ],
      0,
    );
  }

  /**
   * Restores the song's own kit and volume on the external drum channel.
   */
  restoreExternalSongDrums() {
    const state = this.synthesizer.getSongDrumState();

    if (!state) {
      this.synthesizer.sendExternalMidiMessage(
        [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.mainVolume, 100],
        0,
      );
      return;
    }

    this.sendExternalKit(state);
    this.synthesizer.sendExternalMidiMessage(
      [0xb0 | EXTERNAL_DRUM_CHANNEL, midiControllers.mainVolume, state.volume],
      0,
    );
    this.synthesizer.sendExternalMidiMessage(
      [
        0xb0 | EXTERNAL_DRUM_CHANNEL,
        midiControllers.expression,
        state.expression,
      ],
      0,
    );
  }

  /**
   * Returns the kit for a rhythm index, including user overrides.
   *
   * @param {number} rhythmIndex
   * @returns {Object|null}
   */
  getPatternKit(rhythmIndex) {
    if (this.kitOverrides.has(rhythmIndex)) {
      return this.kitOverrides.get(rhythmIndex);
    }

    return this.rhythms[rhythmIndex]?.kit || null;
  }

  /**
   * Overrides the kit used by the active rhythm.
   *
   * @param {Object} preset
   * @returns {boolean}
   */
  setActiveDrumPreset(preset) {
    if (!this.isActive || this.currentIndex < 0) return false;

    this.kitOverrides.set(this.currentIndex, preset);
    this.applyActiveKit();
    return true;
  }

  /**
   * Re-applies runtime state.
   */
  beforePlay() {
    if (!this.patterns.length) return;

    if (this.isActive) {
      this.applyPatternState();
      this.scheduleExternalRefresh();
    } else {
      this.applyInitialPatternSilence();
    }
  }

  /**
   * Re-applies runtime state after a resume or a sequencer reset.
   */
  resume() {
    this.beforePlay();
  }

  pause() {
    // Sequencing happens on the audio thread; nothing to unwind here.
  }

  /**
   * Stops rhythm playback and restores the original drum track.
   */
  stop() {
    const hadSelection = this.currentIndex !== -1;

    if (this.isActive || hadSelection || this.muteCaptured) {
      this.currentIndex = -1;
      this.applyPatternState();
    }

    this.currentIndex = -1;
    this.isActive = false;
    this.activeChannel = null;
    this.kitOverrides.clear();
    this.muteCaptured = false;
    this.previousDrumMutes.clear();

    if (this.externalRefreshTimer) {
      clearTimeout(this.externalRefreshTimer);
      this.externalRefreshTimer = null;
    }

    if (hadSelection) this.dispatchUpdate();
  }

  resetRuntime() {
    this.songMidi = null;
    this.meterMap = null;
    this.songPpq = 480;
    this.songEndTick = 0;
    this.rhythmRate = 1;
    this.patterns = [];
    this.kitOverrides.clear();
    this.sequencer = null;
    this.activeChannel = null;
    this.channelsApplied = false;
    this.muteCaptured = false;
    this.previousDrumMutes.clear();

    if (this.externalRefreshTimer) {
      clearTimeout(this.externalRefreshTimer);
      this.externalRefreshTimer = null;
    }
  }

  cleanup() {
    this.stop();
    this.rhythms = [];
  }
}
