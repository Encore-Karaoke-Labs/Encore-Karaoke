import {
  networkingUtility_default
} from "../../chunk-CHA2DGDG.js";
import {
  Html
} from "../../chunk-FX4GTR7E.js";
import "../../chunk-7D4SUZUM.js";

// src/modules/Romanizer.js
var Romanizer = {
  /**
   * Generates a placeholder string by replacing non-whitespace characters
   * @param {string} text - The text to create a placeholder for
   * @param {string} placeholderChar - The character to replace non-whitespace with
   * @returns {string} Text with non-whitespace characters replaced
   */
  getPlaceholder(text, placeholderChar) {
    return text.replace(/\S/g, placeholderChar);
  },
  /**
   * Romanizes text by converting Japanese or Korean characters to Latin script
   * @param {string} text - The text to romanize
   * @returns {Promise<string|null>} Romanized text or null if not applicable or on error
   */
  async romanize(text) {
    if (!text || !text.trim()) return null;
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)) {
      try {
        return await window.romanization.romanize(text);
      } catch (err) {
        console.error(`[Romanizer] Network error:`, err);
        return null;
      }
    }
    if (/[\uac00-\ud7af]/.test(text)) {
      return typeof Aromanize !== "undefined" ? Aromanize.romanize(text) : text;
    }
    return null;
  }
};
var Romanizer_default = Romanizer;

// src/modules/Dialog.js
var currentDialog = null;
var dialogTimeout = null;
function generateDialog(elm, duration = 5e3) {
  if (currentDialog) {
    currentDialog.cleanup();
    clearTimeout(dialogTimeout);
  }
  let dialog = new Html("div").classOn("temp-dialog").append(elm).appendTo("body");
  currentDialog = dialog;
  dialogTimeout = setTimeout(() => {
    dialog.cleanup();
    currentDialog = null;
    clearTimeout(dialogTimeout);
  }, duration);
}

// src/modules/Mixer.js
var AVAILABLE_PLUGINS = [
  { name: "7-Band Graphic EQ", path: "/pkgs/plugins/EQ7Band.js" },
  { name: "Compressor", path: "/pkgs/plugins/Compressor.js" },
  { name: "Echo Delay", path: "/pkgs/plugins/EchoPlugin.js" },
  { name: "Noise Gate", path: "/pkgs/plugins/NoiseGate.js" },
  { name: "Parametric EQ", path: "/pkgs/plugins/ParametricEQ.js" },
  { name: "Gain", path: "/pkgs/plugins/Gain.js" }
];
var MixerModule = class {
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
    this.contentWrapper = new Html("div").classOn("mixer-content").appendTo(this.modal);
    const header = new Html("div").classOn("mixer-header").appendTo(this.contentWrapper);
    new Html("h1").text("ENCORE AUDIO MIXER").appendTo(header);
    new Html("p").text(
      "Navigate: Arrows | Switch Panels: Tab | Select/Expand: Enter | Reorder: Shift+Up/Down | Remove: Backspace | Close: ESC"
    ).styleJs({ color: "#89cff0", fontWeight: "600", fontSize: "1rem" }).appendTo(header);
    const main = new Html("div").classOn("mixer-layout").appendTo(this.contentWrapper);
    this.fadersSection = new Html("div").classOn("mixer-faders-section").appendTo(main);
    this.chainSection = new Html("div").classOn("mixer-chain-section").appendTo(main);
    this.pluginSection = new Html("div").classOn("mixer-plugin-section").appendTo(main);
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
      const strip = new Html("div").classOn("channel-strip").appendTo(this.fadersSection);
      new Html("div").styleJs({
        fontWeight: "bold",
        fontSize: "1.4rem",
        letterSpacing: "2px"
      }).text(label).appendTo(strip);
      const faderArea = new Html("div").classOn("fader-area").appendTo(strip);
      const track = new Html("div").classOn("fader-track").appendTo(faderArea);
      const vuFill = new Html("div").classOn("vu-fill").appendTo(track);
      const thumb = new Html("div").classOn("fader-thumb").appendTo(track);
      const valDisplay = new Html("div").styleJs({
        fontWeight: "bold",
        fontSize: "1.2rem",
        color: "#89cff0",
        marginTop: "0.5rem"
      }).appendTo(strip);
      const hitArea = new Html("div").styleJs({
        position: "absolute",
        inset: "-20px",
        zIndex: 5,
        cursor: "pointer"
      }).appendTo(faderArea);
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
    this.micFader = createFader("MIC", 2, true);
    this.musicFader = createFader("MUSIC", 1, false);
    this._updateFaderVisuals();
  }
  /**
   * Updates the visual representation of faders based on current state.
   */
  _updateFaderVisuals() {
    if (!this.micFader || !this.musicFader) return;
    const micVal = this.state.micGain;
    const micPercent = micVal / 2 * 100;
    this.micFader.thumb.styleJs({ bottom: `calc(${micPercent}% - 8px)` });
    this.micFader.valDisplay.text(`${(micVal * 100).toFixed(0)} %`);
    const musVal = this.state.musicGain;
    const musPercent = musVal / 1 * 100;
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
      val = Math.max(0, Math.min(2, val));
      this.Forte.setMicRecordingVolume(val);
      this.state.micGain = val;
    } else {
      let val = this.state.musicGain + delta;
      val = Math.max(0, Math.min(1, val));
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
    new Html("h3").classOn("chain-header").text("ACTIVE CHAIN").appendTo(this.chainSection);
    this.state.chain.forEach((plugin, i) => {
      const item = new Html("div").classOn("chain-item").text(`${i + 1}. ${plugin.name}`).appendTo(this.chainSection);
      this.chainItems.push({ type: "plugin", el: item, index: i });
    });
    if (this.state.chain.length === 0) {
      new Html("div").styleJs({ opacity: 0.5, fontStyle: "italic", marginBottom: "1rem" }).text("No plugins loaded.").appendTo(this.chainSection);
    }
    new Html("h3").classOn("chain-header", "add-header").text("+ ADD PLUGIN").appendTo(this.chainSection);
    AVAILABLE_PLUGINS.forEach((plug) => {
      const item = new Html("div").classOn("chain-item").text(`+ ${plug.name}`).appendTo(this.chainSection);
      this.chainItems.push({
        type: "add",
        el: item,
        config: { path: plug.path, params: {} }
      });
    });
    const customWrapper = new Html("div").classOn("chain-item").styleJs({ padding: "0" }).appendTo(this.chainSection);
    const customInput = new Html("input").attr({ type: "text", placeholder: "Custom Path (.js)..." }).styleJs({
      width: "100%",
      background: "transparent",
      border: "none",
      color: "#fff",
      padding: "0.8rem 1.2rem",
      outline: "none",
      fontFamily: "inherit",
      fontWeight: "600",
      fontSize: "1.1rem"
    }).appendTo(customWrapper);
    this.chainItems.push({
      type: "custom",
      el: customWrapper,
      input: customInput
    });
    this.chainItems.forEach((item, idx) => {
      item.el.on("click", () => {
        this.focusedPane = "chain";
        this.chainIndex = idx;
        if (item.type === "plugin") this._openPluginEditor();
        else if (item.type === "add")
          this._applyAndSaveChain([
            ...this.state.rawConfig || [],
            item.config
          ]);
        else if (item.type === "custom") item.input.elm.focus();
        this._updateHighlights();
      });
    });
    customInput.on("keydown", (e) => {
      if (e.key === "Enter" && customInput.getValue().trim())
        this._applyAndSaveChain([
          ...this.state.rawConfig || [],
          { path: customInput.getValue().trim(), params: {} }
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
    new Html("h2").styleJs({
      color: "#89cff0",
      borderBottom: "2px solid rgba(137,207,240,0.3)",
      paddingBottom: "0.5rem",
      marginBottom: "1.5rem"
    }).text(pluginState.name).appendTo(this.pluginSection);
    const controlsContainer = new Html("div").classOn("mixer-controls-container").appendTo(this.pluginSection);
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
            pIndex
          );
        }
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
    const controlEl = new Html("div").classOn("mixer-control").styleJs({
      display: "grid",
      gridTemplateColumns: "150px 1fr 100px",
      gap: "1rem",
      padding: "1rem",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "8px",
      marginBottom: "0.5rem",
      cursor: "pointer",
      transition: "all 0.2s"
    }).attr({ "data-param-index": paramIndex }).on("click", () => {
      this.focusedPane = "plugin";
      this.selectedParamIndex = paramIndex;
      this._updateHighlights();
    }).appendTo(container);
    new Html("label").styleJs({ fontWeight: "bold", textTransform: "capitalize" }).text(name).appendTo(controlEl);
    const sliderWrapper = new Html("div").styleJs({ width: "100%" }).appendTo(controlEl);
    const slider = new Html("input").attr({
      type: "range",
      min: paramDef.min,
      max: paramDef.max,
      step: paramDef.step,
      value: paramDef.value
    }).styleJs({ width: "100%", accentColor: "#89cff0" }).appendTo(sliderWrapper);
    const valueDisplay = new Html("span").styleJs({ fontWeight: "bold", color: "#89cff0", textAlign: "right" }).appendTo(controlEl);
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
      const trackEl = this.dragFaderType === "mic" ? this.micFader.track.elm : this.musicFader.track.elm;
      const maxVal = this.dragFaderType === "mic" ? 2 : 1;
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
          this.meterCtx.createMediaStreamSource(micStream).connect(this.micAnalyser);
        const musicStream = this.Forte.getMusicAudioStream();
        if (musicStream && musicStream.active)
          this.meterCtx.createMediaStreamSource(musicStream).connect(this.musicAnalyser);
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
        const db = 20 * Math.log10(rms || 1e-4);
        return Math.max(0, (db + 60) / 60) * 100;
      };
      const DECAY_RATE = 0.94;
      let newMicLevel = calcLevel(this.micAnalyser, this.state.micGain);
      this.micMeterLevel = newMicLevel >= this.micMeterLevel ? newMicLevel : Math.max(newMicLevel, this.micMeterLevel * DECAY_RATE);
      if (this.micFader && this.micFader.vuFill)
        this.micFader.vuFill.styleJs({
          clipPath: `inset(${100 - this.micMeterLevel}% 0 0 0)`
        });
      let newMusicLevel = calcLevel(this.musicAnalyser, this.state.musicGain);
      this.musicMeterLevel = newMusicLevel >= this.musicMeterLevel ? newMusicLevel : Math.max(newMusicLevel, this.musicMeterLevel * DECAY_RATE);
      if (this.musicFader && this.musicFader.vuFill)
        this.musicFader.vuFill.styleJs({
          clipPath: `inset(${100 - this.musicMeterLevel}% 0 0 0)`
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
      if (this.isExpanded && item.type === "plugin" && item.index === this.chainIndex) {
        item.el.classOn("active-plugin");
      }
    });
    const fallbackControls = this.pluginSection.qsa(".mixer-control") || [];
    fallbackControls.forEach((ctrl, idx) => {
      if (this.focusedPane === "plugin" && idx === this.selectedParamIndex) {
        ctrl.styleJs({
          borderColor: "#ffd700",
          background: "rgba(255,215,0,0.1)"
        });
        ctrl.elm.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else {
        ctrl.styleJs({
          borderColor: "rgba(255,255,255,0.1)",
          background: "transparent"
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
    if ((this.focusedPane === "chain" || this.focusedPane === "plugin") && isPluginNode) {
      const idx = currentChainItem.index;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        const newConfig = [...this.state.rawConfig || []];
        newConfig.splice(idx, 1);
        if (this.isExpanded) this._closePluginEditor();
        this.chainIndex = Math.max(0, this.chainIndex - 1);
        this._applyAndSaveChain(newConfig);
        return;
      }
      if (this.focusedPane === "chain") {
        if (e.shiftKey && e.key === "ArrowUp" && idx > 0) {
          const newConfig = [...this.state.rawConfig || []];
          [newConfig[idx - 1], newConfig[idx]] = [
            newConfig[idx],
            newConfig[idx - 1]
          ];
          this.chainIndex--;
          this._applyAndSaveChain(newConfig);
          return;
        }
        if (e.shiftKey && e.key === "ArrowDown" && idx < this.state.chain.length - 1) {
          const newConfig = [...this.state.rawConfig || []];
          [newConfig[idx + 1], newConfig[idx]] = [
            newConfig[idx],
            newConfig[idx + 1]
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
            this.chainIndex + 1
          );
        else if (this.focusedPane === "plugin" && !isCustomGUI) {
          const fallbackControls = this.pluginSection.qsa(".mixer-control") || [];
          this.selectedParamIndex = Math.min(
            fallbackControls.length - 1,
            this.selectedParamIndex + 1
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
            `.mixer-control[data-param-index="${this.selectedParamIndex}"]`
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
              `.mixer-control[data-param-index="${this.selectedParamIndex}"]`
            );
            const slider = activeControl?.qs('input[type="range"]');
            if (slider && parseFloat(slider.elm.value) > parseFloat(slider.elm.min)) {
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
              ...this.state.rawConfig || [],
              currentChainItem.config
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
};

// src/modules/BGVPlayer.js
var BGVModule = class {
  /**
   * Initialize the BGV player with default settings
   */
  constructor() {
    this.videoElement = null;
    this.playlist = [];
    this.currentIndex = 0;
    this.container = null;
    this.categories = [];
    this.selectedCategory = "Auto";
    this.isManualMode = false;
    this.activeManualPlayer = null;
    this.PORT = 9864;
    this.transitionTimeout = null;
    console.log(
      "[BGV] BGV Player initialized (Single Buffer / Performance Mode)."
    );
  }
  /**
   * Mount the video player to a container element
   * @param {HTMLElement} container - The DOM container for video playback
   */
  async mount(container) {
    this.PORT = await networkingUtility_default.getPort();
    this.container = container;
    this.container.styleJs({
      backgroundColor: "#000",
      overflow: "hidden"
    });
    this.videoElement = new Html("video").attr({
      muted: true,
      autoplay: false,
      playsInline: true,
      defaultMuted: true,
      preload: "auto"
    }).styleJs({
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: "0",
      transition: "opacity 0.5s ease-in-out",
      willChange: "opacity",
      transform: "translateZ(0)"
    }).appendTo(this.container).elm;
    this.videoElement.volume = 0;
    this.videoElement.addEventListener(
      "volumechange",
      () => this.videoElement.volume = 0
    );
    this.videoElement.onended = () => this.playNext();
    this.videoElement.onerror = (e) => {
      console.warn("[BGV] Video error, skipping:", e);
      this.playNext();
    };
  }
  /**
   * Load background video categories from manifest
   */
  async loadManifestCategories() {
    this.PORT = await networkingUtility_default.getPort();
    try {
      const response = await fetch(
        `http://127.0.0.1:${this.PORT}/assets/video/bgv/manifest.json`
      );
      this.categories = await response.json();
    } catch (error) {
      console.error("[BGV] Failed to load video manifest:", error);
      this.container.text("Could not load background videos.");
      this.categories = [];
    }
  }
  /**
   * Add a dynamic category to the available categories
   * @param {Object} category - Category object with BGV_LIST and BGV_CATEGORY properties
   */
  addDynamicCategory(category) {
    if (category && category.BGV_LIST && category.BGV_LIST.length > 0) {
      this.categories.push(category);
    }
  }
  /**
   * Update playlist based on selected category
   */
  async updatePlaylistForCategory() {
    const assetBaseUrl = `http://127.0.0.1:${this.PORT}/assets/video/bgv/`;
    this.playlist = [];
    let allVideos = [];
    const isAuto = this.selectedCategory === "Auto";
    const catList = isAuto ? this.categories : this.categories.filter((c) => c.BGV_CATEGORY === this.selectedCategory);
    for (const cat of catList) {
      if (cat.isAbsolute) {
        allVideos.push(
          ...cat.BGV_LIST.map((path) => {
            const url = new URL(`http://127.0.0.1:${this.PORT}/getFile`);
            url.searchParams.append("path", path);
            return url.href;
          })
        );
      } else {
        allVideos.push(...cat.BGV_LIST.map((path) => assetBaseUrl + path));
      }
    }
    this.playlist = allVideos;
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [
        this.playlist[j],
        this.playlist[i]
      ];
    }
    this.stop();
    this.currentIndex = 0;
    this.start();
  }
  /**
   * Cycle through available categories
   * @param {number} direction - Direction to cycle (-1 for previous, 1 for next)
   */
  cycleCategory(direction) {
    if (this.isManualMode) return;
    const allCategoryNames = [
      "Auto",
      ...this.categories.map((c) => c.BGV_CATEGORY)
    ];
    let currentIndex = allCategoryNames.indexOf(this.selectedCategory);
    currentIndex = (currentIndex + direction + allCategoryNames.length) % allCategoryNames.length;
    this.selectedCategory = allCategoryNames[currentIndex];
    this.updatePlaylistForCategory();
  }
  /**
   * Start playback of the current playlist
   */
  start() {
    if (this.isManualMode || this.playlist.length === 0) return;
    this._playUrl(this.playlist[this.currentIndex]);
  }
  /**
   * Advance to the next video in playlist with fade transition
   */
  playNext() {
    if (this.isManualMode || this.playlist.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    this.videoElement.style.opacity = "0";
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.transitionTimeout = setTimeout(() => {
      this._playUrl(this.playlist[this.currentIndex]);
    }, 500);
  }
  /**
   * Internal method to load and play a video URL
   * @private
   * @param {string} url - The video URL to play
   */
  _playUrl(url) {
    const v = this.videoElement;
    const onCanPlay = () => {
      v.play().then(() => {
        v.style.opacity = "1";
      }).catch((e) => console.error("[BGV] Play failed", e));
      v.removeEventListener("canplay", onCanPlay);
    };
    v.addEventListener("canplay", onCanPlay);
    v.src = url;
    v.load();
  }
  /**
   * Play a single video without interrupting the auto-playlist
   * @param {string} url - The video URL to play
   * @returns {Promise<HTMLVideoElement>} The video element
   */
  async playSingleVideo(url) {
    this.isManualMode = true;
    this.activeManualPlayer = this.videoElement;
    this.videoElement.onended = null;
    this.videoElement.style.opacity = "0";
    this.videoElement.src = url;
    this.videoElement.load();
    await new Promise((resolve) => {
      const onCanPlay = () => {
        this.videoElement.style.opacity = "1";
        this.videoElement.removeEventListener("canplay", onCanPlay);
        resolve();
      };
      this.videoElement.addEventListener("canplay", onCanPlay);
    });
    return this.videoElement;
  }
  /**
   * Resume playlist playback after manual video playback
   */
  async resumePlaylist() {
    if (!this.isManualMode) return;
    this.isManualMode = false;
    this.activeManualPlayer = null;
    this.videoElement.onended = () => this.playNext();
    this.start();
  }
  /**
   * Stop video playback and clear the video source
   */
  stop() {
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.removeAttribute("src");
      this.videoElement.load();
      this.videoElement.style.opacity = "0";
    }
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
  }
};

// src/modules/Recorder.js
async function audioBufferToWavBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  const writeString = (view2, offset2, string) => {
    for (let i = 0; i < string.length; i++) {
      view2.setUint8(offset2 + i, string.charCodeAt(i));
    }
  };
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  const offset = 44;
  const int16View = new Int16Array(arrayBuffer, offset);
  if (numChannels === 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0, j = 0; i < audioBuffer.length; i++, j += 2) {
      let sL = Math.max(-1, Math.min(1, left[i]));
      let sR = Math.max(-1, Math.min(1, right[i]));
      int16View[j] = sL < 0 ? sL * 32768 : sL * 32767;
      int16View[j + 1] = sR < 0 ? sR * 32768 : sR * 32767;
    }
  } else {
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0, j = 0; i < audioBuffer.length; i++, j++) {
      let sample = Math.max(-1, Math.min(1, channel[i]));
      int16View[j] = sample < 0 ? sample * 32768 : sample * 32767;
    }
  }
  return arrayBuffer;
}
async function processAudioBlobToWav(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return null;
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await actx.decodeAudioData(arrayBuffer);
    const wavBuffer = await audioBufferToWavBuffer(audioBuffer);
    await actx.close();
    return wavBuffer;
  } catch (e) {
    console.warn("[RECORDER] Audio decoding skipped for empty/invalid stem", e);
    return null;
  }
}
var RecorderModule = class {
  /**
   * @param {Object} forteSvc - The Forte Sound Engine Service.
   * @param {Object} bgvModule - The Background Video Player module.
   * @param {Object} infoBarModule - The UI Info bar module for notifications.
   * @param {Function} dialogShow - Function to trigger on-screen text dialogs.
   */
  constructor(forteSvc, bgvModule, infoBarModule, dialogShow) {
    this.forteSvc = forteSvc;
    this.bgvPlayer = bgvModule;
    this.infoBar = infoBarModule;
    this.dialogShow = dialogShow;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.micRecorder = null;
    this.musicRecorder = null;
    this.recordedChunks = [];
    this.micChunks = [];
    this.musicChunks = [];
    this.recordingStartTime = 0;
    this.recordingInterval = null;
    this.animationFrameId = null;
    this.currentSongInfo = null;
    this.uiRefs = null;
    this.parentContainer = null;
    this.currentStream = null;
    this.outputResolution = { width: 1280, height: 720 };
    this.canvas = null;
    this.ctx = null;
    this.offscreenCanvas = null;
    this.oCtx = null;
    this.lyricCaches = /* @__PURE__ */ new WeakMap();
    this.metaCanvas = null;
    this.bgvCanvas = null;
    this.bgvCtx = null;
    this.lyricGradient = null;
    this.countdownGradient = null;
    this.bgvCurrentOpacity = 1;
    this.lyricOpacity = 1;
    this.frameCounter = 0;
    this.isInterludeVisible = false;
    this.cachedInterludeTip = "";
    console.log("[RECORDER] Video Recording feature initialized.");
  }
  /**
   * Calculates formatted elapsed recording time (MM:SS)
   * @returns {string} Formatted time string.
   */
  getRecordingTimeString() {
    if (!this.isRecording) return "00:00";
    const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1e3);
    const mins = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const secs = (elapsed % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }
  /**
   * Mounts the recorder module to a DOM container.
   * @param {HTMLElement} container - The parent DOM container for canvas elements.
   */
  mount(container) {
    this.parentContainer = container;
  }
  /**
   * Initialize canvas elements for recording - output canvas, offscreen buffer, and BGV cache.
   * @private
   */
  _initCanvas() {
    if (this.canvas) return;
    this.canvas = new Html("canvas").attr({
      width: this.outputResolution.width,
      height: this.outputResolution.height
    }).styleJs({ display: "none" }).appendTo(this.parentContainer).elm;
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    if (typeof OffscreenCanvas !== "undefined") {
      this.offscreenCanvas = new OffscreenCanvas(
        this.outputResolution.width,
        this.outputResolution.height
      );
    } else {
      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenCanvas.width = this.outputResolution.width;
      this.offscreenCanvas.height = this.outputResolution.height;
    }
    this.oCtx = this.offscreenCanvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false
    });
    this.bgvCanvas = document.createElement("canvas");
    this.bgvCanvas.width = this.outputResolution.width;
    this.bgvCanvas.height = this.outputResolution.height;
    this.bgvCtx = this.bgvCanvas.getContext("2d", { alpha: false });
    this.bgvCtx.fillStyle = "black";
    this.bgvCtx.fillRect(0, 0, this.bgvCanvas.width, this.bgvCanvas.height);
    this._preRenderGradients();
  }
  /**
   * Pre-render gradient patterns for lyric and countdown displays.
   * @private
   */
  _preRenderGradients() {
    const w = this.outputResolution.width;
    const h = this.outputResolution.height;
    this.lyricGradient = this.oCtx.createLinearGradient(0, h * 0.4, 0, h);
    this.lyricGradient.addColorStop(0, "rgba(0,0,0,0)");
    this.lyricGradient.addColorStop(1, "rgba(0,0,0,0.9)");
    const cx = w / 2;
    const cy = h * 0.52;
    const radius = h * 0.08;
    this.countdownGradient = this.oCtx.createRadialGradient(
      cx,
      cy + radius * 0.2,
      0,
      cx,
      cy + radius * 0.2,
      radius * 1.2
    );
    this.countdownGradient.addColorStop(0, "#f7b733");
    this.countdownGradient.addColorStop(1, "#fc4a1a");
  }
  /**
   * Sets references to UI elements for rendering.
   * @param {Object} refs - Object containing UI element references.
   */
  setUiRefs(refs) {
    this.uiRefs = refs;
  }
  /**
   * Sets the current song information and pre-renders metadata.
   * @param {Object} song - Song object with title and artist properties.
   */
  setSongInfo(song) {
    if (song) {
      this.currentSongInfo = { title: song.title, artist: song.artist };
      this._preRenderMeta();
    }
  }
  /**
   * Clears song information and associated metadata canvas.
   */
  clearSongInfo() {
    this.currentSongInfo = null;
    this.metaCanvas = null;
  }
  /**
   * Toggles recording state between active and inactive.
   */
  toggle() {
    this.isRecording ? this.stop() : this.start();
  }
  /**
   * Starts video recording along with multi-track audio mapping.
   * Initializes canvas, media recorders, and begins frame rendering.
   */
  start() {
    if (this.isRecording || !this.forteSvc || !this.bgvPlayer) return;
    this._initCanvas();
    this.bgvCurrentOpacity = 1;
    this.lyricOpacity = 1;
    this.frameCounter = 0;
    let mixAudioStream, micAudioStream, musicAudioStream;
    try {
      mixAudioStream = this.forteSvc.getRecordingAudioStream();
      micAudioStream = this.forteSvc.getMicAudioStream();
      musicAudioStream = this.forteSvc.getMusicAudioStream();
      if (!mixAudioStream || mixAudioStream.getAudioTracks().length === 0) {
        throw new Error("No primary audio stream found.");
      }
    } catch (e) {
      this.infoBar.showTemp("RECORDING", `Error: ${e.message}`, 4e3);
      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
        2e3
      );
      return;
    }
    const videoStream = this.canvas.captureStream(30);
    this.currentStream = new MediaStream([
      videoStream.getVideoTracks()[0],
      mixAudioStream.getAudioTracks()[0]
    ]);
    this.recordedChunks = [];
    this.micChunks = [];
    this.musicChunks = [];
    try {
      const videoMimes = [
        "video/webm; codecs=h264,opus",
        "video/webm; codecs=h264",
        "video/webm; codecs=vp8,opus",
        "video/webm"
      ];
      const selectedVideoMime = videoMimes.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
      this.mediaRecorder = new MediaRecorder(this.currentStream, {
        mimeType: selectedVideoMime,
        videoBitsPerSecond: 25e5
      });
      const audioMimes = ["audio/webm; codecs=opus", "audio/webm", "audio/ogg"];
      const selectedAudioMime = audioMimes.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
      this.micRecorder = new MediaRecorder(micAudioStream, {
        mimeType: selectedAudioMime
      });
      this.musicRecorder = new MediaRecorder(musicAudioStream, {
        mimeType: selectedAudioMime
      });
      this.dialogShow(
        new Html("div").classOn("temp-dialog-text").text("RECORD STARTED"),
        2e3
      );
    } catch (e) {
      console.error("Failed to create MediaRecorders:", e);
      this.infoBar.showTemp(
        "RECORDING",
        "Error: Could not start recorders.",
        4e3
      );
      return;
    }
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.micRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.micChunks.push(e.data);
    };
    this.musicRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.musicChunks.push(e.data);
    };
    const mixMime = this.mediaRecorder.mimeType;
    const micMime = this.micRecorder.mimeType;
    const musicMime = this.musicRecorder.mimeType;
    const mixPromise = new Promise((resolve) => {
      this.mediaRecorder.onstop = () => resolve(new Blob(this.recordedChunks, { type: mixMime }));
    });
    const micPromise = new Promise((resolve) => {
      this.micRecorder.onstop = () => resolve(new Blob(this.micChunks, { type: micMime }));
    });
    const musicPromise = new Promise((resolve) => {
      this.musicRecorder.onstop = () => resolve(new Blob(this.musicChunks, { type: musicMime }));
    });
    Promise.all([mixPromise, micPromise, musicPromise]).then(
      async ([mixBlob, micBlob, musicBlob]) => {
        this.infoBar.showTemp(
          "RECORDING",
          "Processing audio stems and saving...",
          6e4
        );
        try {
          const mixVideoBuffer = await mixBlob.arrayBuffer();
          const micWavBuffer = await processAudioBlobToWav(micBlob);
          const musicWavBuffer = await processAudioBlobToWav(musicBlob);
          const songTitle = this.currentSongInfo?.title || "Unknown";
          const result = await window.desktopIntegration.ipc.invoke(
            "save-recording",
            {
              videoBuffer: mixVideoBuffer,
              micBuffer: micWavBuffer,
              musicBuffer: musicWavBuffer,
              songTitle
            }
          );
          if (result.success) {
            this.infoBar.showTemp(
              "RECORDING",
              "Saved session to Encore Recordings!",
              5e3
            );
          } else {
            this.infoBar.showTemp(
              "RECORDING",
              "Failed to save recording.",
              5e3
            );
          }
        } catch (e) {
          console.error("Save error:", e);
          this.infoBar.showTemp(
            "RECORDING",
            "Failed to process audio stems.",
            5e3
          );
        }
      }
    );
    this.recordingStartTime = Date.now();
    if (this.recordingInterval) clearInterval(this.recordingInterval);
    this.recordingInterval = setInterval(() => {
      if (this.isRecording) this.infoBar.showDefault();
    }, 1e3);
    this.mediaRecorder.start();
    this.micRecorder.start();
    this.musicRecorder.start();
    this.isRecording = true;
    this.drawFrame();
    this.infoBar.showDefault();
  }
  /**
   * Stops all active recordings, triggering the encoding and export pipeline.
   */
  stop() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.mediaRecorder.stop();
    if (this.micRecorder && this.micRecorder.state !== "inactive")
      this.micRecorder.stop();
    if (this.musicRecorder && this.musicRecorder.state !== "inactive")
      this.musicRecorder.stop();
    this.isRecording = false;
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => {
        if (track.kind === "video") track.stop();
      });
      this.currentStream = null;
    }
    this.mediaRecorder = null;
    this.micRecorder = null;
    this.musicRecorder = null;
    this.infoBar.showDefault();
    this.dialogShow(
      new Html("div").classOn("temp-dialog-text").text("RECORD STOPPED"),
      2e3
    );
  }
  /**
   * Pre-renders metadata canvas with song title and artist.
   * @private
   */
  _preRenderMeta() {
    if (!this.currentSongInfo) return;
    const w = this.outputResolution.width;
    const h = this.outputResolution.height;
    this.metaCanvas = document.createElement("canvas");
    this.metaCanvas.width = w;
    this.metaCanvas.height = h;
    const mCtx = this.metaCanvas.getContext("2d");
    const x = 50, y = 50, maxWidth = w * 0.4, padding = 25;
    const boxHeight = h * 0.11;
    mCtx.fillStyle = "rgba(0, 0, 0, 0.6)";
    mCtx.beginPath();
    mCtx.roundRect(
      x - padding,
      y - padding,
      maxWidth + padding * 2,
      boxHeight + padding,
      15
    );
    mCtx.fill();
    mCtx.font = `bold ${Math.floor(h * 0.044)}px Rajdhani, sans-serif`;
    mCtx.fillStyle = "white";
    mCtx.textAlign = "left";
    mCtx.textBaseline = "top";
    mCtx.shadowColor = "black";
    mCtx.shadowBlur = 5;
    mCtx.fillText(this.currentSongInfo.title, x, y, maxWidth);
    mCtx.font = `${Math.floor(h * 0.03)}px Rajdhani, sans-serif`;
    mCtx.fillStyle = "rgba(255, 255, 255, 0.8)";
    mCtx.shadowBlur = 0;
    mCtx.fillText(this.currentSongInfo.artist, x, y + h * 0.06, maxWidth);
  }
  /**
   * Renders a single frame to the recording canvas.
   * Handles background video, lyrics, countdown, score, and interlude overlays.
   */
  drawFrame() {
    if (!this.isRecording) return;
    const w = this.outputResolution.width;
    const h = this.outputResolution.height;
    const ctx = this.oCtx;
    const sourceVideo = this.bgvPlayer.videoElement;
    this.frameCounter++;
    if (this.frameCounter % 10 === 0) {
      const interludeEl = document.querySelector(".interlude-overlay");
      this.isInterludeVisible = interludeEl && interludeEl.classList.contains("visible");
      if (this.isInterludeVisible) {
        const tipEl = interludeEl.querySelector(".interlude-tip-box");
        this.cachedInterludeTip = tipEl ? tipEl.textContent : "";
      }
    }
    let targetBgvOpacity = 0;
    if (sourceVideo) {
      targetBgvOpacity = sourceVideo.style.opacity ? parseFloat(sourceVideo.style.opacity) : 1;
    }
    this.bgvCurrentOpacity += (targetBgvOpacity - this.bgvCurrentOpacity) * 0.15;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, w, h);
    if (sourceVideo && sourceVideo.readyState >= 2 && !sourceVideo.paused) {
      this.bgvCtx.drawImage(sourceVideo, 0, 0, w, h);
    }
    if (this.bgvCurrentOpacity > 0.01) {
      ctx.globalAlpha = this.bgvCurrentOpacity;
      ctx.drawImage(this.bgvCanvas, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    this.lyricOpacity += ((this.isInterludeVisible ? 0 : 1) - this.lyricOpacity) * 0.15;
    if (this.isInterludeVisible) {
      const iw = w * 0.6;
      const ih = h * 0.4;
      const ix = (w - iw) / 2;
      const iy = (h - ih) / 2;
      ctx.fillStyle = "rgba(10, 10, 20, 0.85)";
      ctx.beginPath();
      ctx.roundRect(ix, iy, iw, ih, 20);
      ctx.fill();
      ctx.strokeStyle = "#89CFF0";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.font = `900 ${Math.floor(h * 0.08)}px Rajdhani, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFF";
      ctx.fillText("INTERLUDE", w / 2, iy + ih * 0.3);
      ctx.beginPath();
      ctx.moveTo(w / 2 - iw * 0.25, iy + ih * 0.45);
      ctx.lineTo(w / 2 + iw * 0.25, iy + ih * 0.45);
      ctx.strokeStyle = "rgba(137, 207, 240, 0.5)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.font = `500 ${Math.floor(h * 0.03)}px "Radio Canada", sans-serif`;
      ctx.fillStyle = "#FFD700";
      const maxTipWidth = iw * 0.85;
      const lineHeight = h * 0.04;
      const words = this.cachedInterludeTip.split(" ");
      let line = "";
      const lines = [];
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTipWidth && n > 0) {
          lines.push(line.trim());
          line = words[n] + " ";
        } else {
          line = testLine;
        }
      }
      lines.push(line.trim());
      const totalBlockHeight = (lines.length - 1) * lineHeight;
      let startY = iy + ih * 0.7 - totalBlockHeight / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], w / 2, startY + i * lineHeight);
      }
    }
    if (this.uiRefs && !this.uiRefs.playerUi.elm.classList.contains("hidden")) {
      if (this.lyricOpacity > 0.01) {
        ctx.globalAlpha = this.lyricOpacity;
        ctx.fillStyle = this.lyricGradient;
        ctx.fillRect(0, h * 0.4, w, h * 0.6);
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        if (this.uiRefs.lyricsCanvas) {
          const sourceCanvas = this.uiRefs.lyricsCanvas.elm;
          const targetWidth = w * 0.9;
          const scaleRatio = targetWidth / sourceCanvas.width;
          const drawHeight = sourceCanvas.height * scaleRatio;
          const drawX = (w - targetWidth) / 2;
          const drawY = h - drawHeight + 60;
          ctx.drawImage(sourceCanvas, drawX, drawY, targetWidth, drawHeight);
        }
        ctx.globalAlpha = 1;
      }
      if (this.uiRefs.scoreDisplay.elm.parentElement.classList.contains("visible")) {
        const hudX = w * 0.04;
        const hudY = h * 0.92;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = `bold ${Math.floor(h * 0.02)}px Rajdhani, sans-serif`;
        ctx.fillStyle = "#FFD700";
        ctx.fillText("SCORE", hudX, hudY);
        const scoreLabelWidth = ctx.measureText("SCORE").width;
        ctx.font = `bold ${Math.floor(h * 0.045)}px Rajdhani, sans-serif`;
        ctx.fillStyle = "#89CFF0";
        ctx.fillText(
          this.uiRefs.scoreDisplay.getText(),
          hudX + scoreLabelWidth + 10,
          hudY
        );
      }
      const countdownEl = this.uiRefs.playerUi.elm.querySelector(".countdown-display");
      if (countdownEl && countdownEl.classList.contains("visible")) {
        const text = countdownEl.textContent;
        const cx = w / 2;
        const cy = h * 0.52;
        const radius = h * 0.08;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = this.countdownGradient;
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#4d4d4d";
        ctx.stroke();
        ctx.font = `900 ${Math.floor(h * 0.095)}px Rajdhani, sans-serif`;
        ctx.fillStyle = "#000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, cx, cy + h * 4e-3);
      }
    }
    if (this.metaCanvas) {
      ctx.drawImage(this.metaCanvas, 0, 0);
    }
    this.ctx.drawImage(this.offscreenCanvas || this.canvas, 0, 0);
    this.animationFrameId = requestAnimationFrame(() => this.drawFrame());
  }
};

// src/modules/InfoBar.js
var InfoBarModule = class {
  /**
   * @param {Function} stateProvider - Callback to get current application state
   * @param {Function} recorderCheck - Callback to check if recording is active
   * @param {Function} formatProvider - Callback to get format badge information for songs
   */
  constructor(stateProvider, recorderCheck, formatProvider) {
    this.getState = stateProvider;
    this.checkRecording = recorderCheck;
    this.getFormatInfo = formatProvider;
    this.bar = null;
    this.labelEl = null;
    this.contentEl = null;
    this.timeout = null;
    this.isTempVisible = false;
    this.persistentState = { label: "", content: "" };
  }
  /**
   * Mount the InfoBar to a container element
   * @param {HTMLElement} container - The container to mount the InfoBar to
   */
  mount(container) {
    this.bar = new Html("div").classOn("info-bar").appendTo(container);
    this.labelEl = new Html("div").classOn("info-bar-label").appendTo(this.bar);
    this.contentEl = new Html("div").classOn("info-bar-content").appendTo(this.bar);
  }
  /**
   * Display persistent information in the InfoBar
   * @param {string} label - The label to display
   * @param {string} content - The HTML content to display
   */
  show(label, content) {
    this.persistentState = { label, content };
    if (!this.isTempVisible) {
      this.labelEl.text(label);
      this.contentEl.html(content);
    }
  }
  /**
   * Display temporary information that auto-dismisses
   * @param {string} label - The label to display
   * @param {string} content - The HTML content to display
   * @param {number} duration - Duration in milliseconds before auto-dismissing
   */
  showTemp(label, content, duration) {
    if (this.timeout) clearTimeout(this.timeout);
    this.isTempVisible = true;
    this.labelEl.text(label);
    this.contentEl.html(content);
    this.bar.classOn("temp-visible");
    this.timeout = setTimeout(() => {
      this.isTempVisible = false;
      this.timeout = null;
      this.labelEl.text(this.persistentState.label);
      this.contentEl.html(this.persistentState.content);
      this.bar.classOff("temp-visible");
    }, duration);
  }
  /**
   * Show the InfoBar with persistent visibility
   */
  showBar() {
    this.bar.classOn("persist-visible");
  }
  /**
   * Hide the InfoBar
   */
  hideBar() {
    this.bar.classOff("persist-visible");
  }
  /**
   * Display default information based on application state (recording or up next song)
   */
  showDefault() {
    if (this.checkRecording) {
      const recStatus = this.checkRecording();
      if (recStatus) {
        const textToDisplay = typeof recStatus === "string" ? recStatus : "REC \u25CF";
        this.show("RECORDING", textToDisplay);
        this.showBar();
        return;
      }
    }
    const { reservationQueue } = this.getState();
    if (reservationQueue.length > 0) {
      const nextSong = reservationQueue[0];
      const extra = reservationQueue.length > 1 ? ` (+${reservationQueue.length - 1})` : "";
      const codeSpan = nextSong.code ? `<span class="info-bar-code">${nextSong.code}</span>` : `<span class="info-bar-code is-youtube">YT</span>`;
      let fmtBadge = "";
      if (this.getFormatInfo) {
        const fmt = this.getFormatInfo(nextSong);
        fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
      }
      this.show(
        "UP NEXT",
        `${codeSpan} ${fmtBadge} <span class="info-bar-title">${nextSong.title}</span> <span class="info-bar-artist">- ${nextSong.artist}${extra}</span>`
      );
      this.showBar();
    } else {
      this.hideBar();
      this.show("UP NEXT", "\u2014");
    }
  }
  /**
   * Display a song reservation being entered
   * @param {string} reservationNumber - The song code being reserved
   */
  showReservation(reservationNumber) {
    const { songMap } = this.getState();
    const displayCode = reservationNumber.padStart(5, "0");
    const song = songMap.get(displayCode);
    let songInfo = song ? `<span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>` : reservationNumber.length === 5 ? `<span style="opacity: 0.5;">No song found.</span>` : "";
    this.showTemp(
      "RESERVING",
      `<span class="info-bar-code">${displayCode}</span> ${songInfo}`,
      3e3
    );
  }
};

// src/modules/ScoreHUD.js
var ScoreHUDModule = class {
  /**
   * Initializes the score HUD module
   */
  constructor() {
    this.hud = null;
    this.scoreDisplay = null;
  }
  /**
   * Mounts the score HUD into the specified container
   * @param {HTMLElement} container - The DOM element to mount the HUD into
   */
  mount(container) {
    this.hud = new Html("div").classOn("score-hud").appendTo(container);
    new Html("div").classOn("score-hud-label").text("SCORE").appendTo(this.hud);
    this.scoreDisplay = new Html("div").classOn("score-hud-value").appendTo(this.hud);
    this.hide();
  }
  /**
   * Displays the score HUD with the provided score value
   * @param {number} score - The score to display
   */
  show(score) {
    this.scoreDisplay.text(Math.floor(score));
    this.hud.classOn("visible");
  }
  /**
   * Hides the score HUD from view
   */
  hide() {
    this.hud.classOff("visible");
  }
};

// src/pkgs/system/EncoreHome.js
var INTERLUDE_TIPS = [
  "TIP: You can use your phone to queue songs by scanning the QR code!",
  "Take a deep breath and get ready for the next verse.",
  "\u201DMaybe there's only a dark road up ahead. But you still have to believe and keep going. Believe that the stars will light your path, even a little bit.\u201D - Kaori Miyazono, Your Lie in April",
  "\u201DMusic speaks louder than words\u201D - Kousei Arima, Your Lie in April",
  "Grab a drink and rest your vocal cords.",
  "TIP: Press F2 to enter the setup menu when playback is stopped.",
  "Adjust the instrumental volume using the - and = keys.",
  "\u201DRock resonates as the music of the perpetual underdog. Is it really rock if it's sung by life's winners?\u201D - Hitori Gotoh, Bocchi The Rock!",
  "TIP: You can search for songs by title, artist, or song number by pressing Y.",
  "\u201DGet freaky \u{1F911}\u{1F911}\u201D - Stariix, Encore Karaoke Labs"
];
var TEMP_TIPS = structuredClone(INTERLUDE_TIPS);
function pathJoin(parts, sep) {
  const separator = sep || "/";
  parts = parts.map((part, index) => {
    if (index) {
      part = part.replace(new RegExp("^" + separator), "");
    }
    if (index !== parts.length - 1) {
      part = part.replace(new RegExp(separator + "$"), "");
    }
    return part;
  });
  return parts.join(separator);
}
var EncoreController = class {
  /**
   * Initializes a new EncoreController.
   *
   * @param {Object} Root - The root application object containing system services.
   * @param {Object} config - Configuration settings for audio, video, and general app behavior.
   */
  constructor(Root, config) {
    this.Root = Root;
    this.Pid = Root.Pid;
    this.Ui = Root.Processes.getService("UiLib").data;
    this.FsSvc = Root.Processes.getService("FsSvc").data;
    this.Forte = Root.Processes.getService("ForteSvc").data;
    this.config = config;
    this.songList = [];
    this.songMap = /* @__PURE__ */ new Map();
    this.libraryInfo = this.FsSvc.getLibraryInfo();
    this.state = {
      actualPort: 9864,
      mode: "menu",
      songNumber: "",
      highlightedIndex: -1,
      reservationNumber: "",
      reservationQueue: [],
      knownRemotes: {},
      windowsVolume: 1,
      volume: config.audioConfig?.mix.instrumental.volume ?? 1,
      videoSyncOffset: config.videoConfig?.syncOffset || 0,
      searchResults: [],
      highlightedSearchIndex: -1,
      isSearching: false,
      isSearchOverlayVisible: false,
      currentSongIsYouTube: false,
      currentSongIsMultiplexed: false,
      currentSongIsMIDI: false,
      currentSongIsMV: false,
      isTransitioning: false,
      isTypingNumber: false,
      lastPlaybackStatus: null,
      isScoreFanfareEnabled: config.audioConfig?.enableScoreFanfare ?? true,
      isScoreNarrationEnabled: config.audioConfig?.enableScoreNarration ?? true,
      isScoreScreenActive: false,
      scoreSkipResolver: null,
      scoreSkipped: false,
      showSongList: false,
      chatHistory: [],
      deviceRegistry: {},
      activeSockets: {},
      typingUsers: /* @__PURE__ */ new Set(),
      cheerQueue: [],
      activeCheerCount: 0,
      activeCheers: [],
      isPromptingSetup: false,
      isRecordingsOpen: false,
      isPlayingRecording: false,
      isDeletePromptOpen: false,
      pendingDeleteRec: null,
      recordingsData: [],
      highlightedRecordingIndex: 0
    };
    console.log("[Encore] Enable fanfare?", this.state.isScoreFanfareEnabled);
    console.log(
      "[Encore] Enable narration?",
      this.state.isScoreNarrationEnabled
    );
    this.state.previousHighlightedIndex = -1;
    this.bumperImages = [];
    this.currentBumperIndex = 0;
    this.bumperInterval = null;
    this.versionInformation = null;
    this.newSongsList = [];
    this.idlePlaylist = [];
    this.currentIdleIndex = 0;
    this.idleState = "text";
    console.log(this.state);
    this.mixer = new MixerModule(this.Forte);
    this.bgv = new BGVModule();
    this.scoreHud = new ScoreHUDModule();
    this.infoBar = new InfoBarModule(
      () => ({
        reservationQueue: this.state.reservationQueue,
        songMap: this.songMap
      }),
      () => this.recorder && this.recorder.isRecording ? `REC <span style="color: #ff5555">\u25CF</span> ${this.recorder.getRecordingTimeString()}` : false,
      (s) => this.getFormatInfo(s)
    );
    this.recorder = new RecorderModule(
      this.Forte,
      this.bgv,
      this.infoBar,
      generateDialog
    );
    this.boundKeydown = this.handleKeyDown.bind(this);
    this.boundPlaybackUpdate = this.handlePlaybackUpdate.bind(this);
    this.boundTimeUpdate = null;
    this.boundLyricEvent = null;
    this.boundScoreUpdate = null;
    this.countdownTimers = [];
    this.nextLineUpdateTimeout = null;
    this.countdownTargetTime = null;
    this.lastCountdownTick = null;
    this.parsedLrc = [];
    this.lineCaches = [];
    for (let i = 0; i < 2; i++) {
      const dim = document.createElement("canvas");
      const main = document.createElement("canvas");
      this.lineCaches.push({
        dim,
        dimCtx: dim.getContext("2d", { alpha: true }),
        main,
        mainCtx: main.getContext("2d", { alpha: true })
      });
    }
    this.requestCanvasCacheUpdate = false;
  }
  /**
   * Bootstraps the application, loads assets, builds the UI, and initializes playback mechanisms.
   *
   * @returns {Promise<void>}
   */
  async init() {
    this.wrapper = new Html("div").classOn("full-ui").appendTo("body");
    this.wrapper.classOn("loading");
    this.Forte.setPianoRollContainer(this.wrapper);
    this.state.actualPort = await networkingUtility_default.getPort();
    this.state.windowsVolume = await window.volume.getVolume();
    console.log("[Encore] Windows volume", this.state.windowsVolume);
    console.log("[Encore] Loading assets...");
    const sfx = [
      "fanfare.mid",
      "fanfare-2.mid",
      "fanfare-3.mid",
      "fanfare-4.mid",
      "scores/0.wav",
      "scores/20.wav",
      "scores/50.wav",
      "scores/70.wav",
      ...Array.from({ length: 10 }, (_, i) => `numbers/${i}.wav`)
    ];
    await Promise.all(sfx.map((s) => this.Forte.loadSfx(`/assets/audio/${s}`)));
    this.socket = io({ query: { clientType: "app" } });
    this.socket.on("connect", () => {
      console.log("[LINK] Connected to server.");
    });
    this.socket.on("remotes", (allRemoteData) => {
      this.state.knownRemotes = allRemoteData;
      this.updateRemoteCount();
      console.log("[LINK] Loaded remote data", this.state.knownRemotes);
    });
    this.setupSocketListeners();
    this.songList = this.FsSvc.getSongList();
    this.newSongsList = this.FsSvc.getNewSongs ? this.FsSvc.getNewSongs() || [] : [];
    this.songMap = new Map(this.songList.map((s) => [s.code, s]));
    this.buildSearchIndex();
    this.socket.emit("broadcastData", {
      type: "ready"
    });
    window.desktopIntegration.ipc.send("setRPC", {
      details: `Browsing ${this.songList.length} Songs...`,
      state: `Main Menu`
    });
    this.versionInformation = await window.version.getVersionInformation();
    console.log(
      `Encore ${this.versionInformation.channel} running in version ${this.versionInformation.number}`
    );
    document.title = `Encore Karaoke ${this.versionInformation.channel} v${this.versionInformation.number} (${this.versionInformation.codename})`;
    await this.Forte.setTrackVolume(this.state.volume);
    if (this.config.audioConfig?.micRecordingVolume !== void 0) {
      this.Forte.setMicRecordingVolume(
        this.config.audioConfig.micRecordingVolume
      );
    }
    if (this.config.audioConfig?.musicRecordingVolume !== void 0) {
      this.Forte.setMusicRecordingVolume(
        this.config.audioConfig.musicRecordingVolume
      );
    }
    if (this.config.audioConfig?.micLatency) {
      await this.Forte.setLatency(this.config.audioConfig.micLatency);
    }
    const micDevice = this.config.audioConfig?.mix?.scoring?.inputDevice;
    if (micDevice) {
      await this.Forte.setMicDevice(micDevice);
    } else {
      await this.Forte.setMicDevice("default");
    }
    const savedChain = this.config.audioConfig?.vocalChain || [];
    await this.Forte.loadVocalChain(savedChain);
    this.buildUI();
    this.infoBar.mount(this.wrapper);
    const isKioskEnabled = await window.kiosk.isEnabled();
    if (isKioskEnabled) {
      this.infoBar.showTemp(
        "KIOSK MODE",
        "Fullscreen enabled. Alt+Tab and Start Menu disabled.",
        5e3
      );
    }
    this.scoreHud.mount(this.wrapper);
    this.mixer.mount(this.wrapper);
    this.bgv.mount(this.dom.bgvContainer);
    this.recorder.mount(this.wrapper);
    this.recorder.setUiRefs({
      playerUi: this.dom.playerUi,
      lyricsCanvas: this.dom.lyricsCanvas,
      scoreDisplay: this.scoreHud.scoreDisplay
    });
    window.addEventListener("keydown", this.boundKeydown);
    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      this.boundPlaybackUpdate
    );
    console.log("MANIFEST", this.libraryInfo);
    if (this.libraryInfo.manifest?.additionalContents?.bgvCategories) {
      await this.bgv.loadManifestCategories();
      const mtvPaths = this.songList.filter((s) => s.videoPath).map((s) => s.videoPath);
      if (mtvPaths.length)
        this.bgv.addDynamicCategory({
          BGV_CATEGORY: "MTV",
          BGV_LIST: mtvPaths,
          isAbsolute: true
        });
      try {
        const userBgvs = await this.FsSvc.getUserBGVs();
        if (userBgvs && userBgvs.length > 0) {
          this.bgv.addDynamicCategory({
            BGV_CATEGORY: "User BGV",
            BGV_LIST: userBgvs,
            isAbsolute: true
          });
          console.log(`[Encore] Loaded ${userBgvs.length} User BGVs.`);
        }
      } catch (e) {
        console.error("[Encore] Failed to initialize User BGVs:", e);
      }
      let libraryBgvCategories = this.libraryInfo.manifest.additionalContents.bgvCategories;
      libraryBgvCategories.forEach((category) => {
        let tempPaths = [];
        category.BGV_LIST.forEach((vidPath) => {
          tempPaths.push(pathJoin([this.libraryInfo.path, vidPath]));
        });
        this.bgv.addDynamicCategory({
          BGV_CATEGORY: category.BGV_CATEGORY,
          BGV_LIST: tempPaths,
          isAbsolute: true
        });
      });
    }
    const bumperPaths = this.libraryInfo.manifest.additionalContents?.bumperImages;
    if (bumperPaths && bumperPaths.length > 0) {
      this.bumperImages = bumperPaths.map(
        (p) => pathJoin([this.libraryInfo.path, p])
      );
    }
    this.startBumperCycle();
    await this.bgv.updatePlaylistForCategory();
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("CherryTree.UI.Ready"));
      setTimeout(() => {
        this.wrapper.classOff("loading");
        this.Ui.transition("fadeIn", this.wrapper);
        this.setMode("menu");
      }, 100);
    }, 100);
  }
  /**
   * Determines format display details (label and color) based on a song's type/path.
   *
   * @param {Object} song - The song metadata object.
   * @returns {{label: string, color: string}} Style information for the given format.
   */
  getFormatInfo(song) {
    const colors = {
      MTV: "#2F6CD1",
      RealSound: "#B02FD1",
      MIDI: "#D12F9E",
      Multiplex: "#2FD147",
      YouTube: "#D12F2F"
    };
    if (song.type === "youtube" || song.path && song.path.startsWith("yt://")) {
      return { label: "YT", color: colors.YouTube };
    }
    if (song.videoPath) {
      return { label: "MTV", color: colors.MTV };
    }
    if (song.type === "multiplexed" || song.path && song.path.toLowerCase().includes("multiplex")) {
      return { label: "MP", color: colors.Multiplex };
    }
    if (song.type === "mid" || song.type === "kar" || song.path && (song.path.endsWith(".mid") || song.path.endsWith(".kar"))) {
      return { label: "MIDI", color: colors.MIDI };
    }
    return { label: "RS", color: colors.RealSound };
  }
  /**
   * Parses a formatted duration string into total seconds.
   *
   * @param {string} durationStr - The duration format (e.g., "HH:MM:SS" or "MM:SS").
   * @returns {number} The time represented in seconds.
   */
  parseDuration(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }
  /**
   * Truncates a title to 8 words with ellipsis if it exceeds that length.
   *
   * @param {string} title - The title to truncate.
   * @returns {string} The truncated title with ellipsis if needed.
   */
  truncateTitleIfNeeded(title) {
    if (!title) return title;
    const words = title.trim().split(/\s+/);
    if (words.length > 8) {
      return words.slice(0, 8).join(" ") + "...";
    }
    return title;
  }
  /**
   * Schedules an automatic skip/transition for a YouTube track after its duration elapses.
   *
   * @param {number} seconds - The duration in seconds.
   */
  scheduleYoutubeSkip(seconds) {
    this.clearYoutubeTimers();
    const totalMs = (seconds + 5) * 1e3;
    const warningDuration = 10 * 1e3;
    const warnAt = Math.max(0, totalMs - warningDuration);
    console.log(
      `[Encore] Scheduling YT Skip in ${totalMs / 1e3}s (Warn at ${warnAt / 1e3}s)`
    );
    this.ytWarningTimer = setTimeout(() => {
      this.state.isYtSkipWarningActive = true;
      this.infoBar.showTemp(
        "AUTO SKIP",
        "Song ending in 10s. Press <span class='key-badge'>UP</span> to extend (+30s).",
        1e4
      );
    }, warnAt);
    this.ytAutoSkipTimer = setTimeout(() => {
      console.log("[Encore] Auto-skipping YouTube track.");
      this.stopPlayer();
      this.bgv.start();
      this.transitionAfterSong();
    }, totalMs);
  }
  /**
   * Extends the YouTube auto-skip timer by an additional 30 seconds.
   */
  extendYoutubeSkip() {
    if (!this.state.isYtSkipWarningActive) return;
    this.clearYoutubeTimers();
    this.state.isYtSkipWarningActive = false;
    this.scheduleYoutubeSkip(35);
    this.infoBar.showTemp("EXTENDED", "Time extended by 30 seconds.", 3e3);
  }
  /**
   * Clears currently running YouTube skip timers.
   */
  clearYoutubeTimers() {
    if (this.ytAutoSkipTimer) clearTimeout(this.ytAutoSkipTimer);
    if (this.ytWarningTimer) clearTimeout(this.ytWarningTimer);
    this.ytAutoSkipTimer = null;
    this.ytWarningTimer = null;
    this.state.isYtSkipWarningActive = false;
  }
  /**
   * Generates and mounts all core UI components.
   */
  buildUI() {
    this.dom = {};
    this.dom.bgvContainer = new Html("div").classOn("bgv-container").appendTo(this.wrapper);
    this.dom.ytContainer = new Html("div").classOn("youtube-player-container", "hidden").appendTo(this.wrapper);
    this.dom.ytIframe = new Html("iframe").appendTo(this.dom.ytContainer);
    this.dom.overlay = new Html("div").classOn("overlay-ui").appendTo(this.wrapper);
    this.dom.standbyScreen = new Html("div").classOn("standby-screen").appendTo(this.dom.overlay);
    this.dom.standbyBumper = new Html("img").classOn("standby-bumper-image").appendTo(this.dom.standbyScreen);
    this.dom.standbyText = new Html("div").classOn("standby-text").text("SELECT SONG").appendTo(this.dom.standbyScreen);
    this.dom.newSongScreen = new Html("div").classOn("new-song-screen", "hidden").appendTo(this.dom.overlay);
    this.dom.newSongHeader = new Html("div").classOn("new-song-header").html(`<span class="ns-head-text">NEWLY ADDED SONGS</span>`).appendTo(this.dom.newSongScreen);
    this.dom.newSongList = new Html("div").classOn("new-song-list").appendTo(this.dom.newSongScreen);
    this.dom.searchUi = new Html("div").classOn("search-ui").appendTo(this.wrapper);
    this.dom.playerUi = new Html("div").classOn("player-ui", "hidden").appendTo(this.wrapper);
    this.dom.formatIndicator = new Html("div").classOn("format-indicator").styleJs({
      position: "absolute",
      top: "calc(2rem + 50px + 1rem)",
      left: "3rem",
      width: "6.5rem",
      height: "6.5rem",
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      zIndex: "20",
      opacity: "0",
      transition: "opacity 0.3s ease",
      pointerEvents: "none"
    }).appendTo(this.wrapper);
    this.buildPostSongScreen();
    this.dom.calibrationScreen = new Html("div").classOn("calibration-screen").appendTo(this.wrapper);
    this.dom.calibTitle = new Html("h1").appendTo(this.dom.calibrationScreen);
    this.dom.calibText = new Html("p").appendTo(this.dom.calibrationScreen);
    this.dom.mainContent = new Html("div").classOn("main-content").appendTo(this.dom.overlay);
    new Html("h1").text("Enter Song Number").appendTo(this.dom.mainContent);
    new Html("br").appendTo(this.dom.mainContent);
    this.dom.numberDisplay = new Html("div").classOn("number-display").appendTo(this.dom.mainContent);
    const songInfo = new Html("div").classOn("song-info").appendTo(this.dom.mainContent);
    this.dom.songTitle = new Html("h2").classOn("song-title").appendTo(songInfo);
    this.dom.songArtist = new Html("p").classOn("song-artist").appendTo(songInfo);
    this.dom.songListContainer = new Html("div").classOn("song-list-container").appendTo(this.dom.overlay);
    const listHeader = new Html("div").classOn("song-list-header").appendTo(this.dom.songListContainer);
    ["CODE", "TITLE", "ARTIST"].forEach(
      (t, i) => new Html("div").classOn(
        i === 0 ? "song-header-code" : i === 1 ? "song-header-title" : "song-header-artist"
      ).text(t).appendTo(listHeader)
    );
    this.ITEM_HEIGHT = 44;
    this.dom.listInner = new Html("div").styleJs({
      position: "relative",
      height: `${this.songList.length * this.ITEM_HEIGHT}px`,
      width: "100%"
    }).appendTo(this.dom.songListContainer);
    this.visibleItemsMap = /* @__PURE__ */ new Map();
    this.dom.songListContainer.on("scroll", () => {
      if (this._scrollRafId) return;
      this._scrollRafId = requestAnimationFrame(() => {
        this._scrollRafId = null;
        this.renderVirtualList();
      });
    });
    this.dom.bottomActions = new Html("div").classOn("bottom-actions").appendTo(this.dom.overlay);
    new Html("div").classOn("action-button").text("Search (Y)").on("click", () => this.setMode("yt-search")).appendTo(this.dom.bottomActions);
    new Html("div").classOn("action-button").text("Recordings (R)").on("click", () => this.toggleRecordingsList()).appendTo(this.dom.bottomActions);
    new Html("div").classOn("action-button").text("Mixer (M)").on("click", () => this.mixer.toggle()).appendTo(this.dom.bottomActions);
    this.buildQR();
    const vi = this.versionInformation || {
      channel: "",
      number: "",
      codename: ""
    };
    new Html("div").classOn("version-badge").text(`${vi.channel} v${vi.number} (${vi.codename})`.trim()).appendTo(this.wrapper);
    this.dom.searchWindow = new Html("div").classOn("search-window").appendTo(this.dom.searchUi);
    this.dom.searchInput = new Html("input").classOn("search-input").attr({ type: "text", placeholder: "Type here to search..." }).appendTo(this.dom.searchWindow);
    this.dom.searchResultsContainer = new Html("div").classOn("search-results-container").appendTo(this.dom.searchWindow);
    this.dom.searchInput.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.performSearch();
      }
    });
    this.dom.introCard = new Html("div").classOn("intro-card").appendTo(this.wrapper);
    const introContent = new Html("div").classOn("intro-card-content").appendTo(this.dom.introCard);
    this.dom.introTitle = new Html("div").classOn("intro-card-title").appendTo(introContent);
    this.dom.introArtist = new Html("div").classOn("intro-card-artist").appendTo(introContent);
    this.dom.introMeta = new Html("div").classOn("intro-card-meta").appendTo(introContent);
    this.dom.interludeOverlay = new Html("div").classOn("interlude-overlay").appendTo(this.wrapper);
    new Html("div").classOn("interlude-text").text("INTERLUDE").appendTo(this.dom.interludeOverlay);
    this.dom.interludeTipBox = new Html("div").classOn("interlude-tip-box").appendTo(this.dom.interludeOverlay);
    const bottom = new Html("div").classOn("player-bottom-section").appendTo(this.dom.playerUi);
    this.dom.countdownDisplay = new Html("div").classOn("countdown-display").appendTo(bottom);
    this.dom.lyricsCanvas = new Html("canvas").classOn("lyrics-render-surface").appendTo(bottom);
    this.lyricsCtx = this.dom.lyricsCanvas.elm.getContext("2d", {
      alpha: true
    });
    this.resizeLyricsCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.min(window.innerWidth * 0.9, 1400);
      const logicalWidth = width;
      const mainFontSize = Math.floor(logicalWidth * 0.045);
      const fixedHeight = Math.max(250, mainFontSize * 10);
      this.logicalWidth = logicalWidth;
      this.logicalHeight = fixedHeight;
      this.dom.lyricsCanvas.elm.width = width * dpr;
      this.dom.lyricsCanvas.elm.height = fixedHeight * dpr;
      this.dom.lyricsCanvas.styleJs({
        width: `${width}px`,
        height: `${fixedHeight}px`
      });
      if (this.lyricsCtx) {
        this.lyricsCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.lyricsCtx.scale(dpr, dpr);
      }
      this.requestCanvasCacheUpdate = true;
      if (this.state.mode === "player") this.calculateLyricLayout();
    };
    window.addEventListener("resize", this.resizeLyricsCanvas);
    this.buildRecordingsUI();
  }
  renderVirtualList() {
    if (this.state.mode !== "menu" || !this.state.showSongList) return;
    const scrollTop = this.dom.songListContainer.elm.scrollTop;
    const viewportHeight = this.dom.songListContainer.elm.clientHeight;
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / this.ITEM_HEIGHT) - 5
    );
    const endIndex = Math.min(
      this.songList.length - 1,
      Math.ceil((scrollTop + viewportHeight) / this.ITEM_HEIGHT) + 5
    );
    for (const [index, itemEl] of this.visibleItemsMap.entries()) {
      if (index < startIndex || index > endIndex) {
        itemEl.cleanup();
        this.visibleItemsMap.delete(index);
      }
    }
    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.visibleItemsMap.has(i)) {
        const song = this.songList[i];
        const item = new Html("div").classOn("song-item").styleJs({
          position: "absolute",
          top: `${i * this.ITEM_HEIGHT}px`,
          left: "0",
          right: "0",
          height: `${this.ITEM_HEIGHT}px`
        });
        new Html("div").classOn("song-item-code").text(song.code).appendTo(item);
        const fmt = this.getFormatInfo(song);
        const titleContainer = new Html("div").classOn("song-item-title").appendTo(item);
        new Html("span").classOn("format-badge").text(fmt.label).styleJs({ backgroundColor: fmt.color }).appendTo(titleContainer);
        new Html("span").text(song.title).classOn("song-title-text").appendTo(titleContainer);
        new Html("div").classOn("song-item-artist").text(song.artist).appendTo(item);
        item.on("click", () => this.startPlayer(song));
        item.on("mouseover", () => {
          if (this.state.mode === "menu" && !this.state.isTypingNumber) {
            if (this.state.highlightedIndex !== i) {
              this.state.highlightedIndex = i;
              this.updateMenuUI(true);
            }
          }
        });
        if (i === this.state.highlightedIndex) item.classOn("highlighted");
        item.appendTo(this.dom.listInner);
        this.visibleItemsMap.set(i, item);
      }
    }
  }
  getDuetColors(role) {
    const colors = {
      f: {
        main: "#ffff33",
        stroke: "#806600",
        dim: "rgba(255,255,51,0.35)",
        dimStroke: "rgba(128,102,0,0.6)"
      },
      f2: {
        main: "#66ff66",
        stroke: "#004d00",
        dim: "rgba(102,255,102,0.35)",
        dimStroke: "rgba(0,77,0,0.6)"
      },
      m: {
        main: "#66e6ff",
        stroke: "#004d66",
        dim: "rgba(102,230,255,0.35)",
        dimStroke: "rgba(0,77,102,0.6)"
      },
      m2: {
        main: "#ff6666",
        stroke: "#660000",
        dim: "rgba(255,102,102,0.35)",
        dimStroke: "rgba(102,0,0,0.6)"
      },
      a: {
        main: "#ffb233",
        stroke: "#804000",
        dim: "rgba(255,178,51,0.35)",
        dimStroke: "rgba(128,64,0,0.6)"
      },
      default: {
        main: "#ffffff",
        stroke: "#010141",
        dim: "rgba(255,255,255,0.4)",
        dimStroke: "rgba(1,1,65,0.6)"
      }
    };
    return colors[role] || colors["default"];
  }
  calculateLyricLayout() {
    if (!this.allMidiSyllables && !this.parsedLrc) return;
    const canvas = this.dom.lyricsCanvas.elm;
    const ctx = this.lyricsCtx;
    const logicalWidth = parseFloat(canvas.style.width) || window.innerWidth * 0.9;
    const mainFontSize = Math.floor(logicalWidth * 0.045);
    const subFontSize = Math.floor(logicalWidth * 0.018);
    const lineSpacing = mainFontSize * 1.5;
    const paragraphGap = mainFontSize * 2.4;
    let currentY = mainFontSize * 1.5;
    this.renderableLines = [];
    const buildLineLayout = (lineData, isNextLine) => {
      if (!lineData || lineData.length === 0) return;
      let currentX = 0;
      let row = [];
      let rows = [row];
      ctx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
      let words = [];
      let currentWord = [];
      lineData.forEach((s) => {
        if (currentWord.length > 0 && (s.rawText.startsWith(" ") || s.rawText.startsWith("\u3000"))) {
          words.push(currentWord);
          currentWord = [];
        }
        currentWord.push(s);
        if (s.rawText.endsWith(" ") || s.rawText.endsWith("\u3000")) {
          words.push(currentWord);
          currentWord = [];
        }
      });
      if (currentWord.length > 0) words.push(currentWord);
      words.forEach((word) => {
        let accText = "";
        let previousSubWidth = 0;
        let requiresExpansion = false;
        word.forEach((s) => {
          ctx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
          s.standaloneW = s.text ? ctx.measureText(s.text).width : 0;
          ctx.font = `700 ${subFontSize}px "Radio Canada", sans-serif`;
          s.furiW = s.furigana ? ctx.measureText(s.furigana).width : 0;
          s.romW = s.romanized ? ctx.measureText(s.romanized).width : 0;
          if (s.furiW > s.standaloneW || s.romW > s.standaloneW) {
            requiresExpansion = true;
          }
        });
        let fullWordText = word.map((s) => s.text || "").join("");
        word.forEach((s, index) => {
          ctx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
          if (requiresExpansion) {
            s.origW = s.standaloneW;
            s.blockWidth = Math.max(s.origW, s.furiW, s.romW);
            s.isPartOfContinuousWord = false;
          } else {
            accText += s.text || "";
            let currentSubWidth = ctx.measureText(accText).width;
            s.origW = Math.max(0, currentSubWidth - previousSubWidth);
            previousSubWidth = currentSubWidth;
            s.blockWidth = s.origW;
            s.isPartOfContinuousWord = true;
            if (index === 0) {
              s.isContinuousWordStart = true;
              s.continuousWordText = fullWordText;
            }
          }
        });
      });
      words.forEach((word) => {
        let wordTotalWidth = word.reduce((sum, s) => sum + s.blockWidth, 0);
        if (currentX + wordTotalWidth > logicalWidth * 0.95 && row.length > 0) {
          currentX = 0;
          row = [];
          rows.push(row);
        }
        word.forEach((s) => {
          s.layoutX = currentX;
          currentX += s.blockWidth;
          row.push(s);
        });
      });
      rows.forEach((r) => {
        const rowWidth = r.reduce((sum, s) => sum + s.blockWidth, 0);
        const startX = (logicalWidth - rowWidth) / 2;
        r.forEach((s) => {
          s.layoutX += startX;
          s.layoutY = currentY;
        });
        currentY += lineSpacing;
      });
      currentY -= lineSpacing;
      currentY += paragraphGap;
      this.renderableLines.push({ isNextLine, syllables: lineData });
    };
    if (this.state.currentSongIsMIDI) {
      const isLine1Active = this.currentSongLineIndex % 2 === 0;
      buildLineLayout(this.currentMidiLine1, !isLine1Active);
      buildLineLayout(this.currentMidiLine2, isLine1Active);
    } else if (!this.state.currentSongIsMIDI && this.parsedLrc && this.parsedLrc.length > 0) {
      const isLine1Active = !this.isLrcLine2Active && this.currentLrcIndex >= 0;
      const isLine2Active = this.isLrcLine2Active && this.currentLrcIndex >= 0;
      buildLineLayout(this.currentLrcLine1?.syllables || [], !isLine1Active);
      buildLineLayout(this.currentLrcLine2?.syllables || [], !isLine2Active);
    }
    const fixedHeight = this.logicalHeight || 250;
    const yOffset = Math.max(0, fixedHeight - currentY - mainFontSize * 0.5);
    if (this.renderableLines) {
      this.renderableLines.forEach((line) => {
        line.syllables.forEach((s) => {
          s.layoutY += yOffset;
        });
      });
    }
    this.requestCanvasCacheUpdate = true;
  }
  updateCanvasCache() {
    const canvas = this.dom.lyricsCanvas.elm;
    const width = canvas.width;
    const height = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = parseFloat(canvas.style.width) || window.innerWidth * 0.9;
    while (this.lineCaches.length < this.renderableLines.length) {
      const dim = document.createElement("canvas");
      const main = document.createElement("canvas");
      this.lineCaches.push({
        dim,
        dimCtx: dim.getContext("2d", { alpha: true }),
        main,
        mainCtx: main.getContext("2d", { alpha: true })
      });
    }
    const mainFontSize = Math.floor(logicalWidth * 0.045);
    const subFontSize = Math.floor(logicalWidth * 0.018);
    this.renderableLines.forEach((line, lineIdx) => {
      const cache = this.lineCaches[lineIdx];
      if (cache.dim.width !== width || cache.dim.height !== height) {
        cache.dim.width = width;
        cache.dim.height = height;
        cache.main.width = width;
        cache.main.height = height;
        cache.dimCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.dimCtx.scale(dpr, dpr);
        cache.mainCtx.scale(dpr, dpr);
      } else {
        cache.dimCtx.save();
        cache.dimCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.dimCtx.clearRect(0, 0, width, height);
        cache.dimCtx.restore();
        cache.mainCtx.save();
        cache.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.mainCtx.clearRect(0, 0, width, height);
        cache.mainCtx.restore();
      }
      cache.dimCtx.textBaseline = "alphabetic";
      cache.mainCtx.textBaseline = "alphabetic";
      cache.dimCtx.lineJoin = "round";
      cache.mainCtx.lineJoin = "round";
      line.syllables.forEach((s) => {
        if (s.isHidden) return;
        const centerX = s.layoutX + s.blockWidth / 2;
        const colors = this.state.isDuet ? this.getDuetColors(s.duetRole) : this.getDuetColors("default");
        const renderTextToCtx = (ctx, text, y, font, w, isMain) => {
          if (!text) return;
          ctx.font = font;
          ctx.fillStyle = isMain ? colors.main : colors.dim;
          ctx.strokeStyle = isMain ? colors.stroke : colors.dimStroke;
          ctx.lineWidth = (font.includes(mainFontSize) ? mainFontSize : subFontSize) * 0.15;
          ctx.strokeText(text, centerX - w / 2, y);
          ctx.fillText(text, centerX - w / 2, y);
        };
        renderTextToCtx(
          cache.dimCtx,
          s.furigana,
          s.layoutY - mainFontSize * 1.1,
          `700 ${subFontSize}px "Radio Canada"`,
          s.furiW,
          false
        );
        renderTextToCtx(
          cache.mainCtx,
          s.furigana,
          s.layoutY - mainFontSize * 1.1,
          `700 ${subFontSize}px "Radio Canada"`,
          s.furiW,
          true
        );
        if (s.isPartOfContinuousWord) {
          if (s.isContinuousWordStart && s.continuousWordText) {
            const wordX = s.layoutX;
            cache.dimCtx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
            cache.dimCtx.fillStyle = colors.dim;
            cache.dimCtx.strokeStyle = colors.dimStroke;
            cache.dimCtx.lineWidth = mainFontSize * 0.15;
            cache.dimCtx.strokeText(s.continuousWordText, wordX, s.layoutY);
            cache.dimCtx.fillText(s.continuousWordText, wordX, s.layoutY);
            cache.mainCtx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
            cache.mainCtx.fillStyle = colors.main;
            cache.mainCtx.strokeStyle = colors.stroke;
            cache.mainCtx.lineWidth = mainFontSize * 0.15;
            cache.mainCtx.strokeText(s.continuousWordText, wordX, s.layoutY);
            cache.mainCtx.fillText(s.continuousWordText, wordX, s.layoutY);
          }
        } else {
          renderTextToCtx(
            cache.dimCtx,
            s.text || "",
            s.layoutY,
            `900 ${mainFontSize}px "Radio Canada", sans-serif`,
            s.origW,
            false
          );
          renderTextToCtx(
            cache.mainCtx,
            s.text || "",
            s.layoutY,
            `900 ${mainFontSize}px "Radio Canada", sans-serif`,
            s.origW,
            true
          );
        }
        renderTextToCtx(
          cache.dimCtx,
          s.romanized,
          s.layoutY + mainFontSize * 0.6,
          `700 ${subFontSize}px "Radio Canada"`,
          s.romW,
          false
        );
        renderTextToCtx(
          cache.mainCtx,
          s.romanized,
          s.layoutY + mainFontSize * 0.6,
          `700 ${subFontSize}px "Radio Canada"`,
          s.romW,
          true
        );
      });
    });
  }
  drawLyricsFrame() {
    if (this.state.mode !== "player") return;
    const ctx = this.lyricsCtx;
    const canvas = this.dom.lyricsCanvas.elm;
    const logicalWidth = parseFloat(canvas.style.width) || window.innerWidth * 0.9;
    const logicalHeight = canvas.height / (window.devicePixelRatio || 1);
    const mainFontSize = Math.floor(logicalWidth * 0.045);
    const subFontSize = Math.floor(logicalWidth * 0.018);
    if (this.requestCanvasCacheUpdate) {
      this.updateCanvasCache();
      this.requestCanvasCacheUpdate = false;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const isLrcMode = !this.state.currentSongIsMIDI && this.parsedLrc && this.parsedLrc.length > 0;
    if (this.state.currentSongIsMIDI || isLrcMode) {
      if (!this.renderableLines) {
        this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
        return;
      }
      let fadeProgress = 1;
      if (this.nextLineFadeStartMs && this.nextLineFadeDurationMs > 0) {
        const elapsed = performance.now() - this.nextLineFadeStartMs;
        fadeProgress = Math.min(1, elapsed / this.nextLineFadeDurationMs);
      } else if (this.nextLineFadeDurationMs === 0) {
        fadeProgress = 1;
      }
      this.renderableLines.forEach((line, lineIdx) => {
        const cache = this.lineCaches[lineIdx];
        if (!cache) return;
        const isNext = line.isNextLine;
        ctx.globalAlpha = isNext ? fadeProgress : 1;
        ctx.drawImage(cache.dim, 0, 0, logicalWidth, logicalHeight);
      });
      ctx.globalAlpha = 1;
      const currentTime = this.currentMediaTime || 0;
      this.renderableLines.forEach((line, lineIdx) => {
        if (line.isNextLine) return;
        const cache = this.lineCaches[lineIdx];
        if (!cache) return;
        ctx.save();
        if (isLrcMode && this.lrcChangeTime) {
          const elapsed = performance.now() - this.lrcChangeTime;
          ctx.globalAlpha = Math.min(1, Math.max(0, elapsed / 300));
        }
        ctx.beginPath();
        line.syllables.forEach((s) => {
          if (s.isHidden) return;
          const centerX = s.layoutX + s.blockWidth / 2;
          let progress = 0;
          if (isLrcMode) {
            progress = 1;
          } else {
            if (currentTime >= s.endTime) {
              progress = 1;
            } else if (currentTime >= s.absoluteTime) {
              progress = (currentTime - s.absoluteTime) / (s.endTime - s.absoluteTime);
            }
          }
          if (progress > 0) {
            let clipTop = s.layoutY - mainFontSize * 0.9;
            let clipBottom = s.layoutY + mainFontSize * 0.35;
            if (s.furigana) clipTop -= mainFontSize * 0.6;
            if (s.romanized) clipBottom += mainFontSize * 0.55;
            const clipHeight = clipBottom - clipTop;
            ctx.rect(
              centerX - s.blockWidth / 2 - 5,
              clipTop,
              (s.blockWidth + 10) * progress,
              clipHeight
            );
          }
        });
        ctx.clip();
        ctx.drawImage(cache.main, 0, 0, logicalWidth, logicalHeight);
        ctx.restore();
      });
    }
    this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
  }
  /**
   * Constructs the score results overlay shown after performance completion.
   */
  buildPostSongScreen() {
    this.dom.postSongScreen = new Html("div").classOn("post-song-screen-overlay").appendTo(this.wrapper);
    new Html("div").classOn("score-title-text").text("YOUR SCORE").appendTo(this.dom.postSongScreen);
    const mainGroup = new Html("div").classOn("score-main-group").appendTo(this.dom.postSongScreen);
    this.dom.finalScoreDisplay = new Html("div").classOn("score-display-number").text("00").appendTo(mainGroup);
    this.dom.rankDisplay = new Html("div").classOn("rank-display-text").text("").appendTo(mainGroup);
    new Html("div").classOn("score-skip-hint").text("PRESS ENTER TO CONTINUE").appendTo(this.dom.postSongScreen);
  }
  /**
   * Generates the UI elements for the Recordings List, Custom Player, and Delete Prompt.
   */
  buildRecordingsUI() {
    this.dom.recordingsScreen = new Html("div").classOn("recordings-modal", "hidden").appendTo(this.wrapper);
    const recContent = new Html("div").classOn("recordings-content").appendTo(this.dom.recordingsScreen);
    const recHeader = new Html("div").classOn("recordings-header").appendTo(recContent);
    new Html("h1").text("RECORDING SESSIONS").appendTo(recHeader);
    new Html("div").classOn("rec-key-hint").html(
      "<kbd>ESC</kbd> Close &nbsp;&nbsp; <kbd>DEL</kbd> Delete &nbsp;&nbsp; <kbd>ENTER</kbd> Play"
    ).appendTo(recHeader);
    this.dom.recordingsList = new Html("div").classOn("recordings-list").appendTo(recContent);
    this.dom.recDeleteOverlay = new Html("div").classOn("rec-delete-overlay", "hidden").appendTo(this.dom.recordingsScreen);
    const deleteBox = new Html("div").classOn("rec-delete-box").appendTo(this.dom.recDeleteOverlay);
    new Html("h2").text("DELETE RECORDING?").appendTo(deleteBox);
    this.dom.recDeleteText = new Html("p").appendTo(deleteBox);
    new Html("div").classOn("rec-key-hint").html("<kbd>ENTER</kbd> Confirm &nbsp;&nbsp; <kbd>ESC</kbd> Cancel").appendTo(deleteBox);
    this.dom.recPlayerOverlay = new Html("div").classOn("rec-player-overlay", "hidden").appendTo(this.wrapper);
    this.dom.recVideoPlayer = new Html("video").classOn("rec-video-element").appendTo(this.dom.recPlayerOverlay);
    this.dom.recVideoOsd = new Html("div").classOn("rec-video-osd").appendTo(this.dom.recPlayerOverlay);
    this.dom.recVideoTitle = new Html("div").classOn("rec-video-title").appendTo(this.dom.recVideoOsd);
    const progressWrapper = new Html("div").classOn("rec-progress-wrapper").appendTo(this.dom.recVideoOsd);
    const progressBar = new Html("div").classOn("rec-progress-bar").appendTo(progressWrapper);
    this.dom.recVideoProgressFill = new Html("div").classOn("rec-progress-fill").appendTo(progressBar);
    const osdBottom = new Html("div").classOn("rec-osd-bottom").appendTo(this.dom.recVideoOsd);
    this.dom.recVideoTime = new Html("div").classOn("rec-video-time").text("00:00 / 00:00").appendTo(osdBottom);
    new Html("div").classOn("rec-key-hint").html(
      "<kbd>SPACE</kbd> Play/Pause &nbsp;&nbsp; <kbd>\u2190</kbd> <kbd>\u2192</kbd> Seek &nbsp;&nbsp; <kbd>-</kbd> <kbd>=</kbd> Vol &nbsp;&nbsp; <kbd>ESC</kbd> Stop"
    ).appendTo(osdBottom);
    this.dom.recVideoPlayer.on("timeupdate", () => {
      const curr = this.dom.recVideoPlayer.elm.currentTime;
      const tot = this.dom.recVideoPlayer.elm.duration || 1;
      this.dom.recVideoProgressFill.styleJs({
        width: `${curr / tot * 100}%`
      });
      this.dom.recVideoTime.text(
        `${this.formatTime(curr)} / ${this.formatTime(tot)}`
      );
    });
    this.dom.recVideoPlayer.on("ended", () => this.closeRecordingPlayer());
  }
  formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }
  triggerRecOsd() {
    this.dom.recVideoOsd.classOff("hidden");
    if (this.recOsdTimeout) clearTimeout(this.recOsdTimeout);
    this.recOsdTimeout = setTimeout(() => {
      if (!this.dom.recVideoPlayer.elm.paused) {
        this.dom.recVideoOsd.classOn("hidden");
      }
    }, 3500);
  }
  async toggleRecordingsList(forceShow = null) {
    if (this.state.isTransitioning) return;
    const isOpening = forceShow !== null ? forceShow : this.dom.recordingsScreen.elm.classList.contains("hidden");
    if (isOpening) {
      this.state.isRecordingsOpen = true;
      this.dom.recordingsScreen.classOff("hidden");
      this.state.highlightedRecordingIndex = 0;
      await this.refreshRecordingsList();
    } else {
      this.state.isRecordingsOpen = false;
      this.dom.recordingsScreen.classOn("hidden");
      this.closeRecordingPlayer();
      this.cancelDeletePrompt();
    }
  }
  async refreshRecordingsList() {
    this.dom.recordingsList.clear();
    this.state.recordingsData = [];
    try {
      const recordings = await window.desktopIntegration.ipc.invoke("get-recordings");
      if (!recordings || recordings.length === 0) {
        new Html("div").classOn("rec-empty-state").text("No recordings found. Go sing a song and capture the moment!").appendTo(this.dom.recordingsList);
        return;
      }
      this.state.recordingsData = recordings;
      this.state.recordingsData.forEach((rec) => {
        const item = new Html("div").classOn("rec-item").appendTo(this.dom.recordingsList);
        const displayTitle = rec.title.split("-").slice(0, -3).join("-") || rec.title;
        new Html("div").classOn("rec-title").text(displayTitle).appendTo(item);
        new Html("div").classOn("rec-date").text(new Date(rec.date).toLocaleString()).appendTo(item);
      });
      this.updateRecordingsHighlight();
    } catch (e) {
      new Html("div").classOn("rec-empty-state").text("Failed to load recordings.").appendTo(this.dom.recordingsList);
    }
  }
  updateRecordingsHighlight() {
    const items = this.dom.recordingsList.qsa(".rec-item");
    if (!items) return;
    items.forEach((item, idx) => {
      const isHi = idx === this.state.highlightedRecordingIndex;
      item[isHi ? "classOn" : "classOff"]("active");
      if (isHi)
        item.elm.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  playRecording(rec) {
    this.state.isPlayingRecording = true;
    const videoUrl = new URL(
      `http://127.0.0.1:${this.state.actualPort}/getFile`
    );
    videoUrl.searchParams.append("path", rec.videoPath);
    const displayTitle = rec.title.split("-").slice(0, -3).join("-") || rec.title;
    this.dom.recVideoTitle.text(displayTitle);
    this.dom.recVideoPlayer.elm.volume = this.state.volume;
    this.dom.recVideoPlayer.attr({ src: videoUrl.href });
    this.dom.recPlayerOverlay.classOff("hidden");
    this.dom.recVideoPlayer.elm.play();
    this.triggerRecOsd();
  }
  closeRecordingPlayer() {
    this.state.isPlayingRecording = false;
    this.dom.recVideoPlayer.elm.pause();
    this.dom.recVideoPlayer.attr({ src: "" });
    this.dom.recPlayerOverlay.classOn("hidden");
    if (this.recOsdTimeout) clearTimeout(this.recOsdTimeout);
  }
  openDeletePrompt(rec) {
    const displayTitle = rec.title.split("-").slice(0, -3).join("-") || rec.title;
    this.state.pendingDeleteRec = rec;
    this.state.isDeletePromptOpen = true;
    this.dom.recDeleteText.text(
      `Are you sure you want to permanently delete "${displayTitle}"?`
    );
    this.dom.recDeleteOverlay.classOff("hidden");
  }
  cancelDeletePrompt() {
    this.state.isDeletePromptOpen = false;
    this.state.pendingDeleteRec = null;
    this.dom.recDeleteOverlay.classOn("hidden");
  }
  async confirmDeleteRecording() {
    if (!this.state.pendingDeleteRec) return;
    const success = await window.desktopIntegration.ipc.invoke(
      "delete-recording",
      this.state.pendingDeleteRec.id
    );
    if (success) {
      this.infoBar.showTemp("DELETED", "Recording session removed.", 3e3);
      this.state.highlightedRecordingIndex = Math.max(
        0,
        this.state.highlightedRecordingIndex - 1
      );
      await this.refreshRecordingsList();
    } else {
      this.infoBar.showTemp("ERROR", "Failed to delete recording.", 3e3);
    }
    this.cancelDeletePrompt();
  }
  /**
   * Updates the UI badge displaying the number of connected remote devices.
   */
  updateRemoteCount() {
    if (this.dom.qrConnectedCount) {
      const count = Object.keys(this.state.knownRemotes || {}).length;
      this.dom.qrConnectedCount.text(count.toString());
      if (count > 0) {
        this.dom.qrContainer.classOn("has-remotes");
      } else {
        this.dom.qrContainer.classOff("has-remotes");
      }
    }
  }
  /**
   * Generates and mounts the connection QR Code.
   */
  buildQR() {
    this.dom.qrContainer = new Html("div").classOn("qr-code-container").appendTo(this.wrapper);
    const counterBadge = new Html("div").classOn("qr-counter-badge").appendTo(this.dom.qrContainer);
    counterBadge.html(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`
    );
    this.dom.qrConnectedCount = new Html("span").text("0").appendTo(counterBadge);
    const imgWrapper = new Html("div").classOn("qr-image-wrapper").appendTo(this.dom.qrContainer);
    const img = new Html("img").appendTo(imgWrapper);
    let remoteUrl = ``;
    fetch(`http://127.0.0.1:${this.state.actualPort}/cloud_info`).then((r) => r.json()).then((info) => {
      if (!info.roomCode) {
        fetch(`http://127.0.0.1:${this.state.actualPort}/local_ip`).then((r) => r.text()).then((ip) => {
          const remoteUrl3 = `http://${ip}:${this.state.actualPort}/remote`;
          img.attr({
            src: `http://127.0.0.1:${this.state.actualPort}/qr?url=${encodeURIComponent(remoteUrl3)}`
          });
        }).catch((e) => this.dom.qrContainer.classOn("hidden"));
        return;
      }
      const remoteUrl2 = `${info.relayUrl}/?room=${info.roomCode}`;
      img.attr({
        src: `http://127.0.0.1:${this.state.actualPort}/qr?url=${encodeURIComponent(remoteUrl2)}`
      });
    }).catch((e) => this.dom.qrContainer.classOn("hidden"));
    this.updateRemoteCount();
  }
  /**
   * Processes the queue of incoming cheers and displays them concurrently (stacked).
   */
  processCheerQueue() {
    if (this.state.cheerQueue.length === 0) return;
    while (this.state.cheerQueue.length > 0) {
      const cheer = this.state.cheerQueue.shift();
      this.displayCheer(cheer);
    }
  }
  /**
   * Displays a single cheer with its own animation and cleanup.
   * Multiple cheers are stacked vertically.
   *
   * @param {Object} cheer - The cheer object with nickname and message.
   */
  displayCheer(cheer) {
    const cheerContainer = new Html("div").classOn("cheer-overlay-container").styleJs({
      position: "absolute",
      top: `calc(20px + var(--cheer-index, 0) * 110px)`,
      left: "-500px",
      zIndex: `calc(9000 + var(--cheer-index, 0))`,
      transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      backgroundColor: "rgba(20, 20, 30, 0.9)",
      border: "2px solid #ffd700",
      borderRadius: "15px",
      padding: "15px 25px",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
      maxWidth: "400px"
    }).appendTo(this.wrapper);
    new Html("div").styleJs({
      color: "#ffd700",
      fontWeight: "700",
      fontSize: "1.2rem",
      marginBottom: "5px"
    }).html(`\u{1F389} <span>${cheer.nickname}</span> cheers:`).appendTo(cheerContainer);
    new Html("div").styleJs({
      color: "#fff",
      fontSize: "1.5rem",
      fontWeight: "600",
      wordWrap: "break-word"
    }).text(cheer.message).appendTo(cheerContainer);
    this.state.activeCheers.push(cheerContainer);
    this.repositionCheers();
    setTimeout(() => {
      cheerContainer.styleJs({ left: "20px" });
    }, 10);
    setTimeout(() => {
      cheerContainer.styleJs({ left: "-500px" });
      setTimeout(() => {
        const index = this.state.activeCheers.indexOf(cheerContainer);
        if (index > -1) {
          this.state.activeCheers.splice(index, 1);
          cheerContainer.cleanup();
          this.repositionCheers();
        }
      }, 600);
    }, 5500);
  }
  /**
   * Reposition all active cheers based on their index in the array.
   * CSS custom properties handle the actual positioning and animation.
   */
  repositionCheers() {
    this.state.activeCheers.forEach((cheerContainer, index) => {
      cheerContainer.elm.style.setProperty("--cheer-index", index);
    });
  }
  /**
   * Determines an available unique nickname by appending a numerical counter if necessary.
   *
   * @param {string} desiredName - The requested username.
   * @param {string} deviceId - The requesting device's persistent identifier.
   * @returns {string} An active session-unique username.
   */
  generateUniqueNickname(desiredName, deviceId) {
    let baseName = desiredName.trim().substring(0, 15) || "Singer";
    let finalName = baseName;
    let counter = 1;
    const otherNames = Object.entries(this.state.deviceRegistry).filter(([id, _]) => id !== deviceId).map(([_, data]) => data.nickname.toLowerCase());
    while (otherNames.includes(finalName.toLowerCase())) {
      finalName = `${baseName} ${counter}`;
      counter++;
    }
    return finalName;
  }
  /**
   * Dispatches active chat and presence status out to connected remote devices.
   */
  broadcastSocialState() {
    const activeUsersCount = Object.keys(this.state.activeSockets).length;
    const typingNicks = Array.from(this.state.typingUsers).map((socketId) => {
      const devId = this.state.activeSockets[socketId];
      return devId && this.state.deviceRegistry[devId] ? this.state.deviceRegistry[devId].nickname : null;
    }).filter(Boolean);
    this.socket.emit("broadcastData", {
      type: "social_update",
      typing: typingNicks,
      usersCount: activeUsersCount,
      users: this.state.deviceRegistry
    });
  }
  /**
   * Starts rotation of designated standby bumper images and newly added songs on the main screen.
   */
  startBumperCycle() {
    if (this.bumperInterval) clearInterval(this.bumperInterval);
    this.idlePlaylist = [];
    if (this.bumperImages && this.bumperImages.length > 0) {
      this.bumperImages.forEach((imgPath) => {
        this.idlePlaylist.push({ type: "bumper", data: imgPath });
      });
    }
    if (this.newSongsList && this.newSongsList.length > 0) {
      for (let i = 0; i < this.newSongsList.length; i += 8) {
        this.idlePlaylist.push({
          type: "newsong",
          data: this.newSongsList.slice(i, i + 8)
        });
      }
    }
    if (this.idlePlaylist.length === 0) {
      this.idleState = "text";
      this.dom.standbyBumper.classOn("hidden");
      this.dom.standbyText.classOff("hidden");
      this.dom.standbyScreen.classOff("has-bumper-image");
      this.dom.newSongScreen.classOn("hidden");
      return;
    }
    this.dom.standbyText.classOn("hidden");
    this.currentIdleIndex = -1;
    const cycle = () => {
      this.currentIdleIndex = (this.currentIdleIndex + 1) % this.idlePlaylist.length;
      const currentItem = this.idlePlaylist[this.currentIdleIndex];
      this.dom.standbyBumper.styleJs({ opacity: 0 });
      this.dom.newSongScreen.styleJs({ opacity: 0 });
      setTimeout(() => {
        this.idleState = currentItem.type;
        const isIdling = !this.state.showSongList && !this.state.isTypingNumber && this.state.mode === "menu" && !this.state.isPromptingSetup;
        if (currentItem.type === "newsong") {
          this.dom.newSongList.clear();
          currentItem.data.forEach((song, idx) => {
            const row = new Html("div").classOn("ns-row").appendTo(this.dom.newSongList);
            row.styleJs({ animationDelay: `${idx * 0.08}s` });
            const fmt = this.getFormatInfo(song);
            new Html("div").classOn("ns-code").text(song.code).appendTo(row);
            const titleCol = new Html("div").classOn("ns-title-col").appendTo(row);
            new Html("span").classOn("format-badge").styleJs({ backgroundColor: fmt.color }).text(fmt.label).appendTo(titleCol);
            new Html("span").classOn("ns-title").text(song.title).appendTo(titleCol);
            new Html("div").classOn("ns-artist").text(song.artist).appendTo(row);
          });
          if (isIdling) {
            this.dom.standbyScreen.classOn("hidden");
            this.dom.newSongScreen.classOff("hidden");
            this.dom.newSongScreen.styleJs({ opacity: 1 });
          }
        } else if (currentItem.type === "bumper") {
          const imageUrl = new URL(
            `http://127.0.0.1:${this.state.actualPort}/getFile`
          );
          imageUrl.searchParams.append("path", currentItem.data);
          this.dom.standbyBumper.attr({ src: imageUrl.href });
          if (isIdling) {
            this.dom.newSongScreen.classOn("hidden");
            this.dom.standbyScreen.classOff("hidden");
            this.dom.standbyBumper.classOff("hidden");
            this.dom.standbyScreen.classOn("has-bumper-image");
            this.dom.standbyText.classOn("hidden");
            this.dom.standbyBumper.styleJs({ opacity: 1 });
          }
        }
      }, 500);
    };
    cycle();
    this.bumperInterval = setInterval(cycle, 12e3);
  }
  /**
   * Expands the standby screen to reveal the local song collection index.
   */
  showTheSongList() {
    if (this.state.mode !== "menu" || this.state.showSongList) return;
    this.state.showSongList = true;
    this.updateMenuUI();
  }
  /**
   * Modifies application state, coordinating required UI toggles and visibility changes.
   *
   * @param {string} newMode - Target state ("menu", "player", "yt-search").
   */
  setMode(newMode) {
    this.state.mode = newMode;
    this.wrapper.classOff(
      "mode-menu",
      "mode-player",
      "mode-yt-search",
      "mode-player-youtube"
    );
    this.wrapper.classOn(`mode-${newMode}`);
    this.dom.overlay.classOn("hidden");
    this.dom.playerUi.classOn("hidden");
    if (this.state.isSearchOverlayVisible) this.toggleSearchOverlay(false);
    if (newMode === "menu") {
      this.state.showSongList = false;
      this.dom.overlay.classOff("hidden");
      this.dom.searchInput.elm.blur();
      this.infoBar.hideBar();
      this.updateMenuUI();
      setTimeout(() => {
        if (this.state.scoreSkipped) {
          this.state.scoreSkipped = false;
        }
      }, 5e3);
    } else if (newMode === "player") {
      this.dom.playerUi.classOff("hidden");
      this.infoBar.showDefault();
    } else if (newMode === "yt-search") {
      if (this.state.currentSongIsMultiplexed)
        this.Forte.togglePianoRollVisibility(false);
      this.dom.searchInput.elm.focus();
      this.dom.searchInput.elm.select();
    }
  }
  /**
   * Updates standard menu interfaces including list selection highlighting and the active title.
   */
  updateMenuUI(preventScroll = false) {
    this._pendingPreventScroll = preventScroll;
    if (this._menuUpdateRafId) return;
    this._menuUpdateRafId = requestAnimationFrame(() => {
      this._menuUpdateRafId = null;
      const currentPreventScroll = this._pendingPreventScroll;
      const isIdling = !this.state.showSongList && !this.state.isTypingNumber && this.state.mode === "menu" && !this.state.isPromptingSetup;
      if (isIdling) {
        if (this.idleState === "newsong") {
          this.dom.standbyScreen.classOn("hidden");
          this.dom.newSongScreen.classOff("hidden");
          this.dom.newSongScreen.styleJs({ opacity: 1 });
        } else if (this.idleState === "bumper") {
          this.dom.newSongScreen.classOn("hidden");
          this.dom.standbyScreen.classOff("hidden");
          this.dom.standbyBumper.styleJs({ opacity: 1 });
        } else {
          this.dom.newSongScreen.classOn("hidden");
          this.dom.standbyScreen.classOff("hidden");
          this.dom.standbyBumper.classOn("hidden");
          this.dom.standbyText.classOff("hidden");
        }
        this.dom.mainContent.classOn("hidden");
        this.dom.songListContainer.classOn("hidden");
        this.dom.bottomActions.classOn("hidden");
        this.dom.numberDisplay.text("");
        this.dom.songTitle.text("");
        this.dom.songArtist.text("");
        return;
      }
      this.dom.standbyScreen.classOn("hidden");
      this.dom.newSongScreen.classOn("hidden");
      this.dom.standbyBumper.styleJs({ opacity: 0 });
      this.dom.newSongScreen.styleJs({ opacity: 0 });
      this.dom.mainContent.classOff("hidden");
      this.dom.songListContainer.classOff("hidden");
      this.dom.bottomActions.classOff("hidden");
      this.wrapper[this.state.isTypingNumber ? "classOn" : "classOff"](
        "is-typing"
      );
      const code = this.state.songNumber.padStart(5, "0");
      let activeSong = this.state.songNumber.length > 0 ? this.songMap.get(code) : this.state.highlightedIndex >= 0 ? this.songList[this.state.highlightedIndex] : null;
      this.dom.numberDisplay.text(
        this.state.songNumber.length > 0 ? code : activeSong ? activeSong.code : ""
      );
      this.dom.numberDisplay[activeSong ? "classOn" : "classOff"]("active");
      this.dom.songTitle.clear();
      if (activeSong) {
        const fmt = this.getFormatInfo(activeSong);
        new Html("span").classOn("format-badge").text(fmt.label).styleJs({
          backgroundColor: fmt.color,
          fontSize: "0.5em",
          fontFamily: "Rajdhani",
          verticalAlign: "middle",
          marginRight: "1rem",
          transform: "translateY(-0.1rem)",
          display: "inline-block",
          paddingLeft: "0.5em",
          paddingRight: "0.5em"
        }).appendTo(this.dom.songTitle);
        new Html("span").text(activeSong.title).styleJs({ verticalAlign: "middle" }).appendTo(this.dom.songTitle);
      } else if (this.state.songNumber.length === 5) {
        this.dom.songTitle.text("Song Not Found");
      }
      this.dom.songArtist.text(activeSong ? activeSong.artist : "");
      if (this.state.showSongList) {
        if (!currentPreventScroll && !this.state.isTypingNumber && this.state.highlightedIndex >= 0) {
          const itemTop = this.state.highlightedIndex * this.ITEM_HEIGHT;
          const itemBottom = itemTop + this.ITEM_HEIGHT;
          const container = this.dom.songListContainer.elm;
          const innerOffset = this.dom.listInner.elm.offsetTop;
          const actualItemTop = itemTop + innerOffset;
          const actualItemBottom = itemBottom + innerOffset;
          const viewTop = container.scrollTop;
          const viewBottom = viewTop + container.clientHeight;
          const headerSafeZone = 40;
          const bottomPadding = 24;
          if (actualItemTop < viewTop + headerSafeZone) {
            container.scrollTop = actualItemTop - headerSafeZone;
          } else if (actualItemBottom > viewBottom - bottomPadding) {
            container.scrollTop = actualItemBottom - container.clientHeight + bottomPadding;
          }
        }
        this.renderVirtualList();
        for (const [idx, item] of this.visibleItemsMap.entries()) {
          item[idx === this.state.highlightedIndex ? "classOn" : "classOff"](
            "highlighted"
          );
        }
      }
    });
  }
  /**
   * Presents or dismisses the in-game search layout.
   *
   * @param {boolean} visible - Truthy to show the overlay.
   */
  toggleSearchOverlay(visible) {
    if (this.state.currentSongIsMultiplexed)
      this.Forte.togglePianoRollVisibility(!visible);
    this.state.isSearchOverlayVisible = visible;
    if (visible) {
      this.wrapper.classOn("search-overlay-active");
      if (this.state.mode === "player")
        this.wrapper.classOn("in-game-search-active");
      this.state.highlightedSearchIndex = -1;
      if (this.state.searchResults.length > 0) {
        this.dom.searchWindow.classOn("has-results");
        this.updateSearchHighlight();
      }
      this.dom.searchInput.elm.focus();
      this.dom.searchInput.elm.select();
    } else {
      this.state.highlightedSearchIndex = -1;
      this.wrapper.classOff("search-overlay-active", "in-game-search-active");
      this.dom.searchWindow.classOff("has-results");
      this.dom.searchInput.elm.blur();
      if (this.state.mode === "player") this.infoBar.showDefault();
    }
  }
  /**
   * Builds a search index in the background to prevent lagging the UI during searches.
   */
  async buildSearchIndex() {
    const asianRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
    console.log("[Encore] Building search index...");
    for (let song of this.songList) {
      if (asianRegex.test(song.title) && !song._romaTitle) {
        song._romaTitle = await Romanizer_default.romanize(song.title);
      }
      if (asianRegex.test(song.artist) && !song._romaArtist) {
        song._romaArtist = await Romanizer_default.romanize(song.artist);
      }
    }
    console.log("[Encore] Search index complete.");
  }
  /**
   * Calculates the quality of a match to rank results.
   * Higher score = better match.
   */
  getMatchScore(text, query) {
    if (!text || !query) return 0;
    text = text.toLowerCase();
    if (text === query) return 100;
    if (text.startsWith(query)) return 90;
    if (text.includes(" " + query)) return 80;
    if (text.includes(query)) return 70;
    const textWords = text.split(/\s+/);
    const queryWords = query.trim().split(/\s+/);
    if (queryWords.length > 1 && queryWords.length <= textWords.length) {
      let isAcronymMatch = true;
      for (let i = 0; i < queryWords.length; i++) {
        if (!textWords[i].startsWith(queryWords[i])) {
          isAcronymMatch = false;
          break;
        }
      }
      if (isAcronymMatch) return 60;
    }
    if (this.fuzzyMatch(text, query)) return 40;
    return 0;
  }
  /**
   * Subsequence string matcher for fuzzy searching
   */
  fuzzyMatch(text, query) {
    if (!text || !query) return false;
    let queryIdx = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i].toLowerCase() === query[queryIdx]) {
        queryIdx++;
      }
      if (queryIdx === query.length) return true;
    }
    return false;
  }
  /**
   * Queries both local indexing and YouTube APIs to render a blended set of results.
   *
   * @returns {Promise<void>}
   */
  async performSearch() {
    const query = this.dom.searchInput.getValue().trim().toLowerCase();
    if (!query) {
      this.state.searchResults = [];
      this.renderSearchResults();
      return;
    }
    this.state.isSearching = true;
    let localResults = [];
    const isNumeric = /^\d+$/.test(query);
    for (const s of this.songList) {
      let score = 0;
      if (isNumeric) {
        if (s.code === query) score += 1e3;
        else if (s.code.includes(query)) score += 500;
      }
      const titleScore = Math.max(
        this.getMatchScore(s.title, query),
        this.getMatchScore(s._romaTitle, query)
      );
      const artistScore = Math.max(
        this.getMatchScore(s.artist, query),
        this.getMatchScore(s._romaArtist, query)
      );
      if (titleScore > 0) score += titleScore + 10;
      if (artistScore > 0) score += artistScore;
      if (score > 0) {
        localResults.push({
          ...s,
          type: "local",
          score,
          displayRomaTitle: this.getMatchScore(s._romaTitle, query) > 0 ? s._romaTitle : null,
          displayRomaArtist: this.getMatchScore(s._romaArtist, query) > 0 ? s._romaArtist : null
        });
      }
    }
    localResults.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    });
    localResults = localResults.slice(0, 75);
    this.state.searchResults = [...localResults];
    this.renderSearchResults();
    try {
      const res = await fetch(
        `http://127.0.0.1:${this.state.actualPort}/yt-search?q=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      const ytItems = (data.items || []).filter((i) => i.type === "video").map((i) => ({ ...i, type: "youtube" }));
      this.state.searchResults = [...localResults, ...ytItems];
      this.renderSearchResults();
    } catch (e) {
      console.error("YT Search failed", e);
    } finally {
      this.state.isSearching = false;
    }
  }
  /**
   * Projects search hits onto the UI window block.
   */
  renderSearchResults() {
    const prevHighlight = this.state.highlightedSearchIndex;
    this.dom.searchResultsContainer.clear();
    this.state.highlightedSearchIndex = prevHighlight;
    if (!this.state.searchResults.length) {
      this.dom.searchResultsContainer.text(
        this.state.isSearching ? "Searching..." : "No results found."
      );
      this.dom.searchWindow.classOff("has-results");
      this.state.highlightedSearchIndex = -1;
      return;
    }
    this.dom.searchWindow.classOn("has-results");
    this.state.searchResults.forEach((res, idx) => {
      const item = new Html("div").classOn("search-result-item").appendTo(this.dom.searchResultsContainer);
      item.on("click", () => {
        this.state.highlightedSearchIndex = idx;
        this.handleEnter();
      });
      item.on("mouseover", () => {
        this.state.highlightedSearchIndex = idx;
        this.updateSearchHighlight();
      });
      const info = new Html("div").classOn("search-info").appendTo(item);
      const fmt = this.getFormatInfo(res);
      if (res.type === "local") {
        new Html("div").classOn("search-result-local-code").text(res.code).appendTo(item);
        const titleRow = new Html("div").classOn("search-title").appendTo(info);
        new Html("span").classOn("format-badge").text(fmt.label).styleJs({ backgroundColor: fmt.color }).appendTo(titleRow);
        new Html("span").text(res.title).appendTo(titleRow);
        if (res.displayRomaTitle) {
          new Html("span").text(` (${res.displayRomaTitle})`).styleJs({ color: "#aaa", fontSize: "0.9em", marginLeft: "0.5rem" }).appendTo(titleRow);
        }
        const artistRow = new Html("div").classOn("search-channel").appendTo(info);
        new Html("span").text(res.artist).appendTo(artistRow);
        if (res.displayRomaArtist) {
          new Html("span").text(` (${res.displayRomaArtist})`).styleJs({ color: "#aaa", fontSize: "0.9em", marginLeft: "0.5rem" }).appendTo(artistRow);
        }
      } else {
        const thumb = new Html("div").classOn("search-thumbnail-wrapper").appendTo(item);
        const img = new Html("img").classOn("search-thumbnail").styleJs({ opacity: "0", transition: "opacity 0.3s ease" }).appendTo(thumb);
        img.elm.onload = () => {
          img.styleJs({ opacity: "1" });
        };
        img.attr({ src: res.thumbnail.thumbnails[0].url });
        if (res.length?.simpleText)
          new Html("span").classOn("search-duration").text(res.length.simpleText).appendTo(thumb);
        const titleC = new Html("div").styleJs({ display: "flex", alignItems: "center" }).appendTo(info);
        new Html("span").classOn("format-badge").text(fmt.label).styleJs({ backgroundColor: fmt.color }).appendTo(titleC);
        new Html("div").classOn("search-title").text(res.title).appendTo(titleC);
        new Html("div").classOn("search-channel").text(res.channelTitle).appendTo(info);
      }
    });
    if (this.state.highlightedSearchIndex >= this.state.searchResults.length) {
      this.state.highlightedSearchIndex = -1;
    }
    this.updateSearchHighlight();
  }
  /**
   * Refreshes the actively selected search entry item based on index state.
   */
  updateSearchHighlight() {
    this.dom.searchResultsContainer.qsa(".search-result-item").forEach((item, idx) => {
      item[idx === this.state.highlightedSearchIndex ? "classOn" : "classOff"]("highlighted");
      if (idx === this.state.highlightedSearchIndex)
        item.elm.scrollIntoView({ block: "nearest" });
    });
  }
  /**
   * Begins loading and processing of a track object, transitioning into playback mode.
   *
   * @param {Object} song - The target metadata object describing the media track.
   * @returns {Promise<void>}
   */
  async startPlayer(song) {
    this.state.isTransitioning = true;
    this.recorder.setSongInfo(song);
    this.cleanupPlayerEvents();
    this.lastCompletedSyllableIndex = -1;
    this.dom.countdownDisplay.classOff("visible").text("");
    this.countdownTargetTime = null;
    this.lastCountdownTick = null;
    if (this.lyricsRafId) cancelAnimationFrame(this.lyricsRafId);
    if (this.lyricsCtx) {
      this.lyricsCtx.save();
      this.lyricsCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.lyricsCtx.clearRect(
        0,
        0,
        this.dom.lyricsCanvas.elm.width,
        this.dom.lyricsCanvas.elm.height
      );
      this.lyricsCtx.restore();
    }
    this.renderableLines = [];
    this.currentMidiLine1 = [];
    this.currentMidiLine2 = [];
    this.currentLrcLine1 = null;
    this.currentLrcLine2 = null;
    this.midiLines = null;
    this.allMidiSyllables = null;
    this.dom.lyricsCanvas.styleJs({ opacity: "0" });
    this.scoreHud.hide();
    this.dom.introCard.classOff("visible");
    this.dom.introMeta.clear();
    this.dom.interludeOverlay.classOff("visible");
    this.state.isInterludeActive = false;
    this.dom.formatIndicator.styleJs({ opacity: "0" });
    this.state.currentSongIsMultiplexed = false;
    this.state.isDuet = false;
    this.boundDuetEvent = () => {
      this.state.isDuet = true;
      this.requestCanvasCacheUpdate = true;
    };
    document.addEventListener(
      "CherryTree.Forte.Playback.DuetDetected",
      this.boundDuetEvent
    );
    this.state.currentSongIsYouTube = song.path.startsWith("yt://");
    this.state.currentSongIsMV = !!song.videoPath;
    this.state.reservationNumber = "";
    this.setMode("player");
    if (this.state.currentSongIsYouTube)
      this.wrapper.classOn("mode-player-youtube");
    window.desktopIntegration.ipc.send("setRPC", {
      details: song.title,
      state: song.artist
    });
    this.socket.emit("broadcastData", {
      type: "now_playing",
      song: {
        ...song,
        isYouTube: this.state.currentSongIsYouTube,
        isMV: this.state.currentSongIsMV
      }
    });
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist
      });
    }
    if (this.state.currentSongIsYouTube) {
      this.Forte.stopTrack();
      this.Forte.togglePianoRollVisibility(false);
      this.state.windowsVolume = await window.volume.getVolume();
      let maxVolume = this.state.windowsVolume;
      window.volume.setVolume(this.state.volume * maxVolume);
      this.bgv.stop();
      this.dom.bgvContainer.classOn("hidden");
      this.dom.ytContainer.classOff("hidden");
      this.dom.ytIframe.attr({
        src: `https://cdpn.io/pen/debug/oNPzxKo?v=${song.path.substring(
          5
        )}&autoplay=1`,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      });
      if (!song.isLive && song.durationText) {
        const seconds = this.parseDuration(song.durationText);
        if (seconds > 0) {
          this.scheduleYoutubeSkip(seconds);
        }
      }
      this.dom.lyricsCanvas.classOn("hidden");
      this.dom.formatIndicator.styleJs({
        backgroundImage: 'url("/assets/img/icons/yt.png")',
        opacity: "1"
      });
      this.state.isTransitioning = false;
    } else {
      let mvPlayer = null;
      this.dom.lyricsCanvas.styleJs({ opacity: "0" }).classOff("hidden");
      if (this.state.currentSongIsMV) {
        const videoUrl = new URL(
          `http://127.0.0.1:${this.state.actualPort}/getFile`
        );
        videoUrl.searchParams.append("path", song.videoPath);
        mvPlayer = await this.bgv.playSingleVideo(videoUrl.href);
      } else {
        this.bgv.resumePlaylist();
      }
      this.dom.bgvContainer.classOff("hidden");
      this.dom.ytContainer.classOn("hidden");
      this.dom.ytIframe.attr({ src: "" });
      const trackUrl = new URL(
        `http://127.0.0.1:${this.state.actualPort}/getFile`
      );
      trackUrl.searchParams.append("path", song.path);
      await this.Forte.loadTrack(trackUrl.href);
      const pbState = this.Forte.getPlaybackState();
      this.state.currentSongIsMultiplexed = pbState.isMultiplexed;
      this.state.currentSongIsMIDI = pbState.isMidi;
      console.log(
        "[Encore] Is track multiplexed?",
        this.state.currentSongIsMultiplexed
      );
      console.log("[Encore] Is track MIDI?", this.state.currentSongIsMIDI);
      console.log("[Encore] Is track an MTV?", this.state.currentSongIsMV);
      if (this.state.currentSongIsMultiplexed) {
        this.Forte.togglePianoRollVisibility(true);
      } else if (this.state.currentSongIsMIDI && pbState.hasGuideNotes) {
        this.Forte.togglePianoRollVisibility(true);
      } else {
        this.Forte.togglePianoRollVisibility(false);
      }
      let icon = "rs.png";
      if (this.state.currentSongIsMV) icon = "mtv.png";
      else if (this.state.currentSongIsMultiplexed) icon = "mp.png";
      else if (pbState.isMidi) icon = "midi.png";
      this.dom.formatIndicator.styleJs({
        backgroundImage: `url("/assets/img/icons/${icon}")`,
        opacity: "1"
      });
      if (!this.state.currentSongIsYouTube) {
        this.scoreHud.show(0);
        this.Forte.togglePianoRollVisibility(
          this.state.currentSongIsMultiplexed || this.state.currentSongIsMIDI
        );
      }
      this.dom.introTitle.text(this.truncateTitleIfNeeded(song.title));
      this.dom.introArtist.text(song.artist);
      this.dom.introCard.classOn("visible");
      this.dom.lyricsCanvas.styleJs({ opacity: "1" });
      this.currentBpm = pbState.midiInfo ? pbState.midiInfo.initialBpm || 120 : 120;
      this.boundTempoUpdate = (e) => {
        this.currentBpm = e.detail.bpm;
      };
      document.addEventListener(
        "CherryTree.Forte.Playback.TempoEvent",
        this.boundTempoUpdate
      );
      await this.setupLyrics(song, pbState);
      this.setupTimeUpdate(mvPlayer);
      if (!this.state.currentSongIsYouTube) {
        this.boundScoreUpdate = (e) => this.scoreHud.show(e.detail.finalScore);
        document.addEventListener(
          "CherryTree.Forte.Scoring.Update",
          this.boundScoreUpdate
        );
      }
      setTimeout(() => {
        if (this.state.mode !== "player") {
          this.state.isTransitioning = false;
          return;
        }
        this.dom.introCard.classOff("visible");
        if (mvPlayer) mvPlayer.play().catch(console.error);
        this.Forte.playTrack();
        this.state.isTransitioning = false;
        setTimeout(() => {
          if (this.state.scoreSkipped) {
            this.state.scoreSkipped = false;
          }
        }, 5e3);
      }, 2500);
    }
  }
  /**
   * Synchronously digests lyrics payload, whether encoded as absolute time in LRC
   * or tick-based within a sequenced MIDI file.
   *
   * @param {Object} song - The playing track context.
   * @param {Object} pbState - State payload derived from the SpessaSynth library describing formatting internals.
   * @returns {Promise<void>}
   */
  async setupLyrics(song, pbState) {
    this.parsedLrc = [];
    this.interludes = [];
    this.countdowns = [];
    this.allMidiSyllables = [];
    const getSecondsForTick = (targetTick, tempoChanges, ppqm) => {
      if (targetTick <= 0) return 0;
      let time = 0;
      let currentTick = 0;
      let currentBpm = 120;
      if (tempoChanges && tempoChanges.length > 0) {
        let chronologicalChanges = tempoChanges.map((tc, index) => {
          let tick = tc.ticks !== void 0 ? tc.ticks : tc.tick;
          let val = tc.tempo || tc.bpm || 120;
          let bpm = val > 1e3 ? Math.round(6e7 / val) : val;
          if (bpm <= 0) bpm = 120;
          return { tick, bpm, _originalIndex: index };
        }).sort((a, b) => {
          if (a.tick !== b.tick) return a.tick - b.tick;
          return b._originalIndex - a._originalIndex;
        });
        for (let tc of chronologicalChanges) {
          if (tc.tick >= targetTick) break;
          if (tc.tick > currentTick) {
            let deltaTicks = tc.tick - currentTick;
            time += deltaTicks / ppqm * (60 / currentBpm);
            currentTick = tc.tick;
          }
          currentBpm = tc.bpm;
        }
      }
      let remainingTicks = targetTick - currentTick;
      if (remainingTicks > 0) {
        time += remainingTicks / ppqm * (60 / currentBpm);
      }
      return time;
    };
    if (pbState.isMidi) {
      this.dom.lyricsCanvas.styleJs({ display: "block" });
      const midiInfo = pbState.midiInfo;
      let ppqm = midiInfo.timeDivision || 480;
      let lyricsToParse = [...pbState.decodedLyrics];
      let displayBpm = 120;
      if (midiInfo.tempoChanges && midiInfo.tempoChanges.length > 0) {
        let initialChanges = midiInfo.tempoChanges.filter(
          (t) => (t.ticks !== void 0 ? t.ticks : t.tick) === 0
        );
        let firstTc = initialChanges.length > 0 ? initialChanges[0] : midiInfo.tempoChanges[0];
        let val = firstTc.tempo || firstTc.bpm || 120;
        displayBpm = val > 1e3 ? Math.round(6e7 / val) : Math.round(val);
      }
      this.dom.introMeta.text(`BPM: ${displayBpm}`);
      let fullMetadataString = "";
      while (lyricsToParse.length > 0 && (lyricsToParse[0].trim().startsWith("{@") || lyricsToParse[0].trim().startsWith("{#"))) {
        fullMetadataString += lyricsToParse.shift();
      }
      if (fullMetadataString) {
        const metadata = {};
        const regex = /{#([^=]+)=([^}]+)}/g;
        let match;
        while ((match = regex.exec(fullMetadataString)) !== null) {
          metadata[match[1].toUpperCase()] = match[2];
        }
        if (metadata.TITLE)
          this.dom.introTitle.text(this.truncateTitleIfNeeded(metadata.TITLE));
        if (metadata.ARTIST) this.dom.introArtist.text(metadata.ARTIST);
      }
      const allSyllables = [];
      const lines = [];
      let currentLineSyllables = [];
      let displayableSyllableIndex = 0;
      let offsetIndex = pbState.decodedLyrics.length - lyricsToParse.length;
      let currentDuetRole = "a";
      for (let i = 0; i < lyricsToParse.length; i++) {
        const syllableText = lyricsToParse[i];
        const tick = midiInfo.ticks[i + offsetIndex];
        const absoluteTime = getSecondsForTick(
          tick,
          midiInfo.tempoChanges,
          ppqm
        );
        const startsWithNewLine = /^[\r\n\/\\\\]/.test(syllableText);
        const endsWithNewLine = /[\r\n\/\\\\]$/.test(syllableText);
        let cleanText = syllableText.replace(/[\r\n\/\\]/g, "");
        let displayText = cleanText;
        const markerMatch = displayText.match(/\[(m|f|m2|f2|a)\]/g);
        if (markerMatch) {
          currentDuetRole = markerMatch[markerMatch.length - 1].replace(
            /[\[\]]/g,
            ""
          );
          displayText = displayText.replace(/\[(m|f|m2|f2|a)\]/g, "");
        }
        if (startsWithNewLine && currentLineSyllables.length > 0) {
          lines.push(currentLineSyllables);
          currentLineSyllables = [];
        }
        if (cleanText) {
          let mainText = displayText;
          let furiganaText = null;
          if (displayText) {
            const furiMatch = displayText.match(/^(.+?)\[(.+?)\]$/);
            if (furiMatch) {
              mainText = furiMatch[1];
              furiganaText = furiMatch[2];
            }
          }
          const syllable = {
            text: mainText,
            furigana: furiganaText,
            romanized: null,
            romanizationPromise: null,
            rawText: cleanText,
            displayText,
            globalIndex: displayableSyllableIndex,
            lineIndex: lines.length,
            tick,
            absoluteTime,
            durationTicks: 0,
            duetRole: currentDuetRole,
            isHidden: displayText.length === 0
          };
          allSyllables.push(syllable);
          currentLineSyllables.push(syllable);
          displayableSyllableIndex++;
        }
        if (endsWithNewLine && cleanText && currentLineSyllables.length > 0) {
          lines.push(currentLineSyllables);
          currentLineSyllables = [];
        }
      }
      if (currentLineSyllables.length > 0) lines.push(currentLineSyllables);
      if (allSyllables.length > 0 && allSyllables[0].tick >= 8 * ppqm) {
        let nTick = allSyllables[0].tick;
        this.countdowns.push({
          t3: getSecondsForTick(nTick - 3 * ppqm, midiInfo.tempoChanges, ppqm),
          t2: getSecondsForTick(nTick - 2 * ppqm, midiInfo.tempoChanges, ppqm),
          t1: getSecondsForTick(nTick - 1 * ppqm, midiInfo.tempoChanges, ppqm),
          t0: getSecondsForTick(nTick, midiInfo.tempoChanges, ppqm)
        });
      }
      for (let i = 0; i < allSyllables.length - 1; i++) {
        let cur = allSyllables[i];
        let next = allSyllables[i + 1];
        cur.durationTicks = Math.max(0, next.tick - cur.tick);
        let gapTicks = next.tick - cur.tick;
        cur.endTime = getSecondsForTick(
          cur.tick + cur.durationTicks,
          midiInfo.tempoChanges,
          ppqm
        );
        if (cur.rawText.match(/[\r\n\/\\]$/)) {
          const beatDuration = getSecondsForTick(cur.tick + ppqm, midiInfo.tempoChanges, ppqm) - cur.absoluteTime;
          cur.endTime = Math.min(cur.endTime, cur.absoluteTime + beatDuration);
        }
        cur.endTime = Math.min(cur.endTime, cur.absoluteTime + 1.5);
        if (gapTicks >= 8 * ppqm) {
          let intStart = cur.tick + 2 * ppqm;
          let intEnd = next.tick - 4 * ppqm;
          this.interludes.push({
            start: getSecondsForTick(intStart, midiInfo.tempoChanges, ppqm),
            end: getSecondsForTick(intEnd, midiInfo.tempoChanges, ppqm)
          });
          this.countdowns.push({
            t3: getSecondsForTick(
              next.tick - 3 * ppqm,
              midiInfo.tempoChanges,
              ppqm
            ),
            t2: getSecondsForTick(
              next.tick - 2 * ppqm,
              midiInfo.tempoChanges,
              ppqm
            ),
            t1: getSecondsForTick(
              next.tick - 1 * ppqm,
              midiInfo.tempoChanges,
              ppqm
            ),
            t0: getSecondsForTick(next.tick, midiInfo.tempoChanges, ppqm)
          });
        }
      }
      if (allSyllables.length > 0) {
        let last = allSyllables[allSyllables.length - 1];
        last.durationTicks = ppqm;
        const beatDuration = getSecondsForTick(last.tick + ppqm, midiInfo.tempoChanges, ppqm) - last.absoluteTime;
        last.endTime = last.absoluteTime + Math.min(beatDuration, 1.5);
      }
      this.allMidiSyllables = allSyllables;
      this.lastCompletedSyllableIndex = -1;
      this.currentPpqm = ppqm;
      this.allMidiSyllables = allSyllables;
      this.lastCompletedSyllableIndex = -1;
      this.currentSongLineIndex = 0;
      this.nextLineFadeStartMs = null;
      this.nextLineFadeDurationMs = 0;
      this.midiLines = lines;
      this.currentMidiLine1 = this.midiLines[0] || [];
      this.currentMidiLine2 = this.midiLines[1] || [];
      this.resolveRomajiForLine = async (lineIndex) => {
        if (!this.midiLines || lineIndex >= this.midiLines.length) return;
        const line = this.midiLines[lineIndex];
        let hasChanges = false;
        for (const syllable of line) {
          if (!syllable.romanized && !syllable.romanizationPromise) {
            syllable.romanizationPromise = Romanizer_default.romanize(
              syllable.furigana || syllable.text
            ).then((rt) => {
              syllable.romanized = rt || "";
            });
            await syllable.romanizationPromise;
            hasChanges = true;
            await new Promise((r) => setTimeout(r, 2));
          }
        }
        if (hasChanges && (lineIndex === this.currentSongLineIndex || lineIndex === this.currentSongLineIndex + 1)) {
          this.calculateLyricLayout();
          this.requestCanvasCacheUpdate = true;
        }
      };
      this.resolveRomajiForLine(0);
      this.resolveRomajiForLine(1);
      this.resolveRomajiForLine(2);
      this.resizeLyricsCanvas();
      this.dom.lyricsCanvas.styleJs({ opacity: "1" });
      let currentVisualIndex = 0;
      this.boundLyricEvent = (e) => {
        const { text } = e.detail;
        if (!text) return;
        let targetSyllable = allSyllables[currentVisualIndex];
        let matchFound = false;
        if (targetSyllable && targetSyllable.rawText === text) {
          matchFound = true;
        } else {
          if (text.trim().length > 0) {
            const limit = Math.min(
              currentVisualIndex + 15,
              allSyllables.length
            );
            for (let i = currentVisualIndex + 1; i < limit; i++) {
              if (allSyllables[i].rawText === text) {
                currentVisualIndex = i;
                targetSyllable = allSyllables[i];
                matchFound = true;
                break;
              }
            }
          }
        }
        if (!matchFound) return;
        if (targetSyllable.lineIndex !== this.currentSongLineIndex) {
          this.currentSongLineIndex = targetSyllable.lineIndex;
          this.triggerLineFade();
          if (this.currentSongLineIndex % 2 === 0) {
            this.currentMidiLine1 = this.midiLines[this.currentSongLineIndex] || [];
            this.currentMidiLine2 = this.midiLines[this.currentSongLineIndex + 1] || [];
          } else {
            this.currentMidiLine2 = this.midiLines[this.currentSongLineIndex] || [];
            this.currentMidiLine1 = this.midiLines[this.currentSongLineIndex + 1] || [];
          }
          this.calculateLyricLayout();
          this.resolveRomajiForLine(this.currentSongLineIndex + 2);
        }
        targetSyllable.wipeStartTime = performance.now();
        let durationS = targetSyllable.durationTicks / this.currentPpqm * (60 / this.currentBpm);
        if (targetSyllable.rawText.match(/[\r\n\/\\]$/)) {
          durationS = Math.min(
            durationS,
            this.currentPpqm / this.currentPpqm * (60 / this.currentBpm)
          );
        }
        targetSyllable.wipeDurationMs = Math.max(
          100,
          Math.min(durationS * 1e3, 1500)
        );
        this.lastCompletedSyllableIndex = targetSyllable.globalIndex - 1;
        currentVisualIndex++;
      };
      document.addEventListener(
        "CherryTree.Forte.Playback.LyricEvent",
        this.boundLyricEvent
      );
      this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
    } else if (song.lrcPath) {
      const lrcText = await this.FsSvc.readFile(song.lrcPath);
      this.parsedLrc = await this.parseLrc(lrcText);
      if (this.parsedLrc.length > 0) {
        const asianRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
        for (let i = 0; i < this.parsedLrc.length; i++) {
          let line = this.parsedLrc[i];
          let needsRomaji = asianRegex.test(line.text);
          let syllables = [];
          if (!needsRomaji) {
            const blocks = line.text.match(/\S+\s*/g) || [line.text];
            syllables = blocks.map((block) => ({
              text: block,
              rawText: block,
              furigana: null,
              romanized: null,
              blockWidth: 0,
              absoluteTime: line.time,
              endTime: line.time + 1,
              durationTicks: 0,
              duetRole: "default",
              isHidden: block.trim() === ""
            }));
          } else {
            let chunks = [];
            if (line.text.match(/[ 　]/)) {
              chunks = line.text.match(/[^ 　]+[ 　]*/g) || [line.text];
            } else if (line.text.length > 16) {
              let puncChunks = line.text.match(/[^、。！？]+[、。！？]*/g) || [
                line.text
              ];
              for (let c of puncChunks) {
                if (c.length > 16) {
                  chunks.push(...c.match(/.{1,12}/g) || [c]);
                } else {
                  chunks.push(c);
                }
              }
            } else {
              chunks = [line.text];
            }
            for (let chunk of chunks) {
              let chunkRomaji = null;
              const trimmed = chunk.trim();
              if (trimmed.length > 0) {
                let romResult = await Romanizer_default.romanize(trimmed);
                if (romResult && romResult !== "null") {
                  chunkRomaji = romResult;
                  if (chunk.match(/[ 　]$/)) chunkRomaji += " ";
                }
              }
              syllables.push({
                text: chunk,
                rawText: chunk,
                furigana: null,
                romanized: chunkRomaji,
                blockWidth: 0,
                absoluteTime: line.time,
                endTime: line.time + 1,
                durationTicks: 0,
                duetRole: "default",
                isHidden: trimmed === ""
              });
            }
          }
          line.syllables = syllables;
        }
        this.currentLrcLine1 = this.parsedLrc[0];
        this.currentLrcLine2 = this.parsedLrc[1];
        this.isLrcLine2Active = false;
        this.currentLrcIndex = -1;
        this.lrcChangeTime = 0;
        this.nextLineFadeStartMs = performance.now();
        this.nextLineFadeDurationMs = 500;
        this.resizeLyricsCanvas();
        this.dom.lyricsCanvas.styleJs({ opacity: "1" });
        this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
        if (this.parsedLrc[0].time > 4) {
          this.countdowns.push(this.parsedLrc[0].time);
        }
        for (let i = 0; i < this.parsedLrc.length - 1; i++) {
          let cur = this.parsedLrc[i];
          let next = this.parsedLrc[i + 1];
          if (next.time - cur.time > 8) {
            this.countdowns.push(next.time);
          }
        }
      }
    }
  }
  /**
   * Calculates the timing for the upcoming line and triggers a fade animation if the song pacing allows it.
   * Yes the design is very TJ Media Supremo
   */
  triggerLineFade() {
    this.nextLineFadeStartMs = performance.now();
    const nextLineIdx = this.currentSongLineIndex + 1;
    const nextLine = this.midiLines ? this.midiLines[nextLineIdx] : null;
    if (nextLine && nextLine.length > 0) {
      const nextLineStartTime = nextLine[0].absoluteTime;
      const currentTime = this.currentMediaTime || 0;
      const timeUntilNext = nextLineStartTime - currentTime;
      if (timeUntilNext < 1.2) {
        this.nextLineFadeDurationMs = 0;
      } else {
        this.nextLineFadeDurationMs = 500;
      }
    } else {
      this.nextLineFadeDurationMs = 0;
    }
  }
  /**
   * Translates an active string block into DOM visual lyrics content.
   *
   * @param {Object} displayEl - Target display element wrapper.
   * @param {Object} lineData - Dictionary representing the raw text segment and matching romanization properties.
   */
  renderLrcLine(displayEl, lineData) {
    displayEl.clear();
    if (!lineData) return;
    new Html("div").classOn("lyric-line-original").text(lineData.text).appendTo(displayEl);
    if (lineData.romanized)
      new Html("div").classOn("lyric-line-romanized").text(lineData.romanized).appendTo(displayEl);
  }
  /**
   * Destructures an LRC syntax text stream into a synchronized objects timeline.
   *
   * @param {string} text - Payload raw content.
   * @returns {Promise<Array<{time: number, text: string, romanized: string}>>} Ordered event segments matching playback markers.
   */
  async parseLrc(text) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    if (!text) return [];
    const lines = text.split("\n");
    const promises = lines.map(async (line) => {
      const match = line.match(regex);
      if (!match) return null;
      const time = parseInt(match[1]) * 60 + parseInt(match[2]) + parseInt(match[3].padEnd(3, "0")) / 1e3;
      const txt = line.replace(regex, "").trim();
      if (!txt) return null;
      return { time, text: txt, romanized: await Romanizer_default.romanize(txt) };
    });
    return (await Promise.all(promises)).filter(Boolean);
  }
  /**
   * Manages sync updates pushing data toward DOM endpoints during continuous media streams.
   *
   * @param {Object|null} mvPlayer - HTMLVideoElement if syncing to an absolute local Music Video.
   */
  setupTimeUpdate(mvPlayer) {
    let currentLrcIndex = -1;
    this.lastCountdownTick = null;
    this.boundTimeUpdate = (e) => {
      const { currentTime } = e.detail;
      this.currentMediaTime = currentTime;
      if (this.midiLines && this.midiLines.length > 0) {
        let newLineIndex = 0;
        for (let i = 0; i < this.midiLines.length; i++) {
          let line = this.midiLines[i];
          if (line.length === 0) continue;
          let lastSyllable = line[line.length - 1];
          if (currentTime >= lastSyllable.endTime + 0.1) {
            newLineIndex = i + 1;
          } else {
            break;
          }
        }
        newLineIndex = Math.min(newLineIndex, this.midiLines.length - 1);
        if (this.currentSongLineIndex !== newLineIndex) {
          this.currentSongLineIndex = newLineIndex;
          this.triggerLineFade();
          if (this.currentSongLineIndex % 2 === 0) {
            this.currentMidiLine1 = this.midiLines[this.currentSongLineIndex] || [];
            this.currentMidiLine2 = this.midiLines[this.currentSongLineIndex + 1] || [];
          } else {
            this.currentMidiLine2 = this.midiLines[this.currentSongLineIndex] || [];
            this.currentMidiLine1 = this.midiLines[this.currentSongLineIndex + 1] || [];
          }
          this.calculateLyricLayout();
          this.requestCanvasCacheUpdate = true;
          if (this.resolveRomajiForLine) {
            this.resolveRomajiForLine(this.currentSongLineIndex + 2);
          }
        }
      }
      if (mvPlayer) {
        const target = currentTime + this.state.videoSyncOffset / 1e3;
        const drift = (target - mvPlayer.currentTime) * 1e3;
        if (Math.abs(drift) > 500) {
          mvPlayer.currentTime = target;
          mvPlayer.playbackRate = 1;
        } else if (Math.abs(drift) > 50)
          mvPlayer.playbackRate = drift > 0 ? 1.05 : 0.95;
        else mvPlayer.playbackRate = 1;
      }
      if (this.interludes && this.interludes.length > 0) {
        let inInterlude = this.interludes.find(
          (ind) => currentTime >= ind.start && currentTime < ind.end
        );
        if (inInterlude) {
          if (!this.state.isInterludeActive) {
            this.state.isInterludeActive = true;
            const tip = TEMP_TIPS[Math.floor(Math.random() * TEMP_TIPS.length)];
            this.dom.interludeTipBox.text(tip);
            TEMP_TIPS.splice(TEMP_TIPS.indexOf(tip), 1);
            if (TEMP_TIPS.length === 0) {
              TEMP_TIPS = structuredClone(INTERLUDE_TIPS);
            }
            this.dom.interludeOverlay.classOn("visible");
            this.dom.lyricsCanvas.styleJs({ opacity: "0" });
          }
        } else {
          if (this.state.isInterludeActive) {
            this.state.isInterludeActive = false;
            this.dom.interludeOverlay.classOff("visible");
            this.dom.lyricsCanvas.styleJs({ opacity: "1" });
            this.lastCompletedSyllableIndex = -1;
          }
        }
      }
      if (this.countdowns && this.countdowns.length > 0) {
        let activeCd = this.countdowns.find((c) => {
          if (typeof c === "number")
            return c - currentTime > 0.2 && c - currentTime <= 3.2;
          return currentTime >= c.t3 && currentTime < c.t0;
        });
        if (activeCd) {
          let tick = null;
          if (typeof activeCd === "number") {
            let rem = activeCd - currentTime;
            tick = Math.ceil(rem).toString();
            if (parseInt(tick) > 3) tick = null;
          } else {
            if (currentTime >= activeCd.t1) tick = "1";
            else if (currentTime >= activeCd.t2) tick = "2";
            else if (currentTime >= activeCd.t3) tick = "3";
          }
          if (tick && tick !== this.lastCountdownTick) {
            this.lastCountdownTick = tick;
            this.dom.countdownDisplay.text(tick);
            this.dom.countdownDisplay.classOn("visible");
          }
        } else if (this.lastCountdownTick !== null) {
          this.lastCountdownTick = null;
          this.dom.countdownDisplay.classOff("visible");
        }
      }
      if (this.parsedLrc && this.parsedLrc.length) {
        let newIdx = currentLrcIndex;
        while (newIdx + 1 < this.parsedLrc.length && currentTime >= this.parsedLrc[newIdx + 1].time) {
          newIdx++;
        }
        if (newIdx > 0 && currentTime < this.parsedLrc[newIdx].time) {
          newIdx = -1;
          while (newIdx + 1 < this.parsedLrc.length && currentTime >= this.parsedLrc[newIdx + 1].time) {
            newIdx++;
          }
        }
        if (newIdx !== currentLrcIndex && newIdx >= 0) {
          if (this.nextLineUpdateTimeout)
            clearTimeout(this.nextLineUpdateTimeout);
          currentLrcIndex = newIdx;
          this.currentLrcIndex = currentLrcIndex;
          this.isLrcLine2Active = currentLrcIndex % 2 !== 0;
          this.lrcChangeTime = performance.now();
          if (this.isLrcLine2Active) {
            this.currentLrcLine2 = this.parsedLrc[currentLrcIndex];
            this.currentLrcLine1 = this.parsedLrc[currentLrcIndex + 1];
          } else {
            this.currentLrcLine1 = this.parsedLrc[currentLrcIndex];
            this.currentLrcLine2 = this.parsedLrc[currentLrcIndex + 1];
          }
          if (currentLrcIndex > 0) {
            this.nextLineFadeStartMs = performance.now();
            this.nextLineFadeDurationMs = 500;
          }
          this.calculateLyricLayout();
        }
      }
    };
    document.addEventListener(
      "CherryTree.Forte.Playback.TimeUpdate",
      this.boundTimeUpdate
    );
  }
  /**
   * Enqueues an on-screen timer sequence toward the next specified event anchor.
   *
   * @param {number} targetTime - Time location marker setting an implicit offset.
   */
  scheduleCountdown(targetTime) {
    this.countdownTargetTime = targetTime;
    this.lastCountdownTick = null;
    this.dom.countdownDisplay.classOff("visible");
  }
  /**
   * Forces a total stop on active play sequences, clearing dependent systems.
   */
  stopPlayer() {
    this.recorder.clearSongInfo();
    this.dom.introCard.classOff("visible");
    this.dom.ytContainer.classOn("hidden");
    this.dom.ytIframe.attr({ src: "" });
    this.clearYoutubeTimers();
    this.dom.bgvContainer.classOff("hidden");
    this.Forte.stopTrack();
    this.cleanupPlayerEvents();
    this.dom.countdownDisplay.classOff("visible").text("");
    this.dom.formatIndicator.styleJs({ opacity: "0" });
    this.state.isInterludeActive = false;
    if (this.dom.interludeOverlay) {
      this.dom.interludeOverlay.classOff("visible");
    }
    if (this.dom.lyricsCanvas) {
      this.dom.lyricsCanvas.styleJs({ opacity: "1", pointerEvents: "all" });
    }
    if (this.state.currentSongIsYouTube) {
      window.volume.setVolume(this.state.windowsVolume);
    }
    this.state.currentSongIsMV = false;
    this.state.currentSongIsYouTube = false;
    this.state.currentSongIsMultiplexed = false;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
    }
  }
  /**
   * Destroys active event watchers explicitly mapped exclusively to the currently playing song instance.
   */
  cleanupPlayerEvents() {
    if (this.nextLineUpdateTimeout) clearTimeout(this.nextLineUpdateTimeout);
    this.nextLineUpdateTimeout = null;
    if (this.boundTimeUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundTimeUpdate
      );
    if (this.boundLyricEvent)
      document.removeEventListener(
        "CherryTree.Forte.Playback.LyricEvent",
        this.boundLyricEvent
      );
    if (this.boundScoreUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Scoring.Update",
        this.boundScoreUpdate
      );
    if (this.boundTempoUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TempoEvent",
        this.boundTempoUpdate
      );
    if (this.boundDuetEvent)
      document.removeEventListener(
        "CherryTree.Forte.Playback.DuetDetected",
        this.boundDuetEvent
      );
    this.boundTimeUpdate = null;
    this.boundLyricEvent = null;
    this.boundScoreUpdate = null;
    this.boundTempoUpdate = null;
    this.boundDuetEvent = null;
  }
  /**
   * Triggers downstream progression steps in response to system audio signals.
   *
   * @param {Event} e - Payload encapsulating system stream statuses.
   * @returns {Promise<void>}
   */
  async handlePlaybackUpdate(e) {
    const { status } = e.detail || {};
    if (this.state.mode.startsWith("player") && this.state.lastPlaybackStatus === "playing" && status === "stopped") {
      if (this.state.isTransitioning) return;
      this.state.isTransitioning = true;
      this.Forte.togglePianoRollVisibility(false);
      if (this.recorder.isRecording) this.recorder.stop();
      const wasLocalAudio = !this.state.currentSongIsYouTube;
      const wasMV = this.state.currentSongIsMV;
      this.scoreHud.hide();
      if (wasMV) await this.bgv.resumePlaylist();
      this.stopPlayer();
      if (wasLocalAudio) {
        const finalScore = this.Forte.getPlaybackState().score;
        await this.showPostSongScreen(finalScore);
      }
      this.transitionAfterSong();
    }
    this.state.lastPlaybackStatus = status;
  }
  /**
   * Proceeds to queue the next song sequentially or return completely to idle.
   */
  transitionAfterSong() {
    if (this.state.reservationQueue.length > 0) {
      const next = this.state.reservationQueue.shift();
      this.infoBar.showDefault();
      setTimeout(() => this.startPlayer(next), 250);
    } else {
      this.setMode("menu");
      window.desktopIntegration.ipc.send("setRPC", {
        details: `Browsing ${this.songList.length} Songs...`,
        state: `Main Menu`
      });
      setTimeout(() => {
        if (!this.state.reservationQueue.length)
          this.state.isTransitioning = false;
      }, 1500);
    }
  }
  /**
   * Manages the visual rendering and skip-blocking of the final performance ranking display.
   *
   * @param {Object} scoreData - Analytics mapped from internal pitch measuring libraries.
   * @returns {Promise<void>} Resolves when screen transitions are finalized.
   */
  async showPostSongScreen(scoreData) {
    this.state.isScoreScreenActive = true;
    this.dom.rankDisplay.text("").styleJs({ transform: "scale(0.8)", opacity: "0", color: "#fff" });
    this.dom.finalScoreDisplay.text("0");
    this.dom.postSongScreen.styleJs({ opacity: "1", pointerEvents: "all" });
    const s = Math.floor(scoreData.finalScore);
    let rank = "Good";
    let rankColor = "#aed581";
    if (s == 100) {
      rank = "HOW DID YOU PULL THAT OFF";
      rankColor = "#00e676";
    } else if (s >= 98) {
      rank = "WHAT";
      rankColor = "#00e676";
    } else if (s >= 90) {
      rank = "EXCELLENT";
      rankColor = "#29b6f6";
    } else if (s >= 80) {
      rank = "GREAT";
      rankColor = "#ffee58";
    } else if (s >= 60) {
      rank = "GOOD";
      rankColor = "#ffca28";
    } else if (s >= 50) {
      rank = "DECENT";
      rankColor = "#ffca28";
    } else if (s >= 20) {
      rank = "NICE TRY";
      rankColor = "#ffca28";
    } else {
      rank = "yikes";
      rankColor = "#ef5350";
    }
    const playAudioSequence = async () => {
      await new Promise((r) => setTimeout(r, 1e3));
      if (this.state.scoreSkipped) return;
      let fanfareUrl = "/assets/audio/fanfare-2.mid";
      if (s == 100) {
        fanfareUrl = "/assets/audio/fanfare-4.mid";
      } else if (s >= 70) {
        fanfareUrl = "/assets/audio/fanfare-3.mid";
      } else if (s >= 20) {
        fanfareUrl = "/assets/audio/fanfare.mid";
      }
      let fanfareFinished;
      if (this.state.isScoreFanfareEnabled) {
        fanfareFinished = await this.Forte.playSfx(fanfareUrl, 0.5);
        if (!fanfareFinished || this.state.scoreSkipped) return;
      } else {
        await new Promise((r) => setTimeout(r, 4e3));
      }
      let playedNarration = false;
      if (this.state.isScoreNarrationEnabled) {
        const narrations = this.libraryInfo?.manifest?.additionalContents?.scoreNarrations;
        if (narrations && Array.isArray(narrations)) {
          const match = narrations.find((n) => s >= n.min && s <= n.max);
          if (match && match.file) {
            const narrationUrl = new URL(
              `http://127.0.0.1:${this.state.actualPort}/getFile`
            );
            narrationUrl.searchParams.append(
              "path",
              pathJoin([this.libraryInfo.path, match.file])
            );
            await this.Forte.playSfx(narrationUrl.href);
            playedNarration = true;
          }
        }
        if (!playedNarration) {
          let defaultNarrationUrl = "/assets/audio/scores/0.wav";
          if (s >= 70) {
            defaultNarrationUrl = "/assets/audio/scores/70.wav";
          } else if (s >= 50) {
            defaultNarrationUrl = "/assets/audio/scores/50.wav";
          } else if (s >= 20) {
            defaultNarrationUrl = "/assets/audio/scores/20.wav";
          }
          await this.Forte.playSfx(defaultNarrationUrl);
        }
      } else {
        await new Promise((r) => setTimeout(r, 5e3));
      }
    };
    const animate = async () => {
      const dur = 3800;
      const start = performance.now();
      await new Promise((r) => {
        if (this.state.scoreSkipped) return;
        const tick = () => {
          const now = performance.now();
          const p = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          const curScore = s * ease;
          this.dom.finalScoreDisplay.text(Math.floor(curScore));
          if (p < 1) requestAnimationFrame(tick);
          else r();
        };
        requestAnimationFrame(tick);
      });
      if (typeof window !== "undefined" && typeof window.confetti === "function" && !this.state.scoreSkipped && s >= 70) {
        window.confetti({
          position: {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          },
          count: 67,
          fade: true
        });
      }
      if (this.state.scoreSkipped) return;
      this.dom.rankDisplay.text(rank).styleJs({
        transform: "scale(1)",
        opacity: "1",
        color: rankColor,
        transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
      });
    };
    await Promise.race([
      Promise.all([animate(), playAudioSequence()]),
      new Promise((resolve) => {
        this.state.scoreSkipResolver = resolve;
      })
    ]);
    this.dom.postSongScreen.styleJs({ opacity: "0", pointerEvents: "none" });
    this.state.isScoreScreenActive = false;
    this.state.scoreSkipResolver = null;
    await new Promise((r) => setTimeout(r, 400));
  }
  /**
   * Presents UI sequences triggering the backend microphone calibration logic routines.
   *
   * @returns {Promise<void>}
   */
  async runCalibrationSequence() {
    if (this.state.isTransitioning) return;
    this.state.isTransitioning = true;
    this.dom.calibTitle.text("LATENCY COMPENSATION");
    this.dom.calibText.html(
      "Please place your microphone near your speakers and ensure the room is quiet.<br>The test will begin in five (5) seconds..."
    );
    this.dom.calibrationScreen.classOn("visible");
    await new Promise((r) => setTimeout(r, 5e3));
    this.dom.calibText.text("Calibrating... A series of beeps will play.");
    try {
      const lat = await this.Forte.runLatencyTest();
      window.config.setItem("audioConfig.micLatency", lat);
      this.dom.calibTitle.text("CALIBRATION COMPLETE");
      this.dom.calibText.text(
        `Measured audio latency is ${(lat * 1e3).toFixed(0)} ms.`
      );
      this.infoBar.showTemp(
        "CALIBRATION",
        `Success! ${(lat * 1e3).toFixed(0)} ms`,
        5e3
      );
    } catch (e) {
      console.error("[Encore] Calibration failed:", e);
      this.dom.calibTitle.text("CALIBRATION FAILED");
      this.dom.calibText.html(
        `Could not get a reliable measurement.<br>Please check your microphone input, speaker volume, and reduce background noise.`
      );
      this.infoBar.showTemp("CALIBRATION", "Failed. Please try again.", 5e3);
    }
    await new Promise((r) => setTimeout(r, 6e3));
    this.dom.calibrationScreen.classOff("visible");
    this.state.isTransitioning = false;
  }
  /**
   * Global catch mechanism translating keyboard presses into mapped command functions.
   *
   * @param {KeyboardEvent} e - A raw DOM keydown occurrence.
   */
  handleKeyDown(e) {
    if (this.mixer.isVisible) {
      this.mixer.handleKeyDown(e);
      return;
    }
    if (this.state.isDeletePromptOpen) {
      e.preventDefault();
      if (e.key === "Escape") this.cancelDeletePrompt();
      else if (e.key === "Enter") this.confirmDeleteRecording();
      return;
    }
    if (this.state.isPlayingRecording) {
      e.preventDefault();
      this.triggerRecOsd();
      if (e.key === "Escape" || e.key === "Backspace") {
        this.closeRecordingPlayer();
      } else if (e.key === " " || e.key === "Enter") {
        const v = this.dom.recVideoPlayer.elm;
        v.paused ? v.play() : v.pause();
      } else if (e.key === "ArrowLeft") {
        this.dom.recVideoPlayer.elm.currentTime = Math.max(
          0,
          this.dom.recVideoPlayer.elm.currentTime - 5
        );
      } else if (e.key === "ArrowRight") {
        this.dom.recVideoPlayer.elm.currentTime += 5;
      } else if (e.key === "-" || e.key === "_") {
        this.handleVolume("down");
        this.dom.recVideoPlayer.elm.volume = this.state.volume;
      } else if (e.key === "=" || e.key === "+") {
        this.handleVolume("up");
        this.dom.recVideoPlayer.elm.volume = this.state.volume;
      }
      return;
    }
    if (this.state.isRecordingsOpen) {
      e.preventDefault();
      if (e.key === "Escape" || e.key === "Backspace") {
        this.toggleRecordingsList(false);
      } else if (e.key === "ArrowUp") {
        this.state.highlightedRecordingIndex = Math.max(
          0,
          this.state.highlightedRecordingIndex - 1
        );
        this.updateRecordingsHighlight();
      } else if (e.key === "ArrowDown") {
        this.state.highlightedRecordingIndex = Math.min(
          this.state.recordingsData.length - 1,
          this.state.highlightedRecordingIndex + 1
        );
        this.updateRecordingsHighlight();
      } else if (e.key === "Enter") {
        const rec = this.state.recordingsData[this.state.highlightedRecordingIndex];
        if (rec) this.playRecording(rec);
      } else if (e.key === "Delete") {
        const rec = this.state.recordingsData[this.state.highlightedRecordingIndex];
        if (rec) this.openDeletePrompt(rec);
      }
      return;
    }
    if (this.state.isYtSkipWarningActive && e.key === "ArrowUp") {
      e.preventDefault();
      this.extendYoutubeSkip();
      return;
    }
    if (this.state.isScoreScreenActive) {
      if (["Enter", " ", "Escape"].includes(e.key)) {
        if (this.state.scoreSkipResolver) {
          this.Forte.stopSfx();
          this.state.scoreSkipped = true;
          this.state.scoreSkipResolver();
        }
        e.preventDefault();
      }
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      if (this.state.mode === "player" && this.state.lastPlaybackStatus === "playing") {
        this.infoBar.showTemp(
          "ACCESS DENIED",
          "Please stop playback to enter Setup.",
          3e3
        );
        return;
      }
      if (!this.state.isPromptingSetup) {
        this.state.isPromptingSetup = true;
        this.dom.newSongScreen.classOn("hidden");
        this.dom.standbyScreen.classOff("hidden");
        this.dom.standbyBumper.classOn("hidden");
        this.dom.standbyText.classOff("hidden").text("REBOOT TO SETUP? PRESS ENTER");
        this.dom.mainContent.classOn("hidden");
        this.dom.songListContainer.classOn("hidden");
        return;
      }
    }
    const isInputFocused = document.activeElement === this.dom.searchInput.elm;
    if (isInputFocused) {
      if (e.key === "Backspace" && !this.dom.searchInput.getValue()) {
        e.preventDefault();
        this.handleBackspace();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) return;
      e.preventDefault();
    } else {
      e.preventDefault();
    }
    if (this.state.mode === "menu" && !this.state.showSongList) {
      if (e.key >= "0" && e.key <= "9" || e.key.startsWith("Arrow") || e.key.toLowerCase() === "y") {
        this.state.showSongList = true;
      }
    }
    if (e.key.toLowerCase() === "m") {
      this.mixer.toggle();
      return;
    }
    if (e.key.toLowerCase() === "r") {
      if (this.state.mode === "player" && !this.state.currentSongIsYouTube) {
        this.recorder.toggle();
      } else if (this.state.mode === "menu") {
        this.toggleRecordingsList();
      }
      return;
    }
    if (e.key >= "0" && e.key <= "9") this.handleDigitInput(e.key);
    else if (e.key === "Backspace") this.handleBackspace();
    else if (e.key === "Enter") this.handleEnter();
    else if (e.key === "Escape") this.handleEscape();
    else if (e.key === "ArrowUp") this.handleNav("up");
    else if (e.key === "ArrowDown") this.handleNav("down");
    else if (e.key === "ArrowLeft") this.handlePan("left");
    else if (e.key === "ArrowRight") this.handlePan("right");
    else if (e.key === "-") this.handleVolume("down");
    else if (e.key === "=") this.handleVolume("up");
    else if (e.key === "[" || e.key === "]") this.handleBracket(e.key);
    else if (e.key.toLowerCase() === "y") this.handleYKey();
  }
  /**
   * Processes numerical keypresses against the active code input buffer strings.
   *
   * @param {string} digit - An individual character ranging "0"-"9".
   */
  handleDigitInput(digit) {
    const target = this.state.mode === "player" ? "reservationNumber" : "songNumber";
    this.state[target] = this.state[target].length >= 5 ? digit : this.state[target] + digit;
    if (this.state.mode !== "player") {
      this.Forte.stopSfx();
      this.Forte.playSfx(`/assets/audio/numbers/${digit}.wav`);
      this.state.isTypingNumber = true;
      this.updateMenuUI();
    } else {
      this._updateReservationUI(false);
    }
  }
  /**
   * Responds to the delete backspace key deleting elements on various modes inputs buffers.
   */
  handleBackspace() {
    if (this.state.isSearchOverlayVisible && !this.dom.searchInput.getValue())
      this.toggleSearchOverlay(false);
    else if (this.state.mode === "player" && this.state.reservationNumber) {
      this.state.reservationNumber = this.state.reservationNumber.slice(0, -1);
      if (this.state.reservationNumber.length === 0) {
        this.infoBar.showDefault();
        this._updateReservationUI(true);
      } else {
        this._updateReservationUI(false);
      }
    } else if (this.state.mode === "menu" && this.state.songNumber) {
      this.state.songNumber = this.state.songNumber.slice(0, -1);
      if (!this.state.songNumber) this.state.isTypingNumber = false;
      this.updateMenuUI();
    } else if (this.state.mode === "yt-search" && !this.dom.searchInput.getValue())
      this.setMode("menu");
  }
  /**
   * Renders the bottom screen informational banner regarding live queued reservations while typing.
   *
   * @param {boolean} isTemp - Flag indicating fading temporariness of visibility.
   */
  _updateReservationUI(isTemp) {
    const displayCode = this.state.reservationNumber.padStart(5, "0");
    const song = this.songMap.get(displayCode);
    let fmtBadge = "";
    if (song) {
      const fmt = this.getFormatInfo(song);
      fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
    }
    let songInfo = song ? `${fmtBadge} <span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>` : this.state.reservationNumber.length === 5 ? `<span style="opacity: 0.5;">No song found.</span>` : "";
    const content = `<span class="info-bar-code">${displayCode}</span> ${songInfo}`;
    if (isTemp) {
      this.infoBar.showTemp("RESERVING", content, 3e3);
    } else {
      if (this.infoBar.isTempVisible) {
        this.infoBar.isTempVisible = false;
        if (this.infoBar.timeout) {
          clearTimeout(this.infoBar.timeout);
          this.infoBar.timeout = null;
        }
        this.infoBar.bar.classOff("temp-visible");
      }
      this.infoBar.show("RESERVING", content);
      this.infoBar.showBar();
    }
  }
  /**
   * Action executing commits to text blocks or selections, transitioning to play.
   */
  handleEnter() {
    if (this.state.isPromptingSetup) {
      this.state.isPromptingSetup = false;
      window.desktopIntegration.ipc.send("setRPC", {
        details: "Rebooting...",
        state: ""
      });
      sessionStorage.setItem("encore_boot_setup", "true");
      window.location.reload();
      return;
    }
    const isInputFocused = document.activeElement === this.dom.searchInput.elm;
    const isSearchActive = this.state.isSearchOverlayVisible || this.state.mode === "yt-search" || isInputFocused || this.dom.searchWindow.elm.classList.contains("has-results") && this.state.highlightedSearchIndex !== -1;
    if (this.state.mode === "menu") {
      if (isSearchActive) {
        if (this.state.highlightedSearchIndex !== -1) {
          const res = this.state.searchResults[this.state.highlightedSearchIndex];
          const song = res.type === "local" ? { ...res } : {
            title: res.title,
            artist: res.channelTitle,
            path: `yt://${res.id}`,
            durationText: res.length?.simpleText,
            isLive: res.isLive
          };
          this.state.songNumber = "";
          this.state.highlightedIndex = -1;
          this.state.isTypingNumber = false;
          this.state.highlightedSearchIndex = -1;
          this.dom.searchInput.elm.value = "";
          this.state.searchResults = [];
          this.renderSearchResults();
          if (this.state.isSearchOverlayVisible)
            this.toggleSearchOverlay(false);
          if (this.state.mode === "yt-search") this.setMode("menu");
          this.startPlayer(song);
        }
        return;
      }
      if (this.state.reservationQueue.length)
        this.startPlayer(this.state.reservationQueue.shift());
      else {
        let song = this.state.songNumber ? this.songMap.get(this.state.songNumber.padStart(5, "0")) : this.state.highlightedIndex >= 0 ? this.songList[this.state.highlightedIndex] : null;
        if (song) {
          this.state.songNumber = "";
          this.state.highlightedIndex = -1;
          this.state.isTypingNumber = false;
          this.startPlayer(song);
        }
      }
    } else if (this.state.mode === "player") {
      if (isSearchActive) {
        if (this.state.highlightedSearchIndex !== -1) {
          const res = this.state.searchResults[this.state.highlightedSearchIndex];
          const song = res.type === "local" ? { ...res } : {
            title: res.title,
            artist: res.channelTitle,
            path: `yt://${res.id}`,
            durationText: res.length?.simpleText,
            isLive: res.isLive
          };
          this.state.reservationQueue.push(song);
          const codeSpan = song.code ? `<span class="info-bar-code">${song.code}</span>` : `<span class="info-bar-code is-youtube">YT</span>`;
          const fmt = this.getFormatInfo(song);
          const fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
          this.infoBar.showTemp(
            "RESERVED",
            `${codeSpan} ${fmtBadge} <span class="info-bar-title">${song.title}</span>`,
            4e3
          );
          this.state.highlightedSearchIndex = -1;
          this.dom.searchInput.elm.value = "";
          this.state.searchResults = [];
          this.renderSearchResults();
          this.toggleSearchOverlay(false);
        }
        return;
      } else if (this.state.reservationNumber) {
        const song = this.songMap.get(
          this.state.reservationNumber.padStart(5, "0")
        );
        if (song) {
          this.state.reservationQueue.push(song);
          this.infoBar.showDefault();
        }
        this.state.reservationNumber = "";
      }
    } else if (this.state.mode === "yt-search" && this.state.highlightedSearchIndex !== -1) {
      const res = this.state.searchResults[this.state.highlightedSearchIndex];
      const song = res.type === "local" ? { ...res } : {
        title: res.title,
        artist: res.channelTitle,
        path: `yt://${res.id}`,
        durationText: res.length?.simpleText,
        isLive: res.isLive
      };
      this.state.highlightedSearchIndex = -1;
      this.dom.searchInput.elm.value = "";
      this.state.searchResults = [];
      this.renderSearchResults();
      this.startPlayer(song);
    }
  }
  /**
   * Action reversing states or dropping contexts.
   */
  handleEscape() {
    if (this.state.isTransitioning) return;
    if (this.state.isPromptingSetup) {
      this.state.isPromptingSetup = false;
      this.dom.standbyText.text("SELECT SONG");
      this.updateMenuUI();
      return;
    }
    if (this.state.isSearchOverlayVisible) {
      this.toggleSearchOverlay(false);
      return;
    }
    const isInputFocused = document.activeElement === this.dom.searchInput.elm;
    const hasResults = this.dom.searchWindow.elm.classList.contains("has-results");
    if (isInputFocused || hasResults || this.state.mode === "yt-search") {
      this.dom.searchInput.elm.blur();
      this.state.highlightedSearchIndex = -1;
      this.state.searchResults = [];
      this.dom.searchInput.elm.value = "";
      this.renderSearchResults();
      if (this.state.mode === "yt-search") {
        this.setMode("menu");
      }
      return;
    }
    if (this.state.mode === "menu") {
      if (this.state.isTypingNumber) {
        this.state.songNumber = "";
        this.state.isTypingNumber = false;
        this.updateMenuUI();
      } else if (this.state.showSongList) {
        this.state.showSongList = false;
        this.state.highlightedIndex = -1;
        this.updateMenuUI();
      }
      return;
    }
    if (this.state.mode.startsWith("player")) {
      if (this.state.reservationNumber) {
        this.state.reservationNumber = "";
        this.infoBar.showDefault();
      } else if (this.state.currentSongIsYouTube) {
        this.stopPlayer();
        this.bgv.start();
        this.transitionAfterSong();
      } else this.Forte.stopTrack();
    }
  }
  /**
   * Action traversing lists vertically.
   *
   * @param {string} dir - Literal string "up" or "down".
   */
  handleNav(dir) {
    const isInputFocused = document.activeElement === this.dom.searchInput.elm;
    const isSearchActive = this.state.mode === "yt-search" || this.state.isSearchOverlayVisible || isInputFocused || this.dom.searchWindow.elm.classList.contains("has-results");
    if (isSearchActive) {
      const change = dir === "down" ? 1 : -1;
      if (isInputFocused) {
        if (change > 0 && this.state.searchResults.length > 0) {
          this.dom.searchInput.elm.blur();
          this.state.highlightedSearchIndex = 0;
        }
      } else {
        if (change < 0 && this.state.highlightedSearchIndex <= 0) {
          this.state.highlightedSearchIndex = -1;
          this.dom.searchInput.elm.focus();
        } else {
          this.state.highlightedSearchIndex = Math.max(
            0,
            Math.min(
              this.state.searchResults.length - 1,
              this.state.highlightedSearchIndex + change
            )
          );
        }
      }
      this.updateSearchHighlight();
    } else if (this.state.mode === "menu") {
      const change = dir === "down" ? 1 : -1;
      this.state.songNumber = "";
      this.state.isTypingNumber = false;
      let idx = this.state.highlightedIndex + change;
      this.state.highlightedIndex = Math.max(
        0,
        Math.min(this.songList.length - 1, idx)
      );
      this.updateMenuUI();
    } else if (this.state.mode === "player") {
      if (this.state.currentSongIsYouTube) return;
      const change = dir === "up" ? 1 : -1;
      const cur = this.Forte.getPlaybackState().transpose || 0;
      const next = Math.max(-24, Math.min(24, cur + change));
      this.Forte.setTranspose(next);
      let left = 50;
      let width = 0;
      if (next > 0) {
        width = next / 24 * 50;
      } else if (next < 0) {
        width = Math.abs(next) / 24 * 50;
        left = 50 - width;
      }
      const html = `
        <div class="transpose-display">
          <div class="transpose-min">-24</div>
          <div class="transpose-slider-container">
            <div class="transpose-slider-center-line"></div>
            <div class="transpose-slider-fill" style="left: ${left}%; width: ${width}%;"></div>
          </div>
          <div class="transpose-max">+24</div>
          <span class="transpose-value">${(next > 0 ? "+" : "") + next} st</span>
        </div>
      `;
      this.infoBar.showTemp("TRANSPOSE", html, 3e3);
    }
  }
  /**
   * Action balancing channel splits in capable Multiplex tracks.
   *
   * @param {string} dir - Literal string "left" or "right".
   */
  handlePan(dir) {
    if (this.state.mode !== "player") return;
    const pb = this.Forte.getPlaybackState();
    if (!pb.isMultiplexed) return;
    const change = dir === "right" ? 0.2 : -0.2;
    const pan = Math.max(
      -1,
      Math.min(1, parseFloat((pb.multiplexPan + change).toFixed(1)))
    );
    this.Forte.setMultiplexPan(pan);
    let txt = "BALANCED";
    if (pan <= -0.99) {
      txt = "INSTRUMENTAL";
      generateDialog(
        new Html("div").classOn("temp-dialog-text").text("VOCAL OFF")
      );
    } else if (pan >= 0.99) {
      txt = "VOCAL GUIDE";
      generateDialog(
        new Html("div").classOn("temp-dialog-text").text("INST. OFF")
      );
    } else {
      txt = pan < 0 ? `\u25C0 ${Math.abs(Math.round(pan * 100))}% INST` : `VOC ${Math.round(pan * 100)}% \u25B6`;
    }
    this.infoBar.showTemp("VOCAL BALANCE", txt, 3e3);
  }
  /**
   * Translates volume commands into absolute level shifts.
   *
   * @param {string} dir - Literal string "up" or "down".
   */
  handleVolume(dir) {
    this.state.volume = Math.max(
      0,
      Math.min(1, this.state.volume + (dir === "up" ? 0.05 : -0.05))
    );
    this.Forte.setTrackVolume(this.state.volume);
    if (this.state.currentSongIsYouTube) {
      let maxVolume = this.state.windowsVolume;
      window.volume.setVolume(this.state.volume * maxVolume);
    }
    const p = Math.round(this.state.volume * 100);
    this.infoBar.showTemp(
      "VOLUME",
      `<div class="volume-display"><div class="volume-slider-container"><div class="volume-slider-fill" style="width: ${p}%"></div></div><span class="volume-percentage">${p}%</span></div>`,
      3e3
    );
    window.config.setItem(
      "audioConfig.mix.instrumental.volume",
      this.state.volume
    );
  }
  /**
   * Action triggering BGV sequence cyclings or MV sync drifting.
   *
   * @param {string} key - A "[" or "]" literal character indicating direction.
   */
  handleBracket(key) {
    if (this.state.currentSongIsMV) {
      this.state.videoSyncOffset += key === "]" ? 10 : -10;
      this.infoBar.showTemp(
        "VIDEO SYNC",
        (this.state.videoSyncOffset > 0 ? "+" : "") + this.state.videoSyncOffset + " ms",
        3e3
      );
      window.config.setItem(
        "videoConfig.syncOffset",
        this.state.videoSyncOffset
      );
    } else {
      this.bgv.cycleCategory(key === "[" ? -1 : 1);
      const cats = ["Auto", ...this.bgv.categories.map((c) => c.BGV_CATEGORY)];
      const html = `<div class="bgv-category-list">` + cats.map(
        (c) => `<span class="bgv-category-item ${c === this.bgv.selectedCategory ? "selected" : ""}">${c}</span>`
      ).join("") + `</div>`;
      this.infoBar.showTemp("BGV", html, 3e3);
      setTimeout(() => {
        const activeCat = document.querySelector(".bgv-category-item.selected");
        if (activeCat) {
          activeCat.scrollIntoView({
            behavior: "auto",
            block: "nearest",
            inline: "center"
          });
        }
      }, 50);
    }
  }
  /**
   * Handler bridging the user shortcut jumping into a search flow layout.
   */
  handleYKey() {
    if (this.state.isTransitioning) return;
    if (this.state.mode === "menu") this.setMode("yt-search");
    else if (this.state.mode === "player")
      this.toggleSearchOverlay(!this.state.isSearchOverlayVisible);
  }
  /**
   * Binds socket events mapping the remote controller app commands into actions here.
   */
  setupSocketListeners() {
    this.socket.on("join", (joinInformation) => {
      if (joinInformation.type == "remote") {
        this.state.knownRemotes[joinInformation.identity] = {
          connectedAt: new Date(Date.now()).toISOString(),
          commandsSent: 0
        };
        this.updateRemoteCount();
        console.log("[LINK] New remote connected.", this.state.knownRemotes);
        this.infoBar.showTemp("LINK", "A new Remote has connected.", 5e3);
      }
    });
    this.socket.on("leave", (leaveInformation) => {
      delete this.state.knownRemotes[leaveInformation.identity];
      delete this.state.activeSockets[leaveInformation.identity];
      this.state.typingUsers.delete(leaveInformation.identity);
      this.updateRemoteCount();
      this.broadcastSocialState();
    });
    this.socket.on("execute-command", (cmd) => {
      const d = cmd.data;
      if (d.type === "set_nickname") {
        const deviceId = d.deviceId || cmd.identity;
        const uniqueName = this.generateUniqueNickname(d.value, deviceId);
        this.state.deviceRegistry[deviceId] = { nickname: uniqueName };
        this.state.activeSockets[cmd.identity] = deviceId;
        this.socket.emit("sendData", {
          identity: cmd.identity,
          data: {
            type: "social_init",
            nickname: uniqueName,
            history: this.state.chatHistory
          }
        });
        this.broadcastSocialState();
        return;
      }
      if (d.type === "chat_message") {
        const deviceId = this.state.activeSockets[cmd.identity];
        const sender = deviceId && this.state.deviceRegistry[deviceId] ? this.state.deviceRegistry[deviceId].nickname : "Guest";
        const msgObj = {
          id: Date.now(),
          sender,
          text: d.value.substring(0, 200),
          time: Date.now()
        };
        this.state.chatHistory.push(msgObj);
        if (this.state.chatHistory.length > 100) this.state.chatHistory.shift();
        this.state.typingUsers.delete(cmd.identity);
        this.socket.emit("broadcastData", {
          type: "new_chat",
          message: msgObj
        });
        this.broadcastSocialState();
        return;
      }
      if (d.type === "send_cheer") {
        const deviceId = this.state.activeSockets[cmd.identity];
        const sender = deviceId && this.state.deviceRegistry[deviceId] ? this.state.deviceRegistry[deviceId].nickname : "Guest";
        this.state.cheerQueue.push({
          nickname: sender,
          message: d.value.substring(0, 50)
        });
        this.processCheerQueue();
        return;
      }
      if (d.type === "typing_state") {
        if (d.value) this.state.typingUsers.add(cmd.identity);
        else this.state.typingUsers.delete(cmd.identity);
        this.broadcastSocialState();
        return;
      }
      switch (d.type) {
        case "digit":
          this.state.showSongList = true;
          this.handleDigitInput(d.value);
          break;
        case "backspace":
          this.handleBackspace();
          break;
        case "reserve":
        case "enter":
          this.handleEnter();
          break;
        case "stop":
          this.handleEscape();
          break;
        case "vol_up":
          this.handleVolume("up");
          break;
        case "vol_down":
          this.handleVolume("down");
          break;
        case "key_up":
          this.handleNav("up");
          break;
        case "key_down":
          this.handleNav("down");
          break;
        case "pan_left":
          this.handlePan("left");
          break;
        case "pan_right":
          this.handlePan("right");
          break;
        case "toggle_recording":
          if (this.state.mode === "player" && !this.state.currentSongIsYouTube)
            this.recorder.toggle();
          break;
        case "toggle_bgv":
          if (!this.state.currentSongIsMV) {
            this.handleBracket("]");
          } else {
            this.infoBar.showTemp(
              "BGV",
              `This function is not available in Music Videos.`,
              5e3
            );
            generateDialog(
              new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
              2e3
            );
          }
          break;
        case "yt_search_open":
          if (!this.state.isTransitioning) this.handleYKey();
          break;
        case "yt_search_close":
          if (this.state.mode === "yt-search") {
            this.setMode("menu");
          } else {
            this.toggleSearchOverlay(false);
          }
          break;
        case "nav_up":
          this.handleNav("up");
          break;
        case "nav_down":
          this.handleNav("down");
          break;
        case "yt_search_query":
          this.dom.searchInput.elm.value = d.value;
          this.performSearch();
          break;
        case "get_song_list":
          this.socket.emit("sendData", {
            identity: cmd.identity,
            data: { type: "songlist", contents: this.songList }
          });
          break;
        case "reserve_code":
          const s = this.songMap.get(d.value.padStart(5, "0"));
          if (s) {
            this.state.mode === "menu" ? this.startPlayer(s) : (this.state.reservationQueue.push(s), this.infoBar.showDefault());
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "reserve_response",
                success: true,
                song: { code: s.code, title: s.title, artist: s.artist }
              }
            });
          } else {
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "reserve_response",
                success: false,
                reason: "Not found"
              }
            });
          }
          break;
        case "client_yt_search":
          (async () => {
            try {
              const query = d.value;
              const res = await fetch(
                `http://127.0.0.1:${this.state.actualPort}/yt-search?q=${encodeURIComponent(query)}`
              );
              const data = await res.json();
              const ytItems = (data.items || []).filter((i) => i.type === "video").map((item) => ({
                id: item.id,
                title: item.title,
                channelTitle: item.channelTitle,
                length: item.length,
                isLive: item.isLive,
                thumbnail: item.thumbnail?.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`
              }));
              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: { type: "yt_search_results", results: ytItems }
              });
            } catch (e) {
              console.error("Client YT Search failed", e);
            }
          })();
          break;
        case "reserve_yt":
          const ytSong = {
            title: d.value.title,
            artist: d.value.artist || d.value.channelTitle,
            path: d.value.path || `yt://${d.value.id}`,
            durationText: d.value.durationText,
            isLive: d.value.isLive,
            code: "YT"
          };
          if (this.state.mode === "menu") {
            this.startPlayer(ytSong);
          } else {
            this.state.reservationQueue.push(ytSong);
            this.infoBar.showDefault();
          }
          this.socket.emit("sendData", {
            identity: cmd.identity,
            data: { type: "reserve_response", success: true, song: ytSong }
          });
          break;
      }
    });
  }
  /**
   * Finalizes class, unmounting event listeners to prevent leakage.
   */
  destroy() {
    if (this.boundKeydown)
      window.removeEventListener("keydown", this.boundKeydown);
    if (this.boundPlaybackUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.Update",
        this.boundPlaybackUpdate
      );
    this.cleanupPlayerEvents();
    if (this.recorder.isRecording) this.recorder.stop();
    this.bgv.stop();
    this.Forte.stopTrack();
    this.wrapper.cleanup();
  }
};
var controller;
var pkg = {
  name: "Encore Home",
  type: "app",
  privs: 0,
  start: async function(Root) {
    const config = await window.config.getAll();
    controller = new EncoreController(Root, config);
    await controller.init();
  },
  end: async function() {
    if (controller) {
      controller.destroy();
      controller = null;
    }
  }
};
var EncoreHome_default = pkg;
export {
  EncoreHome_default as default
};
/**
 * Joins path parts with a given separator, normalizing leading and trailing slashes.
 *
 * @author anneb (Modified by community)
 * @license CC BY-SA 4.0
 * @see https://stackoverflow.com/a
 *
 * @param {string[]} parts - The path segments to join.
 * @param {string} [sep="/"] - The separator to use.
 * @returns {string} The normalized joined path.
 */
//# sourceMappingURL=EncoreHome.js.map
