import Html from "../libs/html.js";
import FormatBadge from "./FormatBadge.js";
import IconButton from "./IconButton.js";

/**
 * A reservation queue row with optional reorder/delete controls.
 *
 * @example
 * new QueueListItem({
 *   song,
 *   format: library.getFormatInfo(song),
 *   index,
 *   total: queue.length,
 *   showActions: !isSessionActive,
 *   onClick: () => select(index),
 *   onMoveUp: () => move(index, index - 1),
 *   onMoveDown: () => move(index, index + 1),
 *   onDelete: () => remove(index),
 * }).appendTo(queueList);
 */
class QueueListItem extends Html {
  /**
   * @param {Object} options
   * @param {Object} options.song - Song metadata.
   * @param {{label: string, color: string}} [options.format] - Format descriptor.
   * @param {number} [options.index] - Zero-based queue position.
   * @param {number} [options.total] - Total items in the queue.
   * @param {boolean} [options.showActions] - Render reorder/delete actions.
   * @param {boolean} [options.highlighted] - Initial highlight state.
   * @param {Function} [options.onClick] - Row click handler.
   * @param {Function} [options.onMoveUp] - Move up handler.
   * @param {Function} [options.onMoveDown] - Move down handler.
   * @param {Function} [options.onDelete] - Delete handler.
   */
  constructor({
    song,
    format = null,
    index = 0,
    total = 1,
    showActions = true,
    highlighted = false,
    onClick = null,
    onMoveUp = null,
    onMoveDown = null,
    onDelete = null,
  } = {}) {
    super("div");
    this.classOn("queue-result-item");
    if (onClick) this.on("click", onClick);

    const info = new Html("div").classOn("queue-info").appendTo(this);
    const titleRow = new Html("div").classOn("queue-title").appendTo(info);

    new Html("span")
      .classOn("queue-code")
      .text(song.code ? String(song.code).padStart(6, "0") : "YT")
      .appendTo(titleRow);

    if (format) {
      new FormatBadge({
        label: format.label,
        color: format.color,
      }).appendTo(titleRow);
    }

    new Html("span")
      .classOn("queue-song-text")
      .text(song.title)
      .appendTo(titleRow);

    const artistRow = new Html("div").classOn("queue-artist").appendTo(info);
    new Html("span").text(song.artist).appendTo(artistRow);

    if (showActions) {
      const actions = new Html("div").classOn("queue-actions").appendTo(this);

      const moveUpBtn = new IconButton({
        as: "div",
        icon: "chevron-up",
        className: "queue-move-btn",
        title: "Move up",
        ariaLabel: "Move song up",
        stopPropagation: true,
        onClick: onMoveUp ? () => onMoveUp() : null,
      }).appendTo(actions);
      if (index === 0) moveUpBtn.classOn("disabled");

      const moveDownBtn = new IconButton({
        as: "div",
        icon: "chevron-down",
        className: "queue-move-btn",
        title: "Move down",
        ariaLabel: "Move song down",
        stopPropagation: true,
        onClick: onMoveDown ? () => onMoveDown() : null,
      }).appendTo(actions);
      if (index === total - 1) moveDownBtn.classOn("disabled");

      new IconButton({
        as: "div",
        icon: "trash",
        className: "queue-del-btn",
        stopPropagation: true,
        onClick: onDelete ? () => onDelete() : null,
      }).appendTo(actions);
    }

    this.setHighlighted(highlighted);
  }

  /**
   * @param {boolean} highlighted
   * @returns {QueueListItem}
   */
  setHighlighted(highlighted) {
    this[highlighted ? "classOn" : "classOff"]("highlighted");
    return this;
  }
}

export default QueueListItem;
