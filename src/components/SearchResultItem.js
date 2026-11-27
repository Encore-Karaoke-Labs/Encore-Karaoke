import Html from "../libs/html.js";
import FormatBadge from "./FormatBadge.js";

/**
 * Search result row for both local library songs and YouTube videos.
 *
 * @example
 * new SearchResultItem({
 *   result,
 *   format: library.getFormatInfo(result),
 *   onClick: () => submit(),
 * }).appendTo(resultsContainer);
 */
class SearchResultItem extends Html {
  /**
   * @param {Object} options
   * @param {Object} options.result - Search result entry.
   * @param {{label: string, color: string}} [options.format] - Format descriptor.
   * @param {boolean} [options.highlighted] - Initial highlight state.
   * @param {Function} [options.onClick] - Click handler.
   */
  constructor({ result, format = null, highlighted = false, onClick = null } = {}) {
    super("div");
    this.classOn("search-result-item");
    if (onClick) this.on("click", onClick);

    if (result.type === "local") {
      this.buildLocalResult(result, format);
    } else {
      this.buildYouTubeResult(result, format);
    }

    this.setHighlighted(highlighted);
  }

  /**
   * @param {Object} result
   * @param {{label: string, color: string}|null} format
   */
  buildLocalResult(result, format) {
    const info = new Html("div").classOn("search-info").appendTo(this);
    const titleRow = new Html("div").classOn("search-title").appendTo(info);

    if (format) {
      new FormatBadge({
        label: format.label,
        color: format.color,
      }).appendTo(titleRow);
    }

    new Html("span").text(result.title).appendTo(titleRow);

    if (result.displayRomaTitle) {
      new Html("span")
        .text(` (${result.displayRomaTitle})`)
        .styleJs({ color: "#aaa", fontSize: "0.9em", marginLeft: "0.5rem" })
        .appendTo(titleRow);
    }

    const artistRow = new Html("div").classOn("search-channel").appendTo(info);
    new Html("span").text(result.artist).appendTo(artistRow);

    if (result.displayRomaArtist) {
      new Html("span")
        .text(` (${result.displayRomaArtist})`)
        .styleJs({ color: "#aaa", fontSize: "0.9em", marginLeft: "0.5rem" })
        .appendTo(artistRow);
    }

    new Html("div")
      .classOn("search-result-local-code")
      .text(String(result.code).padStart(5, "0"))
      .appendTo(this);
  }

  /**
   * @param {Object} result
   * @param {{label: string, color: string}|null} format
   */
  buildYouTubeResult(result, format) {
    const thumb = new Html("div")
      .classOn("search-thumbnail-wrapper")
      .appendTo(this);

    const img = new Html("img")
      .classOn("search-thumbnail")
      .styleJs({ opacity: "0", transition: "opacity 0.3s ease" })
      .appendTo(thumb);
    img.elm.onload = () => img.styleJs({ opacity: "1" });
    img.attr({
      src:
        result.thumbnail?.thumbnails?.[0]?.url ||
        `https://img.youtube.com/vi/${result.id}/mqdefault.jpg`,
    });

    if (result.length?.simpleText) {
      new Html("span")
        .classOn("search-duration")
        .text(result.length.simpleText)
        .appendTo(thumb);
    }

    const info = new Html("div").classOn("search-info").appendTo(this);

    const titleRow = new Html("div")
      .styleJs({ display: "flex", alignItems: "center" })
      .appendTo(info);

    if (format) {
      new FormatBadge({
        label: format.label,
        color: format.color,
      }).appendTo(titleRow);
    }

    new Html("div").classOn("search-title").text(result.title).appendTo(titleRow);
    new Html("div").classOn("search-channel").text(result.channelTitle).appendTo(info);
  }

  /**
   * @param {boolean} highlighted
   * @returns {SearchResultItem}
   */
  setHighlighted(highlighted) {
    this[highlighted ? "classOn" : "classOff"]("highlighted");
    return this;
  }
}

export default SearchResultItem;
