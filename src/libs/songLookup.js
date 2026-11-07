/**
 * Resolves a song from songMap (and optionally songList) regardless of
 * leading zeros or number/string typing.
 *
 * @param {Map} songMap - Map keyed by song code
 * @param {string|number} code - The song code to look up
 * @param {Array} [songList] - Optional fallback list to search
 * @returns {Object|null} The matching song or null
 */
export function findSongByCode(songMap, code, songList) {
  if (!songMap || !code) return null;
  const str = String(code).trim();
  if (!str) return null;

  const unpadded = str.replace(/^0+/, "");
  const num = parseInt(str, 10);

  const match =
    songMap.get(str) ??
    (unpadded ? songMap.get(unpadded) : null) ??
    (!isNaN(num) ? songMap.get(num) : null) ??
    (unpadded ? songMap.get(unpadded.padStart(5, "0")) : null) ??
    (unpadded ? songMap.get(unpadded.padStart(6, "0")) : null) ??
    songMap.get(str.padStart(5, "0")) ??
    songMap.get(str.padStart(6, "0")) ??
    null;

  if (match) return match;

  if (songList) {
    const code6 = str.padStart(6, "0");
    const code5 = str.padStart(5, "0");
    return (
      songList.find(
        (s) =>
          String(s.code).padStart(6, "0") === code6 ||
          String(s.code).padStart(5, "0") === code5 ||
          String(s.code) === str,
      ) || null
    );
  }

  return null;
}
