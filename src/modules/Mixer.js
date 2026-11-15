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
   * @param {Object} appState - The app's global state
   */
  constructor(forteSvc, appState = null) {
    this.Forte = forteSvc;
    this.appState = appState;
    this.isVisible = false;
    this.modal = null;
    this.state = {};

    this._micSaveTimeout = null;
    this._musicSaveTimeout = null;
    this._sessionSaveTimeout = null;

    this.focusedPane = "faders";
    this.faderIndex = 0;
    this.chainIndex = 0;
    this.selectedParamIndex = 0;
    this.isExpanded = false;

    this.activeChannel = "mic";
    this.musicState = { chain: [], rawConfig: [] };

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
        "Navigate: Arrows | Switch Panels: Tab | Switch Channel: Shift+Tab | Select/Expand: Enter | Reorder: Shift+Up/Down | Remove: Backspace | Close: ESC",
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

    let startedOnBackdrop = false;
    this.modal.on("mousedown", (e) => {
      startedOnBackdrop = e.target === this.modal.elm;
    });
    this.modal.on("click", (e) => {
      if (startedOnBackdrop && e.target === this.modal.elm) this.toggle();
      startedOnBackdrop = false;
    });

    this._setupGlobalMouseEvents();

    this._deafenStateHandler = () => {
      if (this.isVisible) this._updateFaderVisuals();
    };
    document.addEventListener(
      "Encore.Sessions.DeafenStateUpdate",
      this._deafenStateHandler,
    );
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
      this.activeChannel = "mic";
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
    this.musicState = this.Forte.getMusicChainState?.() || {
      chain: [],
      rawConfig: [],
    };
    this._renderFaders();
    this._renderChain();
    if (this.isExpanded) this._renderPluginControls();
    this._updateHighlights();
  }

  /**
   * Returns the chain state for the channel currently being edited.
   * @returns {Object} Active chain state
   */
  _getActiveChainState() {
    return this.activeChannel === "music" ? this.musicState : this.state;
  }

  /**
   * Switches the effects chain being edited in the mixer.
   * @param {"mic"|"music"|"session"} channel - Target channel
   * @param {Object} [options] - Options
   * @param {boolean} [options.preserveFaderFocus] - Keep the currently focused fader
   */
  _setActiveChannel(channel, { preserveFaderFocus = false } = {}) {
    const changed = this.activeChannel !== channel;
    this.activeChannel = channel;

    if (!preserveFaderFocus) this.faderIndex = this._faderIndexForType(channel);
    if (!changed) return;

    this.chainIndex = 0;
    this._renderChain();
    if (this.isExpanded) this._renderPluginControls();
    this._updateHighlights();
  }

  /**
   * Applies and saves a new chain configuration for the active channel.
   * @param {Array} newConfig - The new chain configuration to apply and save
   * @returns {Promise<void>}
   */
  async _applyAndSaveChain(newConfig) {
    const isMusic = this.activeChannel === "music";
    const configKey = isMusic
      ? "audioConfig.musicChain"
      : "audioConfig.vocalChain";

    window.config.setItem(configKey, newConfig);

    if (isMusic) {
      await this.Forte.loadMusicChain(newConfig);
    } else {
      await this.Forte.loadVocalChain(newConfig);
    }

    this.build();
  }

  _saveMicVolume(val) {
    if (this._micSaveTimeout) clearTimeout(this._micSaveTimeout);
    this._micSaveTimeout = setTimeout(() => {
      window.config?.setItem("audioConfig.micMonitorVolume", val);
      window.config?.setItem("audioConfig.micRecordingVolume", val);
    }, 300);
  }

  _saveMusicVolume(val) {
    if (this._musicSaveTimeout) clearTimeout(this._musicSaveTimeout);
    this._musicSaveTimeout = setTimeout(() => {
      window.config?.setItem("audioConfig.mix.instrumental.volume", val);
    }, 300);
  }

  _saveSessionVolume(val) {
    if (this._sessionSaveTimeout) clearTimeout(this._sessionSaveTimeout);
    this._sessionSaveTimeout = setTimeout(() => {
      window.config?.setItem("audioConfig.sessionVolume", val);
    }, 300);
  }

  /**
   * Maps a fader type to its left-to-right index.
   * @param {"mic"|"music"|"session"} type - Fader identifier
   * @returns {number}
   */
  _faderIndexForType(type) {
    if (type === "mic") return 0;
    if (type === "music") return 1;
    return 2;
  }

  /**
   * Maps a fader index back to its type.
   * @param {number} index - Fader index
   * @returns {"mic"|"music"|"session"}
   */
  _faderTypeForIndex(index) {
    if (index === 0) return "mic";
    if (index === 1) return "music";
    return "session";
  }

  /**
   * Renders the mic, music and session faders section of the mixer.
   */
  _renderFaders() {
    this.fadersSection.clear();

    const createFader = (label, maxVal, type) => {
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
          cursor: "var(--cursor-pointer)",
        })
        .appendTo(faderArea);

      hitArea.on("mousedown", (e) => {
        this.isDraggingFader = true;
        this.dragFaderType = type;
        this._handleFaderMouse(e, track.elm, type, maxVal);
      });

      strip.on("mousedown", () => {
        this.faderIndex = this._faderIndexForType(type);
        this._setActiveChannel(type, {
          preserveFaderFocus: true,
        });
        this.focusedPane = "faders";
        this._updateHighlights();
      });

      return { strip, track, thumb, valDisplay, vuFill, type, maxVal };
    };

    this.micFader = createFader("MIC", 2.0, "mic");
    this.musicFader = createFader("MUSIC", 1.0, "music");
    this.sessionFader = createFader("SESSION", 1.0, "session");

    this._updateFaderVisuals();
  }

  /**
   * Updates the visual representation of faders based on current state.
   */
  _updateFaderVisuals() {
    if (!this.micFader || !this.musicFader || !this.sessionFader) return;

    const micVal = this.state.micMonitorVolume ?? this.state.micGain ?? 1.0;
    const micPercent = (micVal / 2.0) * 100;
    this.micFader.thumb.styleJs({ bottom: `calc(${micPercent}% - 8px)` });
    this.micFader.valDisplay.text(`${(micVal * 100).toFixed(0)} %`);

    const musVal =
      this.Forte.getPlaybackState?.()?.volume ??
      this.appState?.volume ??
      this.state.musicGain ??
      1.0;
    const musPercent = (musVal / 1.0) * 100;
    this.musicFader.thumb.styleJs({ bottom: `calc(${musPercent}% - 8px)` });
    this.musicFader.valDisplay.text(`${(musVal * 100).toFixed(0)} %`);

    const sessionState = this.Forte.getSessionMonitorState?.() || {
      volume: this.appState?.sessionVolume ?? 1.0,
      deafened: false,
    };
    const sesVal = sessionState.volume ?? 1.0;
    const sesPercent = (sesVal / 1.0) * 100;
    this.sessionFader.thumb.styleJs({ bottom: `calc(${sesPercent}% - 8px)` });
    this.sessionFader.valDisplay
      .text(`${(sesVal * 100).toFixed(0)} %`)
      .styleJs({ color: sessionState.deafened ? "#ff5555" : "#89cff0" });

    this.sessionFader.strip.classOff("deafened");
    if (sessionState.deafened) this.sessionFader.strip.classOn("deafened");
  }

  /**
   * Adjusts the currently focused fader by a delta value.
   * @param {number} delta - The amount to adjust the fader by
   */
  _adjustFader(delta) {
    if (this.faderIndex === 0) {
      let currentVal = this.state.micMonitorVolume ?? this.state.micGain ?? 1.0;
      let val = Math.max(0, Math.min(2.0, currentVal + delta));
      this.Forte.setMicRecordingVolume(val);
      this.Forte.setMicMonitorVolume?.(val);
      this.state.micGain = val;
      this.state.micMonitorVolume = val;
      this._saveMicVolume(val);
    } else if (this.faderIndex === 1) {
      let currentVal =
        this.Forte.getPlaybackState?.()?.volume ??
        this.appState?.volume ??
        this.state.musicGain ??
        1.0;
      let val = Math.max(0, Math.min(1.0, currentVal + delta));
      this.Forte.setTrackVolume?.(val);
      this.Forte.setMusicRecordingVolume(val);
      this.state.musicGain = val;
      if (this.appState) this.appState.volume = val;
      this._saveMusicVolume(val);
    } else {
      const sessionState = this.Forte.getSessionMonitorState?.() || {
        volume: 1.0,
      };
      const currentVal = sessionState.volume ?? 1.0;
      const val = Math.max(0, Math.min(1.0, currentVal + delta));
      this.Forte.setSessionVolume?.(val);
      if (this.appState) this.appState.sessionVolume = val;
      this._saveSessionVolume(val);
    }
    this._updateFaderVisuals();
  }

  /**
   * Renders the active chain section and available plugins list.
   */
  _renderChain() {
    this.chainSection.clear();
    this.chainItems = [];

    const isMusic = this.activeChannel === "music";
    const activeState = this._getActiveChainState() || {
      chain: [],
      rawConfig: [],
    };
    const activeChain = activeState.chain || [];

    if (this.activeChannel === "session") {
      new Html("h3")
        .classOn("chain-header")
        .text("SESSION VOICES")
        .appendTo(this.chainSection);
      new Html("p")
        .classOn("chain-subtitle")
        .text(
          "Incoming Lounge and Everyone Audible voice streams. These bypass the music chain and are controlled only by the SESSION fader or DEAFEN.",
        )
        .appendTo(this.chainSection);
      return;
    }

    new Html("h3")
      .classOn("chain-header")
      .text(isMusic ? "INSTRUMENTAL EFFECTS" : "MICROPHONE EFFECTS")
      .appendTo(this.chainSection);

    activeChain.forEach((plugin, i) => {
      const item = new Html("div")
        .classOn("chain-item")
        .text(`${i + 1}. ${plugin.name}`)
        .appendTo(this.chainSection);
      this.chainItems.push({ type: "plugin", el: item, index: i });
    });

    if (activeChain.length === 0) {
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
      .attr({ type: "text", placeholder: "Plugin URL (.js)..." })
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
            ...(activeState.rawConfig || []),
            item.config,
          ]);
        else if (item.type === "custom") item.input.elm.focus();
        this._updateHighlights();
      });
    });

    customInput.on("keydown", (e) => {
      if (e.key === "Enter" && customInput.getValue().trim())
        this._applyAndSaveChain([
          ...(activeState.rawConfig || []),
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
      new Html("div")
        .classOn("plugin-editor-empty")
        .text("Select a plugin from the chain to edit its controls.")
        .appendTo(this.pluginSection);
      return;
    }

    const activeState = this._getActiveChainState() || { chain: [] };
    const pluginIndex = currentChainItem.index;
    const pluginState = (activeState.chain || [])[pluginIndex];
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
              if (this.activeChannel === "music") {
                this.Forte.setMusicPluginParameter(
                  pluginIndex,
                  paramName,
                  value,
                );
              } else {
                this.Forte.setPluginParameter(pluginIndex, paramName, value);
              }
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
        cursor: "var(--cursor-pointer)",
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
      const fader =
        this.dragFaderType === "mic"
          ? this.micFader
          : this.dragFaderType === "music"
            ? this.musicFader
            : this.sessionFader;
      if (!fader) return;
      this._handleFaderMouse(
        e,
        fader.track.elm,
        this.dragFaderType,
        fader.maxVal,
      );
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
   * @param {"mic"|"music"|"session"} type - Which fader is being dragged
   * @param {number} maxVal - The maximum value for the fader
   */
  _handleFaderMouse(e, trackEl, type, maxVal) {
    const rect = trackEl.getBoundingClientRect();
    let y = e.clientY - rect.top;
    y = Math.max(0, Math.min(rect.height, y));
    const percent = 1 - y / rect.height;
    const val = percent * maxVal;
    if (type === "mic") {
      this.Forte.setMicRecordingVolume(val);
      this.Forte.setMicMonitorVolume?.(val);
      this.state.micGain = val;
      this.state.micMonitorVolume = val;
      this._saveMicVolume(val);
    } else if (type === "music") {
      this.Forte.setTrackVolume?.(val);
      this.Forte.setMusicRecordingVolume(val);
      this.state.musicGain = val;
      if (this.appState) this.appState.volume = val;
      this._saveMusicVolume(val);
    } else {
      this.Forte.setSessionVolume?.(val);
      if (this.appState) this.appState.sessionVolume = val;
      this._saveSessionVolume(val);
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
      this.sessionMeterLevel = 0;
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

      const newSessionLevel = this.Forte.getSessionLevel?.() ?? 0;
      this.sessionMeterLevel =
        newSessionLevel >= this.sessionMeterLevel
          ? newSessionLevel
          : Math.max(newSessionLevel, this.sessionMeterLevel * DECAY_RATE);
      if (this.sessionFader && this.sessionFader.vuFill)
        this.sessionFader.vuFill.styleJs({
          clipPath: `inset(${100 - this.sessionMeterLevel}% 0 0 0)`,
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
    if (this.micFader && this.musicFader && this.sessionFader) {
      for (const fader of [this.micFader, this.musicFader, this.sessionFader]) {
        fader.strip.classOff("focused", "active-channel");
      }
      const activeFader =
        this.activeChannel === "mic"
          ? this.micFader
          : this.activeChannel === "music"
            ? this.musicFader
            : this.sessionFader;
      activeFader.strip.classOn("active-channel");
      if (this.focusedPane === "faders") {
        const focusedFader =
          this.faderIndex === 0
            ? this.micFader
            : this.faderIndex === 1
              ? this.musicFader
              : this.sessionFader;
        focusedFader.strip.classOn("focused");
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

    const activeState = this._getActiveChainState() || {
      chain: [],
      rawConfig: [],
    };
    const activeChain = activeState.chain || [];

    const currentChainItem = this.chainItems[this.chainIndex];
    const isPluginNode = currentChainItem && currentChainItem.type === "plugin";

    let isCustomGUI = false;
    let pluginInstance = null;
    if (isPluginNode) {
      pluginInstance = activeChain[currentChainItem.index]?.instance;
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
        const newConfig = [...(activeState.rawConfig || [])];
        newConfig.splice(idx, 1);
        if (this.isExpanded) this._closePluginEditor();
        this.chainIndex = Math.max(0, this.chainIndex - 1);
        this._applyAndSaveChain(newConfig);
        return;
      }

      if (this.focusedPane === "chain") {
        if (e.shiftKey && e.key === "ArrowUp" && idx > 0) {
          const newConfig = [...(activeState.rawConfig || [])];
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
          idx < activeChain.length - 1
        ) {
          const newConfig = [...(activeState.rawConfig || [])];
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
          if (this.faderIndex < 2) {
            this.faderIndex += 1;
            this._setActiveChannel(this._faderTypeForIndex(this.faderIndex), {
              preserveFaderFocus: true,
            });
          } else this.focusedPane = "chain";
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
        } else if (this.focusedPane === "faders" && this.faderIndex > 0) {
          this.faderIndex -= 1;
          this._setActiveChannel(this._faderTypeForIndex(this.faderIndex), {
            preserveFaderFocus: true,
          });
        }
        break;
      case "Enter":
        if (this.focusedPane === "chain" && currentChainItem) {
          if (currentChainItem.type === "plugin") this._openPluginEditor();
          else if (currentChainItem.type === "add")
            this._applyAndSaveChain([
              ...(activeState.rawConfig || []),
              currentChainItem.config,
            ]);
          else if (currentChainItem.type === "custom")
            currentChainItem.input.elm.focus();
        }
        break;
      case "Tab":
        if (e.shiftKey) {
          const order = ["mic", "music", "session"];
          const nextIndex =
            (order.indexOf(this.activeChannel) + 1) % order.length;
          this._setActiveChannel(order[nextIndex]);
          break;
        }
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
