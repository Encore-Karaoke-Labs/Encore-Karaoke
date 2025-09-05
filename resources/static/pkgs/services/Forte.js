// Forte for Encore Karaoke
import {
  Synthetizer,
  Sequencer,
} from "https://cdn.jsdelivr.net/npm/spessasynth_lib@3.27.8/+esm";
import Html from "/libs/html.js"; // Import the Html library
// --- START: SCORING ENGINE ---
import { PitchDetector } from "https://cdn.jsdelivr.net/npm/pitchy@4.1.0/+esm";
// --- END: SCORING ENGINE ---

// --- START: Added for PeerJS Mic ---
// Helper to dynamically load a script
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

let peer = null; // PeerJS instance
const micConnections = new Map(); // To store active mic connections and their audio nodes
// --- END: Added for PeerJS Mic ---

let socket;
let root;

// --- UI Elements managed by the service ---
let toastElement = null;
let toastStyleElement = null;
let toastTimeout = null;

// --- Web Audio API State for Karaoke Track Playback ---
let audioContext;
let masterGain;
let sourceNode = null;
let animationFrameId = null;

// --- START: Added for Sound Effects ---
let sfxAudioContext;
let sfxGain;
const sfxCache = new Map();
// --- END: Added for Sound Effects ---

// --- Combined Service State ---
const state = {
  // --- START: SCORING ENGINE (Replaces Vocal Engine) ---
  scoring: {
    enabled: false,
    micStream: null,
    micSourceNode: null,
    micAnalyser: null,
    vocalGuideAnalyser: null,
    pitchDetector: null,
    score: 0,
    // --- NEW CUMULATIVE SCORING STATE V3 ---
    highestScoreThisSong: 0, // Tracks the peak score to prevent visual dips
    guideVocalDelayNode: null, // For latency compensation
    totalScorableNotes: 0,
    notesHit: 0,
    isVocalGuideNoteActive: false,
    hasHitCurrentNote: false,
    guideNoteDebounceStart: 0,
    // --- END NEW STATE ---
    micDevices: [],
    currentMicDeviceId: "default",
  },
  // --- END: SCORING ENGINE ---
  playback: {
    status: "stopped",
    buffer: null,
    synthesizer: null,
    sequencer: null,
    isMidi: false,
    isMultiplexed: false,
    decodedLyrics: [],
    startTime: 0,
    pauseTime: 0,
    devices: [],
    currentDeviceId: "default",
    transpose: 0,
    multiplexPan: -1, // Default pan to left (instrumental)
    leftPannerGain: null,
    rightPannerGain: null,
  },
  mic: {
    peerId: null,
    connectedMics: 0,
  },
};

function createEmptyAudioTrack() {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const dst = oscillator.connect(ctx.createMediaStreamDestination());
  oscillator.start();
  const track = dst.stream.getAudioTracks()[0];
  return Object.assign(track, { enabled: false });
}

function dispatchPlaybackUpdate() {
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.Update", {
      detail: pkg.data.getPlaybackState(),
    }),
  );
}

// --- START: SCORING ENGINE ---
// Create reusable buffers for performance.
let guideAnalyserBuffer = null;
let micAnalyserBuffer = null;

// --- NEW SCORING CONSTANTS ---
const GUIDE_CLARITY_THRESHOLD = 0.9;
const MIC_CLARITY_THRESHOLD = 0.85;
const NOTE_DEBOUNCE_DURATION_MS = 50;
const LATENCY_COMPENSATION_S = 0.15; // 150ms latency compensation

/**
 * Calculates the score based on a debounced, cumulative, latency-compensated algorithm.
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

  const pitchDetector = state.scoring.pitchDetector;
  const guideAnalyser = state.scoring.vocalGuideAnalyser;
  const micAnalyser = state.scoring.micAnalyser;

  if (!guideAnalyserBuffer) {
    guideAnalyserBuffer = new Float32Array(guideAnalyser.fftSize);
  }
  if (!micAnalyserBuffer) {
    micAnalyserBuffer = new Float32Array(micAnalyser.fftSize);
  }

  guideAnalyser.getFloatTimeDomainData(guideAnalyserBuffer);
  micAnalyser.getFloatTimeDomainData(micAnalyserBuffer);

  const [guidePitch, guideClarity] = pitchDetector.findPitch(
    guideAnalyserBuffer,
    audioContext.sampleRate,
  );
  const [micPitch, micClarity] = pitchDetector.findPitch(
    micAnalyserBuffer,
    audioContext.sampleRate,
  );

  // 1. Guide Note State Machine
  if (guideClarity > GUIDE_CLARITY_THRESHOLD) {
    if (state.scoring.guideNoteDebounceStart === 0) {
      state.scoring.guideNoteDebounceStart = performance.now();
    }
    if (
      !state.scoring.isVocalGuideNoteActive &&
      performance.now() - state.scoring.guideNoteDebounceStart >
        NOTE_DEBOUNCE_DURATION_MS
    ) {
      state.scoring.isVocalGuideNoteActive = true;
      state.scoring.hasHitCurrentNote = false;
      state.scoring.totalScorableNotes++;
    }
  } else {
    state.scoring.guideNoteDebounceStart = 0;
    state.scoring.isVocalGuideNoteActive = false;
  }

  // 2. User Scoring Logic
  if (
    state.scoring.isVocalGuideNoteActive &&
    !state.scoring.hasHitCurrentNote &&
    micClarity > MIC_CLARITY_THRESHOLD &&
    micPitch > 50
  ) {
    let normalizedMicPitch = micPitch;
    while (normalizedMicPitch < guidePitch * 0.75) {
      normalizedMicPitch *= 2;
    }
    while (normalizedMicPitch > guidePitch * 1.5) {
      normalizedMicPitch /= 2;
    }

    const centsDifference = 1200 * Math.log2(normalizedMicPitch / guidePitch);
    if (Math.abs(centsDifference) < 50) {
      state.scoring.notesHit++;
      state.scoring.hasHitCurrentNote = true;
    }
  }

  // 3. Final Score Calculation
  if (state.scoring.totalScorableNotes > 0) {
    state.scoring.score = Math.round(
      (state.scoring.notesHit / state.scoring.totalScorableNotes) * 100,
    );
  } else {
    state.scoring.score = 0;
  }

  // 4. Update the highest score tracker
  state.scoring.highestScoreThisSong = Math.max(
    state.scoring.highestScoreThisSong,
    state.scoring.score,
  );

  // Dispatch event with the HIGHEST score, so the UI never dips.
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Scoring.Update", {
      detail: { score: state.scoring.highestScoreThisSong },
    }),
  );
}
// --- END: SCORING ENGINE ---

function timingLoop() {
  if (state.playback.status !== "playing") {
    animationFrameId = null;
    return;
  }
  const { currentTime, duration } = pkg.data.getPlaybackState();
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.TimeUpdate", {
      detail: { currentTime, duration },
    }),
  );

  if (state.scoring.enabled) {
    updateScore();
  }

  if (currentTime >= duration && duration > 0) {
    animationFrameId = null;
    return;
  }
  animationFrameId = requestAnimationFrame(timingLoop);
}

const pkg = {
  name: "Forte Sound Engine Service",
  svcName: "ForteSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    console.log("Starting Forte Sound Engine Service for Encore.");
    root = Root;

    // --- Create and inject the Toast UI ---
    toastStyleElement = new Html("style")
      .text(
        `
        .forte-toast {
            position: fixed;
            top: 2rem;
            left: 2rem;
            background: rgba(0,0,0,0.7);
            border: 1px solid rgba(255,255,255,0.3);
            border-radius: 0.5rem;
            padding: 0.6rem 1.2rem;
            color: #FFD700;
            font-family: 'Rajdhani', sans-serif;
            font-weight: 700;
            font-size: 1rem;
            letter-spacing: 0.1rem;
            z-index: 200000;
            opacity: 0;
            transform: translateX(-20px);
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
        }
        .forte-toast.visible {
            opacity: 1;
            transform: translateX(0);
        }
    `,
      )
      .appendTo("head");
    toastElement = new Html("div").classOn("forte-toast").appendTo("body");

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
        sampleRate: 44100, // Standard sample rate
      });
      masterGain = audioContext.createGain();
      masterGain.connect(audioContext.destination);
      state.playback.currentDeviceId = audioContext.sinkId || "default";
      console.log("[FORTE SVC] Web Audio API context initialized.");
      pkg.data.getPlaybackDevices();

      // Initialize microphone input for scoring
      await pkg.data.initializeScoringEngine();

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

    // --- START: Added for Sound Effects ---
    try {
      sfxAudioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      sfxGain = sfxAudioContext.createGain();
      sfxGain.connect(sfxAudioContext.destination);
      sfxGain.gain.value = 1; // Default volume for SFX
      console.log("[FORTE SVC] SFX Audio context initialized.");
    } catch (e) {
      console.error(
        "[FORTE SVC] FATAL: Could not create SFX Audio context.",
        e,
      );
    }
    // --- END: Added for Sound Effects ---

    // --- START: Added for PeerJS Mic ---
    try {
      await loadScript("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");
      console.log("[FORTE SVC] PeerJS library loaded.");

      const peerId = await window.desktopIntegration.ipc.invoke(
        "mic-get-peer-id",
      );
      if (!peerId) {
        throw new Error("Could not get a Peer ID from the main process.");
      }
      state.mic.peerId = peerId;

      peer = new Peer(peerId, {
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
          ],
        },
      });

      peer.on("open", (id) => {
        console.log(`[FORTE SVC] PeerJS client ready. My ID is: ${id}`);
        document.dispatchEvent(
          new CustomEvent("CherryTree.Forte.Mic.Ready", {
            detail: { peerId: id },
          }),
        );
      });

      peer.on("call", async (call) => {
        const sessionCode = call.metadata?.code;
        console.log(`[FORTE SVC] Incoming mic call with code: ${sessionCode}`);

        if (
          !sessionCode ||
          !(await window.desktopIntegration.ipc.invoke(
            "mic-validate-code",
            sessionCode,
          ))
        ) {
          console.warn(
            `[FORTE SVC] Rejecting incoming call with invalid code.`,
          );
          call.close(); // Reject the call
          return;
        }

        console.log(`[FORTE SVC] Accepting call from Peer ID: ${call.peer}`);
        call.answer(new MediaStream([createEmptyAudioTrack()])); // Answer the call, we don't send any stream back

        call.on("stream", (remoteStream) => {
          console.log(
            `[FORTE SVC] Received microphone stream from ${call.peer}`,
          );
          const a = new Audio();
          a.muted = true;
          a.srcObject = remoteStream;
          a.autoplay = true;

          if (audioContext.state === "suspended") {
            audioContext.resume();
          }
          const micSourceNode =
            audioContext.createMediaStreamSource(remoteStream);
          micSourceNode.connect(masterGain); // Connect mic audio to the main output

          micConnections.set(call.peer, { call, node: micSourceNode });
          state.mic.connectedMics = micConnections.size;
        });

        call.on("close", () => {
          console.log(`[FORTE SVC] Microphone call from ${call.peer} closed.`);
          const connection = micConnections.get(call.peer);
          if (connection) {
            connection.node.disconnect(); // Disconnect the audio node to stop playback
            micConnections.delete(call.peer);
            state.mic.connectedMics = micConnections.size;
          }
        });

        call.on("error", (err) => {
          console.error(
            `[FORTE SVC] PeerJS call error with ${call.peer}:`,
            err,
          );
        });
      });

      peer.on("error", (err) => {
        console.error("[FORTE SVC] PeerJS main error:", err);
      });
    } catch (err) {
      console.error(
        "[FORTE SVC] FATAL: Could not initialize PeerJS for microphone.",
        err,
      );
    }
    // --- END: Added for PeerJS Mic ---
  },

  data: {
    // --- START: Added for Sound Effects ---
    loadSfx: async (url) => {
      if (!sfxAudioContext) return false;
      if (sfxCache.has(url)) return true; // Already loaded

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

      if (sfxAudioContext.state === "suspended") {
        await sfxAudioContext.resume();
      }

      let audioBuffer = sfxCache.get(url);
      if (!audioBuffer) {
        console.warn(
          `[FORTE SVC] SFX not preloaded, loading on demand: ${url}`,
        );
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
    // --- END: Added for Sound Effects ---

    getPlaybackDevices: async () => {
      if (!navigator.mediaDevices?.enumerateDevices) {
        console.warn("[FORTE SVC] enumerateDevices not supported.");
        return [];
      }
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
        console.error("[FORTE SVC] Could not enumerate playback devices:", e);
        return [];
      }
    },

    setPlaybackDevice: async (deviceId) => {
      if (!audioContext || typeof audioContext.setSinkId !== "function") {
        console.error(
          "[FORTE SVC] Audio output switching is not supported by this browser.",
        );
        return false;
      }
      try {
        await audioContext.setSinkId(deviceId);
        state.playback.currentDeviceId = deviceId;
        console.log(`[FORTE SVC] Playback device switched to: ${deviceId}`);
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        console.error(
          `[FORTE SVC] Failed to set playback device to ${deviceId}:`,
          e,
        );
        return false;
      }
    },

    loadSoundFont: async (url) => {
      if (!state.playback.synthesizer) {
        console.error(
          "[FORTE SVC] Synthesizer not initialized, cannot load SoundFont.",
        );
        return false;
      }
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        state.playback.synthesizer.loadSoundFont(arrayBuffer);
        console.log(`[FORTE SVC] SoundFont loaded successfully from: ${url}`);
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load SoundFont: ${url}`, e);
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
      state.playback.transpose = 0;
      state.playback.isMultiplexed = false;
      state.playback.multiplexPan = -1; // Default pan to left (instrumental)

      const isMidi =
        url.toLowerCase().endsWith(".mid") ||
        url.toLowerCase().endsWith(".midi") ||
        url.toLowerCase().endsWith(".kar");
      state.playback.isMidi = isMidi;

      if (!isMidi && url.toLowerCase().includes(".multiplexed.")) {
        state.playback.isMultiplexed = true;
        console.log("[FORTE SVC] Multiplexed audio track detected.");
      }

      if (toastElement) {
        toastElement.text(isMidi ? "Classic Karaoke" : "Real Sound");
      }

      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (isMidi) {
          if (!state.playback.synthesizer) {
            throw new Error("MIDI Synthesizer is not initialized.");
          }
          state.playback.sequencer = new Sequencer(
            [{ binary: arrayBuffer }],
            state.playback.synthesizer,
          );
          state.playback.sequencer.loop = false;

          state.playback.sequencer.addOnSongEndedEvent(() => {
            if (state.playback.status !== "stopped") {
              pkg.data.stopTrack();
            }
          }, "forte-song-end");

          await new Promise((resolve) => {
            state.playback.sequencer.addOnSongChangeEvent(() => {
              const rawLyrics = state.playback.sequencer.midiData.lyrics;

              if (rawLyrics && rawLyrics.length > 0) {
                const decoder = new TextDecoder();
                state.playback.decodedLyrics = rawLyrics.map((lyricBuffer) =>
                  decoder.decode(lyricBuffer),
                );
                console.log(
                  `[FORTE SVC] Decoded ${state.playback.decodedLyrics.length} lyric events.`,
                );
              }
              resolve();
            }, "forte-loader");
          });

          let displayableLyricIndex = 0;
          state.playback.sequencer.onTextEvent = (messageData, messageType) => {
            if (messageType === 5) {
              const text = new TextDecoder().decode(messageData.buffer);
              const cleanText = text.replace(/[\r\n\/\\]/g, "");
              if (cleanText) {
                document.dispatchEvent(
                  new CustomEvent("CherryTree.Forte.Playback.LyricEvent", {
                    detail: { index: displayableLyricIndex },
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
        }

        state.playback.status = "stopped";
        state.playback.pauseTime = 0;
        console.log(
          `[FORTE SVC] Track loaded successfully (${
            isMidi ? "MIDI" : "Audio"
          }): ${url}`,
        );
        dispatchPlaybackUpdate();
        return true;
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load or decode track: ${url}`, e);
        state.playback.buffer = null;
        state.playback.sequencer = null;
        state.playback.isMidi = false;
        state.playback.isMultiplexed = false;
        return false;
      }
    },

    playTrack: () => {
      if (toastElement) {
        if (toastTimeout) clearTimeout(toastTimeout);
        toastElement.classOn("visible");
        toastTimeout = setTimeout(() => {
          toastElement.classOff("visible");
        }, 3000);
      }

      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      if (state.playback.isMidi) {
        if (!state.playback.sequencer || state.playback.status === "playing")
          return;
        state.playback.sequencer.play();
        state.playback.status = "playing";
      } else {
        if (!state.playback.buffer || state.playback.status === "playing")
          return;
        sourceNode = audioContext.createBufferSource();
        sourceNode.buffer = state.playback.buffer;

        const rate = Math.pow(2, state.playback.transpose / 12);
        sourceNode.playbackRate.value = rate;

        if (state.playback.isMultiplexed) {
          // --- START: SCORING ENGINE ---
          // Enable scoring and RESET all cumulative scoring variables
          state.scoring.enabled = true;
          state.scoring.score = 0;
          state.scoring.highestScoreThisSong = 0;
          state.scoring.notesHit = 0;
          state.scoring.totalScorableNotes = 0;
          state.scoring.isVocalGuideNoteActive = false;
          state.scoring.hasHitCurrentNote = false;
          state.scoring.guideNoteDebounceStart = 0;

          // Create the analysis graph
          const vocalGuideAnalyser = audioContext.createAnalyser();
          vocalGuideAnalyser.fftSize = 2048;
          state.scoring.vocalGuideAnalyser = vocalGuideAnalyser;

          // --- LATENCY COMPENSATION ---
          const delayNode = audioContext.createDelay();
          delayNode.delayTime.value = LATENCY_COMPENSATION_S;
          state.scoring.guideVocalDelayNode = delayNode;
          // --- END LATENCY COMPENSATION ---

          const splitter = audioContext.createChannelSplitter(2);
          const merger = audioContext.createChannelMerger(1);
          const leftGain = audioContext.createGain();
          const rightGain = audioContext.createGain();

          state.playback.leftPannerGain = leftGain;
          state.playback.rightPannerGain = rightGain;

          sourceNode.connect(splitter);
          splitter.connect(leftGain, 0);
          splitter.connect(rightGain, 1);

          // Latency-compensated analysis path: splitter -> delay -> analyser
          splitter.connect(delayNode, 1);
          delayNode.connect(vocalGuideAnalyser);

          // Audio output path (unaffected by delay)
          leftGain.connect(merger, 0, 0);
          rightGain.connect(merger, 0, 0);
          merger.connect(masterGain);

          pkg.data.setMultiplexPan(state.playback.multiplexPan);
          console.log("[FORTE SVC] Playing track in multiplexed panner mode.");
        } else {
          sourceNode.connect(masterGain);
        }

        sourceNode.onended = () => {
          if (state.playback.status === "playing") {
            pkg.data.stopTrack(); // Use stopTrack to ensure cleanup
          }
        };
        const offset = state.playback.pauseTime;
        sourceNode.start(0, offset);
        state.playback.startTime = audioContext.currentTime;
        state.playback.status = "playing";
      }

      dispatchPlaybackUpdate();
      if (animationFrameId === null) {
        timingLoop();
      }
    },

    pauseTrack: () => {
      if (state.playback.status !== "playing") return;

      // Disable scoring and clean up analysis nodes
      state.scoring.enabled = false;
      if (state.scoring.guideVocalDelayNode) {
        state.scoring.guideVocalDelayNode.disconnect();
        state.scoring.guideVocalDelayNode = null;
      }
      if (state.scoring.vocalGuideAnalyser) {
        state.scoring.vocalGuideAnalyser.disconnect();
        state.scoring.vocalGuideAnalyser = null;
      }

      if (state.playback.isMidi) {
        state.playback.sequencer.pause();
        state.playback.status = "paused";
      } else {
        if (!sourceNode) return;

        const rate = sourceNode.playbackRate.value;
        const elapsedRealTime =
          audioContext.currentTime - state.playback.startTime;
        state.playback.pauseTime += elapsedRealTime * rate;

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

      if (state.playback.status === "stopped") return;

      // Disable scoring and clean up analysis nodes
      state.scoring.enabled = false;
      if (state.scoring.guideVocalDelayNode) {
        state.scoring.guideVocalDelayNode.disconnect();
        state.scoring.guideVocalDelayNode = null;
      }
      if (state.scoring.vocalGuideAnalyser) {
        state.scoring.vocalGuideAnalyser.disconnect();
        state.scoring.vocalGuideAnalyser = null;
      }

      if (state.playback.isMidi) {
        if (state.playback.sequencer) {
          state.playback.sequencer.stop();
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
      state.playback.multiplexPan = -1; // Also reset to default on stop
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
    },

    setMultiplexPan: (panValue) => {
      const pan = Math.max(-1, Math.min(1, panValue));
      state.playback.multiplexPan = pan;

      const { leftPannerGain, rightPannerGain } = state.playback;

      if (leftPannerGain && rightPannerGain) {
        const leftGainValue = (1 - pan) / 2;
        const rightGainValue = (1 + pan) / 2;

        leftPannerGain.gain.setValueAtTime(
          leftGainValue,
          audioContext.currentTime,
        );
        rightPannerGain.gain.setValueAtTime(
          rightGainValue,
          audioContext.currentTime,
        );
      }
      dispatchPlaybackUpdate();
    },

    setTranspose: (semitones) => {
      const clampedSemitones = Math.max(
        -24,
        Math.min(24, Math.round(semitones)),
      );

      if (
        !state.playback.isMidi &&
        state.playback.status === "playing" &&
        sourceNode
      ) {
        const currentRate = sourceNode.playbackRate.value;
        const elapsedRealTime =
          audioContext.currentTime - state.playback.startTime;
        state.playback.pauseTime += elapsedRealTime * currentRate;
        state.playback.startTime = audioContext.currentTime;
      }

      state.playback.transpose = clampedSemitones;

      if (state.playback.isMidi && state.playback.synthesizer) {
        state.playback.synthesizer.transpose(clampedSemitones);
      } else if (!state.playback.isMidi && sourceNode) {
        const newRate = Math.pow(2, clampedSemitones / 12);
        sourceNode.playbackRate.setValueAtTime(
          newRate,
          audioContext.currentTime,
        );
      }

      dispatchPlaybackUpdate();
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
          const currentRate = sourceNode.playbackRate.value;
          const elapsedRealTime =
            audioContext.currentTime - state.playback.startTime;
          currentTime =
            state.playback.pauseTime + elapsedRealTime * currentRate;
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
        score: state.scoring.highestScoreThisSong, // Report the highest score
      };
    },

    initializeScoringEngine: async () => {
      if (!audioContext) return;
      console.log("[FORTE SVC] Initializing Scoring Engine...");
      await pkg.data.getMicDevices();
      await pkg.data.startMicInput(state.scoring.currentMicDeviceId);
    },

    getMicDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.scoring.micDevices = devices
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ label: d.label, deviceId: d.deviceId }));
        return state.scoring.micDevices;
      } catch (e) {
        console.error("[FORTE SVC] Could not enumerate mic devices:", e);
        return [];
      }
    },

    setMicDevice: async (deviceId) => {
      console.log(`[FORTE SVC] Setting mic device to: ${deviceId}`);
      await pkg.data.startMicInput(deviceId);
      state.scoring.currentMicDeviceId = deviceId;
    },

    startMicInput: async (deviceId = "default") => {
      if (state.scoring.micStream) {
        state.scoring.micStream.getTracks().forEach((track) => track.stop());
        state.scoring.micStream = null;
      }
      if (state.scoring.micSourceNode) {
        state.scoring.micSourceNode.disconnect();
        state.scoring.micSourceNode = null;
      }

      try {
        // --- START: MODIFIED FOR RAW AUDIO ---
        // Request the microphone stream with all browser processing disabled.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            // These constraints are crucial for getting clean, unprocessed audio for singing.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        // --- END: MODIFIED FOR RAW AUDIO ---

        state.scoring.micStream = stream;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048; // Standard for pitch detection

        // IMPORTANT: The mic is only connected to the analyser, not to the output.
        // This prevents feedback and latency issues.
        source.connect(analyser);

        state.scoring.micSourceNode = source;
        state.scoring.micAnalyser = analyser;

        // Initialize the pitch detector if it doesn't exist
        if (!state.scoring.pitchDetector) {
          state.scoring.pitchDetector = PitchDetector.forFloat32Array(
            analyser.fftSize,
          );
        }
        console.log("[FORTE SVC] Microphone input started for scoring.");
      } catch (e) {
        console.error("[FORTE SVC] Failed to get microphone input:", e);
      }
    },
  },

  end: async function () {
    console.log("[FORTE SVC] Shutting down service.");
    if (toastElement) toastElement.cleanup();
    if (toastStyleElement) toastStyleElement.cleanup();
    toastElement = null;
    toastStyleElement = null;
    if (toastTimeout) clearTimeout(toastTimeout);

    if (state.scoring.micStream) {
      // Stop mic track
      state.scoring.micStream.getTracks().forEach((track) => track.stop());
    }

    if (audioContext && audioContext.state !== "closed") {
      audioContext.close();
    }
    if (sfxAudioContext && sfxAudioContext.state !== "closed") {
      sfxAudioContext.close();
    }
    sfxCache.clear();
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (state.playback.synthesizer) {
      state.playback.synthesizer.close();
    }
    if (peer) {
      peer.destroy();
      console.log("[FORTE SVC] PeerJS client destroyed.");
    }
    micConnections.forEach((conn) => {
      conn.node.disconnect();
      conn.call.close();
    });
    micConnections.clear();
    console.log("[FORTE SVC] Shutdown complete.");
  },
};

export default pkg;
