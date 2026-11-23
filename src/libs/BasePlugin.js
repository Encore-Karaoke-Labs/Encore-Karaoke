export default class BasePlugin {
  constructor(audioContext) {
    if (this.constructor === BasePlugin) {
      throw new Error(
        "BasePlugin is an abstract class and cannot be instantiated directly.",
      );
    }
    this.audioContext = audioContext;
    this.input = this.audioContext.createGain();
    this.output = this.audioContext.createGain();
    this.name = "Base Plugin";

    // This object will hold the current values and definitions of all controllable parameters.
    // The UI will read from this to build itself.
    this.parameters = {};
  }

  /**
   * Sets a parameter value. Must be implemented by subclasses.
   * @param {string} key - The name of the parameter.
   * @param {any} value - The value to set.
   */
  setParameter(key, value) {
    throw new Error(`setParameter() must be implemented by ${this.name}.`);
  }

  /**
   * Disconnects all internal nodes to allow for clean removal.
   */
  disconnect() {
    this.input.disconnect();
    this._removeGlobalMouseListeners();
  }

  /**
   * Subclasses return the array of fader/control elements to highlight.
   * @returns {Array<Object>}
   */
  _getHighlightElements() {
    return [];
  }

  /**
   * Subclasses return the currently active element index.
   * @returns {number}
   */
  _getActiveIndex() {
    return 0;
  }

  /**
   * Sets up global mouse event listeners for fader dragging.
   */
  _setupGlobalMouseEvents() {
    this._mouseMoveHandler = (e) => {
      if (!this.isDragging || this.currentDragIndex === -1) return;
      this._handleMouseFader(e, this.currentDragIndex);
    };

    this._mouseUpHandler = () => {
      this.isDragging = false;
      this.currentDragIndex = -1;
    };

    window.addEventListener("mousemove", this._mouseMoveHandler);
    window.addEventListener("mouseup", this._mouseUpHandler);
  }

  /**
   * Removes the global mouse event listeners installed by _setupGlobalMouseEvents.
   */
  _removeGlobalMouseListeners() {
    if (this._mouseMoveHandler) {
      window.removeEventListener("mousemove", this._mouseMoveHandler);
      this._mouseMoveHandler = null;
    }
    if (this._mouseUpHandler) {
      window.removeEventListener("mouseup", this._mouseUpHandler);
      this._mouseUpHandler = null;
    }
  }

  /**
   * Updates styling to highlight the active control and reset others.
   */
  _updatePluginHighlight() {
    const elements = this._getHighlightElements();
    const activeIndex = this._getActiveIndex();

    elements.forEach((elData, idx) => {
      const active = idx === activeIndex;
      elData.valLabel.styleJs({
        color: active ? "#ffd700" : "#89cff0",
      });
      elData.faderThumb.styleJs({
        backgroundColor: active ? "#ffd700" : "#89cff0",
        boxShadow: active
          ? "0 0 15px rgba(255, 215, 0, 0.6)"
          : "0 0 10px rgba(137, 207, 240, 0.4)",
      });

      if (elData.trackFill) {
        elData.trackFill.styleJs({
          backgroundColor: active
            ? "rgba(255, 215, 0, 0.2)"
            : "rgba(137, 207, 240, 0.15)",
        });
      }
      if (elData.nameLabel) {
        elData.nameLabel.styleJs({
          color: active ? "#010141" : "rgba(255, 255, 255, 0.5)",
          backgroundColor: active ? "#ffd700" : "transparent",
        });
      }
      if (elData.freqLabel) {
        elData.freqLabel.styleJs({
          color: active ? "#010141" : "rgba(255, 255, 255, 0.5)",
          backgroundColor: active ? "#ffd700" : "transparent",
        });
      }
    });
  }
}
