import Html from "/libs/html.js";
import Romanizer from "/modules/Romanizer.js";
import { MixerModule } from "/modules/Mixer.js";
import { BGVModule } from "/modules/BGVPlayer.js";
import { RecorderModule } from "/modules/Recorder.js";
import { InfoBarModule } from "/modules/InfoBar.js";
import { ScoreHUDModule } from "/modules/ScoreHUD.js";

class EncoreController {
  constructor(Root, config) {
    this.Root = Root;
    this.Pid = Root.Pid;
    this.Ui = Root.Processes.getService("UiLib").data;
    this.FsSvc = Root.Processes.getService("FsSvc").data;
    this.Forte = Root.Processes.getService("ForteSvc").data;
    this.config = config;

    // --- State Management ---
    this.songList = [];
    this.songMap = new Map();

    this.state = {
      mode: "menu",
      songNumber: "",
      highlightedIndex: -1,
      reservationNumber: "",
      reservationQueue: [],
      volume: config.audioConfig.mix.instrumental.volume,
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
    };

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
    );
    this.recorder = new RecorderModule(this.Forte, this.bgv, this.infoBar);

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

    // Load resources
    console.log("[Encore] Loading assets...");
    const sfx = [
      "fanfare.mp3",
      "fanfare-2.mp3",
      ...Array.from({ length: 10 }, (_, i) => `numbers/${i}.wav`),
    ];
    await Promise.all(sfx.map((s) => this.Forte.loadSfx(`/assets/audio/${s}`)));

    this.socket = io({ query: { clientType: "app" } });
    this.socket.on("connect", () => console.log("[LINK] Connected to server."));
    this.setupSocketListeners();

    try {
      const chainRes = await fetch("/pkgs/chains/defaultVocalChain.json");
      const chain = await chainRes.json();
      await this.Forte.loadVocalChain(chain);
    } catch (e) {
      console.error("[Encore] Vocal chain load failed", e);
    }

    // Load Songs
    this.songList = this.FsSvc.getSongList();
    this.songMap = new Map(this.songList.map((s) => [s.code, s]));

    window.desktopIntegration.ipc.send("setRPC", {
      details: `Browsing ${this.songList.length} Songs...`,
      state: `Main Menu`,
    });

    // Audio Config
    await this.Forte.setTrackVolume(this.state.volume);
    if (this.config.audioConfig.micLatency)
      await this.Forte.setLatency(this.config.audioConfig.micLatency);
    if (this.config.audioConfig.mix.scoring.inputDevice)
      await this.Forte.setMicDevice(
        this.config.audioConfig.mix.scoring.inputDevice,
      );

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
      progressBar: this.dom.progressBar,
      scoreDisplay: this.scoreHud.scoreDisplay,
    });

    // Event Listeners
    window.addEventListener("keydown", this.boundKeydown);
    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      this.boundPlaybackUpdate,
    );

    // Start BGV
    await this.bgv.loadManifestCategories();
    const mtvPaths = this.songList
      .filter((s) => s.videoPath)
      .map((s) => s.videoPath);
    if (mtvPaths.length)
      this.bgv.addDynamicCategory({
        BGV_CATEGORY: "MTV",
        BGV_LIST: mtvPaths,
        isAbsolute: true,
      });

    await this.bgv.updatePlaylistForCategory();

    setTimeout(() => {
      this.wrapper.classOff("loading");
      this.Ui.transition("fadeIn", this.wrapper);
      this.setMode("menu");
    }, 100);
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
    this.dom.searchUi = new Html("div")
      .classOn("search-ui")
      .appendTo(this.wrapper);
    this.dom.playerUi = new Html("div")
      .classOn("player-ui", "hidden")
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
    const mainContent = new Html("div")
      .classOn("main-content")
      .appendTo(this.dom.overlay);
    new Html("h1").text("Enter Song Number").appendTo(mainContent);
    this.dom.numberDisplay = new Html("div")
      .classOn("number-display")
      .appendTo(mainContent);

    const songInfo = new Html("div").classOn("song-info").appendTo(mainContent);
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
    this.songList.forEach((song, index) => {
      const item = new Html("div")
        .classOn("song-item")
        .appendTo(this.dom.songListContainer);
      new Html("div").classOn("song-item-code").text(song.code).appendTo(item);
      new Html("div")
        .classOn("song-item-title")
        .text(song.title)
        .appendTo(item);
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
    });

    // --- Bottom Actions ---
    const actions = new Html("div")
      .classOn("bottom-actions")
      .appendTo(this.dom.overlay);
    new Html("div")
      .classOn("action-button")
      .text("Search (Y)")
      .on("click", () => this.setMode("yt-search"))
      .appendTo(actions);
    new Html("div")
      .classOn("action-button")
      .text("Calibrate Audio (C)")
      .on("click", () => this.runCalibrationSequence())
      .appendTo(actions);
    new Html("div")
      .classOn("action-button")
      .text("Mic/Music Setup (M)")
      .on("click", () => this.mixer.toggle())
      .appendTo(actions);

    // --- QR Code ---
    this.buildQR();

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
    this.dom.introCard = new Html("div")
      .classOn("intro-card")
      .appendTo(this.dom.playerUi);
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

    this.dom.playerProgress = new Html("div")
      .classOn("player-progress")
      .appendTo(bottom);
    this.dom.progressBar = new Html("div")
      .classOn("progress-bar")
      .appendTo(this.dom.playerProgress);
  }

  buildPostSongScreen() {
    this.dom.postSongScreen = new Html("div")
      .classOn("post-song-score-screen")
      .appendTo(this.wrapper);
    const card = new Html("div")
      .classOn("score-card")
      .appendTo(this.dom.postSongScreen);
    const head = new Html("div").classOn("score-header").appendTo(card);
    new Html("div")
      .classOn("score-header-title")
      .text("YOUR SCORE")
      .appendTo(head);
    new Html("div")
      .classOn("score-header-subtitle")
      .text("ADVANCED SCORING")
      .appendTo(head);

    const main = new Html("div").classOn("score-main").appendTo(card);
    const final = new Html("div")
      .classOn("final-score-container")
      .appendTo(main);
    new Html("div")
      .classOn("final-score-label")
      .text("YOUR SCORE")
      .appendTo(final);
    this.dom.finalScoreDisplay = new Html("div")
      .classOn("final-score")
      .appendTo(final);

    const details = new Html("div").classOn("score-details").appendTo(card);
    const createGauge = (label, cls) => {
      const c = new Html("div")
        .classOn("score-gauge-container")
        .appendTo(details);
      new Html("span").classOn("score-gauge-label").text(label).appendTo(c);
      const g = new Html("div").classOn("score-gauge", cls).appendTo(c);
      const v = new Html("span").classOn("score-gauge-value").appendTo(g);
      return { gauge: g, valueDisplay: v };
    };
    this.dom.gauges = {
      keyRhythm: createGauge("Key/Rhythm", "gauge-key-rhythm"),
      vibrato: createGauge("Vibrato", "gauge-vibrato"),
      upband: createGauge("Upband", "gauge-upband"),
      downband: createGauge("Downband", "gauge-downband"),
    };
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
      this.dom.overlay.classOff("hidden");
      this.dom.searchInput.elm.blur();
      this.infoBar.hideBar();
      this.updateMenuUI();
    } else if (newMode === "player") {
      if (this.state.currentSongIsMultiplexed)
        this.Forte.togglePianoRollVisibility(true);
      this.dom.playerUi.classOff("hidden");
      this.infoBar.showDefault();
      this.infoBar.showBar();
    } else if (newMode === "yt-search") {
      if (this.state.currentSongIsMultiplexed)
        this.Forte.togglePianoRollVisibility(false);
      this.dom.searchInput.elm.focus();
      this.dom.searchInput.elm.select();
    }
  }

  updateMenuUI() {
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
    this.songList.forEach((s) => {
      if (
        (s.title.toLowerCase().includes(query) ||
          s.artist.toLowerCase().includes(query)) &&
        !localResults.find((x) => x.code === s.code)
      )
        localResults.push({ ...s, type: "local" });
    });

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
      if (res.type === "local") {
        new Html("div")
          .classOn("search-result-local-code")
          .text(res.code)
          .appendTo(item);
        new Html("div").classOn("search-title").text(res.title).appendTo(info);
        new Html("div")
          .classOn("search-channel")
          .text(res.artist)
          .appendTo(info);
      } else {
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
        new Html("div")
          .classOn("search-title")
          .text(res.title)
          .appendTo(titleC);
        new Html("span")
          .classOn("search-youtube-badge")
          .text("YT")
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
    this.dom.lrcLineDisplay1.clear();
    this.dom.lrcLineDisplay2.clear();
    this.dom.midiLineDisplay1.clear();
    this.dom.midiLineDisplay2.clear();
    this.scoreHud.hide();
    this.dom.introCard.classOff("visible");

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
      this.dom.lrcContainer.classOn("hidden");
      this.dom.midiContainer.classOn("hidden");
      this.dom.playerProgress.classOn("hidden");
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
      this.dom.playerProgress.classOff("hidden");

      const trackUrl = new URL("http://127.0.0.1:9864/getFile");
      trackUrl.searchParams.append("path", song.path);
      await this.Forte.loadTrack(trackUrl.href);

      const pbState = this.Forte.getPlaybackState();
      this.state.currentSongIsMultiplexed = pbState.isMultiplexed;
      if (this.state.currentSongIsMultiplexed) {
        this.scoreHud.show(0);
        this.Forte.togglePianoRollVisibility(true);
      }

      this.dom.introTitle.text(song.title);
      this.dom.introArtist.text(song.artist);
      this.dom.introCard.classOn("visible");

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
        this.dom.lrcContainer.styleJs({ opacity: "1" });
        this.dom.midiContainer.styleJs({ opacity: "1" });
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

      const allSyllables = [];
      const lines = [];
      let currentLineSyllables = [];
      let displayableSyllableIndex = 0;

      for (const syllableText of pbState.decodedLyrics) {
        const isNewLine = /[\r\n\/\\]/.test(syllableText);
        const cleanText = syllableText.replace(/[\r\n\/\\]/g, "");
        if (cleanText) {
          const romanized = await Romanizer.romanize(cleanText);
          const syllable = {
            text: cleanText,
            romanized: romanized,
            globalIndex: displayableSyllableIndex,
            lineIndex: lines.length,
          };
          allSyllables.push(syllable);
          currentLineSyllables.push(syllable);
          displayableSyllableIndex++;
        }
        if (isNewLine && currentLineSyllables.length > 0) {
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

      const renderLine = (displayEl, lineData) => {
        displayEl.clear();
        if (!lineData) return;
        lineData.forEach((s) => {
          const container = new Html("div")
            .classOn("lyric-syllable-container")
            .attr({ "data-index": s.globalIndex })
            .appendTo(displayEl);
          new Html("span")
            .classOn("lyric-syllable-original")
            .attr({ "data-text": s.text })
            .text(s.text)
            .appendTo(container);
          if (s.romanized) {
            new Html("span")
              .classOn("lyric-syllable-romanized")
              .attr({ "data-text": s.romanized })
              .text(s.romanized)
              .appendTo(container);
          }
        });
      };

      // Initial render
      displayLines.forEach((line) => line.clear().classOff("active", "next"));
      renderLine(displayLines[0], lines[0]);
      renderLine(displayLines[1], lines[1]);
      displayLines[0].classOn("active");
      displayLines[1].classOn("next");

      // Define Event Handler
      this.boundLyricEvent = (e) => {
        const { index } = e.detail;
        if (index >= allSyllables.length) return;
        const activeSyllable = allSyllables[index];

        if (activeSyllable.lineIndex !== currentSongLineIndex) {
          currentSongLineIndex = activeSyllable.lineIndex;
          const activeDisplay = displayLines[currentSongLineIndex % 2];
          const nextDisplay = displayLines[(currentSongLineIndex + 1) % 2];
          activeDisplay.classOn("active").classOff("next");
          nextDisplay.classOff("active").classOn("next");
          renderLine(nextDisplay, lines[currentSongLineIndex + 1]);
        }
        const newSyllableEl = this.wrapper.qs(
          `.lyric-syllable-container[data-index="${index}"]`,
        );
        if (newSyllableEl) newSyllableEl.classOn("active");
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
        // Initial Render
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
      const { currentTime, duration } = e.detail;
      this.dom.progressBar.styleJs({
        width: `${(currentTime / duration) * 100}%`,
      });

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
              this.nextLineUpdateTimeout = setTimeout(() => {
                this.renderLrcLine(next, nextLine);
              }, (nextLine.time - curLine.time) * 500);
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
    this.dom.bgvContainer.classOff("hidden");
    this.Forte.stopTrack();
    this.cleanupPlayerEvents();
    this.dom.countdownDisplay.classOff("visible").text("");
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
    this.dom.finalScoreDisplay.text("0.00");
    this.dom.postSongScreen.classOn("visible");
    this.Forte.playSfx("/assets/audio/fanfare.mp3");
    await new Promise((r) => setTimeout(r, 500));

    // Helper to animate numbers
    const animateNumber = (element, target, duration, isFloat = true) => {
      return new Promise((res) => {
        let start = 0;
        const st = performance.now();
        const tick = () => {
          const p = Math.min((performance.now() - st) / duration, 1);
          const val = start + (target - start) * p;
          element.text(isFloat ? val.toFixed(2) : Math.round(val));
          if (p < 1) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      });
    };

    // Helper to animate gauges (handles width via css-var and text display)
    const animateGauge = (gaugeCtx, target, duration) => {
      return new Promise((res) => {
        const { gauge, valueDisplay } = gaugeCtx;
        let start = 0;
        const st = performance.now();
        const tick = () => {
          const p = Math.min((performance.now() - st) / duration, 1);
          const val = start + (target - start) * p;
          gauge.styleJs({ "--value": val });
          valueDisplay.text(Math.round(val) + "%");
          if (p < 1) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      });
    };

    await animateNumber(
      this.dom.finalScoreDisplay,
      scoreData.finalScore,
      2000,
      true,
    );
    await Promise.all([
      animateGauge(
        this.dom.gauges.keyRhythm,
        scoreData.details.pitchAndRhythm,
        1500,
      ),
      animateGauge(this.dom.gauges.vibrato, scoreData.details.vibrato, 1500),
      animateGauge(this.dom.gauges.upband, scoreData.details.upband, 1500),
      animateGauge(this.dom.gauges.downband, scoreData.details.downband, 1500),
    ]);
    await new Promise((r) => setTimeout(r, 7000));
    this.dom.postSongScreen.classOff("visible");
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
      this.config.audioConfig.micLatency = lat;
      window.desktopIntegration.ipc.send("updateConfig", this.config);
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
      this.infoBar.showReservation(this.state.reservationNumber);
    }
  }

  handleBackspace() {
    if (this.state.isSearchOverlayVisible && !this.dom.searchInput.getValue())
      this.toggleSearchOverlay(false);
    else if (this.state.mode === "player" && this.state.reservationNumber) {
      this.state.reservationNumber = this.state.reservationNumber.slice(0, -1);
      this.state.reservationNumber
        ? this.infoBar.showReservation(this.state.reservationNumber)
        : this.infoBar.showDefault();
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
              };
        this.state.reservationQueue.push(song);
        const codeSpan = song.code
          ? `<span class="info-bar-code">${song.code}</span>`
          : `<span class="info-bar-code is-youtube">YT</span>`;
        this.infoBar.showTemp("RESERVED", `${codeSpan} ${song.title}`, 4000);
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
    if (this.state.mode === "menu" && this.state.isTypingNumber) {
      this.state.songNumber = "";
      this.state.isTypingNumber = false;
      this.updateMenuUI();
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
    if (pan <= -0.99) txt = "INSTRUMENTAL";
    else if (pan >= 0.99) txt = "VOCAL GUIDE";
    else
      txt =
        pan < 0
          ? `◀ ${Math.abs(Math.round(pan * 100))}% INST`
          : `VOC ${Math.round(pan * 100)}% ▶`;
    this.infoBar.showTemp("VOCAL BALANCE", txt, 3000);
  }

  handleVolume(dir) {
    this.state.volume = Math.max(
      0,
      Math.min(1, this.state.volume + (dir === "up" ? 0.05 : -0.05)),
    );
    this.Forte.setTrackVolume(this.state.volume);
    const p = Math.round(this.state.volume * 100);
    this.infoBar.showTemp(
      "VOLUME",
      `<div class="volume-display"><div class="volume-slider-container"><div class="volume-slider-fill" style="width: ${p}%"></div></div><span class="volume-percentage">${p}%</span></div>`,
      3000,
    );
    this.config.audioConfig.mix.instrumental.volume = this.state.volume;
    window.desktopIntegration.ipc.send("updateConfig", this.config);
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
      this.config.videoConfig = {
        ...this.config.videoConfig,
        syncOffset: this.state.videoSyncOffset,
      };
      window.desktopIntegration.ipc.send("updateConfig", this.config);
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
    this.socket.on("execute-command", (cmd) => {
      const d = cmd.data;
      switch (d.type) {
        case "digit":
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
          this.handleBracket("]");
          break;
        case "yt_search_open":
          if (!this.state.isTransitioning) this.handleYKey();
          break;
        case "yt_search_close":
          if (this.state.mode === "yt-search") this.setMode("menu");
          else this.toggleSearchOverlay(false);
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
    const config = await window.desktopIntegration.ipc.invoke("getConfig");
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
