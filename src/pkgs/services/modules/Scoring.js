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

const MAJOR_PROFILE = [
  5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0,
];
const MINOR_PROFILE = [
  5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0,
];

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
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10, 11];

const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIC_CLARITY_THRESHOLD = 0.85;
const RMS_NOISE_GATE = 0.015;

const KEY_AWARE_RMS_GATE = 0.015;
const KEY_AWARE_CLARITY = 0.92;
const MIN_FRAMES_FOR_FULL_SCORE = 900;
const MIN_VOCAL_HZ = 75;
const MAX_VOCAL_HZ = 1200;

function detectMusicalKey(chromaArray) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chromaArray[i];
  if (sum === 0)
    return { root: 0, mode: "Major", name: "Unknown", correlation: 0 };

  const mean = sum / 12;
  let variance = 0;
  for (let i = 0; i < 12; i++) variance += Math.pow(chromaArray[i] - mean, 2);
  if (variance === 0)
    return { root: 0, mode: "Major", name: "Unknown", correlation: 0 };

  const std = Math.sqrt(variance);
  const normChroma = new Float32Array(12);
  for (let i = 0; i < 12; i++) normChroma[i] = (chromaArray[i] - mean) / std;

  let bestCorrelation = -1;
  let bestKeyIndex = 0;
  let bestMode = "Major";

  for (let rootIndex = 0; rootIndex < 12; rootIndex++) {
    let majorDot = 0;
    let minorDot = 0;
    for (let j = 0; j < 12; j++) {
      const val = normChroma[(rootIndex + j) % 12];
      majorDot += val * NORMALIZED_MAJOR[j];
      minorDot += val * NORMALIZED_MINOR[j];
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
  constructor(state, audioCore, pianoRoll, harana = null) {
    this.state = state;
    this.audioCore = audioCore;
    this.pianoRoll = pianoRoll;
    this.harana = harana;

    this.micAnalyserBuffer = null;
    this.guideAnalyserBuffer = null;
    this.currentRootIndex = null;
    this.currentMode = null;
  }

  /**
   * Initializes or updates the offline HARANA scoring session.
   */
  initHaranaSession(notes) {
    if (!notes || notes.length === 0) {
      this.state.scoring.haranaSession = null;
      return;
    }

    let vibratoOpportunities = 0;
    let transitionOpportunities = 0;
    let normalWeightSum = 0;
    let feverWeightSum = 0;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      note._samples = [];
      note._finalized = false;
      note._tier = "neutral";
      note._credit = 0;
      note._vibratoScore = 1.0;
      note._transitionScore = 1.0;

      // Vibrato opportunities on sustained notes >= 500ms
      note.hasVibratoOpportunity = note.duration >= 0.5;
      if (note.hasVibratoOpportunity) vibratoOpportunities++;

      // Transition opportunities on jumps of 2 semitones or more
      note.hasTransitionOpportunity = false;
      if (i > 0) {
        const prevNote = notes[i - 1];
        const leap = Math.abs(note.pitch - prevNote.pitch);
        const gap = note.startTime - (prevNote.startTime + prevNote.duration);
        if (leap >= 2 && gap <= 1.2) {
          note.hasTransitionOpportunity = true;
          note.prevPitch = prevNote.pitch;
          transitionOpportunities++;
        }
      }

      // FEVER Multipliers (1.25x for FEVER, 1.5x for SUPER FEVER)
      const feverLevel =
        note.feverLevel ||
        (note.isSubsequentModulated ? 2 : note.isModulated ? 1 : 0);
      note._feverLevel = feverLevel;
      note._rawMultiplier =
        feverLevel >= 2 ? 1.5 : feverLevel === 1 ? 1.25 : 1.0;

      const baseWeight = note.duration;
      if (feverLevel > 0) {
        feverWeightSum += baseWeight * note._rawMultiplier;
      } else {
        normalWeightSum += baseWeight;
      }
    }

    // FEVER segments can account for at most 35% of the final score
    const totalPotentialWeight = normalWeightSum + feverWeightSum;
    let feverScaleFactor = 1.0;
    if (totalPotentialWeight > 0 && feverWeightSum > 0) {
      const feverRatio = feverWeightSum / totalPotentialWeight;
      if (feverRatio > 0.35 && normalWeightSum > 0) {
        const maxAllowedFeverWeight = (0.35 * normalWeightSum) / 0.65;
        feverScaleFactor = maxAllowedFeverWeight / feverWeightSum;
      }
    }

    for (const note of notes) {
      if (note._feverLevel > 0) {
        note._effectiveWeight =
          note.duration * note._rawMultiplier * feverScaleFactor;
      } else {
        note._effectiveWeight = note.duration;
      }
    }

    // Weight redistribution back to Tonality
    const vibratoRatio =
      vibratoOpportunities > 0 ? Math.min(1.0, vibratoOpportunities / 6.0) : 0;
    const transitionRatio =
      transitionOpportunities > 0
        ? Math.min(1.0, transitionOpportunities / 8.0)
        : 0;

    const weightVibrato = 0.15 * vibratoRatio;
    const weightTransitions = 0.15 * transitionRatio;
    const weightTonality = 1.0 - weightVibrato - weightTransitions;

    this.state.scoring.haranaSession = {
      notes,
      vibratoOpportunities,
      transitionOpportunities,
      weights: {
        tonality: weightTonality,
        vibrato: weightVibrato,
        transitions: weightTransitions,
      },
      tiers: { accurate: 0, interpreted: 0, problematic: 0, missed: 0 },
      lastActiveIndex: 0,
    };

    logVerbose(
      `[HARANA] Weights => Tonality: ${(weightTonality * 100).toFixed(1)}%, ` +
        `Vibrato: ${(weightVibrato * 100).toFixed(1)}%, Transitions: ${(weightTransitions * 100).toFixed(1)}% | ` +
        `Opps => Vib: ${vibratoOpportunities}, Trans: ${transitionOpportunities}`,
    );
  }

  /**
   * Main scoring update cycle called continuously during playback.
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

    const hasGuideNotes =
      this.state.playback.guideNotes &&
      this.state.playback.guideNotes.length > 0;
    const isHaranaEligible =
      (this.state.playback.isMidi || this.state.playback.hasMidiGuide) &&
      hasGuideNotes;

    if (isHaranaEligible) {
      this.processHaranaScoring(
        currentTime,
        isSingingStrict,
        isVisuallySinging,
      );
    } else if (
      this.state.playback.isMultiplexed &&
      this.state.scoring.vocalGuideAnalyser
    ) {
      this.processMultiplexScoring(
        currentTime,
        isSingingStrict,
        isVisuallySinging,
        sampleRate,
      );
    } else {
      this.processKeyAwareScoring(
        currentTime,
        micPitch,
        micClarity,
        rms,
        isValidPitch,
      );
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
  }

  /**
   * HARANA Interpretation-based scoring pipeline.
   */
  processHaranaScoring(currentTime, isSingingStrict, isVisuallySinging) {
    const notes = this.state.playback.guideNotes;
    if (
      !this.state.scoring.haranaSession ||
      this.state.scoring.haranaSession.notes !== notes
    ) {
      this.initHaranaSession(notes);
    }
    const session = this.state.scoring.haranaSession;
    const transpose = this.state.playback.transpose || 0;

    const activeKey = this.harana
      ? this.harana.getActiveKey(currentTime, transpose)
      : null;
    const allowedPitchClasses = activeKey?.allowedPitchClasses || [];

    // Find currently active guide note
    let currentNote = null;
    let nextUpcomingNote = null;

    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (
        currentTime >= n.startTime &&
        currentTime < n.startTime + n.duration
      ) {
        currentNote = n;
        break;
      }
      if (n.startTime > currentTime && !nextUpcomingNote) {
        nextUpcomingNote = n;
      }
    }

    const isGuideNoteActive = Boolean(currentNote);
    this.state.scoring.isVocalGuideNoteActive = isGuideNoteActive;

    let targetGuidePitch = 0;
    if (currentNote) {
      targetGuidePitch = currentNote.pitch + transpose;
    } else if (nextUpcomingNote) {
      targetGuidePitch = nextUpcomingNote.pitch + transpose;
    } else {
      const minMidi = (this.state.playback.guideRange?.min ?? 42) + transpose;
      const maxMidi = (this.state.playback.guideRange?.max ?? 90) + transpose;
      targetGuidePitch = (minMidi + maxMidi) / 2;
    }

    // Octave Normalization
    if (isVisuallySinging && this.state.scoring.rawMicMidi > 0) {
      if (
        this.state.scoring.currentOctaveOffset === undefined ||
        !this.state.scoring.wasVisuallySinging
      ) {
        this.state.scoring.currentOctaveOffset =
          Math.round((targetGuidePitch - this.state.scoring.rawMicMidi) / 12) *
          12;
      }

      let normalizedMicMidi =
        this.state.scoring.rawMicMidi + this.state.scoring.currentOctaveOffset;

      if (Math.abs(normalizedMicMidi - targetGuidePitch) > 7) {
        this.state.scoring.currentOctaveOffset =
          Math.round((targetGuidePitch - this.state.scoring.rawMicMidi) / 12) *
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
    } else {
      this.state.scoring.currentMicMidi = 0;
    }

    this.state.scoring.wasVisuallySinging = isVisuallySinging;

    if (currentNote) {
      const guidePitch = currentNote.pitch + transpose;
      const singerPitch = this.state.scoring.currentMicMidi;
      let frameTier = "silent";

      if (isSingingStrict && singerPitch > 0) {
        const pitchDiff = singerPitch - guidePitch;
        const singerPitchClass = ((Math.round(singerPitch) % 12) + 12) % 12;
        const inKey = allowedPitchClasses.includes(singerPitchClass);

        if (Math.abs(pitchDiff) <= 0.85) {
          frameTier = "accurate";
        } else if (inKey) {
          frameTier = "interpreted";
        } else if (pitchDiff < -0.85) {
          frameTier = "problematic";
        } else {
          frameTier = "miss";
        }

        currentNote._samples.push({
          time: currentTime,
          pitch: singerPitch,
          tier: frameTier,
        });

        currentNote.hitStatus = frameTier;
        this.state.scoring.details.currentTier = frameTier;
      }
    }

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note._finalized) continue;
      if (currentTime < note.startTime + note.duration) break;

      this.finalizeHaranaNote(note, transpose);
    }

    this.calculateHaranaScore(currentTime);
  }

  /**
   * Finalizes a completed note: assigns tier credit, vibrato, and transition metrics.
   */
  finalizeHaranaNote(note, transpose) {
    note._finalized = true;
    const samples = note._samples || [];

    let counts = { accurate: 0, interpreted: 0, problematic: 0, miss: 0 };
    for (const s of samples) {
      if (counts[s.tier] !== undefined) counts[s.tier]++;
    }

    const totalSamples = samples.length;
    let finalTier = "miss";
    let credit = 0.0;

    if (totalSamples < 3) {
      finalTier = "miss";
      credit = 0.0;
    } else if (
      counts.accurate >= totalSamples * 0.35 ||
      (counts.accurate >= counts.interpreted &&
        counts.accurate >= counts.problematic &&
        counts.accurate >= counts.miss)
    ) {
      finalTier = "accurate";
      credit = 1.0;
    } else if (
      counts.interpreted >= counts.problematic &&
      counts.interpreted >= counts.miss
    ) {
      finalTier = "interpreted";
      credit = 0.95;
    } else if (counts.problematic >= counts.miss) {
      finalTier = "problematic";
      credit = 0.4;
    } else {
      finalTier = "miss";
      credit = 0.0;
    }

    note._tier = finalTier;
    note._credit = credit;
    note.hitStatus = finalTier;

    if (note.hasVibratoOpportunity) {
      if (samples.length >= 10) {
        let pitchSum = 0;
        for (const s of samples) pitchSum += s.pitch;
        const meanPitch = pitchSum / samples.length;

        let zeroCrossings = 0;
        let lastDev = samples[0].pitch - meanPitch;
        let minPitch = Infinity;
        let maxPitch = -Infinity;

        for (let i = 1; i < samples.length; i++) {
          const dev = samples[i].pitch - meanPitch;
          if ((dev >= 0 && lastDev < 0) || (dev < 0 && lastDev >= 0)) {
            zeroCrossings++;
          }
          lastDev = dev;
          if (samples[i].pitch < minPitch) minPitch = samples[i].pitch;
          if (samples[i].pitch > maxPitch) maxPitch = samples[i].pitch;
        }

        const durationS = samples[samples.length - 1].time - samples[0].time;
        const freq = durationS > 0 ? zeroCrossings / 2 / durationS : 0;
        const depth = maxPitch - minPitch;

        if (depth < 0.35) {
          // Straight tone
          note._vibratoScore = 1.0;
        } else if (freq >= 4.2 && freq <= 7.8 && depth <= 1.8) {
          // Controlled vocal vibrato
          note._vibratoScore = 1.0;
        } else if (freq > 8.0) {
          // Fluttering
          note._vibratoScore = 0.35;
        } else {
          // Irregular / uneven
          note._vibratoScore = 0.65;
        }
      } else {
        note._vibratoScore = 0.0;
      }
    }

    if (note.hasTransitionOpportunity) {
      const targetPitch = note.pitch + transpose;
      if (samples.length > 0) {
        let reachedTime = -1;
        for (const s of samples) {
          if (Math.abs(s.pitch - targetPitch) <= 1.0) {
            reachedTime = s.time - note.startTime;
            break;
          }
        }

        if (reachedTime >= 0 && reachedTime <= 0.15) {
          note._transitionScore = 1.0; // Fast
        } else if (reachedTime > 0.15 && reachedTime <= 0.28) {
          note._transitionScore = 0.75;
        } else if (reachedTime > 0.28) {
          note._transitionScore = 0.5; // Slow glide/hunt
        } else {
          note._transitionScore = 0.2; // Transition miss
        }
      } else {
        note._transitionScore = 0.0;
      }
    }
  }

  /**
   * Calculates progressive total score out of 100 with dynamic criteria weights.
   */
  calculateHaranaScore(currentTime) {
    const session = this.state.scoring.haranaSession;
    if (!session) return;

    let evaluatedNotesWeight = 0;
    let earnedTonalityWeight = 0;
    let vibratoTotal = 0;
    let vibratoCount = 0;
    let transitionTotal = 0;
    let transitionCount = 0;

    let tierCounts = { accurate: 0, interpreted: 0, problematic: 0, missed: 0 };

    for (const note of session.notes) {
      if (!note._finalized) continue;

      evaluatedNotesWeight += note._effectiveWeight;
      earnedTonalityWeight += note._credit * note._effectiveWeight;

      if (note._tier === "accurate") tierCounts.accurate++;
      else if (note._tier === "interpreted") tierCounts.interpreted++;
      else if (note._tier === "problematic") tierCounts.problematic++;
      else tierCounts.missed++;

      if (note.hasVibratoOpportunity) {
        vibratoTotal += note._vibratoScore;
        vibratoCount++;
      }
      if (note.hasTransitionOpportunity) {
        transitionTotal += note._transitionScore;
        transitionCount++;
      }
    }

    if (evaluatedNotesWeight === 0) {
      this.state.scoring.finalScore = 0;
      this.state.scoring.details.accuracy = 0;
      return;
    }

    const tonalityScore = (earnedTonalityWeight / evaluatedNotesWeight) * 100;
    const vibratoScore =
      vibratoCount > 0 ? (vibratoTotal / vibratoCount) * 100 : 100;
    const transitionScore =
      transitionCount > 0 ? (transitionTotal / transitionCount) * 100 : 100;

    const {
      tonality: wTon,
      vibrato: wVib,
      transitions: wTrans,
    } = session.weights;
    const rawFinalScore =
      tonalityScore * wTon + vibratoScore * wVib + transitionScore * wTrans;

    const clampedScore = Math.max(0, Math.min(100, Math.round(rawFinalScore)));

    this.state.scoring.finalScore = clampedScore;
    this.state.scoring.details = {
      accuracy: clampedScore,
      tonality: Math.round(tonalityScore),
      vibrato: Math.round(vibratoScore),
      transitions: Math.round(transitionScore),
      weights: {
        tonality: Math.round(wTon * 100),
        vibrato: Math.round(wVib * 100),
        transitions: Math.round(wTrans * 100),
      },
      tiers: tierCounts,
      currentTier: this.state.scoring.details.currentTier || "neutral",
      feverLevel: this.harana?.getActiveKey(currentTime)?.isSubsequentModulated
        ? 2
        : this.harana?.getActiveKey(currentTime)?.isModulated
          ? 1
          : 0,
      feverActive: Boolean(this.harana?.getActiveKey(currentTime)?.isModulated),
    };
  }

  /**
   * Fallback: Legacy pitch-matching scoring for Multiplex tracks.
   */
  processMultiplexScoring(
    currentTime,
    isSingingStrict,
    isVisuallySinging,
    sampleRate,
  ) {
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

    const isGuideNoteActive =
      guideClarity >= GUIDE_CLARITY_THRESHOLD && guidePitch > 50;
    let targetMidiPitch = 0;
    if (isGuideNoteActive) {
      targetMidiPitch =
        12 * Math.log2(guidePitch / 440) + 69 + this.state.playback.transpose;
    }

    const wasGuideNoteActive = this.state.scoring.isVocalGuideNoteActive;
    this.state.scoring.isVocalGuideNoteActive = isGuideNoteActive;

    if (isGuideNoteActive && !wasGuideNoteActive) {
      this.state.scoring.totalScorableNotes++;
      this.state.scoring.hasHitCurrentNote = false;
    }

    let isCorrectPitch = false;
    this.state.scoring.currentMicMidi = 0;

    if (isVisuallySinging) {
      let referencePitch = targetMidiPitch || 60;
      if (
        this.state.scoring.currentOctaveOffset === undefined ||
        !this.state.scoring.wasVisuallySinging
      ) {
        this.state.scoring.currentOctaveOffset =
          Math.round((referencePitch - this.state.scoring.rawMicMidi) / 12) *
          12;
      }

      let normalizedMicMidi =
        this.state.scoring.rawMicMidi + this.state.scoring.currentOctaveOffset;
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
        (this.state.scoring.notesHit / this.state.scoring.totalScorableNotes) *
          100,
      );
    }
    this.state.scoring.finalScore = Math.round(
      this.state.scoring.details.accuracy,
    );
  }

  /**
   * Fallback: Legacy Real-time Key-Aware Scoring for RealSound tracks without MIDI guide.
   */
  processKeyAwareScoring(currentTime, micPitch, micClarity, rms, isValidPitch) {
    this.state.scoring.frameCount++;
    const isKeyAwareSinging =
      micClarity > KEY_AWARE_CLARITY &&
      isValidPitch &&
      rms > KEY_AWARE_RMS_GATE;
    const keyAwareMidiPitch = isKeyAwareSinging
      ? 12 * Math.log2(micPitch / 440) + 69
      : 0;

    if (this.state.scoring.frameCount % 3 === 0) {
      if (this.state.playback.isMidi) {
        for (let i = 0; i < 12; i++)
          this.state.scoring.rollingChroma[i] *= 0.85;
        for (const note of this.state.scoring.activeMidiNotes) {
          const transposedNote = note + this.state.playback.transpose;
          this.state.scoring.rollingChroma[((transposedNote % 12) + 12) % 12] +=
            0.15;
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
        if (this.state.scoring.keyHistory.length > 6)
          this.state.scoring.keyHistory.shift();

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
          if (
            !this.state.scoring.currentKeyName ||
            (isPitchOrModeDifferent && maxVotes >= 4)
          ) {
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

    this.state.scoring.finalScore = Math.round(
      this.state.scoring.details.accuracy,
    );
  }

  setLatency(latencySeconds) {
    if (typeof latencySeconds !== "number" || isNaN(latencySeconds)) return;
    this.state.scoring.measuredLatencyS = Math.max(
      0,
      Math.min(1, latencySeconds),
    );
    logVerbose(`Latency set to ${latencySeconds * 1000}ms`);
  }

  getScoringState() {
    return {
      finalScore: this.state.scoring.finalScore,
      details: this.state.scoring.details,
    };
  }
}
