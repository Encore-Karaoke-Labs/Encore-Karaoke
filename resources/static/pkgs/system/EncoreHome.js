import Html from "/libs/html.js";
import Romanizer from "/modules/Romanizer.js";
import generateDialog from "/modules/Dialog.js";
import { MixerModule } from "/modules/Mixer.js";
import { BGVModule } from "/modules/BGVPlayer.js";
import { RecorderModule } from "/modules/Recorder.js";
import { InfoBarModule } from "/modules/InfoBar.js";
import { ScoreHUDModule } from "/modules/ScoreHUD.js";

// Source - https://stackoverflow.com/a
// Posted by anneb, modified by community. See post 'Timeline' for change history
// Retrieved 2025-12-22, License - CC BY-SA 4.0

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

class EncoreController {
  constructor(Root, config) {
    console.log("CONFIG", config);
    console.log("test", config.audioConfig.mix.instrumental.volume);
    this.Root = Root;
    this.Pid = Root.Pid;
    this.Ui = Root.Processes.getService("UiLib").data;
    this.FsSvc = Root.Processes.getService("FsSvc").data;
    this.Forte = Root.Processes.getService("ForteSvc").data;
    this.config = config;

    // --- State Management ---
    this.songList = [];
    this.songMap = new Map();
    this.libraryInfo = this.FsSvc.getLibraryInfo();

    this.state = {
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
      currentSongIsMV: false,
      isTransitioning: false,
      isTypingNumber: false,
      lastPlaybackStatus: null,
      isScoreScreenActive: false,
      scoreSkipResolver: null,
      showSongList: false,
    };

    this.bumperImages = [];
    this.currentBumperIndex = 0;
    this.bumperInterval = null;

    console.log(this.state);

    // --- Instantiate Modules ---
    this.mixer = new MixerModule(this.Forte);
    this.bgv = new BGVModule();
    this.scoreHud = new ScoreHUDModule();
    this.infoBar = new InfoBarModule(
      () => ({
        reservationQueue: this.state.reservationQueue,
        songMap: this.songMap,
      }),
      () => (this.recorder ? this.recorder.isRecording : false),
      (s) => this.getFormatInfo(s), // Pass format helper to InfoBar
    );
    this.recorder = new RecorderModule(
      this.Forte,
      this.bgv,
      this.infoBar,
      generateDialog,
    );

    // --- Event Handlers (Bound) ---
    this.boundKeydown = this.handleKeyDown.bind(this);
    this.boundPlaybackUpdate = this.handlePlaybackUpdate.bind(this);
    this.boundTimeUpdate = null;
    this.boundLyricEvent = null;
    this.boundScoreUpdate = null;

    // Timers & Playback Variables
    this.countdownTimers = [];
    this.nextLineUpdateTimeout = null;
    this.countdownTargetTime = null;
    this.lastCountdownTick = null;
    this.parsedLrc = [];
  }

  async init() {
    this.wrapper = new Html("div").classOn("full-ui").appendTo("body");
    this.Ui.becomeTopUi(this.Pid, this.wrapper);
    this.wrapper.classOn("loading");

    this.state.windowsVolume = await window.volume.getVolume();
    console.log("[Encore] Windows volume", this.state.windowsVolume);

    // Load resources
    console.log("[Encore] Loading assets...");
    const sfx = [
      "fanfare.mp3",
      "fanfare-2.mp3",
      "67-kid.mp3",
      ...Array.from({ length: 10 }, (_, i) => `numbers/${i}.wav`),
    ];
    await Promise.all(sfx.map((s) => this.Forte.loadSfx(`/assets/audio/${s}`)));

    this.socket = io({ query: { clientType: "app" } });
    this.socket.on("connect", () => {
      console.log("[LINK] Connected to server.");
    });
    this.socket.on("remotes", (allRemoteData) => {
      this.knownRemotes = allRemoteData;
      console.log("[LINK] Loaded remote data", this.knownRemotes);
    });
    this.setupSocketListeners();

    // Load Songs
    this.songList = this.FsSvc.getSongList();
    this.songMap = new Map(this.songList.map((s) => [s.code, s]));
    this.socket.emit("broadcastData", {
      type: "ready",
    });

    window.desktopIntegration.ipc.send("setRPC", {
      details: `Browsing ${this.songList.length} Songs...`,
      state: `Main Menu`,
    });

    // Audio Config
    await this.Forte.setTrackVolume(this.state.volume);
    // Use optional chaining for safer access to nested properties
    if (this.config.audioConfig?.micLatency) {
      await this.Forte.setLatency(this.config.audioConfig.micLatency);
    }

    // Check for a specific mic device, otherwise use the system default.
    const micDevice = this.config.audioConfig?.mix?.scoring?.inputDevice;
    if (micDevice) {
      await this.Forte.setMicDevice(micDevice);
    } else {
      await this.Forte.setMicDevice("default");
    }

    // Build UI
    this.buildUI();

    // Initialize Modules into DOM
    this.infoBar.mount(this.wrapper);
    this.scoreHud.mount(this.wrapper);
    this.mixer.mount(this.wrapper);
    this.bgv.mount(this.dom.bgvContainer);
    this.recorder.mount(this.wrapper);
    this.recorder.setUiRefs({
      playerUi: this.dom.playerUi,
      lrcLineDisplay1: this.dom.lrcLineDisplay1,
      lrcLineDisplay2: this.dom.lrcLineDisplay2,
      scoreDisplay: this.scoreHud.scoreDisplay,
    });

    // Event Listeners
    window.addEventListener("keydown", this.boundKeydown);
    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      this.boundPlaybackUpdate,
    );

    // Start BGV
    console.log("MANIFEST", this.libraryInfo);
    await this.bgv.loadManifestCategories();
    let libraryBgvCategories =
      this.libraryInfo.manifest.additionalContents.bgvCategories;
    libraryBgvCategories.forEach((category) => {
      let tempPaths = [];
      category.BGV_LIST.forEach((vidPath) => {
        tempPaths.push(pathJoin([this.libraryInfo.path, vidPath]));
      });
      this.bgv.addDynamicCategory({
        BGV_CATEGORY: category.BGV_CATEGORY,
        BGV_LIST: tempPaths,
        isAbsolute: true,
      });
    });
    const mtvPaths = this.songList
      .filter((s) => s.videoPath)
      .map((s) => s.videoPath);
    if (mtvPaths.length)
      this.bgv.addDynamicCategory({
        BGV_CATEGORY: "MTV",
        BGV_LIST: mtvPaths,
        isAbsolute: true,
      });

    const bumperPaths =
      this.libraryInfo.manifest.additionalContents?.bumperImages;
    if (bumperPaths && bumperPaths.length > 0) {
      this.bumperImages = bumperPaths.map((p) =>
        pathJoin([this.libraryInfo.path, p]),
      );
      this.startBumperCycle();
    }

    await this.bgv.updatePlaylistForCategory();

    setTimeout(() => {
      this.wrapper.classOff("loading");
      this.Ui.transition("fadeIn", this.wrapper);
      this.setMode("menu");
    }, 100);
  }

  getFormatInfo(song) {
    const colors = {
      MTV: "#2F6CD1",
      RealSound: "#B02FD1",
      MIDI: "#D12F9E",
      Multiplex: "#2FD147",
      YouTube: "#D12F2F",
    };

    if (
      song.type === "youtube" ||
      (song.path && song.path.startsWith("yt://"))
    ) {
      return { label: "YT", color: colors.YouTube };
    }

    if (song.videoPath) {
      return { label: "MTV", color: colors.MTV };
    }

    if (
      song.type === "multiplexed" ||
      (song.path && song.path.toLowerCase().includes("multiplex"))
    ) {
      return { label: "MP", color: colors.Multiplex };
    }

    if (
      song.type === "mid" ||
      song.type === "kar" ||
      (song.path && (song.path.endsWith(".mid") || song.path.endsWith(".kar")))
    ) {
      return { label: "MIDI", color: colors.MIDI };
    }

    return { label: "RS", color: colors.RealSound };
  }

  parseDuration(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // MM:SS
    return 0; // Invalid or empty
  }

  scheduleYoutubeSkip(seconds) {
    this.clearYoutubeTimers();

    // Default buffer: 5 seconds for buffering/loading
    const totalMs = (seconds + 5) * 1000;
    const warningDuration = 10 * 1000; // Warn 10s before end
    const warnAt = Math.max(0, totalMs - warningDuration);

    console.log(
      `[Encore] Scheduling YT Skip in ${totalMs / 1000}s (Warn at ${
        warnAt / 1000
      }s)`,
    );

    this.ytWarningTimer = setTimeout(() => {
      this.state.isYtSkipWarningActive = true;
      this.infoBar.showTemp(
        "AUTO SKIP",
        "Song ending in 10s. Press <span class='key-badge'>UP</span> to extend (+30s).",
        10000,
      );
    }, warnAt);

    this.ytAutoSkipTimer = setTimeout(() => {
      console.log("[Encore] Auto-skipping YouTube track.");
      this.stopPlayer();
      this.bgv.start();
      this.transitionAfterSong();
    }, totalMs);
  }

  extendYoutubeSkip() {
    if (!this.state.isYtSkipWarningActive) return;

    this.clearYoutubeTimers();
    this.state.isYtSkipWarningActive = false;

    // Schedule new skip: 10s (remaining from warning) + 30s extension
    // We pass 35s because scheduleYoutubeSkip adds 5s buffer, so 35+5 = 40s total
    // To get exactly +30s relative to *now* (where we had ~10s left):
    // We want total time from now to be 40s.
    // scheduleYoutubeSkip adds 5s buffer. So input needs to be 35.
    this.scheduleYoutubeSkip(35);

    this.infoBar.showTemp("EXTENDED", "Time extended by 30 seconds.", 3000);
  }

  clearYoutubeTimers() {
    if (this.ytAutoSkipTimer) clearTimeout(this.ytAutoSkipTimer);
    if (this.ytWarningTimer) clearTimeout(this.ytWarningTimer);
    this.ytAutoSkipTimer = null;
    this.ytWarningTimer = null;
    this.state.isYtSkipWarningActive = false;
  }

  buildUI() {
    // --- Containers ---
    this.dom = {};
    this.dom.bgvContainer = new Html("div")
      .classOn("bgv-container")
      .appendTo(this.wrapper);
    this.dom.ytContainer = new Html("div")
      .classOn("youtube-player-container", "hidden")
      .appendTo(this.wrapper);
    this.dom.ytIframe = new Html("iframe").appendTo(this.dom.ytContainer);
    this.dom.overlay = new Html("div")
      .classOn("overlay-ui")
      .appendTo(this.wrapper);

    // --- Standby Screen UI (Banner) ---
    this.dom.standbyScreen = new Html("div")
      .classOn("standby-screen")
      .appendTo(this.dom.overlay);
    this.dom.standbyBumper = new Html("img")
      .classOn("standby-bumper-image")
      .appendTo(this.dom.standbyScreen);
    this.dom.standbyText = new Html("div")
      .classOn("standby-text")
      .text("SELECT SONG")
      .appendTo(this.dom.standbyScreen);

    this.dom.searchUi = new Html("div")
      .classOn("search-ui")
      .appendTo(this.wrapper);
    this.dom.playerUi = new Html("div")
      .classOn("player-ui", "hidden")
      .appendTo(this.wrapper);

    // --- Format Indicator ---
    this.dom.formatIndicator = new Html("div")
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
      .appendTo(this.wrapper);

    // --- Post Song Screen ---
    this.buildPostSongScreen();

    // --- Calibration Screen ---
    this.dom.calibrationScreen = new Html("div")
      .classOn("calibration-screen")
      .appendTo(this.wrapper);
    this.dom.calibTitle = new Html("h1").appendTo(this.dom.calibrationScreen);
    this.dom.calibText = new Html("p").appendTo(this.dom.calibrationScreen);

    // --- Main Menu Content ---
    this.dom.mainContent = new Html("div")
      .classOn("main-content")
      .appendTo(this.dom.overlay);
    new Html("h1").text("Enter Song Number").appendTo(this.dom.mainContent);
    this.dom.numberDisplay = new Html("div")
      .classOn("number-display")
      .appendTo(this.dom.mainContent);

    const songInfo = new Html("div")
      .classOn("song-info")
      .appendTo(this.dom.mainContent);
    this.dom.songTitle = new Html("h2")
      .classOn("song-title")
      .appendTo(songInfo);
    this.dom.songArtist = new Html("p")
      .classOn("song-artist")
      .appendTo(songInfo);

    // --- Song List ---
    this.dom.songListContainer = new Html("div")
      .classOn("song-list-container")
      .appendTo(this.dom.overlay);
    const listHeader = new Html("div")
      .classOn("song-list-header")
      .appendTo(this.dom.songListContainer);
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

    this.songItemElements = [];
    const listFragment = document.createDocumentFragment();

    this.songList.forEach((song, index) => {
      const item = new Html("div").classOn("song-item");
      new Html("div").classOn("song-item-code").text(song.code).appendTo(item);
      const fmt = this.getFormatInfo(song);
      const titleContainer = new Html("div")
        .classOn("song-item-title")
        .appendTo(item);
      new Html("span")
        .classOn("format-badge")
        .text(fmt.label)
        .styleJs({ backgroundColor: fmt.color })
        .appendTo(titleContainer);
      new Html("span").text(song.title).appendTo(titleContainer);
      new Html("div")
        .classOn("song-item-artist")
        .text(song.artist)
        .appendTo(item);
      item.on("click", () => this.startPlayer(song));
      item.on("mouseover", () => {
        if (this.state.mode === "menu" && !this.state.isTypingNumber) {
          this.state.highlightedIndex = index;
          this.updateMenuUI();
        }
      });
      this.songItemElements.push(item);
      listFragment.appendChild(item.elm);
    });

    this.dom.songListContainer.elm.appendChild(listFragment);

    // --- Bottom Actions ---
    this.dom.bottomActions = new Html("div")
      .classOn("bottom-actions")
      .appendTo(this.dom.overlay);
    new Html("div")
      .classOn("action-button")
      .text("Search (Y)")
      .on("click", () => this.setMode("yt-search"))
      .appendTo(this.dom.bottomActions);
    new Html("div")
      .classOn("action-button")
      .text("Calibrate Audio (C)")
      .on("click", () => this.runCalibrationSequence())
      .appendTo(this.dom.bottomActions);
    new Html("div")
      .classOn("action-button")
      .text("Mic/Music Setup (M)")
      .on("click", () => this.mixer.toggle())
      .appendTo(this.dom.bottomActions);

    // --- QR Code ---
    this.buildQR();

    // --- Version Badge ---
    new Html("div")
      .classOn("version-badge")
      .text("BETA 1.0.0")
      .appendTo(this.wrapper);

    // --- Search Window ---
    this.dom.searchWindow = new Html("div")
      .classOn("search-window")
      .appendTo(this.dom.searchUi);
    this.dom.searchInput = new Html("input")
      .classOn("search-input")
      .attr({ type: "text", placeholder: "Type here to search..." })
      .appendTo(this.dom.searchWindow);
    this.dom.searchResultsContainer = new Html("div")
      .classOn("search-results-container")
      .appendTo(this.dom.searchWindow);
    this.dom.searchInput.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.performSearch();
      }
    });

    // --- Player UI ---
    this.dom.introCard = new Html("div").classOn("intro-card").appendTo("body");
    this.dom.introTitle = new Html("div")
      .classOn("intro-card-title")
      .appendTo(this.dom.introCard);
    this.dom.introArtist = new Html("div")
      .classOn("intro-card-artist")
      .appendTo(this.dom.introCard);

    const bottom = new Html("div")
      .classOn("player-bottom-section")
      .appendTo(this.dom.playerUi);
    this.dom.countdownDisplay = new Html("div")
      .classOn("countdown-display")
      .appendTo(bottom);

    this.dom.lrcContainer = new Html("div")
      .classOn("lyrics-container")
      .appendTo(bottom);
    this.dom.lrcLineDisplay1 = new Html("div")
      .classOn("lyric-line")
      .appendTo(this.dom.lrcContainer);
    this.dom.lrcLineDisplay2 = new Html("div")
      .classOn("lyric-line", "next")
      .appendTo(this.dom.lrcContainer);

    this.dom.midiContainer = new Html("div")
      .classOn("midi-lyrics-container")
      .appendTo(bottom);
    this.dom.midiLineDisplay1 = new Html("div")
      .classOn("lyric-line", "midi-lyric-line")
      .appendTo(this.dom.midiContainer);
    this.dom.midiLineDisplay2 = new Html("div")
      .classOn("lyric-line", "midi-lyric-line", "next")
      .appendTo(this.dom.midiContainer);
  }

  buildPostSongScreen() {
    this.dom.postSongScreen = new Html("div")
      .classOn("post-song-screen-overlay")
      .appendTo(this.wrapper);

    // Title
    new Html("div")
      .classOn("score-title-text")
      .text("YOUR SCORE")
      .appendTo(this.dom.postSongScreen);

    // Main Group: Score on top, Rank below
    const mainGroup = new Html("div")
      .classOn("score-main-group")
      .appendTo(this.dom.postSongScreen);
    this.dom.finalScoreDisplay = new Html("div")
      .classOn("score-display-number")
      .text("00")
      .appendTo(mainGroup);
    this.dom.rankDisplay = new Html("div")
      .classOn("rank-display-text")
      .text("")
      .appendTo(mainGroup);

    // Gauges Row
    const gaugeRow = new Html("div")
      .classOn("score-details-grid")
      .appendTo(this.dom.postSongScreen);

    this.dom.gauges = {};
    const createSvgGauge = (label, color) => {
      const wrap = new Html("div").classOn("gauge-wrapper").appendTo(gaugeRow);

      const svgContainer = new Html("div")
        .classOn("gauge-svg-container")
        .appendTo(wrap);
      // SVG Implementation
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("class", "gauge-svg");

      const bgCircle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      bgCircle.setAttribute("cx", "50");
      bgCircle.setAttribute("cy", "50");
      bgCircle.setAttribute("r", "45");
      bgCircle.setAttribute("class", "gauge-bg-circle");

      const fillCircle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      fillCircle.setAttribute("cx", "50");
      fillCircle.setAttribute("cy", "50");
      fillCircle.setAttribute("r", "45");
      fillCircle.setAttribute("class", "gauge-fill-circle");
      fillCircle.style.setProperty("--g-color", color);

      svg.appendChild(bgCircle);
      svg.appendChild(fillCircle);
      svgContainer.elm.appendChild(svg);

      const valText = new Html("div")
        .classOn("gauge-value-text")
        .text("0")
        .appendTo(svgContainer);
      new Html("div").classOn("gauge-label").text(label).appendTo(wrap);

      return { circle: fillCircle, text: valText };
    };

    this.dom.gauges.keyRhythm = createSvgGauge("Pitch", "#4fc3f7");
    this.dom.gauges.vibrato = createSvgGauge("Vibrato", "#ba68c8");
    this.dom.gauges.upband = createSvgGauge("Up-Band", "#ffb74d");
    this.dom.gauges.downband = createSvgGauge("Down-Band", "#81c784");

    // Footer
    new Html("div")
      .classOn("score-skip-hint")
      .text("PRESS ENTER TO CONTINUE")
      .appendTo(this.dom.postSongScreen);
  }

  buildQR() {
    const qr = new Html("div")
      .classOn("qr-code-container")
      .appendTo(this.wrapper);
    const img = new Html("img").appendTo(qr);
    new Html("p").text("Use your phone as a remote!").appendTo(qr);
    fetch("http://127.0.0.1:9864/local_ip")
      .then((r) => r.text())
      .then((ip) => {
        const remoteUrl = `http://${ip}:9864/remote`;
        img.attr({
          src: `http://127.0.0.1:9864/qr?url=${encodeURIComponent(remoteUrl)}`,
        });
      })
      .catch((e) => qr.classOn("hidden"));
  }

  // --- Core Logic Methods ---

  startBumperCycle() {
    if (this.bumperInterval) clearInterval(this.bumperInterval);
    if (this.bumperImages.length === 0) {
      this.dom.standbyBumper.classOn("hidden");
      this.dom.standbyText.classOff("hidden");
      this.dom.standbyScreen.classOff("has-bumper-image");
      return;
    }

    this.dom.standbyText.classOn("hidden");
    this.dom.standbyBumper.classOff("hidden");
    this.dom.standbyScreen.classOn("has-bumper-image");

    const cycle = () => {
      this.dom.standbyBumper.styleJs({ opacity: 0 });
      setTimeout(() => {
        this.currentBumperIndex =
          (this.currentBumperIndex + 1) % this.bumperImages.length;
        const nextImage = this.bumperImages[this.currentBumperIndex];
        const imageUrl = new URL("http://127.0.0.1:9864/getFile");
        imageUrl.searchParams.append("path", nextImage);
        this.dom.standbyBumper.attr({ src: imageUrl.href });
        this.dom.standbyBumper.styleJs({ opacity: 1 });
      }, 500); // Wait for fade out
    };

    // Load initial image
    const initialImage = this.bumperImages[0];
    const imageUrl = new URL("http://127.0.0.1:9864/getFile");
    imageUrl.searchParams.append("path", initialImage);
    this.dom.standbyBumper.attr({ src: imageUrl.href });

    this.bumperInterval = setInterval(cycle, 8000); // 8-second interval
  }

  showTheSongList() {
    if (this.state.mode !== "menu" || this.state.showSongList) return;
    this.state.showSongList = true;
    this.updateMenuUI();
  }

  setMode(newMode) {
    this.state.mode = newMode;
    this.wrapper.classOff(
      "mode-menu",
      "mode-player",
      "mode-yt-search",
      "mode-player-youtube",
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
    } else if (newMode === "player") {
      if (this.state.currentSongIsMultiplexed) {
        this.Forte.togglePianoRollVisibility(true);
      } else {
        this.Forte.togglePianoRollVisibility(false);
      }
      this.dom.playerUi.classOff("hidden");
      this.infoBar.showDefault(); // Will check if bar needs to be shown (REC or Queue)
    } else if (newMode === "yt-search") {
      if (this.state.currentSongIsMultiplexed)
        this.Forte.togglePianoRollVisibility(false);
      this.dom.searchInput.elm.focus();
      this.dom.searchInput.elm.select();
    }
  }

  updateMenuUI() {
    if (!this.state.showSongList && this.state.mode === "menu") {
      this.dom.standbyScreen.classOff("hidden");
      this.dom.mainContent.classOn("hidden");
      this.dom.songListContainer.classOn("hidden");
      this.dom.bottomActions.classOn("hidden");
      // Hide the number display text content when not showing the list
      this.dom.numberDisplay.text("");
      this.dom.songTitle.text("");
      this.dom.songArtist.text("");
      return;
    }
    // If we're here, we want to show the list/input UI
    this.dom.standbyScreen.classOn("hidden");
    this.dom.mainContent.classOff("hidden");
    this.dom.songListContainer.classOff("hidden");
    this.dom.bottomActions.classOff("hidden");
    this.wrapper[this.state.isTypingNumber ? "classOn" : "classOff"](
      "is-typing",
    );
    const code = this.state.songNumber.padStart(5, "0");
    let activeSong =
      this.state.songNumber.length > 0
        ? this.songMap.get(code)
        : this.state.highlightedIndex >= 0
          ? this.songList[this.state.highlightedIndex]
          : null;

    this.dom.numberDisplay.text(
      this.state.songNumber.length > 0
        ? code
        : activeSong
          ? activeSong.code
          : "",
    );
    this.dom.numberDisplay[activeSong ? "classOn" : "classOff"]("active");
    this.dom.songTitle.text(
      activeSong
        ? activeSong.title
        : this.state.songNumber.length === 5
          ? "Song Not Found"
          : "",
    );
    this.dom.songArtist.text(activeSong ? activeSong.artist : "");

    this.songItemElements.forEach((item, index) => {
      const isHi = index === this.state.highlightedIndex;
      item[isHi ? "classOn" : "classOff"]("highlighted");
      if (isHi && !this.state.isTypingNumber) {
        if (index === 0) this.dom.songListContainer.elm.scrollTop = 0;
        else item.elm.scrollIntoView({ block: "nearest" });
      }
    });
  }

  toggleSearchOverlay(visible) {
    if (this.state.currentSongIsMultiplexed)
      this.Forte.togglePianoRollVisibility(!visible);
    this.state.isSearchOverlayVisible = visible;
    if (visible) {
      this.wrapper.classOn("search-overlay-active");
      if (this.state.mode === "player")
        this.wrapper.classOn("in-game-search-active");

      // Clear the highlighted search index when opening overlay
      this.state.highlightedSearchIndex = -1;

      // Restore the has-results class if results are already present
      if (this.state.searchResults.length > 0) {
        this.dom.searchWindow.classOn("has-results");
        this.updateSearchHighlight();
      }

      this.dom.searchInput.elm.focus();
      this.dom.searchInput.elm.select();
    } else {
      this.wrapper.classOff("search-overlay-active", "in-game-search-active");
      this.dom.searchWindow.classOff("has-results");
      this.dom.searchInput.elm.blur();
      if (this.state.mode === "player") this.infoBar.showDefault();
    }
  }

  async performSearch() {
    const query = this.dom.searchInput.getValue().trim().toLowerCase();
    if (!query) {
      this.state.searchResults = [];
      this.renderSearchResults();
      return;
    }
    this.state.isSearching = true;

    let localResults = [];
    if (/^\d+$/.test(query))
      this.songList.forEach((s) => {
        if (s.code.includes(query)) localResults.push({ ...s, type: "local" });
      });

    // Search by title, artist, and their romanized versions
    for (const s of this.songList) {
      if (localResults.find((x) => x.code === s.code)) continue;

      const titleMatch = s.title.toLowerCase().includes(query);
      const artistMatch = s.artist.toLowerCase().includes(query);

      let romaTitle = null;
      let romaArtist = null;

      // Romanize title and artist for comparison
      if (
        !titleMatch &&
        /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(
          s.title,
        )
      ) {
        romaTitle = await Romanizer.romanize(s.title);
      }
      if (
        !artistMatch &&
        /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(
          s.artist,
        )
      ) {
        romaArtist = await Romanizer.romanize(s.artist);
      }

      const romaMatch =
        (romaTitle && romaTitle.toLowerCase().includes(query)) ||
        (romaArtist && romaArtist.toLowerCase().includes(query));

      if (titleMatch || artistMatch || romaMatch) {
        localResults.push({ ...s, type: "local" });
      }
    }

    this.state.searchResults = [...localResults];
    this.renderSearchResults();

    try {
      const res = await fetch(
        `http://127.0.0.1:9864/yt-search?q=${encodeURIComponent(query)}`,
      );
      const data = await res.json();
      const ytItems = (data.items || [])
        .filter((i) => i.type === "video")
        .map((i) => ({ ...i, type: "youtube" }));
      this.state.searchResults = [...localResults, ...ytItems];
      this.renderSearchResults();
    } catch (e) {
      console.error("YT Search failed", e);
    } finally {
      this.state.isSearching = false;
    }
  }

  renderSearchResults() {
    this.dom.searchResultsContainer.clear();
    this.state.highlightedSearchIndex = -1;
    if (!this.state.searchResults.length) {
      this.dom.searchResultsContainer.text(
        this.state.isSearching ? "Searching..." : "No results found.",
      );
      this.dom.searchWindow.classOff("has-results");
      return;
    }
    this.dom.searchWindow.classOn("has-results");

    this.state.searchResults.forEach((res, idx) => {
      const item = new Html("div")
        .classOn("search-result-item")
        .appendTo(this.dom.searchResultsContainer);
      item.on("click", () => {
        this.state.highlightedSearchIndex = idx;
        this.handleEnter();
      });
      item.on("mouseover", () => {
        this.state.highlightedSearchIndex = idx;
        this.updateSearchHighlight();
      });

      const info = new Html("div").classOn("search-info").appendTo(item);
      const fmt = this.getFormatInfo(res); // Use the helper

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

        new Html("div")
          .classOn("search-channel")
          .text(res.artist)
          .appendTo(info);
      } else {
        // YouTube Result
        const thumb = new Html("div")
          .classOn("search-thumbnail-wrapper")
          .appendTo(item);
        new Html("img")
          .classOn("search-thumbnail")
          .attr({ src: res.thumbnail.thumbnails[0].url })
          .appendTo(thumb);
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
    this.updateSearchHighlight();
  }

  updateSearchHighlight() {
    this.dom.searchResultsContainer
      .qsa(".search-result-item")
      .forEach((item, idx) => {
        item[
          idx === this.state.highlightedSearchIndex ? "classOn" : "classOff"
        ]("highlighted");
        if (idx === this.state.highlightedSearchIndex)
          item.elm.scrollIntoView({ block: "nearest" });
      });
  }

  // --- Player Logic ---

  async startPlayer(song) {
    this.state.isTransitioning = true;
    this.recorder.setSongInfo(song);
    this.cleanupPlayerEvents();

    // Reset Visuals
    this.dom.countdownDisplay.classOff("visible").text("");
    this.countdownTargetTime = null;
    this.lastCountdownTick = null;

    this.dom.lrcLineDisplay1.clear().classOff("active", "next");
    this.dom.lrcLineDisplay2.clear().classOff("active", "next");
    this.dom.midiLineDisplay1.clear().classOff("active", "next");
    this.dom.midiLineDisplay2.clear().classOff("active", "next");
    this.scoreHud.hide();
    this.dom.introCard.classOff("visible");
    this.dom.formatIndicator.styleJs({ opacity: "0" });

    // Fix: Explicitly reset the multiplex flag so setMode doesn't show the piano roll
    this.state.currentSongIsMultiplexed = false;

    this.state.currentSongIsYouTube = song.path.startsWith("yt://");
    this.state.currentSongIsMV = !!song.videoPath;
    this.state.reservationNumber = "";

    this.setMode("player");
    if (this.state.currentSongIsYouTube)
      this.wrapper.classOn("mode-player-youtube");

    window.desktopIntegration.ipc.send("setRPC", {
      details: song.title,
      state: song.artist,
    });
    this.socket.emit("broadcastData", {
      type: "now_playing",
      song: {
        ...song,
        isYouTube: this.state.currentSongIsYouTube,
        isMV: this.state.currentSongIsMV,
      },
    });

    if (this.state.currentSongIsYouTube) {
      // Fix: Ensure previous track is stopped and piano roll is hidden
      this.Forte.stopTrack();
      this.Forte.togglePianoRollVisibility(false);

      // Feature Parity: YouTube tracks now react to volume
      this.state.windowsVolume = await window.volume.getVolume();
      let maxVolume = this.state.windowsVolume;
      window.volume.setVolume(this.state.volume * maxVolume);

      this.bgv.stop();
      this.dom.bgvContainer.classOn("hidden");
      this.dom.ytContainer.classOff("hidden");
      this.dom.ytIframe.attr({
        src: `https://cdpn.io/pen/debug/oNPzxKo?v=${song.path.substring(
          5,
        )}&autoplay=1`,
        allow:
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      });
      if (!song.isLive && song.durationText) {
        const seconds = this.parseDuration(song.durationText);
        if (seconds > 0) {
          this.scheduleYoutubeSkip(seconds);
        }
      }
      this.dom.lrcContainer.classOn("hidden");
      this.dom.midiContainer.classOn("hidden");

      this.dom.formatIndicator.styleJs({
        backgroundImage: 'url("/assets/img/icons/yt.png")',
        opacity: "1",
      });

      this.state.isTransitioning = false;
    } else {
      let mvPlayer = null;
      this.dom.lrcContainer.styleJs({ opacity: "0" }).classOff("hidden");
      this.dom.midiContainer.styleJs({ opacity: "0" }).classOff("hidden");

      if (this.state.currentSongIsMV) {
        const videoUrl = new URL("http://127.0.0.1:9864/getFile");
        videoUrl.searchParams.append("path", song.videoPath);
        mvPlayer = await this.bgv.playSingleVideo(videoUrl.href);
      } else {
        this.bgv.resumePlaylist();
      }

      this.dom.bgvContainer.classOff("hidden");
      this.dom.ytContainer.classOn("hidden");
      this.dom.ytIframe.attr({ src: "" });

      const trackUrl = new URL("http://127.0.0.1:9864/getFile");
      trackUrl.searchParams.append("path", song.path);
      await this.Forte.loadTrack(trackUrl.href);

      const pbState = this.Forte.getPlaybackState();
      this.state.currentSongIsMultiplexed = pbState.isMultiplexed;

      // Determine Format Icon
      let icon = "rs.png"; // Default RealSound
      if (this.state.currentSongIsMV) icon = "mtv.png";
      else if (this.state.currentSongIsMultiplexed) icon = "mp.png";
      else if (pbState.isMidi) icon = "midi.png";

      this.dom.formatIndicator.styleJs({
        backgroundImage: `url("/assets/img/icons/${icon}")`,
        opacity: "1",
      });

      if (this.state.currentSongIsMultiplexed) {
        this.scoreHud.show(0);
        this.Forte.togglePianoRollVisibility(true);
      }

      this.dom.introTitle.text(song.title);
      this.dom.introArtist.text(song.artist);
      this.dom.introCard.classOn("visible");
      this.dom.lrcContainer.styleJs({ opacity: "1" });
      this.dom.midiContainer.styleJs({ opacity: "1" });

      await this.setupLyrics(song, pbState);
      this.setupTimeUpdate(mvPlayer);

      if (this.state.currentSongIsMultiplexed) {
        this.boundScoreUpdate = (e) => this.scoreHud.show(e.detail.finalScore);
        document.addEventListener(
          "CherryTree.Forte.Scoring.Update",
          this.boundScoreUpdate,
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
      }, 2500);
    }
  }

  async setupLyrics(song, pbState) {
    this.parsedLrc = []; // Clear old lyrics

    if (pbState.isMidi) {
      this.dom.midiContainer.styleJs({ display: "flex" });
      this.dom.lrcContainer.styleJs({ display: "none" });

      // --- Metadata parsing ---
      let lyricsToParse = [...pbState.decodedLyrics];
      let fullMetadataString = "";
      while (
        lyricsToParse.length > 0 &&
        (lyricsToParse[0].trim().startsWith("{@") ||
          lyricsToParse[0].trim().startsWith("{#"))
      ) {
        fullMetadataString += lyricsToParse.shift();
      }
      if (fullMetadataString) {
        const metadata = {};
        const regex = /{#([^=]+)=([^}]+)}/g;
        let match;
        while ((match = regex.exec(fullMetadataString)) !== null) {
          metadata[match[1].toUpperCase()] = match[2];
        }
        console.log("[Encore] Parsed MIDI Metadata:", metadata);
        if (metadata.TITLE) this.dom.introTitle.text(metadata.TITLE);
        if (metadata.ARTIST) this.dom.introArtist.text(metadata.ARTIST);
      }

      // --- Synchronous syllable parsing ---
      const allSyllables = [];
      const lines = [];
      let currentLineSyllables = [];
      let displayableSyllableIndex = 0;
      for (const syllableText of lyricsToParse) {
        const startsWithNewLine = /^[\r\n\/\\\\]/.test(syllableText);
        const endsWithNewLine = /[\r\n\/\\\\]$/.test(syllableText);
        let cleanText = syllableText.replace(/[\r\n\/\\]/g, "");
        if (startsWithNewLine && currentLineSyllables.length > 0) {
          lines.push(currentLineSyllables);
          currentLineSyllables = [];
        }
        if (cleanText) {
          let mainText = cleanText;
          let furiganaText = null;
          const furiMatch = cleanText.match(/^(.+?)\[(.+?)\]$/);
          if (furiMatch) {
            mainText = furiMatch[1];
            furiganaText = furiMatch[2];
          }
          const syllable = {
            text: mainText,
            furigana: furiganaText,
            romanized: null,
            romanizationPromise: null,
            rawText: cleanText,
            globalIndex: displayableSyllableIndex,
            lineIndex: lines.length,
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

      const displayLines = [
        this.dom.midiLineDisplay1,
        this.dom.midiLineDisplay2,
      ];
      let currentSongLineIndex = -1;

      const getRomanizationPromise = (syllable) => {
        if (!syllable.romanizationPromise) {
          const textToRomanize = syllable.furigana || syllable.text;
          syllable.romanizationPromise = Romanizer.romanize(
            textToRomanize,
          ).then((romanizedText) => {
            syllable.romanized = romanizedText || "";
            return syllable.romanized;
          });
        }
        return syllable.romanizationPromise;
      };

      const renderLine = (displayEl, lineData) => {
        displayEl.clear();
        if (!lineData) return;
        lineData.forEach((s) => {
          const container = new Html("div")
            .classOn("lyric-syllable-container")
            .attr({ "data-index": s.globalIndex })
            .appendTo(displayEl);

          // Render Furigana and Original text immediately
          const furiSpan = new Html("span")
            .classOn("lyric-syllable-furigana")
            .appendTo(container);
          if (s.furigana) {
            furiSpan.attr({ "data-text": s.furigana }).text(s.furigana);
          } else {
            furiSpan.html("&nbsp;").styleJs({ visibility: "hidden" });
          }
          new Html("span")
            .classOn("lyric-syllable-original")
            .attr({ "data-text": s.text })
            .text(s.text)
            .appendTo(container);

          const romSpan = new Html("span")
            .classOn("lyric-syllable-romanized")
            .appendTo(container);
          if (s.romanized) {
            romSpan.attr({ "data-text": s.romanized }).text(s.romanized);
          } else {
            romSpan.html("&nbsp;").styleJs({ visibility: "hidden" });
            getRomanizationPromise(s).then((romanizedText) => {
              if (romanizedText) {
                romSpan
                  .attr({ "data-text": romanizedText })
                  .text(romanizedText)
                  .styleJs({ visibility: "visible" });
              }
            });
          }
        });
      };

      // --- Initial Rendering ---
      // Render the first two lines, which will automatically start their romanization process.
      renderLine(displayLines[0], lines[0]);
      renderLine(displayLines[1], lines[1]);
      displayLines[0].classOn("active");
      displayLines[1].classOn("next");

      // --- Pre-fetch the third line to prevent pop-in on the first line change ---
      if (lines[2]) {
        lines[2].forEach(getRomanizationPromise);
      }

      let currentVisualIndex = 0;
      this.boundLyricEvent = (e) => {
        const { text } = e.detail;
        if (!text) return;
        const cleanInput = text.replace(/[\r\n\/\\]/g, "");
        if (!cleanInput) return;
        if (currentVisualIndex >= allSyllables.length) return;
        let targetSyllable = allSyllables[currentVisualIndex];
        let matchFound = false;
        if (targetSyllable.rawText === cleanInput) {
          matchFound = true;
        } else {
          const lookAheadLimit = Math.min(
            currentVisualIndex + 15,
            allSyllables.length,
          );
          for (let i = currentVisualIndex + 1; i < lookAheadLimit; i++) {
            if (allSyllables[i].rawText === cleanInput) {
              currentVisualIndex = i;
              targetSyllable = allSyllables[i];
              matchFound = true;
              break;
            }
          }
        }

        if (matchFound) {
          if (targetSyllable.lineIndex !== currentSongLineIndex) {
            currentSongLineIndex = targetSyllable.lineIndex;
            const activeDisplay = displayLines[currentSongLineIndex % 2];
            const nextDisplay = displayLines[(currentSongLineIndex + 1) % 2];
            activeDisplay.classOn("active").classOff("next");
            nextDisplay.classOff("active").classOn("next");

            // Render the new "next" line
            renderLine(nextDisplay, lines[currentSongLineIndex + 1]);

            // Pre-fetch the romanization for the line after that
            const nextNextLine = lines[currentSongLineIndex + 2];
            if (nextNextLine) {
              nextNextLine.forEach(getRomanizationPromise);
            }
          }
          const newSyllableEl = this.wrapper.qs(
            `.lyric-syllable-container[data-index="${targetSyllable.globalIndex}"]`,
          );
          if (newSyllableEl) newSyllableEl.classOn("active");
          currentVisualIndex++;
        } else {
          console.debug(`[Encore] Ignored metadata event: ${cleanInput}`);
        }
      };

      document.addEventListener(
        "CherryTree.Forte.Playback.LyricEvent",
        this.boundLyricEvent,
      );
    } else if (song.lrcPath) {
      this.dom.midiContainer.styleJs({ display: "none" });
      this.dom.lrcContainer.styleJs({ display: "flex" });
      const lrcText = await this.FsSvc.readFile(song.lrcPath);
      this.parsedLrc = await this.parseLrc(lrcText);
      if (this.parsedLrc.length > 0) {
        this.renderLrcLine(this.dom.lrcLineDisplay1, this.parsedLrc[0]);
        this.renderLrcLine(this.dom.lrcLineDisplay2, this.parsedLrc[1]);
        this.dom.lrcLineDisplay2.classOn("next");
        if (this.parsedLrc[0].time > 8.0)
          this.scheduleCountdown(this.parsedLrc[0].time);
      }
    }
  }
  renderLrcLine(displayEl, lineData) {
    displayEl.clear();
    if (!lineData) return;
    new Html("div")
      .classOn("lyric-line-original")
      .text(lineData.text)
      .appendTo(displayEl);
    if (lineData.romanized)
      new Html("div")
        .classOn("lyric-line-romanized")
        .text(lineData.romanized)
        .appendTo(displayEl);
  }

  async parseLrc(text) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    if (!text) return [];
    const lines = text.split("\n");
    const promises = lines.map(async (line) => {
      const match = line.match(regex);
      if (!match) return null;
      const time =
        parseInt(match[1]) * 60 +
        parseInt(match[2]) +
        parseInt(match[3].padEnd(3, "0")) / 1000;
      const txt = line.replace(regex, "").trim();
      if (!txt) return null;
      return { time, text: txt, romanized: await Romanizer.romanize(txt) };
    });
    return (await Promise.all(promises)).filter(Boolean);
  }

  setupTimeUpdate(mvPlayer) {
    let currentLrcIndex = -1;
    this.boundTimeUpdate = (e) => {
      const { currentTime } = e.detail;

      // MV Sync logic
      if (mvPlayer) {
        const target = currentTime + this.state.videoSyncOffset / 1000;
        const drift = (target - mvPlayer.currentTime) * 1000;
        if (Math.abs(drift) > 500) {
          mvPlayer.currentTime = target;
          mvPlayer.playbackRate = 1;
        } else if (Math.abs(drift) > 50)
          mvPlayer.playbackRate = drift > 0 ? 1.05 : 0.95;
        else mvPlayer.playbackRate = 1;
      }

      // Countdown Logic
      if (this.countdownTargetTime !== null) {
        const rem = this.countdownTargetTime - currentTime;
        let tick =
          rem > 3 ? null : rem > 2 ? "3" : rem > 1 ? "2" : rem > 0 ? "1" : null;
        if (!tick && rem <= 0) this.countdownTargetTime = null;
        if (tick !== this.lastCountdownTick) {
          this.lastCountdownTick = tick;
          this.dom.countdownDisplay.text(tick || "");
          if (tick) this.dom.countdownDisplay.classOn("visible");
          else this.dom.countdownDisplay.classOff("visible");
        }
      }

      // LRC Logic
      if (this.parsedLrc && this.parsedLrc.length) {
        let newIdx = -1;
        // Optimization: For large LRCs, backward search is okay, but ensure no DOM trashing
        for (let i = this.parsedLrc.length - 1; i >= 0; i--) {
          if (currentTime >= this.parsedLrc[i].time) {
            newIdx = i;
            break;
          }
        }
        if (newIdx !== currentLrcIndex) {
          if (this.nextLineUpdateTimeout)
            clearTimeout(this.nextLineUpdateTimeout);
          currentLrcIndex = newIdx;
          if (newIdx >= 0) {
            const active = [this.dom.lrcLineDisplay1, this.dom.lrcLineDisplay2][
              currentLrcIndex % 2
            ];
            const next = [this.dom.lrcLineDisplay1, this.dom.lrcLineDisplay2][
              (currentLrcIndex + 1) % 2
            ];
            active.classOn("active").classOff("next");
            next.classOff("active").classOn("next");

            const curLine = this.parsedLrc[currentLrcIndex];
            const nextLine = this.parsedLrc[currentLrcIndex + 1];
            if (nextLine) {
              if (nextLine.time - curLine.time > 8.0)
                this.scheduleCountdown(nextLine.time);
              this.nextLineUpdateTimeout = setTimeout(
                () => {
                  this.renderLrcLine(next, nextLine);
                },
                (nextLine.time - curLine.time) * 500,
              );
            }
          }
        }
      }
    };
    document.addEventListener(
      "CherryTree.Forte.Playback.TimeUpdate",
      this.boundTimeUpdate,
    );
  }

  scheduleCountdown(targetTime) {
    this.countdownTargetTime = targetTime;
    this.lastCountdownTick = null;
    this.dom.countdownDisplay.classOff("visible");
  }

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

    if (this.state.currentSongIsYouTube) {
      window.volume.setVolume(this.state.windowsVolume);
    }

    this.state.currentSongIsMV = false;
    this.state.currentSongIsYouTube = false;
    this.state.currentSongIsMultiplexed = false;
  }

  cleanupPlayerEvents() {
    if (this.nextLineUpdateTimeout) clearTimeout(this.nextLineUpdateTimeout);
    this.nextLineUpdateTimeout = null;
    if (this.boundTimeUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundTimeUpdate,
      );
    if (this.boundLyricEvent)
      document.removeEventListener(
        "CherryTree.Forte.Playback.LyricEvent",
        this.boundLyricEvent,
      );
    if (this.boundScoreUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Scoring.Update",
        this.boundScoreUpdate,
      );
    this.boundTimeUpdate = null;
    this.boundLyricEvent = null;
    this.boundScoreUpdate = null;
  }

  async handlePlaybackUpdate(e) {
    const { status } = e.detail || {};
    if (
      this.state.mode.startsWith("player") &&
      this.state.lastPlaybackStatus === "playing" &&
      status === "stopped"
    ) {
      if (this.state.isTransitioning) return;
      this.state.isTransitioning = true;
      this.Forte.togglePianoRollVisibility(false);
      if (this.recorder.isRecording) this.recorder.stop();

      const wasMultiplexed = this.state.currentSongIsMultiplexed;
      const wasMV = this.state.currentSongIsMV;
      this.scoreHud.hide();

      if (wasMV) await this.bgv.resumePlaylist();
      this.stopPlayer();

      if (wasMultiplexed) {
        const finalScore = this.Forte.getPlaybackState().score;
        await this.showPostSongScreen(finalScore);
      }
      this.transitionAfterSong();
    }
    this.state.lastPlaybackStatus = status;
  }

  transitionAfterSong() {
    if (this.state.reservationQueue.length > 0) {
      const next = this.state.reservationQueue.shift();
      this.infoBar.showDefault();
      setTimeout(() => this.startPlayer(next), 250);
    } else {
      this.setMode("menu");
      window.desktopIntegration.ipc.send("setRPC", {
        details: `Browsing ${this.songList.length} Songs...`,
        state: `Main Menu`,
      });
      setTimeout(() => {
        if (!this.state.reservationQueue.length)
          this.state.isTransitioning = false;
      }, 1500);
    }
  }

  async showPostSongScreen(scoreData) {
    this.state.isScoreScreenActive = true;

    // Reset visuals
    this.dom.rankDisplay
      .text("")
      .styleJs({ transform: "scale(0.8)", opacity: "0", color: "#fff" });
    this.dom.finalScoreDisplay.text("0");

    // Reset SVG Gauges: Dashoffset = 283 (full circle hidden)
    Object.values(this.dom.gauges).forEach((g) => {
      g.circle.style.strokeDashoffset = "283";
      g.text.text("0");
    });

    this.dom.postSongScreen.styleJs({ opacity: "1", pointerEvents: "all" });
    // this.Forte.playSfx("/assets/audio/fanfare.mp3");

    // Calculate Grade
    const s = scoreData.finalScore;
    let rank = "Good";
    let rankColor = "#aed581";
    if (s == 67) {
      this.Forte.playSfx("/assets/audio/67-kid.mp3");
    }
    if (s == 100) {
      rank = "WHAT THE FUCK HOW";
      rankColor = "#00e676";
    } else if (s >= 98) {
      rank = "HOLY SHIT";
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
      rank = "YIKES";
      rankColor = "#ef5350";
    }

    // Animation Promise
    const animate = async () => {
      const dur = 2000;
      const start = performance.now();
      await new Promise((r) => {
        const tick = () => {
          const now = performance.now();
          const p = Math.min((now - start) / dur, 1);
          // Ease out cubic
          const ease = 1 - Math.pow(1 - p, 3);

          // Score
          const curScore = s * ease;
          this.dom.finalScoreDisplay.text(Math.floor(curScore));

          // Gauges (SVG Dashoffset calculation)
          // Circumference ~ 283. Offset = 283 - (283 * percentage)
          Object.keys(this.dom.gauges).forEach((k) => {
            let key = k === "keyRhythm" ? "pitchAndRhythm" : k;
            const val = (scoreData.details[key] || 0) * ease;
            const offset = 283 - 283 * (val / 100);
            this.dom.gauges[k].circle.style.strokeDashoffset = offset;
            this.dom.gauges[k].text.text(Math.round(val));
          });

          if (p < 1) requestAnimationFrame(tick);
          else r();
        };
        requestAnimationFrame(tick);
      });

      // Show Rank
      this.dom.rankDisplay.text(rank).styleJs({
        transform: "scale(1)",
        opacity: "1",
        color: rankColor,
        transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      });
    };

    // Wait for either the animation + delay OR the user to skip
    await Promise.race([
      (async () => {
        await animate();
        await new Promise((r) => setTimeout(r, 5000));
      })(),
      new Promise((resolve) => {
        this.state.scoreSkipResolver = resolve;
      }),
    ]);

    // Cleanup
    this.dom.postSongScreen.styleJs({ opacity: "0", pointerEvents: "none" });
    this.state.isScoreScreenActive = false;
    this.state.scoreSkipResolver = null;
    await new Promise((r) => setTimeout(r, 400));
  }

  async runCalibrationSequence() {
    if (this.state.isTransitioning) return;
    this.state.isTransitioning = true;
    this.dom.calibTitle.text("LATENCY COMPENSATION");
    this.dom.calibText.html(
      "Please place your microphone near your speakers and ensure the room is quiet.<br>The test will begin in five (5) seconds...",
    );
    this.dom.calibrationScreen.classOn("visible");
    await new Promise((r) => setTimeout(r, 5000));
    this.dom.calibText.text("Calibrating... A series of beeps will play.");
    try {
      const lat = await this.Forte.runLatencyTest();
      window.config.setItem("audioConfig.micLatency", lat);
      this.dom.calibTitle.text("CALIBRATION COMPLETE");
      this.dom.calibText.text(
        `Measured audio latency is ${(lat * 1000).toFixed(0)} ms.`,
      );
      this.infoBar.showTemp(
        "CALIBRATION",
        `Success! ${(lat * 1000).toFixed(0)} ms`,
        5000,
      );
    } catch (e) {
      console.error("[Encore] Calibration failed:", e);
      this.dom.calibTitle.text("CALIBRATION FAILED");
      this.dom.calibText.html(
        `Could not get a reliable measurement.<br>Please check your microphone input, speaker volume, and reduce background noise.`,
      );
      this.infoBar.showTemp("CALIBRATION", "Failed. Please try again.", 5000);
    }
    await new Promise((r) => setTimeout(r, 6000));
    this.dom.calibrationScreen.classOff("visible");
    this.state.isTransitioning = false;
  }

  // --- Input Handling ---

  handleKeyDown(e) {
    if (this.mixer.isVisible) {
      this.mixer.handleKeyDown(e);
      return;
    }

    if (this.state.isYtSkipWarningActive && e.key === "ArrowUp") {
      e.preventDefault();
      this.extendYoutubeSkip();
      return;
    }

    // SCORE SCREEN SKIP LOGIC
    if (this.state.isScoreScreenActive) {
      if (["Enter", " ", "Escape"].includes(e.key)) {
        if (this.state.scoreSkipResolver) {
          this.state.scoreSkipResolver();
        }
        e.preventDefault();
      }
      return;
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
      // Any interaction key will show the song list
      if (
        (e.key >= "0" && e.key <= "9") ||
        e.key.startsWith("Arrow") ||
        e.key.toLowerCase() === "y"
      ) {
        this.showTheSongList();
      }
    }

    if (e.key.toLowerCase() === "m") {
      this.mixer.toggle();
      return;
    }
    if (e.key.toLowerCase() === "r") {
      if (this.state.mode === "player" && !this.state.currentSongIsYouTube)
        this.recorder.toggle();
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
    else if (e.key.toLowerCase() === "c" && this.state.mode === "menu")
      this.runCalibrationSequence();
  }

  handleDigitInput(digit) {
    const target =
      this.state.mode === "player" ? "reservationNumber" : "songNumber";
    this.state[target] =
      this.state[target].length >= 5 ? digit : this.state[target] + digit;
    if (this.state.mode !== "player") {
      this.Forte.playSfx(`/assets/audio/numbers/${digit}.wav`);
      this.state.isTypingNumber = true;
      this.updateMenuUI();
    } else {
      this._updateReservationUI(false);
    }
  }

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
    } else if (
      this.state.mode === "yt-search" &&
      !this.dom.searchInput.getValue()
    )
      this.setMode("menu");
  }

  _updateReservationUI(isTemp) {
    const displayCode = this.state.reservationNumber.padStart(5, "0");
    const song = this.songMap.get(displayCode);

    // Generate Badge
    let fmtBadge = "";
    if (song) {
      const fmt = this.getFormatInfo(song);
      fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
    }

    let songInfo = song
      ? `${fmtBadge} <span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>`
      : this.state.reservationNumber.length === 5
        ? `<span style="opacity: 0.5;">No song found.</span>`
        : "";
    const content = `<span class="info-bar-code">${displayCode}</span> ${songInfo}`;

    if (isTemp) {
      this.infoBar.showTemp("RESERVING", content, 3000);
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
      this.infoBar.showBar(); // Explicitly show bar since we are typing
    }
  }

  handleEnter() {
    if (this.state.mode === "menu") {
      if (this.state.reservationQueue.length)
        this.startPlayer(this.state.reservationQueue.shift());
      else {
        let song = this.state.songNumber
          ? this.songMap.get(this.state.songNumber.padStart(5, "0"))
          : this.state.highlightedIndex >= 0
            ? this.songList[this.state.highlightedIndex]
            : null;
        if (song) {
          this.state.songNumber = "";
          this.state.highlightedIndex = -1;
          this.state.isTypingNumber = false;
          this.startPlayer(song);
        }
      }
    } else if (this.state.mode === "player") {
      if (
        this.state.isSearchOverlayVisible &&
        this.state.highlightedSearchIndex !== -1
      ) {
        const res = this.state.searchResults[this.state.highlightedSearchIndex];
        const song =
          res.type === "local"
            ? { ...res }
            : {
                title: res.title,
                artist: res.channelTitle,
                path: `yt://${res.id}`,
                durationText: res.length?.simpleText,
                isLive: res.isLive,
              };
        this.state.reservationQueue.push(song);
        const codeSpan = song.code
          ? `<span class="info-bar-code">${song.code}</span>`
          : `<span class="info-bar-code is-youtube">YT</span>`;

        // Generate Badge
        const fmt = this.getFormatInfo(song);
        const fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;

        this.infoBar.showTemp(
          "RESERVED",
          `${codeSpan} ${fmtBadge} <span class="info-bar-title">${song.title}</span>`,
          4000,
        );
        this.toggleSearchOverlay(false);
      } else if (this.state.reservationNumber) {
        const song = this.songMap.get(
          this.state.reservationNumber.padStart(5, "0"),
        );
        if (song) {
          this.state.reservationQueue.push(song);
          this.infoBar.showDefault();
        }
        this.state.reservationNumber = "";
      }
    } else if (
      this.state.mode === "yt-search" &&
      this.state.highlightedSearchIndex !== -1
    ) {
      const res = this.state.searchResults[this.state.highlightedSearchIndex];
      const song =
        res.type === "local"
          ? { ...res }
          : {
              title: res.title,
              artist: res.channelTitle,
              path: `yt://${res.id}`,
              durationText: res.length?.simpleText,
              isLive: res.isLive,
            };
      this.startPlayer(song);
    }
  }

  handleEscape() {
    if (this.state.isTransitioning) return;
    if (this.state.isSearchOverlayVisible) {
      this.toggleSearchOverlay(false);
      return;
    }
    if (this.state.mode === "menu") {
      if (this.state.isTypingNumber) {
        this.state.songNumber = "";
        this.state.isTypingNumber = false;
        this.updateMenuUI();
      } else if (this.state.showSongList) {
        // If list is shown, hide it and go back to standby
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
    } else if (this.state.mode === "yt-search") this.setMode("menu");
  }

  handleNav(dir) {
    if (this.state.mode === "menu") {
      const change = dir === "down" ? 1 : -1;
      this.state.songNumber = "";
      this.state.isTypingNumber = false;
      let idx = this.state.highlightedIndex + change;
      this.state.highlightedIndex = Math.max(
        0,
        Math.min(this.songList.length - 1, idx),
      );
      this.updateMenuUI();
    } else if (
      this.state.mode === "yt-search" ||
      this.state.isSearchOverlayVisible
    ) {
      const change = dir === "down" ? 1 : -1;
      const focused = document.activeElement === this.dom.searchInput.elm;
      if (focused && change > 0) {
        this.dom.searchInput.elm.blur();
        this.state.highlightedSearchIndex = 0;
      } else if (
        !focused &&
        change < 0 &&
        this.state.highlightedSearchIndex <= 0
      ) {
        this.state.highlightedSearchIndex = -1;
        this.dom.searchInput.elm.focus();
      } else
        this.state.highlightedSearchIndex = Math.max(
          0,
          Math.min(
            this.state.searchResults.length - 1,
            this.state.highlightedSearchIndex + change,
          ),
        );
      this.updateSearchHighlight();
    } else if (this.state.mode === "player") {
      // Transpose
      if (this.state.currentSongIsYouTube) return;
      const change = dir === "up" ? 1 : -1;
      const cur = this.Forte.getPlaybackState().transpose || 0;
      const next = Math.max(-24, Math.min(24, cur + change));
      this.Forte.setTranspose(next);
      this.infoBar.showTemp("TRANSPOSE", (next > 0 ? "+" : "") + next, 3000);
    }
  }

  handlePan(dir) {
    if (this.state.mode !== "player") return;
    const pb = this.Forte.getPlaybackState();
    if (!pb.isMultiplexed) return;
    const change = dir === "right" ? 0.2 : -0.2;
    const pan = Math.max(
      -1,
      Math.min(1, parseFloat((pb.multiplexPan + change).toFixed(1))),
    );
    this.Forte.setMultiplexPan(pan);
    let txt = "BALANCED";
    if (pan <= -0.99) {
      txt = "INSTRUMENTAL";
      generateDialog(
        new Html("div").classOn("temp-dialog-text").text("VOCAL OFF"),
      );
    } else if (pan >= 0.99) {
      txt = "VOCAL GUIDE";
      generateDialog(
        new Html("div").classOn("temp-dialog-text").text("INST. OFF"),
      );
    } else {
      txt =
        pan < 0
          ? `◀ ${Math.abs(Math.round(pan * 100))}% INST`
          : `VOC ${Math.round(pan * 100)}% ▶`;
    }
    this.infoBar.showTemp("VOCAL BALANCE", txt, 3000);
  }

  handleVolume(dir) {
    this.state.volume = Math.max(
      0,
      Math.min(1, this.state.volume + (dir === "up" ? 0.05 : -0.05)),
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
      3000,
    );
    window.config.setItem(
      "audioConfig.mix.instrumental.volume",
      this.state.volume,
    );
  }

  handleBracket(key) {
    if (this.state.currentSongIsMV) {
      this.state.videoSyncOffset += key === "]" ? 10 : -10;
      this.infoBar.showTemp(
        "VIDEO SYNC",
        (this.state.videoSyncOffset > 0 ? "+" : "") +
          this.state.videoSyncOffset +
          " ms",
        3000,
      );
      window.config.setItem(
        "videoConfig.syncOffset",
        this.state.videoSyncOffset,
      );
    } else {
      this.bgv.cycleCategory(key === "[" ? -1 : 1);
      const cats = ["Auto", ...this.bgv.categories.map((c) => c.BGV_CATEGORY)];
      const html = cats
        .map(
          (c) =>
            `<span class="bgv-category-item ${
              c === this.bgv.selectedCategory ? "selected" : ""
            }">${c}</span>`,
        )
        .join("");
      this.infoBar.showTemp("BGV", html, 3000);
    }
  }

  handleYKey() {
    if (this.state.isTransitioning) return;
    if (this.state.mode === "menu") this.setMode("yt-search");
    else if (this.state.mode === "player")
      this.toggleSearchOverlay(!this.state.isSearchOverlayVisible);
  }

  setupSocketListeners() {
    this.socket.on("join", (joinInformation) => {
      if (joinInformation.type == "remote") {
        this.state.knownRemotes[joinInformation.identity] = {
          connectedAt: new Date(Date.now()).toISOString(),
          commandsSent: 0,
        };
        console.log("[LINK] New remote connected.", this.state.knownRemotes);
        this.infoBar.showTemp("LINK", "A new Remote has connected.", 5000);
      }
    });
    this.socket.on("leave", (leaveInformation) => {
      delete this.state.knownRemotes[leaveInformation.identity];
      console.log("[LINK] Remote disconnected.", this.state.knownRemotes);
    });
    this.socket.on("execute-command", (cmd) => {
      const d = cmd.data;
      switch (d.type) {
        case "digit":
          this.showTheSongList();
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
              5000,
            );
            generateDialog(
              new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
              2000,
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
            data: { type: "songlist", contents: this.songList },
          });
          break;
        case "reserve_code":
          const s = this.songMap.get(d.value.padStart(5, "0"));
          if (s) {
            this.state.mode === "menu"
              ? this.startPlayer(s)
              : (this.state.reservationQueue.push(s),
                this.infoBar.showDefault());
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "reserve_response",
                success: true,
                song: { code: s.code, title: s.title, artist: s.artist },
              },
            });
          } else {
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: { type: "reserve_response", success: false },
            });
          }
          break;
      }
    });
  }

  destroy() {
    if (this.boundKeydown)
      window.removeEventListener("keydown", this.boundKeydown);
    if (this.boundPlaybackUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.Update",
        this.boundPlaybackUpdate,
      );
    this.cleanupPlayerEvents();
    if (this.recorder.isRecording) this.recorder.stop();
    this.bgv.stop();
    this.Forte.stopTrack();
    this.wrapper.cleanup();
  }
}

let controller;

const pkg = {
  name: "Encore Home",
  type: "app",
  privs: 0,
  start: async function (Root) {
    const config = await window.config.getAll();
    controller = new EncoreController(Root, config);
    await controller.init();
  },
  end: async function () {
    if (controller) {
      controller.destroy();
      controller = null;
    }
  },
};

export default pkg;
