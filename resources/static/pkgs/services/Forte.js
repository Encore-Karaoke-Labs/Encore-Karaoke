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

// --- Global Variables & Constants ---

// Core
let root;
let audioContext;
let masterGain;
let masterCompressor;
let sourceNode = null;
let animationFrameId = null;

// SFX
let sfxAudioContext;
let sfxGain;
const sfxCache = new Map();

// UI Elements
let toastElement = null;
let toastStyleElement = null;
let toastTimeout = null;

// Piano Roll UI
let pianoRollContainer = null;
let pianoRollTrack = null;
let pianoRollPlayhead = null;
let pianoRollUserPitch = null;
let lastHitNoteElement = null;
let scoreReasonDisplay = null;
let scoreReasonTimeout = null;
const PIXELS_PER_SECOND = 150; // Const for direct access

// Scoring Constants
const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIC_CLARITY_THRESHOLD = 0.85;
const PITCH_HISTORY_LENGTH = 60;
const VIBRATO_HOLD_DURATION_MS = 200;
const VIBRATO_STD_DEV_MIN = 0.4;
const VIBRATO_STD_DEV_MAX = 8.0;
const TRANSITION_ANALYSIS_WINDOW_MS = 100;

// Optimization: Scoring Throttle
let lastScoreTime = 0;
const SCORE_UPDATE_INTERVAL = 33; // ~30 FPS

// Reusable Buffers
let guideAnalyserBuffer = null;
let micAnalyserBuffer = null;

// --- State Management ---

const state = {
  scoring: {
    enabled: false,
    userInputEnabled: true, // Tracks user preference vs system override
    micStream: null,
    micSourceNode: null,
    micAnalyser: null,
    vocalGuideAnalyser: null,
    pitchDetector: null,
    guideVocalDelayNode: null,
    finalScore: 0,
    details: {
      pitchAndRhythm: 0,
      vibrato: 0,
      upband: 0,
      downband: 0,
    },
    measuredLatencyS: 0.15,
    totalScorableNotes: 0,
    notesHit: 0,
    vibratoOpportunities: 0,
    vibratoNotesHit: 0,
    upbandOpportunities: 0,
    upbandsHit: 0,
    downbandOpportunities: 0,
    downbandsHit: 0,
    lastGuidePitch: 0,
    hasScoredCurrentTransition: false,
    hasScoredCurrentNoteStyle: false,
    pitchHistory: [],
    isVocalGuideNoteActive: false,
    hasHitCurrentNote: false,
    isHoldingNote: false,
    noteHoldStartTime: 0,
    micDevices: [],
    currentMicDeviceId: "default",
  },
  playback: {
    status: "stopped",
    buffer: null,
    synthesizer: null,
    sequencer: null,
    isMidi: false,
    isMultiplexed: false,
    decodedLyrics: [],
    guideNotes: [],
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
  },
  recording: {
    destinationNode: null,
    audioStream: null,
    trackDelayNode: null,
    musicRecordingGainNode: null,
  },
  effects: {
    micChainInput: null, // Mic signal entry point
    micChainOutput: null, // Processed signal exit point
    vocalChain: [], // Active plugin instances
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

/**
 * Calculates a multi-faceted score based on pitch, rhythm, vibrato, and transitions.
 */
function updateScore() {
  if (
    !state.scoring.enabled ||
    !state.scoring.pitchDetector ||
    !state.scoring.vocalGuideAnalyser ||
    !state.scoring.micAnalyser
  ) {
    return;
  }

  // 1. Data Acquisition
  const {
    pitchDetector,
    vocalGuideAnalyser: guideAnalyser,
    micAnalyser,
  } = state.scoring;

  // Buffers are reused globally to save GC
  if (!guideAnalyserBuffer)
    guideAnalyserBuffer = new Float32Array(guideAnalyser.fftSize);
  if (!micAnalyserBuffer)
    micAnalyserBuffer = new Float32Array(micAnalyser.fftSize);

  guideAnalyser.getFloatTimeDomainData(guideAnalyserBuffer);
  micAnalyser.getFloatTimeDomainData(micAnalyserBuffer);

  const sampleRate = audioContext.sampleRate;
  const [guidePitch, guideClarity] = pitchDetector.findPitch(
    guideAnalyserBuffer,
    sampleRate,
  );
  const [micPitch, micClarity] = pitchDetector.findPitch(
    micAnalyserBuffer,
    sampleRate,
  );

  const now = performance.now();

  state.scoring.pitchHistory.push({
    pitch: micPitch,
    clarity: micClarity,
    time: now,
  });
  if (state.scoring.pitchHistory.length > PITCH_HISTORY_LENGTH)
    state.scoring.pitchHistory.shift();

  // 2. Guide Note State Machine
  const wasGuideNoteActive = state.scoring.isVocalGuideNoteActive;
  const isGuideNoteActive = guideClarity >= GUIDE_CLARITY_THRESHOLD;
  state.scoring.isVocalGuideNoteActive = isGuideNoteActive;

  // Rising Edge (Note Start)
  if (isGuideNoteActive && !wasGuideNoteActive) {
    state.scoring.totalScorableNotes++;
    state.scoring.hasHitCurrentNote = false;
    state.scoring.hasScoredCurrentTransition = false;
    state.scoring.hasScoredCurrentNoteStyle = false;

    // Transition Opportunity Detection
    if (state.scoring.lastGuidePitch > 0) {
      if (guidePitch > state.scoring.lastGuidePitch * 1.05) {
        state.scoring.upbandOpportunities++;
      } else if (guidePitch < state.scoring.lastGuidePitch * 0.95) {
        state.scoring.downbandOpportunities++;
      }
    }
  }

  // Falling Edge (Note End)
  if (!isGuideNoteActive && wasGuideNoteActive) {
    if (state.scoring.isHoldingNote) {
      const holdDuration = now - state.scoring.noteHoldStartTime;
      if (holdDuration > VIBRATO_HOLD_DURATION_MS) {
        state.scoring.vibratoOpportunities++;
      }
    }
    state.scoring.isHoldingNote = false;
    state.scoring.lastGuidePitch = guidePitch;
  }

  // 3. User Scoring & Style Analysis
  const isSinging = micClarity > MIC_CLARITY_THRESHOLD && micPitch > 50;
  let isCorrectPitch = false;
  if (isGuideNoteActive && isSinging) {
    let normalizedMicPitch = micPitch;
    // Octave normalization (Iterative multiplication is fast enough here)
    while (normalizedMicPitch < guidePitch * 0.75) normalizedMicPitch *= 2;
    while (normalizedMicPitch > guidePitch * 1.5) normalizedMicPitch /= 2;
    const centsDifference = 1200 * Math.log2(normalizedMicPitch / guidePitch);

    if (Math.abs(centsDifference) < 35) isCorrectPitch = true;
  }

  if (isCorrectPitch) {
    if (!state.scoring.isHoldingNote) {
      state.scoring.isHoldingNote = true;
      state.scoring.noteHoldStartTime = now;
    }
    if (!state.scoring.hasHitCurrentNote) {
      state.scoring.notesHit++;
      state.scoring.hasHitCurrentNote = true;
      if (!state.scoring.hasScoredCurrentNoteStyle) {
        showScoreReason("PERFECT", "pitch");
      }
    }

    // Transition Scoring
    if (
      !state.scoring.hasScoredCurrentTransition &&
      state.scoring.lastGuidePitch > 0
    ) {
      const analysisStartTime = now - TRANSITION_ANALYSIS_WINDOW_MS;
      // Optimizing filter/map: iterate once
      let startPitch = -1;
      let endPitch = -1;
      let count = 0;

      for (let i = 0; i < state.scoring.pitchHistory.length; i++) {
        const p = state.scoring.pitchHistory[i];
        if (p.time >= analysisStartTime && p.clarity > MIC_CLARITY_THRESHOLD) {
          if (startPitch === -1) startPitch = p.pitch;
          endPitch = p.pitch;
          count++;
        }
      }

      if (count > 5) {
        // Upband hit
        if (
          guidePitch > state.scoring.lastGuidePitch * 1.05 &&
          endPitch > startPitch
        ) {
          state.scoring.upbandsHit++;
          state.scoring.hasScoredCurrentTransition = true;
          state.scoring.hasScoredCurrentNoteStyle = true;
        }
        // Downband hit
        else if (
          guidePitch < state.scoring.lastGuidePitch * 0.95 &&
          endPitch < startPitch
        ) {
          state.scoring.downbandsHit++;
          state.scoring.hasScoredCurrentTransition = true;
          state.scoring.hasScoredCurrentNoteStyle = true;
        }
      }
    }

    // Vibrato Detection
    const holdDuration = now - state.scoring.noteHoldStartTime;
    if (holdDuration > VIBRATO_HOLD_DURATION_MS) {
      // Manual loop for performance instead of filter/map/reduce
      let sum = 0;
      let count = 0;
      const pitches = [];

      for (const p of state.scoring.pitchHistory) {
        if (p.clarity > MIC_CLARITY_THRESHOLD) {
          sum += p.pitch;
          pitches.push(p.pitch);
          count++;
        }
      }

      if (count > 10) {
        const mean = sum / count;
        let sqDiffSum = 0;
        for (const val of pitches) {
          sqDiffSum += (val - mean) ** 2;
        }
        const stdDev = Math.sqrt(sqDiffSum / count);

        if (stdDev >= VIBRATO_STD_DEV_MIN && stdDev <= VIBRATO_STD_DEV_MAX) {
          state.scoring.vibratoNotesHit++;
          state.scoring.vibratoOpportunities++;
          state.scoring.isHoldingNote = false;
          if (!state.scoring.hasScoredCurrentNoteStyle) {
            showScoreReason("VIBRATO!", "vibrato");
            state.scoring.hasScoredCurrentNoteStyle = true;
          }
        }
      }
    }
  } else {
    // Incorrect pitch
    if (state.scoring.isHoldingNote) {
      const holdDuration = now - state.scoring.noteHoldStartTime;
      if (holdDuration > VIBRATO_HOLD_DURATION_MS) {
        state.scoring.vibratoOpportunities++;
      }
    }
    state.scoring.isHoldingNote = false;
  }

  // 4. Update Piano Roll UI (User trace only)
  if (
    pianoRollContainer &&
    pianoRollContainer.elm.classList.contains("visible")
  ) {
    const pitchToY = (pitch) => {
      const minMidi = 48; // C3
      const maxMidi = 84; // C6
      const rollHeight = 150;
      // Inline simple checks
      if (pitch < minMidi) return rollHeight;
      if (pitch > maxMidi) return 0;
      return (
        rollHeight - ((pitch - minMidi) / (maxMidi - minMidi)) * rollHeight
      );
    };

    // User pitch trace
    const midiMicPitch = 12 * Math.log2(micPitch / 440) + 69;
    if (micClarity > MIC_CLARITY_THRESHOLD && midiMicPitch > 0) {
      // Direct DOM access prevents object creation overhead
      pianoRollUserPitch.elm.style.top = `${pitchToY(midiMicPitch) - 2}px`;
      pianoRollUserPitch.elm.style.opacity = "1";
    } else {
      pianoRollUserPitch.elm.style.opacity = "0";
    }

    // Note highlighting
    // Optimization: Don't search entire array every frame.
    // However, guideNotes array is usually small enough for find() to be okay.
    // To optimize further, one could keep an index of the "current note".
    const currentTime = pkg.data.getPlaybackState().currentTime;
    const notes = state.playback.guideNotes;

    if (notes) {
      if (lastHitNoteElement) {
        // Only modify DOM if class is present
        if (lastHitNoteElement.elm.classList.contains("hit")) {
          lastHitNoteElement.classOff("hit");
        }
        lastHitNoteElement = null;
      }

      const currentNote = notes.find(
        (n) =>
          currentTime >= n.startTime && currentTime < n.startTime + n.duration,
      );

      if (currentNote && isCorrectPitch) {
        // ID lookup is fast, but storing reference in map would be faster if needed
        const noteEl = pianoRollTrack.qs(`#forte-note-${currentNote.id}`);
        if (noteEl) {
          noteEl.classOn("hit");
          lastHitNoteElement = noteEl;
        }
      }
    }
  }

  // 5. Final Calculation
  const s = state.scoring;
  const pitchAndRhythm =
    s.totalScorableNotes > 0 ? (s.notesHit / s.totalScorableNotes) * 100 : 0;
  const vibrato =
    s.vibratoOpportunities > 0
      ? (s.vibratoNotesHit / s.vibratoOpportunities) * 100
      : 0;
  const upband =
    s.upbandOpportunities > 0
      ? (s.upbandsHit / s.upbandOpportunities) * 100
      : 0;
  const downband =
    s.downbandOpportunities > 0
      ? (s.downbandsHit / s.downbandOpportunities) * 100
      : 0;

  s.details.pitchAndRhythm = Math.max(
    s.details.pitchAndRhythm,
    Math.min(100, pitchAndRhythm),
  );
  s.details.vibrato = Math.max(s.details.vibrato, Math.min(100, vibrato));
  s.details.upband = Math.max(s.details.upband, Math.min(100, upband));
  s.details.downband = Math.max(s.details.downband, Math.min(100, downband));

  s.finalScore =
    (s.details.pitchAndRhythm +
      s.details.vibrato +
      s.details.upband +
      s.details.downband) /
    4;

  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Scoring.Update", {
      detail: pkg.data.getScoringState(),
    }),
  );
}

// --- Animation Loop ---

function timingLoop() {
  if (state.playback.status !== "playing") {
    animationFrameId = null;
    return;
  }
  const { currentTime, duration } = pkg.data.getPlaybackState();

  // Optimization: Dispatch events less frequently if possible?
  // Currently kept per frame for smooth UI sliders.
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.TimeUpdate", {
      detail: { currentTime, duration },
    }),
  );

  // Scroll Piano Roll - Optimized DOM access
  if (
    pianoRollContainer &&
    pianoRollContainer.elm.classList.contains("visible") &&
    pianoRollTrack
  ) {
    // Direct style manipulation bypasses library overhead in hot loop
    pianoRollTrack.elm.style.transform = `translateX(-${
      currentTime * PIXELS_PER_SECOND
    }px)`;
  }

  // Scoring Throttle
  const now = performance.now();
  if (state.scoring.enabled && now - lastScoreTime > SCORE_UPDATE_INTERVAL) {
    updateScore();
    lastScoreTime = now;
  }

  if (currentTime >= duration && duration > 0) {
    animationFrameId = null;
    return;
  }
  animationFrameId = requestAnimationFrame(timingLoop);
}

// --- Piano Roll Helpers ---

/**
 * Renders a batch of notes to the piano roll track.
 * @param {Array<{id: number, pitch: number, startTime: number, duration: number}>} notes
 */
function renderPianoRollNotes(notes) {
  if (!pianoRollTrack) return;

  // Create document fragment for batched append
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

  // Single reflow
  pianoRollTrack.elm.appendChild(fragment);
}

/**
 * Starts a non-blocking, incremental analysis of the guide vocal track.
 * @param {AudioBuffer} audioBuffer
 */
function startIncrementalGuideAnalysis(audioBuffer) {
  console.log("[FORTE SVC] Starting incremental analysis for piano roll...");
  state.playback.isAnalyzing = true;
  const channelData = audioBuffer.getChannelData(1); // Usually channel 1 is guide in karaoke multiplex
  const sampleRate = audioBuffer.sampleRate;

  // reused buffer size
  const bufferSize = 2048;
  const detector = PitchDetector.forFloat32Array(bufferSize);

  const minNoteDuration = 0.08;
  // Optimization: Increased stepSize.
  // 512 was 75% overlap (too heavy). 1024 is 50% overlap (sufficient for visualization).
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

    // Local vars for loop speed
    const dataLen = channelData.length;

    for (let i = analysisPosition; i < chunkEndPosition; i += stepSize) {
      // slice is somewhat expensive, but necessary here.
      // subarray is faster but creates a view. Pitchy might need a copy if it modifies input,
      // but usually subarray is safe. Trying subarray for perf.
      const chunk = channelData.subarray(i, i + bufferSize);

      const [pitch, clarity] = detector.findPitch(chunk, sampleRate);
      const time = i / sampleRate;

      // Inline MIDI calc: 69 + 12 * log2(pitch/440)
      const midiPitch = 12 * Math.log2(pitch / 440) + 69;

      // Simplified checks
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
          // Average pitch
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
      // Merge logic for notes spanning chunks
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
          // Direct update
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
      // Use requestAnimationFrame for scheduling next chunk to yield to UI more effectively
      // or a small timeout.
      setTimeout(processChunk, 16);
    } else {
      // Process final note trailing at end
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

  // Kickoff
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
        latencyHint: "playback",
        sampleRate: 44100,
      });
      masterGain = audioContext.createGain();

      masterCompressor = audioContext.createDynamicsCompressor();
      masterCompressor.threshold.setValueAtTime(-18, audioContext.currentTime);
      masterCompressor.knee.setValueAtTime(30, audioContext.currentTime);
      masterCompressor.ratio.setValueAtTime(12, audioContext.currentTime);
      masterCompressor.attack.setValueAtTime(0.003, audioContext.currentTime);
      masterCompressor.release.setValueAtTime(0.25, audioContext.currentTime);

      masterGain.connect(masterCompressor);
      masterCompressor.connect(audioContext.destination);

      // Initialize Recording & Effects Pipeline
      state.recording.destinationNode =
        audioContext.createMediaStreamDestination();
      state.recording.audioStream = state.recording.destinationNode.stream;
      state.effects.micChainInput = audioContext.createGain();
      state.effects.micChainOutput = audioContext.createGain();
      state.effects.micChainInput.connect(state.effects.micChainOutput);
      state.effects.micChainOutput.connect(state.recording.destinationNode);

      console.log("[FORTE SVC] Audio pipelines initialized.");

      state.playback.currentDeviceId = audioContext.sinkId || "default";
      pkg.data.getPlaybackDevices();

      // Initialize Synthesizer
      try {
        await audioContext.audioWorklet.addModule(
          "/libs/spessasynth_lib/synthetizer/worklet_processor.min.js",
        );
        const soundFontUrl = "/libs/soundfonts/GeneralUser-GS.sf2";
        const soundFontBuffer = await (await fetch(soundFontUrl)).arrayBuffer();
        state.playback.synthesizer = new Synthetizer(
          masterGain,
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

    try {
      sfxAudioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      sfxGain = sfxAudioContext.createGain();
      sfxGain.connect(sfxAudioContext.destination);
      sfxGain.gain.value = state.playback.volume;
    } catch (e) {
      console.error(
        "[FORTE SVC] FATAL: Could not create SFX Audio context.",
        e,
      );
    }

    await pkg.data.initializeScoringEngine();
  },

  data: {
    getRecordingAudioStream: () => {
      if (state.playback.isMidi) {
        throw new Error("This track does not support Recording.");
      }
      return state.recording.audioStream;
    },

    loadSfx: async (url) => {
      if (!sfxAudioContext) return false;
      if (sfxCache.has(url)) return true;
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await sfxAudioContext.decodeAudioData(arrayBuffer);
        sfxCache.set(url, audioBuffer);
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load SFX: ${url}`, e);
        return false;
      }
    },

    playSfx: async (url) => {
      if (!sfxAudioContext) return;
      if (sfxAudioContext.state === "suspended") await sfxAudioContext.resume();

      let audioBuffer = sfxCache.get(url);
      if (!audioBuffer) {
        const success = await pkg.data.loadSfx(url);
        if (!success) return;
        audioBuffer = sfxCache.get(url);
      }

      if (audioBuffer) {
        const source = sfxAudioContext.createBufferSource();
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

        state.playback.synthesizer = new Synthetizer(masterGain, arrayBuffer);

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

      // Reset State
      if (state.playback.sequencer) {
        state.playback.sequencer.stop();
        state.playback.sequencer = null;
      }
      state.playback.decodedLyrics = [];
      state.playback.transpose = 0;
      state.playback.isMultiplexed = false;
      state.playback.multiplexPan = -1;
      state.playback.guideNotes = [];
      state.playback.isAnalyzing = false;

      // Clean up UI
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
          state.playback.sequencer.loop = false;

          state.playback.sequencer.addOnSongEndedEvent(() => {
            if (state.playback.status !== "stopped") pkg.data.stopTrack();
          }, "forte-song-end");

          await new Promise((resolve) => {
            state.playback.sequencer.addOnSongChangeEvent(() => {
              const rawLyrics = state.playback.sequencer.midiData.lyrics;
              if (rawLyrics && rawLyrics.length > 0) {
                const decoder = new TextDecoder();
                // Filter out metadata lyrics (starting with @)
                // but keep structural ones (like standalone newlines/slashes)
                // so the UI can detect line breaks.
                state.playback.decodedLyrics = rawLyrics
                  .map((lyricBuffer) => decoder.decode(lyricBuffer))
                  .filter((text) => {
                    const clean = text.replace(/[\r\n\/\\]/g, "");
                    // Keep if empty (structural tag) or if not metadata
                    return !clean.startsWith("@");
                  });
                console.log(state.playback.decodedLyrics);
              }
              resolve();
            }, "forte-loader");
          });

          let displayableLyricIndex = 0;
          state.playback.sequencer.onTextEvent = (messageData, messageType) => {
            if (messageType === 5) {
              const text = new TextDecoder().decode(messageData.buffer);
              const cleanText = text.replace(/[\r\n\/\\]/g, "");
              // Only dispatch if it has content AND is not metadata
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
          state.playback.buffer = await audioContext.decodeAudioData(
            arrayBuffer,
          );
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

      if (state.playback.isMidi) {
        if (!state.playback.sequencer || state.playback.status === "playing")
          return;

        // Force disable mic for MIDI performance optimization
        // We preserve user preference in userInputEnabled
        pkg.data.stopMicInput();
        state.scoring.enabled = false;

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
          // Setup Multiplexed Audio & Scoring
          if (state.playback.guideNotes) {
            pianoRollTrack.clear();
            renderPianoRollNotes(state.playback.guideNotes);
            if (state.ui.pianoRollVisible)
              pianoRollContainer.classOn("visible");
          }

          state.scoring.enabled = true;
          // Reset Scoring State
          Object.assign(state.scoring, {
            finalScore: 0,
            totalScorableNotes: 0,
            notesHit: 0,
            vibratoOpportunities: 0,
            vibratoNotesHit: 0,
            upbandOpportunities: 0,
            upbandsHit: 0,
            downbandOpportunities: 0,
            downbandsHit: 0,
            lastGuidePitch: 0,
            pitchHistory: [],
            isVocalGuideNoteActive: false,
            hasHitCurrentNote: false,
            isHoldingNote: false,
            details: {
              pitchAndRhythm: 0,
              vibrato: 0,
              upband: 0,
              downband: 0,
            },
          });

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
          // Standard Stereo Playback
          sourceNode.connect(masterGain);
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

      dispatchPlaybackUpdate();
      // Start loop
      lastScoreTime = performance.now();
      if (animationFrameId === null) timingLoop();
    },

    pauseTrack: () => {
      if (state.playback.status !== "playing") return;

      state.scoring.enabled = false;
      if (pianoRollContainer) pianoRollContainer.classOff("visible");

      if (state.recording.trackDelayNode) {
        state.recording.trackDelayNode.disconnect();
        if (state.playback.isMidi && state.playback.synthesizer) {
          try {
            state.playback.synthesizer.disconnect(
              state.recording.trackDelayNode,
            );
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

      // Cleanup UI
      if (pianoRollContainer) pianoRollContainer.classOff("visible");
      if (scoreReasonDisplay) {
        scoreReasonDisplay.classOff("visible");
        if (scoreReasonTimeout) clearTimeout(scoreReasonTimeout);
      }

      const wasMidi = state.playback.isMidi;

      if (state.playback.status === "stopped") return;

      // Disconnect Recording
      if (state.recording.trackDelayNode) {
        state.recording.trackDelayNode.disconnect();
        if (state.playback.isMidi && state.playback.synthesizer) {
          try {
            state.playback.synthesizer.disconnect(
              state.recording.trackDelayNode,
            );
          } catch (e) {}
        }
        state.recording.trackDelayNode = null;
      }

      // Stop Audio
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

      // Restore Mic Input if it was disabled by MIDI optimization
      if (wasMidi && state.scoring.userInputEnabled) {
        pkg.data.startMicInput(state.scoring.currentMicDeviceId);
      }

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
      // Also disconnect from effect chain to stop graph processing
      if (state.scoring.micAnalyser) {
        try {
          state.effects.micChainInput.disconnect(state.scoring.micAnalyser);
        } catch (e) {
          // Ignore connection errors if already disconnected
        }
        state.scoring.micAnalyser = null;
      }
      state.scoring.enabled = false;
      console.log(
        "[FORTE SVC] Microphone input stopped (Performance/User req).",
      );
    },

    startMicInput: async (deviceId = "default") => {
      // Ensure we clean up previous streams first
      pkg.data.stopMicInput();

      // If user disabled it, don't start it unless called directly
      // However, startMicInput implies a direct request or system restore.
      // We update state.scoring.userInputEnabled only if called via setMicInputEnabled ideally,
      // but here we assume if this is called, we want it on.

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

        // Route: Source -> Chain Input -> [Effects] -> Chain Output -> Recording
        source.connect(state.effects.micChainInput);
        // Analyser listens to RAW input for scoring accuracy
        state.effects.micChainInput.connect(analyser);

        state.scoring.micSourceNode = source;
        state.scoring.micAnalyser = analyser;

        if (!state.scoring.pitchDetector) {
          state.scoring.pitchDetector = PitchDetector.forFloat32Array(
            analyser.fftSize,
          );
        }
        // Restore enabled flag (algorithms active)
        state.scoring.enabled = true;
        console.log("[FORTE SVC] Microphone input started.");
      } catch (e) {
        console.error("[FORTE SVC] Failed to get microphone input:", e);
      }
    },

    // --- Vocal Chain API ---

    loadVocalChain: async (chainConfig) => {
      state.effects.vocalChain.forEach((plugin) => plugin.disconnect());
      state.effects.vocalChain = [];

      for (const pluginConfig of chainConfig) {
        try {
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

    // UI Cleanup
    if (toastElement) toastElement.cleanup();
    if (toastStyleElement) toastStyleElement.cleanup();
    if (pianoRollContainer) pianoRollContainer.cleanup();
    if (scoreReasonDisplay) scoreReasonDisplay.cleanup();

    // Mic Cleanup
    if (state.scoring.micStream) {
      state.scoring.micStream.getTracks().forEach((track) => track.stop());
    }

    // Audio Context Cleanup
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

    if (sfxAudioContext && sfxAudioContext.state !== "closed") {
      sfxAudioContext.close();
    }
    sfxCache.clear();

    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (state.playback.synthesizer) state.playback.synthesizer.close();
  },
};

export default pkg;
