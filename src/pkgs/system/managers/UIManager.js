import Html from "../../../libs/html.js";
import NetworkingUtility from "../../../libs/networkingUtility.js";

export default class UIManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    this.ITEM_HEIGHT = 44;
    this.visibleItemsMap = new Map();
    this.bumperImages = [];
    this.currentBumperIndex = 0;
    this.bumperInterval = null;
    this.idlePlaylist = [];
    this.currentIdleIndex = 0;
    this.idleState = "text";
    this.loungeRafId = null;
    this._scrollRafId = null;
    this._menuUpdateRafId = null;
  }

  /**
   * Executes all DOM generation routines.
   */
  buildAll() {
    this.buildUI();
    this.buildPostSongScreen();
    this.buildRecordingsUI();
    this.buildSessionsUI();
    this.buildSessionChatUI();
    this.buildQR();
    this.buildSetupUI();
  }

  buildSetupUI() {
    const dom = this.ctx.dom;
    dom.setupScreen = new Html("div")
      .classOn("setup-screen-wrapper", "hidden")
      .styleJs({
        background: "linear-gradient(135deg, #05050A 0%, #1A1A2E 100%)",
        color: "white",
        fontFamily: "'Rajdhani', sans-serif",
        position: "absolute",
        inset: "0",
        zIndex: "1000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      })
      .appendTo(this.ctx.wrapper);

    dom.setupContainer = new Html("div")
      .classOn("setup-container")
      .appendTo(dom.setupScreen);
  }

  buildUI() {
    const dom = this.ctx.dom;
    const state = this.ctx.state;
    const wrapper = this.ctx.wrapper;

    dom.bgvContainer = new Html("div")
      .classOn("bgv-container")
      .appendTo(wrapper);
    dom.ytContainer = new Html("div")
      .classOn("youtube-player-container", "hidden")
      .appendTo(wrapper);
    dom.ytIframe = new Html("iframe").appendTo(dom.ytContainer);
    dom.overlay = new Html("div").classOn("overlay-ui").appendTo(wrapper);

    // Standby Screen
    dom.standbyScreen = new Html("div")
      .classOn("standby-screen")
      .appendTo(dom.overlay);
    dom.standbyBumper = new Html("img")
      .classOn("standby-bumper-image")
      .appendTo(dom.standbyScreen);
    dom.standbyText = new Html("div")
      .classOn("standby-text")
      .text("SELECT SONG")
      .appendTo(dom.standbyScreen);

    // New Song Screen
    dom.newSongScreen = new Html("div")
      .classOn("new-song-screen", "hidden")
      .appendTo(dom.overlay);
    dom.newSongHeader = new Html("div")
      .classOn("new-song-header")
      .html(`<span class="ns-head-text">NEWLY ADDED SONGS</span>`)
      .appendTo(dom.newSongScreen);
    dom.newSongList = new Html("div")
      .classOn("new-song-list")
      .appendTo(dom.newSongScreen);

    dom.searchUi = new Html("div").classOn("search-ui").appendTo(wrapper);
    dom.playerUi = new Html("div")
      .classOn("player-ui", "hidden")
      .appendTo(wrapper);

    // Shared Top Container & Indicators
    dom.topBarContainer = new Html("div")
      .classOn("top-bar-container")
      .appendTo(wrapper);
    this.buildSystemIndicators();

    dom.formatIndicator = new Html("div")
      .classOn("format-indicator")
      .styleJs({
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
        pointerEvents: "none",
      })
      .appendTo(wrapper);

    dom.calibrationScreen = new Html("div")
      .classOn("calibration-screen")
      .appendTo(wrapper);
    dom.calibTitle = new Html("h1").appendTo(dom.calibrationScreen);
    dom.calibText = new Html("p").appendTo(dom.calibrationScreen);

    // Main Menu / Song List
    dom.mainContent = new Html("div")
      .classOn("main-content")
      .appendTo(dom.overlay);
    new Html("h1").text("Enter Song Number").appendTo(dom.mainContent);
    new Html("br").appendTo(dom.mainContent);
    dom.numberDisplay = new Html("div")
      .classOn("number-display")
      .appendTo(dom.mainContent);

    const songInfo = new Html("div")
      .classOn("song-info")
      .appendTo(dom.mainContent);
    dom.songTitle = new Html("h2").classOn("song-title").appendTo(songInfo);
    dom.songArtist = new Html("p").classOn("song-artist").appendTo(songInfo);

    dom.songListContainer = new Html("div")
      .classOn("song-list-container")
      .appendTo(dom.overlay);
    const listHeader = new Html("div")
      .classOn("song-list-header")
      .appendTo(dom.songListContainer);

    ["CODE", "TITLE", "ARTIST"].forEach((t, i) =>
      new Html("div")
        .classOn(
          i === 0
            ? "song-header-code"
            : i === 1
              ? "song-header-title"
              : "song-header-artist",
        )
        .text(t)
        .appendTo(listHeader),
    );

    dom.listInner = new Html("div")
      .styleJs({ position: "relative", width: "100%" })
      .appendTo(dom.songListContainer);

    dom.songListContainer.on("scroll", () => {
      if (this._scrollRafId) return;
      this._scrollRafId = requestAnimationFrame(() => {
        this._scrollRafId = null;
        this.renderVirtualList();
      });
    });

    // Bottom Actions
    dom.bottomActions = new Html("div")
      .classOn("bottom-actions")
      .appendTo(dom.overlay);
    new Html("div")
      .classOn("action-button")
      .text("Search (Y)")
      .on("click", () => this.setMode("yt-search"))
      .appendTo(dom.bottomActions);
    new Html("div")
      .classOn("action-button")
      .text("Recordings (R)")
      .on("click", () => this.ctx.root.recordings.toggleRecordingsList())
      .appendTo(dom.bottomActions);
    new Html("div")
      .classOn("action-button")
      .text("Mixer (M)")
      .on("click", () => this.ctx.modules.mixer.toggle())
      .appendTo(dom.bottomActions);
    new Html("div")
      .classOn("action-button")
      .text("Sessions (S)")
      .on("click", () => this.ctx.root.sessions.toggleSessionModal())
      .appendTo(dom.bottomActions);

    const vi = this.ctx.root.versionInformation || {
      channel: "Unknown",
      number: "0.0.0",
      codename: "Unknown",
    };
    new Html("div")
      .classOn("version-badge")
      .text(`${vi.channel} v${vi.number} (${vi.codename})`.trim())
      .appendTo(wrapper);

    // Search Window
    dom.searchWindow = new Html("div")
      .classOn("search-window")
      .appendTo(dom.searchUi);
    dom.searchInput = new Html("input")
      .classOn("search-input")
      .attr({ type: "text", placeholder: "Type here to search..." })
      .appendTo(dom.searchWindow);
    dom.searchResultsContainer = new Html("div")
      .classOn("search-results-container")
      .appendTo(dom.searchWindow);

    dom.searchInput.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.ctx.root.library.performSearch(dom.searchInput.getValue());
      }
    });

    // Intro Card
    dom.introCard = new Html("div").classOn("intro-card").appendTo(wrapper);
    const introContent = new Html("div")
      .classOn("intro-card-content")
      .appendTo(dom.introCard);
    dom.introTitle = new Html("div")
      .classOn("intro-card-title")
      .appendTo(introContent);
    dom.introArtist = new Html("div")
      .classOn("intro-card-artist")
      .appendTo(introContent);
    dom.introMeta = new Html("div")
      .classOn("intro-card-meta")
      .appendTo(introContent);

    // Interlude
    dom.interludeOverlay = new Html("div")
      .classOn("interlude-overlay")
      .appendTo(wrapper);
    new Html("div")
      .classOn("interlude-text")
      .text("INTERLUDE")
      .appendTo(dom.interludeOverlay);
    dom.interludeTipBox = new Html("div")
      .classOn("interlude-tip-box")
      .appendTo(dom.interludeOverlay);

    // Player Bottom Section
    const bottom = new Html("div")
      .classOn("player-bottom-section")
      .appendTo(dom.playerUi);
    dom.countdownDisplay = new Html("div")
      .classOn("countdown-display")
      .appendTo(bottom);
    dom.lyricsCanvas = new Html("canvas")
      .classOn("lyrics-render-surface")
      .appendTo(bottom);
    dom.danmakuCanvas = new Html("canvas")
      .classOn("danmaku-surface")
      .appendTo(wrapper);

    // Session Remote Video
    dom.sessionRemoteContainer = new Html("div")
      .classOn("session-remote-container", "hidden")
      .styleJs({ position: "absolute", inset: "0", zIndex: "1" })
      .appendTo(wrapper);
    dom.sessionRemoteVideo = new Html("video")
      .attr({ autoplay: true, playsInline: true })
      .styleJs({
        width: "100%",
        height: "100%",
        objectFit: "contain",
        background: "#000",
      })
      .appendTo(dom.sessionRemoteContainer);
  }

  buildSystemIndicators() {
    const dom = this.ctx.dom;
    dom.systemIndicators = new Html("div")
      .classOn("system-indicators")
      .appendTo(dom.topBarContainer);

    dom.networkIcon = new Html("ion-icon")
      .attr({ name: "wifi" })
      .appendTo(dom.systemIndicators);

    dom.batteryDisplay = new Html("div")
      .classOn("battery-display")
      .appendTo(dom.systemIndicators);
    dom.batteryIcon = new Html("ion-icon")
      .attr({ name: "battery-full" })
      .appendTo(dom.batteryDisplay);
    dom.batteryText = new Html("span")
      .classOn("battery-text")
      .appendTo(dom.batteryDisplay);

    const updateNetwork = () => {
      if (navigator.onLine) {
        dom.networkIcon.attr({ name: "wifi" });
        dom.networkIcon.styleJs({ color: "#89cff0" });
        this.ctx.wrapper.classOff("is-offline");
      } else {
        dom.networkIcon.attr({ name: "cloud-offline" });
        dom.networkIcon.styleJs({ color: "#ff5555" });
        this.ctx.wrapper.classOn("is-offline");
      }
    };

    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    updateNetwork();

    if ("getBattery" in navigator) {
      navigator.getBattery().then((battery) => {
        this.ctx.state.battery = battery;

        const updateBattery = () => {
          const level = Math.round(battery.level * 100);
          const charging = battery.charging;

          dom.batteryText.text(`${level}%`);

          if (charging) {
            dom.batteryIcon.attr({ name: "battery-charging" });
            dom.batteryIcon.styleJs({ color: "#55ff55" });
          } else {
            if (level > 80) dom.batteryIcon.attr({ name: "battery-full" });
            else if (level > 40) dom.batteryIcon.attr({ name: "battery-half" });
            else dom.batteryIcon.attr({ name: "battery-dead" });

            if (level <= 20) dom.batteryIcon.styleJs({ color: "#ff5555" });
            else dom.batteryIcon.styleJs({ color: "white" });
          }

          if (charging && battery.level >= 1) {
            dom.batteryDisplay.classOn("hidden");
          } else {
            dom.batteryDisplay.classOff("hidden");
          }
        };

        battery.addEventListener("chargingchange", updateBattery);
        battery.addEventListener("levelchange", updateBattery);
        updateBattery();
      });
    } else {
      dom.batteryDisplay.classOn("hidden");
    }
  }

  buildPostSongScreen() {
    const dom = this.ctx.dom;
    dom.postSongScreen = new Html("div")
      .classOn("post-song-screen-overlay")
      .appendTo(this.ctx.wrapper);
    dom.scoreTitleText = new Html("div")
      .classOn("score-title-text")
      .text("YOUR SCORE")
      .appendTo(dom.postSongScreen);

    const mainGroup = new Html("div")
      .classOn("score-main-group")
      .appendTo(dom.postSongScreen);
    dom.finalScoreDisplay = new Html("div")
      .classOn("score-display-number")
      .text("00")
      .appendTo(mainGroup);
    dom.rankDisplay = new Html("div")
      .classOn("rank-display-text")
      .text("")
      .appendTo(mainGroup);

    dom.scoreSessionLeaderboard = new Html("div")
      .classOn("score-session-leaderboard", "hidden")
      .appendTo(dom.postSongScreen);
    new Html("div")
      .classOn("score-skip-hint")
      .text("PRESS ENTER TO CONTINUE")
      .appendTo(dom.postSongScreen);
  }

  buildRecordingsUI() {
    const dom = this.ctx.dom;
    dom.recordingsScreen = new Html("div")
      .classOn("recordings-modal", "hidden")
      .appendTo(this.ctx.wrapper);
    dom.recordingsScreen.on("click", (e) => {
      if (e.target === dom.recordingsScreen.elm)
        this.ctx.root.recordings.toggleRecordingsList(false);
    });

    const recContent = new Html("div")
      .classOn("recordings-content")
      .appendTo(dom.recordingsScreen);
    const recHeader = new Html("div")
      .styleJs({
        padding: "1rem 1.5rem",
        borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
        flexShrink: "0",
      })
      .appendTo(recContent);
    new Html("h1")
      .text("RECORDING SESSIONS")
      .styleJs({
        margin: "0",
        fontSize: "1.8rem",
        letterSpacing: "0.1em",
        color: "#89cff0",
      })
      .appendTo(recHeader);
    new Html("p")
      .text("Navigate: Arrows | Play: Enter | Delete: Del | Close: ESC")
      .styleJs({
        margin: "0.25rem 0 0 0",
        color: "#89cff0",
        fontWeight: "600",
        fontSize: "1rem",
        opacity: "0.6",
      })
      .appendTo(recHeader);

    dom.recordingsList = new Html("div")
      .classOn("recordings-list")
      .appendTo(recContent);

    // Delete Prompt
    dom.recDeleteOverlay = new Html("div")
      .classOn("rec-delete-overlay", "hidden")
      .appendTo(dom.recordingsScreen);
    dom.recDeleteOverlay.on("click", (e) => {
      if (e.target === dom.recDeleteOverlay.elm)
        this.ctx.root.recordings.cancelDeletePrompt();
    });

    const deleteBox = new Html("div")
      .classOn("rec-delete-box")
      .appendTo(dom.recDeleteOverlay);
    new Html("h2").text("DELETE RECORDING?").appendTo(deleteBox);
    dom.recDeleteText = new Html("p").appendTo(deleteBox);

    const btnRow = new Html("div")
      .styleJs({
        display: "flex",
        justifyContent: "center",
        gap: "1rem",
        marginTop: "1rem",
      })
      .appendTo(deleteBox);
    new Html("button")
      .text("CANCEL")
      .on("click", () => this.ctx.root.recordings.cancelDeletePrompt())
      .appendTo(btnRow);
    new Html("button")
      .classOn("negative")
      .text("DELETE")
      .on("click", () => this.ctx.root.recordings.confirmDeleteRecording())
      .appendTo(btnRow);
    new Html("p")
      .text("Confirm: Enter | Cancel: ESC")
      .styleJs({
        margin: "1.5rem 0 0 0",
        color: "#ff5555",
        fontWeight: "600",
        fontSize: "1rem",
        opacity: "0.6",
      })
      .appendTo(deleteBox);

    // Player Overlay
    dom.recPlayerOverlay = new Html("div")
      .classOn("rec-player-overlay", "hidden")
      .appendTo(this.ctx.wrapper);
    dom.recPlayerOverlay.on("click", (e) => {
      if (e.target === dom.recPlayerOverlay.elm)
        this.ctx.root.recordings.closeRecordingPlayer();
    });

    dom.recVideoPlayer = new Html("video")
      .classOn("rec-video-element")
      .appendTo(dom.recPlayerOverlay);
    dom.recVideoPlayer.on("click", () => {
      const v = dom.recVideoPlayer.elm;
      v.paused ? v.play() : v.pause();
    });

    dom.recVideoOsd = new Html("div")
      .classOn("rec-video-osd")
      .appendTo(dom.recPlayerOverlay);
    dom.recVideoTitle = new Html("div")
      .classOn("rec-video-title")
      .appendTo(dom.recVideoOsd);
    const progressWrapper = new Html("div")
      .classOn("rec-progress-wrapper")
      .appendTo(dom.recVideoOsd);
    const progressBar = new Html("div")
      .classOn("rec-progress-bar")
      .appendTo(progressWrapper);
    dom.recVideoProgressFill = new Html("div")
      .classOn("rec-progress-fill")
      .appendTo(progressBar);
    const osdBottom = new Html("div")
      .classOn("rec-osd-bottom")
      .appendTo(dom.recVideoOsd);
    dom.recVideoTime = new Html("div")
      .classOn("rec-video-time")
      .text("00:00 / 00:00")
      .appendTo(osdBottom);
    new Html("div")
      .text("Play/Pause: Space | Seek: ←/→ | Vol: -/= | Close: ESC")
      .styleJs({
        color: "#ffd700",
        fontWeight: "600",
        fontSize: "1rem",
        opacity: "0.6",
      })
      .appendTo(osdBottom);

    dom.recVideoPlayer.on("timeupdate", () => {
      const curr = dom.recVideoPlayer.elm.currentTime;
      const tot = dom.recVideoPlayer.elm.duration || 1;
      dom.recVideoProgressFill.styleJs({ width: `${(curr / tot) * 100}%` });

      const formatTime = (secs) => {
        if (isNaN(secs)) return "00:00";
        const m = Math.floor(secs / 60)
          .toString()
          .padStart(2, "0");
        const s = Math.floor(secs % 60)
          .toString()
          .padStart(2, "0");
        return `${m}:${s}`;
      };
      dom.recVideoTime.text(`${formatTime(curr)} / ${formatTime(tot)}`);
    });

    dom.recVideoPlayer.on("ended", () =>
      this.ctx.root.recordings.closeRecordingPlayer(),
    );
  }

  buildSessionsUI() {
    const dom = this.ctx.dom;
    dom.sessionModal = new Html("div")
      .classOn("session-modal", "hidden")
      .appendTo(this.ctx.wrapper);
    dom.sessionModal.on("click", (e) => {
      if (e.target === dom.sessionModal.elm)
        this.ctx.root.sessions.toggleSessionModal(false);
    });

    dom.sessionBox = new Html("div")
      .classOn("session-box")
      .appendTo(dom.sessionModal);
    dom.sessionHeader = new Html("div")
      .classOn("session-header")
      .appendTo(dom.sessionBox);
    dom.sessionContentArea = new Html("div")
      .classOn("session-content-area")
      .appendTo(dom.sessionBox);
  }

  buildSessionChatUI() {
    const dom = this.ctx.dom;
    dom.sessionChatContainer = new Html("div")
      .classOn("session-chat-container", "hidden")
      .appendTo(this.ctx.wrapper);
    dom.sessionChatMessages = new Html("div")
      .classOn("session-chat-messages")
      .appendTo(dom.sessionChatContainer);
    dom.sessionChatInputContainer = new Html("div")
      .classOn("session-chat-input-container")
      .appendTo(dom.sessionChatContainer);

    dom.sessionChatMode = new Html("div")
      .classOn("session-chat-mode", "mode-chat")
      .text("CHAT")
      .appendTo(dom.sessionChatInputContainer)
      .on("click", (e) => {
        e.stopPropagation();
        this.ctx.state.chatInputMode =
          this.ctx.state.chatInputMode === "chat" ? "cheer" : "chat";
        dom.sessionChatMode.text(
          this.ctx.state.chatInputMode === "chat" ? "CHAT" : "CHEER",
        );
        dom.sessionChatMode.elm.className = `session-chat-mode mode-${this.ctx.state.chatInputMode}`;
        dom.sessionChatInput.elm.focus();
      });

    dom.sessionChatInput = new Html("input")
      .classOn("session-chat-input")
      .attr({ type: "text", placeholder: "Press 'Tab' to cheer/chat" })
      .appendTo(dom.sessionChatInputContainer);
    this.ctx.state.chatInputMode = "chat";

    dom.sessionChatInput.on("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.ctx.root.sessions.submitSessionChat();
      } else if (e.key === "Escape") {
        e.preventDefault();
        dom.sessionChatInput.elm.blur();
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.ctx.state.chatInputMode =
          this.ctx.state.chatInputMode === "chat" ? "cheer" : "chat";
        dom.sessionChatMode.text(
          this.ctx.state.chatInputMode === "chat" ? "CHAT" : "CHEER",
        );
        dom.sessionChatMode.elm.className = `session-chat-mode mode-${this.ctx.state.chatInputMode}`;
      }
    });

    dom.sessionChatInput.on("focus", () =>
      dom.sessionChatContainer.classOn("focused"),
    );
    dom.sessionChatInput.on("blur", () => {
      dom.sessionChatContainer.classOff("focused");
      dom.sessionChatInput.elm.value = "";
    });
  }

  buildQR() {
    const dom = this.ctx.dom;
    dom.qrContainer = new Html("div")
      .classOn("qr-code-container")
      .appendTo(this.ctx.wrapper);

    const counterBadge = new Html("div")
      .classOn("qr-counter-badge")
      .appendTo(dom.qrContainer);
    counterBadge.html(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`,
    );
    dom.qrConnectedCount = new Html("span").text("0").appendTo(counterBadge);

    const imgWrapper = new Html("div")
      .classOn("qr-image-wrapper")
      .appendTo(dom.qrContainer);
    const img = new Html("img").appendTo(imgWrapper);

    fetch(`http://127.0.0.1:${this.ctx.state.actualPort}/cloud_info`)
      .then((r) => r.json())
      .then((info) => {
        if (!info.roomCode) {
          fetch(`http://127.0.0.1:${this.ctx.state.actualPort}/local_ip`)
            .then((r) => r.text())
            .then((ip) => {
              const remoteUrl = `http://${ip}:${this.ctx.state.actualPort}/remote`;
              img.attr({
                src: `http://127.0.0.1:${this.ctx.state.actualPort}/qr?url=${encodeURIComponent(remoteUrl)}`,
              });
            })
            .catch((e) => dom.qrContainer.classOn("hidden"));
          return;
        }
        const remoteUrl = `${info.relayUrl}/?room=${info.roomCode}`;
        img.attr({
          src: `http://127.0.0.1:${this.ctx.state.actualPort}/qr?url=${encodeURIComponent(remoteUrl)}`,
        });
      })
      .catch((e) => dom.qrContainer.classOn("hidden"));

    this.ctx.root.network.updateRemoteCount();
  }

  setMode(newMode) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const wrapper = this.ctx.wrapper;

    state.mode = newMode;
    wrapper.classOff(
      "mode-menu",
      "mode-player",
      "mode-yt-search",
      "mode-player-youtube",
      "mode-setup",
    );
    wrapper.classOn(`mode-${newMode}`);

    dom.overlay.classOn("hidden");
    dom.playerUi.classOn("hidden");
    if (dom.setupScreen) dom.setupScreen.classOn("hidden");

    if (state.isSearchOverlayVisible) this.toggleSearchOverlay(false);

    if (
      newMode !== "yt-search" &&
      this.ctx.root.library.ytSearchAbortController
    ) {
      this.ctx.root.library.ytSearchAbortController.abort();
      this.ctx.root.library.ytSearchAbortController = null;
    }

    if (newMode === "setup") {
      dom.setupScreen.classOff("hidden");
      this.ctx.root.setup.open();
    } else if (newMode === "menu") {
      state.showSongList = false;
      dom.overlay.classOff("hidden");
      dom.searchInput.elm.blur();
      this.ctx.modules.infoBar.hideBar();
      this.updateMenuUI();
      setTimeout(() => {
        if (state.scoreSkipped) state.scoreSkipped = false;
      }, 5000);
    } else if (newMode === "player") {
      dom.playerUi.classOff("hidden");
      this.ctx.modules.infoBar.showDefault();
    } else if (newMode === "yt-search") {
      if (state.currentSongIsMultiplexed)
        this.ctx.services.Forte.togglePianoRollVisibility(false);
      dom.searchInput.elm.focus();
      dom.searchInput.elm.select();
    }
  }

  updateMenuUI(preventScroll = false) {
    this._pendingPreventScroll = preventScroll;
    if (this._menuUpdateRafId) return;

    this._menuUpdateRafId = requestAnimationFrame(() => {
      this._menuUpdateRafId = null;
      const state = this.ctx.state;
      const dom = this.ctx.dom;

      if (state.mode !== "menu") return;

      const currentPreventScroll = this._pendingPreventScroll;
      const isIdling =
        !state.showSongList && !state.isTypingNumber && state.mode === "menu";

      if (isIdling) {
        if (this.idleState === "newsong") {
          dom.standbyScreen.classOn("hidden");
          dom.newSongScreen.classOff("hidden");
          dom.newSongScreen.styleJs({ opacity: 1 });
        } else if (this.idleState === "bumper") {
          dom.newSongScreen.classOn("hidden");
          dom.standbyScreen.classOff("hidden");
          dom.standbyBumper.styleJs({ opacity: 1 });
        } else {
          dom.newSongScreen.classOn("hidden");
          dom.standbyScreen.classOff("hidden");
          dom.standbyBumper.classOn("hidden");
          dom.standbyText.classOff("hidden");
        }

        dom.mainContent.classOn("hidden");
        dom.songListContainer.classOn("hidden");
        dom.bottomActions.classOn("hidden");
        dom.numberDisplay.text("");
        dom.songTitle.text("");
        dom.songArtist.text("");
        return;
      }

      dom.standbyScreen.classOn("hidden");
      dom.newSongScreen.classOn("hidden");
      dom.standbyBumper.styleJs({ opacity: 0 });
      dom.newSongScreen.styleJs({ opacity: 0 });

      dom.mainContent.classOff("hidden");
      dom.songListContainer.classOff("hidden");
      dom.bottomActions.classOff("hidden");
      this.ctx.wrapper[state.isTypingNumber ? "classOn" : "classOff"](
        "is-typing",
      );

      const code = state.songNumber.padStart(5, "0");
      let activeSong =
        state.songNumber.length > 0
          ? state.songMap.get(code)
          : state.highlightedIndex >= 0
            ? state.songList[state.highlightedIndex]
            : null;

      dom.numberDisplay.text(
        state.songNumber.length > 0 ? code : activeSong ? activeSong.code : "",
      );
      dom.numberDisplay[activeSong ? "classOn" : "classOff"]("active");
      dom.songTitle.clear();

      if (activeSong) {
        const fmt = this.ctx.root.library.getFormatInfo(activeSong);
        new Html("span")
          .classOn("format-badge")
          .text(fmt.label)
          .styleJs({
            backgroundColor: fmt.color,
            fontSize: "0.5em",
            fontFamily: "Rajdhani",
            verticalAlign: "middle",
            marginRight: "1rem",
            transform: "translateY(-0.1rem)",
            display: "inline-block",
            paddingLeft: "0.5em",
            paddingRight: "0.5em",
          })
          .appendTo(dom.songTitle);
        new Html("span")
          .text(activeSong.title)
          .styleJs({ verticalAlign: "middle" })
          .appendTo(dom.songTitle);
      } else if (state.songNumber.length === 5) {
        dom.songTitle.text("Song Not Found");
      }
      dom.songArtist.text(activeSong ? activeSong.artist : "");

      if (state.showSongList) {
        if (
          !currentPreventScroll &&
          !state.isTypingNumber &&
          state.highlightedIndex >= 0
        ) {
          const itemTop = state.highlightedIndex * this.ITEM_HEIGHT;
          const itemBottom = itemTop + this.ITEM_HEIGHT;
          const container = dom.songListContainer.elm;
          const innerOffset = dom.listInner.elm.offsetTop;
          const actualItemTop = itemTop + innerOffset;
          const actualItemBottom = itemBottom + innerOffset;
          const viewTop = container.scrollTop;
          const viewBottom = viewTop + container.clientHeight;
          const headerSafeZone = 40;
          const bottomPadding = 24;

          if (state.highlightedIndex === 0) {
            container.scrollTop = 0;
          } else if (actualItemTop < viewTop + headerSafeZone) {
            container.scrollTop = actualItemTop - headerSafeZone;
          } else if (actualItemBottom > viewBottom - bottomPadding) {
            container.scrollTop =
              actualItemBottom - container.clientHeight + bottomPadding;
          }
        }

        dom.listInner.styleJs({
          height: `${state.songList.length * this.ITEM_HEIGHT}px`,
        });
        this.renderVirtualList();

        for (const [idx, item] of this.visibleItemsMap.entries()) {
          item[idx === state.highlightedIndex ? "classOn" : "classOff"](
            "highlighted",
          );
        }
      }
    });
  }

  renderVirtualList() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    if (state.mode !== "menu" || !state.showSongList) return;

    const scrollTop = dom.songListContainer.elm.scrollTop;
    const viewportHeight = dom.songListContainer.elm.clientHeight;

    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / this.ITEM_HEIGHT) - 5,
    );
    const endIndex = Math.min(
      state.songList.length - 1,
      Math.ceil((scrollTop + viewportHeight) / this.ITEM_HEIGHT) + 5,
    );

    for (const [index, itemEl] of this.visibleItemsMap.entries()) {
      if (index < startIndex || index > endIndex) {
        itemEl.cleanup();
        this.visibleItemsMap.delete(index);
      }
    }

    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.visibleItemsMap.has(i)) {
        const song = state.songList[i];
        const item = new Html("div").classOn("song-item").styleJs({
          position: "absolute",
          top: `${i * this.ITEM_HEIGHT}px`,
          left: "0",
          right: "0",
          height: `${this.ITEM_HEIGHT}px`,
        });

        new Html("div")
          .classOn("song-item-code")
          .text(song.code)
          .appendTo(item);
        const fmt = this.ctx.root.library.getFormatInfo(song);
        const titleContainer = new Html("div")
          .classOn("song-item-title")
          .appendTo(item);

        new Html("span")
          .classOn("format-badge")
          .text(fmt.label)
          .styleJs({ backgroundColor: fmt.color })
          .appendTo(titleContainer);
        new Html("span")
          .text(song.title)
          .classOn("song-title-text")
          .appendTo(titleContainer);
        new Html("div")
          .classOn("song-item-artist")
          .text(song.artist)
          .appendTo(item);

        item.on("click", () => {
          if (state.isSessionActive)
            this.ctx.root.sessions.reserveSongInSession(song);
          else this.ctx.root.playback.startPlayer(song);
        });
        if (i === state.highlightedIndex) item.classOn("highlighted");

        item.appendTo(dom.listInner);
        this.visibleItemsMap.set(i, item);
      }
    }
  }

  toggleSearchOverlay(visible) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const wrapper = this.ctx.wrapper;

    if (state.currentSongIsMultiplexed)
      this.ctx.services.Forte.togglePianoRollVisibility(!visible);
    state.isSearchOverlayVisible = visible;

    if (visible) {
      wrapper.classOn("search-overlay-active");
      if (state.mode === "player") wrapper.classOn("in-game-search-active");

      state.highlightedSearchIndex = -1;
      if (state.searchResults.length > 0) {
        dom.searchWindow.classOn("has-results");
        this.updateSearchHighlight();
      }
      dom.searchInput.elm.focus();
      dom.searchInput.elm.select();
    } else {
      state.highlightedSearchIndex = -1;
      wrapper.classOff("search-overlay-active", "in-game-search-active");
      dom.searchWindow.classOff("has-results");
      dom.searchInput.elm.blur();
      if (state.mode === "player") this.ctx.modules.infoBar.showDefault();
    }
  }

  renderSearchResults() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const prevHighlight = state.highlightedSearchIndex;

    dom.searchResultsContainer.clear();
    state.highlightedSearchIndex = prevHighlight;

    if (!state.searchResults.length) {
      dom.searchResultsContainer.text(
        state.isSearching ? "Searching..." : "No results found.",
      );
      dom.searchWindow.classOff("has-results");
      state.highlightedSearchIndex = -1;
      return;
    }

    dom.searchWindow.classOn("has-results");

    state.searchResults.forEach((res, idx) => {
      const item = new Html("div")
        .classOn("search-result-item")
        .appendTo(dom.searchResultsContainer);
      item.on("click", () => {
        state.highlightedSearchIndex = idx;
        this.ctx.root.input.handleEnter();
      });

      const info = new Html("div").classOn("search-info").appendTo(item);
      const fmt = this.ctx.root.library.getFormatInfo(res);

      if (res.type === "local") {
        new Html("div")
          .classOn("search-result-local-code")
          .text(res.code)
          .appendTo(item);
        const titleRow = new Html("div").classOn("search-title").appendTo(info);
        new Html("span")
          .classOn("format-badge")
          .text(fmt.label)
          .styleJs({ backgroundColor: fmt.color })
          .appendTo(titleRow);
        new Html("span").text(res.title).appendTo(titleRow);

        if (res.displayRomaTitle)
          new Html("span")
            .text(` (${res.displayRomaTitle})`)
            .styleJs({ color: "#aaa", fontSize: "0.9em", marginLeft: "0.5rem" })
            .appendTo(titleRow);

        const artistRow = new Html("div")
          .classOn("search-channel")
          .appendTo(info);
        new Html("span").text(res.artist).appendTo(artistRow);
        if (res.displayRomaArtist)
          new Html("span")
            .text(` (${res.displayRomaArtist})`)
            .styleJs({ color: "#aaa", fontSize: "0.9em", marginLeft: "0.5rem" })
            .appendTo(artistRow);
      } else {
        const thumb = new Html("div")
          .classOn("search-thumbnail-wrapper")
          .appendTo(item);
        const img = new Html("img")
          .classOn("search-thumbnail")
          .styleJs({ opacity: "0", transition: "opacity 0.3s ease" })
          .appendTo(thumb);
        img.elm.onload = () => img.styleJs({ opacity: "1" });
        img.attr({
          src:
            res.thumbnail?.thumbnails?.[0]?.url ||
            `https://img.youtube.com/vi/${res.id}/mqdefault.jpg`,
        });

        if (res.length?.simpleText)
          new Html("span")
            .classOn("search-duration")
            .text(res.length.simpleText)
            .appendTo(thumb);

        const titleC = new Html("div")
          .styleJs({ display: "flex", alignItems: "center" })
          .appendTo(info);
        new Html("span")
          .classOn("format-badge")
          .text(fmt.label)
          .styleJs({ backgroundColor: fmt.color })
          .appendTo(titleC);
        new Html("div")
          .classOn("search-title")
          .text(res.title)
          .appendTo(titleC);
        new Html("div")
          .classOn("search-channel")
          .text(res.channelTitle)
          .appendTo(info);
      }
    });

    if (state.highlightedSearchIndex >= state.searchResults.length)
      state.highlightedSearchIndex = -1;
    this.updateSearchHighlight();
  }

  updateSearchHighlight() {
    this.ctx.dom.searchResultsContainer
      .qsa(".search-result-item")
      .forEach((item, idx) => {
        item[
          idx === this.ctx.state.highlightedSearchIndex ? "classOn" : "classOff"
        ]("highlighted");
        if (idx === this.ctx.state.highlightedSearchIndex)
          item.elm.scrollIntoView({ block: "nearest" });
      });
  }

  startBumperCycle() {
    if (this.bumperInterval) clearInterval(this.bumperInterval);
    this.idlePlaylist = [];
    const libraryInfo = this.ctx.root.library.libraryInfo;

    const bumperPaths = libraryInfo?.manifest?.additionalContents?.bumperImages;
    if (bumperPaths && bumperPaths.length > 0) {
      const joinPath = (p1, p2) =>
        p1.replace(/\/$/, "") + "/" + p2.replace(/^\//, "");
      this.bumperImages = bumperPaths.map((p) => joinPath(libraryInfo.path, p));
    }

    if (this.bumperImages.length > 0) {
      this.bumperImages.forEach((imgPath) =>
        this.idlePlaylist.push({ type: "bumper", data: imgPath }),
      );
    }

    if (this.ctx.state.newSongsList.length > 0) {
      for (let i = 0; i < this.ctx.state.newSongsList.length; i += 8) {
        this.idlePlaylist.push({
          type: "newsong",
          data: this.ctx.state.newSongsList.slice(i, i + 8),
        });
      }
    }

    if (this.idlePlaylist.length === 0) {
      this.idleState = "text";
      this.ctx.dom.standbyBumper.classOn("hidden");
      this.ctx.dom.standbyText.classOff("hidden");
      this.ctx.dom.standbyScreen.classOff("has-bumper-image");
      this.ctx.dom.newSongScreen.classOn("hidden");
      return;
    }

    this.ctx.dom.standbyText.classOn("hidden");
    this.currentIdleIndex = -1;

    const cycle = () => {
      this.currentIdleIndex =
        (this.currentIdleIndex + 1) % this.idlePlaylist.length;
      const currentItem = this.idlePlaylist[this.currentIdleIndex];

      this.ctx.dom.standbyBumper.styleJs({ opacity: 0 });
      this.ctx.dom.newSongScreen.styleJs({ opacity: 0 });

      setTimeout(async () => {
        this.idleState = currentItem.type;
        const state = this.ctx.state;
        const dom = this.ctx.dom;
        const isIdling =
          !state.showSongList && !state.isTypingNumber && state.mode === "menu";

        if (currentItem.type === "newsong") {
          dom.newSongList.clear();
          currentItem.data.forEach((song, idx) => {
            const row = new Html("div")
              .classOn("ns-row")
              .appendTo(dom.newSongList);
            row.styleJs({ animationDelay: `${idx * 0.08}s` });
            const fmt = this.ctx.root.library.getFormatInfo(song);

            new Html("div").classOn("ns-code").text(song.code).appendTo(row);
            const titleCol = new Html("div")
              .classOn("ns-title-col")
              .appendTo(row);
            new Html("span")
              .classOn("format-badge")
              .styleJs({ backgroundColor: fmt.color })
              .text(fmt.label)
              .appendTo(titleCol);
            new Html("span")
              .classOn("ns-title")
              .text(song.title)
              .appendTo(titleCol);
            new Html("div")
              .classOn("ns-artist")
              .text(song.artist)
              .appendTo(row);
          });

          if (isIdling) {
            dom.standbyScreen.classOn("hidden");
            dom.newSongScreen.classOff("hidden");
            dom.newSongScreen.styleJs({ opacity: 1 });
          }
        } else if (currentItem.type === "bumper") {
          const imageUrl = await NetworkingUtility.getFileLink(
            currentItem.data,
          );
          dom.standbyBumper.attr({ src: imageUrl.href });

          if (isIdling) {
            dom.newSongScreen.classOn("hidden");
            dom.standbyScreen.classOff("hidden");
            dom.standbyBumper.classOff("hidden");
            dom.standbyScreen.classOn("has-bumper-image");
            dom.standbyText.classOn("hidden");
            dom.standbyBumper.styleJs({ opacity: 1 });
          }
        }
      }, 500);
    };
    cycle();
    this.bumperInterval = setInterval(cycle, 12000);
  }

  startLoungeBackground() {
    if (this.loungeRafId) return;
    this.ctx.modules.bgv.setCanvasOnlyMode(true);

    const ctx = this.ctx.modules.bgv.getCustomContext();
    const canvas = this.ctx.modules.bgv.getCustomCanvas();
    this.ctx.dom.bgvContainer.classOff("hidden");

    let time = 0;
    const particles = Array.from({ length: 50 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 4 + 1,
      speedY: Math.random() * 0.5 + 0.1,
      speedX: (Math.random() - 0.5) * 0.2,
    }));

    const draw = () => {
      if (
        !this.ctx.state.isSessionActive ||
        this.ctx.state.sessionMode !== "lounge"
      ) {
        this.stopLoungeBackground();
        return;
      }

      if (this.ctx.modules.bgv.selectedCategory === "Off") {
        this.ctx.modules.bgv.clearCustomGraphics();
        this.loungeRafId = requestAnimationFrame(draw);
        return;
      }

      time += 0.02;
      const w = canvas.width,
        h = canvas.height;
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, "#0a0a14");
      bgGrad.addColorStop(1, "#1a1a3a");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(137, 207, 240, ${0.1 + i * 0.1})`;
        for (let x = 0; x < w; x += 10) {
          const y =
            h / 2 +
            Math.sin(x * 0.005 + time + i) * 100 * Math.sin(time * 0.5 + i);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255, 215, 0, 0.6)";
      particles.forEach((p) => {
        p.y -= p.speedY * 0.005;
        p.x += p.speedX * 0.005;
        if (p.y < 0) p.y = 1;
        if (p.x < 0) p.x = 1;
        if (p.x > 1) p.x = 0;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.size, 0, Math.PI * 2);
        ctx.fill();
      });

      this.loungeRafId = requestAnimationFrame(draw);
    };
    this.loungeRafId = requestAnimationFrame(draw);
  }

  stopLoungeBackground() {
    if (this.loungeRafId) {
      cancelAnimationFrame(this.loungeRafId);
      this.loungeRafId = null;
    }
    this.ctx.modules.bgv.clearCustomGraphics();
    if (this.ctx.modules.bgv.canvasOnlyMode)
      this.ctx.modules.bgv.setCanvasOnlyMode(false);
    if (!this.ctx.state.isSessionActive)
      this.ctx.dom.standbyText.text("SELECT SONG");
    this.ctx.dom.standbyScreen.classOn("hidden").styleJs({ opacity: "" });
    this.ctx.dom.standbyBumper.classOn("hidden").styleJs({ opacity: "" });
  }
}
