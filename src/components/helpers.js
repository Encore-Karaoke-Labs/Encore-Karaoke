/**
 * Normalizes a class option into an array of non-empty class names.
 * @param {string|string[]|null|undefined} classes
 * @returns {string[]}
 */
export function normalizeClasses(classes) {
  if (classes === undefined || classes === null || classes === "") return [];
  return Array.isArray(classes) ? classes.filter(Boolean) : [classes];
}

/**
 * Converts a percentage into a clamped 0-100 number.
 * @param {number|string} value
 * @returns {number}
 */
export function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}
