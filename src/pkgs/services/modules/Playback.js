import { PitchDetector } from "pitchy";
import {
  BasicMIDI,
  MIDIControllers as midiControllers,
  MIDIMessageTypes as midiMessageTypes,
} from "spessasynth_core";
import { Sequencer } from "spessasynth_lib";
import { logVerbose } from "../core/State.js";
import { bindSpessaEvent } from "./Synthesizer.js";

const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIN_VOCAL_HZ = 75;
const MAX_VOCAL_HZ = 1200;

const MAJOR_PROFILE = [
  0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008,
  0.081,
];
const MINOR_PROFILE = [
  0.222, 0.009, 0.099, 0.141, 0.015, 0.092, 0.019, 0.198, 0.052, 0.038, 0.05,
  0.065,
];

const MAJOR_ROOT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
const MINOR_ROOT_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "Bb",
  "B",
];

const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_STEPS = [0, 2, 3, 5, 7, 8, 10, 11];

/**
 * Pre-computes normalized correlation vectors for all 24 keys (12 major, 12 minor).
 * Evaluated once at module load to guarantee zero runtime allocation and maximum throughput.
 */
const KEY_CANDIDATES = (() => {
  const candidates = [];

  const precompute = (baseProfile, rootNames, scale, steps) => {
    const mean = baseProfile.reduce((acc, v) => acc + v, 0) / 12;
    const variance = baseProfile.reduce(
      (acc, v) => acc + Math.pow(v - mean, 2),
      0,
    );
    const stdDev = Math.sqrt(variance);

    for (let root = 0; root < 12; root++) {
      const normalizedWeights = new Float64Array(12);
      for (let i = 0; i < 12; i++) {
        const profileIndex = (i - root + 12) % 12;
        normalizedWeights[i] = (baseProfile[profileIndex] - mean) / stdDev;
      }

      const rootName = rootNames[root];
      const keyName = `${rootName} ${scale === "major" ? "Major" : "Minor"}`;
      const allowedPitchClasses = steps
        .map((s) => (root + s) % 12)
        .sort((a, b) => a - b);

      candidates.push({
        root: rootName,
        scale,
        pitchClass: root,
        key: keyName,
        shortKey: scale === "major" ? rootName : `${rootName}m`,
        weights: normalizedWeights,
        allowedPitchClasses,
      });
    }
  };

  precompute(MAJOR_PROFILE, MAJOR_ROOT_NAMES, "major", MAJOR_SCALE_STEPS);
  precompute(MINOR_PROFILE, MINOR_ROOT_NAMES, "minor", MINOR_SCALE_STEPS);

  return candidates;
})();

/**
 * Calculates Pearson correlation coefficient between a normalized chroma vector and candidate weights.
 */
function correlateChroma(normChroma, candidateWeights) {
  let r = 0;
  for (let i = 0; i < 12; i++) {
    r += normChroma[i] * candidateWeights[i];
  }
  return r;
}

/**
 * Detects the musical key of a parsed MIDI file using duration-weighted chroma
 * distribution and Albrecht-Shanahan correlation analysis.
 *
 * @param {Object} parsedMidi - BasicMIDI parsed instance.
 * @param {Array<Array<Object>>} channels - Array of note arrays per channel.
 * @returns {Object|null} Detected key details.
 */
function detectMidiKey(parsedMidi, channels) {
  if (!channels || !Array.isArray(channels)) return null;

  let maxTime = 0;
  let totalNotes = 0;

  for (let i = 0; i < 16; i++) {
    if (i === 9) continue; // Skip drum channel
    const notes = channels[i];
    if (!notes || notes.length === 0) continue;

    for (let n = 0; n < notes.length; n++) {
      const end = notes[n].start + notes[n].length;
      if (end > maxTime) maxTime = end;
      totalNotes++;
    }
  }

  if (totalNotes < 8 || maxTime <= 0) return null;

  const initialCutoff = maxTime > 40 ? maxTime * 0.6 : maxTime;

  const chromaFull = new Float64Array(12);
  const chromaInitial = new Float64Array(12);

  for (let i = 0; i < 16; i++) {
    if (i === 9) continue;
    const notes = channels[i];
    if (!notes || notes.length === 0) continue;

    for (let n = 0; n < notes.length; n++) {
      const note = notes[n];
      const pitch = note.midiNote;
      if (pitch < 12 || pitch > 127) continue;

      const pitchClass = pitch % 12;
      const duration = Math.max(0.05, Math.min(note.length || 0.1, 8.0));

      // Bass notes (< C3 / MIDI 48) strongly reinforce the fundamental chord roots
      const weight = pitch < 48 ? duration * 1.3 : duration;

      chromaFull[pitchClass] += weight;
      if (note.start <= initialCutoff) {
        chromaInitial[pitchClass] += weight;
      }
    }
  }

  const findBestCandidate = (chroma) => {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += chroma[i];
    if (sum === 0) return null;

    const mean = sum / 12;
    let variance = 0;
    for (let i = 0; i < 12; i++) {
      variance += Math.pow(chroma[i] - mean, 2);
    }
    if (variance === 0) return null;

    const stdDev = Math.sqrt(variance);
    const normChroma = new Float64Array(12);
    for (let i = 0; i < 12; i++) {
      normChroma[i] = (chroma[i] - mean) / stdDev;
    }

    let bestCandidate = null;
    let highestR = -Infinity;

    for (let i = 0; i < KEY_CANDIDATES.length; i++) {
      const cand = KEY_CANDIDATES[i];
      const r = correlateChroma(normChroma, cand.weights);
      if (r > highestR) {
        highestR = r;
        bestCandidate = cand;
      }
    }

    return bestCandidate ? { ...bestCandidate, correlation: highestR } : null;
  };

  const keyInitial = findBestCandidate(chromaInitial);
  const keyFull = findBestCandidate(chromaFull);

  // If the initial section has strong confidence (>= 0.5), use it to preserve original key
  // against late-song modulations common in videoke tracks.
  if (keyInitial && keyInitial.correlation >= 0.5) {
    return keyInitial;
  }

  return keyFull || keyInitial;
}

/**
 * Attempts to detect the correct text encoding for MIDI lyrics data to prevent mojibake.
 *
 * @param {Uint8Array} uint8Array - The raw byte data of the lyrics.
 * @returns {string} The identified encoding standard.
 */
function detectEncoding(uint8Array) {
  const encodings = [
    "utf-8",
    "shift-jis",
    "euc-kr",
    "windows-1250",
    "windows-1252",
    "utf-16le",
  ];
  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(uint8Array);
      if (text.includes("\uFFFD")) continue;
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || [])
        .length;
      if (text.length > 0 && controlChars / text.length > 0.05) continue;
      return encoding;
    } catch (e) {
      continue;
    }
  }
  return "utf-8";
}

/**
 * Detects structural delimiter artifacts
 * that appear consistently across syllables or lines.
 *
 * @param {Array<Object>} rawEvents - Array of MIDI lyric events.
 * @param {TextDecoder} decoder - Active text decoder.
 * @returns {Array<string>} Array of single-character artifact strings to strip.
 */
function detectPervasiveArtifacts(rawEvents, decoder) {
  const SAFE_CHAR_REGEX = /[\p{L}\p{N}\s.,!?'"’‘“”():;\[\]{}\/\-—–~#@]/u;

  const eventCounts = new Map();
  const lineCounts = new Map();
  let validEventCount = 0;
  let lineCount = 0;

  const currentLineChars = new Set();

  for (const msg of rawEvents) {
    if (!msg.data || msg.data.byteLength === 0) continue;
    const str = decoder.decode(msg.data);
    if (!str || str.trim().length === 0) continue;

    validEventCount++;
    const charsInEvent = new Set();

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];

      if (ch === "/" || ch === "\\" || ch === "\n" || ch === "\r") {
        lineCount++;
        for (const c of currentLineChars) {
          lineCounts.set(c, (lineCounts.get(c) || 0) + 1);
        }
        currentLineChars.clear();
        continue;
      }

      if (SAFE_CHAR_REGEX.test(ch)) continue;

      charsInEvent.add(ch);
      currentLineChars.add(ch);
    }

    for (const ch of charsInEvent) {
      eventCounts.set(ch, (eventCounts.get(ch) || 0) + 1);
    }
  }

  if (currentLineChars.size > 0) {
    lineCount++;
    for (const c of currentLineChars) {
      lineCounts.set(c, (lineCounts.get(c) || 0) + 1);
    }
  }

  const detected = [];
  for (const [ch, count] of eventCounts.entries()) {
    const eventRatio = validEventCount > 0 ? count / validEventCount : 0;
    const lineRatio = lineCount > 0 ? (lineCounts.get(ch) || 0) / lineCount : 0;

    if ((eventRatio >= 0.2 || lineRatio >= 0.4) && count >= 4) {
      detected.push(ch);
    }
  }

  return detected;
}

export class FortePlayback {
  /**
   * Initializes the Playback Controller.
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   * @param {Object} synthesizer - Reference to the ForteSynthesizer instance.
   * @param {Object} scoring - Reference to the ForteScoring instance.
   * @param {Object} pianoRoll - Reference to the FortePianoRoll instance.
   * @param {Function} dispatchUpdate - Callback to notify UI of state changes.
   */
  constructor(
    state,
    audioCore,
    synthesizer,
    scoring,
    pianoRoll,
    dispatchUpdate,
  ) {
    this.state = state;
    this.audioCore = audioCore;
    this.synthesizer = synthesizer;
    this.scoring = scoring;
    this.pianoRoll = pianoRoll;
    this.dispatchUpdate = dispatchUpdate;

    this.sourceNode = null;
    this.audioElement = null;
    this.animationFrameId = null;
    this.lastScoreTime = 0;
    this.guideVolumeSwitchTimeout = null;

    this.timingLoop = this.timingLoop.bind(this);
  }

  async setupMidiData(parsedMidi, lowerUrl, isCompanion = false) {
    if (!parsedMidi.isKaraokeFile) {
      const isKarExtension = lowerUrl.endsWith(".kar");
      const hasKaraokeHeaders = parsedMidi.tracks.some((track) =>
        track.events.some((e) => {
          if (
            (e.statusByte === midiMessageTypes.text ||
              e.statusByte === midiMessageTypes.lyric) &&
            e.data &&
            e.data.length > 0
          ) {
            if (String.fromCharCode(e.data[0]) === "@") {
              const header = new TextDecoder("ascii")
                .decode(e.data.slice(0, 6))
                .toUpperCase();
              return (
                header.startsWith("@KMIDI") ||
                header.startsWith("@T") ||
                header.startsWith("@A") ||
                header.startsWith("@K") ||
                header.startsWith("@V") ||
                header.startsWith("@L") ||
                header.startsWith("@W")
              );
            }
          }
          return false;
        }),
      );

      if (isKarExtension || hasKaraokeHeaders) {
        parsedMidi.isKaraokeFile = true;
      }
    }

    let primaryLyricTrackEvents = [];
    let highestLyricScore = 0;
    let bestTrackHasExplicitLyrics = false;

    parsedMidi.tracks.forEach((midiTrack) => {
      let trackLyricScore = 0;
      const explicitLyricEvents = [];
      const textEvents = [];

      midiTrack.events.forEach((e) => {
        if (e.statusByte === midiMessageTypes.lyric) {
          explicitLyricEvents.push(e);
        } else if (e.statusByte === midiMessageTypes.text) {
          textEvents.push(e);
        }
      });

      const hasExplicitLyrics = explicitLyricEvents.length > 0;
      const candidateEvents = hasExplicitLyrics
        ? explicitLyricEvents
        : textEvents;

      candidateEvents.forEach((e) => {
        if (!e.data || e.data.length === 0) return;
        const firstChar = String.fromCharCode(e.data[0]);
        if (firstChar !== "@" && firstChar !== "#") trackLyricScore++;
      });

      const isValidLyricTrack =
        hasExplicitLyrics || parsedMidi.isKaraokeFile || trackLyricScore >= 5;

      if (isValidLyricTrack && trackLyricScore > highestLyricScore) {
        highestLyricScore = trackLyricScore;
        primaryLyricTrackEvents = candidateEvents;
        bestTrackHasExplicitLyrics = hasExplicitLyrics;
      }
    });

    if (highestLyricScore > 0 && !bestTrackHasExplicitLyrics) {
      parsedMidi.isKaraokeFile = true;
    }

    this.state.playback.sequencer = new Sequencer(
      this.state.playback.synthesizer,
    );
    this.state.playback.sequencer.loop = false;

    if (!isCompanion) {
      this.synthesizer.connectSequencerToMidiOutput(
        this.state.playback.sequencer,
      );
    }

    bindSpessaEvent(
      this.state.playback.sequencer.eventHandler,
      "songEnded",
      "forte-song-end",
      () => {
        if (!isCompanion && this.state.playback.status !== "stopped") {
          this.stopTrack();
        }
      },
    );

    bindSpessaEvent(
      this.state.playback.synthesizer.eventHandler,
      "noteOn",
      "forte-note-on",
      (e) => {
        const isDrum = this.state.playback.synthesizer.midiChannels
          ? (this.state.playback.synthesizer.midiChannels[e.channel]?.preset
              ?.isGMGSDrum ??
            this.state.playback.synthesizer.midiChannels[e.channel]?.isDrum ??
            e.channel === 9)
          : e.channel === 9;

        if (!isDrum) {
          if (e.velocity > 0)
            this.state.scoring.activeMidiNotes.add(e.midiNote);
          else this.state.scoring.activeMidiNotes.delete(e.midiNote);
        }
      },
    );

    bindSpessaEvent(
      this.state.playback.synthesizer.eventHandler,
      "noteOff",
      "forte-note-off",
      (e) => {
        const isDrum = this.state.playback.synthesizer.midiChannels
          ? (this.state.playback.synthesizer.midiChannels[e.channel]?.preset
              ?.isGMGSDrum ??
            this.state.playback.synthesizer.midiChannels[e.channel]?.isDrum ??
            e.channel === 9)
          : e.channel === 9;

        if (!isDrum) this.state.scoring.activeMidiNotes.delete(e.midiNote);
      },
    );

    this.state.playback.sequencer.loadNewSongList([parsedMidi]);

    let rawTrackEvents =
      highestLyricScore > 0 ? primaryLyricTrackEvents : parsedMidi.lyrics || [];
    rawTrackEvents.sort((a, b) => a.ticks - b.ticks);

    const totalLength = rawTrackEvents.reduce(
      (acc, val) => acc + (val.data ? val.data.byteLength : 0),
      0,
    );
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const msg of rawTrackEvents) {
      if (msg.data) {
        combinedBuffer.set(msg.data, offset);
        offset += msg.data.byteLength;
      }
    }

    this.state.playback.lyricsEncoding =
      totalLength > 0 ? detectEncoding(combinedBuffer) : "utf-8";
    const decoder = new TextDecoder(this.state.playback.lyricsEncoding);
    const detectedArtifacts = detectPervasiveArtifacts(rawTrackEvents, decoder);

    let artifactRegex = null;
    if (detectedArtifacts.length > 0) {
      const escaped = detectedArtifacts
        .map((c) => c.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
        .join("");
      artifactRegex = new RegExp(`[${escaped}]`, "g");
    }
    this.state.playback.artifactRegex = artifactRegex;

    const rawLyrics = [];
    this.state.playback.decodedLyrics = [];

    rawTrackEvents.forEach((message) => {
      if (!message.data) return;
      if (
        (bestTrackHasExplicitLyrics || !parsedMidi.isKaraokeFile) &&
        message.statusByte === midiMessageTypes.text
      ) {
        return;
      }

      let text = decoder.decode(message.data);
      if (artifactRegex) text = text.replace(artifactRegex, "");

      const clean = text.replace(/[\r\n\/\\]/g, "");
      const trimmed = clean.trim();

      if (message.ticks < 480 && trimmed.length > 45) {
        const firstChar = trimmed.charAt(0);
        if (
          firstChar !== "{" &&
          firstChar !== "[" &&
          firstChar !== "<" &&
          firstChar !== "@"
        )
          return;
      }

      let isLyric = false;
      if (trimmed === "#" || clean.startsWith("@m") || clean.startsWith("@w")) {
        isLyric = true;
      } else if (!clean.startsWith("@") && !clean.startsWith("#")) {
        isLyric = true;
      }

      if (isLyric) {
        rawLyrics.push(message);
        this.state.playback.decodedLyrics.push(text.replace(/[\/\\]/g, "\n"));
      }
    });

    let noteChannels = null;
    try {
      if (typeof parsedMidi.getNoteTimes === "function") {
        noteChannels = parsedMidi.getNoteTimes();
      }
    } catch (e) {
      logVerboseWarn("Failed to extract note times from MIDI:", e);
    }

    const detectedKey = detectMidiKey(parsedMidi, noteChannels);

    this.state.playback.midiInfo = {
      ticks: rawLyrics.map((msg) => msg.ticks).filter((t) => t !== undefined),
      timeDivision: parsedMidi.timeDivision || 480,
      tempoChanges: parsedMidi.tempoChanges || [],
      initialBpm:
        parsedMidi.tempoChanges && parsedMidi.tempoChanges.length > 0
          ? Math.round(parsedMidi.tempoChanges[0].tempo || 120)
          : 120,
      keyRange: parsedMidi.keyRange || { min: 0, max: 127 },
      key: detectedKey ? detectedKey.key : null,
      scale: detectedKey ? detectedKey.scale : null,
      root: detectedKey ? detectedKey.root : null,
      pitchClass: detectedKey ? detectedKey.pitchClass : null,
    };

    if (rawLyrics.length > 0) {
      const lyricTimes = rawLyrics
        .filter((l) => l.ticks !== undefined)
        .map((l) => parsedMidi.midiTicksToSeconds(l.ticks));

      if (lyricTimes.length > 5 && noteChannels) {
        const channels = noteChannels;
        let validChannels = [];

        let manualChannel = "auto";
        try {
          if (window.config && typeof window.config.getItem === "function") {
            const val = await window.config.getItem("audioConfig.guideChannel");
            if (val !== undefined && val !== null) manualChannel = val;
          }
        } catch (e) {}

        let isDuet = false;
        let embeddedVocalChannel = null;

        if (parsedMidi && parsedMidi.tracks) {
          for (const track of parsedMidi.tracks) {
            for (const e of track.events) {
              if (
                e.statusByte === midiMessageTypes.text ||
                e.statusByte === midiMessageTypes.lyric
              ) {
                if (e.data && e.data.length > 0) {
                  const text = new TextDecoder("utf-8")
                    .decode(e.data)
                    .replace(/[\0\r\n\/\\]/g, "")
                    .trim();

                  if (text === "@IENCOREDUET") isDuet = true;
                  const match = text.match(/@IVOCAL-CH=(\d+)/i);
                  if (match) embeddedVocalChannel = parseInt(match[1], 10) - 1;
                }
              }
            }
          }
        }

        if (isDuet) {
          document.dispatchEvent(
            new CustomEvent("Encore.Forte.Playback.DuetDetected"),
          );
        }

        if (
          embeddedVocalChannel !== null &&
          embeddedVocalChannel >= 0 &&
          embeddedVocalChannel <= 15
        ) {
          manualChannel = embeddedVocalChannel;
        }

        if (manualChannel !== "auto") {
          const chIndex = parseInt(manualChannel, 10);
          const notes = channels[chIndex];
          if (notes && notes.length > 0) {
            validChannels.push({ index: chIndex, notes, program: 0 });
          } else {
            manualChannel = "auto";
          }
        }

        if (manualChannel === "auto") {
          if (
            this.state.playback.isPlatinum &&
            channels[0] &&
            channels[0].length > 0
          ) {
            validChannels.push({ index: 0, notes: channels[0], program: 0 });
          } else {
            const candidateChannels = [];
            const highPriorityInstruments = [
              52, 53, 54, 68, 71, 72, 73, 74, 75, 78, 79, 80, 81, 85,
            ];
            const medPriorityInstruments = [24, 25, 59, 64, 65, 66];
            const penalizedInstruments = [
              32, 33, 34, 35, 36, 37, 38, 39, 48, 49, 50, 51,
            ];

            for (let i = 0; i < 16; i++) {
              if (i === 9) continue;
              const notes = channels[i];
              if (!notes || notes.length === 0) continue;
              if (notes.length < lyricTimes.length * 0.05) continue;
              if (notes.length > lyricTimes.length * 5) continue;

              let program = 0;
              if (parsedMidi && parsedMidi.tracks) {
                for (const track of parsedMidi.tracks) {
                  const pcEvent = track.events.find(
                    (e) =>
                      (e.statusByte & 0xf0) === 0xc0 &&
                      (e.statusByte & 0x0f) === i,
                  );
                  if (pcEvent && pcEvent.data && pcEvent.data.length > 0) {
                    program = pcEvent.data[0];
                    break;
                  }
                }
              }

              let overlaps = 0;
              let pitchSum = notes[0].midiNote;
              let totalInterval = 0;
              let shortNotes = notes[0].length < 0.25 ? 1 : 0;

              for (let n = 1; n < notes.length; n++) {
                const prevNote = notes[n - 1];
                const prevNoteEnd = prevNote.start + prevNote.length;
                if (notes[n].start < prevNoteEnd - 0.05) overlaps++;
                pitchSum += notes[n].midiNote;
                totalInterval += Math.abs(
                  notes[n].midiNote - prevNote.midiNote,
                );
                if (notes[n].length < 0.25) shortNotes++;
              }

              const polyphonyRatio = overlaps / notes.length;
              if (polyphonyRatio > 0.25) continue;

              const avgInterval = totalInterval / Math.max(1, notes.length - 1);
              const shortNoteRatio = shortNotes / notes.length;

              let matches = 0;
              for (let l = 0; l < lyricTimes.length; l++) {
                const lTime = lyricTimes[l];
                const noteForLyric = notes.find(
                  (n) =>
                    Math.abs(n.start - lTime) < 0.15 ||
                    (n.start <= lTime && n.start + n.length >= lTime + 0.05),
                );
                if (noteForLyric) matches++;
              }

              const matchRatio = matches / lyricTimes.length;
              const densityRatio = notes.length / lyricTimes.length;
              const avgPitch = pitchSum / notes.length;

              let primaryScore = matchRatio * 2.0 - polyphonyRatio * 4.0;
              if (densityRatio > 1.3)
                primaryScore -= (densityRatio - 1.3) * 1.0;
              else if (densityRatio < 0.7)
                primaryScore -= (0.7 - densityRatio) * 1.0;

              let pitchPenalty = 0;
              if (avgPitch < 50) pitchPenalty = (50 - avgPitch) * 0.15;
              if (avgPitch > 85) pitchPenalty = (avgPitch - 85) * 0.15;
              primaryScore -= pitchPenalty;

              if (avgInterval > 3.5) primaryScore -= (avgInterval - 3.5) * 1.5;
              if (shortNoteRatio > 0.8)
                primaryScore -= (shortNoteRatio - 0.8) * 3.0;

              if (i === 3) primaryScore += 0.8;
              else if (i === 4) primaryScore += 0.3;

              if (highPriorityInstruments.includes(program))
                primaryScore += 1.0;
              else if (medPriorityInstruments.includes(program))
                primaryScore += 0.4;
              else if (penalizedInstruments.includes(program))
                primaryScore -= 1.5;

              candidateChannels.push({
                index: i,
                notes,
                matchRatio,
                polyphonyRatio,
                avgPitch,
                avgInterval,
                shortNoteRatio,
                program,
                primaryScore,
              });
            }

            candidateChannels.sort((a, b) => b.primaryScore - a.primaryScore);

            if (
              candidateChannels.length > 0 &&
              candidateChannels[0].matchRatio > 0.15
            ) {
              const mainChannel = candidateChannels[0];
              validChannels = [mainChannel];

              for (let i = 1; i < candidateChannels.length; i++) {
                const candidate = candidateChannels[i];
                if (Math.abs(mainChannel.avgPitch - candidate.avgPitch) > 18)
                  continue;
                if (
                  candidate.avgInterval > 4.0 ||
                  candidate.shortNoteRatio > 0.85
                )
                  continue;
                if (penalizedInstruments.includes(candidate.program)) continue;

                const minimumMatches = Math.max(
                  2,
                  Math.floor(lyricTimes.length * 0.03),
                );
                const rawMatches = Math.round(
                  candidate.matchRatio * lyricTimes.length,
                );
                if (rawMatches < minimumMatches) continue;

                let overlapCount = 0;
                for (const cNote of candidate.notes) {
                  const cEnd = cNote.start + cNote.length;
                  const overlapsMain = mainChannel.notes.some((mNote) => {
                    const mEnd = mNote.start + mNote.length;
                    return (
                      cNote.start < mEnd - 0.05 && cEnd - 0.05 > mNote.start
                    );
                  });
                  if (overlapsMain) overlapCount++;
                }

                if (overlapCount / candidate.notes.length < 0.2) {
                  validChannels.push(candidate);
                }
              }
            }
          }
        }

        if (validChannels.length > 0) {
          this.state.playback.guideChannels = validChannels;
          document.dispatchEvent(new CustomEvent("Encore.Forte.GuideFound"));

          let combinedNotes = [];
          validChannels.forEach((c) => combinedNotes.push(...c.notes));
          combinedNotes.sort((a, b) => a.start - b.start);

          const monoNotes = [];
          let minPitch = 127;
          let maxPitch = 0;

          combinedNotes.forEach((n) => {
            const duration = Math.max(n.length, 0.1);
            const existing = monoNotes.find(
              (mn) => Math.abs(mn.startTime - n.start) < 0.05,
            );

            if (existing) {
              if (n.midiNote > existing.pitch) existing.pitch = n.midiNote;
            } else {
              monoNotes.push({
                id: monoNotes.length,
                pitch: n.midiNote,
                startTime: n.start,
                duration: duration,
              });
            }

            if (n.midiNote < minPitch) minPitch = n.midiNote;
            if (n.midiNote > maxPitch) maxPitch = n.midiNote;
          });

          monoNotes.sort((a, b) => a.startTime - b.startTime);

          let shortNoteCount = 0;
          for (const note of monoNotes)
            if (note.duration <= 0.2) shortNoteCount++;

          if (monoNotes.length > 0 && shortNoteCount / monoNotes.length > 0.5) {
            for (let i = 0; i < monoNotes.length; i++) {
              const currentNote = monoNotes[i];
              const nextNote = monoNotes[i + 1];
              if (nextNote) {
                const timeToNext = nextNote.startTime - currentNote.startTime;
                if (timeToNext > 0 && timeToNext < 2.5) {
                  currentNote.duration = Math.max(
                    currentNote.duration,
                    timeToNext - 0.05,
                  );
                } else if (timeToNext >= 2.5) {
                  currentNote.duration = Math.max(currentNote.duration, 0.75);
                }
              } else {
                currentNote.duration = Math.max(currentNote.duration, 1.0);
              }
            }
          } else {
            for (let i = 0; i < monoNotes.length; i++) {
              const currentNote = monoNotes[i];
              if (currentNote.duration < 0.2) {
                const timeToNext = monoNotes[i + 1]
                  ? monoNotes[i + 1].startTime - currentNote.startTime
                  : 1.0;
                currentNote.duration = Math.max(
                  currentNote.duration,
                  Math.min(0.2, timeToNext - 0.01),
                );
              }
            }
          }

          this.state.playback.guideNotes = monoNotes;
          this.state.playback.guideRange = {
            min: Math.max(0, minPitch - 4),
            max: Math.min(127, maxPitch + 4),
          };
        }
      }
    }
  }

  /**
   * Primary synchronization loop processing active playback progression and UI updates.
   */
  timingLoop() {
    if (this.state.playback.status !== "playing") {
      this.animationFrameId = null;
      return;
    }

    const now = performance.now();
    let delta = (now - this.state.playback.lastFrameTime) / 1000;
    if (delta > 0.1) delta = 0.1;
    this.state.playback.lastFrameTime = now;

    const engineState = this.getPlaybackState();
    const engineTime = engineState.currentTime;
    const duration = engineState.duration;

    let rate = 1.0;
    if (!this.state.playback.isMidi && this.audioElement) {
      rate = this.audioElement.playbackRate;
    }

    this.state.playback.smoothedTime += delta * rate;

    const drift = engineTime - this.state.playback.smoothedTime;
    if (Math.abs(drift) > 0.5) {
      this.state.playback.smoothedTime = engineTime;
    } else {
      this.state.playback.smoothedTime += drift * 0.15;
    }

    const currentTime = Math.max(
      0,
      Math.min(this.state.playback.smoothedTime, duration),
    );

    const hasGuide =
      this.state.playback.guideNotes &&
      this.state.playback.guideNotes.length > 0;

    let isPreludeWait = false;
    if (hasGuide && this.state.playback.guideNotes[0]) {
      const firstNoteTime = this.state.playback.guideNotes[0].startTime;
      const maxLead = Math.min(firstNoteTime, 4.0);
      if (currentTime < firstNoteTime - maxLead) {
        isPreludeWait = true;
      }
    }

    const shouldShowPianoRoll =
      (hasGuide || this.state.playback.isAnalyzing) &&
      this.state.ui.displayGuideMelody &&
      !isPreludeWait;

    if (shouldShowPianoRoll !== this.state.ui.pianoRollVisible) {
      this.pianoRoll.toggleVisibility(shouldShowPianoRoll);
    }

    if (this.state.ui.pianoRollVisible) {
      this.pianoRoll.render(currentTime);
    }

    if (this.state.scoring.enabled) {
      if (now - this.lastScoreTime > 33) {
        this.scoring.updateScore(currentTime);
        document.dispatchEvent(
          new CustomEvent("Encore.Forte.Scoring.Update", {
            detail: this.scoring.getScoringState(),
          }),
        );
        this.lastScoreTime = now;
      }
    }

    document.dispatchEvent(
      new CustomEvent("Encore.Forte.Playback.TimeUpdate", {
        detail: { currentTime, duration },
      }),
    );

    if (engineTime >= duration && duration > 0) {
      this.animationFrameId = null;
      if (this.state.playback.status === "playing") {
        this.stopTrack();
      }
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.timingLoop);
  }

  /**
   * Extracts multiplex guide notes with strict time-slicing and sparse decoding
   * to guarantee zero audio/UI stuttering on low-end CPUs (like Celerons).
   *
   * @param {string} url - Track location containing the multiplexed file.
   */
  async startStreamingGuideAnalysis(url) {
    console.log(
      "[FORTE SVC] Starting zero-stutter streaming analysis for piano roll...",
    );
    this.state.playback.isAnalyzing = true;

    const bufferSize = 2048;
    const detector = PitchDetector.forFloat32Array(bufferSize);
    const minNoteDuration = 0.08;
    const stepSize = 1024;

    let noteIdCounter = this.state.playback.guideNotes.length;
    let currentNote = null;
    let lastAnalyzedTime = 0;

    let accumulateBuffer = new Uint8Array(0);
    let hasDoneInitialDecode = false;
    const INITIAL_DECODE_THRESHOLD = 500 * 1024;

    const timeSliceAnalysis = async (channelData, sampleRate, isFinal) => {
      let startSample = Math.floor(lastAnalyzedTime * sampleRate);
      let endSample = isFinal
        ? channelData.length - bufferSize
        : channelData.length - bufferSize - 4096;

      let i = startSample;
      while (i < endSample && this.state.playback.isAnalyzing) {
        const batchStartTime = performance.now();
        const foundNotes = [];

        while (i < endSample && performance.now() - batchStartTime < 5) {
          const chunk = channelData.subarray(i, i + bufferSize);
          const [pitch, clarity] = detector.findPitch(chunk, sampleRate);
          const time = i / sampleRate;

          const midiPitch = 12 * Math.log2(pitch / 440) + 69;
          const isNoteActive =
            clarity > GUIDE_CLARITY_THRESHOLD &&
            pitch >= MIN_VOCAL_HZ &&
            pitch <= MAX_VOCAL_HZ &&
            midiPitch >= 0 &&
            midiPitch < 128;

          if (isNoteActive) {
            if (!currentNote) {
              currentNote = {
                midi: midiPitch,
                startTime: time,
                pitches: [midiPitch],
              };
            } else {
              currentNote.pitches.push(midiPitch);
            }
          } else if (currentNote) {
            const duration = time - currentNote.startTime;
            if (duration > minNoteDuration) {
              let pSum = 0;
              for (let k = 0; k < currentNote.pitches.length; k++)
                pSum += currentNote.pitches[k];
              foundNotes.push({
                id: noteIdCounter++,
                pitch: pSum / currentNote.pitches.length,
                startTime: currentNote.startTime,
                duration: duration,
              });
            }
            currentNote = null;
          }
          i += stepSize;
        }

        if (foundNotes.length > 0) {
          const lastGlobalNote =
            this.state.playback.guideNotes[
              this.state.playback.guideNotes.length - 1
            ];
          const firstChunkNote = foundNotes[0];

          if (
            lastGlobalNote &&
            firstChunkNote.startTime -
              (lastGlobalNote.startTime + lastGlobalNote.duration) <
              0.05 &&
            Math.abs(firstChunkNote.pitch - lastGlobalNote.pitch) < 1.0
          ) {
            lastGlobalNote.duration =
              firstChunkNote.startTime +
              firstChunkNote.duration -
              lastGlobalNote.startTime;
            foundNotes.shift();
          }

          this.state.playback.guideNotes.push(...foundNotes);

          if (this.state.ui.pianoRollVisible) {
            this.pianoRoll.render(this.getPlaybackState().currentTime);
          }
        }

        lastAnalyzedTime = i / sampleRate;
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    try {
      const response = await fetch(url);
      if (!response.body) throw new Error("ReadableStream not supported");
      const reader = response.body.getReader();

      while (this.state.playback.isAnalyzing) {
        const { done, value } = await reader.read();

        if (value) {
          const newBuf = new Uint8Array(accumulateBuffer.length + value.length);
          newBuf.set(accumulateBuffer);
          newBuf.set(value, accumulateBuffer.length);
          accumulateBuffer = newBuf;
        }

        if (
          !hasDoneInitialDecode &&
          accumulateBuffer.length >= INITIAL_DECODE_THRESHOLD &&
          !done
        ) {
          hasDoneInitialDecode = true;
          try {
            const bufferCopy = accumulateBuffer.slice(0).buffer;
            const audioBuffer =
              await this.audioCore.context.decodeAudioData(bufferCopy);
            const channelIndex = audioBuffer.numberOfChannels > 1 ? 1 : 0;
            await timeSliceAnalysis(
              audioBuffer.getChannelData(channelIndex),
              audioBuffer.sampleRate,
              false,
            );
          } catch (e) {}
        }

        if (done) {
          try {
            const bufferCopy = accumulateBuffer.slice(0).buffer;
            const audioBuffer =
              await this.audioCore.context.decodeAudioData(bufferCopy);
            const channelIndex = audioBuffer.numberOfChannels > 1 ? 1 : 0;
            await timeSliceAnalysis(
              audioBuffer.getChannelData(channelIndex),
              audioBuffer.sampleRate,
              true,
            );

            if (currentNote) {
              const duration = lastAnalyzedTime - currentNote.startTime;
              if (duration > minNoteDuration) {
                let pSum = 0;
                for (let k = 0; k < currentNote.pitches.length; k++)
                  pSum += currentNote.pitches[k];
                this.state.playback.guideNotes.push({
                  id: noteIdCounter++,
                  pitch: pSum / currentNote.pitches.length,
                  startTime: currentNote.startTime,
                  duration: duration,
                });
                if (this.state.ui.pianoRollVisible)
                  this.pianoRoll.render(this.getPlaybackState().currentTime);
              }
            }
          } catch (e) {
            console.error("[FORTE SVC] Final decode failed:", e);
          }

          this.state.playback.isAnalyzing = false;
          logVerbose("Streaming guide analysis complete.");
          break;
        }
      }
    } catch (err) {
      console.error("[FORTE SVC] Guide fetch error:", err);
      this.state.playback.isAnalyzing = false;
    }
  }

  /**
   * Primary load sequencer formatting tracks and establishing variables specific to decoding contexts.
   *
   * @param {string} url - The targeted local media.
   * @returns {Promise<boolean>} True if all media segments parsed cleanly.
   */
  async loadTrack(url, chorusUrl = null, midiGuideUrl = null) {
    if (!this.audioCore.context) return false;
    if (this.state.playback.status !== "stopped") this.stopTrack();

    this.state.playback.hasMidiGuide = false;
    if (this.audioElement) {
      this.audioElement.pause();
      if (!this.audioElementIsExternal) {
        this.audioElement.removeAttribute("src");
        this.audioElement.load();
      }
      this.audioElement = null;
      this.audioElementIsExternal = false;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }

    if (this.chorusElement) {
      logVerbose("Chorus exists", chorusUrl);
      this.chorusElement.pause();
      this.chorusElement.removeAttribute("src");
      this.chorusElement.load();
      this.chorusElement = null;
    }
    if (this.chorusSourceNode) {
      try {
        this.chorusSourceNode.disconnect();
      } catch (e) {}
      this.chorusSourceNode = null;
    }
    this.state.playback.hasChorus = false;

    if (this.state.playback.sequencer) {
      this.synthesizer.disconnectSequencerFromMidiOutput(
        this.state.playback.sequencer,
      );
      try {
        this.state.playback.sequencer.pause();
      } catch (e) {}
      try {
        this.state.playback.sequencer.currentTime = 0;
      } catch (e) {}
      this.state.playback.sequencer = null;
    }

    this.state.playback.midiInfo = {
      ticks: [],
      timeDivision: 480,
      tempoChanges: [],
      initialBpm: 120,
      keyRange: { min: 0, max: 127 },
      key: null,
      scale: null,
      root: null,
      pitchClass: null,
    };
    this.state.playback.decodedLyrics = [];
    this.state.playback.lyricsEncoding = "utf-8";
    this.state.playback.artifactRegex = null;
    this.state.playback.transpose = 0;
    this.state.playback.isMultiplexed = false;
    this.state.playback.isPlatinum = false;
    this.state.playback.multiplexPan = -1;
    this.state.playback.guideNotes = [];
    this.state.playback.guideRange = { min: 42, max: 90 };
    this.state.playback.isAnalyzing = false;
    this.state.scoring.activeMidiNotes.clear();

    this.pianoRoll.toggleVisibility(false);

    const isMediaElement = url instanceof HTMLMediaElement;
    const urlString = isMediaElement
      ? url.currentSrc || url.src || ""
      : String(url || "");
    const lowerUrl = urlString.toLowerCase();

    const isMidi =
      !isMediaElement &&
      (lowerUrl.endsWith(".mid") ||
        lowerUrl.endsWith(".midi") ||
        lowerUrl.endsWith(".kar"));
    this.state.playback.isMidi = isMidi;

    const isPlatinum = !isMediaElement && lowerUrl.endsWith(".xtsp.mid");
    this.state.playback.isPlatinum = isPlatinum;

    if (!isMidi && lowerUrl.includes(".multiplexed.")) {
      this.state.playback.isMultiplexed = true;
    }

    logVerbose("Preparing to load track", {
      url: urlString,
      isMidi,
      isMultiplexed: this.state.playback.isMultiplexed,
      isPlatinum,
    });

    try {
      if (isMidi) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (!this.state.playback.synthesizer) {
          throw new Error("MIDI Synthesizer not ready.");
        }

        const parsedMidi = BasicMIDI.fromArrayBuffer(arrayBuffer);
        this.state.playback.currentMidi = parsedMidi;

        await this.setupMidiData(parsedMidi, lowerUrl, false);
        this.setTranspose(0);

        if (chorusUrl) {
          this.chorusElement = new Audio(chorusUrl);
          this.chorusElement.crossOrigin = "anonymous";
          this.chorusElement.preservesPitch = false;

          await new Promise((resolve) => {
            this.chorusElement.addEventListener("canplay", resolve, {
              once: true,
            });
            this.chorusElement.addEventListener("error", resolve, {
              once: true,
            });
          });

          this.chorusSourceNode =
            this.audioCore.context.createMediaElementSource(this.chorusElement);
          this.chorusSourceNode.connect(this.state.effects.chorusPitchNode);

          this.state.playback.hasChorus = true;
          this.state.playback.isChorusEnabled = true;
          this.state.playback.chorusGain.gain.value = 1;
        }

        this.state.playback.buffer = null;
      } else {
        const isMediaElement = url instanceof HTMLMediaElement;

        if (isMediaElement) {
          this.audioElement = url;
          this.audioElementIsExternal = true;
        } else {
          this.audioElement = new Audio(url);
          this.audioElementIsExternal = false;
          this.audioElement.crossOrigin = "anonymous";
          this.audioElement.preservesPitch = false;

          await new Promise((resolve, reject) => {
            this.audioElement.addEventListener("canplay", resolve, {
              once: true,
            });
            this.audioElement.addEventListener("error", reject, { once: true });
          });
        }

        this.sourceNode = this.audioCore.context.createMediaElementSource(
          this.audioElement,
        );
        this.state.playback.buffer = null;

        if (midiGuideUrl) {
          try {
            const guideRes = await fetch(midiGuideUrl);
            if (guideRes.ok) {
              const guideBuffer = await guideRes.arrayBuffer();
              const parsedGuide = BasicMIDI.fromArrayBuffer(guideBuffer);
              this.state.playback.currentMidi = parsedGuide;
              await this.setupMidiData(
                parsedGuide,
                midiGuideUrl.toLowerCase(),
                true,
              );
              this.state.playback.hasMidiGuide = true;
              logVerbose(`Companion MIDI Guide loaded: ${midiGuideUrl}`);
            }
          } catch (guideErr) {
            console.warn(
              "[FORTE SVC] Failed to load companion MIDI guide:",
              guideErr,
            );
          }
        }

        if (
          this.state.playback.isMultiplexed &&
          typeof url === "string" &&
          !this.state.playback.hasMidiGuide
        ) {
          this.startStreamingGuideAnalysis(url);
        }
      }

      this.state.playback.status = "stopped";
      this.state.playback.pauseTime = 0;
      logVerbose(`Track loaded: ${urlString}`);
      this.dispatchUpdate();
      return true;
    } catch (e) {
      console.error(`[FORTE SVC] Failed to load track: ${url}`, e);
      return false;
    }
  }

  /**
   * Executes loaded node timelines beginning progression logic and sound routing.
   */
  playTrack() {
    if (this.audioCore.context.state === "suspended")
      this.audioCore.context.resume();

    if (this.state.recording.destinationNode) {
      this.state.recording.trackDelayNode =
        this.audioCore.context.createDelay();
      const recordingGain = this.audioCore.context.createGain();
      recordingGain.gain.value = this.state.effects.musicGainInRecording;

      this.state.recording.musicRecordingGainNode = recordingGain;
      this.state.recording.trackDelayNode.delayTime.value =
        this.state.scoring.measuredLatencyS;

      this.state.recording.trackDelayNode.connect(recordingGain);
      recordingGain.connect(this.state.recording.destinationNode);
      recordingGain.connect(this.state.recording.musicDestinationNode);
    }

    this.state.scoring.enabled = true;

    if (this.state.playback.status !== "paused") {
      Object.assign(this.state.scoring, {
        finalScore: 0,
        totalScorableNotes: 0,
        notesHit: 0,
        micPitchHistory: [],
        singingGraceFrames: 0,
        smoothedMicMidi: 0,
        currentOctaveOffset: 0,
        wasVisuallySinging: false,
        isVocalGuideNoteActive: false,
        hasHitCurrentNote: false,
        totalFramesSinging: 0,
        framesInKey: 0,
        rollingChroma: new Array(12).fill(0),
        currentKeyName: null,
        allowedPitchClasses: [],
        keyHistory: [],
        frameCount: 0,
        activeMidiNotes: new Set(),
        details: { accuracy: 0 },
      });

      if (
        this.state.playback.isMidi &&
        this.state.playback.midiInfo &&
        this.state.playback.midiInfo.pitchClass !== null
      ) {
        const transposedPc =
          (this.state.playback.midiInfo.pitchClass +
            this.state.playback.transpose +
            24) %
          12;
        const isMinor = this.state.playback.midiInfo.scale === "minor";
        const rootNames = isMinor ? MINOR_ROOT_NAMES : MAJOR_ROOT_NAMES;
        const steps = isMinor ? MINOR_SCALE_STEPS : MAJOR_SCALE_STEPS;

        this.state.scoring.currentKeyName = `${rootNames[transposedPc]} ${
          isMinor ? "Minor" : "Major"
        }`;
        this.state.scoring.allowedPitchClasses = steps
          .map((s) => (transposedPc + s) % 12)
          .sort((a, b) => a - b);
      }
    }

    if (this.state.playback.isMidi) {
      if (
        !this.state.playback.sequencer ||
        this.state.playback.status === "playing"
      )
        return;

      if (this.state.recording.trackDelayNode && this.state.playback.midiGain) {
        this.state.playback.midiGain.connect(
          this.state.recording.trackDelayNode,
        );
        if (this.state.playback.chorusGain)
          this.state.playback.chorusGain.connect(
            this.state.recording.trackDelayNode,
          );
      }

      if (this.state.playback.status !== "paused") {
        this.state.playback.sequencer.currentTime = 0;
      }
      this.state.playback.sequencer.play();

      if (this.state.playback.hasChorus && this.chorusElement) {
        if (this.state.playback.status !== "paused") {
          this.chorusElement.currentTime = 0;
        }
        this.chorusElement
          .play()
          .catch((e) => console.error("Chorus play error:", e));
      }

      this.state.playback.status = "playing";
      if (this.state.playback.guideVolume !== undefined) {
        this.setGuideTrackVolume(this.state.playback.guideVolume);
      }
      if (this.state.playback.lockedDrumPresets) {
        setTimeout(() => {
          if (
            this.state.playback.status === "playing" &&
            this.state.playback.lockedDrumPresets
          ) {
            for (const [chStr, preset] of Object.entries(
              this.state.playback.lockedDrumPresets,
            )) {
              const ch = parseInt(chStr, 10);
              this.synthesizer.switchDrumPreset(ch, preset);
            }
          }
        }, 50);
      }
    } else {
      if (!this.audioElement || this.state.playback.status === "playing")
        return;

      try {
        this.sourceNode.disconnect();
      } catch (e) {}

      this.audioElement.playbackRate = 1.0;
      this.audioElement.preservesPitch = true;

      if (this.state.playback.isMultiplexed) {
        const vocalGuideAnalyser = this.audioCore.context.createAnalyser();
        vocalGuideAnalyser.fftSize = 2048;
        this.state.scoring.vocalGuideAnalyser = vocalGuideAnalyser;

        const delayNode = this.audioCore.context.createDelay();
        delayNode.delayTime.value = this.state.scoring.measuredLatencyS;
        this.state.scoring.guideVocalDelayNode = delayNode;

        const splitter = this.audioCore.context.createChannelSplitter(2);
        const leftGain = this.audioCore.context.createGain();
        const rightGain = this.audioCore.context.createGain();
        const monoMixer = this.audioCore.context.createGain();

        this.state.playback.leftPannerGain = leftGain;
        this.state.playback.rightPannerGain = rightGain;

        this.sourceNode.connect(splitter);
        splitter.connect(leftGain, 0); // Instrument
        splitter.connect(rightGain, 1); // Vocals
        splitter.connect(delayNode, 1); // Delay vocals for guide analyzer
        delayNode.connect(vocalGuideAnalyser);

        leftGain.connect(monoMixer);
        rightGain.connect(monoMixer);
        monoMixer.connect(this.audioCore.masterGain);

        if (this.state.recording.trackDelayNode) {
          splitter.connect(this.state.recording.trackDelayNode, 0);
        }
        this.setMultiplexPan(this.state.playback.multiplexPan);
      } else {
        if (!this.audioPitchNode) {
          this.audioPitchNode = new AudioWorkletNode(
            this.audioCore.context,
            "pitch-shifter-processor",
          );
        }

        const currentTranspose = this.state.playback.transpose || 0;
        const initialPitchFactor = Math.pow(2, currentTranspose / 12);
        this.audioPitchNode.parameters
          .get("pitchFactor")
          .setValueAtTime(
            initialPitchFactor,
            this.audioCore.context.currentTime,
          );

        this.sourceNode.connect(this.audioPitchNode);
        this.audioPitchNode.connect(this.audioCore.masterGain);
        this.sourceNode.connect(this.state.scoring.musicAnalyser);

        if (this.state.recording.trackDelayNode) {
          this.audioPitchNode.connect(this.state.recording.trackDelayNode);
        }
      }

      if (this.state.playback.hasMidiGuide && this.state.playback.sequencer) {
        this.state.playback.sequencer.currentTime =
          this.audioElement.currentTime || 0;
        this.state.playback.sequencer.playbackRate =
          this.audioElement.playbackRate || 1.0;
        this.state.playback.sequencer.play();
      }

      this.audioElement.onended = () => {
        if (this.state.playback.status === "playing") this.stopTrack();
      };

      this.audioElement.currentTime = this.state.playback.pauseTime || 0;
      this.audioElement
        .play()
        .catch((e) => console.error("[FORTE SVC] Playback error:", e));
      this.state.playback.startTime = this.audioCore.context.currentTime;
      this.state.playback.status = "playing";
    }

    if (
      !this.state.playback.isMidi &&
      !this.state.playback.isMultiplexed &&
      this.audioElement
    ) {
      if (typeof Meyda !== "undefined") {
        if (!this.state.scoring.meydaAnalyzer) {
          this.state.scoring.meydaAnalyzer = Meyda.createMeydaAnalyzer({
            audioContext: this.audioCore.context,
            source: this.state.scoring.musicAnalyser,
            bufferSize: 2048,
            featureExtractors: ["chroma"],
          });
        }
        this.state.scoring.meydaAnalyzer.start();
      }
    }

    this.dispatchUpdate();
    this.state.playback.lastFrameTime = performance.now();
    this.state.playback.smoothedTime = this.getPlaybackState().currentTime;

    if (this.animationFrameId === null) this.timingLoop();
  }

  /**
   * Briefly pauses track play preserving position counters and visual graphs.
   */
  pauseTrack() {
    if (this.state.playback.status !== "playing") return;

    this.state.scoring.enabled = false;
    this.pianoRoll.toggleVisibility(false);

    if (this.state.scoring.meydaAnalyzer)
      this.state.scoring.meydaAnalyzer.stop();

    if (this.state.recording.trackDelayNode) {
      this.state.recording.trackDelayNode.disconnect();
      if (this.state.playback.isMidi && this.state.playback.midiGain) {
        try {
          this.state.playback.midiGain.disconnect(
            this.state.recording.trackDelayNode,
          );
        } catch (e) {}
      }
      this.state.recording.trackDelayNode = null;
    }

    if (this.state.playback.sequencer) {
      try {
        this.state.playback.sequencer.pause();
      } catch (e) {}
    }

    if (this.state.playback.isMidi) {
      if (this.state.playback.hasChorus && this.chorusElement)
        this.chorusElement.pause();
      this.state.playback.status = "paused";
    } else {
      if (!this.audioElement) return;
      this.state.playback.pauseTime = this.audioElement.currentTime;
      this.audioElement.pause();
      try {
        this.sourceNode.disconnect();
      } catch (e) {}

      this.state.playback.leftPannerGain = null;
      this.state.playback.rightPannerGain = null;
      this.state.playback.status = "paused";
    }

    this.dispatchUpdate();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Ends track and resets active properties, wiping buffers and hiding tools.
   */
  stopTrack() {
    this.pianoRoll.toggleVisibility(false);

    if (this.state.playback.status === "stopped") return;
    this.state.playback.status = "stopped";
    this.state.playback.isAnalyzing = false;

    if (this.state.scoring.meydaAnalyzer)
      this.state.scoring.meydaAnalyzer.stop();

    if (this.state.recording.trackDelayNode) {
      this.state.recording.trackDelayNode.disconnect();
      if (this.state.playback.isMidi && this.state.playback.midiGain) {
        try {
          this.state.playback.midiGain.disconnect(
            this.state.recording.trackDelayNode,
          );
        } catch (e) {}
      }
      this.state.recording.trackDelayNode = null;
    }

    if (this.state.playback.sequencer) {
      try {
        this.state.playback.sequencer.pause();
        this.state.playback.sequencer.currentTime = 0;
      } catch (e) {}
      this.state.playback.sequencer = null;
    }

    this.synthesizer.unlockAllChannels();
    this.state.playback.lockedDrumPresets = null;
    this.synthesizer.reset();

    if (this.audioPitchNode) {
      try {
        this.audioPitchNode.disconnect();
      } catch (e) {}
      this.audioPitchNode = null;
    }

    if (this.state.playback.isMidi) {
      this.setTranspose(0);

      if (this.state.playback.hasChorus && this.chorusElement) {
        this.chorusElement.pause();
        this.chorusElement.currentTime = 0;
      }

      if (
        this.state.playback.currentMidi &&
        typeof this.state.playback.currentMidi.flush === "function"
      ) {
        try {
          logVerbose("Flushing current midi track");
          this.state.playback.currentMidi.flush();
        } catch (e) {
          console.warn("[FORTE SVC] Failed to flush MIDI data:", e);
        }
      }
    } else {
      if (this.audioElement) {
        this.audioElement.onended = null;
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      }
      if (this.sourceNode) {
        try {
          this.sourceNode.disconnect();
        } catch (e) {}
      }
    }

    this.state.playback.leftPannerGain = null;
    this.state.playback.rightPannerGain = null;
    this.state.playback.multiplexPan = -1;
    this.state.playback.pauseTime = 0;

    this.dispatchUpdate();

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Controls individual gain levels filtering split multiplex nodes pushing output toward specific sides.
   *
   * @param {number} panValue - Number mapped from -1 (Left/Inst) to 1 (Right/Vocal).
   */
  setMultiplexPan(panValue) {
    const pan = Math.max(-1, Math.min(1, panValue));
    this.state.playback.multiplexPan = pan;

    const { leftPannerGain, rightPannerGain } = this.state.playback;
    if (leftPannerGain && rightPannerGain) {
      leftPannerGain.gain.setValueAtTime(
        (1 - pan) / 2,
        this.audioCore.context.currentTime,
      );
      rightPannerGain.gain.setValueAtTime(
        (1 + pan) / 2,
        this.audioCore.context.currentTime,
      );
    }
    this.dispatchUpdate();
  }

  /**
   * Alters structural playback properties scaling raw audio streams up and down or stepping SpessaSynth MIDI pitch.
   *
   * @param {number} semitones - Increment specifying half-step directionations.
   */
  setTranspose(semitones) {
    const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
    const transposeDelta = clamped - this.state.playback.transpose;

    if (transposeDelta !== 0) {
      this.state.scoring.rollingChroma.fill(0);
      this.state.scoring.keyHistory = [];
      if (this.state.scoring.allowedPitchClasses.length > 0) {
        this.state.scoring.allowedPitchClasses =
          this.state.scoring.allowedPitchClasses.map(
            (pc) => (pc + transposeDelta + 24) % 12,
          );
      }

      // Keep key string up-to-date in scoring state when transposed
      if (
        (this.state.playback.isMidi || this.state.playback.hasMidiGuide) &&
        this.state.playback.midiInfo &&
        this.state.playback.midiInfo.pitchClass !== null
      ) {
        const transposedPc =
          (this.state.playback.midiInfo.pitchClass + clamped + 24) % 12;
        const isMinor = this.state.playback.midiInfo.scale === "minor";
        const rootNames = isMinor ? MINOR_ROOT_NAMES : MAJOR_ROOT_NAMES;
        this.state.scoring.currentKeyName = `${rootNames[transposedPc]} ${
          isMinor ? "Minor" : "Major"
        }`;
      }
    }

    if (
      !this.state.playback.isMidi &&
      this.state.playback.status === "playing" &&
      this.audioElement
    ) {
      this.state.playback.pauseTime = this.audioElement.currentTime;
      this.state.playback.startTime = this.audioCore.context.currentTime;
    }

    this.state.playback.transpose = clamped;

    const pitchFactor = Math.pow(2, clamped / 12);

    if (this.audioPitchNode) {
      this.audioPitchNode.parameters
        .get("pitchFactor")
        .setValueAtTime(pitchFactor, this.audioCore.context.currentTime);
    }

    if (this.audioElement) {
      this.audioElement.playbackRate = 1.0;
      this.audioElement.preservesPitch = true;
    }

    if (this.state.playback.synthesizer) {
      this.state.playback.synthesizer.setSystemParameter("keyShift", clamped);
      if (this.synthesizer) {
        this.synthesizer.sendExternalTranspose(clamped);
      }
    }

    if (this.state.playback.hasChorus && this.state.effects.chorusPitchNode) {
      this.state.effects.chorusPitchNode.parameters
        .get("pitchFactor")
        .setValueAtTime(pitchFactor, this.audioCore.context.currentTime);
    }

    this.dispatchUpdate();
  }

  /**
   * Modifies the individual track volume of the MIDI channels containing the guide melody.
   *
   * @param {number} volume - Volume mapping value (0-127).
   */
  setGuideTrackVolume(volume) {
    const applyVolumeToGuide = async () => {
      const snapshot = await this.state.playback.synthesizer.getSnapshot();
      for (const ch of this.state.playback.guideChannels) {
        const channelSnapshot = snapshot.midiChannels?.[ch.index];
        const expressionValue =
          channelSnapshot.midiControllers[midiControllers.expression];
        const actualExpression = expressionValue >> 7;
        if (actualExpression < 1) {
          this.synthesizer.setChannelExpression(ch.index, 127);
        }
        this.synthesizer.setChannelVolume(ch.index, volume);
      }
    };

    const scheduleApply = () => {
      clearTimeout(this.guideVolumeSwitchTimeout);
      this.guideVolumeSwitchTimeout = setTimeout(() => {
        if (this.state.playback.guideChannels.length < 1) {
          document.addEventListener(
            "Encore.Forte.GuideFound",
            applyVolumeToGuide,
            { once: true },
          );
          return;
        }
        applyVolumeToGuide();
      }, 50);
    };

    if (this.state.playback.status === "playing") {
      scheduleApply();
      return;
    }

    document.removeEventListener("Encore.Forte.Playback.Update", scheduleApply);
    document.addEventListener("Encore.Forte.Playback.Update", scheduleApply, {
      once: true,
    });
  }

  /**
   * Toggles Chorus
   */
  toggleChorus() {
    if (!this.state.playback.hasChorus) return false;

    this.state.playback.isChorusEnabled = !this.state.playback.isChorusEnabled;
    const gainValue = this.state.playback.isChorusEnabled ? 1 : 0;

    this.state.playback.chorusGain.gain.setTargetAtTime(
      gainValue,
      this.audioCore.context.currentTime,
      0.05,
    );
    return this.state.playback.isChorusEnabled;
  }

  /**
   * Assembles all metadata properties currently framing active media tracks output.
   *
   * @returns {Object} Representation of engine time properties and statuses.
   */
  getPlaybackState() {
    let duration = 0;
    let currentTime = 0;

    if (this.state.playback.isMidi && this.state.playback.sequencer) {
      duration = this.state.playback.sequencer.duration || 0;
      currentTime = this.state.playback.sequencer.currentTime || 0;
    } else if (this.audioElement) {
      duration = this.audioElement.duration || 0;
      currentTime = this.audioElement.currentTime || 0;
    }

    return {
      status: this.state.playback.status,
      currentTime: Math.min(currentTime, duration),
      duration,
      currentDeviceId: this.state.playback.currentDeviceId,
      currentMidiDeviceId: this.state.playback.currentMidiDeviceId,
      midiOutputs: this.state.playback.midiOutputs,
      isMidi: this.state.playback.isMidi,
      isMultiplexed: this.state.playback.isMultiplexed,
      hasChorus: this.state.playback.hasChorus,
      hasGuideNotes:
        this.state.playback.guideNotes &&
        this.state.playback.guideNotes.length > 0,
      decodedLyrics: this.state.playback.decodedLyrics,
      midiInfo: this.state.playback.midiInfo,
      transpose: this.state.playback.transpose,
      multiplexPan: this.state.playback.multiplexPan,
      score: this.scoring.getScoringState(),
    };
  }

  /**
   * Disconnects nodes cutting streams.
   */
  cleanup() {
    this.stopTrack();
  }
}
