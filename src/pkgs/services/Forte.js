import { WorkletSynthesizer as Synthetizer, Sequencer } from "spessasynth_lib";
import { BasicMIDI, midiControllers } from "spessasynth_core";
import { PitchDetector } from "pitchy";

console.log(midiControllers);

import Html from "../../libs/html.js";

/**
 * Dispatches an event notifying the frontend of a change in playback status.
 */
function dispatchPlaybackUpdate() {
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.Update", {
      detail: pkg.data.getPlaybackState(),
    }),
  );
  logVerbose("Dispatching playback update", pkg.data.getPlaybackState());
}

/**
 * Attempts to detect the correct text encoding for MIDI lyrics data to prevent mojibake.
 *
 * @param {Uint8Array} uint8Array - The raw byte data of the lyrics.
 * @returns {string} The identified encoding standard (e.g., "shift-jis", "utf-8").
 */
function detectEncoding(uint8Array) {
  const encodings = [
    "utf-8",
    "shift-jis",
    "euc-kr",
    "windows-1250",
    "windows-1252",
    "utf-16le",
    ,
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

const PITCH_CLASSES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const MAJOR_PROFILE = [
  5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0,
];
const MINOR_PROFILE = [
  5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0,
];

/**
 * Calculates the Pearson correlation coefficient between an audio chroma profile and a reference profile.
 *
 * @param {number[]} chroma - The current 12-bin chroma vector.
 * @param {number[]} profile - The reference key profile (Major/Minor).
 * @returns {number} The correlation score (-1.0 to 1.0).
 */
function getPearsonCorrelation(chroma, profile) {
  let sumC = 0,
    sumP = 0,
    sumCP = 0,
    sumC2 = 0,
    sumP2 = 0;
  for (let i = 0; i < 12; i++) {
    sumC += chroma[i];
    sumP += profile[i];
    sumCP += chroma[i] * profile[i];
    sumC2 += chroma[i] * chroma[i];
    sumP2 += profile[i] * profile[i];
  }
  const denom = Math.sqrt(
    (12 * sumC2 - sumC * sumC) * (12 * sumP2 - sumP * sumP),
  );
  if (denom === 0) return 0;
  return (12 * sumCP - sumC * sumP) / denom;
}

/**
 * Analyzes a chroma distribution array to determine the most likely active musical key.
 *
 * @param {number[]} chromaArray - The aggregated chroma bins.
 * @returns {{root: number, mode: string, name: string, correlation: number}} The estimated key data.
 */
function detectMusicalKey(chromaArray) {
  let bestCorrelation = -1;
  let bestKeyIndex = 0;
  let bestMode = "Major";

  for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
    const shiftedChroma = [];
    for (let j = 0; j < 12; j++) {
      shiftedChroma.push(chromaArray[(rootIndex + j) % 12]);
    }

    const majorCorr = getPearsonCorrelation(shiftedChroma, MAJOR_PROFILE);
    const minorCorr = getPearsonCorrelation(shiftedChroma, MINOR_PROFILE);

    if (majorCorr > bestCorrelation) {
      bestCorrelation = majorCorr;
      bestKeyIndex = rootIndex;
      bestMode = "Major";
    }
    if (minorCorr > bestCorrelation) {
      bestCorrelation = minorCorr;
      bestKeyIndex = rootIndex;
      bestMode = "Minor";
    }
  }
  return {
    root: bestKeyIndex,
    mode: bestMode,
    name: `${PITCH_CLASSES[bestKeyIndex]} ${bestMode}`,
    correlation: bestCorrelation,
  };
}

function logVerbose(message, ...args) {
  if (!state.verbose) return;
  console.log(`[FORTE SVC] ${message}`, ...args);
}

function logVerboseWarn(message, ...args) {
  if (!state.verbose) return;
  console.warn(`[FORTE SVC] ${message}`, ...args);
}

/**
 * Safely binds an event callback to a SpessaSynth v4 event handler.
 * Wrapped in try/catch and existence checks to prevent undefined map crashes.
 */
function bindSpessaEvent(handler, eventName, id, callback) {
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

/**
 * Updates the effective SFX gain based on main volume and SFX-specific volume.
 * The effective gain is the product of both volumes, allowing SFX to react relatively to main volume.
 */
function updateSfxGain() {
  if (!sfxGain || !audioContext) return;
  const effectiveGain = state.playback.volume * state.playback.sfxVolume;
  sfxGain.gain.setValueAtTime(effectiveGain, audioContext.currentTime);
}

let root;
let audioContext;
let masterGain;
let masterCompressor;
let sourceNode = null;
let sfxSourceNode = null;
let sfxSequencer = null;
let sfxResolve = null;
let animationFrameId = null;
let sfxGain;
const sfxCache = new Map();
let sfxMidiOriginalVolume = null;

let pianoRollContainer = null;
let pianoRollCanvas = null;
let pianoRollCtx = null;
let cachedPianoWidth;
let scoreReasonTimeout = null;
const PIXELS_PER_SECOND = 150;

const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIC_CLARITY_THRESHOLD = 0.85;
const RMS_NOISE_GATE = 0.015;

const KEY_AWARE_RMS_GATE = 0.015;
const KEY_AWARE_CLARITY = 0.92;
const MIN_FRAMES_FOR_FULL_SCORE = 900;
const MIN_VOCAL_HZ = 75;
const MAX_VOCAL_HZ = 1200;

let saveVocalChainTimeout = null;
let guideAnalyserBuffer = null;
let saveVolumesTimeout = null;
let micAnalyserBuffer = null;

let lastScoreTime = 0;
let lastPianoRollTime = 0;

const state = {
  scoring: {
    enabled: false,
    userInputEnabled: true,
    micStream: null,
    micSourceNode: null,
    micHighpassNode: null,
    micLowpassNode: null,
    micAnalyser: null,
    vocalGuideAnalyser: null,
    pitchDetector: null,
    guideVocalDelayNode: null,
    finalScore: 0,
    details: {
      accuracy: 0,
    },
    measuredLatencyS: 0.5,
    totalScorableNotes: 0,
    notesHit: 0,
    isVocalGuideNoteActive: false,
    hasHitCurrentNote: false,
    micDevices: [],
    currentMicDeviceId: "default",
    musicAnalyser: null,
    meydaAnalyzer: null,
    totalFramesSinging: 0,
    framesInKey: 0,
    rollingChroma: new Array(12).fill(0),
    currentKeyName: null,
    allowedPitchClasses: [],
    keyHistory: [],
    frameCount: 0,
    activeMidiNotes: new Set(),
  },
  playback: {
    status: "stopped",
    buffer: null,
    synthesizer: null,
    midiGain: null,
    sequencer: null,
    isMidi: false,
    isMultiplexed: false,
    decodedLyrics: [],
    guideNotes: [],
    lyricsEncoding: "utf-8",
    isAnalyzing: false,
    startTime: 0,
    pauseTime: 0,
    devices: [],
    currentDeviceId: "default",
    transpose: 0,
    multiplexPan: -1,
    leftPannerGain: null,
    rightPannerGain: null,
    volume: 1,
    sfxVolume: 1,
    smoothedTime: 0,
    lastFrameTime: 0,
    guideRange: { min: 42, max: 90 },
    midiInfo: {
      ticks: [],
      timeDivision: 480,
      tempoChanges: [],
      initialBpm: 120,
      keyRange: { min: 0, max: 127 },
    },
  },
  recording: {
    destinationNode: null,
    audioStream: null,
    trackDelayNode: null,
    musicRecordingGainNode: null,
  },
  effects: {
    micChainInput: null,
    micChainOutput: null,
    vocalChain: [],
    vocalChainConfig: [],
    musicGainInRecording: 0.2,
    micGainInRecording: 1.0,
  },
  ui: {
    pianoRollVisible: true,
  },
  verbose: true,
};

/**
 * Analyzes audio input and updates scoring/pitch metrics continuously.
 *
 * @param {number} currentTime - Current track playback time in seconds.
 */
function updateScore(currentTime) {
  if (
    !state.scoring.enabled ||
    !state.scoring.pitchDetector ||
    !state.scoring.micAnalyser
  ) {
    return;
  }

  if (!micAnalyserBuffer)
    micAnalyserBuffer = new Float32Array(state.scoring.micAnalyser.fftSize);

  state.scoring.micAnalyser.getFloatTimeDomainData(micAnalyserBuffer);
  const sampleRate = audioContext.sampleRate;
  const [micPitch, micClarity] = state.scoring.pitchDetector.findPitch(
    micAnalyserBuffer,
    sampleRate,
  );

  let isCorrectPitch;

  let sumSquares = 0;
  for (let i = 0; i < micAnalyserBuffer.length; i++) {
    sumSquares += micAnalyserBuffer[i] * micAnalyserBuffer[i];
  }
  const rms = Math.sqrt(sumSquares / micAnalyserBuffer.length);

  const isValidPitch = micPitch >= MIN_VOCAL_HZ && micPitch <= MAX_VOCAL_HZ;

  const isSinging =
    micClarity > MIC_CLARITY_THRESHOLD && isValidPitch && rms > RMS_NOISE_GATE;
  let midiMicPitch = isSinging ? 12 * Math.log2(micPitch / 440) + 69 : 0;

  state.scoring.isSinging = isSinging;
  state.scoring.currentMicMidi = midiMicPitch;

  const isKeyAwareSinging =
    micClarity > KEY_AWARE_CLARITY && isValidPitch && rms > KEY_AWARE_RMS_GATE;
  let keyAwareMidiPitch = isKeyAwareSinging
    ? 12 * Math.log2(micPitch / 440) + 69
    : 0;

  const hasGuideNotes =
    state.playback.guideNotes && state.playback.guideNotes.length > 0;

  if (
    hasGuideNotes ||
    (state.playback.isMultiplexed && state.scoring.vocalGuideAnalyser)
  ) {
    let targetMidiPitch = 0;
    let isGuideNoteActive = false;

    if (hasGuideNotes) {
      const currentNote = state.playback.guideNotes.find(
        (n) =>
          currentTime >= n.startTime && currentTime < n.startTime + n.duration,
      );
      if (currentNote) {
        targetMidiPitch = currentNote.pitch;
        isGuideNoteActive = true;
      }
    } else {
      if (!guideAnalyserBuffer)
        guideAnalyserBuffer = new Float32Array(
          state.scoring.vocalGuideAnalyser.fftSize,
        );

      state.scoring.vocalGuideAnalyser.getFloatTimeDomainData(
        guideAnalyserBuffer,
      );
      const [guidePitch, guideClarity] = state.scoring.pitchDetector.findPitch(
        guideAnalyserBuffer,
        sampleRate,
      );

      isGuideNoteActive =
        guideClarity >= GUIDE_CLARITY_THRESHOLD && guidePitch > 50;
      if (isGuideNoteActive) {
        targetMidiPitch = 12 * Math.log2(guidePitch / 440) + 69;
      }
    }

    const wasGuideNoteActive = state.scoring.isVocalGuideNoteActive;
    state.scoring.isVocalGuideNoteActive = isGuideNoteActive;

    if (isGuideNoteActive && !wasGuideNoteActive) {
      state.scoring.totalScorableNotes++;
      state.scoring.hasHitCurrentNote = false;
    }

    isCorrectPitch = false;
    if (isGuideNoteActive && isSinging) {
      let normalizedMicMidi = midiMicPitch;
      while (normalizedMicMidi < targetMidiPitch - 6) normalizedMicMidi += 12;
      while (normalizedMicMidi > targetMidiPitch + 6) normalizedMicMidi -= 12;

      if (Math.abs(normalizedMicMidi - targetMidiPitch) < 0.7) {
        isCorrectPitch = true;
      }
    }

    if (isCorrectPitch && !state.scoring.hasHitCurrentNote) {
      state.scoring.hasHitCurrentNote = true;
      state.scoring.notesHit++;

      if (
        pianoRollContainer &&
        pianoRollContainer.elm.classList.contains("visible") &&
        hasGuideNotes
      ) {
        const currentNote = state.playback.guideNotes.find(
          (n) =>
            currentTime >= n.startTime &&
            currentTime < n.startTime + n.duration,
        );
        if (currentNote) currentNote.hitStatus = "hit";
      }
    }

    if (state.scoring.totalScorableNotes > 0) {
      state.scoring.details.accuracy = Math.min(
        100,
        (state.scoring.notesHit / state.scoring.totalScorableNotes) * 100,
      );
    }
    state.scoring.finalScore = state.scoring.details.accuracy;
  } else {
    state.scoring.frameCount++;

    if (state.scoring.frameCount % 3 === 0) {
      if (state.playback.isMidi) {
        for (let i = 0; i < 12; i++) {
          state.scoring.rollingChroma[i] *= 0.85;
        }
        for (const note of state.scoring.activeMidiNotes) {
          state.scoring.rollingChroma[note % 12] += 0.15;
        }
      } else if (state.scoring.meydaAnalyzer && typeof Meyda !== "undefined") {
        const features = state.scoring.meydaAnalyzer.get("chroma");
        if (features) {
          for (let i = 0; i < 12; i++) {
            state.scoring.rollingChroma[i] =
              state.scoring.rollingChroma[i] * 0.85 + features[i] * 0.15;
          }
        }
      }

      if (state.scoring.frameCount % 30 === 0) {
        const detected = detectMusicalKey(state.scoring.rollingChroma);

        if (detected.correlation > 0.3) {
          state.scoring.keyHistory.push(detected);
        } else {
          state.scoring.keyHistory.push({ name: "Unknown" });
        }

        if (state.scoring.keyHistory.length > 6) {
          state.scoring.keyHistory.shift();
        }

        const votes = {};
        let maxVotes = 0;
        let votedKey = null;
        let votedRoot = 0;
        let votedMode = "";

        for (const k of state.scoring.keyHistory) {
          if (k.name === "Unknown") continue;
          votes[k.name] = (votes[k.name] || 0) + 1;
          if (votes[k.name] > maxVotes) {
            maxVotes = votes[k.name];
            votedKey = k.name;
            votedRoot = k.root;
            votedMode = k.mode;
          }
        }

        if (votedKey) {
          if (!state.scoring.currentKeyName && maxVotes >= 2) {
            state.scoring.currentKeyName = votedKey;
            const intervals =
              votedMode === "Major"
                ? [0, 2, 4, 5, 7, 9, 11]
                : [0, 2, 3, 5, 7, 8, 10];
            state.scoring.allowedPitchClasses = intervals.map(
              (interval) => (votedRoot + interval) % 12,
            );
            console.log(
              `[FORTE SVC] 🎵 Initial Key Locked: ${votedKey} (${maxVotes}/6 votes)`,
            );
          } else if (
            state.scoring.currentKeyName !== votedKey &&
            maxVotes >= 4
          ) {
            state.scoring.currentKeyName = votedKey;
            const intervals =
              votedMode === "Major"
                ? [0, 2, 4, 5, 7, 9, 11]
                : [0, 2, 3, 5, 7, 8, 10];
            state.scoring.allowedPitchClasses = intervals.map(
              (interval) => (votedRoot + interval) % 12,
            );
            console.log(
              `[FORTE SVC] 🎵 Key Modulation Confirmed: ${votedKey} (${maxVotes}/6 votes)`,
            );
          }
        }
      }
    }

    if (isKeyAwareSinging && state.scoring.allowedPitchClasses.length > 0) {
      state.scoring.totalFramesSinging++;
      const pitchClass = Math.round(keyAwareMidiPitch) % 12;

      if (state.scoring.allowedPitchClasses.includes(pitchClass)) {
        state.scoring.framesInKey++;
      }
    }

    if (state.scoring.totalFramesSinging > 0) {
      const rawAccuracy =
        (state.scoring.framesInKey / state.scoring.totalFramesSinging) * 100;
      const participationMultiplier = Math.min(
        1.0,
        state.scoring.totalFramesSinging / MIN_FRAMES_FOR_FULL_SCORE,
      );

      state.scoring.details.accuracy = rawAccuracy * participationMultiplier;
    } else {
      state.scoring.details.accuracy = 0;
    }

    state.scoring.finalScore = state.scoring.details.accuracy;
  }

  if (
    pianoRollContainer &&
    pianoRollContainer.elm.classList.contains("visible")
  ) {
    if (hasGuideNotes) {
      const currentNote = state.playback.guideNotes.find(
        (n) =>
          currentTime >= n.startTime && currentTime < n.startTime + n.duration,
      );

      if (currentNote) {
        if (isCorrectPitch) {
          currentNote.hitStatus = "hit";
        } else if (isSinging) {
          currentNote.hitStatus = "miss";
        }
      }
    }
  }
}

/**
 * Primary synchronization loop processing active playback progression and UI updates.
 */
function timingLoop() {
  if (state.playback.status !== "playing") {
    animationFrameId = null;
    return;
  }

  const now = performance.now();
  let delta = (now - state.playback.lastFrameTime) / 1000;
  if (delta > 0.1) delta = 0.1;
  state.playback.lastFrameTime = now;

  const engineState = pkg.data.getPlaybackState();
  const engineTime = engineState.currentTime;
  const duration = engineState.duration;

  let rate = 1.0;
  if (!state.playback.isMidi && sourceNode) {
    rate = sourceNode.playbackRate.value;
  }

  state.playback.smoothedTime += delta * rate;

  const drift = engineTime - state.playback.smoothedTime;
  if (Math.abs(drift) > 0.5) {
    state.playback.smoothedTime = engineTime;
  } else {
    state.playback.smoothedTime += drift * 0.15;
  }

  const currentTime = Math.max(
    0,
    Math.min(state.playback.smoothedTime, duration),
  );

  if (
    pianoRollContainer &&
    pianoRollContainer.elm.classList.contains("visible")
  ) {
    drawPianoRoll(currentTime);
  }

  if (state.scoring.enabled) {
    if (now - lastScoreTime > 33) {
      updateScore(currentTime);
      document.dispatchEvent(
        new CustomEvent("CherryTree.Forte.Scoring.Update", {
          detail: pkg.data.getScoringState(),
        }),
      );
      lastScoreTime = now;
    }
  }

  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.TimeUpdate", {
      detail: { currentTime, duration },
    }),
  );

  if (state.scoring.enabled) {
    document.dispatchEvent(
      new CustomEvent("CherryTree.Forte.Scoring.Update", {
        detail: pkg.data.getScoringState(),
      }),
    );
  }

  // End of track detection fallback
  if (engineTime >= duration && duration > 0) {
    animationFrameId = null;
    if (state.playback.status === "playing") {
      pkg.data.stopTrack();
    }
    return;
  }

  animationFrameId = requestAnimationFrame(timingLoop);
}

/**
 * Synchronizes the canvas size and explicitly forces a render.
 */
function renderPianoRollNotes(notes) {
  if (!pianoRollCanvas || !pianoRollContainer) return;
  drawPianoRoll(pkg.data.getPlaybackState().currentTime);
}

/**
 * Draws the active viewport of the piano roll directly onto the canvas.
 */
function drawPianoRoll(currentTime) {
  if (!pianoRollCanvas || !pianoRollCtx || !pianoRollContainer) return;

  const canvas = pianoRollCanvas.elm;
  const ctx = pianoRollCtx;

  const expectedWidth = cachedPianoWidth;
  if (canvas.width !== expectedWidth) canvas.width = expectedWidth;
  if (canvas.height !== 250) canvas.height = 250;

  const width = canvas.width;
  const height = canvas.height;
  if (width === 0 || height === 0) return;

  ctx.clearRect(0, 0, width, height);

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  const numGridLines = 8;
  ctx.beginPath();
  for (let i = 1; i < numGridLines; i++) {
    const lineY = (height / numGridLines) * i;
    ctx.moveTo(0, lineY);
    ctx.lineTo(width, lineY);
  }
  ctx.stroke();

  const notes = state.playback.guideNotes || [];

  const PRE_ROLL_SECONDS = 2.5;
  let firstNoteTime = 0;
  if (notes.length > 0) {
    firstNoteTime = notes[0].startTime;
  }

  const globalOffset = Math.max(0, firstNoteTime - PRE_ROLL_SECONDS);
  const adjustedTime = currentTime - globalOffset;
  const PAGE_DURATION = width / PIXELS_PER_SECOND;

  const pageIndex = Math.floor(Math.max(0, adjustedTime) / PAGE_DURATION);
  const pageAdjustedStartTime = pageIndex * PAGE_DURATION;

  const pageRealStartTime = pageAdjustedStartTime + globalOffset;
  const pageRealEndTime = pageRealStartTime + PAGE_DURATION;

  const playheadX = (adjustedTime - pageAdjustedStartTime) * PIXELS_PER_SECOND;

  const minMidi = state.playback.guideRange?.min ?? 42;
  const maxMidi = state.playback.guideRange?.max ?? 90;
  const rangeDiff = Math.max(1, maxMidi - minMidi);
  const NOTE_HEIGHT = 16;

  const pitchToY = (pitch) => {
    if (pitch < minMidi) return height;
    if (pitch > maxMidi) return 0;
    const normalized = (pitch - minMidi) / rangeDiff;
    return height - normalized * height;
  };

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.startTime + note.duration < pageRealStartTime) continue;
    if (note.startTime > pageRealEndTime) break;

    const startX = (note.startTime - pageRealStartTime) * PIXELS_PER_SECOND;
    const noteWidth = Math.max(note.duration * PIXELS_PER_SECOND, 8);
    const y = pitchToY(note.pitch);

    if (!isFinite(startX) || !isFinite(y) || !isFinite(noteWidth)) continue;

    const isActive = playheadX >= startX && playheadX <= startX + noteWidth;

    const grad = ctx.createLinearGradient(
      0,
      y - NOTE_HEIGHT / 2,
      0,
      y + NOTE_HEIGHT / 2,
    );
    if (note.hitStatus === "hit") {
      grad.addColorStop(0, "#a3e635");
      grad.addColorStop(1, "#4d7c0f");
      ctx.shadowColor = "#a3e635";
      ctx.shadowBlur = isActive ? 15 : 5;
    } else if (note.hitStatus === "miss") {
      grad.addColorStop(0, "#fca5a5");
      grad.addColorStop(1, "#991b1b");
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    } else {
      grad.addColorStop(0, "#7dd3fc");
      grad.addColorStop(1, "#0284c7");
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = isActive ? 10 : 0;
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(
        startX,
        y - NOTE_HEIGHT / 2,
        noteWidth,
        NOTE_HEIGHT,
        NOTE_HEIGHT / 2,
      );
    } else {
      ctx.rect(startX, y - NOTE_HEIGHT / 2, noteWidth, NOTE_HEIGHT);
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(
        startX + 2,
        y - NOTE_HEIGHT / 2 + 1,
        noteWidth - 4,
        NOTE_HEIGHT / 3,
        3,
      );
    } else {
      ctx.rect(
        startX + 2,
        y - NOTE_HEIGHT / 2 + 1,
        noteWidth - 4,
        NOTE_HEIGHT / 3,
      );
    }
    ctx.fill();

    if (isActive && note.hitStatus === "hit" && state.scoring.isSinging) {
      const sparkGrad = ctx.createRadialGradient(
        playheadX,
        y,
        0,
        playheadX,
        y,
        20,
      );
      sparkGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
      sparkGrad.addColorStop(0.3, "rgba(163, 230, 53, 0.8)");
      sparkGrad.addColorStop(1, "rgba(163, 230, 53, 0)");
      ctx.fillStyle = sparkGrad;
      ctx.fillRect(playheadX - 20, y - 20, 40, 40);
    }
  }

  if (playheadX >= 0) {
    const sweepWidth = 120;
    const sweepGrad = ctx.createLinearGradient(
      playheadX - sweepWidth,
      0,
      playheadX,
      0,
    );
    sweepGrad.addColorStop(0, "transparent");
    sweepGrad.addColorStop(1, "rgba(255, 215, 0, 0.15)");
    ctx.fillStyle = sweepGrad;
    ctx.fillRect(playheadX - sweepWidth, 0, sweepWidth, height);

    ctx.fillStyle = "#ffd700";
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 15;
    ctx.fillRect(playheadX - 1, 0, 2, height);
    ctx.shadowBlur = 0;
  }

  if (
    state.scoring.isSinging &&
    state.scoring.currentMicMidi > 0 &&
    playheadX >= 0
  ) {
    const userY = pitchToY(state.scoring.currentMicMidi);
    if (isFinite(userY)) {
      const time = performance.now();
      const pulse = Math.sin(time / 100) * 3;

      ctx.beginPath();
      ctx.arc(playheadX, userY, 12 + pulse, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(137, 207, 240, 0.3)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(playheadX, userY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "#38bdf8";
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(playheadX, userY, 8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

/**
 * Starts a background asynchronous chunked processing routine measuring Multiplex pitch lines.
 *
 * @param {AudioBuffer} audioBuffer - Full track decoded buffer containing isolated guide track on right channel.
 */
function startIncrementalGuideAnalysis(audioBuffer) {
  console.log("[FORTE SVC] Starting incremental analysis for piano roll...");
  state.playback.isAnalyzing = true;
  const channelData = audioBuffer.getChannelData(1);
  const sampleRate = audioBuffer.sampleRate;

  const bufferSize = 2048;
  const detector = PitchDetector.forFloat32Array(bufferSize);

  const minNoteDuration = 0.08;
  const stepSize = 1024;
  let noteIdCounter = state.playback.guideNotes.length;

  let analysisPosition = 0;
  const analysisChunkDurationS = 2;
  const analysisChunkSamples = analysisChunkDurationS * sampleRate;

  let currentNote = null;

  function processChunk() {
    if (!state.playback.isAnalyzing) {
      console.log("[FORTE SVC] Incremental analysis stopped.");
      return;
    }

    const chunkEndPosition = Math.min(
      analysisPosition + analysisChunkSamples,
      channelData.length - bufferSize,
    );
    const foundNotes = [];
    const dataLen = channelData.length;

    for (let i = analysisPosition; i < chunkEndPosition; i += stepSize) {
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
          const pLen = currentNote.pitches.length;
          for (let k = 0; k < pLen; k++) pSum += currentNote.pitches[k];

          foundNotes.push({
            id: noteIdCounter++,
            pitch: pSum / pLen,
            startTime: currentNote.startTime,
            duration: duration,
          });
        }
        currentNote = null;
      }
    }

    if (foundNotes.length > 0) {
      const lastGlobalNote =
        state.playback.guideNotes[state.playback.guideNotes.length - 1];
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

      state.playback.guideNotes.push(...foundNotes);
      renderPianoRollNotes(foundNotes);
    }

    analysisPosition = chunkEndPosition;
    if (analysisPosition < dataLen - bufferSize) {
      setTimeout(processChunk, 16);
    } else {
      if (currentNote) {
        const time = (dataLen - 1) / sampleRate;
        const duration = time - currentNote.startTime;
        if (duration > minNoteDuration) {
          let pSum = 0;
          const pLen = currentNote.pitches.length;
          for (let k = 0; k < pLen; k++) pSum += currentNote.pitches[k];

          const finalNote = {
            id: noteIdCounter++,
            pitch: pSum / pLen,
            startTime: currentNote.startTime,
            duration: duration,
          };
          state.playback.guideNotes.push(finalNote);
          renderPianoRollNotes([finalNote]);
        }
      }
      state.playback.isAnalyzing = false;
      logVerbose("Incremental guide analysis complete.");
    }
  }

  setTimeout(processChunk, 16);
}

const pkg = {
  name: "Forte Sound Engine Service",
  svcName: "ForteSvc",
  type: "svc",
  privs: 0,
  /**
   * Instantiates global audio contexts and pipeline nodes.
   *
   * @param {Object} Root - Global Application object.
   */
  start: async function (Root) {
    logVerbose("Starting Forte Sound Engine Service for Encore.");
    root = Root;

    pianoRollContainer = new Html("div")
      .classOn("forte-piano-roll-container")
      .appendTo("body");
    pianoRollCanvas = new Html("canvas")
      .classOn("forte-piano-roll-canvas")
      .appendTo(pianoRollContainer);
    pianoRollCtx = pianoRollCanvas.elm.getContext("2d");

    cachedPianoWidth = window.innerWidth;
    window.addEventListener("resize", () => {
      if (pianoRollCanvas && pianoRollContainer) {
        cachedPianoWidth =
          pianoRollContainer.elm.clientWidth || window.innerWidth;
        pianoRollCanvas.elm.width = cachedPianoWidth;
        pianoRollCanvas.elm.height = 250;
        if (state.playback.status !== "playing" && pkg.data) {
          drawPianoRoll(pkg.data.getPlaybackState().currentTime);
        }
      }
    });

    try {
      const config = await window.config.getAll();
      const bufferSize = config.audioConfig?.bufferSize ?? 0.1;
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: bufferSize,
        sampleRate: 44100,
      });

      masterGain = audioContext.createGain();
      sfxGain = audioContext.createGain();

      masterCompressor = audioContext.createDynamicsCompressor();
      masterCompressor.threshold.setValueAtTime(-24, audioContext.currentTime);
      masterCompressor.knee.setValueAtTime(40, audioContext.currentTime);
      masterCompressor.ratio.setValueAtTime(4, audioContext.currentTime);
      masterCompressor.attack.setValueAtTime(0.01, audioContext.currentTime);
      masterCompressor.release.setValueAtTime(0.25, audioContext.currentTime);

      masterGain.connect(masterCompressor);
      masterCompressor.connect(audioContext.destination);

      sfxGain.connect(audioContext.destination);
      sfxGain.gain.value = state.playback.volume;

      state.recording.destinationNode =
        audioContext.createMediaStreamDestination();
      state.recording.audioStream = state.recording.destinationNode.stream;

      state.recording.micDestinationNode =
        audioContext.createMediaStreamDestination();
      state.recording.musicDestinationNode =
        audioContext.createMediaStreamDestination();
      state.recording.micAudioStream =
        state.recording.micDestinationNode.stream;
      state.recording.musicAudioStream =
        state.recording.musicDestinationNode.stream;

      state.effects.micChainInput = audioContext.createGain();
      state.effects.micChainOutput = audioContext.createGain();
      state.effects.micChainInput.connect(state.effects.micChainOutput);

      state.effects.micChainOutput.connect(state.recording.destinationNode);
      state.effects.micChainOutput.connect(state.recording.micDestinationNode);

      state.playback.midiGain = audioContext.createGain();
      state.playback.midiGain.connect(masterGain);

      state.scoring.musicAnalyser = audioContext.createAnalyser();
      state.scoring.musicAnalyser.fftSize = 2048;
      state.playback.midiGain.connect(state.scoring.musicAnalyser);

      logVerbose("Audio pipelines initialized.");
      logVerbose("AudioContext sinkId", audioContext.sinkId || "default");
      logVerbose("AudioContext baseLatency", audioContext.baseLatency);
      logVerbose("AudioContext outputLatency", audioContext.outputLatency);
      logVerbose(
        "AudioContext total latency",
        audioContext.baseLatency + audioContext.outputLatency,
      );

      state.playback.currentDeviceId = audioContext.sinkId || "default";
      pkg.data.getPlaybackDevices();

      try {
        await audioContext.audioWorklet.addModule(
          "/libs/spessasynth_lib/dist/spessasynth_processor.min.js",
        );
        const soundFontUrl = "/libs/soundfonts/SAM2695.sf2";
        const soundFontBuffer = await (await fetch(soundFontUrl)).arrayBuffer();

        state.playback.synthesizer = new Synthetizer(audioContext);
        await state.playback.synthesizer.soundBankManager.addSoundBank(
          soundFontBuffer,
        );
        state.playback.synthesizer.connect(state.playback.midiGain);
        logVerbose("synthion", state.playback.synthesizer);
        logVerbose("Preset list", state.playback.synthesizer.presetList);

        console.log("[FORTE SVC] MIDI Synthesizer initialized successfully.");
      } catch (synthError) {
        console.error(
          "[FORTE SVC] FATAL: Could not initialize MIDI Synthesizer.",
          synthError,
        );
        state.playback.synthesizer = null;
      }
    } catch (e) {
      console.error("[FORTE SVC] FATAL: Web Audio API is not supported.", e);
    }

    await pkg.data.initializeScoringEngine();
  },

  data: {
    /**
     * Retrieves the continuous stream containing both mixed mic and music lines.
     *
     * @returns {MediaStream} Real-time audio stream output.
     */
    getRecordingAudioStream: () => {
      return state.recording.audioStream;
    },

    /**
     * Retrieves the continuous stream containing the mic stream.
     *
     * @returns {MediaStream} Real-time audio stream output.
     */
    getMicAudioStream: () => {
      return state.recording.micAudioStream;
    },

    /**
     * Retrieves the continuous stream containing the music stream.
     *
     * @returns {MediaStream} Real-time audio stream output.
     */
    getMusicAudioStream: () => {
      return state.recording.musicAudioStream;
    },

    /**
     * Loads a short sound effect into the global buffer cache.
     *
     * @param {string} url - Audio endpoint.
     * @returns {Promise<boolean>} True if loaded.
     */
    loadSfx: async (url) => {
      if (!audioContext) return false;
      if (sfxCache.has(url)) return true;
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        const isMidi =
          url.toLowerCase().endsWith(".mid") ||
          url.toLowerCase().endsWith(".midi") ||
          url.toLowerCase().endsWith(".kar");

        if (isMidi) {
          sfxCache.set(url, { isMidi: true, buffer: arrayBuffer });
          return true;
        }

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        sfxCache.set(url, { isMidi: false, buffer: audioBuffer });
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load SFX: ${url}`, e);
        return false;
      }
    },

    /**
     * Fires a previously cached sound effect immediately.
     * Resolves when the effect has fully completed playing.
     *
     * @param {string} url - Target URL matching the cache dictionary.
     * @param {number} [volume=1] - Optional volume multiplier from 0.0 to 1.0 for this specific play.
     * @returns {Promise<boolean>} Resolves to true when completed naturally, false if interrupted.
     */
    playSfx: async (url, volume = 1) => {
      await pkg.data.stopSfx();

      return new Promise(async (resolve) => {
        if (!audioContext) return resolve(false);
        if (audioContext.state === "suspended") await audioContext.resume();

        let cached = sfxCache.get(url);
        if (!cached) {
          const success = await pkg.data.loadSfx(url);
          if (!success) return resolve(false);
          cached = sfxCache.get(url);
        }

        const clampedVolume = Math.max(0, Math.min(1, volume));

        if (cached) {
          sfxResolve = resolve;

          if (cached.isMidi) {
            if (!state.playback.synthesizer || !state.playback.midiGain)
              return resolve(false);

            sfxMidiOriginalVolume = state.playback.midiGain.gain.value;
            const sfxTargetVolume =
              state.playback.volume * state.playback.sfxVolume * clampedVolume;
            state.playback.midiGain.gain.setTargetAtTime(
              sfxTargetVolume,
              audioContext.currentTime,
              0.01,
            );

            sfxSequencer = new Sequencer(state.playback.synthesizer);
            sfxSequencer.loop = false;

            let sfxMidiData;
            try {
              sfxMidiData = BasicMIDI.fromArrayBuffer(cached.buffer);
            } catch (e) {
              sfxMidiData = { binary: cached.buffer };
            }
            sfxSequencer.loadNewSongList([sfxMidiData]);
            sfxSequencer.play();

            bindSpessaEvent(
              sfxSequencer.eventHandler,
              "songEnded",
              "forte-sfx-end",
              () => {
                if (sfxMidiOriginalVolume !== null && state.playback.midiGain) {
                  state.playback.midiGain.gain.setTargetAtTime(
                    sfxMidiOriginalVolume,
                    audioContext.currentTime,
                    0.01,
                  );
                  sfxMidiOriginalVolume = null;
                }
                if (sfxResolve) {
                  sfxResolve(true);
                  sfxResolve = null;
                }
                if (sfxSequencer) {
                  try {
                    sfxSequencer.pause();
                  } catch (e) {}
                  sfxSequencer = null;
                }
              },
            );
          } else {
            sfxSourceNode = audioContext.createBufferSource();
            sfxSourceNode.buffer = cached.buffer;

            const sfxIndividualGain = audioContext.createGain();
            sfxIndividualGain.gain.value = clampedVolume;
            sfxSourceNode.connect(sfxIndividualGain);
            sfxIndividualGain.connect(sfxGain);

            sfxSourceNode.onended = () => {
              if (sfxResolve) {
                sfxResolve(true);
                sfxResolve = null;
              }
            };
            sfxSourceNode.start(0);
          }
        } else {
          resolve(false);
        }
      });
    },

    /**
     * Stops sound effect
     */
    stopSfx: async () => {
      if (sfxSourceNode) {
        sfxSourceNode.onended = null;
        sfxSourceNode.stop();
        sfxSourceNode = null;
      }
      if (sfxSequencer) {
        try {
          sfxSequencer.pause();
        } catch (e) {}
        try {
          sfxSequencer.currentTime = 0;
        } catch (e) {}
        sfxSequencer = null;

        if (sfxMidiOriginalVolume !== null && state.playback.midiGain) {
          state.playback.midiGain.gain.setTargetAtTime(
            sfxMidiOriginalVolume,
            audioContext.currentTime,
            0.01,
          );
          sfxMidiOriginalVolume = null;
        }
      }
      if (sfxResolve) {
        sfxResolve(false);
        sfxResolve = null;
      }
    },

    /**
     * Retrieves available hardware output devices mapping them to system identifiers.
     *
     * @returns {Promise<Array<{deviceId: string, label: string}>>} List of detected output pairs.
     */
    getPlaybackDevices: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = allDevices
          .filter((device) => device.kind === "audiooutput")
          .map((device) => ({
            deviceId: device.deviceId,
            label:
              device.label ||
              `Output Device ${device.deviceId.substring(0, 8)}`,
          }));
        state.playback.devices = audioOutputs;
        return audioOutputs;
      } catch (e) {
        return [];
      }
    },

    /**
     * Points audio graph out towards a specific hardware boundary via API.
     *
     * @param {string} deviceId - Local device token.
     * @returns {Promise<boolean>} Indication of success mapping out.
     */
    setPlaybackDevice: async (deviceId) => {
      if (!audioContext || typeof audioContext.setSinkId !== "function")
        return false;
      try {
        await audioContext.setSinkId(deviceId);
        state.playback.currentDeviceId = deviceId;
        logVerbose("Playback device set", deviceId);
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * Sets the container element for piano roll UI components.
     * Moves the piano roll elements from their current parent to the specified container.
     *
     * @param {HTMLElement|string} containerSelector - DOM element or CSS selector string.
     * @returns {boolean} True if successfully moved, false if container not found.
     */
    setPianoRollContainer: (containerSelector) => {
      try {
        let container;
        if (typeof containerSelector === "string") {
          container = Html.qs(containerSelector);
        } else {
          container = containerSelector;
        }

        if (!container) {
          console.error(
            "[FORTE SVC] Invalid piano roll container",
            containerSelector,
          );
          return false;
        }

        if (pianoRollContainer) {
          pianoRollContainer.appendTo(container);
          logVerbose("Piano roll container moved", container.elm);
        }

        return true;
      } catch (e) {
        console.error("[FORTE SVC] Failed to move piano roll container:", e);
        return false;
      }
      return false;
    },

    /**
     * Determines CSS layout presentation showing the pitch mapping visualization layer.
     *
     * @param {boolean} bool - True enforcing visible traits.
     */
    togglePianoRollVisibility: async (bool) => {
      state.ui.pianoRollVisible = bool;
      if (bool && pianoRollContainer) {
        pianoRollContainer.classOn("visible");
      } else if (pianoRollContainer) {
        pianoRollContainer.classOff("visible");
      }
    },

    /**
     * Replaces the running default soundfont buffer used in SpessaSynth.
     *
     * @param {string} url - Target SF2 endpoint structure URL.
     * @returns {Promise<boolean>} True indicating the buffer rebuilt completely.
     */
    loadSoundFont: async (url) => {
      if (!audioContext) return false;

      if (state.playback.status !== "stopped") {
        pkg.data.stopTrack();
      }

      logVerbose(`Swapping SoundBank with: ${url}`);

      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (state.playback.synthesizer) {
          state.playback.synthesizer.disconnect();
          state.playback.synthesizer = null;
        }

        state.playback.synthesizer = new Synthetizer(audioContext);
        await state.playback.synthesizer.soundBankManager.addSoundBank(
          arrayBuffer,
        );
        state.playback.synthesizer.connect(state.playback.midiGain);
        logVerbose("Preset list", state.playback.synthesizer.presetList);

        if (state.playback.transpose !== 0) {
          state.playback.synthesizer.setMasterParameter(
            "transposition",
            state.playback.transpose,
          );
        }

        logVerbose("New SoundBank loaded and Synthesizer recreated.");
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load custom SoundBank: ${url}`, e);
        return false;
      }
    },

    /**
     * Primary load sequencer formatting tracks and establishing variables specific to decoding contexts.
     *
     * @param {string} url - The targeted local media.
     * @returns {Promise<boolean>} True if all media segments parsed cleanly.
     */
    loadTrack: async (url) => {
      if (!audioContext) return false;
      if (state.playback.status !== "stopped") pkg.data.stopTrack();

      if (state.playback.sequencer) {
        try {
          state.playback.sequencer.pause();
        } catch (e) {}
        try {
          state.playback.sequencer.currentTime = 0;
        } catch (e) {}
        state.playback.sequencer = null;
      }

      state.playback.midiInfo = {
        ticks: [],
        timeDivision: 480,
        tempoChanges: [],
        initialBpm: 120,
        keyRange: { min: 0, max: 127 },
      };

      state.playback.decodedLyrics = [];
      state.playback.lyricsEncoding = "utf-8";
      state.playback.transpose = 0;
      state.playback.isMultiplexed = false;
      state.playback.multiplexPan = -1;
      state.playback.guideNotes = [];
      state.playback.guideRange = { min: 42, max: 90 };
      state.playback.isAnalyzing = false;
      state.scoring.activeMidiNotes.clear();

      if (pianoRollContainer) pianoRollContainer.classOff("visible");

      const isMidi =
        url.toLowerCase().endsWith(".mid") ||
        url.toLowerCase().endsWith(".midi") ||
        url.toLowerCase().endsWith(".kar");
      state.playback.isMidi = isMidi;

      if (!isMidi && url.toLowerCase().includes(".multiplexed.")) {
        state.playback.isMultiplexed = true;
      }
      logVerbose("Preparing to load track", {
        url,
        isMidi,
        isMultiplexed: state.playback.isMultiplexed,
      });

      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (isMidi) {
          if (!state.playback.synthesizer)
            throw new Error("MIDI Synthesizer not ready.");

          let parsedMidi;
          try {
            parsedMidi = BasicMIDI.fromArrayBuffer(arrayBuffer);
          } catch (e) {
            console.error("[FORTE SVC] BasicMIDI parsing failed:", e);
            throw e;
          }

          logVerbose("Notes", parsedMidi.getNoteTimes());

          state.playback.sequencer = new Sequencer(state.playback.synthesizer);
          state.playback.sequencer.loop = false;

          bindSpessaEvent(
            state.playback.sequencer.eventHandler,
            "songEnded",
            "forte-song-end",
            () => {
              if (state.playback.status !== "stopped") pkg.data.stopTrack();
            },
          );

          logVerbose("Sequencer loaded", state.playback.sequencer);
          logVerbose("Synthesizer", state.playback.synthesizer);

          for (const channel of state.playback.synthesizer.midiChannels || []) {
            console.log("Midi channel", channel);
          }

          bindSpessaEvent(
            state.playback.synthesizer.eventHandler,
            "noteOn",
            "forte-note-on",
            (e) => {
              const isDrum = state.playback.synthesizer.midiChannels
                ? (state.playback.synthesizer.midiChannels[e.channel]?.preset
                    ?.isGMGSDrum ??
                  state.playback.synthesizer.midiChannels[e.channel]?.isDrum ??
                  e.channel === 9)
                : e.channel === 9;

              if (!isDrum) {
                if (e.velocity > 0) {
                  state.scoring.activeMidiNotes.add(e.midiNote);
                } else {
                  state.scoring.activeMidiNotes.delete(e.midiNote);
                }
              }
            },
          );

          bindSpessaEvent(
            state.playback.synthesizer.eventHandler,
            "noteOff",
            "forte-note-off",
            (e) => {
              const isDrum = state.playback.synthesizer.midiChannels
                ? (state.playback.synthesizer.midiChannels[e.channel]?.preset
                    ?.isGMGSDrum ??
                  state.playback.synthesizer.midiChannels[e.channel]?.isDrum ??
                  e.channel === 9)
                : e.channel === 9;

              if (!isDrum) {
                state.scoring.activeMidiNotes.delete(e.midiNote);
              }
            },
          );

          let displayableLyricIndex = 0;

          bindSpessaEvent(
            state.playback.sequencer.eventHandler,
            "metaEvent",
            "forte-meta",
            (e) => {
              if (state.playback.status === "stopped") return;
              if (!e || !e.event) return;

              const dataArray = e.event.data;

              if (!dataArray || !(dataArray instanceof Uint8Array)) return;
              const text = new TextDecoder(
                state.playback.lyricsEncoding,
              ).decode(dataArray);
              const cleanText = text.replace(/[\r\n\/\\]/g, "");

              if (cleanText && cleanText == "@IENCOREDUET") {
                logVerbose("This is a duet");
                document.dispatchEvent(
                  new CustomEvent("CherryTree.Forte.Playback.DuetDetected"),
                );
              }

              if (
                cleanText &&
                !cleanText.startsWith("@") &&
                !cleanText.startsWith("#")
              ) {
                let isVerifiedLyric = false;

                const maxLookahead = Math.min(
                  displayableLyricIndex + 5,
                  state.playback.decodedLyrics.length,
                );
                for (let i = displayableLyricIndex; i < maxLookahead; i++) {
                  const expectedClean = state.playback.decodedLyrics[i].replace(
                    /[\r\n\/\\]/g,
                    "",
                  );
                  if (cleanText === expectedClean) {
                    isVerifiedLyric = true;
                    displayableLyricIndex = i;
                    break;
                  }
                }

                if (isVerifiedLyric) {
                  displayableLyricIndex++;
                } else {
                  logVerbose("Ignored non-lyric meta event:", cleanText);
                }
              }
            },
          );

          state.playback.sequencer.loadNewSongList([parsedMidi]);
          const rawLyrics = parsedMidi.lyrics || [];

          state.playback.midiInfo = {
            ticks: rawLyrics
              .map((msg) => msg.ticks)
              .filter((t) => t !== undefined),
            timeDivision: parsedMidi.timeDivision || 480,
            tempoChanges: parsedMidi.tempoChanges || [],
            initialBpm: 120,
            keyRange: parsedMidi.keyRange || { min: 0, max: 127 },
          };

          if (parsedMidi.tempoChanges && parsedMidi.tempoChanges.length > 0) {
            state.playback.midiInfo.initialBpm = Math.round(
              parsedMidi.tempoChanges[0].tempo || 120,
            );
          }

          if (rawLyrics.length > 0) {
            const lyricTimes = rawLyrics
              .filter((l) => l.ticks !== undefined)
              .map((l) => parsedMidi.midiTicksToSeconds(l.ticks));

            if (lyricTimes.length > 5) {
              const channels = parsedMidi.getNoteTimes();
              const candidateChannels = [];

              for (let i = 0; i < 16; i++) {
                if (i === 9) continue;

                const notes = channels[i];
                if (!notes || notes.length === 0) continue;
                if (notes.length < lyricTimes.length * 0.3) continue;
                if (notes.length > lyricTimes.length * 4) continue;

                let chordNotes = 0;
                for (let n = 1; n < notes.length; n++) {
                  if (Math.abs(notes[n].start - notes[n - 1].start) < 0.05) {
                    chordNotes++;
                  }
                }
                const polyphonyRatio = chordNotes / notes.length;
                if (polyphonyRatio > 0.25) continue;

                let matches = 0;
                let pitchSum = 0;
                for (const lTime of lyricTimes) {
                  if (notes.some((n) => Math.abs(n.start - lTime) < 0.1)) {
                    matches++;
                  }
                }
                const matchRatio = matches / lyricTimes.length;

                notes.forEach((n) => (pitchSum += n.midiNote));
                const avgPitch = pitchSum / notes.length;

                let pitchPenalty = 0;
                if (avgPitch < 50) pitchPenalty = (50 - avgPitch) * 0.15;
                if (avgPitch > 85) pitchPenalty = (avgPitch - 85) * 0.15;

                const score = matchRatio - polyphonyRatio * 1.5 - pitchPenalty;

                candidateChannels.push({
                  index: i,
                  notes: notes,
                  matchRatio,
                  polyphonyRatio,
                  avgPitch,
                  score,
                });
              }

              candidateChannels.sort((a, b) => b.score - a.score);

              if (
                candidateChannels.length > 0 &&
                candidateChannels[0].matchRatio > 0.15
              ) {
                const mainChannel = candidateChannels[0];
                const validChannels = [mainChannel];

                logVerbose(
                  `🎵 Primary Vocal Guide on Channel ${mainChannel.index + 1} (Score: ${mainChannel.score.toFixed(2)}, Match: ${(mainChannel.matchRatio * 100).toFixed(1)}%)`,
                );

                for (let i = 1; i < candidateChannels.length; i++) {
                  const candidate = candidateChannels[i];

                  if (mainChannel.score - candidate.score > 0.6) continue;
                  if (candidate.matchRatio < 0.15) continue;

                  if (Math.abs(mainChannel.avgPitch - candidate.avgPitch) > 18)
                    continue;

                  let overlapCount = 0;
                  for (const n1 of candidate.notes) {
                    for (const n2 of mainChannel.notes) {
                      const n1End = n1.start + n1.length;
                      const n2End = n2.start + n2.length;
                      if (n1.start < n2End && n1End > n2.start) {
                        overlapCount++;
                        break;
                      }
                    }
                  }

                  const overlapRatio = overlapCount / candidate.notes.length;

                  if (overlapRatio < 0.2) {
                    logVerbose(
                      `🔗 Merging Channel ${candidate.index + 1} as split melody (Overlap: ${(overlapRatio * 100).toFixed(1)}%)`,
                    );
                    validChannels.push(candidate);
                  }
                }

                let combinedNotes = [];
                validChannels.forEach((c) => {
                  combinedNotes.push(...c.notes);
                });

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
                    if (n.midiNote > existing.pitch)
                      existing.pitch = n.midiNote;
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

                state.playback.guideNotes = monoNotes;

                state.playback.guideRange = {
                  min: Math.max(0, minPitch - 4),
                  max: Math.min(127, maxPitch + 4),
                };
              } else {
                logVerbose(
                  "⚠️ No clear vocal guide track found. Falling back to Key-Aware Scoring.",
                );
              }
            }
          }

          if (rawLyrics.length > 0) {
            const totalLength = rawLyrics.reduce(
              (acc, val) => acc + (val.data ? val.data.byteLength : 0),
              0,
            );
            const combinedBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const message of rawLyrics) {
              if (message.data) {
                combinedBuffer.set(message.data, offset);
                offset += message.data.byteLength;
              }
            }

            state.playback.lyricsEncoding = detectEncoding(combinedBuffer);
            const decoder = new TextDecoder(state.playback.lyricsEncoding);

            state.playback.decodedLyrics = rawLyrics
              .map((message) =>
                message.data ? decoder.decode(message.data) : "",
              )
              .map((text) => text.replace(/[\/\\]/g, "\n"))
              .filter((text) => {
                const clean = text.replace(/[\r\n\/\\]/g, "");
                return !clean.startsWith("@") && !clean.startsWith("#");
              });
          } else {
            state.playback.lyricsEncoding = "utf-8";
          }

          state.playback.buffer = null;
        } else {
          state.playback.buffer =
            await audioContext.decodeAudioData(arrayBuffer);
          if (state.playback.isMultiplexed) {
            startIncrementalGuideAnalysis(state.playback.buffer);
          }
        }

        state.playback.status = "stopped";
        state.playback.pauseTime = 0;
        logVerbose(`Track loaded: ${url}`);
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load track: ${url}`, e);
        return false;
      }
    },

    /**
     * Executes loaded node timelines beginning progression logic and sound routing.
     */
    playTrack: () => {
      if (audioContext.state === "suspended") audioContext.resume();

      if (state.recording.destinationNode) {
        state.recording.trackDelayNode = audioContext.createDelay();
        const recordingGain = audioContext.createGain();
        recordingGain.gain.value = state.effects.musicGainInRecording;
        state.recording.musicRecordingGainNode = recordingGain;
        state.recording.trackDelayNode.delayTime.value =
          state.scoring.measuredLatencyS;

        state.recording.trackDelayNode.connect(recordingGain);
        recordingGain.connect(state.recording.destinationNode);

        recordingGain.connect(state.recording.musicDestinationNode);
      }

      state.scoring.enabled = true;
      logVerbose("Track playback starting", {
        isMidi: state.playback.isMidi,
        isMultiplexed: state.playback.isMultiplexed,
        bufferDuration: state.playback.buffer?.duration,
      });
      Object.assign(state.scoring, {
        finalScore: 0,
        totalScorableNotes: 0,
        notesHit: 0,
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

      if (state.playback.isMidi) {
        if (!state.playback.sequencer || state.playback.status === "playing")
          return;

        if (state.recording.trackDelayNode && state.playback.midiGain) {
          state.playback.midiGain.connect(state.recording.trackDelayNode);
        }

        if (state.playback.guideNotes && state.playback.guideNotes.length > 0) {
          renderPianoRollNotes(state.playback.guideNotes);
          if (state.ui.pianoRollVisible && pianoRollContainer) {
            pianoRollContainer.classOn("visible");
          }
        } else {
          if (pianoRollContainer) pianoRollContainer.classOff("visible");
        }

        state.playback.sequencer.currentTime = 0;
        state.playback.sequencer.play();
        state.playback.status = "playing";
      } else {
        if (!state.playback.buffer || state.playback.status === "playing")
          return;
        sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = state.playback.buffer;
        sourceNode.playbackRate.value = Math.pow(
          2,
          state.playback.transpose / 12,
        );

        if (state.playback.guideNotes && state.playback.guideNotes.length > 0) {
          renderPianoRollNotes(state.playback.guideNotes);
          if (state.ui.pianoRollVisible) {
            pianoRollContainer.classOn("visible");
          }
        }

        if (state.playback.isMultiplexed) {
          const vocalGuideAnalyser = audioContext.createAnalyser();
          vocalGuideAnalyser.fftSize = 2048;
          state.scoring.vocalGuideAnalyser = vocalGuideAnalyser;
          const delayNode = audioContext.createDelay();
          delayNode.delayTime.value = state.scoring.measuredLatencyS;
          state.scoring.guideVocalDelayNode = delayNode;

          const splitter = audioContext.createChannelSplitter(2);
          const leftGain = audioContext.createGain();
          const rightGain = audioContext.createGain();
          const monoMixer = audioContext.createGain();
          state.playback.leftPannerGain = leftGain;
          state.playback.rightPannerGain = rightGain;

          sourceNode.connect(splitter);
          splitter.connect(leftGain, 0);
          splitter.connect(rightGain, 1);
          splitter.connect(delayNode, 1);
          delayNode.connect(vocalGuideAnalyser);
          leftGain.connect(monoMixer);
          rightGain.connect(monoMixer);
          monoMixer.connect(masterGain);

          if (state.recording.trackDelayNode) {
            splitter.connect(state.recording.trackDelayNode, 0);
          }
          pkg.data.setMultiplexPan(state.playback.multiplexPan);
        } else {
          sourceNode.connect(masterGain);
          sourceNode.connect(state.scoring.musicAnalyser);

          if (pianoRollContainer) pianoRollContainer.classOff("visible");
          if (state.recording.trackDelayNode) {
            sourceNode.connect(state.recording.trackDelayNode);
          }
        }

        sourceNode.onended = () => {
          if (state.playback.status === "playing") pkg.data.stopTrack();
        };
        sourceNode.start(0, state.playback.pauseTime);
        state.playback.startTime = audioContext.currentTime;
        state.playback.status = "playing";
      }

      if (
        !state.playback.isMidi &&
        !state.playback.isMultiplexed &&
        state.playback.buffer
      ) {
        if (typeof Meyda !== "undefined") {
          if (!state.scoring.meydaAnalyzer) {
            state.scoring.meydaAnalyzer = Meyda.createMeydaAnalyzer({
              audioContext: audioContext,
              source: state.scoring.musicAnalyser,
              bufferSize: 2048,
              featureExtractors: ["chroma"],
            });
          }
          state.scoring.meydaAnalyzer.start();
        } else {
          console.warn(
            "[FORTE SVC] Meyda is not defined. Key-aware scoring will not function.",
          );
        }
      }

      dispatchPlaybackUpdate();

      state.playback.lastFrameTime = performance.now();
      state.playback.smoothedTime = pkg.data.getPlaybackState().currentTime;

      if (animationFrameId === null) timingLoop();
    },

    /**
     * Briefly pauses track play preserving position counters and visual graphs.
     */
    pauseTrack: () => {
      if (state.playback.status !== "playing") return;

      state.scoring.enabled = false;
      if (pianoRollContainer) pianoRollContainer.classOff("visible");

      if (state.scoring.meydaAnalyzer) state.scoring.meydaAnalyzer.stop();

      if (state.recording.trackDelayNode) {
        state.recording.trackDelayNode.disconnect();
        if (state.playback.isMidi && state.playback.midiGain) {
          try {
            state.playback.midiGain.disconnect(state.recording.trackDelayNode);
          } catch (e) {}
        }
        state.recording.trackDelayNode = null;
      }

      if (state.playback.isMidi) {
        if (state.playback.sequencer) {
          try {
            state.playback.sequencer.pause();
          } catch (e) {}
        }
        state.playback.status = "paused";
      } else {
        if (!sourceNode) return;
        const rate = sourceNode.playbackRate.value;
        const elapsed = audioContext.currentTime - state.playback.startTime;
        state.playback.pauseTime += elapsed * rate;
        sourceNode.stop();
        state.playback.leftPannerGain = null;
        state.playback.rightPannerGain = null;
        state.playback.status = "paused";
        sourceNode = null;
      }

      logVerbose("Playback paused", pkg.data.getPlaybackState());
      dispatchPlaybackUpdate();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },

    /**
     * Ends track and resets active properties, wiping buffers and hiding tools.
     */
    stopTrack: () => {
      if (pianoRollContainer) pianoRollContainer.classOff("visible");

      if (state.playback.status === "stopped") return;
      state.playback.status = "stopped";

      if (state.scoring.meydaAnalyzer) state.scoring.meydaAnalyzer.stop();

      if (state.recording.trackDelayNode) {
        state.recording.trackDelayNode.disconnect();
        if (state.playback.isMidi && state.playback.midiGain) {
          try {
            state.playback.midiGain.disconnect(state.recording.trackDelayNode);
          } catch (e) {}
        }
        state.recording.trackDelayNode = null;
      }

      if (state.playback.isMidi) {
        if (state.playback.sequencer) {
          try {
            state.playback.sequencer.pause();
          } catch (e) {}
          try {
            state.playback.sequencer.currentTime = 0;
          } catch (e) {}
        }
      } else {
        if (sourceNode) {
          sourceNode.onended = null;
          sourceNode.stop();
          sourceNode = null;
        }
      }

      state.playback.leftPannerGain = null;
      state.playback.rightPannerGain = null;
      state.playback.multiplexPan = -1;
      state.playback.status = "stopped";
      state.playback.pauseTime = 0;
      logVerbose("Playback stopped", pkg.data.getPlaybackState());

      dispatchPlaybackUpdate();

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },

    /**
     * Adjusts the overall music tracking output level via compressor thresholding.
     *
     * @param {number} level - Gain volume factor from 0.0 to 1.0.
     */
    setTrackVolume: (level) => {
      if (!masterGain) return;
      const clampedLevel = Math.max(0, Math.min(1, level));
      masterGain.gain.setValueAtTime(clampedLevel, audioContext.currentTime);
      state.playback.volume = clampedLevel;
      updateSfxGain();
      logVerbose("Track volume set", clampedLevel);
    },

    /**
     * Sets the sound effects volume independently from main track volume.
     * The actual SFX output is the product of main volume and SFX volume.
     *
     * @param {number} level - SFX volume factor from 0.0 to 1.0.
     */
    setSfxVolume: (level) => {
      const clampedLevel = Math.max(0, Math.min(1, level));
      state.playback.sfxVolume = clampedLevel;
      updateSfxGain();
      logVerbose("SFX volume set", clampedLevel);
    },

    /**
     * Enables or disables verbose engine logging.
     *
     * @param {boolean} enabled - Whether verbose logs should be active.
     */
    setVerbose: (enabled) => {
      state.verbose = Boolean(enabled);
      if (state.verbose) {
        logVerbose("Verbose logging enabled");
      } else {
        console.log("[FORTE SVC] Verbose logging disabled.");
      }
    },

    /**
     * Controls individual gain levels filtering split multiplex nodes pushing output toward specific sides.
     *
     * @param {number} panValue - Number mapped from -1 (Left/Inst) to 1 (Right/Vocal).
     */
    setMultiplexPan: (panValue) => {
      const pan = Math.max(-1, Math.min(1, panValue));
      state.playback.multiplexPan = pan;
      const { leftPannerGain, rightPannerGain } = state.playback;
      if (leftPannerGain && rightPannerGain) {
        leftPannerGain.gain.setValueAtTime(
          (1 - pan) / 2,
          audioContext.currentTime,
        );
        rightPannerGain.gain.setValueAtTime(
          (1 + pan) / 2,
          audioContext.currentTime,
        );
      }
      dispatchPlaybackUpdate();
    },

    /**
     * Alters structural playback properties scaling raw audio streams up and down or stepping SpessaSynth MIDI pitch.
     *
     * @param {number} semitones - Increment specifying half-step directionations.
     */
    setTranspose: (semitones) => {
      const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
      if (
        !state.playback.isMidi &&
        state.playback.status === "playing" &&
        sourceNode
      ) {
        const rate = sourceNode.playbackRate.value;
        const elapsed = audioContext.currentTime - state.playback.startTime;
        state.playback.pauseTime += elapsed * rate;
        state.playback.startTime = audioContext.currentTime;
      }
      state.playback.transpose = clamped;
      if (state.playback.isMidi && state.playback.synthesizer) {
        state.playback.synthesizer.setMasterParameter("transposition", clamped);
      } else if (!state.playback.isMidi && sourceNode) {
        sourceNode.playbackRate.setValueAtTime(
          Math.pow(2, clamped / 12),
          audioContext.currentTime,
        );
      }
      dispatchPlaybackUpdate();
    },

    /**
     * Changes the drum kit preset on a specific channel
     * @param {number} channelNumber - The MIDI channel (0-15)
     * @param {Object} drumPreset - The drum preset object with structure:
     *   { program: number, bankMSB: number, bankLSB: number, name: string, isAnyDrums: boolean }
     * @returns {boolean} Success indicator
     */
    switchDrumPreset: (channelNumber, drumPreset) => {
      if (!state.playback.synthesizer) {
        console.error("[FORTE SVC] Synthesizer not initialized");
        return false;
      }

      if (channelNumber < 0 || channelNumber > 15) {
        console.error("[FORTE SVC] Invalid channel number:", channelNumber);
        return false;
      }

      try {
        logVerbose(`Switching drum preset on channel ${channelNumber + 1}`, {
          preset: drumPreset.name,
          program: drumPreset.program,
          bankMSB: drumPreset.bankMSB,
          bankLSB: drumPreset.bankLSB,
        });

        state.playback.synthesizer.lockController(
          channelNumber,
          0xffffffff, // ALL_CHANNELS_OR_DIFFERENT_ACTION constant
          false,
        );

        if (!drumPreset.isGMGSDrum) {
          state.playback.synthesizer.controllerChange(
            channelNumber,
            0, // CC#0 = Bank Select MSB
            drumPreset.bankMSB,
          );
          state.playback.synthesizer.controllerChange(
            channelNumber,
            32, // CC#32 = Bank Select LSB
            drumPreset.bankLSB,
          );
        }

        state.playback.synthesizer.programChange(
          channelNumber,
          drumPreset.program,
        );

        state.playback.synthesizer.lockController(
          channelNumber,
          0xffffffff,
          true,
        );

        logVerbose(
          `Drum preset switched successfully on channel ${channelNumber + 1}`,
        );
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        console.error(
          `[FORTE SVC] Failed to switch drum preset on channel ${channelNumber}:`,
          e,
        );
        return false;
      }
    },

    /**
     * Gets available drum presets from the loaded SoundFont
     * @returns {Array<Object>} Array of drum preset objects
     */
    getAvailableDrumPresets: () => {
      if (!state.playback.synthesizer) {
        console.error("[FORTE SVC] Synthesizer not initialized");
        return [];
      }

      try {
        const presetList = state.playback.synthesizer.presetList || [];
        return presetList.filter((p) => p.isAnyDrums || p.isGMGSDrum);
      } catch (e) {
        console.error("[FORTE SVC] Failed to get drum presets:", e);
        return [];
      }
    },

    /**
     * Gets the current drum preset on a specific channel
     * @param {number} channelNumber - The MIDI channel (0-15)
     * @returns {Object|null} Current drum preset or null if not available
     */
    getCurrentDrumPreset: (channelNumber) => {
      if (!state.playback.synthesizer) return null;

      try {
        const channel =
          state.playback.synthesizer.channelProperties[channelNumber];
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
    },

    /**
     * Gets the active scoring metrics.
     *
     * @returns {Object} Accuracy mapping metrics.
     */
    getScoringState: () => {
      return {
        finalScore: state.scoring.finalScore,
        details: state.scoring.details,
      };
    },

    /**
     * Assembles all metadata properties currently framing active media tracks output.
     *
     * @returns {Object} Representation of engine time properties and statuses.
     */
    getPlaybackState: () => {
      let duration = 0;
      let currentTime = 0;

      if (state.playback.isMidi && state.playback.sequencer) {
        duration = state.playback.sequencer.duration || 0;
        currentTime = state.playback.sequencer.currentTime || 0;
      } else if (state.playback.buffer) {
        duration = state.playback.buffer.duration;
        if (state.playback.status === "playing" && sourceNode) {
          const rate = sourceNode.playbackRate.value;
          const elapsed = audioContext.currentTime - state.playback.startTime;
          currentTime = state.playback.pauseTime + elapsed * rate;
        } else {
          currentTime = state.playback.pauseTime;
        }
      }

      return {
        status: state.playback.status,
        currentTime: Math.min(currentTime, duration),
        duration,
        currentDeviceId: state.playback.currentDeviceId,
        isMidi: state.playback.isMidi,
        isMultiplexed: state.playback.isMultiplexed,
        hasGuideNotes:
          state.playback.guideNotes && state.playback.guideNotes.length > 0,
        decodedLyrics: state.playback.decodedLyrics,
        midiInfo: state.playback.midiInfo,
        transpose: state.playback.transpose,
        multiplexPan: state.playback.multiplexPan,
        score: pkg.data.getScoringState(),
      };
    },

    /**
     * Warms up backend components initializing mic arrays logic scopes.
     */
    initializeScoringEngine: async () => {
      if (!audioContext) return;
      logVerbose("Initializing Scoring Engine...");
      await pkg.data.getMicDevices();
      await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
    },

    /**
     * Operates automatic testing routines determining signal round trips between system nodes calibrating offsets.
     *
     * @returns {Promise<number>} Averaged latency delay in seconds.
     */
    runLatencyTest: async () => {
      if (
        !audioContext ||
        !state.scoring.micAnalyser ||
        !state.scoring.pitchDetector
      ) {
        throw new Error("Audio context or mic not ready.");
      }
      logVerbose("Starting latency calibration...");

      const NTESTS = 8;
      const TEST_INTERVAL_S = 0.5;
      const TEST_TONE_DURATION_S = 0.1;
      const TEST_FREQ_HZ = 880.0;
      const TEST_PITCH_MIDI = 81;
      const WARMUP_S = 1.0;
      const TIMEOUT_S = WARMUP_S + NTESTS * TEST_INTERVAL_S + 2.0;

      const analyser = state.scoring.micAnalyser;
      const pitchDetector = state.scoring.pitchDetector;
      const buffer = new Float32Array(analyser.fftSize);
      let animationFrameId;

      const testPromise = new Promise((resolve, reject) => {
        let latencies = [];
        let detectedBeeps = new Set();

        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.frequency.value = TEST_FREQ_HZ;
        gain.gain.value = 0;
        osc.connect(gain).connect(masterGain);
        osc.start();

        const baseTime = audioContext.currentTime + WARMUP_S;
        for (let i = 0; i < NTESTS; i++) {
          const t = baseTime + i * TEST_INTERVAL_S;
          gain.gain.setValueAtTime(1.0, t);
          gain.gain.setValueAtTime(0, t + TEST_TONE_DURATION_S);
        }

        const listenLoop = () => {
          if (
            audioContext.currentTime >
            baseTime + NTESTS * TEST_INTERVAL_S + 1.0
          )
            return;

          analyser.getFloatTimeDomainData(buffer);
          const [pitch, clarity] = pitchDetector.findPitch(
            buffer,
            audioContext.sampleRate,
          );
          const detectedMidi = 12 * Math.log2(pitch / 440) + 69;

          if (clarity > 0.9 && Math.abs(detectedMidi - TEST_PITCH_MIDI) < 1.0) {
            const inputTime = audioContext.currentTime;
            const timeSinceBase = inputTime - baseTime;
            const idx = Math.floor(timeSinceBase / TEST_INTERVAL_S);

            if (idx >= 0 && idx < NTESTS && !detectedBeeps.has(idx)) {
              const scheduledTime = baseTime + idx * TEST_INTERVAL_S;
              const latency = inputTime - scheduledTime;
              if (latency > 0.01 && latency < 0.5) {
                latencies.push(latency);
                detectedBeeps.add(idx);
              }
            }
          }
          animationFrameId = requestAnimationFrame(listenLoop);
        };
        animationFrameId = requestAnimationFrame(listenLoop);

        setTimeout(() => {
          cancelAnimationFrame(animationFrameId);
          osc.stop();
          gain.disconnect();
          osc.disconnect();

          if (latencies.length < NTESTS / 2) {
            reject(new Error("Calibration failed: Signal too weak."));
            return;
          }
          const mean = latencies.reduce((a, b) => a + b) / latencies.length;
          const std = Math.sqrt(
            latencies
              .map((x) => Math.pow(x - mean, 2))
              .reduce((a, b) => a + b) / latencies.length,
          );

          if (std > 0.05) {
            reject(new Error("Calibration failed: High variance."));
            return;
          }
          state.scoring.measuredLatencyS = mean;
          resolve(mean);
        }, TIMEOUT_S * 1000);
      });
      return await testPromise;
    },

    /**
     * Force overwrites the mic delay.
     *
     * @param {number} latencySeconds - Decimal value fixing input buffers.
     */
    setLatency: (latencySeconds) => {
      if (typeof latencySeconds !== "number" || isNaN(latencySeconds)) return;
      state.scoring.measuredLatencyS = Math.max(0, Math.min(1, latencySeconds));
    },

    /**
     * Enumerates local peripheral input targets listing hardware.
     *
     * @returns {Promise<Array<{label: string, deviceId: string}>>} List representing mic devices.
     */
    getMicDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.scoring.micDevices = devices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ label: d.label, deviceId: d.deviceId }));
        return state.scoring.micDevices;
      } catch (e) {
        return [];
      }
    },

    /**
     * Shifts engine input recording mapping to the chosen microphone device hardware.
     *
     * @param {string} deviceId - Local device token.
     */
    setMicDevice: async (deviceId) => {
      await pkg.data.startMicInput(deviceId);
      state.scoring.currentMicDeviceId = deviceId;
    },

    /**
     * Switches capturing capability enabling system parsing.
     *
     * @param {boolean} enabled - Flag mapping function.
     */
    setMicInputEnabled: async (enabled) => {
      state.scoring.userInputEnabled = enabled;
      if (enabled) {
        await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
      } else {
        pkg.data.stopMicInput();
      }
    },

    /**
     * Disconnects nodes cutting streams directly from microphones terminating buffers.
     */
    stopMicInput: () => {
      logVerbose("Stopping microphone input");
      if (state.scoring.micStream) {
        state.scoring.micStream.getTracks().forEach((track) => track.stop());
        state.scoring.micStream = null;
      }
      if (state.scoring.micSourceNode) {
        try {
          state.scoring.micSourceNode.disconnect();
        } catch (e) {}
        state.scoring.micSourceNode = null;
      }
      if (state.scoring.micHighpassNode) {
        try {
          state.scoring.micHighpassNode.disconnect();
        } catch (e) {}
        state.scoring.micHighpassNode = null;
      }
      if (state.scoring.micLowpassNode) {
        try {
          state.scoring.micLowpassNode.disconnect();
        } catch (e) {}
        state.scoring.micLowpassNode = null;
      }
      if (state.scoring.micAnalyser) {
        try {
          state.scoring.micLowpassNode.disconnect(state.scoring.micAnalyser);
        } catch (e) {}
        state.scoring.micAnalyser = null;
      }
      state.scoring.enabled = false;
      console.log(
        "[FORTE SVC] Microphone input stopped (Performance/User req).",
      );
    },

    /**
     * Resolves promises establishing physical microphone feeds creating analyzer pipelines.
     *
     * @param {string} [deviceId="default"] - Selection criteria.
     */
    startMicInput: async (deviceId = "default") => {
      pkg.data.stopMicInput();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

        state.scoring.micStream = stream;
        const source = audioContext.createMediaStreamSource(stream);

        // For recording
        source.connect(state.effects.micChainInput);

        // Score processing
        const hpFilter = audioContext.createBiquadFilter();
        hpFilter.type = "highpass";
        hpFilter.frequency.value = 85;

        const lpFilter = audioContext.createBiquadFilter();
        lpFilter.type = "lowpass";
        lpFilter.frequency.value = 2000;

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        source.connect(hpFilter);
        hpFilter.connect(lpFilter);
        lpFilter.connect(analyser);

        state.scoring.micSourceNode = source;
        state.scoring.micHighpassNode = hpFilter;
        state.scoring.micLowpassNode = lpFilter;
        state.scoring.micAnalyser = analyser;

        if (!state.scoring.pitchDetector) {
          state.scoring.pitchDetector = PitchDetector.forFloat32Array(
            analyser.fftSize,
          );
        }
        state.scoring.enabled = true;
        logVerbose("Microphone input started with isolated scoring filters", {
          deviceId: deviceId,
        });
      } catch (e) {
        console.error("[FORTE SVC] Failed to get microphone input:", e);
      }
    },

    /**
     * Assembles audio worklets applying effects dynamically generating chains.
     *
     * @param {Array<Object>} chainConfig - Mapped representations configuring instances.
     */
    loadVocalChain: async (chainConfig) => {
      state.effects.vocalChainConfig = JSON.parse(JSON.stringify(chainConfig));
      state.effects.vocalChain.forEach((plugin) => plugin.disconnect());
      state.effects.vocalChain = [];

      for (let i = 0; i < chainConfig.length; i++) {
        const pluginConfig = chainConfig[i];
        try {
          logVerbose("Loading plugin configuration", pluginConfig);
          const pluginModule = await import(pluginConfig.path);
          const PluginClass = pluginModule.default;
          let pluginInstance;

          if (typeof PluginClass.create === "function") {
            pluginInstance = await PluginClass.create(audioContext);
          } else {
            pluginInstance = new PluginClass(audioContext);
          }

          if (pluginConfig.params) {
            for (const [key, value] of Object.entries(pluginConfig.params)) {
              pluginInstance.setParameter(key, value);
            }
          }

          const originalSetParameter = pluginInstance.setParameter;
          if (typeof originalSetParameter === "function") {
            pluginInstance.setParameter = function (paramName, value) {
              originalSetParameter.call(this, paramName, value);

              if (state.effects.vocalChainConfig[i]) {
                if (!state.effects.vocalChainConfig[i].params) {
                  state.effects.vocalChainConfig[i].params = {};
                }
                state.effects.vocalChainConfig[i].params[paramName] = value;

                if (saveVocalChainTimeout) clearTimeout(saveVocalChainTimeout);
                saveVocalChainTimeout = setTimeout(() => {
                  if (
                    window.config &&
                    typeof window.config.setItem === "function"
                  ) {
                    window.config.setItem(
                      "audioConfig.vocalChain",
                      state.effects.vocalChainConfig,
                    );
                    logVerbose("Saved updated vocal chain config to disk.");
                  }
                }, 300);
              }
            };
          }

          state.effects.vocalChain.push(pluginInstance);
        } catch (e) {
          console.error(`[FORTE SVC] Failed to load plugin.`, e);
        }
      }
      pkg.data.rebuildVocalChain();
    },

    /**
     * Bridges disparate nodes constructing one coherent graph modifying stream components.
     */
    rebuildVocalChain: () => {
      logVerbose("Rebuilding vocal chain", {
        chainLength: state.effects.vocalChain.length,
      });
      const { micChainInput, micChainOutput, vocalChain } = state.effects;
      micChainInput.disconnect();

      let lastNode = micChainInput;
      if (vocalChain.length > 0) {
        vocalChain.forEach((plugin) => {
          lastNode.connect(plugin.input);
          lastNode = plugin.output;
        });
      }
      lastNode.connect(micChainOutput);
    },

    /**
     * Shifts state modifying loaded node specific internal parameter objects.
     *
     * @param {number} pluginIndex - Array location index.
     * @param {string} paramName - Field property designation string.
     * @param {number} value - Floating target logic adjusting module specific traits.
     */

    setPluginParameter: (pluginIndex, paramName, value) => {
      const plugin = state.effects.vocalChain[pluginIndex];
      if (plugin) plugin.setParameter(paramName, value);
    },

    /**
     * Target shifting level affecting final recorded volume outputs of microphones.
     *
     * @param {number} level - Target mapping gain values from 0 to 2.
     */
    setMicRecordingVolume: (level) => {
      const clamped = Math.max(0, Math.min(2, level));
      state.effects.micGainInRecording = clamped;
      if (state.effects.micChainOutput) {
        state.effects.micChainOutput.gain.setTargetAtTime(
          clamped,
          audioContext.currentTime,
          0.01,
        );
      }

      if (saveVolumesTimeout) clearTimeout(saveVolumesTimeout);
      saveVolumesTimeout = setTimeout(() => {
        if (window.config && typeof window.config.setItem === "function") {
          window.config.setItem("audioConfig.micRecordingVolume", clamped);
          logVerbose("Saved mic recording volume to disk.");
        }
      }, 300);
    },

    /**
     * Target shifting level affecting final recorded volume outputs of background tracks.
     *
     * @param {number} level - Target mapping gain values from 0 to 1.
     */
    setMusicRecordingVolume: (level) => {
      const clamped = Math.max(0, Math.min(1, level));
      state.effects.musicGainInRecording = clamped;
      if (state.recording.musicRecordingGainNode) {
        state.recording.musicRecordingGainNode.gain.setTargetAtTime(
          clamped,
          audioContext.currentTime,
          0.01,
        );
      }

      if (saveVolumesTimeout) clearTimeout(saveVolumesTimeout);
      saveVolumesTimeout = setTimeout(() => {
        if (window.config && typeof window.config.setItem === "function") {
          window.config.setItem("audioConfig.musicRecordingVolume", clamped);
          logVerbose("Saved music recording volume to disk.");
        }
      }, 300);
    },

    /**
     * Compiles properties describing effect logic status across chains currently operating.
     *
     * @returns {Object} Data schema reflecting internal values across loaded objects.
     */
    getVocalChainState: () => {
      const chainState = state.effects.vocalChain.map((plugin, i) => ({
        name: plugin.name,
        path: state.effects.vocalChainConfig[i]?.path,
        parameters: plugin.parameters,
        instance: plugin,
      }));
      return {
        micGain: state.effects.micGainInRecording,
        musicGain: state.effects.musicGainInRecording,
        chain: chainState,
        rawConfig: state.effects.vocalChainConfig || [],
      };
    },
  },

  /**
   * Disconnects nodes ensuring all resources map closed exiting contexts appropriately.
   */
  end: async function () {
    console.log("[FORTE SVC] Shutting down.");

    if (pianoRollContainer) pianoRollContainer.cleanup();

    if (state.scoring.micStream) {
      state.scoring.micStream.getTracks().forEach((track) => track.stop());
    }

    if (audioContext && audioContext.state !== "closed") {
      if (state.effects.micChainInput) state.effects.micChainInput.disconnect();
      if (state.effects.micChainOutput)
        state.effects.micChainOutput.disconnect();
      state.effects.vocalChain.forEach((p) => p.disconnect());
      if (masterCompressor) masterCompressor.disconnect();
      if (state.recording.destinationNode)
        state.recording.destinationNode.disconnect();
      audioContext.close();
    }

    sfxCache.clear();

    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (state.playback.synthesizer) {
      state.playback.synthesizer.disconnect();
      state.playback.synthesizer = null;
    }
  },
};

export default pkg;
