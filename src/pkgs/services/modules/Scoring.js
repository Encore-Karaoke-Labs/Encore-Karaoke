import { logVerbose } from "../core/State.js";

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

// Temperley key profiles
const MAJOR_PROFILE = [
  5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0,
];
const MINOR_PROFILE = [
  5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0,
];

// Pre-computed profile statistics to eliminate redundant loops per frame
const MAJOR_MEAN = MAJOR_PROFILE.reduce((a, b) => a + b, 0) / 12;
const MINOR_MEAN = MINOR_PROFILE.reduce((a, b) => a + b, 0) / 12;

const MAJOR_STD = Math.sqrt(
  MAJOR_PROFILE.reduce((acc, v) => acc + Math.pow(v - MAJOR_MEAN, 2), 0),
);
const MINOR_STD = Math.sqrt(
  MINOR_PROFILE.reduce((acc, v) => acc + Math.pow(v - MINOR_MEAN, 2), 0),
);

const NORMALIZED_MAJOR = MAJOR_PROFILE.map((v) => (v - MAJOR_MEAN) / MAJOR_STD);
const NORMALIZED_MINOR = MINOR_PROFILE.map((v) => (v - MINOR_MEAN) / MINOR_STD);

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
// Natural minor + harmonic minor leading tone (11) for accurate vocal cadences
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10, 11];

const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIC_CLARITY_THRESHOLD = 0.85;
const RMS_NOISE_GATE = 0.015;

const KEY_AWARE_RMS_GATE = 0.015;
const KEY_AWARE_CLARITY = 0.92;
const MIN_FRAMES_FOR_FULL_SCORE = 900;
const MIN_VOCAL_HZ = 75;
const MAX_VOCAL_HZ = 1200;

/**
 * Analyzes a chroma distribution array to determine the most likely active musical key.
 *
 * @param {number[]} chromaArray - The aggregated 12-bin chroma vector.
 * @returns {{root: number, mode: string, name: string, correlation: number}} The estimated key data.
 */
function detectMusicalKey(chromaArray) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chromaArray[i];
  if (sum === 0) {
    return { root: 0, mode: "Major", name: "Unknown", correlation: 0 };
  }

  const mean = sum / 12;
  let variance = 0;
  for (let i = 0; i < 12; i++) {
    variance += Math.pow(chromaArray[i] - mean, 2);
  }
  if (variance === 0) {
    return { root: 0, mode: "Major", name: "Unknown", correlation: 0 };
  }

  const std = Math.sqrt(variance);
  const normChroma = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    normChroma[i] = (chromaArray[i] - mean) / std;
  }

  let bestCorrelation = -1;
  let bestKeyIndex = 0;
  let bestMode = "Major";

  for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
    let majorDot = 0;
    let minorDot = 0;

    for (let j = 0; j < 12; j++) {
      const chromaVal = normChroma[(rootIndex + j) % 12];
      majorDot += chromaVal * NORMALIZED_MAJOR[j];
      minorDot += chromaVal * NORMALIZED_MINOR[j];
    }

    const majorCorr = majorDot / 12;
    const minorCorr = minorDot / 12;

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

export class ForteScoring {
  /**
   * Initializes the Scoring Engine.
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   * @param {Object} pianoRoll - Reference to the FortePianoRoll instance for hit/miss feedback.
   */
  constructor(state, audioCore, pianoRoll) {
    this.state = state;
    this.audioCore = audioCore;
    this.pianoRoll = pianoRoll;

    this.micAnalyserBuffer = null;
    this.guideAnalyserBuffer = null;
    this.currentRootIndex = null;
    this.currentMode = null;
  }

  /**
   * Analyzes audio input and updates scoring/pitch metrics continuously.
   *
   * @param {number} currentTime - Current track playback time in seconds.
   */
  updateScore(currentTime) {
    if (
      !this.state.scoring.enabled ||
      this.state.scoring.userDisabled ||
      !this.state.scoring.pitchDetector ||
      !this.state.scoring.micAnalyser
    ) {
      return;
    }

    if (
      !this.micAnalyserBuffer ||
      this.micAnalyserBuffer.length !== this.state.scoring.micAnalyser.fftSize
    ) {
      this.micAnalyserBuffer = new Float32Array(
        this.state.scoring.micAnalyser.fftSize,
      );
    }

    this.state.scoring.micAnalyser.getFloatTimeDomainData(
      this.micAnalyserBuffer,
    );
    const sampleRate = this.audioCore.context.sampleRate;
    const [micPitch, micClarity] = this.state.scoring.pitchDetector.findPitch(
      this.micAnalyserBuffer,
      sampleRate,
    );

    let isCorrectPitch;
    let sumSquares = 0;

    for (let i = 0; i < this.micAnalyserBuffer.length; i++) {
      sumSquares += this.micAnalyserBuffer[i] * this.micAnalyserBuffer[i];
    }

    const rms = Math.sqrt(sumSquares / this.micAnalyserBuffer.length);
    const isValidPitch = micPitch >= MIN_VOCAL_HZ && micPitch <= MAX_VOCAL_HZ;
    const isSingingStrict =
      micClarity > MIC_CLARITY_THRESHOLD &&
      isValidPitch &&
      rms > RMS_NOISE_GATE;

    if (isSingingStrict) {
      this.state.scoring.singingGraceFrames = 8;
      this.state.scoring.rawMicMidi = 12 * Math.log2(micPitch / 440) + 69;
    } else if (this.state.scoring.singingGraceFrames > 0) {
      this.state.scoring.singingGraceFrames--;
    } else {
      this.state.scoring.rawMicMidi = 0;
    }

    const isVisuallySinging = this.state.scoring.singingGraceFrames > 0;
    this.state.scoring.isSinging = isSingingStrict;
    this.state.scoring.currentMicMidi = this.state.scoring.rawMicMidi;

    const isKeyAwareSinging =
      micClarity > KEY_AWARE_CLARITY &&
      isValidPitch &&
      rms > KEY_AWARE_RMS_GATE;
    let keyAwareMidiPitch = isKeyAwareSinging
      ? 12 * Math.log2(micPitch / 440) + 69
      : 0;

    const hasGuideNotes =
      this.state.playback.guideNotes &&
      this.state.playback.guideNotes.length > 0;

    if (
      hasGuideNotes ||
      (this.state.playback.isMultiplexed &&
        this.state.scoring.vocalGuideAnalyser)
    ) {
      let targetMidiPitch = 0;
      let isGuideNoteActive = false;

      if (hasGuideNotes) {
        const currentNote = this.state.playback.guideNotes.find(
          (n) =>
            currentTime >= n.startTime &&
            currentTime < n.startTime + n.duration,
        );
        if (currentNote) {
          targetMidiPitch = currentNote.pitch + this.state.playback.transpose;
          isGuideNoteActive = true;
        }
      } else {
        if (
          !this.guideAnalyserBuffer ||
          this.guideAnalyserBuffer.length !==
            this.state.scoring.vocalGuideAnalyser.fftSize
        ) {
          this.guideAnalyserBuffer = new Float32Array(
            this.state.scoring.vocalGuideAnalyser.fftSize,
          );
        }

        this.state.scoring.vocalGuideAnalyser.getFloatTimeDomainData(
          this.guideAnalyserBuffer,
        );
        const [guidePitch, guideClarity] =
          this.state.scoring.pitchDetector.findPitch(
            this.guideAnalyserBuffer,
            sampleRate,
          );

        isGuideNoteActive =
          guideClarity >= GUIDE_CLARITY_THRESHOLD && guidePitch > 50;
        if (isGuideNoteActive) {
          targetMidiPitch = 12 * Math.log2(guidePitch / 440) + 69;
        }
      }

      const wasGuideNoteActive = this.state.scoring.isVocalGuideNoteActive;
      this.state.scoring.isVocalGuideNoteActive = isGuideNoteActive;

      if (isGuideNoteActive && !wasGuideNoteActive) {
        this.state.scoring.totalScorableNotes++;
        this.state.scoring.hasHitCurrentNote = false;
      }

      isCorrectPitch = false;
      this.state.scoring.currentMicMidi = 0;

      if (isVisuallySinging) {
        let referencePitch = targetMidiPitch;

        if (!isGuideNoteActive) {
          if (hasGuideNotes) {
            const nextNote = this.state.playback.guideNotes.find(
              (n) => n.startTime >= currentTime,
            );
            if (nextNote)
              referencePitch = nextNote.pitch + this.state.playback.transpose;
          }

          if (referencePitch === 0) {
            const minMidi =
              (this.state.playback.guideRange?.min ?? 42) +
              this.state.playback.transpose;
            const maxMidi =
              (this.state.playback.guideRange?.max ?? 90) +
              this.state.playback.transpose;
            referencePitch = (minMidi + maxMidi) / 2;
          }
        }

        if (
          this.state.scoring.currentOctaveOffset === undefined ||
          !this.state.scoring.wasVisuallySinging
        ) {
          this.state.scoring.currentOctaveOffset =
            Math.round((referencePitch - this.state.scoring.rawMicMidi) / 12) *
            12;
        }

        let normalizedMicMidi =
          this.state.scoring.rawMicMidi +
          this.state.scoring.currentOctaveOffset;

        if (Math.abs(normalizedMicMidi - referencePitch) > 7) {
          this.state.scoring.currentOctaveOffset =
            Math.round((referencePitch - this.state.scoring.rawMicMidi) / 12) *
            12;
          normalizedMicMidi =
            this.state.scoring.rawMicMidi +
            this.state.scoring.currentOctaveOffset;
        }

        if (!this.state.scoring.wasVisuallySinging) {
          this.state.scoring.smoothedMicMidi = normalizedMicMidi;
        } else {
          this.state.scoring.smoothedMicMidi +=
            (normalizedMicMidi - this.state.scoring.smoothedMicMidi) * 0.4;
        }

        this.state.scoring.currentMicMidi = this.state.scoring.smoothedMicMidi;

        if (isGuideNoteActive && isSingingStrict) {
          if (
            Math.abs(this.state.scoring.currentMicMidi - targetMidiPitch) < 0.8
          ) {
            isCorrectPitch = true;
          }
        }
      }

      this.state.scoring.wasVisuallySinging = isVisuallySinging;

      if (isCorrectPitch && !this.state.scoring.hasHitCurrentNote) {
        this.state.scoring.hasHitCurrentNote = true;
        this.state.scoring.notesHit++;
      }

      if (this.state.scoring.totalScorableNotes > 0) {
        this.state.scoring.details.accuracy = Math.min(
          100,
          (this.state.scoring.notesHit /
            this.state.scoring.totalScorableNotes) *
            100,
        );
      }
      this.state.scoring.finalScore = this.state.scoring.details.accuracy;
    } else {
      // Key-Aware Scoring Fallback
      this.state.scoring.frameCount++;

      // Seed key immediately from pre-analyzed MIDI metadata if not yet initialized
      if (
        !this.state.scoring.currentKeyName &&
        this.state.playback.isMidi &&
        this.state.playback.midiInfo?.pitchClass !== null &&
        this.state.playback.midiInfo?.pitchClass !== undefined
      ) {
        const transposedRoot =
          (this.state.playback.midiInfo.pitchClass +
            this.state.playback.transpose +
            24) %
          12;
        const mode =
          this.state.playback.midiInfo.scale === "minor" ? "Minor" : "Major";

        this.currentRootIndex = transposedRoot;
        this.currentMode = mode;
        this.state.scoring.currentKeyName = `${PITCH_CLASSES[transposedRoot]} ${mode}`;

        const intervals =
          mode === "Major" ? MAJOR_SCALE_INTERVALS : MINOR_SCALE_INTERVALS;
        this.state.scoring.allowedPitchClasses = intervals.map(
          (interval) => (transposedRoot + interval) % 12,
        );

        // Pre-fill history to anchor dynamic votes
        this.state.scoring.keyHistory = Array(6).fill({
          root: transposedRoot,
          mode,
          name: this.state.scoring.currentKeyName,
          correlation: 1.0,
        });

        logVerbose(
          `Key-Aware Scoring seeded from MIDI analysis: ${this.state.scoring.currentKeyName}`,
        );
      }

      if (this.state.scoring.frameCount % 3 === 0) {
        if (this.state.playback.isMidi) {
          for (let i = 0; i < 12; i++) {
            this.state.scoring.rollingChroma[i] *= 0.85;
          }
          for (const note of this.state.scoring.activeMidiNotes) {
            const transposedNote = note + this.state.playback.transpose;
            this.state.scoring.rollingChroma[
              ((transposedNote % 12) + 12) % 12
            ] += 0.15;
          }
        } else if (
          this.state.scoring.meydaAnalyzer &&
          typeof Meyda !== "undefined"
        ) {
          const features = this.state.scoring.meydaAnalyzer.get("chroma");
          if (features) {
            for (let i = 0; i < 12; i++) {
              this.state.scoring.rollingChroma[i] =
                this.state.scoring.rollingChroma[i] * 0.85 + features[i] * 0.15;
            }
          }
        }

        if (this.state.scoring.frameCount % 30 === 0) {
          const detected = detectMusicalKey(this.state.scoring.rollingChroma);

          if (detected.correlation > 0.3) {
            this.state.scoring.keyHistory.push(detected);
          } else {
            this.state.scoring.keyHistory.push({ name: "Unknown" });
          }

          if (this.state.scoring.keyHistory.length > 6) {
            this.state.scoring.keyHistory.shift();
          }

          const votes = {};
          let maxVotes = 0;
          let votedRoot = 0;
          let votedMode = "";

          for (const k of this.state.scoring.keyHistory) {
            if (k.name === "Unknown") continue;
            const keyId = `${k.root}_${k.mode}`;
            votes[keyId] = (votes[keyId] || 0) + 1;
            if (votes[keyId] > maxVotes) {
              maxVotes = votes[keyId];
              votedRoot = k.root;
              votedMode = k.mode;
            }
          }

          if (maxVotes >= 2) {
            const isPitchOrModeDifferent =
              this.currentRootIndex !== votedRoot ||
              this.currentMode !== votedMode;

            // Lock initial key on 2 votes, require 4 votes to confirm live modulation
            if (
              !this.state.scoring.currentKeyName ||
              (isPitchOrModeDifferent && maxVotes >= 4)
            ) {
              const wasInitialLock = !this.state.scoring.currentKeyName;
              this.currentRootIndex = votedRoot;
              this.currentMode = votedMode;
              this.state.scoring.currentKeyName = `${PITCH_CLASSES[votedRoot]} ${votedMode}`;

              const intervals =
                votedMode === "Major"
                  ? MAJOR_SCALE_INTERVALS
                  : MINOR_SCALE_INTERVALS;
              this.state.scoring.allowedPitchClasses = intervals.map(
                (interval) => (votedRoot + interval) % 12,
              );

              logVerbose(
                wasInitialLock
                  ? `Initial Key Locked: ${this.state.scoring.currentKeyName} (${maxVotes}/6 votes)`
                  : `Key Modulation Confirmed: ${this.state.scoring.currentKeyName} (${maxVotes}/6 votes)`,
              );
            }
          }
        }
      }

      if (
        isKeyAwareSinging &&
        this.state.scoring.allowedPitchClasses.length > 0
      ) {
        this.state.scoring.totalFramesSinging++;
        const pitchClass = Math.round(keyAwareMidiPitch) % 12;

        if (this.state.scoring.allowedPitchClasses.includes(pitchClass)) {
          this.state.scoring.framesInKey++;
        }
      }

      if (this.state.scoring.totalFramesSinging > 0) {
        const rawAccuracy =
          (this.state.scoring.framesInKey /
            this.state.scoring.totalFramesSinging) *
          100;
        const participationMultiplier = Math.min(
          1.0,
          this.state.scoring.totalFramesSinging / MIN_FRAMES_FOR_FULL_SCORE,
        );
        this.state.scoring.details.accuracy =
          rawAccuracy * participationMultiplier;
      } else {
        this.state.scoring.details.accuracy = 0;
      }

      this.state.scoring.finalScore = this.state.scoring.details.accuracy;
    }

    this.state.scoring.micPitchHistory.push({
      time: currentTime,
      pitch: this.state.scoring.currentMicMidi,
      isSinging: isVisuallySinging,
    });

    while (
      this.state.scoring.micPitchHistory.length > 0 &&
      this.state.scoring.micPitchHistory[0].time < currentTime - 30
    ) {
      this.state.scoring.micPitchHistory.shift();
    }

    if (this.state.ui.pianoRollVisible && hasGuideNotes) {
      const currentNote = this.state.playback.guideNotes.find(
        (n) =>
          currentTime >= n.startTime && currentTime < n.startTime + n.duration,
      );

      if (currentNote) {
        if (isCorrectPitch) {
          currentNote.hitStatus = "hit";
        } else if (isSingingStrict) {
          currentNote.hitStatus = "miss";
        }
      }
    }
  }

  /**
   * Force overwrites the mic delay.
   *
   * @param {number} latencySeconds - Decimal value fixing input buffers.
   */
  setLatency(latencySeconds) {
    if (typeof latencySeconds !== "number" || isNaN(latencySeconds)) return;
    this.state.scoring.measuredLatencyS = Math.max(
      0,
      Math.min(1, latencySeconds),
    );
    logVerbose(`Latency set to ${latencySeconds * 1000}ms`);
  }

  /**
   * Gets the active scoring metrics.
   *
   * @returns {Object} Accuracy mapping metrics.
   */
  getScoringState() {
    return {
      finalScore: this.state.scoring.finalScore,
      details: this.state.scoring.details,
    };
  }
}
