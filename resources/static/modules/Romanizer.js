const Romanizer = {
  getPlaceholder(text, placeholderChar) {
    return text.replace(/\S/g, placeholderChar);
  },
  async romanize(text) {
    if (!text || !text.trim()) return null;
    // Japanese
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)) {
      try {
        const params = new URLSearchParams({ t: text });
        const url = `http://127.0.0.1:9864/romanize?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.text();
      } catch (err) {
        console.error(`[Romanizer] Network error:`, err);
        return null;
      }
    }
    // Korean
    if (/[\uac00-\ud7af]/.test(text)) {
      return typeof Aromanize !== "undefined" ? Aromanize.romanize(text) : text;
    }
    return null;
  },
};

export default Romanizer;
