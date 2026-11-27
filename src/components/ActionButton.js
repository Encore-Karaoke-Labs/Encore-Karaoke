import Html from "../libs/html.js";
import { normalizeClasses } from "./helpers.js";

/**
 * Large bottom-bar action button with an icon and label.
 *
 * @example
 * new ActionButton({
 *   icon: "search",
 *   label: "Search (Y)",
 *   onClick: () => openSearch(),
 * }).appendTo(bottomActions);
 */
class ActionButton extends Html {
  /**
   * @param {Object} options
   * @param {string} options.icon - IonIcon name.
   * @param {string} options.label - Visible label.
   * @param {string|string[]} [options.className] - Extra class names.
   * @param {"div"|"button"} [options.as] - Element tag to render.
   * @param {string} [options.title] - Native tooltip.
   * @param {string} [options.ariaLabel] - Accessible label.
   * @param {Function} [options.onClick] - Click handler.
   */
  constructor({
    icon,
    label = "",
    className = "",
    as = "div",
    title = "",
    ariaLabel = "",
    onClick = null,
  } = {}) {
    super(as);
    this.classOn("action-button");
    this.classOn(...normalizeClasses(className));

    if (title) this.attr({ title });
    if (ariaLabel) this.attr({ "aria-label": ariaLabel });
    if (as === "button") this.attr({ type: "button" });

    if (icon) new Html("ion-icon").attr({ name: icon }).appendTo(this);
    if (label) new Html("span").text(label).appendTo(this);

    if (onClick) this.on("click", onClick);
  }
}

export default ActionButton;
