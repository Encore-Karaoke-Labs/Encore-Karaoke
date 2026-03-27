// --- START OF FILE Forte.js ---

// Forte Sound Engine for Encore Karaoke
import {
  Synthetizer,
  Sequencer,
} from "https://cdn.jsdelivr.net/npm/spessasynth_lib@3.27.8/+esm";
import Html from "/libs/html.js";
import { PitchDetector } from "https://cdn.jsdelivr.net/npm/pitchy@4.1.0/+esm";

// --- Helper Functions ---

function dispatchPlaybackUpdate() {
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.Update", {
      detail: pkg.data.getPlaybackState(),
    }),
  );
}

function detectEncoding(uint8Array) {
  const encodings = [
    "utf-8",
    "shift-jis",
    "euc-kr",
    "windows-1250",
    "windows-1252",
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

// --- Music Theory / Key Detection Constants ---
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

// Temperley Profiles: Significantly better at resolving dominant (Fifth) confusion than K-S
const MAJOR_PROFILE = [
  5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0,
];
const MINOR_PROFILE = [
  5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0,
];

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

// --- Global Variables & Constants ---

let root;
let audioContext;
let masterGain;
let masterCompressor;
let sourceNode = null;
let animationFrameId = null;
let sfxGain;
const sfxCache = new Map();

let toastElement = null;
let toastStyleElement = null;
let toastTimeout = null;

let pianoRollContainer = null;
let pianoRollTrack = null;
let pianoRollPlayhead = null;
let pianoRollUserPitch = null;
let lastHitNoteElement = null;
let scoreReasonDisplay = null;
let scoreReasonTimeout = null;
const PIXELS_PER_SECOND = 150;

// --- Scoring Thresholds ---
const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIC_CLARITY_THRESHOLD = 0.7;
const RMS_NOISE_GATE = 0.005;

// Strict thresholds for Key-Aware scoring to combat Speaker Bleed
const KEY_AWARE_RMS_GATE = 0.035;
const KEY_AWARE_CLARITY = 0.85;
const MIN_FRAMES_FOR_FULL_SCORE = 900;

let guideAnalyserBuffer = null;
let micAnalyserBuffer = null;

// --- State Management ---

const state = {
  scoring: {
    enabled: false,
    userInputEnabled: true,
    micStream: null,
    micSourceNode: null,
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

    // Key-Aware Additions
    musicAnalyser: null,
    meydaAnalyzer: null,
    totalFramesSinging: 0,
    framesInKey: 0,
    rollingChroma: new Array(12).fill(0),
    currentKeyName: null,
    allowedPitchClasses: [],
    candidateKeyName: null,
    candidateKeyCount: 0,
    frameCount: 0,
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
    smoothedTime: 0,
    lastFrameTime: 0,
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
    musicGainInRecording: 0.2,
  },
  ui: {
    pianoRollVisible: true,
  },
};

// --- Scoring Logic ---

function showScoreReason(text, type = "pitch") {
  if (scoreReasonTimeout) clearTimeout(scoreReasonTimeout);
  if (!state.ui.pianoRollVisible) return;
  scoreReasonDisplay
    .classOff("type-pitch", "type-vibrato", "type-transition")
    .classOn(`type-${type}`)
    .text(text)
    .classOn("visible");

  scoreReasonTimeout = setTimeout(() => {
    scoreReasonDisplay.classOff("visible");
  }, 1200);
}

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

  let sumSquares = 0;
  for (let i = 0; i < micAnalyserBuffer.length; i++) {
    sumSquares += micAnalyserBuffer[i] * micAnalyserBuffer[i];
  }
  const rms = Math.sqrt(sumSquares / micAnalyserBuffer.length);

  const isSinging =
    micClarity > MIC_CLARITY_THRESHOLD && micPitch > 50 && rms > RMS_NOISE_GATE;
  let midiMicPitch = isSinging ? 12 * Math.log2(micPitch / 440) + 69 : 0;

  const isKeyAwareSinging =
    micClarity > KEY_AWARE_CLARITY && micPitch > 50 && rms > KEY_AWARE_RMS_GATE;
  let keyAwareMidiPitch = isKeyAwareSinging
    ? 12 * Math.log2(micPitch / 440) + 69
    : 0;

  if (state.playback.isMultiplexed && state.scoring.vocalGuideAnalyser) {
    // MULTIPLEX SCORING
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

    const isGuideNoteActive =
      guideClarity >= GUIDE_CLARITY_THRESHOLD && guidePitch > 50;
    const wasGuideNoteActive = state.scoring.isVocalGuideNoteActive;
    state.scoring.isVocalGuideNoteActive = isGuideNoteActive;

    if (isGuideNoteActive && !wasGuideNoteActive) {
      state.scoring.totalScorableNotes++;
      state.scoring.hasHitCurrentNote = false;
    }

    let isCorrectPitch = false;
    if (isGuideNoteActive && isSinging) {
      let normalizedMicPitch = micPitch;
      while (normalizedMicPitch < guidePitch * 0.75) normalizedMicPitch *= 2;
      while (normalizedMicPitch > guidePitch * 1.5) normalizedMicPitch /= 2;

      const centsDifference = 1200 * Math.log2(normalizedMicPitch / guidePitch);
      if (Math.abs(centsDifference) < 100) isCorrectPitch = true;
    }

    if (isCorrectPitch && !state.scoring.hasHitCurrentNote) {
      state.scoring.hasHitCurrentNote = true;
      state.scoring.notesHit++;
      showScoreReason("PERFECT", "pitch");

      if (
        pianoRollContainer &&
        pianoRollContainer.elm.classList.contains("visible")
      ) {
        const notes = state.playback.guideNotes;
        if (notes) {
          if (
            lastHitNoteElement &&
            lastHitNoteElement.elm.classList.contains("hit")
          ) {
            lastHitNoteElement.classOff("hit");
          }
          const currentNote = notes.find(
            (n) =>
              currentTime >= n.startTime &&
              currentTime < n.startTime + n.duration,
          );
          if (currentNote) {
            const noteEl = pianoRollTrack.qs(`#forte-note-${currentNote.id}`);
            if (noteEl) {
              noteEl.classOn("hit");
              lastHitNoteElement = noteEl;
            }
          }
        }
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
    // KEY-AWARE SCORING
    if (state.scoring.meydaAnalyzer && typeof Meyda !== "undefined") {
      state.scoring.frameCount++;

      if (state.scoring.frameCount % 3 === 0) {
        const features = state.scoring.meydaAnalyzer.get("chroma");
        if (features) {
          for (let i = 0; i < 12; i++) {
            // Increased smoothing weight (0.95 vs 0.90) to create a deeper memory of the tonal center
            state.scoring.rollingChroma[i] =
              state.scoring.rollingChroma[i] * 0.95 + features[i] * 0.05;
          }

          if (state.scoring.frameCount % 60 === 0) {
            const detected = detectMusicalKey(state.scoring.rollingChroma);

            if (detected.correlation > 0.4) {
              if (!state.scoring.currentKeyName) {
                state.scoring.currentKeyName = detected.name;
                const root = detected.root;
                const intervals =
                  detected.mode === "Major"
                    ? [0, 2, 4, 5, 7, 9, 11]
                    : [0, 2, 3, 5, 7, 8, 10];
                state.scoring.allowedPitchClasses = intervals.map(
                  (interval) => (root + interval) % 12,
                );
                console.log(
                  `[FORTE SVC] 🎵 Initial Key Detected: ${detected.name} (Correlation: ${detected.correlation.toFixed(2)})`,
                );
              } else if (detected.name !== state.scoring.currentKeyName) {
                if (detected.name === state.scoring.candidateKeyName) {
                  state.scoring.candidateKeyCount++;
                  // Increased to 5 seconds (5 checks) to absolutely guarantee it's a real modulation
                  if (state.scoring.candidateKeyCount >= 5) {
                    state.scoring.currentKeyName = detected.name;
                    const root = detected.root;
                    const intervals =
                      detected.mode === "Major"
                        ? [0, 2, 4, 5, 7, 9, 11]
                        : [0, 2, 3, 5, 7, 8, 10];
                    state.scoring.allowedPitchClasses = intervals.map(
                      (interval) => (root + interval) % 12,
                    );
                    state.scoring.candidateKeyCount = 0;
                    console.log(
                      `[FORTE SVC] 🎵 Key Modulation Confirmed: ${detected.name} (Correlation: ${detected.correlation.toFixed(2)})`,
                    );
                  }
                } else {
                  state.scoring.candidateKeyName = detected.name;
                  state.scoring.candidateKeyCount = 1;
                }
              } else {
                state.scoring.candidateKeyName = null;
                state.scoring.candidateKeyCount = 0;
              }
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
  }

  // 4. Update Piano Roll User Pitch Visual
  if (
    pianoRollContainer &&
    pianoRollContainer.elm.classList.contains("visible")
  ) {
    const pitchToY = (pitch) => {
      const minMidi = 48; // C3
      const maxMidi = 84; // C6
      const rollHeight = 150;
      if (pitch < minMidi) return rollHeight;
      if (pitch > maxMidi) return 0;
      return (
        rollHeight - ((pitch - minMidi) / (maxMidi - minMidi)) * rollHeight
      );
    };

    if (isSinging && midiMicPitch > 0) {
      pianoRollUserPitch.elm.style.top = `${pitchToY(midiMicPitch) - 2}px`;
      pianoRollUserPitch.elm.style.opacity = "1";
    } else {
      pianoRollUserPitch.elm.style.opacity = "0";
    }
  }
}

// --- Animation Loop ---

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
    pianoRollContainer.elm.classList.contains("visible") &&
    pianoRollTrack
  ) {
    pianoRollTrack.elm.style.transform = `translateX(-${
      currentTime * PIXELS_PER_SECOND
    }px)`;
  }

  if (state.scoring.enabled) {
    updateScore(currentTime);
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

  if (engineTime >= duration && duration > 0) {
    animationFrameId = null;
    return;
  }
  animationFrameId = requestAnimationFrame(timingLoop);
}

// --- Piano Roll Helpers ---

function renderPianoRollNotes(notes) {
  if (!pianoRollTrack) return;
  const fragment = document.createDocumentFragment();

  const pitchToY = (pitch) => {
    const minMidi = 48; // C3
    const maxMidi = 84; // C6
    const rollHeight = 150;
    if (pitch < minMidi) return rollHeight;
    if (pitch > maxMidi) return 0;
    const normalizedPitch = (pitch - minMidi) / (maxMidi - minMidi);
    return rollHeight - normalizedPitch * rollHeight;
  };

  for (const note of notes) {
    const div = document.createElement("div");
    div.className = "forte-piano-note";
    div.id = `forte-note-${note.id}`;
    div.style.left = `${note.startTime * PIXELS_PER_SECOND}px`;
    div.style.width = `${note.duration * PIXELS_PER_SECOND}px`;
    div.style.top = `${pitchToY(note.pitch)}px`;
    fragment.appendChild(div);
  }
  pianoRollTrack.elm.appendChild(fragment);
}

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
        pitch > 50 &&
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

        const noteEl = pianoRollTrack.qs(`#forte-note-${lastGlobalNote.id}`);
        if (noteEl)
          noteEl.elm.style.width = `${
            lastGlobalNote.duration * PIXELS_PER_SECOND
          }px`;
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
      console.log("[FORTE SVC] Incremental analysis complete.");
    }
  }

  setTimeout(processChunk, 16);
}

// --- Service Definition ---

const pkg = {
  name: "Forte Sound Engine Service",
  svcName: "ForteSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    console.log("Starting Forte Sound Engine Service for Encore.");
    root = Root;

    toastElement = new Html("div").classOn("forte-toast").appendTo("body");
    pianoRollContainer = new Html("div")
      .classOn("forte-piano-roll-container")
      .appendTo("body");
    pianoRollTrack = new Html("div")
      .classOn("forte-piano-roll-track")
      .appendTo(pianoRollContainer);
    pianoRollPlayhead = new Html("div")
      .classOn("forte-piano-roll-playhead")
      .appendTo(pianoRollContainer);
    pianoRollUserPitch = new Html("div")
      .classOn("forte-piano-roll-user-pitch")
      .appendTo(pianoRollContainer);
    scoreReasonDisplay = new Html("div")
      .classOn("forte-score-reason")
      .appendTo("body");

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 0.1,
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
      state.effects.micChainInput = audioContext.createGain();
      state.effects.micChainOutput = audioContext.createGain();
      state.effects.micChainInput.connect(state.effects.micChainOutput);
      state.effects.micChainOutput.connect(state.recording.destinationNode);

      state.playback.midiGain = audioContext.createGain();
      state.playback.midiGain.connect(masterGain);

      // Key-Aware Analyzers Setup
      state.scoring.musicAnalyser = audioContext.createAnalyser();
      state.scoring.musicAnalyser.fftSize = 2048;
      state.playback.midiGain.connect(state.scoring.musicAnalyser);

      console.log("[FORTE SVC] Audio pipelines initialized.");

      state.playback.currentDeviceId = audioContext.sinkId || "default";
      pkg.data.getPlaybackDevices();

      try {
        await audioContext.audioWorklet.addModule(
          "/libs/spessasynth_lib/synthetizer/worklet_processor.min.js",
        );
        const soundFontUrl = "/libs/soundfonts/SAM2695.sf2";
        const soundFontBuffer = await (await fetch(soundFontUrl)).arrayBuffer();

        state.playback.synthesizer = new Synthetizer(
          state.playback.midiGain,
          soundFontBuffer,
        );
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
    getRecordingAudioStream: () => {
      return state.recording.audioStream;
    },

    loadSfx: async (url) => {
      if (!audioContext) return false;
      if (sfxCache.has(url)) return true;
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        sfxCache.set(url, audioBuffer);
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load SFX: ${url}`, e);
        return false;
      }
    },

    playSfx: async (url) => {
      if (!audioContext) return;
      if (audioContext.state === "suspended") await audioContext.resume();

      let audioBuffer = sfxCache.get(url);
      if (!audioBuffer) {
        const success = await pkg.data.loadSfx(url);
        if (!success) return;
        audioBuffer = sfxCache.get(url);
      }

      if (audioBuffer) {
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(sfxGain);
        source.start(0);
      }
    },

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

    setPlaybackDevice: async (deviceId) => {
      if (!audioContext || typeof audioContext.setSinkId !== "function")
        return false;
      try {
        await audioContext.setSinkId(deviceId);
        state.playback.currentDeviceId = deviceId;
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        return false;
      }
    },

    togglePianoRollVisibility: async (bool) => {
      state.ui.pianoRollVisible = bool;
      if (bool) {
        if (pianoRollContainer) pianoRollContainer.classOn("visible");
        if (scoreReasonDisplay) scoreReasonDisplay.classOn("visible");
      } else {
        if (pianoRollContainer) pianoRollContainer.classOff("visible");
        if (scoreReasonDisplay) scoreReasonDisplay.classOff("visible");
      }
    },

    loadSoundFont: async (url) => {
      if (!audioContext) return false;

      if (state.playback.status !== "stopped") {
        pkg.data.stopTrack();
      }

      console.log(`[FORTE SVC] Swapping SoundFont with: ${url}`);

      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (state.playback.synthesizer) {
          state.playback.synthesizer = null;
        }

        state.playback.synthesizer = new Synthetizer(
          state.playback.midiGain,
          arrayBuffer,
        );

        if (state.playback.transpose !== 0) {
          state.playback.synthesizer.transpose(state.playback.transpose);
        }

        console.log(
          "[FORTE SVC] New SoundFont loaded and Synthesizer recreated.",
        );
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load custom SoundFont: ${url}`, e);
        return false;
      }
    },

    loadTrack: async (url) => {
      if (!audioContext) return false;
      if (state.playback.status !== "stopped") pkg.data.stopTrack();

      if (state.playback.sequencer) {
        state.playback.sequencer.stop();
        state.playback.sequencer = null;
      }
      state.playback.decodedLyrics = [];
      state.playback.lyricsEncoding = "utf-8";
      state.playback.transpose = 0;
      state.playback.isMultiplexed = false;
      state.playback.multiplexPan = -1;
      state.playback.guideNotes = [];
      state.playback.isAnalyzing = false;

      if (pianoRollContainer) pianoRollContainer.classOff("visible");
      if (pianoRollTrack) pianoRollTrack.clear();
      if (scoreReasonDisplay) {
        scoreReasonDisplay.classOff("visible");
        if (scoreReasonTimeout) clearTimeout(scoreReasonTimeout);
      }

      const isMidi =
        url.toLowerCase().endsWith(".mid") ||
        url.toLowerCase().endsWith(".midi") ||
        url.toLowerCase().endsWith(".kar");
      state.playback.isMidi = isMidi;

      if (!isMidi && url.toLowerCase().includes(".multiplexed.")) {
        state.playback.isMultiplexed = true;
      }

      if (toastElement) {
        toastElement.text(isMidi ? "Classic Karaoke" : "Real Sound");
      }

      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (isMidi) {
          if (!state.playback.synthesizer)
            throw new Error("MIDI Synthesizer not ready.");
          state.playback.sequencer = new Sequencer(
            [{ binary: arrayBuffer }],
            state.playback.synthesizer,
          );
          state.playback.sequencer.stop();
          state.playback.sequencer.loop = false;

          state.playback.sequencer.addOnSongEndedEvent(() => {
            if (state.playback.status !== "stopped") pkg.data.stopTrack();
          }, "forte-song-end");

          await new Promise((resolve) => {
            state.playback.sequencer.addOnSongChangeEvent(() => {
              const rawLyrics = state.playback.sequencer.midiData.lyrics;
              if (rawLyrics && rawLyrics.length > 0) {
                const totalLength = rawLyrics.reduce(
                  (acc, val) => acc + val.byteLength,
                  0,
                );
                const combinedBuffer = new Uint8Array(totalLength);
                let offset = 0;
                for (const buffer of rawLyrics) {
                  combinedBuffer.set(new Uint8Array(buffer), offset);
                  offset += buffer.byteLength;
                }

                state.playback.lyricsEncoding = detectEncoding(combinedBuffer);
                console.log(
                  `[FORTE SVC] Detected MIDI lyric encoding: ${state.playback.lyricsEncoding}`,
                );

                const decoder = new TextDecoder(state.playback.lyricsEncoding);

                state.playback.decodedLyrics = rawLyrics
                  .map((lyricBuffer) => decoder.decode(lyricBuffer))
                  .filter((text) => {
                    const clean = text.replace(/[\r\n\/\\]/g, "");
                    return !clean.startsWith("@");
                  });
              } else {
                state.playback.lyricsEncoding = "utf-8";
              }
              resolve();
            }, "forte-loader");
          });

          let displayableLyricIndex = 0;
          state.playback.sequencer.onTextEvent = (messageData, messageType) => {
            if (messageType === 5) {
              const text = new TextDecoder(
                state.playback.lyricsEncoding,
              ).decode(messageData.buffer);
              const cleanText = text.replace(/[\r\n\/\\]/g, "");
              if (cleanText && !cleanText.startsWith("@")) {
                document.dispatchEvent(
                  new CustomEvent("CherryTree.Forte.Playback.LyricEvent", {
                    detail: {
                      index: displayableLyricIndex,
                      text: cleanText,
                    },
                  }),
                );
                displayableLyricIndex++;
              }
            }
          };
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
        console.log(`[FORTE SVC] Track loaded: ${url}`);
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load track: ${url}`, e);
        return false;
      }
    },

    playTrack: () => {
      if (audioContext.state === "suspended") audioContext.resume();

      if (state.recording.destinationNode) {
        state.recording.trackDelayNode = audioContext.createDelay();
        const recordingGain = audioContext.createGain();
        recordingGain.gain.value = state.effects.musicGainInRecording;
        state.recording.musicRecordingGainNode = recordingGain;
        state.recording.trackDelayNode.delayTime.value =
          state.scoring.measuredLatencyS;
        state.recording.trackDelayNode
          .connect(recordingGain)
          .connect(state.recording.destinationNode);
      }

      state.scoring.enabled = true;
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
        candidateKeyName: null,
        candidateKeyCount: 0,
        frameCount: 0,
        details: { accuracy: 0 },
      });

      if (state.playback.isMidi) {
        if (!state.playback.sequencer || state.playback.status === "playing")
          return;

        if (state.recording.trackDelayNode && state.playback.midiGain) {
          state.playback.midiGain.connect(state.recording.trackDelayNode);
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

        if (state.playback.isMultiplexed) {
          if (state.playback.guideNotes) {
            pianoRollTrack.clear();
            renderPianoRollNotes(state.playback.guideNotes);
            if (state.ui.pianoRollVisible)
              pianoRollContainer.classOn("visible");
          }

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
          if (scoreReasonDisplay) {
            scoreReasonDisplay.classOff("visible");
            if (scoreReasonTimeout) clearTimeout(scoreReasonTimeout);
          }
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
        state.playback.isMidi ||
        (!state.playback.isMultiplexed && state.playback.buffer)
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
        state.playback.sequencer.pause();
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

      dispatchPlaybackUpdate();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },

    stopTrack: () => {
      if (toastElement) {
        if (toastTimeout) clearTimeout(toastTimeout);
        toastElement.classOff("visible");
      }

      if (pianoRollContainer) pianoRollContainer.classOff("visible");
      if (scoreReasonDisplay) {
        scoreReasonDisplay.classOff("visible");
        if (scoreReasonTimeout) clearTimeout(scoreReasonTimeout);
      }

      if (state.playback.status === "stopped") return;

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
        if (state.playback.sequencer) state.playback.sequencer.stop();
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

      dispatchPlaybackUpdate();

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },

    setTrackVolume: (level) => {
      if (!masterGain) return;
      const clampedLevel = Math.max(0, Math.min(1, level));
      masterGain.gain.setValueAtTime(clampedLevel, audioContext.currentTime);
      sfxGain.gain.setValueAtTime(clampedLevel, audioContext.currentTime);
      state.playback.volume = clampedLevel;
    },

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
        state.playback.synthesizer.transpose(clamped);
      } else if (!state.playback.isMidi && sourceNode) {
        sourceNode.playbackRate.setValueAtTime(
          Math.pow(2, clamped / 12),
          audioContext.currentTime,
        );
      }
      dispatchPlaybackUpdate();
    },

    getScoringState: () => {
      return {
        finalScore: state.scoring.finalScore,
        details: state.scoring.details,
      };
    },

    getPlaybackState: () => {
      let duration = 0;
      let currentTime = 0;

      if (state.playback.isMidi && state.playback.sequencer) {
        if (state.playback.sequencer.midiData) {
          duration = state.playback.sequencer.duration;
          currentTime = state.playback.sequencer.currentTime;
        }
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
        decodedLyrics: state.playback.decodedLyrics,
        transpose: state.playback.transpose,
        multiplexPan: state.playback.multiplexPan,
        score: pkg.data.getScoringState(),
      };
    },

    initializeScoringEngine: async () => {
      if (!audioContext) return;
      console.log("[FORTE SVC] Initializing Scoring Engine...");
      await pkg.data.getMicDevices();
      await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
    },

    runLatencyTest: async () => {
      if (
        !audioContext ||
        !state.scoring.micAnalyser ||
        !state.scoring.pitchDetector
      ) {
        throw new Error("Audio context or mic not ready.");
      }
      console.log("[FORTE SVC] Starting latency calibration...");

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

    setLatency: (latencySeconds) => {
      if (typeof latencySeconds !== "number" || isNaN(latencySeconds)) return;
      state.scoring.measuredLatencyS = Math.max(0, Math.min(1, latencySeconds));
    },

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

    setMicDevice: async (deviceId) => {
      await pkg.data.startMicInput(deviceId);
      state.scoring.currentMicDeviceId = deviceId;
    },

    setMicInputEnabled: async (enabled) => {
      state.scoring.userInputEnabled = enabled;
      if (enabled) {
        await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
      } else {
        pkg.data.stopMicInput();
      }
    },

    stopMicInput: () => {
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
      if (state.scoring.micAnalyser) {
        try {
          state.effects.micChainInput.disconnect(state.scoring.micAnalyser);
        } catch (e) {}
        state.scoring.micAnalyser = null;
      }
      state.scoring.enabled = false;
      console.log(
        "[FORTE SVC] Microphone input stopped (Performance/User req).",
      );
    },

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
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        source.connect(state.effects.micChainInput);
        state.effects.micChainInput.connect(analyser);

        state.scoring.micSourceNode = source;
        state.scoring.micAnalyser = analyser;

        if (!state.scoring.pitchDetector) {
          state.scoring.pitchDetector = PitchDetector.forFloat32Array(
            analyser.fftSize,
          );
        }
        state.scoring.enabled = true;
        console.log("[FORTE SVC] Microphone input started.");
      } catch (e) {
        console.error("[FORTE SVC] Failed to get microphone input:", e);
      }
    },

    loadVocalChain: async (chainConfig) => {
      state.effects.vocalChain.forEach((plugin) => plugin.disconnect());
      state.effects.vocalChain = [];

      for (const pluginConfig of chainConfig) {
        try {
          console.log(pluginConfig);
          console.log("[FORTE SVC] Loading plugin", pluginConfig.path);
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
          state.effects.vocalChain.push(pluginInstance);
        } catch (e) {
          console.error(`[FORTE SVC] Failed to load plugin.`, e);
        }
      }
      pkg.data.rebuildVocalChain();
    },

    rebuildVocalChain: () => {
      const { micChainInput, micChainOutput, vocalChain } = state.effects;
      micChainInput.disconnect();
      if (state.scoring.micAnalyser) {
        micChainInput.connect(state.scoring.micAnalyser); // Maintain scoring tap
      }

      let lastNode = micChainInput;
      if (vocalChain.length > 0) {
        vocalChain.forEach((plugin) => {
          lastNode.connect(plugin.input);
          lastNode = plugin.output;
        });
      }
      lastNode.connect(micChainOutput);
    },

    setPluginParameter: (pluginIndex, paramName, value) => {
      const plugin = state.effects.vocalChain[pluginIndex];
      if (plugin) plugin.setParameter(paramName, value);
    },

    setMicRecordingVolume: (level) => {
      const clamped = Math.max(0, Math.min(2, level));
      if (state.effects.micChainOutput) {
        state.effects.micChainOutput.gain.setTargetAtTime(
          clamped,
          audioContext.currentTime,
          0.01,
        );
      }
    },

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
    },

    getVocalChainState: () => {
      const chainState = state.effects.vocalChain.map((plugin) => ({
        name: plugin.name,
        parameters: plugin.parameters,
      }));
      return {
        micGain: state.effects.micChainOutput?.gain.value || 1.0,
        musicGain: state.effects.musicGainInRecording,
        chain: chainState,
      };
    },
  },

  end: async function () {
    console.log("[FORTE SVC] Shutting down.");

    if (toastElement) toastElement.cleanup();
    if (toastStyleElement) toastStyleElement.cleanup();
    if (pianoRollContainer) pianoRollContainer.cleanup();
    if (scoreReasonDisplay) scoreReasonDisplay.cleanup();

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
    if (state.playback.synthesizer) state.playback.synthesizer.close();
  },
};

export default pkg;
