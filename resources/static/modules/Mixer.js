import Html from "/libs/html.js";

/**
 * MixerModule - Manages the microphone and music recording mixer interface
 * Provides UI controls for adjusting gain levels and plugin parameters
 */
export class MixerModule {
  /**
   * Creates a new MixerModule instance
   * @param {Object} forteSvc - Forte service instance for managing audio chain
   */
  constructor(forteSvc) {
    this.Forte = forteSvc;
    this.isVisible = false;
    this.modal = null;
    this.listPanel = null;
    this.controlsPanel = null;
    this.state = {};
    this.activePanel = "list";
    this.selectedIndex = 0;
    this.selectedParamIndex = 0;
  }
  /**
   * Mounts the mixer modal to a container element
   * @param {HTMLElement} container - Parent container to append mixer modal to
   */
  mount(container) {
    this.modal = new Html("div").classOn("mixer-modal").appendTo(container);
    const content = new Html("div")
      .classOn("mixer-content")
      .appendTo(this.modal);

    const header = new Html("div").classOn("mixer-header").appendTo(content);
    new Html("h1").text("MIC / MUSIC SETUP").appendTo(header);
    new Html("p")
      .text(
        "Use Arrow Keys to navigate, [Tab] to switch panels, [ESC] to close.",
      )
      .appendTo(header);

    const main = new Html("div").classOn("mixer-main").appendTo(content);
    this.listPanel = new Html("div").classOn("mixer-list-panel").appendTo(main);
    this.controlsPanel = new Html("div")
      .classOn("mixer-controls-panel")
      .appendTo(main);

    this.modal.on("click", (e) => {
      if (e.target === this.modal.elm) this.toggle();
    });
  }

  /**
   * Toggles the visibility of the mixer modal
   */
  toggle() {
    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.build();
      this.modal.classOn("visible");
      this.activePanel = "list";
      this.selectedIndex = 0;
      this.selectedParamIndex = 0;
      this._updateListHighlight();
      this._renderControls();
    } else {
      this.modal.classOff("visible");
    }
  }

  /**
   * Builds the mixer interface from current vocal chain state
   */
  build() {
    this.state = this.Forte.getVocalChainState();
    this.listPanel.clear();
    const items = [
      "Mic Record Volume",
      "Music Record Volume",
      ...this.state.chain.map((p) => p.name),
    ];
    items.forEach((name, index) => {
      new Html("div")
        .classOn("mixer-item")
        .text(name)
        .on("click", () => {
          this.selectedIndex = index;
          this.selectedParamIndex = 0;
          this.activePanel = "list";
          this._updateListHighlight();
          this._renderControls();
        })
        .appendTo(this.listPanel);
    });
  }

  /**
   * Renders the control panel for the selected item
   * @private
   */
  _renderControls() {
    this.controlsPanel.clear();
    const items = this.listPanel.qsa(".mixer-item");
    if (!items || !items[this.selectedIndex]) return;

    const title = items[this.selectedIndex].getText();
    new Html("h2")
      .classOn("mixer-controls-title")
      .text(title)
      .appendTo(this.controlsPanel);
    const controlsContainer = new Html("div")
      .classOn("mixer-controls-container")
      .appendTo(this.controlsPanel);

    if (this.selectedIndex === 0) {
      this._createSlider(
        controlsContainer,
        "Gain",
        {
          type: "slider",
          min: 0,
          max: 2,
          step: 0.01,
          unit: "x",
          value: this.state.micGain,
        },
        (value) => {
          this.Forte.setMicRecordingVolume(value);
          this.state.micGain = value;
        },
        0,
      );
    } else if (this.selectedIndex === 1) {
      this._createSlider(
        controlsContainer,
        "Level",
        {
          type: "slider",
          min: 0,
          max: 1,
          step: 0.01,
          unit: "%",
          value: this.state.musicGain,
        },
        (value) => {
          this.Forte.setMusicRecordingVolume(value);
          this.state.musicGain = value;
        },
        0,
      );
    } else {
      const pluginIndex = this.selectedIndex - 2;
      const plugin = this.state.chain[pluginIndex];
      if (plugin && plugin.parameters) {
        Object.entries(plugin.parameters).forEach(
          ([paramName, paramDef], pIndex) => {
            if (paramName === "bands") return;
            this._createSlider(
              controlsContainer,
              paramName.replace(/_/g, " "),
              paramDef,
              (value) => {
                this.Forte.setPluginParameter(pluginIndex, paramName, value);
              },
              pIndex,
            );
          },
        );
      }
    }
    this._updateControlsHighlight();
  }

  /**
   * Creates a slider control for parameter adjustment
   * @private
   * @param {Html} container - Container to append slider to
   * @param {string} name - Label name for the slider
   * @param {Object} paramDef - Parameter definition with min, max, step, unit, value
   * @param {Function} callback - Callback fired on slider change
   * @param {number} paramIndex - Index of the parameter
   */
  _createSlider(container, name, paramDef, callback, paramIndex) {
    const controlEl = new Html("div")
      .classOn("mixer-control")
      .attr({ "data-param-index": paramIndex })
      .on("click", () => {
        this.activePanel = "controls";
        this.selectedParamIndex = paramIndex;
        this._updateListHighlight();
        this._updateControlsHighlight();
      })
      .appendTo(container);

    new Html("label").text(name).appendTo(controlEl);
    const sliderWrapper = new Html("div")
      .classOn("mixer-slider-wrapper")
      .appendTo(controlEl);
    const slider = new Html("input")
      .attr({
        type: "range",
        min: paramDef.min,
        max: paramDef.max,
        step: paramDef.step,
        value: paramDef.value,
      })
      .appendTo(sliderWrapper);
    const valueDisplay = new Html("span")
      .classOn("mixer-value-display")
      .appendTo(controlEl);

    const updateDisplay = (val) => {
      let displayValue;
      if (paramDef.unit === "%") displayValue = `${(val * 100).toFixed(0)}%`;
      else if (["dB", ":1", "Q"].includes(paramDef.unit))
        displayValue = `${parseFloat(val).toFixed(1)} ${paramDef.unit}`;
      else if (["ms", "Hz"].includes(paramDef.unit))
        displayValue = `${Math.round(val)} ${paramDef.unit}`;
      else
        displayValue = `${parseFloat(val).toFixed(2)} ${paramDef.unit || ""}`;
      valueDisplay.text(displayValue.trim());
    };

    slider.on("input", (e) => {
      const newValue = parseFloat(e.target.value);
      callback(newValue);
      updateDisplay(newValue);
    });
    updateDisplay(paramDef.value);
  }

  /**
   * Updates the visual highlight on the list panel items
   * @private
   */
  _updateListHighlight() {
    this.listPanel.qsa(".mixer-item").forEach((item, index) => {
      if (this.activePanel === "list" && index === this.selectedIndex) {
        item.classOn("mixer-item--active");
        item.elm.scrollIntoView({ block: "nearest" });
      } else {
        item.classOff("mixer-item--active");
      }
    });
  }

  /**
   * Updates the visual highlight on the control panel items
   * @private
   */
  _updateControlsHighlight() {
    this.controlsPanel.qsa(".mixer-control").forEach((control, index) => {
      if (
        this.activePanel === "controls" &&
        index === this.selectedParamIndex
      ) {
        control.classOn("mixer-control--active");
        control.elm.scrollIntoView({ block: "nearest" });
      } else {
        control.classOff("mixer-control--active");
      }
    });
  }

  /**
   * Handles keyboard navigation and control events
   * @param {KeyboardEvent} e - The keyboard event
   */
  handleKeyDown(e) {
    e.preventDefault();
    const numListItems = this.listPanel.qsa(".mixer-item").length;
    const numParamItems = this.controlsPanel.qsa(".mixer-control").length;

    switch (e.key) {
      case "ArrowUp":
        if (this.activePanel === "list") {
          this.selectedIndex = Math.max(0, this.selectedIndex - 1);
          this.selectedParamIndex = 0;
          this._updateListHighlight();
          this._renderControls();
        } else {
          this.selectedParamIndex = Math.max(0, this.selectedParamIndex - 1);
          this._updateControlsHighlight();
        }
        break;
      case "ArrowDown":
        if (this.activePanel === "list") {
          this.selectedIndex = Math.min(
            numListItems - 1,
            this.selectedIndex + 1,
          );
          this.selectedParamIndex = 0;
          this._updateListHighlight();
          this._renderControls();
        } else {
          this.selectedParamIndex = Math.min(
            numParamItems - 1,
            this.selectedParamIndex + 1,
          );
          this._updateControlsHighlight();
        }
        break;
      case "ArrowRight":
        if (this.activePanel === "list" && numParamItems > 0) {
          this.activePanel = "controls";
          this._updateListHighlight();
          this._updateControlsHighlight();
        } else if (this.activePanel === "controls") {
          const activeControl = this.controlsPanel.qs(
            `.mixer-control[data-param-index="${this.selectedParamIndex}"]`,
          );
          const slider = activeControl?.qs('input[type="range"]');
          if (slider) {
            slider.elm.stepUp();
            slider.elm.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        break;
      case "ArrowLeft":
        if (this.activePanel === "controls") {
          const activeControl = this.controlsPanel.qs(
            `.mixer-control[data-param-index="${this.selectedParamIndex}"]`,
          );
          const slider = activeControl?.qs('input[type="range"]');
          if (slider) {
            slider.elm.stepDown();
            slider.elm.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        break;
      case "Tab":
        this.activePanel =
          this.activePanel === "list" && numParamItems > 0
            ? "controls"
            : "list";
        this._updateListHighlight();
        this._updateControlsHighlight();
        break;
      case "Escape":
        this.toggle();
        break;
    }
  }
}
