import { logVerbose } from "../core/State.js";

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

/** Precomputes normalized profiles for all 24 keys. */
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

function correlateChroma(normChroma, candidateWeights) {
  let r = 0;
  for (let i = 0; i < 12; i++) {
    r += normChroma[i] * candidateWeights[i];
  }
  return r;
}

export class ForteHarana {
  constructor(state) {
    this.state = state;
  }

  /**
   * Detects the best-fitting key in a note range.
   * @param {Array<Object>} notes Notes to analyze.
   * @param {number} startIndex First note index.
   * @param {number|null} count Number of notes, or null for the remainder.
   * @returns {Object|null} Best-fitting key candidate.
   */
  detectKeyFromNotes(notes, startIndex = 0, count = null) {
    if (!notes || notes.length === 0) return null;
    const start = Math.max(0, startIndex);
    const end =
      count !== null ? Math.min(notes.length, start + count) : notes.length;
    if (start >= end) return null;

    const chroma = new Float64Array(12);
    for (let i = start; i < end; i++) {
      const note = notes[i];
      const pitch = note.pitch ?? note.midiNote;
      if (pitch === undefined || pitch === null) continue;
      const pc = ((Math.round(pitch) % 12) + 12) % 12;
      const duration = Math.max(0.05, Math.min(note.duration || 0.1, 4.0));
      chroma[pc] += duration;
    }

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
  }

  /**
   * Checks whether a pitch belongs to the candidate key.
   * @param {number} midiPitch MIDI note number.
   * @param {Object} keyCandidate Key candidate.
   * @returns {boolean} Whether the pitch is in key.
   */
  isNoteInKey(midiPitch, keyCandidate) {
    if (!keyCandidate || !keyCandidate.allowedPitchClasses) return true;
    const pc = ((Math.round(midiPitch) % 12) + 12) % 12;
    return keyCandidate.allowedPitchClasses.includes(pc);
  }

  /**
   * Detects the guide melody's base key and modulation points.
   * @param {Array<Object>} guideNotes Monophonic guide notes.
   * @returns {Object|null} Base key, modulations, and key segments.
   */
  analyzeGuideKeyTimeline(guideNotes) {
    if (!guideNotes || guideNotes.length === 0) return null;

    const baseSampleCount = Math.min(
      guideNotes.length,
      Math.max(16, Math.min(36, Math.floor(guideNotes.length * 0.35))),
    );
    const baseKey =
      this.detectKeyFromNotes(guideNotes, 0, baseSampleCount) ||
      this.detectKeyFromNotes(guideNotes, 0, guideNotes.length);

    if (!baseKey) return null;

    let currentKey = baseKey;
    let feverLevel = 0; // 0 = Base Key (Normal), 1 = FEVER, 2 = SUPER FEVER
    const modulations = [];
    const keySegments = [];

    let segmentStartTime = guideNotes[0].startTime || 0;
    let segmentStartNoteIndex = 0;

    let i = 0;
    while (i < guideNotes.length) {
      const note = guideNotes[i];
      const inKey = this.isNoteInKey(note.pitch, currentKey);

      if (inKey) {
        note.isInKey = true;
        note.isAnomaly = false;
        note.isModulation = false;
        note.key = currentKey.key;
        note.isModulated = feverLevel > 0;
        note.isSubsequentModulated = feverLevel >= 2;
        note.feverLevel = feverLevel;
        i++;
        continue;
      }

      const lookaheadCount = Math.min(6, guideNotes.length - (i + 1));
      let upcomingOutCount = 0;

      for (let k = 1; k <= lookaheadCount; k++) {
        if (!this.isNoteInKey(guideNotes[i + k].pitch, currentKey)) {
          upcomingOutCount++;
        }
      }

      if (upcomingOutCount < 2) {
        note.isInKey = false;
        note.isAnomaly = true;
        note.isModulation = false;
        note.key = currentKey.key;
        note.isModulated = feverLevel > 0;
        note.isSubsequentModulated = feverLevel >= 2;
        note.feverLevel = feverLevel;
        i++;
        continue;
      }

      const reanalysisWindow = Math.min(guideNotes.length - i, 24);
      const candidateKey = this.detectKeyFromNotes(
        guideNotes,
        i,
        reanalysisWindow,
      );

      let modulated = false;

      if (
        candidateKey &&
        (candidateKey.pitchClass !== currentKey.pitchClass ||
          candidateKey.scale !== currentKey.scale) &&
        candidateKey.correlation >= 0.35
      ) {
        let candidateMatches = 0;
        let currentMatches = 0;

        for (let k = 0; k < reanalysisWindow; k++) {
          const p = guideNotes[i + k].pitch;
          if (this.isNoteInKey(p, candidateKey)) candidateMatches++;
          if (this.isNoteInKey(p, currentKey)) currentMatches++;
        }

        const candidateFit = candidateMatches / reanalysisWindow;
        const currentFit = currentMatches / reanalysisWindow;

        const isConfirmed =
          candidateFit >= 0.75 &&
          candidateMatches > currentMatches + 1 &&
          currentFit <= 0.65;

        if (isConfirmed) {
          let modStartIndex = i;
          const maxBacktrack = Math.max(segmentStartNoteIndex, i - 6);

          for (let j = i - 1; j >= maxBacktrack; j--) {
            const pNote = guideNotes[j];
            const nNote = guideNotes[j + 1];
            const onsetGap = nNote.startTime - pNote.startTime;

            if (onsetGap >= 1.5) {
              if (this.isNoteInKey(nNote.pitch, candidateKey)) {
                modStartIndex = j + 1;
              }
              break;
            }

            if (!this.isNoteInKey(pNote.pitch, candidateKey)) {
              modStartIndex = j + 1;
              break;
            }

            modStartIndex = j;
          }

          if (modStartIndex > segmentStartNoteIndex) {
            const modNote = guideNotes[modStartIndex];

            const wasCurrentBaseKey =
              currentKey.pitchClass === baseKey.pitchClass &&
              currentKey.scale === baseKey.scale;

            keySegments.push({
              startTime: segmentStartTime,
              endTime: modNote.startTime,
              startNoteIndex: segmentStartNoteIndex,
              endNoteIndex: modStartIndex - 1,
              key: currentKey.key,
              scale: currentKey.scale,
              root: currentKey.root,
              pitchClass: currentKey.pitchClass,
              allowedPitchClasses: currentKey.allowedPitchClasses,
              isOriginalKey: wasCurrentBaseKey,
              isModulated: !wasCurrentBaseKey,
              isSubsequentModulated: !wasCurrentBaseKey && feverLevel >= 2,
              feverLevel: wasCurrentBaseKey ? 0 : feverLevel,
            });

            const isReturnToBase =
              candidateKey.pitchClass === baseKey.pitchClass &&
              candidateKey.scale === baseKey.scale;

            if (isReturnToBase) {
              feverLevel = 0;
            } else if (feverLevel === 0) {
              feverLevel = 1;
            } else {
              feverLevel = 2;
            }

            modulations.push({
              noteIndex: modStartIndex,
              time: modNote.startTime,
              fromKey: currentKey.key,
              toKey: candidateKey.key,
              root: candidateKey.root,
              scale: candidateKey.scale,
              pitchClass: candidateKey.pitchClass,
              allowedPitchClasses: candidateKey.allowedPitchClasses,
              isReturnToBase,
              isModulated: !isReturnToBase,
              isSubsequent: feverLevel >= 2,
              feverLevel,
            });

            for (let k = modStartIndex; k <= i; k++) {
              const reNote = guideNotes[k];
              reNote.key = candidateKey.key;
              reNote.isInKey = this.isNoteInKey(reNote.pitch, candidateKey);
              reNote.isAnomaly = !reNote.isInKey;
              reNote.isModulation = k === modStartIndex;
              reNote.isModulated = !isReturnToBase;
              reNote.isSubsequentModulated = feverLevel >= 2;
              reNote.feverLevel = feverLevel;
            }

            currentKey = candidateKey;
            segmentStartTime = modNote.startTime;
            segmentStartNoteIndex = modStartIndex;
            modulated = true;
          }
        }
      }

      if (!modulated) {
        note.isInKey = false;
        note.isAnomaly = true;
        note.isModulation = false;
        note.key = currentKey.key;
        note.isModulated = feverLevel > 0;
        note.isSubsequentModulated = feverLevel >= 2;
        note.feverLevel = feverLevel;
      }

      i++;
    }

    if (currentKey) {
      const lastNote = guideNotes[guideNotes.length - 1];
      const isFinalBaseKey =
        currentKey.pitchClass === baseKey.pitchClass &&
        currentKey.scale === baseKey.scale;

      keySegments.push({
        startTime: segmentStartTime,
        endTime: (lastNote.startTime || 0) + (lastNote.duration || 1) + 15,
        startNoteIndex: segmentStartNoteIndex,
        endNoteIndex: guideNotes.length - 1,
        key: currentKey.key,
        scale: currentKey.scale,
        root: currentKey.root,
        pitchClass: currentKey.pitchClass,
        allowedPitchClasses: currentKey.allowedPitchClasses,
        isOriginalKey: isFinalBaseKey,
        isModulated: !isFinalBaseKey,
        isSubsequentModulated: !isFinalBaseKey && feverLevel >= 2,
        feverLevel: isFinalBaseKey ? 0 : feverLevel,
      });
    }

    logVerbose(
      `[HARANA] Base Key: ${baseKey.key} | Modulations: ${modulations.length}`,
      modulations,
    );

    return {
      baseKey,
      modulations,
      keySegments,
    };
  }

  /**
   * Gets the key active at a playback time, adjusted for transpose.
   * @param {number} currentTime Seconds into the track.
   * @param {number} transpose Semitone offset.
   * @returns {Object|null} Active key, or null if unavailable.
   */
  getActiveKey(currentTime = 0, transpose = 0) {
    const midiInfo = this.state?.playback?.midiInfo;
    if (!midiInfo) return null;

    let activeSegment = null;
    if (midiInfo.keySegments && midiInfo.keySegments.length > 0) {
      activeSegment = midiInfo.keySegments.find(
        (s) => currentTime >= s.startTime && currentTime < s.endTime,
      );
      if (!activeSegment) {
        activeSegment =
          currentTime >=
          midiInfo.keySegments[midiInfo.keySegments.length - 1].startTime
            ? midiInfo.keySegments[midiInfo.keySegments.length - 1]
            : midiInfo.keySegments[0];
      }
    }

    const rawPc = activeSegment
      ? activeSegment.pitchClass
      : midiInfo.pitchClass;
    const rawScale = activeSegment ? activeSegment.scale : midiInfo.scale;

    if (rawPc === null || rawPc === undefined) return null;

    const transposedPc = (((rawPc + transpose) % 12) + 12) % 12;
    const isMinor = rawScale === "minor";
    const rootNames = isMinor ? MINOR_ROOT_NAMES : MAJOR_ROOT_NAMES;
    const steps = isMinor ? MINOR_SCALE_STEPS : MAJOR_SCALE_STEPS;
    const rootName = rootNames[transposedPc];
    const keyName = `${rootName} ${isMinor ? "Minor" : "Major"}`;
    const allowedPitchClasses = steps
      .map((s) => (transposedPc + s) % 12)
      .sort((a, b) => a - b);

    const isModulated = Boolean(activeSegment?.isModulated);
    const isSubsequentModulated = Boolean(activeSegment?.isSubsequentModulated);

    return {
      root: rootName,
      scale: rawScale,
      pitchClass: transposedPc,
      key: keyName,
      allowedPitchClasses,
      isModulated,
      isSubsequentModulated,
    };
  }
}
