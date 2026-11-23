import Html from "../libs/html.js";
import { normalizeClasses } from "./helpers.js";

/**
 * Reusable format badge (MV, MIDI, RS, YT, etc.).
 *
 * @example
 * new FormatBadge({ label: "MIDI", color: "#D12F9E" }).appendTo(container);
 */
export class FormatBadge extends Html {
  /**
   * @param {Object} [options]
   * @param {string} [options.label] - Badge text.
   * @param {string} [options.color] - Badge background color.
   * @param {string|string[]} [options.className] - Extra class names.
   * @param {Object} [options.style] - Extra inline styles.
   */
  constructor({ label = "", color = "", className = "", style = null } = {}) {
    super("span");
    this.classOn("format-badge");
    this.classOn(...normalizeClasses(className));
    this.setFormat({ label, color });
    if (style) this.styleJs(style);
  }

  /**
   * Updates the badge text and background color.
   * @param {Object} [format]
   * @param {string} [format.label]
   * @param {string} [format.color]
   * @returns {FormatBadge}
   */
  setFormat({ label, color } = {}) {
    if (label !== undefined) this.text(label);
    if (color) this.styleJs({ backgroundColor: color });
    return this;
  }

  /**
   * Returns the outer HTML, useful for template-string based renderers.
   * @returns {string}
   */
  toHtml() {
    return this.elm.outerHTML;
  }

  /**
   * Creates a badge from a `{ label, color }` format descriptor.
   * @param {{label?: string, color?: string}|null} format
   * @param {Object} [options]
   * @returns {FormatBadge|null}
   */
  static fromInfo(format, options = {}) {
    if (!format) return null;
    return new FormatBadge({
      label: format.label,
      color: format.color,
      ...options,
    });
  }
}

export default FormatBadge;
