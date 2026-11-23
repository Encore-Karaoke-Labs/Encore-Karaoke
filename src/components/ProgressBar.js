import Html from "../libs/html.js";
import { clampPercent, normalizeClasses } from "./helpers.js";

/**
 * Track + fill progress bar. Defaults to the existing setup slider classes so
 * it can replace the hand-built markup without any CSS changes.
 *
 * @example
 * const bar = new ProgressBar({ value: 42, height: "15px" }).appendTo(wrap);
 * bar.setValue(80);
 */
export class ProgressBar extends Html {
  /**
   * @param {Object} [options]
   * @param {number} [options.value] - Progress percentage (0-100).
   * @param {string|string[]} [options.className] - Extra track classes.
   * @param {string|string[]} [options.fillClassName] - Extra fill classes.
   * @param {string} [options.height] - Track height.
   * @param {string} [options.background] - Track background.
   * @param {string} [options.fillColor] - Fill color.
   * @param {number} [options.opacity] - Fill opacity.
   * @param {Object} [options.style] - Extra track styles.
   * @param {Object} [options.fillStyle] - Extra fill styles.
   */
  constructor({
    value = 0,
    className = "",
    fillClassName = "",
    height = "",
    background = "",
    fillColor = "",
    opacity = null,
    style = null,
    fillStyle = null,
  } = {}) {
    super("div");
    this.classOn("setup-slider-bar");
    this.classOn(...normalizeClasses(className));

    const trackStyle = {};
    if (height) trackStyle.height = height;
    if (background) trackStyle.background = background;
    if (style) Object.assign(trackStyle, style);
    if (Object.keys(trackStyle).length > 0) this.styleJs(trackStyle);

    this.fill = new Html("div").classOn("setup-slider-fill");
    this.fill.classOn(...normalizeClasses(fillClassName));

    const fillStyles = {};
    if (fillColor) fillStyles.backgroundColor = fillColor;
    if (opacity !== null) fillStyles.opacity = String(opacity);
    if (fillStyle) Object.assign(fillStyles, fillStyle);
    if (Object.keys(fillStyles).length > 0) this.fill.styleJs(fillStyles);

    this.fill.appendTo(this);
    this.setValue(value);
  }

  /**
   * Sets the fill percentage.
   * @param {number} value - Progress percentage (0-100).
   * @param {Object} [options]
   * @param {string} [options.color] - Optional fill color.
   * @param {number} [options.opacity] - Optional fill opacity.
   * @returns {ProgressBar}
   */
  setValue(value, { color = "", opacity = null } = {}) {
    const percent = clampPercent(value);
    this.fill.styleJs({ width: `${percent}%` });
    if (color) this.fill.styleJs({ backgroundColor: color });
    if (opacity !== null) this.fill.styleJs({ opacity: String(opacity) });
    return this;
  }
}

export default ProgressBar;
