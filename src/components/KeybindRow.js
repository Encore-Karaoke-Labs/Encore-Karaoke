import Html from "../libs/html.js";

/**
 * A single keybind row used by the system help overlay.
 *
 * @example
 * new KeybindRow({
 *   keys: "CTRL + ▲ / ▼",
 *   description: "Move song in Reservations menu",
 * }).appendTo(list);
 */
export class KeybindRow extends Html {
  /**
   * @param {Object} options
   * @param {string|string[]} options.keys - Key or keys. Strings are split on " / ".
   * @param {string} options.description - Human-readable action.
   */
  constructor({ keys, description = "" } = {}) {
    super("div");
    this.classOn("keybind-row");

    const kbdWrap = new Html("div").classOn("keybind-kbd-wrap").appendTo(this);
    const parts = Array.isArray(keys)
      ? keys
      : String(keys ?? "")
          .split(" / ")
          .filter(Boolean);

    parts.forEach((part, index) => {
      if (index > 0) {
        new Html("span")
          .text("/")
          .styleJs({ opacity: "0.4", margin: "0 2px" })
          .appendTo(kbdWrap);
      }
      new Html("kbd").text(part).appendTo(kbdWrap);
    });

    new Html("span")
      .classOn("keybind-desc")
      .text(description)
      .appendTo(this);
  }
}

export default KeybindRow;
