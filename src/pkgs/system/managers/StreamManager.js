import Html from "../../../libs/html.js";
import playNavSfx from "../../../libs/sfx.js";
import ToggleSwitch from "../../../components/ToggleSwitch.js";

const TWITCH_INGEST_URL = "rtmp://live.twitch.tv/app/";
const TWITCH_MAX_TAGS = 10;
const TWITCH_TAG_PATTERN = /^[\p{L}\p{N}]+$/u;
const TWITCH_AUTOMATIC_CONTENT_LABELS = new Set(["MatureGame"]);

/**
 * Normalizes a Twitch box art URL to the requested resolution.
 * Handles both `{width}`/`{height}` templates and sized CDN paths.
 * @param {string} url
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
function resolveTwitchBoxArt(url, width = 144, height = 192) {
  if (!url || typeof url !== "string") return "";
  return url
    .replace("{width}", String(width))
    .replace("{height}", String(height))
    .replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, `-${width}x${height}`);
}

const TWITCH_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ar", label: "العربية" },
  { code: "bg", label: "Български" },
  { code: "ca", label: "Català" },
  { code: "cs", label: "Čeština" },
  { code: "da", label: "Dansk" },
  { code: "el", label: "Ελληνικά" },
  { code: "fi", label: "Suomi" },
  { code: "hi", label: "हिन्दी" },
  { code: "hr", label: "Hrvatski" },
  { code: "hu", label: "Magyar" },
  { code: "id", label: "Bahasa Indonesia" },
  { code: "ms", label: "Bahasa Melayu" },
  { code: "nl", label: "Nederlands" },
  { code: "no", label: "Norsk" },
  { code: "pl", label: "Polski" },
  { code: "ro", label: "Română" },
  { code: "sk", label: "Slovenčina" },
  { code: "sv", label: "Svenska" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "other", label: "Other" },
];

export default class StreamManager {
  /**
   * @param {Object} context - The shared Encore context
   */
  constructor(context) {
    this.ctx = context;
    this.isStreaming = false;
    this.streamRecorder = null;
    this.streamStartTime = null;
    this.modalView = "selection"; // "selection" | "obs" | "twitch" | "goLivePlatform" | "goLiveDirect" | "goLiveTwitch" | "goLiveBitrate" | "live"
    this._renderedModalView = null;
    this._streamViewTimer = null;

    // Go Live wizard state.
    this.goLivePlatform = "direct"; // "direct" | "twitch"
    this._startingStream = false;

    // Collapsible section state for the OBS and Twitch Integration pages.
    this.sectionState = {
      obsConfig: true,
      obsScenes: false,
      obsOverlays: false,
      twitchAccount: true,
      twitchChat: false,
      twitchInfo: false,
    };
    this._sectionGroups = { obs: [], twitch: [] };

    // Direct RTMP Configuration
    const cfg = this.ctx.config?.streamConfig || {};
    this.rtmpUrl = cfg.rtmpUrl || "";
    this.streamKey = cfg.streamKey || "";
    this.videoBitrate = cfg.videoBitrate || 3500000;
    this.isKeyVisible = false;

    // OBS WebSocket Configuration
    const obsCfg = this.ctx.config?.obsConfig || {};
    this.obsHost = obsCfg.host || "127.0.0.1";
    this.obsPort = obsCfg.port || 4455;
    this.obsPassword = obsCfg.password || "";
    this.obsAutoReconnect = obsCfg.autoReconnect ?? true;
    this.obsScenesConfig = obsCfg.scenes || {
      idle: "",
      singing: "",
      score: "",
    };
    this.isObsPasswordVisible = false;

    this.obsStatus = {
      connected: false,
      reconnecting: false,
      currentScene: "",
      scenes: [],
      error: null,
    };

    // Telemetry & Stats
    this.latestStats = null;
    this.statEls = {};
    this.statsTimer = null;
    this.totalBytesSent = 0;
    this.currentBitrateKbps = 0;
    this.lastChunkTime = null;

    this.bitrateHistory = [];
    this._lastBitrateSampleAt = 0;
    this._bitrateCanvas = null;
    this._bitrateChartValueEl = null;
    this._handleStreamResize = () => this.drawBitrateChart();
    this._bitrateResizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => this.drawBitrateChart())
        : null;
    window.addEventListener("resize", this._handleStreamResize);

    // Direct RTMP Telemetry Listeners
    window.desktopIntegration?.ipc?.on?.("stream-stats", (_e, stats) => {
      this.latestStats = stats;
      this.updateStatsUI();
    });

    window.desktopIntegration?.ipc?.on?.(
      "stream-status-changed",
      (_e, isStreaming) => {
        if (!isStreaming && this.isStreaming) {
          this.stopStream();
        }
      },
    );

    window.obs?.getStatus?.().then((status) => {
      if (status) this.obsStatus = status;
    });

    window.obs?.onStatusUpdate?.((status) => {
      this.obsStatus = status;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "obs") {
        this.renderObsView();
      }
    });

    window.obs?.onScenesUpdate?.((scenes) => {
      this.obsStatus.scenes = scenes;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "obs") {
        this.renderObsView();
      }
    });

    window.obs?.onSceneChanged?.((sceneName) => {
      this.obsStatus.currentScene = sceneName;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "obs") {
        this.renderObsView();
      }
    });

    // Twitch Configuration
    const twitchCfg = this.ctx.config?.twitchConfig || {};
    this.twitchStatus = {
      authenticated: false,
      user: null,
      channel: twitchCfg.channel || "",
      connected: false,
      connecting: false,
      error: null,
      reloginRequired: false,
      login: null,
      autoConnect: twitchCfg.autoConnect !== false,
      showChatAsDanmaku: twitchCfg.showChatAsDanmaku !== false,
    };

    window.twitch?.getStatus?.().then((status) => {
      if (status) this.twitchStatus = status;
    });

    window.twitch?.onStatusUpdate?.((status) => {
      this.twitchStatus = status;
      if (this.ctx.state.isStreamModalOpen && this.modalView === "twitch") {
        this.renderTwitchView();
      } else if (
        this.ctx.state.isStreamModalOpen &&
        this.modalView === "goLiveTwitch"
      ) {
        this.renderGoLiveTwitchView();
      }
    });

    this.twitchBroadcast = null;
    this.twitchDraft = null;
    this.twitchDirty = false;
    this.twitchLiveInfo = null;
    this.twitchDetailsState = {
      loading: false,
      saving: false,
      error: null,
      notice: null,
    };
    this.twitchCategoryState = {
      query: "",
      results: [],
      loading: false,
      error: null,
    };
    this._twitchCategoryTimer = null;
    this._twitchCategoryToken = 0;
    this._twitchLoadToken = 0;
    this._twitchLivePoll = null;
    this.activeStreamDestination = null; // "direct" | "twitch"
  }

  /**
   * Plays a navigation sound effect.
   * @param {string} sfxName - The name of the wav file (without extension)
   */
  playNavSfx(sfxName) {
    return playNavSfx(this.ctx, sfxName);
  }

  /**
   * Opens or closes the Broadcast Modal.
   */
  toggleStreamModal(forceState = null) {
    const state = this.ctx.state;
    const shouldOpen =
      forceState !== null ? forceState : !state.isStreamModalOpen;

    state.isStreamModalOpen = shouldOpen;

    if (shouldOpen) {
      this.ctx.dom.streamModal.classOff("hidden");
      this.modalView = this.isStreaming ? "live" : "selection";
      this.render();
    } else {
      if (this._streamViewTimer) {
        clearTimeout(this._streamViewTimer);
        this._streamViewTimer = null;
      }
      this.ctx.dom.streamHeader.classOff("view-enter", "view-leave");
      this.ctx.dom.streamContentArea.classOff("view-enter", "view-leave");
      this._renderedModalView = null;
      this.ctx.dom.streamModal.classOn("hidden");
    }
  }

  /**
   * Returns the navigation direction between two stream views: 1 when moving
   * deeper into the modal, -1 when moving back.
   * @param {string} fromView - The current view
   * @param {string} toView - The target view
   * @returns {number}
   */
  getViewDirection(fromView, toView) {
    const order = {
      selection: 0,
      obs: 1,
      twitch: 1,
      goLivePlatform: 1,
      goLiveDirect: 2,
      goLiveTwitch: 2,
      goLiveBitrate: 3,
      live: 4,
    };
    return (order[toView] ?? 0) >= (order[fromView] ?? 0) ? 1 : -1;
  }

  /**
   * Renders the current view inside the modal, sliding the old view out and
   * the new view in when the target view differs from the current one.
   * @param {boolean} animate - Whether to animate the transition
   */
  render(animate = true) {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    const targetView = this.modalView;
    const previousView = this._renderedModalView;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const shouldAnimate =
      animate &&
      previousView !== null &&
      previousView !== targetView &&
      !dom.streamModal.elm.classList.contains("hidden") &&
      !reduceMotion;

    if (this._streamViewTimer) {
      clearTimeout(this._streamViewTimer);
      this._streamViewTimer = null;
    }

    // Pages shrink horizontally; the initial selection screen keeps its width.
    if (targetView === "selection") {
      dom.streamBox.classOff("stream-box-compact");
    } else {
      dom.streamBox.classOn("stream-box-compact");
    }

    if (!shouldAnimate) {
      dom.streamHeader.classOff("view-enter", "view-leave");
      dom.streamContentArea.classOff("view-enter", "view-leave");
      this._buildView();
      return;
    }

    // Track the target view immediately so background status updates do not
    // interrupt the transition with a refresh of the previous view.
    this._renderedModalView = targetView;

    dom.streamBox.style({
      "--stream-view-dir": String(
        this.getViewDirection(previousView, targetView),
      ),
    });

    dom.streamHeader.classOff("view-enter").classOn("view-leave");
    dom.streamContentArea.classOff("view-enter").classOn("view-leave");

    this._streamViewTimer = setTimeout(() => {
      this._streamViewTimer = null;
      dom.streamHeader.classOff("view-leave");
      dom.streamContentArea.classOff("view-leave");
      this._buildView();

      // Restart the enter animation for the rebuilt content.
      void dom.streamHeader.elm.offsetWidth;
      dom.streamHeader.classOn("view-enter");
      dom.streamContentArea.classOn("view-enter");
    }, 170);
  }

  /**
   * Builds the DOM for the current stream view.
   */
  _buildView() {
    let renderedView = this.modalView;
    if (this.modalView === "obs") {
      this.renderObsView();
    } else if (this.modalView === "twitch") {
      this.renderTwitchView();
    } else if (this.modalView === "goLivePlatform") {
      this.renderGoLivePlatformView();
    } else if (this.modalView === "goLiveDirect") {
      this.renderGoLiveDirectView();
    } else if (this.modalView === "goLiveTwitch") {
      this.renderGoLiveTwitchView();
    } else if (this.modalView === "goLiveBitrate") {
      this.renderGoLiveBitrateView();
    } else if (this.modalView === "live") {
      this.renderLiveView();
    } else {
      this.renderSelectionView();
    }
    this._renderedModalView = renderedView;
  }

  /**
   * Builds a collapsible section used inside the OBS and Direct Broadcast
   * pages.
   * @param {Html} parent - Container the section is appended to
   * @param {string} stateKey - Key in `sectionState`
   * @param {string} title - Section heading
   * @param {"obs"|"direct"} pageKey - Group that keeps sections exclusive
   * @returns {{wrapper: Html, content: Html}}
   */
  buildSectionAccordion(parent, stateKey, title, pageKey) {
    const id = `stream-section-${stateKey}`;

    const wrapper = new Html("div")
      .classOn("stream-section-accordion")
      .appendTo(parent);

    const toggle = new Html("button")
      .classOn("stream-section-toggle")
      .attr({
        type: "button",
        "aria-expanded": this.sectionState[stateKey] ? "true" : "false",
        "aria-controls": id,
      })
      .appendTo(wrapper);

    new Html("span")
      .classOn("stream-section-title")
      .text(title)
      .appendTo(toggle);

    new Html("span")
      .classOn("stream-section-chevron")
      .html('<ion-icon name="chevron-down-outline"></ion-icon>')
      .appendTo(toggle);

    const panel = new Html("div")
      .classOn("stream-section-panel")
      .attr({
        id,
        role: "region",
        "aria-hidden": this.sectionState[stateKey] ? "false" : "true",
      })
      .appendTo(wrapper);

    const body = new Html("div")
      .classOn("stream-section-panel-body")
      .appendTo(panel);

    const content = new Html("div")
      .classOn("stream-section-panel-content")
      .appendTo(body);

    const applyState = () => {
      const open = Boolean(this.sectionState[stateKey]);
      if (open) wrapper.classOn("open");
      else wrapper.classOff("open");
      toggle.attr({ "aria-expanded": open ? "true" : "false" });
      panel.attr({ "aria-hidden": open ? "false" : "true" });
      panel.elm.inert = !open;
    };

    applyState();

    const group = this._sectionGroups[pageKey];
    const entry = { stateKey, applyState };
    if (group) group.push(entry);

    toggle.on("click", () => {
      const willOpen = !this.sectionState[stateKey];

      (group || [entry]).forEach((item) => {
        this.sectionState[item.stateKey] = false;
        item.applyState();
      });

      this.sectionState[stateKey] = willOpen;
      applyState();
    });

    return { wrapper, content };
  }

  /**
   * Renders the Go Live step indicator.
   * @param {Html} container - Element to render the stepper into.
   * @param {number} activeIndex - Zero-based step index. Steps before it are complete.
   */
  buildStreamStepper(container, activeIndex) {
    const steps =
      this.goLivePlatform === "twitch"
        ? ["PLATFORM", "TWITCH", "BITRATE"]
        : ["PLATFORM", "INGEST", "BITRATE"];

    const stepper = new Html("div")
      .classOn("session-stepper", "stream-stepper")
      .attr({
        role: "list",
        "aria-label":
          activeIndex >= steps.length
            ? "Setup complete"
            : `Step ${activeIndex + 1} of ${steps.length}`,
      })
      .appendTo(container);

    steps.forEach((label, index) => {
      const step = new Html("div")
        .classOn("session-step")
        .attr({
          role: "listitem",
          "aria-current": index === activeIndex ? "step" : null,
        })
        .appendTo(stepper);

      if (index === activeIndex) step.classOn("is-active");
      else if (index < activeIndex || activeIndex >= steps.length) {
        step.classOn("is-complete");
      }

      new Html("span")
        .classOn("session-step-index")
        .text(String(index + 1))
        .appendTo(step);

      new Html("span").classOn("session-step-label").text(label).appendTo(step);

      if (index < steps.length - 1) {
        new Html("span")
          .classOn("session-step-line")
          .attr({ "aria-hidden": "true" })
          .appendTo(stepper);
      }
    });
  }

  /**
   * Builds a non-collapsible titled section for the Go Live wizard.
   * @param {Html} parent
   * @param {string} title
   * @returns {Html} Content container
   */
  buildStreamSection(parent, title) {
    const section = new Html("div")
      .classOn("stream-live-section")
      .appendTo(parent);

    new Html("div")
      .classOn("stream-section-title")
      .text(title)
      .appendTo(section);

    return new Html("div").classOn("stream-section-block").appendTo(section);
  }

  /**
   * Mode Selection Screen
   */
  renderSelectionView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOn("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("BROADCAST & STREAMING").appendTo(dom.streamHeader);
    new Html("p")
      .text("Configure tools for live streaming.")
      .appendTo(dom.streamHeader);

    const selectionArea = new Html("div")
      .classOn("stream-selection-area")
      .appendTo(dom.streamContentArea);

    const tileContainer = new Html("div")
      .classOn("session-tile-container", "stream-tile-container")
      .appendTo(selectionArea);

    // OBS Tile
    const obsTile = new Html("div")
      .classOn("session-tile")
      .attr({ tabindex: "0" })
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html(
        '<ion-icon name="desktop-outline" style="font-size: 3rem;"></ion-icon>',
      )
      .appendTo(obsTile);

    new Html("div")
      .classOn("session-tile-title")
      .text("OBS INTEGRATION")
      .appendTo(obsTile);

    new Html("div")
      .classOn("session-tile-desc")
      .text("Automate scene switching and manage live browser overlays")
      .appendTo(obsTile);

    obsTile.on("click", () => {
      this.modalView = "obs";
      this.render();
    });

    const goLiveTile = new Html("div")
      .classOn("session-tile")
      .attr({ tabindex: "0" })
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html(
        '<ion-icon name="radio-outline" style="font-size: 3rem;"></ion-icon>',
      )
      .appendTo(goLiveTile);

    new Html("div")
      .classOn("session-tile-title")
      .text("GO LIVE")
      .appendTo(goLiveTile);

    new Html("div")
      .classOn("session-tile-desc")
      .text("Stream your Encore session to Twitch or any RTMP destination.")
      .appendTo(goLiveTile);

    goLiveTile.on("click", () => {
      this.modalView = "goLivePlatform";
      this.render();
    });

    const twitchTile = new Html("div")
      .classOn("session-tile", "twitch-tile")
      .attr({ tabindex: "0" })
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html('<ion-icon name="logo-twitch" style="font-size: 3rem;"></ion-icon>')
      .appendTo(twitchTile);

    new Html("div")
      .classOn("session-tile-title")
      .text("TWITCH INTEGRATION")
      .appendTo(twitchTile);

    new Html("div")
      .classOn("session-tile-desc")
      .text("Connect your Twitch account and bring your stream into Encore.")
      .appendTo(twitchTile);

    twitchTile.on("click", () => {
      this.modalView = "twitch";
      this.render();
    });

    const btnRow = new Html("div")
      .classOn("session-btn-row")
      .appendTo(selectionArea);

    new Html("button")
      .classOn("session-btn", "danger")
      .text("CANCEL")
      .on("click", () => this.toggleStreamModal(false))
      .appendTo(btnRow);
  }

  /**
   * OBS Integration View.
   */
  renderObsView() {
    if (this._streamViewTimer) return;

    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("OBS INTEGRATION").appendTo(dom.streamHeader);
    new Html("p")
      .text("Automate scene changes and get browser overlays.")
      .appendTo(dom.streamHeader);

    const page = new Html("div")
      .classOn("stream-page")
      .appendTo(dom.streamContentArea);
    this._sectionGroups.obs = [];

    const configSection = this.buildSectionAccordion(
      page,
      "obsConfig",
      "CONNECTION CONFIGURATION",
      "obs",
    );

    const hostRow = new Html("div")
      .styleJs({ display: "flex", gap: "1rem" })
      .appendTo(configSection.content);

    const hostGroup = new Html("div")
      .classOn("stream-form-group")
      .styleJs({ flex: "2" })
      .appendTo(hostRow);

    new Html("label")
      .classOn("stream-form-label")
      .text("Server IP / Host")
      .appendTo(hostGroup);

    const hostInput = new Html("input")
      .classOn("stream-input")
      .attr({ type: "text", value: this.obsHost, placeholder: "127.0.0.1" })
      .appendTo(hostGroup);

    hostInput.on("input", () => {
      this.obsHost = hostInput.getValue().trim();
      this.saveObsConfig();
    });

    const portGroup = new Html("div")
      .classOn("stream-form-group")
      .styleJs({ flex: "1" })
      .appendTo(hostRow);

    new Html("label")
      .classOn("stream-form-label")
      .text("Port")
      .appendTo(portGroup);

    const portInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: "number",
        value: String(this.obsPort),
        placeholder: "4455",
      })
      .appendTo(portGroup);

    portInput.on("input", () => {
      this.obsPort = parseInt(portInput.getValue().trim(), 10) || 4455;
      this.saveObsConfig();
    });

    const pwGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(configSection.content);
    new Html("label")
      .classOn("stream-form-label")
      .text("Server Password")
      .appendTo(pwGroup);

    const pwWrapper = new Html("div")
      .classOn("stream-input-wrapper")
      .styleJs({
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "center",
      })
      .appendTo(pwGroup);

    const pwInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: this.isObsPasswordVisible ? "text" : "password",
        value: this.obsPassword,
        placeholder: "Leave empty if password is disabled in OBS",
      })
      .appendTo(pwWrapper);

    pwInput.on("input", () => {
      this.obsPassword = pwInput.getValue();
      this.saveObsConfig();
    });

    const togglePwBtn = new Html("button")
      .classOn("stream-key-action-btn")
      .styleJs({ position: "absolute", right: "10px" })
      .text(this.isObsPasswordVisible ? "HIDE" : "SHOW")
      .on("click", (e) => {
        e.stopPropagation();
        this.isObsPasswordVisible = !this.isObsPasswordVisible;
        pwInput.attr({ type: this.isObsPasswordVisible ? "text" : "password" });
        togglePwBtn.text(this.isObsPasswordVisible ? "HIDE" : "SHOW");
      })
      .appendTo(pwWrapper);

    const autoRecRow = new Html("div")
      .classOn("stream-toggle-row")
      .appendTo(configSection.content);

    const autoRecSwitch = new ToggleSwitch({
      checked: this.obsAutoReconnect,
      ariaLabel:
        "Automatically reconnect if OBS starts later or restarts",
      onChange: (next) => {
        this.obsAutoReconnect = next;
        this.saveObsConfig();
      },
    }).appendTo(autoRecRow);

    new Html("span")
      .classOn("stream-toggle-label")
      .text("Automatically reconnect if OBS starts later or restarts")
      .appendTo(autoRecRow);

    const scenesSection = this.buildSectionAccordion(
      page,
      "obsScenes",
      "AUTOMATED SCENE SWITCHING",
      "obs",
    );

    const scenesAvailable =
      this.obsStatus.connected && this.obsStatus.scenes.length > 0;

    const buildSceneSelect = (label, stateKey) => {
      const row = new Html("div")
        .classOn("stream-scene-row")
        .appendTo(scenesSection.content);
      new Html("span").classOn("stream-scene-label").text(label).appendTo(row);

      const select = new Html("select")
        .classOn("stream-select", "stream-scene-select")
        .appendTo(row);

      if (!scenesAvailable) {
        select.elm.disabled = true;
        new Html("option")
          .text(this.obsStatus.connected ? "No scenes" : "Connect to OBS first")
          .appendTo(select);
        return;
      }

      const defaultOpt = new Html("option")
        .attr({ value: "__none__" })
        .text("— None / Keep Scene —")
        .appendTo(select);

      const currentSelected = this.obsScenesConfig[stateKey] || "__none__";

      this.obsStatus.scenes.forEach((sc) => {
        const opt = new Html("option")
          .attr({ value: sc })
          .text(sc)
          .appendTo(select);
        if (sc === currentSelected) {
          opt.elm.selected = true;
        }
      });

      if (currentSelected === "__none__") defaultOpt.elm.selected = true;

      select.on("change", () => {
        this.obsScenesConfig[stateKey] = select.getValue();
        this.saveObsConfig();
      });
    };

    buildSceneSelect("Idle (Main Menu)", "idle");
    buildSceneSelect("Singing (Playing)", "singing");
    buildSceneSelect("Score Screen", "score");

    const overlaysSection = this.buildSectionAccordion(
      page,
      "obsOverlays",
      "BROWSER OVERLAY SOURCES",
      "obs",
    );

    const port = this.ctx.state.actualPort || 9864;
    const lyricsUrl = `http://127.0.0.1:${port}/overlay/lyrics`;
    const setlistUrl = `http://127.0.0.1:${port}/overlay/setlist`;

    const buildOverlayCard = (title, url) => {
      const row = new Html("div")
        .classOn("stream-overlay-row")
        .appendTo(overlaysSection.content);
      const textGroup = new Html("div")
        .classOn("stream-overlay-text-group")
        .appendTo(row);
      new Html("span")
        .classOn("stream-overlay-name")
        .text(title)
        .appendTo(textGroup);
      new Html("span")
        .classOn("stream-overlay-url")
        .text(url)
        .appendTo(textGroup);

      const copyBtn = new Html("button")
        .classOn("stream-key-action-btn", "stream-overlay-copy-btn")
        .text("COPY")
        .on("click", async () => {
          try {
            await navigator.clipboard.writeText(url);
            copyBtn.text("COPIED!");
            setTimeout(() => copyBtn.text("COPY"), 2000);
          } catch {}
        })
        .appendTo(row);
    };

    buildOverlayCard("Live Lyrics", lyricsUrl);
    buildOverlayCard("Queue & Setlist", setlistUrl);

    const statusBox = new Html("div")
      .classOn("stream-status-box")
      .appendTo(page);

    let statusTitle = "DISCONNECTED";
    let statusClass = "status-disconnected";
    let statusDesc = "Not connected to OBS Studio.";

    if (this.obsStatus.connected) {
      statusTitle = "CONNECTED TO OBS STUDIO";
      statusClass = "status-connected";
      statusDesc = `Active scene: ${this.obsStatus.currentScene || "None"}`;
    } else if (this.obsStatus.reconnecting) {
      statusTitle = "CONNECTING";
      statusClass = "status-connecting";
      statusDesc = `Make sure OBS is running with WebSocket enabled.`;
    } else if (this.obsStatus.error) {
      statusTitle = "CONNECTION FAILED";
      statusClass = "status-error";
      statusDesc = this.obsStatus.error;
    }

    statusBox.classOn(statusClass);
    new Html("div")
      .classOn("stream-status-header-text")
      .text(statusTitle)
      .appendTo(statusBox);
    new Html("div")
      .classOn("stream-status-desc-text")
      .text(statusDesc)
      .appendTo(statusBox);

    const btnRow = new Html("div")
      .classOn("stream-btn-row")
      .appendTo(dom.streamFooter);

    new Html("button")
      .classOn("session-btn")
      .text("CLOSE")
      .on("click", () => {
        this.modalView = "selection";
        this.render();
      })
      .appendTo(btnRow);

    if (!this.obsStatus.connected) {
      new Html("button")
        .classOn("session-btn", "primary")
        .text("CONNECT TO OBS")
        .on("click", async () => {
          this.saveObsConfig(true);
          await window.obs?.connect({
            host: this.obsHost,
            port: this.obsPort,
            password: this.obsPassword,
          });
        })
        .appendTo(btnRow);
    } else {
      new Html("button")
        .classOn("session-btn", "danger")
        .text("DISCONNECT")
        .on("click", async () => {
          this.saveObsConfig(false);
          await window.obs?.disconnect();
        })
        .appendTo(btnRow);
    }
  }

  /**
   * Twitch Integration View.
   */
  renderTwitchView() {
    if (this._streamViewTimer) return;

    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("TWITCH INTEGRATION").appendTo(dom.streamHeader);
    new Html("p")
      .text("Connect your Twitch account and bring your stream into Encore.")
      .appendTo(dom.streamHeader);

    const page = new Html("div")
      .classOn("stream-page")
      .appendTo(dom.streamContentArea);
    this._sectionGroups.twitch = [];

    const status = this.twitchStatus;
    const login = status.login;

    if (status.authenticated) {
      const broadcastActive =
        this.isStreaming && this.activeStreamDestination === "twitch";
      const liveCta = new Html("div").classOn("twitch-live-cta").appendTo(page);

      const liveCtaText = new Html("div")
        .classOn("twitch-live-cta-text")
        .appendTo(liveCta);

      if (status.reloginRequired) {
        new Html("strong")
          .text("Twitch permissions need renewing")
          .appendTo(liveCtaText);
        new Html("p")
          .text(
            "Log in again to enable Go Live and channel management for this account.",
          )
          .appendTo(liveCtaText);

        new Html("button")
          .classOn("session-btn", "primary", "twitch-live-cta-btn")
          .text("RENEW PERMISSIONS")
          .on("click", () => this.renewTwitchLogin())
          .appendTo(liveCta);
      } else {
        new Html("strong")
          .text(
            broadcastActive ? "You are live on Twitch" : "Ready to go live?",
          )
          .appendTo(liveCtaText);
        new Html("p")
          .text(
            broadcastActive
              ? "Open the live dashboard to view stream health, viewer counts, and stop the broadcast."
              : "Review your title, category, tags, and content labels, then start broadcasting directly to Twitch.",
          )
          .appendTo(liveCtaText);

        new Html("button")
          .classOn("session-btn", "primary", "twitch-live-cta-btn")
          .text(broadcastActive ? "VIEW LIVE DASHBOARD" : "GO LIVE ON TWITCH")
          .on("click", () => {
            if (broadcastActive) {
              this.modalView = "live";
              this.render();
            } else {
              this.startGoLiveFlow("twitch");
            }
          })
          .appendTo(liveCta);
      }
    }

    const accountSection = this.buildSectionAccordion(
      page,
      "twitchAccount",
      "TWITCH ACCOUNT",
      "twitch",
    );

    if (status.authenticated) {
      if (!status.user) {
        new Html("div")
          .classOn("stream-info-card")
          .html(
            "<strong>Logged in.</strong><br>Your Twitch profile could not be loaded. Try logging out and back in.",
          )
          .appendTo(accountSection.content);
      } else {
        const userCard = new Html("div")
          .classOn("twitch-user-card")
          .appendTo(accountSection.content);

        if (status.user.profileImageUrl) {
          new Html("img")
            .classOn("twitch-user-avatar")
            .attr({
              src: status.user.profileImageUrl,
              alt: status.user.displayName,
            })
            .appendTo(userCard);
        } else {
          new Html("div")
            .classOn("twitch-user-avatar", "twitch-user-avatar-fallback")
            .html('<ion-icon name="logo-twitch"></ion-icon>')
            .appendTo(userCard);
        }

        const userMeta = new Html("div")
          .classOn("twitch-user-meta")
          .appendTo(userCard);

        new Html("span")
          .classOn("twitch-user-name")
          .text(status.user.displayName)
          .appendTo(userMeta);

        new Html("span")
          .classOn("twitch-user-login")
          .text(`@${status.user.login}`)
          .appendTo(userMeta);

        new Html("span")
          .classOn("twitch-user-status")
          .text("CONNECTED ACCOUNT")
          .appendTo(userMeta);
      }
    } else if (login) {
      const waitingPane = new Html("div")
        .classOn("twitch-login-waiting")
        .attr({ role: "status", "aria-live": "polite" })
        .appendTo(accountSection.content);

      new Html("img")
        .classOn("loading")
        .attr({
          src: "/assets/img/loading-spinner.svg",
          alt: "",
          draggable: "false",
        })
        .appendTo(waitingPane);

      new Html("div")
        .classOn("twitch-login-waiting-title")
        .text("WAITING FOR TWITCH...")
        .appendTo(waitingPane);

      const minutes = Math.max(
        1,
        Math.round((login.expiresAt - Date.now()) / 60000),
      );

      new Html("div")
        .classOn("twitch-login-waiting-desc")
        .text(
          `Approve access in your browser. This request expires in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        )
        .appendTo(waitingPane);
    } else {
      const signInCard = new Html("div")
        .classOn("stream-info-card", "twitch-signin-card")
        .appendTo(accountSection.content);

      new Html("strong")
        .text("Sign in to connect Encore with Twitch")
        .appendTo(signInCard);

      new Html("p")
        .classOn("twitch-signin-desc")
        .text(
          "You will be sent to Twitch to approve access. The code is copied for you automatically.",
        )
        .appendTo(signInCard);

      new Html("button")
        .classOn("session-btn", "primary", "twitch-login-btn")
        .text("LOG IN WITH TWITCH")
        .on("click", () => this.startTwitchLogin())
        .appendTo(signInCard);
    }

    const chatSection = this.buildSectionAccordion(
      page,
      "twitchChat",
      "PREFERENCES",
      "twitch",
    );

    const danmakuRow = new Html("div")
      .classOn("stream-toggle-row")
      .appendTo(chatSection.content);

    const danmakuSwitch = new ToggleSwitch({
      checked: status.showChatAsDanmaku,
      ariaLabel: "Show chat on screen",
      onChange: (enabled) => {
        this.twitchStatus.showChatAsDanmaku = enabled;

        this.ctx.config.twitchConfig = {
          ...(this.ctx.config.twitchConfig || {}),
          showChatAsDanmaku: enabled,
        };
        void window.twitch?.setPreferences?.({
          showChatAsDanmaku: enabled,
        });
      },
    }).appendTo(danmakuRow);

    new Html("span")
      .classOn("stream-toggle-label")
      .text("Show chat on screen")
      .appendTo(danmakuRow);

    const autoConnectRow = new Html("div")
      .classOn("stream-toggle-row")
      .appendTo(chatSection.content);

    const autoConnectSwitch = new ToggleSwitch({
      checked: status.autoConnect,
      ariaLabel: "Connect to Twitch automatically on startup",
      onChange: (enabled) => {
        this.twitchStatus.autoConnect = enabled;
        void window.twitch?.setPreferences?.({ autoConnect: enabled });
      },
    }).appendTo(autoConnectRow);

    new Html("span")
      .classOn("stream-toggle-label")
      .text("Connect to Twitch automatically on startup")
      .appendTo(autoConnectRow);

    const infoSection = this.buildSectionAccordion(
      page,
      "twitchInfo",
      "HOW IT WORKS",
      "twitch",
    );

    new Html("div")
      .classOn("stream-info-card")
      .html(
        `
        <strong>What Twitch integration does:</strong><br>
        • Connects Encore to your Twitch account.<br>
        • Brings your channel and audience into Encore.<br>
        • Broadcasts your Encore session directly to your channel with Go Live.<br>
        • Shows chat on screen and runs alongside OBS or Direct RTMP.
      `,
      )
      .appendTo(infoSection.content);

    const statusBox = new Html("div")
      .classOn("stream-status-box")
      .appendTo(page);

    let statusTitle = "NOT CONNECTED";
    let statusClass = "status-disconnected";
    let statusDesc = "Sign in with Twitch to connect Encore to your channel.";

    if (!status.authenticated && status.error) {
      statusTitle = "TWITCH LOGIN ERROR";
      statusClass = "status-error";
      statusDesc = status.error;
    } else if (status.reloginRequired) {
      statusTitle = "TWITCH LOGIN REQUIRED";
      statusClass = "status-error";
      statusDesc =
        "Your Twitch permissions need to be renewed. Log in again to reconnect.";
    } else if (status.authenticated) {
      if (status.connected) {
        statusTitle = `CONNECTED: #${status.channel}`;
        statusClass = "status-connected";
        statusDesc = "Encore is connected to your Twitch channel.";
      } else if (status.connecting) {
        statusTitle = "CONNECTING TO TWITCH...";
        statusClass = "status-connecting";
        statusDesc = `Linking #${status.channel || status.user?.login || "your channel"}.`;
      } else if (status.error) {
        statusTitle = "TWITCH CONNECTION ERROR";
        statusClass = "status-error";
        statusDesc = status.error;
      } else {
        statusTitle = "READY TO CONNECT";
        statusClass = "status-connecting";
        statusDesc =
          "Your Twitch account is connected. Click Connect Twitch to link your channel.";
      }
    }

    statusBox.classOn(statusClass);
    new Html("div")
      .classOn("stream-status-header-text")
      .text(statusTitle)
      .appendTo(statusBox);
    new Html("div")
      .classOn("stream-status-desc-text")
      .text(statusDesc)
      .appendTo(statusBox);

    const btnRow = new Html("div")
      .classOn("stream-btn-row")
      .appendTo(dom.streamFooter);

    new Html("button")
      .classOn("session-btn")
      .text("BACK")
      .on("click", () => {
        this.modalView = "selection";
        this.render();
      })
      .appendTo(btnRow);

    if (login) {
      new Html("button")
        .classOn("session-btn", "danger")
        .text("CANCEL LOGIN")
        .on("click", async () => {
          await window.twitch?.cancelLogin?.();
        })
        .appendTo(btnRow);
    } else if (status.authenticated) {
      new Html("button")
        .classOn("session-btn", "danger")
        .text("LOG OUT")
        .on("click", async () => {
          await window.twitch?.logout?.();
        })
        .appendTo(btnRow);

      new Html("button")
        .classOn(
          "session-btn",
          status.connected || status.connecting ? "danger" : "primary",
        )
        .text(
          status.connected
            ? "DISCONNECT TWITCH"
            : status.connecting
              ? "CANCEL CONNECTION"
              : "CONNECT TWITCH",
        )
        .on("click", async () => {
          if (status.connected || status.connecting) {
            await window.twitch?.disconnect?.();
          } else {
            const res = await window.twitch?.connect?.();
            if (res && !res.success) {
              this.ctx.modules.infoBar.showTemp(
                "TWITCH",
                res.error || "Could not connect to Twitch.",
                4000,
              );
            }
          }
        })
        .appendTo(btnRow);
    }
  }

  /**
   * Starts the Twitch device login flow and notifies the user.
   * @returns {Promise<boolean>}
   */
  async startTwitchLogin() {
    const res = await window.twitch?.startLogin?.();
    if (!res || !res.success) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        res?.error || "Could not start Twitch login.",
        5000,
      );
      return false;
    }

    if (res.userCode) {
      try {
        await navigator.clipboard.writeText(res.userCode);
      } catch {}
    }

    if (res.verificationUri) {
      window.desktopIntegration?.openExternal?.(res.verificationUri);
    }

    return true;
  }

  /**
   * Clears an expired/under-scoped Twitch session before starting a new login.
   * @returns {Promise<boolean>}
   */
  async renewTwitchLogin() {
    await window.twitch?.logout?.();
    return this.startTwitchLogin();
  }

  /**
   * Starts the Go Live wizard for a platform. Reopening a running Twitch
   * broadcast keeps the existing draft and goes straight to the dashboard.
   * @param {"direct"|"twitch"} platform
   */
  startGoLiveFlow(platform = "direct") {
    this.goLivePlatform = platform === "twitch" ? "twitch" : "direct";

    if (this.isStreaming) {
      this.modalView = "live";
      this.render();
      return;
    }

    if (this.goLivePlatform === "direct") {
      this.modalView = "goLiveDirect";
      this.render();
      return;
    }

    this.twitchBroadcast = null;
    this.twitchDraft = null;
    this.twitchDirty = false;
    this.twitchLiveInfo = null;
    this.twitchDetailsState = {
      loading: true,
      saving: false,
      error: null,
      notice: null,
    };
    this.twitchCategoryState = {
      query: "",
      results: [],
      loading: false,
      error: null,
    };
    this._twitchCategoryToken++;
    if (this._twitchCategoryTimer) {
      clearTimeout(this._twitchCategoryTimer);
      this._twitchCategoryTimer = null;
    }

    this.modalView = "goLiveTwitch";
    this.render();
    void this.loadTwitchBroadcastInfo();
  }

  /**
   * Fetches the latest Twitch channel information and rebuilds the draft.
   */
  async loadTwitchBroadcastInfo() {
    const token = ++this._twitchLoadToken;
    const details = this.twitchDetailsState;
    details.loading = true;
    details.error = null;
    details.notice = null;
    this._renderGoLiveTwitchIfActive();

    let res = null;
    try {
      res = await window.twitch?.getBroadcastInfo?.();
    } catch (err) {
      res = { success: false, error: err?.message || "Twitch is unavailable." };
    }

    if (token !== this._twitchLoadToken) return;

    details.loading = false;

    if (!res || !res.success) {
      details.error =
        res?.error || "Could not load your Twitch channel information.";
      if (res?.reloginRequired) this.twitchStatus.reloginRequired = true;
      this._renderGoLiveTwitchIfActive();
      return;
    }

    this.twitchBroadcast = {
      channel: res.channel,
      live: res.live || null,
      contentClassificationLabels: Array.isArray(
        res.contentClassificationLabels,
      )
        ? res.contentClassificationLabels
        : [],
    };
    this.twitchLiveInfo = res.live || null;
    this.twitchDraft = this.createTwitchDraft(res.channel);
    this.twitchDirty = false;
    this._renderGoLiveTwitchIfActive();
  }

  /**
   * Normalizes Twitch channel data into the editable Go Live draft.
   * @param {Object} channel - Channel data returned by the main process
   * @returns {Object}
   */
  createTwitchDraft(channel) {
    return {
      title: channel?.title || "",
      gameId: channel?.gameId || "",
      gameName: channel?.gameName || "",
      gameBoxArtUrl: resolveTwitchBoxArt(channel?.gameBoxArtUrl),
      language: channel?.language || "en",
      tags: Array.isArray(channel?.tags) ? [...channel.tags] : [],
      contentClassificationLabels: new Set(
        Array.isArray(channel?.contentClassificationLabels)
          ? channel.contentClassificationLabels
          : [],
      ),
      isBrandedContent: Boolean(channel?.isBrandedContent),
    };
  }

  markTwitchDirty() {
    this.twitchDirty = true;
  }

  _renderGoLiveTwitchIfActive() {
    if (
      this.ctx.state.isStreamModalOpen &&
      this.modalView === "goLiveTwitch" &&
      !this._streamViewTimer
    ) {
      this.renderGoLiveTwitchView();
    }
  }

  /**
   * Go Live step 1: platform selection.
   * @returns {boolean}
   */
  renderGoLivePlatformView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return false;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("GO LIVE").appendTo(dom.streamHeader);
    new Html("p")
      .text("Choose where your Encore session will be broadcast.")
      .appendTo(dom.streamHeader);
    this.buildStreamStepper(dom.streamHeader, 0);

    const selectionArea = new Html("div")
      .classOn("stream-selection-area")
      .appendTo(dom.streamContentArea);

    const tileContainer = new Html("div")
      .classOn("session-tile-container", "stream-tile-container")
      .appendTo(selectionArea);

    const twitchTile = new Html("div")
      .classOn("session-tile", "twitch-tile")
      .attr({ tabindex: "0" })
      .on("click", () => this.startGoLiveFlow("twitch"))
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html('<ion-icon name="logo-twitch" style="font-size: 3rem;"></ion-icon>')
      .appendTo(twitchTile);
    new Html("div")
      .classOn("session-tile-title")
      .text("TWITCH")
      .appendTo(twitchTile);
    new Html("div")
      .classOn("session-tile-desc")
      .text("Set your stream details and go live on your Twitch channel.")
      .appendTo(twitchTile);

    const directTile = new Html("div")
      .classOn("session-tile")
      .attr({ tabindex: "0" })
      .on("click", () => this.startGoLiveFlow("direct"))
      .appendTo(tileContainer);

    new Html("div")
      .classOn("session-tile-icon")
      .html(
        '<ion-icon name="radio-outline" style="font-size: 3rem;"></ion-icon>',
      )
      .appendTo(directTile);
    new Html("div")
      .classOn("session-tile-title")
      .text("DIRECT")
      .appendTo(directTile);
    new Html("div")
      .classOn("session-tile-desc")
      .text("Broadcast to any RTMP server using your own ingest details.")
      .appendTo(directTile);

    const btnRow = new Html("div")
      .classOn("session-btn-row")
      .appendTo(dom.streamFooter);

    new Html("button")
      .classOn("session-btn", "danger")
      .text("BACK")
      .on("click", () => {
        this.modalView = "selection";
        this.render();
      })
      .appendTo(btnRow);

    setTimeout(() => {
      if (this.modalView !== "goLivePlatform") return;
      const firstTile =
        dom.streamContentArea.elm.querySelector(".session-tile");
      if (firstTile) firstTile.focus();
    }, 100);

    return true;
  }

  /**
   * Go Live step 2a: Twitch stream information.
   * @returns {boolean}
   */
  renderGoLiveTwitchView() {
    if (this._streamViewTimer) return false;

    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return false;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("GO LIVE").appendTo(dom.streamHeader);
    new Html("p")
      .text("Set the information viewers will see on Twitch.")
      .appendTo(dom.streamHeader);
    this.buildStreamStepper(dom.streamHeader, 1);

    const page = new Html("div")
      .classOn("stream-page")
      .appendTo(dom.streamContentArea);

    const status = this.twitchStatus;
    const details = this.twitchDetailsState;
    const broadcast = this.twitchBroadcast;
    const canManage = status.authenticated && !status.reloginRequired;

    const btnRow = new Html("div")
      .classOn("stream-btn-row")
      .appendTo(dom.streamFooter);

    const addBackButton = () => {
      new Html("button")
        .classOn("session-btn")
        .html(
          '<ion-icon name="arrow-back-outline" style="font-size: 1.2rem; vertical-align: middle; margin-right: 0.5rem;"></ion-icon><span>BACK</span>',
        )
        .on("click", () => {
          this.modalView = "goLivePlatform";
          this.render();
        })
        .appendTo(btnRow);
    };

    if (!canManage) {
      addBackButton();

      if (status.login) {
        const waiting = new Html("div")
          .classOn("twitch-login-waiting")
          .attr({ role: "status", "aria-live": "polite" })
          .appendTo(page);

        new Html("img")
          .classOn("loading")
          .attr({
            src: "/assets/img/loading-spinner.svg",
            alt: "",
            draggable: "false",
          })
          .appendTo(waiting);

        new Html("div")
          .classOn("twitch-login-waiting-title")
          .text("WAITING FOR TWITCH...")
          .appendTo(waiting);

        const minutes = Math.max(
          1,
          Math.round((status.login.expiresAt - Date.now()) / 60000),
        );

        new Html("div")
          .classOn("twitch-login-waiting-desc")
          .text(
            `Approve access in your browser. This request expires in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
          )
          .appendTo(waiting);

        new Html("button")
          .classOn("session-btn", "danger")
          .text("CANCEL LOGIN")
          .on("click", async () => {
            await window.twitch?.cancelLogin?.();
          })
          .appendTo(btnRow);
        return true;
      }

      const card = new Html("div").classOn("stream-info-card").appendTo(page);

      new Html("strong")
        .text(
          status.reloginRequired
            ? "Twitch permissions need renewing"
            : "Twitch login required",
        )
        .appendTo(card);

      new Html("p")
        .classOn("twitch-signin-desc")
        .text(
          status.reloginRequired
            ? "Log in again to manage your channel and start your broadcast. You can also use a Direct RTMP broadcast instead."
            : "Sign in with Twitch to manage your channel and start your broadcast. You can also use a Direct RTMP broadcast instead.",
        )
        .appendTo(card);

      new Html("button")
        .classOn("session-btn", "primary")
        .text(
          status.reloginRequired ? "RENEW PERMISSIONS" : "OPEN TWITCH SETUP",
        )
        .on("click", async () => {
          if (status.reloginRequired) {
            await this.renewTwitchLogin();
          } else {
            this.modalView = "twitch";
            this.render();
          }
        })
        .appendTo(btnRow);

      return true;
    }

    addBackButton();

    if (!broadcast || !this.twitchDraft) {
      if (details.loading) {
        const waiting = new Html("div")
          .classOn("twitch-login-waiting")
          .attr({ role: "status", "aria-live": "polite" })
          .appendTo(page);

        new Html("img")
          .classOn("loading")
          .attr({
            src: "/assets/img/loading-spinner.svg",
            alt: "",
            draggable: "false",
          })
          .appendTo(waiting);

        new Html("div")
          .classOn("twitch-login-waiting-title")
          .text("LOADING CHANNEL DETAILS...")
          .appendTo(waiting);

        new Html("div")
          .classOn("twitch-login-waiting-desc")
          .text("Fetching your latest Twitch stream information.")
          .appendTo(waiting);
      } else {
        const card = new Html("div").classOn("stream-info-card").appendTo(page);

        new Html("strong")
          .text("Could not load your Twitch channel")
          .appendTo(card);

        new Html("p")
          .classOn("twitch-signin-desc")
          .text(
            details.error || "Twitch did not return your channel information.",
          )
          .appendTo(card);

        new Html("button")
          .classOn("session-btn", "primary")
          .text("TRY AGAIN")
          .on("click", () => {
            void this.loadTwitchBroadcastInfo();
          })
          .appendTo(btnRow);
      }

      return true;
    }

    const channelLiveElsewhere = Boolean(
      (this.twitchLiveInfo || this.twitchBroadcast?.live)?.isLive,
    );

    if (channelLiveElsewhere) {
      new Html("div")
        .classOn("stream-info-card")
        .html(
          "<strong>Your channel is already live.</strong><br>Stop the other broadcast before going live from Encore.",
        )
        .appendTo(page);
    }

    this.buildTwitchDetailsSection(page);
    this.buildTwitchTagsSection(page);
    this.buildTwitchContentSection(page);

    new Html("button")
      .classOn("session-btn", "primary")
      .html(
        '<span>NEXT</span><ion-icon name="arrow-forward-outline" style="font-size: 1.2rem; vertical-align: middle; margin-left: 0.5rem;"></ion-icon>',
      )
      .on("click", async (e) => {
        const btn = e.currentTarget;
        if (btn) {
          btn.disabled = true;
          btn.textContent = "SAVING...";
        }

        if (this.twitchDirty) {
          const saved = await this.saveTwitchDetails({ silent: true });
          if (!saved) {
            if (this.modalView === "goLiveTwitch") {
              this.renderGoLiveTwitchView();
            }
            return;
          }
        }

        this.modalView = "goLiveBitrate";
        this.render();
      })
      .appendTo(btnRow);

    setTimeout(() => {
      if (this.modalView !== "goLiveTwitch") return;
      const titleInput = dom.streamContentArea.elm.querySelector(
        'input[placeholder="Give your stream a title"]',
      );
      if (titleInput) titleInput.focus();
    }, 100);

    return true;
  }

  /**
   * Go Live step 3: encoder bitrate selection.
   * @returns {boolean}
   */
  renderGoLiveBitrateView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return false;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("GO LIVE").appendTo(dom.streamHeader);
    new Html("p")
      .text("Choose a bitrate before you start broadcasting.")
      .appendTo(dom.streamHeader);
    this.buildStreamStepper(dom.streamHeader, 2);

    const page = new Html("div")
      .classOn("stream-page")
      .appendTo(dom.streamContentArea);
    const bitrateContent = this.buildStreamSection(page, "BITRATE");

    const bitrateRow = new Html("div")
      .classOn("stream-bitrate-row")
      .appendTo(bitrateContent);

    const bitrates = [
      {
        label: "2.5 Mbps",
        value: 2500000,
        hint: "Lower bandwidth",
      },
      {
        label: "3.5 Mbps",
        value: 3500000,
        hint: "Recommended",
      },
      {
        label: "6.0 Mbps",
        value: 6000000,
        hint: "Higher quality",
      },
    ];

    bitrates.forEach((bitrate) => {
      const chip = new Html("div")
        .classOn("stream-bitrate-chip")
        .attr({ tabindex: "0" })
        .appendTo(bitrateRow);

      new Html("span")
        .classOn("stream-bitrate-label")
        .text(bitrate.label)
        .appendTo(chip);
      new Html("span")
        .classOn("stream-bitrate-hint")
        .text(bitrate.hint)
        .appendTo(chip);

      if (Number(this.videoBitrate) === bitrate.value) chip.classOn("active");

      chip.on("click", () => {
        if (this.isStreaming) return;
        this.videoBitrate = bitrate.value;
        this.saveConfig();
        this.renderGoLiveBitrateView();
      });
    });

    const summary = new Html("div").classOn("stream-info-card").appendTo(page);

    const platformLabel =
      this.goLivePlatform === "twitch" ? "Twitch" : "Direct RTMP";
    const destinationLabel =
      this.goLivePlatform === "twitch"
        ? this.twitchDraft?.title || "Your Twitch channel"
        : this.rtmpUrl || "No RTMP server configured";

    new Html("strong").text("Ready to go live:").appendTo(summary);
    new Html("div").text(`Platform: ${platformLabel}`).appendTo(summary);
    new Html("div").text(`Destination: ${destinationLabel}`).appendTo(summary);
    new Html("div")
      .text(`Bitrate: ${Math.round(this.videoBitrate / 100000) / 10} Mbps`)
      .appendTo(summary);

    const btnRow = new Html("div")
      .classOn("stream-btn-row")
      .appendTo(dom.streamFooter);

    new Html("button")
      .classOn("session-btn")
      .html(
        '<ion-icon name="arrow-back-outline" style="font-size: 1.2rem; vertical-align: middle; margin-right: 0.5rem;"></ion-icon><span>BACK</span>',
      )
      .on("click", () => {
        this.modalView =
          this.goLivePlatform === "twitch" ? "goLiveTwitch" : "goLiveDirect";
        this.render();
      })
      .appendTo(btnRow);

    const startBtn = new Html("button")
      .classOn("session-btn", "primary")
      .text(
        this.goLivePlatform === "twitch" ? "GO LIVE ON TWITCH" : "START STREAM",
      )
      .appendTo(btnRow);

    if (this._startingStream) {
      startBtn.elm.disabled = true;
      startBtn.text("STARTING...");
    }

    startBtn.on("click", async () => {
      if (this._startingStream || this.isStreaming) return;
      this._startingStream = true;
      startBtn.elm.disabled = true;
      startBtn.text("STARTING...");

      let started = false;
      if (this.goLivePlatform === "twitch") {
        started = await this.goLiveOnTwitch();
      } else {
        this.saveConfig();
        started = await this.startStream();
      }

      this._startingStream = false;

      if (started) {
        this.modalView = "live";
        this.render();
      } else if (this.modalView === "goLiveBitrate") {
        this.renderGoLiveBitrateView();
      }
    });

    return true;
  }

  /**
   * Final Go Live step: live broadcast information and bitrate graph.
   * @returns {boolean}
   */
  renderLiveView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return false;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    const isTwitch = this.goLivePlatform === "twitch";

    new Html("h1")
      .text(this.isStreaming ? "LIVE BROADCAST" : "STREAM DASHBOARD")
      .appendTo(dom.streamHeader);
    new Html("p")
      .text(
        this.isStreaming
          ? isTwitch
            ? "Your Encore session is live on Twitch."
            : "Your Encore session is broadcasting to your RTMP server."
          : "Review your broadcast and go live when you are ready.",
      )
      .appendTo(dom.streamHeader);
    this.buildStreamStepper(dom.streamHeader, 3);

    const page = new Html("div")
      .classOn("stream-page", "stream-live-page")
      .appendTo(dom.streamContentArea);

    this.buildStreamStatsGrid(page, { includeViewers: isTwitch });

    const chartCard = new Html("div")
      .classOn("stream-chart-card")
      .appendTo(page);
    const chartHeader = new Html("div")
      .classOn("stream-chart-header")
      .appendTo(chartCard);

    new Html("span")
      .classOn("stream-chart-title")
      .text("BITRATE")
      .appendTo(chartHeader);

    this._bitrateChartValueEl = new Html("span")
      .classOn("stream-chart-value")
      .text("0 kbps")
      .appendTo(chartHeader);

    const chartWrap = new Html("div")
      .classOn("stream-chart-canvas-wrap")
      .appendTo(chartCard);

    if (this._bitrateResizeObserver) {
      this._bitrateResizeObserver.disconnect();
      this._bitrateResizeObserver.observe(chartWrap.elm);
    }

    this._bitrateCanvas = new Html("canvas")
      .classOn("stream-chart-canvas")
      .attr({ "aria-label": "Bitrate over time" })
      .appendTo(chartWrap).elm;

    const btnRow = new Html("div")
      .classOn("stream-btn-row")
      .appendTo(dom.streamFooter);

    if (!this.isStreaming) {
      new Html("button")
        .classOn("session-btn")
        .html(
          '<ion-icon name="arrow-back-outline" style="font-size: 1.2rem; vertical-align: middle; margin-right: 0.5rem;"></ion-icon><span>BACK</span>',
        )
        .on("click", () => {
          this.modalView = "goLiveBitrate";
          this.render();
        })
        .appendTo(btnRow);
    }

    new Html("button")
      .classOn("session-btn")
      .text("CLOSE")
      .on("click", () => this.toggleStreamModal(false))
      .appendTo(btnRow);

    const liveBtn = new Html("button")
      .classOn("session-btn", this.isStreaming ? "danger" : "primary")
      .text(this.isStreaming ? "STOP STREAM" : "START STREAM")
      .appendTo(btnRow);

    if (this._startingStream) {
      liveBtn.elm.disabled = true;
      liveBtn.text("STARTING...");
    }

    liveBtn.on("click", async () => {
      if (this._startingStream) return;

      if (this.isStreaming) {
        await this.stopStream();
        return;
      }

      this._startingStream = true;
      liveBtn.elm.disabled = true;
      liveBtn.text("STARTING...");

      let started = false;
      if (isTwitch) {
        started = await this.goLiveOnTwitch();
      } else {
        this.saveConfig();
        started = await this.startStream();
      }

      this._startingStream = false;
      if (started) this.modalView = "live";
      if (this.modalView === "live") this.renderLiveView();
    });

    this.updateStatsUI();
    requestAnimationFrame(() => this.drawBitrateChart());
    return true;
  }

  /**
   * Builds the title, category, and language fields.
   * @param {Html} parent
   */
  buildTwitchDetailsSection(parent) {
    const sectionContent = this.buildStreamSection(parent, "STREAM DETAILS");
    const draft = this.twitchDraft;

    const titleGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(sectionContent);

    new Html("label")
      .classOn("stream-form-label")
      .text("Stream Title")
      .appendTo(titleGroup);

    const titleInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: "text",
        maxlength: "140",
        placeholder: "Give your stream a title",
        value: draft.title,
      })
      .appendTo(titleGroup);

    const charCount = new Html("div")
      .classOn("twitch-char-count")
      .text(`${draft.title.length} / 140`)
      .appendTo(titleGroup);

    titleInput.on("input", () => {
      draft.title = titleInput.getValue();
      charCount.text(`${draft.title.length} / 140`);
      this.markTwitchDirty();
    });

    titleInput.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        titleInput.elm.blur();
      }
    });

    const categoryGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(sectionContent);

    new Html("label")
      .classOn("stream-form-label")
      .text("Category")
      .appendTo(categoryGroup);

    this._twitchCategoryChipEl = new Html("div")
      .classOn("twitch-category-current")
      .appendTo(categoryGroup);
    this.rebuildTwitchCategoryChip();

    const categorySearch = new Html("input")
      .classOn("stream-input", "twitch-category-search")
      .attr({
        type: "search",
        placeholder: "Search Twitch categories...",
        value: this.twitchCategoryState.query || "",
      })
      .appendTo(categoryGroup);
    this._twitchCategoryInput = categorySearch;

    this._twitchCategoryResultsEl = new Html("div")
      .classOn("twitch-category-results")
      .appendTo(categoryGroup);

    categorySearch.on("input", () => {
      this.handleTwitchCategoryInput(categorySearch.getValue());
    });

    categorySearch.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.handleTwitchCategoryInput(categorySearch.getValue(), true);
      } else if (e.key === "Escape") {
        const { results, loading, error } = this.twitchCategoryState;
        if (results.length || loading || error) {
          e.stopPropagation();
          this.twitchCategoryState.results = [];
          this.twitchCategoryState.loading = false;
          this.twitchCategoryState.error = null;
          this.renderTwitchCategoryResults();
        }
      }
    });

    this.renderTwitchCategoryResults();

    const languageGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(sectionContent);

    new Html("label")
      .classOn("stream-form-label")
      .text("Language")
      .appendTo(languageGroup);

    const languageSelect = new Html("select")
      .classOn("stream-select", "twitch-language-select")
      .appendTo(languageGroup);

    const languageCodes = new Set(TWITCH_LANGUAGES.map((item) => item.code));
    const currentLanguage = draft.language || "en";

    if (!languageCodes.has(currentLanguage)) {
      new Html("option")
        .attr({ value: currentLanguage })
        .text(currentLanguage.toUpperCase())
        .appendTo(languageSelect);
    }

    TWITCH_LANGUAGES.forEach((language) => {
      const option = new Html("option")
        .attr({ value: language.code })
        .text(`${language.label} (${language.code})`)
        .appendTo(languageSelect);
      if (language.code === currentLanguage) option.elm.selected = true;
    });

    languageSelect.on("change", () => {
      draft.language = languageSelect.getValue();
      this.markTwitchDirty();
    });
  }

  /**
   * Rebuilds the selected category chip from the current draft.
   */
  rebuildTwitchCategoryChip() {
    const el = this._twitchCategoryChipEl;
    if (!el || !el.elm.isConnected) return;

    el.clear();
    const name = this.twitchDraft?.gameName;
    const art = this.twitchDraft?.gameBoxArtUrl;

    if (name) {
      if (art) {
        new Html("img")
          .classOn("twitch-category-chip-art")
          .attr({ src: art, alt: "", draggable: "false" })
          .appendTo(el);
      }
      new Html("span")
        .classOn("twitch-category-chip-name")
        .text(name)
        .appendTo(el);
    } else {
      new Html("span")
        .classOn("twitch-category-empty")
        .text("No category selected")
        .appendTo(el);
    }
  }

  /**
   * Debounces and starts a Twitch category search.
   * @param {string} value - Current search field value
   * @param {boolean} immediate - Skip the debounce
   */
  handleTwitchCategoryInput(value, immediate = false) {
    this.twitchCategoryState.query = value;
    this._twitchCategoryToken++;
    const token = this._twitchCategoryToken;
    const term = value.trim();

    if (this._twitchCategoryTimer) {
      clearTimeout(this._twitchCategoryTimer);
      this._twitchCategoryTimer = null;
    }

    if (term.length < 2) {
      this.twitchCategoryState.results = [];
      this.twitchCategoryState.loading = false;
      this.twitchCategoryState.error = null;
      this.renderTwitchCategoryResults();
      return;
    }

    this.twitchCategoryState.results = [];
    this.twitchCategoryState.loading = true;
    this.twitchCategoryState.error = null;
    this.renderTwitchCategoryResults();

    if (immediate) {
      void this.searchTwitchCategories(term, token);
      return;
    }

    this._twitchCategoryTimer = setTimeout(() => {
      this._twitchCategoryTimer = null;
      void this.searchTwitchCategories(term, token);
    }, 300);
  }

  /**
   * @param {string} term
   * @param {number} token - Guards against out-of-order responses
   */
  async searchTwitchCategories(term, token) {
    let res = null;
    try {
      res = await window.twitch?.searchCategories?.(term);
    } catch (err) {
      res = { success: false, error: err?.message || "Search failed." };
    }

    if (token !== this._twitchCategoryToken) return;

    this.twitchCategoryState.loading = false;

    if (!res || !res.success) {
      this.twitchCategoryState.results = [];
      this.twitchCategoryState.error =
        res?.error || "Could not search Twitch categories.";
    } else {
      this.twitchCategoryState.results = Array.isArray(res.categories)
        ? res.categories
        : [];
      this.twitchCategoryState.error = null;
    }

    this.renderTwitchCategoryResults();
  }

  /**
   * Paints category search results under the search field.
   */
  renderTwitchCategoryResults() {
    const el = this._twitchCategoryResultsEl;
    if (!el || !el.elm.isConnected) return;

    const { results, loading, error, query } = this.twitchCategoryState;
    el.clear();

    if (loading) {
      new Html("div")
        .classOn("twitch-category-message")
        .text("Searching Twitch categories...")
        .appendTo(el);
      el.classOn("open");
      return;
    }

    if (error) {
      new Html("div")
        .classOn("twitch-category-message", "twitch-category-error")
        .text(error)
        .appendTo(el);
      el.classOn("open");
      return;
    }

    if (!results.length) {
      if ((query || "").trim().length >= 2) {
        new Html("div")
          .classOn("twitch-category-message")
          .text("No categories found.")
          .appendTo(el);
        el.classOn("open");
      } else {
        el.classOff("open");
      }
      return;
    }

    results.forEach((category) => {
      const result = new Html("button")
        .classOn("twitch-category-result")
        .attr({ type: "button" })
        .appendTo(el);

      if (category.boxArtUrl) {
        new Html("img")
          .classOn("twitch-category-art")
          .attr({ src: category.boxArtUrl, alt: "", draggable: "false" })
          .appendTo(result);
      }

      new Html("span")
        .classOn("twitch-category-result-name")
        .text(category.name)
        .appendTo(result);

      result.on("click", (e) => {
        e.stopPropagation();
        this.selectTwitchCategory(category);
      });
    });

    el.classOn("open");
  }

  /**
   * @param {{id: string, name: string}} category
   */
  selectTwitchCategory(category) {
    if (!this.twitchDraft) return;

    this.twitchDraft.gameId = category.id;
    this.twitchDraft.gameName = category.name;
    this.twitchDraft.gameBoxArtUrl = resolveTwitchBoxArt(category.boxArtUrl);
    this.markTwitchDirty();

    this.twitchCategoryState.query = "";
    this.twitchCategoryState.results = [];
    this.twitchCategoryState.loading = false;
    this.twitchCategoryState.error = null;
    this._twitchCategoryToken++;

    if (this._twitchCategoryInput?.elm.isConnected) {
      this._twitchCategoryInput.elm.value = "";
    }

    this.renderTwitchCategoryResults();
    this.rebuildTwitchCategoryChip();
  }

  /**
   * Builds the editable tag list.
   * @param {Html} parent
   */
  buildTwitchTagsSection(parent) {
    const sectionContent = this.buildStreamSection(parent, "TAGS");

    const editor = new Html("div")
      .classOn("twitch-tag-editor")
      .appendTo(sectionContent);

    this._twitchTagChipsEl = new Html("div")
      .classOn("twitch-tag-chips")
      .appendTo(editor);
    this.rebuildTwitchTagChips();

    const row = new Html("div").classOn("twitch-tag-row").appendTo(editor);

    const input = new Html("input")
      .classOn("stream-input", "twitch-tag-input")
      .attr({
        type: "text",
        maxlength: "25",
        placeholder: "Add a tag and press Enter",
      })
      .appendTo(row);
    this._twitchTagInput = input;

    input.on("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        this.addTwitchTagFromInput();
      }
    });

    new Html("button")
      .classOn("twitch-tag-add")
      .attr({ type: "button" })
      .text("ADD")
      .on("click", (e) => {
        e.stopPropagation();
        this.addTwitchTagFromInput();
      })
      .appendTo(row);

    new Html("div")
      .classOn("twitch-field-hint")
      .text(`${TWITCH_MAX_TAGS} tags maximum. Use letters and numbers only.`)
      .appendTo(editor);
  }

  /**
   * Adds the current tag input value to the draft.
   */
  addTwitchTagFromInput() {
    const input = this._twitchTagInput;
    const draft = this.twitchDraft;
    if (!input || !draft) return;

    const raw = input.getValue().trim().replace(/^#/, "");
    if (!raw) return;

    if (draft.tags.length >= TWITCH_MAX_TAGS) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        `Twitch allows a maximum of ${TWITCH_MAX_TAGS} tags.`,
        3000,
      );
      return;
    }

    if (raw.length > 25 || !TWITCH_TAG_PATTERN.test(raw)) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        `"${raw}" is not a valid Twitch tag. Use letters and numbers only.`,
        4000,
      );
      return;
    }

    if (draft.tags.some((tag) => tag.toLowerCase() === raw.toLowerCase())) {
      input.val("");
      return;
    }

    draft.tags.push(raw);
    input.val("");
    this.markTwitchDirty();
    this.rebuildTwitchTagChips();
  }

  /**
   * Repaints the tag chips from the current draft.
   */
  rebuildTwitchTagChips() {
    const el = this._twitchTagChipsEl;
    if (!el || !el.elm.isConnected) return;

    el.clear();
    const tags = this.twitchDraft?.tags || [];

    if (!tags.length) {
      new Html("span")
        .classOn("twitch-tag-empty")
        .text("No tags yet.")
        .appendTo(el);
      return;
    }

    tags.forEach((tag, index) => {
      const chip = new Html("span").classOn("twitch-tag-chip").appendTo(el);
      new Html("span").text(tag).appendTo(chip);

      const remove = new Html("button")
        .classOn("twitch-tag-remove")
        .attr({
          type: "button",
          "aria-label": `Remove ${tag}`,
        })
        .text("×")
        .appendTo(chip);

      remove.on("click", (e) => {
        e.stopPropagation();
        this.twitchDraft.tags.splice(index, 1);
        this.markTwitchDirty();
        this.rebuildTwitchTagChips();
      });
    });
  }

  /**
   * Builds the content classification and branded content toggles.
   * @param {Html} parent
   */
  buildTwitchContentSection(parent) {
    const sectionContent = this.buildStreamSection(
      parent,
      "CONTENT CLASSIFICATIONS",
    );
    const draft = this.twitchDraft;
    const labels = Array.isArray(
      this.twitchBroadcast?.contentClassificationLabels,
    )
      ? this.twitchBroadcast.contentClassificationLabels
      : [];

    if (!labels.length) {
      new Html("div")
        .classOn("stream-info-card")
        .text("Twitch did not return any content classification labels.")
        .appendTo(sectionContent);
    }

    labels.forEach((label) => {
      if (TWITCH_AUTOMATIC_CONTENT_LABELS.has(label.id)) return;

      const row = new Html("div").classOn("twitch-ccl-row");

      const enabled = draft.contentClassificationLabels.has(label.id);
      const toggle = new ToggleSwitch({
        checked: enabled,
        ariaLabel: label.name,
        onChange: (next) => {
          const set = this.twitchDraft.contentClassificationLabels;
          if (next) set.add(label.id);
          else set.delete(label.id);
          this.markTwitchDirty();
        },
      }).appendTo(row);

      const text = new Html("div").classOn("twitch-ccl-text").appendTo(row);

      new Html("span")
        .classOn("twitch-ccl-name")
        .text(label.name)
        .appendTo(text);

      if (label.description) {
        new Html("span")
          .classOn("twitch-ccl-desc")
          .text(label.description)
          .appendTo(text);
      }

      row.appendTo(sectionContent);
    });

    const brandedRow = new Html("div")
      .classOn("twitch-ccl-row")
      .appendTo(sectionContent);

    const brandedToggle = new ToggleSwitch({
      checked: draft.isBrandedContent,
      ariaLabel: "This stream contains branded content",
      onChange: (next) => {
        this.twitchDraft.isBrandedContent = next;
        this.markTwitchDirty();
      },
    }).appendTo(brandedRow);

    const brandedText = new Html("div")
      .classOn("twitch-ccl-text")
      .appendTo(brandedRow);

    new Html("span")
      .classOn("twitch-ccl-name")
      .text("Branded Content")
      .appendTo(brandedText);

    new Html("span")
      .classOn("twitch-ccl-desc")
      .text("This stream contains paid promotion or sponsored content.")
      .appendTo(brandedText);
  }

  /**
   * Builds the shared streaming statistics grid.
   * @param {Html} parent
   * @param {{includeViewers?: boolean}} options
   */
  buildStreamStatsGrid(parent, options = {}) {
    const statsGrid = new Html("div")
      .classOn("stream-stats-grid")
      .appendTo(parent);
    this.statEls = {};

    const addStat = (id, label, initialVal) => {
      const item = new Html("div")
        .classOn("stream-stat-item")
        .appendTo(statsGrid);
      new Html("span").classOn("stream-stat-label").text(label).appendTo(item);
      this.statEls[id] = new Html("span")
        .classOn("stream-stat-value")
        .text(initialVal)
        .appendTo(item);
    };

    addStat("health", "Health", this.isStreaming ? "Initializing" : "Offline");
    addStat("duration", "Time Live", "00:00");
    addStat("bitrate", "Bitrate", "0 kbps");
    addStat("fps", "Framerate", "0 fps");
    addStat("drops", "Dropped", "0");
    addStat("data", "Transferred", "0.0 MB");

    if (options.includeViewers) {
      const viewers = this.twitchLiveInfo?.viewerCount;
      addStat(
        "viewers",
        "Viewers",
        typeof viewers === "number" ? String(viewers) : "—",
      );
    }

    const meter = new Html("div")
      .classOn("stream-health-meter")
      .appendTo(statsGrid);
    this.statEls.healthBar = new Html("div")
      .classOn("stream-health-bar")
      .appendTo(meter);

    return statsGrid;
  }

  /**
   * Saves the current Go Live draft to Twitch.
   * @param {{silent?: boolean}} options
   * @returns {Promise<boolean>}
   */
  async saveTwitchDetails(options = {}) {
    const draft = this.twitchDraft;
    const details = this.twitchDetailsState;
    if (!draft || details.saving) return false;

    const title = draft.title.trim();
    if (!title) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Add a stream title before going live.",
        4000,
      );
      return false;
    }

    if (title.length > 140) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Twitch stream titles are limited to 140 characters.",
        4000,
      );
      return false;
    }

    if (draft.tags.length > TWITCH_MAX_TAGS) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        `Twitch allows a maximum of ${TWITCH_MAX_TAGS} tags.`,
        4000,
      );
      return false;
    }

    const payload = {
      title,
      language: draft.language,
      tags: [...draft.tags],
      contentClassificationLabels: Array.from(
        draft.contentClassificationLabels,
      ),
      isBrandedContent: Boolean(draft.isBrandedContent),
    };

    if (draft.gameId) payload.gameId = draft.gameId;

    details.saving = true;
    details.error = null;
    details.notice = null;
    this._renderGoLiveTwitchIfActive();

    let res = null;
    try {
      res = await window.twitch?.updateBroadcastInfo?.(payload);
    } catch (err) {
      res = {
        success: false,
        error: err?.message || "Twitch could not save your stream details.",
      };
    }

    details.saving = false;

    if (!res || !res.success) {
      details.error =
        res?.error || "Twitch could not save your stream details.";
      if (res?.reloginRequired) this.twitchStatus.reloginRequired = true;
      this._renderGoLiveTwitchIfActive();
      this.ctx.modules.infoBar.showTemp("TWITCH", details.error, 5000);
      return false;
    }

    if (res.channel) {
      this.twitchBroadcast = {
        channel: res.channel,
        live: res.live || this.twitchBroadcast?.live || null,
        contentClassificationLabels:
          Array.isArray(res.contentClassificationLabels) &&
          res.contentClassificationLabels.length
            ? res.contentClassificationLabels
            : this.twitchBroadcast?.contentClassificationLabels || [],
      };
      this.twitchDraft = this.createTwitchDraft(res.channel);
      this.twitchDirty = false;
    }

    if (res.live) this.twitchLiveInfo = res.live;

    details.notice = "Stream details saved to Twitch.";
    this._renderGoLiveTwitchIfActive();

    if (!options.silent) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Stream details saved.",
        3000,
      );
    }

    return true;
  }

  /**
   * Saves pending details, retrieves the channel stream key, and starts the
   * direct broadcast to Twitch.
   * @returns {Promise<boolean>}
   */
  async goLiveOnTwitch() {
    if (this.isStreaming) return false;

    if (!this.twitchStatus.authenticated || this.twitchStatus.reloginRequired) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Log in with Twitch again to start your broadcast.",
        4000,
      );
      return false;
    }

    if (!this.twitchDraft || !this.twitchBroadcast) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Twitch channel details are still loading.",
        3000,
      );
      return false;
    }

    if ((this.twitchLiveInfo || this.twitchBroadcast.live)?.isLive) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Your Twitch channel is already live. Stop the other broadcast first.",
        5000,
      );
      return false;
    }

    if (!this.twitchDraft.title.trim()) {
      this.ctx.modules.infoBar.showTemp(
        "TWITCH",
        "Add a stream title before going live.",
        4000,
      );
      return false;
    }

    if (this.twitchDirty) {
      const saved = await this.saveTwitchDetails({ silent: true });
      if (!saved) return false;
    }

    const keyRes = await window.twitch?.getStreamKey?.();
    if (!keyRes || !keyRes.success) {
      const error =
        keyRes?.error || "Twitch could not provide your stream key.";
      this.twitchDetailsState.error = error;
      if (keyRes?.reloginRequired) this.twitchStatus.reloginRequired = true;
      this._renderGoLiveTwitchIfActive();
      this.ctx.modules.infoBar.showTemp("TWITCH", error, 6000);
      return false;
    }

    const started = await this.startStream({
      destination: "twitch",
      rtmpUrl: keyRes.ingestUrl || TWITCH_INGEST_URL,
      streamKey: keyRes.streamKey,
    });

    if (!started) return false;

    this.twitchLiveInfo = {
      isLive: true,
      startedAt: new Date().toISOString(),
      viewerCount: this.twitchLiveInfo?.viewerCount ?? null,
    };
    this.startTwitchLivePoll();
    return true;
  }

  /**
   * Polls Twitch for live viewer counts while broadcasting.
   */
  startTwitchLivePoll() {
    this.stopTwitchLivePoll();
    void this.refreshTwitchLiveStatus();
    this._twitchLivePoll = setInterval(() => {
      void this.refreshTwitchLiveStatus();
    }, 60000);
  }

  stopTwitchLivePoll() {
    if (this._twitchLivePoll) {
      clearInterval(this._twitchLivePoll);
      this._twitchLivePoll = null;
    }
  }

  async refreshTwitchLiveStatus() {
    if (!this.isStreaming || this.activeStreamDestination !== "twitch") return;

    let res = null;
    try {
      res = await window.twitch?.getBroadcastInfo?.();
    } catch {
      return;
    }

    if (!res || !res.success || !res.live) return;

    this.twitchLiveInfo = res.live;
    this.updateStatsUI();
  }

  /**
   * Go Live step 2b: direct RTMP ingest information.
   * @returns {boolean}
   */
  renderGoLiveDirectView() {
    const dom = this.ctx.dom;
    if (!dom.streamHeader || !dom.streamContentArea) return false;

    dom.streamHeader.clear();
    dom.streamContentArea.clear();
    dom.streamFooter.classOff("hidden");
    dom.streamFooter.clear();

    new Html("h1").text("GO LIVE").appendTo(dom.streamHeader);
    new Html("p")
      .text("Enter the ingest details for your RTMP destination.")
      .appendTo(dom.streamHeader);
    this.buildStreamStepper(dom.streamHeader, 1);

    const page = new Html("div")
      .classOn("stream-page")
      .appendTo(dom.streamContentArea);

    const ingestContent = this.buildStreamSection(page, "INGEST CONFIGURATION");

    const urlGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(ingestContent);

    new Html("label")
      .classOn("stream-form-label")
      .text("RTMP Server URL")
      .appendTo(urlGroup);

    const urlInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: "text",
        placeholder: "rtmp://...",
        value: this.rtmpUrl,
      })
      .appendTo(urlGroup);

    urlInput.on("input", () => {
      this.rtmpUrl = urlInput.getValue().trim();
    });

    const keyGroup = new Html("div")
      .classOn("stream-form-group")
      .appendTo(ingestContent);

    new Html("label")
      .classOn("stream-form-label")
      .text("Stream Key")
      .appendTo(keyGroup);

    const keyWrapper = new Html("div")
      .classOn("stream-input-wrapper")
      .styleJs({
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "center",
      })
      .appendTo(keyGroup);

    const keyInput = new Html("input")
      .classOn("stream-input")
      .attr({
        type: this.isKeyVisible ? "text" : "password",
        placeholder: "Paste stream key here...",
        value: this.streamKey,
      })
      .appendTo(keyWrapper);

    keyInput.on("input", () => {
      this.streamKey = keyInput.getValue().trim();
    });

    const keyActions = new Html("div")
      .classOn("stream-key-actions")
      .appendTo(keyWrapper);

    const pasteKeyBtn = new Html("button")
      .classOn("stream-key-action-btn")
      .text("PASTE")
      .appendTo(keyActions);

    pasteKeyBtn.on("click", async (e) => {
      e.stopPropagation();
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.streamKey = text.trim();
          keyInput.elm.value = this.streamKey;
          this.ctx.modules.infoBar.showTemp(
            "STREAM",
            "Stream key pasted.",
            2000,
          );
        }
      } catch (err) {
        console.error("[STREAM] Paste error:", err);
      }
    });

    const toggleKeyBtn = new Html("button")
      .classOn("stream-key-action-btn")
      .text(this.isKeyVisible ? "HIDE" : "SHOW")
      .appendTo(keyActions);

    toggleKeyBtn.on("click", (e) => {
      e.stopPropagation();
      this.isKeyVisible = !this.isKeyVisible;
      keyInput.attr({ type: this.isKeyVisible ? "text" : "password" });
      toggleKeyBtn.text(this.isKeyVisible ? "HIDE" : "SHOW");
    });

    const infoCard = new Html("div").classOn("stream-info-card").appendTo(page);

    infoCard.html(`
      <strong>Broadcasting Notes:</strong><br>
      • Ensure your RTMP ingest URL points to your nearest streaming server to minimize latency.<br>
      • In a Session, all room audio you can hear will be mixed into the broadcast.<br>
      • <strong>Be sure to take the Mic Latency test in the Setup!</strong>
    `);

    const btnRow = new Html("div")
      .classOn("stream-btn-row")
      .appendTo(dom.streamFooter);

    new Html("button")
      .classOn("session-btn")
      .html(
        '<ion-icon name="arrow-back-outline" style="font-size: 1.2rem; vertical-align: middle; margin-right: 0.5rem;"></ion-icon><span>BACK</span>',
      )
      .on("click", () => {
        this.modalView = "goLivePlatform";
        this.render();
      })
      .appendTo(btnRow);

    new Html("button")
      .classOn("session-btn", "primary")
      .html(
        '<span>NEXT</span><ion-icon name="arrow-forward-outline" style="font-size: 1.2rem; vertical-align: middle; margin-left: 0.5rem;"></ion-icon>',
      )
      .on("click", () => {
        if (!this.rtmpUrl.trim()) {
          this.ctx.modules.infoBar.showTemp(
            "STREAM",
            "Please provide a valid RTMP server URL.",
            3000,
          );
          urlInput.elm.focus();
          return;
        }

        this.saveConfig();
        this.modalView = "goLiveBitrate";
        this.render();
      })
      .appendTo(btnRow);

    setTimeout(() => {
      if (this.modalView !== "goLiveDirect") return;
      if (!this.rtmpUrl) urlInput.elm.focus();
    }, 100);

    return true;
  }

  saveConfig() {
    window.config?.setItem?.("streamConfig", {
      rtmpUrl: this.rtmpUrl,
      streamKey: this.streamKey,
      videoBitrate: this.videoBitrate,
    });
  }

  saveObsConfig(enabledOverride = null) {
    const currentStored = this.ctx.config?.obsConfig || {};
    const isEnabled =
      enabledOverride !== null
        ? enabledOverride
        : (currentStored.enabled ?? false);

    const newCfg = {
      host: this.obsHost,
      port: this.obsPort,
      password: this.obsPassword,
      autoReconnect: this.obsAutoReconnect,
      enabled: isEnabled,
      scenes: this.obsScenesConfig,
    };

    this.ctx.config.obsConfig = newCfg;
    window.config?.setItem?.("obsConfig", newCfg);
  }

  /**
   * Starts broadcasting via FFmpeg.
   * @param {{destination?: "direct"|"twitch", rtmpUrl?: string, streamKey?: string}} options
   */
  async startStream(options = {}) {
    if (this.isStreaming) return false;

    const destination = options.destination === "twitch" ? "twitch" : "direct";
    const rtmpUrl = (options.rtmpUrl ?? this.rtmpUrl ?? "").trim();
    const streamKey = (options.streamKey ?? this.streamKey ?? "").trim();

    if (!rtmpUrl) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Please provide a valid RTMP server URL.",
        3000,
      );
      return false;
    }

    const stream = this.ctx.modules.recorder.getBroadcastStream();
    if (!stream) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "No active audio/video stream found.",
        3000,
      );
      return false;
    }

    const res = await window.desktopIntegration.ipc.invoke("stream-start", {
      rtmpUrl,
      streamKey,
      videoBitrate: this.videoBitrate,
    });

    if (!res.success) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        `Stream error: ${res.reason || res.error}`,
        4000,
      );
      return false;
    }

    const videoMimes = [
      "video/webm; codecs=h264,opus",
      "video/webm; codecs=h264",
      "video/webm; codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType =
      videoMimes.find((m) => MediaRecorder.isTypeSupported(m)) || "";

    try {
      this.streamRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: this.videoBitrate,
        audioBitsPerSecond: 192000,
      });

      let chunkQueue = Promise.resolve();

      this.totalBytesSent = 0;
      this.currentBitrateKbps = 0;
      this.lastChunkTime = Date.now();

      this.streamRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          const now = Date.now();
          const deltaSec = (now - (this.lastChunkTime || now)) / 1000 || 1;
          this.lastChunkTime = now;
          this.totalBytesSent += e.data.size;
          this.currentBitrateKbps = Math.round(
            (e.data.size * 8) / (deltaSec * 1000),
          );

          chunkQueue = chunkQueue
            .then(async () => {
              const buffer = await e.data.arrayBuffer();
              window.desktopIntegration.ipc.send("stream-chunk", buffer);
            })
            .catch((err) => console.error("[STREAM] Queue error:", err));
        }
      };

      this.streamRecorder.start(1000);
      this.isStreaming = true;
      this.activeStreamDestination = destination;
      this.streamStartTime = Date.now();
      this.bitrateHistory = [];
      this._lastBitrateSampleAt = 0;

      if (this.statsTimer) clearInterval(this.statsTimer);
      this.statsTimer = setInterval(() => this.updateStatsUI(), 1000);

      this.ctx.modules.dialog(
        new Html("div").classOn("temp-dialog-text").text("STREAM STARTED"),
        2000,
      );
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        destination === "twitch"
          ? "Broadcasting live to Twitch..."
          : "Broadcasting live to RTMP...",
        3000,
      );
      return true;
    } catch (err) {
      console.error("[STREAM] Failed to start stream recorder:", err);
      await window.desktopIntegration.ipc.invoke("stream-stop");
      this.isStreaming = false;
      this.activeStreamDestination = null;
      return false;
    }
  }

  /**
   * Returns the best available current bitrate in kbps.
   * @returns {number}
   */
  getCurrentBitrateKbps() {
    const stats = this.latestStats;
    const parsed = stats?.bitrate ? parseFloat(stats.bitrate) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    if (this.currentBitrateKbps > 0) return this.currentBitrateKbps;
    return Math.round(this.videoBitrate / 1000);
  }

  /**
   * Stores one bitrate sample per second for the live graph.
   */
  recordBitrateSample() {
    if (!this.isStreaming) {
      this._lastBitrateSampleAt = 0;
      return;
    }

    const now = Date.now();
    if (now - this._lastBitrateSampleAt < 900) return;
    this._lastBitrateSampleAt = now;

    this.bitrateHistory.push(this.getCurrentBitrateKbps());
    if (this.bitrateHistory.length > 180) this.bitrateHistory.shift();
  }

  /**
   * Paints the bitrate graph and current readout.
   */
  updateBitrateChartUI() {
    const kbps = this.isStreaming ? this.getCurrentBitrateKbps() : 0;
    if (this._bitrateChartValueEl?.elm.isConnected) {
      this._bitrateChartValueEl.text(`${kbps} kbps`);
    }
    this.drawBitrateChart();
  }

  /**
   * Draws the bitrate history line graph on the live dashboard.
   */
  drawBitrateChart() {
    const canvas = this._bitrateCanvas;
    if (!canvas || !canvas.isConnected) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 12, right: 12, bottom: 22, left: 48 };
    const plotWidth = Math.max(1, width - pad.left - pad.right);
    const plotHeight = Math.max(1, height - pad.top - pad.bottom);
    const history = this.bitrateHistory;
    const configured = Math.round(this.videoBitrate / 1000);
    const peak = Math.max(configured, ...history, 1);
    const maxY = Math.max(1000, Math.ceil((peak * 1.2) / 500) * 500);

    ctx.font = '10px "Radio Canada", sans-serif';
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.strokeStyle = "rgba(137, 207, 240, 0.12)";
    ctx.lineWidth = 1;

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + plotHeight * (i / gridLines);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();

      const value = Math.round(maxY * (1 - i / gridLines));
      ctx.textAlign = "left";
      ctx.fillText(String(value), 4, y + 3);
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.textAlign = "left";
    ctx.fillText("3m ago", pad.left, height - 6);
    ctx.textAlign = "right";
    ctx.fillText("now", width - pad.right, height - 6);
    ctx.textAlign = "left";

    if (!history.length) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.textAlign = "center";
      ctx.fillText(
        "Waiting for stream data...",
        pad.left + plotWidth / 2,
        pad.top + plotHeight / 2,
      );
      ctx.textAlign = "left";
      return;
    }

    const points = history.map((value, index) => {
      const x =
        history.length === 1
          ? pad.left + plotWidth
          : pad.left + plotWidth * (index / (history.length - 1));
      const clamped = Math.max(0, Math.min(value, maxY));
      return {
        x,
        y: pad.top + plotHeight - (clamped / maxY) * plotHeight,
      };
    });

    const baseline = pad.top + plotHeight;
    const gradient = ctx.createLinearGradient(0, pad.top, 0, baseline);
    gradient.addColorStop(0, "rgba(137, 207, 240, 0.28)");
    gradient.addColorStop(1, "rgba(137, 207, 240, 0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, baseline);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, baseline);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "#89cff0";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd700";
    ctx.fill();
  }

  /**
   * Updates telemetry labels.
   */
  updateStatsUI() {
    this.recordBitrateSample();

    if (!this.statEls.health) {
      this.updateBitrateChartUI();
      return;
    }

    if (!this.isStreaming) {
      this.statEls.health.text("Offline").elm.className = "stream-stat-value";
      this.statEls.duration.text("00:00");
      this.statEls.bitrate.text("0 kbps");
      this.statEls.fps.text("0 fps");
      this.statEls.drops.text("0");
      this.statEls.data.text("0.0 MB");
      if (this.statEls.viewers) this.statEls.viewers.text("—");
      this.statEls.healthBar.styleJs({ width: "0%", backgroundColor: "#444" });
      this.updateBitrateChartUI();
      return;
    }

    const elapsed = this.streamStartTime
      ? Math.floor((Date.now() - this.streamStartTime) / 1000)
      : 0;
    const mins = Math.floor(elapsed / 60)
      .toString()
      .padStart(2, "0");
    const secs = (elapsed % 60).toString().padStart(2, "0");
    this.statEls.duration.text(`${mins}:${secs}`);

    const s = this.latestStats;
    let health = "excellent";
    if (s && s.health) {
      health = s.health;
    } else if (elapsed < 3) {
      health = "connecting";
    }

    const healthLabels = {
      connecting: "Connecting",
      excellent: "Excellent",
      good: "Good",
      poor: "Poor",
    };

    this.statEls.health.text(
      healthLabels[health] || health.toUpperCase(),
    ).elm.className = `stream-stat-value health-${health}`;

    if (s && s.bitrate && s.bitrate !== "N/A" && s.bitrate !== "0kbits/s") {
      this.statEls.bitrate.text(s.bitrate.replace("kbits/s", " kbps"));
    } else if (this.currentBitrateKbps > 0) {
      this.statEls.bitrate.text(`${this.currentBitrateKbps} kbps`);
    } else {
      this.statEls.bitrate.text(`${Math.round(this.videoBitrate / 1000)} kbps`);
    }

    this.statEls.fps.text(`${s ? Math.round(s.fps) : 30} fps`);
    this.statEls.drops.text(`${s ? s.dropFrames : 0}`);

    const totalBytes = s && s.totalSize > 0 ? s.totalSize : this.totalBytesSent;
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    this.statEls.data.text(`${mb} MB`);

    if (this.statEls.viewers) {
      const viewers = this.twitchLiveInfo?.viewerCount;
      this.statEls.viewers.text(
        typeof viewers === "number" ? String(viewers) : "—",
      );
    }

    const healthConfig = {
      connecting: { width: "40%", color: "#ffd700" },
      excellent: { width: "100%", color: "#55ff55" },
      good: { width: "70%", color: "#ffd700" },
      poor: { width: "30%", color: "#ff5555" },
    }[health] || { width: "50%", color: "#89cff0" };

    this.statEls.healthBar.styleJs({
      width: healthConfig.width,
      backgroundColor: healthConfig.color,
    });

    this.updateBitrateChartUI();
  }

  /**
   * Stops the stream and tears down FFmpeg.
   */
  async stopStream() {
    if (!this.isStreaming) return;

    const destination = this.activeStreamDestination;

    if (this.streamRecorder && this.streamRecorder.state !== "inactive") {
      this.streamRecorder.stop();
      this.streamRecorder = null;
    }

    this.isStreaming = false;
    this.activeStreamDestination = null;
    this.streamStartTime = null;
    this.latestStats = null;
    this.totalBytesSent = 0;
    this.currentBitrateKbps = 0;
    this.stopTwitchLivePoll();
    this.twitchLiveInfo = null;

    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }

    if (this.ctx.modules.recorder) {
      this.ctx.modules.recorder.stopBroadcastStream();
    }

    await window.desktopIntegration.ipc.invoke("stream-stop");

    this.ctx.modules.dialog(
      new Html("div").classOn("temp-dialog-text").text("STREAM STOPPED"),
      2000,
    );
    this.ctx.modules.infoBar.showTemp(
      "STREAM",
      destination === "twitch" ? "Twitch broadcast ended." : "Stream closed.",
      3000,
    );

    if (this.ctx.state.isStreamModalOpen && this.modalView === "live") {
      this.renderLiveView();
    }
  }

  handleKeyDown(e) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;

    if (e.key === "Escape") {
      e.preventDefault();
      if (this.modalView === "live" && !this.isStreaming) {
        this.modalView = "goLiveBitrate";
        this.render();
      } else if (this.modalView === "goLiveBitrate") {
        this.modalView =
          this.goLivePlatform === "twitch" ? "goLiveTwitch" : "goLiveDirect";
        this.render();
      } else if (
        this.modalView === "goLiveTwitch" ||
        this.modalView === "goLiveDirect"
      ) {
        this.modalView = "goLivePlatform";
        this.render();
      } else if (this.modalView !== "selection" && !this.isStreaming) {
        this.modalView = "selection";
        this.render();
      } else {
        this.toggleStreamModal(false);
      }
      return;
    }

    const modalEl = dom.streamContentArea?.elm;
    if (!modalEl) return;

    const isPlaying = state.lastPlaybackStatus === "playing";

    const focusables = Array.from(
      modalEl.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), .session-tile, .stream-bitrate-chip",
      ),
    ).filter((el) => !el.closest("[inert]"));
    if (!focusables.length) return;

    const activeEl = document.activeElement;
    const currentIndex = focusables.indexOf(activeEl);
    const isInput = activeEl && activeEl.tagName === "INPUT";
    const isSelect = activeEl && activeEl.tagName === "SELECT";
    const isCustomClickable =
      activeEl &&
      (activeEl.classList.contains("session-tile") ||
        activeEl.classList.contains("stream-bitrate-chip"));

    if (e.key === "Enter") {
      if (isCustomClickable) {
        e.preventDefault();
        activeEl.click();
      } else if (isInput && activeEl.type === "checkbox") {
        e.preventDefault();
        activeEl.click();
      } else if (isInput) {
        e.preventDefault();
        const primaryBtn = modalEl.querySelector(
          ".session-btn.primary, .session-btn.danger",
        );
        if (primaryBtn) primaryBtn.click();
      }
      return;
    }

    const isTextInput =
      isInput && !["checkbox", "radio", "button"].includes(activeEl.type);
    if (isTextInput && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }

    if (isSelect && ["ArrowUp", "ArrowDown"].includes(e.key)) {
      return;
    }
    if (["ArrowDown", "ArrowRight", "Tab"].includes(e.key)) {
      e.preventDefault();
      if (!isPlaying) this.playNavSfx("nav");
      let nextIndex = currentIndex + 1;
      if (nextIndex >= focusables.length || currentIndex === -1) nextIndex = 0;
      focusables[nextIndex].focus();
    } else if (
      ["ArrowUp", "ArrowLeft"].includes(e.key) ||
      (e.key === "Tab" && e.shiftKey)
    ) {
      e.preventDefault();
      if (!isPlaying) this.playNavSfx("nav");
      let nextIndex = currentIndex - 1;
      if (nextIndex < 0) nextIndex = focusables.length - 1;
      focusables[nextIndex].focus();
    }
  }

  destroy() {
    if (this._streamViewTimer) {
      clearTimeout(this._streamViewTimer);
      this._streamViewTimer = null;
    }
    if (this._twitchCategoryTimer) {
      clearTimeout(this._twitchCategoryTimer);
      this._twitchCategoryTimer = null;
    }
    window.removeEventListener("resize", this._handleStreamResize);
    this._bitrateResizeObserver?.disconnect();
    this.stopTwitchLivePoll();
    if (this.isStreaming) {
      this.stopStream();
    }
  }
}
