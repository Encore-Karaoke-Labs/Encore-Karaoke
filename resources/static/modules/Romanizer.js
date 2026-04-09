/**
 * Romanizer - Utility for converting non-Latin scripts to Latin characters
 */
const Romanizer = {
  /**
   * Generates a placeholder string by replacing non-whitespace characters
   * @param {string} text - The text to create a placeholder for
   * @param {string} placeholderChar - The character to replace non-whitespace with
   * @returns {string} Text with non-whitespace characters replaced
   */
  getPlaceholder(text, placeholderChar) {
    return text.replace(/\S/g, placeholderChar);
  },

  /**
   * Romanizes text by converting Japanese or Korean characters to Latin script
   * @param {string} text - The text to romanize
   * @returns {Promise<string|null>} Romanized text or null if not applicable or on error
   */
  async romanize(text) {
    if (!text || !text.trim()) return null;
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)) {
      try {
        return await window.romanization.romanize(text);
      } catch (err) {
        console.error(`[Romanizer] Network error:`, err);
        return null;
      }
    }
    if (/[\uac00-\ud7af]/.test(text)) {
      return typeof Aromanize !== "undefined" ? Aromanize.romanize(text) : text;
    }
    return null;
  },
};

export default Romanizer;
