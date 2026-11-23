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

/**
 * Calculates Pearson correlation coefficient between a normalized chroma vector and candidate weights.
 * @param {Float64Array|Float32Array} normChroma - Normalized 12-element chroma.
 * @param {Float64Array|Float32Array} candidateWeights - Normalized 12-element candidate weights.
 * @returns {number}
 */
function correlateChroma(normChroma, candidateWeights) {
  let r = 0;
  for (let i = 0; i < 12; i++) {
    r += normChroma[i] * candidateWeights[i];
  }
  return r;
}

/**
 * Normalizes a 12-element chroma vector to zero mean / unit variance.
 * @param {Array<number>|Float64Array|Float32Array} chromaArray - Raw 12-element chroma.
 * @returns {Float32Array|null} Normalized chroma, or null if variance is zero.
 */
function normalizeChroma(chromaArray) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chromaArray[i];
  if (sum === 0) return null;

  const mean = sum / 12;
  let variance = 0;
  for (let i = 0; i < 12; i++) variance += Math.pow(chromaArray[i] - mean, 2);
  if (variance === 0) return null;

  const std = Math.sqrt(variance);
  const normChroma = new Float32Array(12);
  for (let i = 0; i < 12; i++) normChroma[i] = (chromaArray[i] - mean) / std;
  return normChroma;
}

/**
 * Detects the best matching musical key for a chroma vector against a set of candidates.
 * @param {Array<number>|Float64Array|Float32Array} chromaArray - Raw 12-element chroma.
 * @param {Array<Object>} candidates - Array of {pitchClass, scale, key, shortKey, weights}.
 * @returns {Object} {pitchClass, scale, key, shortKey, correlation} or {pitchClass:0, scale:"Major", key:"Unknown", correlation:0}
 */
function detectMusicalKey(chromaArray, candidates) {
  const normChroma = normalizeChroma(chromaArray);
  if (!normChroma) {
    return { pitchClass: 0, scale: "Major", key: "Unknown", correlation: 0 };
  }

  let bestCorrelation = -1;
  let best = candidates[0] || { pitchClass: 0, scale: "Major", key: "Unknown" };

  for (const candidate of candidates) {
    const corr = correlateChroma(normChroma, candidate.weights);
    if (corr > bestCorrelation) {
      bestCorrelation = corr;
      best = candidate;
    }
  }

  return {
    pitchClass: best.pitchClass,
    scale: best.scale,
    key: best.key,
    shortKey: best.shortKey,
    correlation: bestCorrelation,
  };
}

export {
  MAJOR_PROFILE,
  MINOR_PROFILE,
  MAJOR_ROOT_NAMES,
  MINOR_ROOT_NAMES,
  MAJOR_SCALE_STEPS,
  MINOR_SCALE_STEPS,
  KEY_CANDIDATES,
  correlateChroma,
  normalizeChroma,
  detectMusicalKey,
};
