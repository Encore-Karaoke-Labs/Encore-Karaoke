import Html from "../libs/html.js";
import { normalizeClasses } from "./helpers.js";

/**
 * Animated on/off switch with ARIA state and optional change handler.
 *
 * @example
 * const toggle = new ToggleSwitch({
 *   checked: options.recordSession,
 *   ariaLabel: "Record the entire session",
 *   onChange: (checked) => { options.recordSession = checked; },
 * }).appendTo(row);
 */
class ToggleSwitch extends Html {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.checked] - Initial state.
   * @param {string} [options.ariaLabel] - Accessible label.
   * @param {boolean} [options.disabled] - Disables the switch.
   * @param {string|string[]} [options.className] - Extra class names.
   * @param {Function} [options.onChange] - Called with the new state.
   */
  constructor({
    checked = false,
    ariaLabel = "",
    disabled = false,
    className = "",
    onChange = null,
  } = {}) {
    super("button");
    this.classOn("switch");
    this.classOn(...normalizeClasses(className));

    this._checked = Boolean(checked);
    this._disabled = Boolean(disabled);
    this._onChange = onChange;

    this.attr({
      type: "button",
      role: "switch",
      "aria-checked": this._checked ? "true" : "false",
    });
    if (ariaLabel) this.attr({ "aria-label": ariaLabel });
    if (this._disabled) this.attr({ disabled: "disabled" });

    this.on("click", () => {
      if (this._disabled) return;
      this.setChecked(!this._checked);
      this._onChange?.(this._checked);
    });
  }

  /**
   * Whether the switch is currently on.
   * @returns {boolean}
   */
  get checked() {
    return this._checked;
  }

  /**
   * Whether the switch is disabled.
   * @returns {boolean}
   */
  get disabled() {
    return this._disabled;
  }

  /**
   * Updates the checked state and ARIA value.
   * @param {boolean} checked
   * @param {Object} [options]
   * @param {boolean} [options.animate] - Play the knob animation.
   * @returns {ToggleSwitch}
   */
  setChecked(checked, { animate = true } = {}) {
    const next = Boolean(checked);
    const changed = next !== this._checked;
    this._checked = next;
    this.attr({ "aria-checked": next ? "true" : "false" });

    if (animate && changed) {
      this.classOff("switch-on-anim", "switch-off-anim");
      // Force a reflow so the animation can restart on rapid toggles.
      void this.elm.offsetWidth;
      this.classOn(next ? "switch-on-anim" : "switch-off-anim");
    }

    return this;
  }

  /**
   * Enables or disables the switch.
   * @param {boolean} disabled
   * @returns {ToggleSwitch}
   */
  setDisabled(disabled) {
    this._disabled = Boolean(disabled);
    if (this._disabled) this.attr({ disabled: "disabled" });
    else this.attr({ disabled: null });
    return this;
  }
}

export default ToggleSwitch;
