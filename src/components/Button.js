import Html from "../libs/html.js";
import { normalizeClasses } from "./helpers.js";

/**
 * Generic button with optional icon and label. Supports the setup screen's
 * structured icon/text markup via `iconClassName` and `labelClassName`.
 *
 * @example
 * new Button({
 *   label: "Back (ESC)",
 *   icon: "◀",
 *   className: "setup-header-btn",
 *   iconClassName: "setup-header-btn-icon",
 *   labelClassName: "setup-header-btn-text",
 *   onClick: () => goBack(),
 * }).appendTo(header);
 */
class Button extends Html {
  /**
   * @param {Object} options
   * @param {string} [options.label] - Visible label.
   * @param {string} [options.icon] - Icon text (not an IonIcon name).
   * @param {string|string[]} [options.className] - Class names.
   * @param {string|string[]} [options.variant] - Extra variant classes.
   * @param {string} [options.iconClassName] - Class for the icon span.
   * @param {string} [options.labelClassName] - Class for the label span.
   * @param {"button"|"div"|"a"} [options.as] - Element tag to render.
   * @param {string} [options.type] - Button type when rendering a button.
   * @param {string} [options.title] - Native tooltip.
   * @param {string} [options.ariaLabel] - Accessible label.
   * @param {boolean} [options.disabled] - Disables the button.
   * @param {boolean} [options.stopPropagation] - Stop click bubbling.
   * @param {Object} [options.style] - Extra inline styles.
   * @param {Function} [options.onClick] - Click handler.
   */
  constructor({
    label = "",
    icon = "",
    className = "",
    variant = "",
    iconClassName = "",
    labelClassName = "",
    as = "button",
    type = "button",
    title = "",
    ariaLabel = "",
    disabled = false,
    stopPropagation = false,
    style = null,
    onClick = null,
  } = {}) {
    super(as);
    this.classOn(...normalizeClasses(className));
    this.classOn(...normalizeClasses(variant));

    if (as === "button" && type) this.attr({ type });
    if (title) this.attr({ title });
    if (ariaLabel) this.attr({ "aria-label": ariaLabel });
    if (disabled) this.attr({ disabled: "disabled" });
    if (style) this.styleJs(style);

    if (icon || labelClassName) {
      if (icon) {
        new Html("span")
          .classOn(...normalizeClasses(iconClassName))
          .text(icon)
          .appendTo(this);
      }
      new Html("span")
        .classOn(...normalizeClasses(labelClassName))
        .text(label)
        .appendTo(this);
    } else {
      this.text(label);
    }

    if (onClick) {
      this.on("click", (event) => {
        if (stopPropagation) event.stopPropagation();
        onClick(event);
      });
    }
  }
}

export default Button;
