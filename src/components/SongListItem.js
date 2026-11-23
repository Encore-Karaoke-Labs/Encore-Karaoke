import Html from "../libs/html.js";
import FormatBadge from "./FormatBadge.js";

/**
 * A single song row used by the virtualized song list.
 *
 * @example
 * const row = new SongListItem({
 *   song,
 *   format: library.getFormatInfo(song),
 *   top: index * 44,
 *   onClick: () => requestSong(song),
 * }).appendTo(listInner);
 */
export class SongListItem extends Html {
  /**
   * @param {Object} options
   * @param {Object} options.song - Song metadata.
   * @param {{label: string, color: string}} [options.format] - Format descriptor.
   * @param {number} [options.top] - Absolute top offset in pixels.
   * @param {number} [options.height] - Row height in pixels.
   * @param {boolean} [options.highlighted] - Initial highlight state.
   * @param {Function} [options.onClick] - Click handler.
   */
  constructor({
    song,
    format = null,
    top = 0,
    height = 44,
    highlighted = false,
    onClick = null,
  } = {}) {
    super("div");
    this.classOn("song-item").styleJs({
      position: "absolute",
      top: `${top}px`,
      left: "0",
      right: "0",
      height: `${height}px`,
    });

    new Html("div")
      .classOn("song-item-code")
      .text(String(song.code).padStart(6, "0"))
      .appendTo(this);

    const titleContainer = new Html("div")
      .classOn("song-item-title")
      .appendTo(this);

    if (format) {
      new FormatBadge({
        label: format.label,
        color: format.color,
      }).appendTo(titleContainer);
    }

    new Html("span")
      .text(song.title)
      .classOn("song-title-text")
      .appendTo(titleContainer);

    new Html("div").classOn("song-item-artist").text(song.artist).appendTo(this);

    if (onClick) this.on("click", onClick);
    this.setHighlighted(highlighted);
  }

  /**
   * @param {boolean} highlighted
   * @returns {SongListItem}
   */
  setHighlighted(highlighted) {
    this[highlighted ? "classOn" : "classOff"]("highlighted");
    return this;
  }
}

export default SongListItem;
