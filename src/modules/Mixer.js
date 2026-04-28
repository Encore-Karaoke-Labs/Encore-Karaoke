import Html from "../libs/html.js";

const AVAILABLE_PLUGINS = [
  { name: "7-Band Graphic EQ", path: "/pkgs/plugins/EQ7Band.js" },
  { name: "Compressor", path: "/pkgs/plugins/Compressor.js" },
  { name: "Echo Delay", path: "/pkgs/plugins/EchoPlugin.js" },
  { name: "Noise Gate", path: "/pkgs/plugins/NoiseGate.js" },
  { name: "Parametric EQ", path: "/pkgs/plugins/ParametricEQ.js" },
  { name: "Gain", path: "/pkgs/plugins/Gain.js" },
];

export class MixerModule {
  /**
   * Initializes the MixerModule with a Forte service instance.
   * @param {Object} forteSvc - The Forte audio service instance
   */
  constructor(forteSvc) {
    this.Forte = forteSvc;
    this.isVisible = false;
    this.modal = null;
    this.state = {};

    this.focusedPane = "faders";
    this.faderIndex = 0;
    this.chainIndex = 0;
    this.selectedParamIndex = 0;
    this.isExpanded = false;

    this.chainItems = [];

    this.isDraggingFader = false;
    this.dragFaderType = null;
  }

  /**
   * Mounts the mixer UI to the specified container element.
   * @param {HTMLElement} container - The DOM element to mount the mixer into
   */
  mount(container) {
    this.modal = new Html("div").classOn("mixer-modal").appendTo(container);
    this.contentWrapper = new Html("div")
      .classOn("mixer-content")
      .appendTo(this.modal);

    const header = new Html("div")
      .classOn("mixer-header")
      .appendTo(this.contentWrapper);
    new Html("h1").text("ENCORE AUDIO MIXER").appendTo(header);

    new Html("p")
      .text(
        "Navigate: Arrows | Switch Panels: Tab | Select/Expand: Enter | Reorder: Shift+Up/Down | Remove: Backspace | Close: ESC",
      )
      .styleJs({ color: "#89cff0", fontWeight: "600", fontSize: "1rem" })
      .appendTo(header);

    const main = new Html("div")
      .classOn("mixer-layout")
      .appendTo(this.contentWrapper);

    this.fadersSection = new Html("div")
      .classOn("mixer-faders-section")
      .appendTo(main);
    this.chainSection = new Html("div")
      .classOn("mixer-chain-section")
      .appendTo(main);
    this.pluginSection = new Html("div")
      .classOn("mixer-plugin-section")
      .appendTo(main);

    this.modal.on("click", (e) => {
      if (e.target === this.modal.elm) this.toggle();
    });

    this._setupGlobalMouseEvents();
  }

  /**
   * Toggles the visibility of the mixer module and manages its lifecycle.
   */
  toggle() {
    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.focusedPane = "faders";
      this.faderIndex = 0;
      this.chainIndex = 0;
      this.isExpanded = false;
      this.contentWrapper.classOff("expanded");

      this.build();
      this.modal.classOn("visible");
      this._startMeters();
    } else {
      this.modal.classOff("visible");
      this._stopMeters();
    }
  }

  /**
   * Rebuilds the mixer UI by rendering all sections with current state.
   */
  build() {
    this.state = this.Forte.getVocalChainState();
    this._renderFaders();
    this._renderChain();
    if (this.isExpanded) this._renderPluginControls();
    this._updateHighlights();
  }

  /**
   * Applies and saves a new vocal chain configuration.
   * @param {Array} newConfig - The new chain configuration to apply and save
   * @returns {Promise<void>}
   */
  async _applyAndSaveChain(newConfig) {
    window.config.setItem("audioConfig.vocalChain", newConfig);
    await this.Forte.loadVocalChain(newConfig);
    this.build();
  }

  /**
   * Renders the mic and music faders section of the mixer.
   */
  _renderFaders() {
    this.fadersSection.clear();

    const createFader = (label, maxVal, isMic) => {
      const strip = new Html("div")
        .classOn("channel-strip")
        .appendTo(this.fadersSection);
      new Html("div")
        .styleJs({
          fontWeight: "bold",
          fontSize: "1.4rem",
          letterSpacing: "2px",
        })
        .text(label)
        .appendTo(strip);
      const faderArea = new Html("div").classOn("fader-area").appendTo(strip);

      const track = new Html("div").classOn("fader-track").appendTo(faderArea);
      const vuFill = new Html("div").classOn("vu-fill").appendTo(track);
      const thumb = new Html("div").classOn("fader-thumb").appendTo(track);

      const valDisplay = new Html("div")
        .styleJs({
          fontWeight: "bold",
          fontSize: "1.2rem",
          color: "#89cff0",
          marginTop: "0.5rem",
        })
        .appendTo(strip);
      const hitArea = new Html("div")
        .styleJs({
          position: "absolute",
          inset: "-20px",
          zIndex: 5,
          cursor: "pointer",
        })
        .appendTo(faderArea);

      hitArea.on("mousedown", (e) => {
        this.isDraggingFader = true;
        this.dragFaderType = isMic ? "mic" : "music";
        this.focusedPane = "faders";
        this.faderIndex = isMic ? 0 : 1;
        this._updateHighlights();
        this._handleFaderMouse(e, track.elm, isMic, maxVal);
      });

      return { strip, track, thumb, valDisplay, vuFill };
    };

    this.micFader = createFader("MIC", 2.0, true);
    this.musicFader = createFader("MUSIC", 1.0, false);
    this._updateFaderVisuals();
  }

  /**
   * Updates the visual representation of faders based on current state.
   */
  _updateFaderVisuals() {
    if (!this.micFader || !this.musicFader) return;
    const micVal = this.state.micGain;
    const micPercent = (micVal / 2.0) * 100;
    this.micFader.thumb.styleJs({ bottom: `calc(${micPercent}% - 8px)` });
    this.micFader.valDisplay.text(`${(micVal * 100).toFixed(0)} %`);

    const musVal = this.state.musicGain;
    const musPercent = (musVal / 1.0) * 100;
    this.musicFader.thumb.styleJs({ bottom: `calc(${musPercent}% - 8px)` });
    this.musicFader.valDisplay.text(`${(musVal * 100).toFixed(0)} %`);
  }

  /**
   * Adjusts the currently focused fader by a delta value.
   * @param {number} delta - The amount to adjust the fader by
   */
  _adjustFader(delta) {
    if (this.faderIndex === 0) {
      let val = this.state.micGain + delta;
      val = Math.max(0, Math.min(2.0, val));
      this.Forte.setMicRecordingVolume(val);
      this.state.micGain = val;
    } else {
      let val = this.state.musicGain + delta;
      val = Math.max(0, Math.min(1.0, val));
      this.Forte.setMusicRecordingVolume(val);
      this.state.musicGain = val;
    }
    this._updateFaderVisuals();
  }

  /**
   * Renders the active chain section and available plugins list.
   */
  _renderChain() {
    this.chainSection.clear();
    this.chainItems = [];
    new Html("h3")
      .classOn("chain-header")
      .text("ACTIVE CHAIN")
      .appendTo(this.chainSection);
    this.state.chain.forEach((plugin, i) => {
      const item = new Html("div")
        .classOn("chain-item")
        .text(`${i + 1}. ${plugin.name}`)
        .appendTo(this.chainSection);
      this.chainItems.push({ type: "plugin", el: item, index: i });
    });

    if (this.state.chain.length === 0) {
      new Html("div")
        .styleJs({ opacity: 0.5, fontStyle: "italic", marginBottom: "1rem" })
        .text("No plugins loaded.")
        .appendTo(this.chainSection);
    }

    new Html("h3")
      .classOn("chain-header", "add-header")
      .text("+ ADD PLUGIN")
      .appendTo(this.chainSection);
    AVAILABLE_PLUGINS.forEach((plug) => {
      const item = new Html("div")
        .classOn("chain-item")
        .text(`+ ${plug.name}`)
        .appendTo(this.chainSection);
      this.chainItems.push({
        type: "add",
        el: item,
        config: { path: plug.path, params: {} },
      });
    });

    const customWrapper = new Html("div")
      .classOn("chain-item")
      .styleJs({ padding: "0" })
      .appendTo(this.chainSection);
    const customInput = new Html("input")
      .attr({ type: "text", placeholder: "Custom Path (.js)..." })
      .styleJs({
        width: "100%",
        background: "transparent",
        border: "none",
        color: "#fff",
        padding: "0.8rem 1.2rem",
        outline: "none",
        fontFamily: "inherit",
        fontWeight: "600",
        fontSize: "1.1rem",
      })
      .appendTo(customWrapper);
    this.chainItems.push({
      type: "custom",
      el: customWrapper,
      input: customInput,
    });

    this.chainItems.forEach((item, idx) => {
      item.el.on("click", () => {
        this.focusedPane = "chain";
        this.chainIndex = idx;
        if (item.type === "plugin") this._openPluginEditor();
        else if (item.type === "add")
          this._applyAndSaveChain([
            ...(this.state.rawConfig || []),
            item.config,
          ]);
        else if (item.type === "custom") item.input.elm.focus();
        this._updateHighlights();
      });
    });

    customInput.on("keydown", (e) => {
      if (e.key === "Enter" && customInput.getValue().trim())
        this._applyAndSaveChain([
          ...(this.state.rawConfig || []),
          { path: customInput.getValue().trim(), params: {} },
        ]);
    });
  }

  /**
   * Opens the plugin editor panel for the currently selected plugin.
   */
  _openPluginEditor() {
    this.isExpanded = true;
    this.contentWrapper.classOn("expanded");
    this.focusedPane = "plugin";
    this.selectedParamIndex = 0;
    this._renderPluginControls();
  }

  /**
   * Closes the plugin editor panel and returns to chain view.
   */
  _closePluginEditor() {
    this.isExpanded = false;
    this.contentWrapper.classOff("expanded");
    this.focusedPane = "chain";
    this.pluginSection.clear();
    this._updateHighlights();
  }

  /**
   * Renders the control panel for the currently selected plugin.
   */
  _renderPluginControls() {
    this.pluginSection.clear();
    const currentChainItem = this.chainItems[this.chainIndex];
    if (!currentChainItem || currentChainItem.type !== "plugin") {
      this._closePluginEditor();
      return;
    }

    const pluginIndex = currentChainItem.index;
    const pluginState = this.state.chain[pluginIndex];
    const plugin = pluginState?.instance;

    new Html("h2")
      .styleJs({
        color: "#89cff0",
        borderBottom: "2px solid rgba(137,207,240,0.3)",
        paddingBottom: "0.5rem",
        marginBottom: "1.5rem",
      })
      .text(pluginState.name)
      .appendTo(this.pluginSection);

    const controlsContainer = new Html("div")
      .classOn("mixer-controls-container")
      .appendTo(this.pluginSection);

    if (plugin && typeof plugin.renderGUI === "function") {
      plugin.renderGUI(controlsContainer, Html);
    } else if (pluginState && pluginState.parameters) {
      Object.entries(pluginState.parameters).forEach(
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

  /**
   * Creates and renders a slider control for a plugin parameter.
   * @param {Html} container - The container element to append the slider to
   * @param {string} name - The display name of the parameter
   * @param {Object} paramDef - Parameter definition with min, max, step, value, and unit
   * @param {Function} callback - Callback function invoked when slider value changes
   * @param {number} paramIndex - The index of the parameter for tracking
   */
  _createSlider(container, name, paramDef, callback, paramIndex) {
    const controlEl = new Html("div")
      .classOn("mixer-control")
      .styleJs({
        display: "grid",
        gridTemplateColumns: "150px 1fr 100px",
        gap: "1rem",
        padding: "1rem",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "8px",
        marginBottom: "0.5rem",
        cursor: "pointer",
        transition: "all 0.2s",
      })
      .attr({ "data-param-index": paramIndex })
      .on("click", () => {
        this.focusedPane = "plugin";
        this.selectedParamIndex = paramIndex;
        this._updateHighlights();
      })
      .appendTo(container);

    new Html("label")
      .styleJs({ fontWeight: "bold", textTransform: "capitalize" })
      .text(name)
      .appendTo(controlEl);
    const sliderWrapper = new Html("div")
      .styleJs({ width: "100%" })
      .appendTo(controlEl);
    const slider = new Html("input")
      .attr({
        type: "range",
        min: paramDef.min,
        max: paramDef.max,
        step: paramDef.step,
        value: paramDef.value,
      })
      .styleJs({ width: "100%", accentColor: "#89cff0" })
      .appendTo(sliderWrapper);
    const valueDisplay = new Html("span")
      .styleJs({ fontWeight: "bold", color: "#89cff0", textAlign: "right" })
      .appendTo(controlEl);

    const updateDisplay = (val) => {
      valueDisplay.text(`${parseFloat(val).toFixed(2)} ${paramDef.unit || ""}`);
    };
    slider.on("input", (e) => {
      const newValue = parseFloat(e.target.value);
      callback(newValue);
      updateDisplay(newValue);
    });
    updateDisplay(paramDef.value);
  }

  /**
   * Sets up global mouse event listeners for fader dragging.
   */
  _setupGlobalMouseEvents() {
    this._mouseMoveHandler = (e) => {
      if (!this.isDraggingFader) return;
      const trackEl =
        this.dragFaderType === "mic"
          ? this.micFader.track.elm
          : this.musicFader.track.elm;
      const maxVal = this.dragFaderType === "mic" ? 2.0 : 1.0;
      this._handleFaderMouse(e, trackEl, this.dragFaderType === "mic", maxVal);
    };
    this._mouseUpHandler = () => {
      this.isDraggingFader = false;
      this.dragFaderType = null;
    };
    window.addEventListener("mousemove", this._mouseMoveHandler);
    window.addEventListener("mouseup", this._mouseUpHandler);
  }

  /**
   * Handles mouse movement events for fader dragging.
   * @param {MouseEvent} e - The mouse event
   * @param {HTMLElement} trackEl - The fader track element
   * @param {boolean} isMic - Whether this is the mic fader (true) or music fader (false)
   * @param {number} maxVal - The maximum value for the fader
   */
  _handleFaderMouse(e, trackEl, isMic, maxVal) {
    const rect = trackEl.getBoundingClientRect();
    let y = e.clientY - rect.top;
    y = Math.max(0, Math.min(rect.height, y));
    const percent = 1 - y / rect.height;
    const val = percent * maxVal;
    if (isMic) {
      this.Forte.setMicRecordingVolume(val);
      this.state.micGain = val;
    } else {
      this.Forte.setMusicRecordingVolume(val);
      this.state.musicGain = val;
    }
    this._updateFaderVisuals();
  }

  /**
   * Starts the audio level metering for mic and music channels.
   */
  _startMeters() {
    if (!this.meterCtx) {
      this.meterCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.micAnalyser = this.meterCtx.createAnalyser();
      this.musicAnalyser = this.meterCtx.createAnalyser();
      this.micAnalyser.fftSize = 256;
      this.musicAnalyser.fftSize = 256;
      this.micAnalyser.smoothingTimeConstant = 0.5;
      this.musicAnalyser.smoothingTimeConstant = 0.5;
      this.micMeterLevel = 0;
      this.musicMeterLevel = 0;
      try {
        const micStream = this.Forte.getMicAudioStream();
        if (micStream && micStream.active)
          this.meterCtx
            .createMediaStreamSource(micStream)
            .connect(this.micAnalyser);
        const musicStream = this.Forte.getMusicAudioStream();
        if (musicStream && musicStream.active)
          this.meterCtx
            .createMediaStreamSource(musicStream)
            .connect(this.musicAnalyser);
      } catch (e) {
        console.warn("[Mixer] Failed to hook streams for VU meters", e);
      }
    }
    const dataArray = new Float32Array(this.micAnalyser.fftSize);
    const updateMeters = () => {
      if (!this.isVisible) return;
      const calcLevel = (analyser, gainMult) => {
        analyser.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++)
          sum += dataArray[i] * dataArray[i];
        const rms = Math.sqrt(sum / dataArray.length) * gainMult;
        const db = 20 * Math.log10(rms || 0.0001);
        return Math.max(0, (db + 60) / 60) * 100;
      };
      const DECAY_RATE = 0.94;
      let newMicLevel = calcLevel(this.micAnalyser, this.state.micGain);
      this.micMeterLevel =
        newMicLevel >= this.micMeterLevel
          ? newMicLevel
          : Math.max(newMicLevel, this.micMeterLevel * DECAY_RATE);
      if (this.micFader && this.micFader.vuFill)
        // Replaced `height:` with a dynamic `clipPath:`
        this.micFader.vuFill.styleJs({
          clipPath: `inset(${100 - this.micMeterLevel}% 0 0 0)`,
        });

      let newMusicLevel = calcLevel(this.musicAnalyser, this.state.musicGain);
      this.musicMeterLevel =
        newMusicLevel >= this.musicMeterLevel
          ? newMusicLevel
          : Math.max(newMusicLevel, this.musicMeterLevel * DECAY_RATE);
      if (this.musicFader && this.musicFader.vuFill)
        // Replaced `height:` with a dynamic `clipPath:`
        this.musicFader.vuFill.styleJs({
          clipPath: `inset(${100 - this.musicMeterLevel}% 0 0 0)`,
        });

      this.meterFrame = requestAnimationFrame(updateMeters);
    };
    updateMeters();
  }

  /**
   * Stops the audio level metering animation frame.
   */
  _stopMeters() {
    if (this.meterFrame) cancelAnimationFrame(this.meterFrame);
  }

  /**
   * Updates UI highlights to reflect the current focused pane and selection.
   */
  _updateHighlights() {
    if (this.micFader && this.musicFader) {
      this.micFader.strip.classOff("focused");
      this.musicFader.strip.classOff("focused");
      if (this.focusedPane === "faders") {
        if (this.faderIndex === 0) this.micFader.strip.classOn("focused");
        else this.musicFader.strip.classOn("focused");
      }
    }
    this.chainItems.forEach((item, idx) => {
      item.el.classOff("focused", "active-plugin");
      if (this.focusedPane === "chain" && idx === this.chainIndex) {
        item.el.classOn("focused");
        if (idx === 0) {
          this.chainSection.elm.scrollTop = 0;
        } else {
          item.el.elm.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
      if (
        this.isExpanded &&
        item.type === "plugin" &&
        item.index === this.chainIndex
      ) {
        item.el.classOn("active-plugin");
      }
    });
    const fallbackControls = this.pluginSection.qsa(".mixer-control") || [];
    fallbackControls.forEach((ctrl, idx) => {
      if (this.focusedPane === "plugin" && idx === this.selectedParamIndex) {
        ctrl.styleJs({
          borderColor: "#ffd700",
          background: "rgba(255,215,0,0.1)",
        });
        ctrl.elm.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else {
        ctrl.styleJs({
          borderColor: "rgba(255,255,255,0.1)",
          background: "transparent",
        });
      }
    });
  }

  /**
   * Handles keyboard input for navigation and control of the mixer UI.
   * @param {KeyboardEvent} e - The keyboard event
   */
  handleKeyDown(e) {
    if (e.target.tagName === "INPUT" && e.target.type === "text") {
      if (e.key === "Escape") e.target.blur();
      return;
    }

    const currentChainItem = this.chainItems[this.chainIndex];
    const isPluginNode = currentChainItem && currentChainItem.type === "plugin";

    let isCustomGUI = false;
    let pluginInstance = null;
    if (isPluginNode) {
      pluginInstance = this.state.chain[currentChainItem.index]?.instance;
      if (pluginInstance && typeof pluginInstance.renderGUI === "function")
        isCustomGUI = true;
    }

    if (
      (this.focusedPane === "chain" || this.focusedPane === "plugin") &&
      isPluginNode
    ) {
      const idx = currentChainItem.index;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        const newConfig = [...(this.state.rawConfig || [])];
        newConfig.splice(idx, 1);
        if (this.isExpanded) this._closePluginEditor();
        this.chainIndex = Math.max(0, this.chainIndex - 1);
        this._applyAndSaveChain(newConfig);
        return;
      }

      if (this.focusedPane === "chain") {
        if (e.shiftKey && e.key === "ArrowUp" && idx > 0) {
          const newConfig = [...(this.state.rawConfig || [])];
          [newConfig[idx - 1], newConfig[idx]] = [
            newConfig[idx],
            newConfig[idx - 1],
          ];
          this.chainIndex--;
          this._applyAndSaveChain(newConfig);
          return;
        }
        if (
          e.shiftKey &&
          e.key === "ArrowDown" &&
          idx < this.state.chain.length - 1
        ) {
          const newConfig = [...(this.state.rawConfig || [])];
          [newConfig[idx + 1], newConfig[idx]] = [
            newConfig[idx],
            newConfig[idx + 1],
          ];
          this.chainIndex++;
          this._applyAndSaveChain(newConfig);
          return;
        }
      }
    }

    if (this.focusedPane === "plugin" && isCustomGUI) {
      if (typeof pluginInstance.handleKeyDown === "function") {
        const handled = pluginInstance.handleKeyDown(e);
        if (handled) return;
        if (e.key === "ArrowLeft" || e.key === "Escape") {
          this._closePluginEditor();
          return;
        }
      }
    }

    e.preventDefault();

    switch (e.key) {
      case "ArrowUp":
        if (this.focusedPane === "faders") this._adjustFader(0.05);
        else if (this.focusedPane === "chain")
          this.chainIndex = Math.max(0, this.chainIndex - 1);
        else if (this.focusedPane === "plugin" && !isCustomGUI)
          this.selectedParamIndex = Math.max(0, this.selectedParamIndex - 1);
        break;
      case "ArrowDown":
        if (this.focusedPane === "faders") this._adjustFader(-0.05);
        else if (this.focusedPane === "chain")
          this.chainIndex = Math.min(
            this.chainItems.length - 1,
            this.chainIndex + 1,
          );
        else if (this.focusedPane === "plugin" && !isCustomGUI) {
          const fallbackControls =
            this.pluginSection.qsa(".mixer-control") || [];
          this.selectedParamIndex = Math.min(
            fallbackControls.length - 1,
            this.selectedParamIndex + 1,
          );
        }
        break;
      case "ArrowRight":
        if (this.focusedPane === "faders") {
          if (this.faderIndex === 0) this.faderIndex = 1;
          else this.focusedPane = "chain";
        } else if (this.focusedPane === "chain") {
          if (isPluginNode) this._openPluginEditor();
        } else if (this.focusedPane === "plugin" && !isCustomGUI) {
          const activeControl = this.pluginSection.qs(
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
        if (this.focusedPane === "chain") {
          this.focusedPane = "faders";
        } else if (this.focusedPane === "plugin") {
          if (!isCustomGUI) {
            const activeControl = this.pluginSection.qs(
              `.mixer-control[data-param-index="${this.selectedParamIndex}"]`,
            );
            const slider = activeControl?.qs('input[type="range"]');
            if (
              slider &&
              parseFloat(slider.elm.value) > parseFloat(slider.elm.min)
            ) {
              slider.elm.stepDown();
              slider.elm.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
              this._closePluginEditor();
            }
          }
        } else if (this.focusedPane === "faders" && this.faderIndex === 1) {
          this.faderIndex = 0;
        }
        break;
      case "Enter":
        if (this.focusedPane === "chain") {
          if (currentChainItem.type === "plugin") this._openPluginEditor();
          else if (currentChainItem.type === "add")
            this._applyAndSaveChain([
              ...(this.state.rawConfig || []),
              currentChainItem.config,
            ]);
          else if (currentChainItem.type === "custom")
            currentChainItem.input.elm.focus();
        }
        break;
      case "Tab":
        if (this.focusedPane === "faders") this.focusedPane = "chain";
        else if (this.focusedPane === "chain")
          this.focusedPane = this.isExpanded ? "plugin" : "faders";
        else if (this.focusedPane === "plugin") this.focusedPane = "faders";
        break;
      case "Escape":
        if (this.isExpanded) this._closePluginEditor();
        else this.toggle();
        break;
    }

    this._updateHighlights();
  }
}
