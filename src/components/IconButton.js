import Html from "../libs/html.js";
import { normalizeClasses } from "./helpers.js";

/**
 * Button with a single IonIcon. Supports buttons and div-based clickables
 * used by the TV-style navigation layer.
 *
 * @example
 * new IconButton({
 *   icon: "close",
 *   className: "queue-close-btn",
 *   onClick: () => closeQueue(),
 * }).appendTo(header);
 */
export class IconButton extends Html {
  /**
   * @param {Object} options
   * @param {string} options.icon - IonIcon name.
   * @param {string|string[]} [options.className] - Extra class names.
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
    icon,
    className = "",
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

    if (as === "button" && type) this.attr({ type });
    if (title) this.attr({ title });
    if (ariaLabel) this.attr({ "aria-label": ariaLabel });
    if (disabled) this.attr({ disabled: "disabled" });
    if (style) this.styleJs(style);

    if (icon) new Html("ion-icon").attr({ name: icon }).appendTo(this);

    if (onClick) {
      this.on("click", (event) => {
        if (stopPropagation) event.stopPropagation();
        onClick(event);
      });
    }
  }
}

export default IconButton;
