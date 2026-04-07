import Html from "/libs/html.js";
import Romanizer from "/modules/Romanizer.js";
import generateDialog from "/modules/Dialog.js";
import { MixerModule } from "/modules/Mixer.js";
import { BGVModule } from "/modules/BGVPlayer.js";
import { RecorderModule } from "/modules/Recorder.js";
import { InfoBarModule } from "/modules/InfoBar.js";
import { ScoreHUDModule } from "/modules/ScoreHUD.js";

const INTERLUDE_TIPS = [
  "TIP: You can use your phone to queue songs by scanning the QR code!",
  "Take a deep breath and get ready for the next verse.",
  "”Maybe there's only a dark road up ahead. But you still have to believe and keep going. Believe that the stars will light your path, even a little bit.” - Kaori Miyazono, Your Lie in April",
  "”Music speaks louder than words” - Kousei Arima, Your Lie in April",
  "Grab a drink and rest your vocal cords.",
  "TIP: Press F2 to enter the setup menu when playback is stopped.",
  "Adjust the instrumental volume using the - and = keys.",
  "”Rock resonates as the music of the perpetual underdog. Is it really rock if it's sung by life's winners?” - Hitori Gotoh, Bocchi The Rock!",
  "TIP: You can search for songs by title, artist, or song number by pressing Y.",
  "”Get freaky 🤑🤑” - Stariix, Encore Karaoke Labs",
];

let TEMP_TIPS = structuredClone(INTERLUDE_TIPS);

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

/**
 * Main Controller for the Encore Karaoke Home interface.
 * Manages playback, UI state, song selection, searches, and socket communication.
 */
class EncoreController {
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
      scoreSkipped: false,
      showSongList: false,
      chatHistory: [],
      deviceRegistry: {},
      activeSockets: {},
      typingUsers: new Set(),
      cheerQueue: [],
      isCheering: false,
    };

    this.bumperImages = [];
    this.currentBumperIndex = 0;
    this.bumperInterval = null;
    this.versionInformation = null;

    console.log(this.state);

    this.mixer = new MixerModule(this.Forte);
    this.bgv = new BGVModule();
    this.scoreHud = new ScoreHUDModule();
    this.infoBar = new InfoBarModule(
      () => ({
        reservationQueue: this.state.reservationQueue,
        songMap: this.songMap,
      }),
      () => (this.recorder ? this.recorder.isRecording : false),
      (s) => this.getFormatInfo(s),
    );
    this.recorder = new RecorderModule(
      this.Forte,
      this.bgv,
      this.infoBar,
      generateDialog,
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
  }

  /**
   * Bootstraps the application, loads assets, builds the UI, and initializes playback mechanisms.
   *
   * @returns {Promise<void>}
   */
  async init() {
    this.wrapper = new Html("div").classOn("full-ui").appendTo("body");
    this.wrapper.classOn("loading");

    this.state.windowsVolume = await window.volume.getVolume();
    console.log("[Encore] Windows volume", this.state.windowsVolume);

    console.log("[Encore] Loading assets...");
    const sfx = [
      "fanfare.mid",
      ...Array.from({ length: 10 }, (_, i) => `numbers/${i}.wav`),
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
    this.songMap = new Map(this.songList.map((s) => [s.code, s]));
    this.socket.emit("broadcastData", {
      type: "ready",
    });

    window.desktopIntegration.ipc.send("setRPC", {
      details: `Browsing ${this.songList.length} Songs...`,
      state: `Main Menu`,
    });

    this.versionInformation = await window.version.getVersionInformation();
    console.log(
      `Encore ${this.versionInformation.channel} running in version ${this.versionInformation.number}`,
    );
    document.title = `Encore Karaoke ${this.versionInformation.channel} v${this.versionInformation.number} (${this.versionInformation.codename})`;

    await this.Forte.setTrackVolume(this.state.volume);
    if (this.config.audioConfig?.micLatency) {
      await this.Forte.setLatency(this.config.audioConfig.micLatency);
    }

    const micDevice = this.config.audioConfig?.mix?.scoring?.inputDevice;
    if (micDevice) {
      await this.Forte.setMicDevice(micDevice);
    } else {
      await this.Forte.setMicDevice("default");
    }

    this.buildUI();

    this.infoBar.mount(this.wrapper);

    const isKioskEnabled = await window.kiosk.isEnabled();
    if (isKioskEnabled) {
      this.infoBar.showTemp(
        "KIOSK MODE",
        "Fullscreen enabled. Alt+Tab and Start Menu disabled.",
        5000,
      );
    }

    this.scoreHud.mount(this.wrapper);
    this.mixer.mount(this.wrapper);
    this.bgv.mount(this.dom.bgvContainer);
    this.recorder.mount(this.wrapper);
    this.recorder.setUiRefs({
      playerUi: this.dom.playerUi,
      lrcContainer: this.dom.lrcContainer,
      lrcLineDisplay1: this.dom.lrcLineDisplay1,
      lrcLineDisplay2: this.dom.lrcLineDisplay2,
      midiContainer: this.dom.midiContainer,
      midiLineDisplay1: this.dom.midiLineDisplay1,
      midiLineDisplay2: this.dom.midiLineDisplay2,
      scoreDisplay: this.scoreHud.scoreDisplay,
    });

    window.addEventListener("keydown", this.boundKeydown);
    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      this.boundPlaybackUpdate,
    );

    console.log("MANIFEST", this.libraryInfo);
    if (this.libraryInfo.manifest?.additionalContents?.bgvCategories) {
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
    }

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
   * Schedules an automatic skip/transition for a YouTube track after its duration elapses.
   *
   * @param {number} seconds - The duration in seconds.
   */
  scheduleYoutubeSkip(seconds) {
    this.clearYoutubeTimers();

    const totalMs = (seconds + 5) * 1000;
    const warningDuration = 10 * 1000;
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

  /**
   * Extends the YouTube auto-skip timer by an additional 30 seconds.
   */
  extendYoutubeSkip() {
    if (!this.state.isYtSkipWarningActive) return;

    this.clearYoutubeTimers();
    this.state.isYtSkipWarningActive = false;

    this.scheduleYoutubeSkip(35);

    this.infoBar.showTemp("EXTENDED", "Time extended by 30 seconds.", 3000);
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

    this.buildPostSongScreen();

    this.dom.calibrationScreen = new Html("div")
      .classOn("calibration-screen")
      .appendTo(this.wrapper);
    this.dom.calibTitle = new Html("h1").appendTo(this.dom.calibrationScreen);
    this.dom.calibText = new Html("p").appendTo(this.dom.calibrationScreen);

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

    this.buildQR();

    const vi = this.versionInformation || {
      channel: "",
      number: "",
      codename: "",
    };

    new Html("div")
      .classOn("version-badge")
      .text(`${vi.channel} v${vi.number} (${vi.codename})`.trim())
      .appendTo(this.wrapper);

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

    this.dom.introCard = new Html("div").classOn("intro-card").appendTo("body");

    const introContent = new Html("div")
      .classOn("intro-card-content")
      .appendTo(this.dom.introCard);
    this.dom.introTitle = new Html("div")
      .classOn("intro-card-title")
      .appendTo(introContent);
    this.dom.introArtist = new Html("div")
      .classOn("intro-card-artist")
      .appendTo(introContent);
    this.dom.introMeta = new Html("div")
      .classOn("intro-card-meta")
      .appendTo(introContent);

    this.dom.interludeOverlay = new Html("div")
      .classOn("interlude-overlay")
      .appendTo(this.wrapper);

    new Html("div")
      .classOn("interlude-text")
      .text("INTERLUDE")
      .appendTo(this.dom.interludeOverlay);

    this.dom.interludeTipBox = new Html("div")
      .classOn("interlude-tip-box")
      .appendTo(this.dom.interludeOverlay);

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

    this.dom.cheerOverlayContainer = new Html("div")
      .classOn("cheer-overlay-container")
      .styleJs({
        position: "absolute",
        top: "20px",
        left: "-500px",
        zIndex: "9000",
        transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        backgroundColor: "rgba(20, 20, 30, 0.9)",
        border: "2px solid #ffd700",
        borderRadius: "15px",
        padding: "15px 25px",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
        maxWidth: "400px",
      })
      .appendTo(this.wrapper);

    this.dom.cheerHeader = new Html("div")
      .styleJs({
        color: "#ffd700",
        fontWeight: "700",
        fontSize: "1.2rem",
        marginBottom: "5px",
      })
      .appendTo(this.dom.cheerOverlayContainer);

    this.dom.cheerMessage = new Html("div")
      .styleJs({
        color: "#fff",
        fontSize: "1.5rem",
        fontWeight: "600",
        wordWrap: "break-word",
      })
      .appendTo(this.dom.cheerOverlayContainer);
  }

  /**
   * Constructs the score results overlay shown after performance completion.
   */
  buildPostSongScreen() {
    this.dom.postSongScreen = new Html("div")
      .classOn("post-song-screen-overlay")
      .appendTo(this.wrapper);

    new Html("div")
      .classOn("score-title-text")
      .text("YOUR SCORE")
      .appendTo(this.dom.postSongScreen);

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

    new Html("div")
      .classOn("score-skip-hint")
      .text("PRESS ENTER TO CONTINUE")
      .appendTo(this.dom.postSongScreen);
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
    this.dom.qrContainer = new Html("div")
      .classOn("qr-code-container")
      .appendTo(this.wrapper);

    const counterBadge = new Html("div")
      .classOn("qr-counter-badge")
      .appendTo(this.dom.qrContainer);

    counterBadge.html(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`,
    );

    this.dom.qrConnectedCount = new Html("span")
      .text("0")
      .appendTo(counterBadge);

    const imgWrapper = new Html("div")
      .classOn("qr-image-wrapper")
      .appendTo(this.dom.qrContainer);
    const img = new Html("img").appendTo(imgWrapper);

    let remoteUrl = ``;

    fetch("http://127.0.0.1:9864/cloud_info")
      .then((r) => r.json())
      .then((info) => {
        if (!info.roomCode) {
          fetch("http://127.0.0.1:9864/local_ip")
            .then((r) => r.text())
            .then((ip) => {
              const remoteUrl = `http://${ip}:9864/remote`;
              img.attr({
                src: `http://127.0.0.1:9864/qr?url=${encodeURIComponent(remoteUrl)}`,
              });
            })
            .catch((e) => this.dom.qrContainer.classOn("hidden"));
          return;
        }

        const remoteUrl = `${info.relayUrl}/?room=${info.roomCode}`;
        img.attr({
          src: `http://127.0.0.1:9864/qr?url=${encodeURIComponent(remoteUrl)}`,
        });
      })
      .catch((e) => this.dom.qrContainer.classOn("hidden"));

    this.updateRemoteCount();
  }

  /**
   * Processes the queue of incoming cheers and sequentially shows their overlay animations.
   */
  processCheerQueue() {
    if (this.state.isCheering || this.state.cheerQueue.length === 0) return;

    this.state.isCheering = true;
    const cheer = this.state.cheerQueue.shift();

    this.dom.cheerHeader.html(`🎉 <span>${cheer.nickname}</span> cheers:`);
    this.dom.cheerMessage.text(cheer.message);
    this.dom.cheerOverlayContainer.styleJs({ left: "20px" });

    setTimeout(() => {
      this.dom.cheerOverlayContainer.styleJs({ left: "-500px" });
      setTimeout(() => {
        this.state.isCheering = false;
        this.processCheerQueue();
      }, 600);
    }, 5000);
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

    const otherNames = Object.entries(this.state.deviceRegistry)
      .filter(([id, _]) => id !== deviceId)
      .map(([_, data]) => data.nickname.toLowerCase());

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

    const typingNicks = Array.from(this.state.typingUsers)
      .map((socketId) => {
        const devId = this.state.activeSockets[socketId];
        return devId && this.state.deviceRegistry[devId]
          ? this.state.deviceRegistry[devId].nickname
          : null;
      })
      .filter(Boolean);

    this.socket.emit("broadcastData", {
      type: "social_update",
      typing: typingNicks,
      usersCount: activeUsersCount,
      users: this.state.deviceRegistry,
    });
  }

  /**
   * Starts rotation of designated standby bumper images on the main screen.
   */
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
      }, 500);
    };

    const initialImage = this.bumperImages[0];
    const imageUrl = new URL("http://127.0.0.1:9864/getFile");
    imageUrl.searchParams.append("path", initialImage);
    this.dom.standbyBumper.attr({ src: imageUrl.href });

    this.bumperInterval = setInterval(cycle, 8000);
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
      setTimeout(() => {
        if (this.state.scoreSkipped) {
          this.state.scoreSkipped = false;
        }
      }, 5000);
    } else if (newMode === "player") {
      if (this.state.currentSongIsMultiplexed) {
        this.Forte.togglePianoRollVisibility(true);
      } else {
        this.Forte.togglePianoRollVisibility(false);
      }
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
  updateMenuUI() {
    if (!this.state.showSongList && this.state.mode === "menu") {
      this.dom.standbyScreen.classOff("hidden");
      this.dom.mainContent.classOn("hidden");
      this.dom.songListContainer.classOn("hidden");
      this.dom.bottomActions.classOn("hidden");
      this.dom.numberDisplay.text("");
      this.dom.songTitle.text("");
      this.dom.songArtist.text("");
      return;
    }
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
    if (/^\d+$/.test(query))
      this.songList.forEach((s) => {
        if (s.code.includes(query)) localResults.push({ ...s, type: "local" });
      });

    for (const s of this.songList) {
      if (localResults.find((x) => x.code === s.code)) continue;

      const titleMatch = s.title.toLowerCase().includes(query);
      const artistMatch = s.artist.toLowerCase().includes(query);

      let romaTitle = null;
      let romaArtist = null;

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

  /**
   * Projects search hits onto the UI window block.
   */
  renderSearchResults() {
    const prevHighlight = this.state.highlightedSearchIndex;

    this.dom.searchResultsContainer.clear();
    this.state.highlightedSearchIndex = prevHighlight;

    if (!this.state.searchResults.length) {
      this.dom.searchResultsContainer.text(
        this.state.isSearching ? "Searching..." : "No results found.",
      );
      this.dom.searchWindow.classOff("has-results");
      this.state.highlightedSearchIndex = -1;
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
      const fmt = this.getFormatInfo(res);

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
        const thumb = new Html("div")
          .classOn("search-thumbnail-wrapper")
          .appendTo(item);

        const img = new Html("img")
          .classOn("search-thumbnail")
          .styleJs({ opacity: "0", transition: "opacity 0.3s ease" })
          .appendTo(thumb);

        img.elm.onload = () => {
          img.styleJs({ opacity: "1" });
        };
        img.attr({ src: res.thumbnail.thumbnails[0].url });

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

    if (this.state.highlightedSearchIndex >= this.state.searchResults.length) {
      this.state.highlightedSearchIndex = -1;
    }

    this.updateSearchHighlight();
  }

  /**
   * Refreshes the actively selected search entry item based on index state.
   */
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

    this.dom.countdownDisplay.classOff("visible").text("");
    this.countdownTargetTime = null;
    this.lastCountdownTick = null;

    this.dom.lrcLineDisplay1.clear().classOff("active", "next");
    this.dom.lrcLineDisplay2.clear().classOff("active", "next");
    this.dom.midiLineDisplay1.clear().classOff("active", "next");
    this.dom.midiLineDisplay2.clear().classOff("active", "next");
    this.scoreHud.hide();
    this.dom.introCard.classOff("visible");
    this.dom.introMeta.clear();
    this.dom.interludeOverlay.classOff("visible");
    this.state.isInterludeActive = false;
    this.dom.formatIndicator.styleJs({ opacity: "0" });

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

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
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

      let icon = "rs.png";
      if (this.state.currentSongIsMV) icon = "mtv.png";
      else if (this.state.currentSongIsMultiplexed) icon = "mp.png";
      else if (pbState.isMidi) icon = "midi.png";

      this.dom.formatIndicator.styleJs({
        backgroundImage: `url("/assets/img/icons/${icon}")`,
        opacity: "1",
      });

      if (!this.state.currentSongIsYouTube) {
        this.scoreHud.show(0);
        this.Forte.togglePianoRollVisibility(
          this.state.currentSongIsMultiplexed,
        );
      }

      this.dom.introTitle.text(song.title);
      this.dom.introArtist.text(song.artist);
      this.dom.introCard.classOn("visible");
      this.dom.lrcContainer.styleJs({ opacity: "1" });
      this.dom.midiContainer.styleJs({ opacity: "1" });

      this.currentBpm = pbState.midiInfo
        ? pbState.midiInfo.initialBpm || 120
        : 120;
      this.boundTempoUpdate = (e) => {
        this.currentBpm = e.detail.bpm;
      };
      document.addEventListener(
        "CherryTree.Forte.Playback.TempoEvent",
        this.boundTempoUpdate,
      );

      await this.setupLyrics(song, pbState);
      this.setupTimeUpdate(mvPlayer);

      if (!this.state.currentSongIsYouTube) {
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
        setTimeout(() => {
          if (this.state.scoreSkipped) {
            this.state.scoreSkipped = false;
          }
        }, 5000);
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
        // Sort ascending by tick, resolving simultaneous events correctly by evaluating initial dummy tempos first.
        let chronologicalChanges = tempoChanges
          .map((tc, index) => {
            let tick = tc.ticks !== undefined ? tc.ticks : tc.tick;
            let val = tc.tempo || tc.bpm || 120;
            let bpm = val > 1000 ? Math.round(60000000 / val) : val;
            if (bpm <= 0) bpm = 120;
            return { tick, bpm, _originalIndex: index };
          })
          .sort((a, b) => {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return b._originalIndex - a._originalIndex;
          });

        for (let tc of chronologicalChanges) {
          if (tc.tick >= targetTick) break;

          if (tc.tick > currentTick) {
            let deltaTicks = tc.tick - currentTick;
            time += (deltaTicks / ppqm) * (60 / currentBpm);
            currentTick = tc.tick;
          }

          currentBpm = tc.bpm;
        }
      }

      let remainingTicks = targetTick - currentTick;
      if (remainingTicks > 0) {
        time += (remainingTicks / ppqm) * (60 / currentBpm);
      }

      return time;
    };

    if (pbState.isMidi) {
      this.dom.midiContainer.styleJs({ display: "flex" });
      this.dom.lrcContainer.styleJs({ display: "none" });

      const midiInfo = pbState.midiInfo;
      let ppqm = midiInfo.timeDivision || 480;
      let lyricsToParse = [...pbState.decodedLyrics];

      let displayBpm = 120;
      if (midiInfo.tempoChanges && midiInfo.tempoChanges.length > 0) {
        let initialChanges = midiInfo.tempoChanges.filter(
          (t) => (t.ticks !== undefined ? t.ticks : t.tick) === 0,
        );
        let firstTc =
          initialChanges.length > 0
            ? initialChanges[0]
            : midiInfo.tempoChanges[0];
        let val = firstTc.tempo || firstTc.bpm || 120;
        displayBpm = val > 1000 ? Math.round(60000000 / val) : Math.round(val);
      }
      this.dom.introMeta.text(`BPM: ${displayBpm}`);

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
        if (metadata.TITLE) this.dom.introTitle.text(metadata.TITLE);
        if (metadata.ARTIST) this.dom.introArtist.text(metadata.ARTIST);
      }

      const allSyllables = [];
      const lines = [];
      let currentLineSyllables = [];
      let displayableSyllableIndex = 0;
      let offsetIndex = pbState.decodedLyrics.length - lyricsToParse.length;

      for (let i = 0; i < lyricsToParse.length; i++) {
        const syllableText = lyricsToParse[i];
        const tick = midiInfo.ticks[i + offsetIndex];
        const absoluteTime = getSecondsForTick(
          tick,
          midiInfo.tempoChanges,
          ppqm,
        );

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
            tick: tick,
            absoluteTime: absoluteTime,
            durationTicks: 0,
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
          t0: getSecondsForTick(nTick, midiInfo.tempoChanges, ppqm),
        });
      }

      for (let i = 0; i < allSyllables.length - 1; i++) {
        let cur = allSyllables[i];
        let next = allSyllables[i + 1];

        cur.durationTicks = Math.max(0, next.tick - cur.tick);
        let gapTicks = next.tick - cur.tick;

        if (gapTicks >= 8 * ppqm) {
          let intStart = cur.tick + 2 * ppqm;
          let intEnd = next.tick - 4 * ppqm;

          this.interludes.push({
            start: getSecondsForTick(intStart, midiInfo.tempoChanges, ppqm),
            end: getSecondsForTick(intEnd, midiInfo.tempoChanges, ppqm),
          });

          this.countdowns.push({
            t3: getSecondsForTick(
              next.tick - 3 * ppqm,
              midiInfo.tempoChanges,
              ppqm,
            ),
            t2: getSecondsForTick(
              next.tick - 2 * ppqm,
              midiInfo.tempoChanges,
              ppqm,
            ),
            t1: getSecondsForTick(
              next.tick - 1 * ppqm,
              midiInfo.tempoChanges,
              ppqm,
            ),
            t0: getSecondsForTick(next.tick, midiInfo.tempoChanges, ppqm),
          });
        }
      }
      if (allSyllables.length > 0)
        allSyllables[allSyllables.length - 1].durationTicks = ppqm;

      this.allMidiSyllables = allSyllables;
      const displayLines = [
        this.dom.midiLineDisplay1,
        this.dom.midiLineDisplay2,
      ];
      let currentSongLineIndex = -1;

      const getRomanizationPromise = (syllable) => {
        if (!syllable.romanizationPromise) {
          syllable.romanizationPromise = Romanizer.romanize(
            syllable.furigana || syllable.text,
          ).then((rt) => {
            syllable.romanized = rt || "";
            return syllable.romanized;
          });
        }
        return syllable.romanizationPromise;
      };

      const renderLine = (displayEl, lineData) => {
        displayEl.clear();
        if (!lineData) return;
        let currentWord = null;
        let wordIndex = 0;

        lineData.forEach((s) => {
          if (!currentWord || s.rawText.startsWith(" ")) {
            currentWord = new Html("div")
              .classOn("lyric-word")
              .appendTo(displayEl);
            if (currentSongLineIndex > 0) {
              currentWord.style({
                "--animation-delay": `${wordIndex * 0.05}s`,
                opacity: "0",
                "animation-fill-mode": "forwards",
              });
              currentWord.classOn("lyric-fade-in");
            }
            wordIndex++;
          }

          const container = new Html("div")
            .classOn("lyric-syllable-container")
            .attr({ "data-index": s.globalIndex })
            .appendTo(currentWord);

          const furiSpan = new Html("span")
            .classOn("lyric-syllable-furigana")
            .appendTo(container);
          if (s.furigana)
            furiSpan.attr({ "data-text": s.furigana }).text(s.furigana);
          else furiSpan.html("&nbsp;").styleJs({ visibility: "hidden" });

          new Html("span")
            .classOn("lyric-syllable-original")
            .attr({ "data-text": s.text })
            .text(s.text)
            .appendTo(container);

          const romSpan = new Html("span")
            .classOn("lyric-syllable-romanized")
            .appendTo(container);
          if (s.romanized)
            romSpan.attr({ "data-text": s.romanized }).text(s.romanized);
          else {
            romSpan.html("&nbsp;").styleJs({ visibility: "hidden" });
            getRomanizationPromise(s).then((rt) => {
              if (rt)
                romSpan
                  .attr({ "data-text": rt })
                  .text(rt)
                  .styleJs({ visibility: "visible" });
            });
          }
          if (s.rawText.endsWith(" ")) currentWord = null;
        });
      };

      if (lines[0]) renderLine(displayLines[0], lines[0]);
      if (lines[1]) renderLine(displayLines[1], lines[1]);
      displayLines[0].classOn("active");
      displayLines[1].classOn("next");

      let currentVisualIndex = 0;
      this.boundLyricEvent = (e) => {
        const { text } = e.detail;
        if (!text) return;

        let targetSyllable = allSyllables[currentVisualIndex];
        let matchFound = false;

        if (targetSyllable && targetSyllable.rawText === text)
          matchFound = true;
        else {
          const limit = Math.min(currentVisualIndex + 15, allSyllables.length);
          for (let i = currentVisualIndex + 1; i < limit; i++) {
            if (allSyllables[i].rawText === text) {
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

            renderLine(nextDisplay, lines[currentSongLineIndex + 1]);
            if (lines[currentSongLineIndex + 2])
              lines[currentSongLineIndex + 2].forEach(getRomanizationPromise);
          }

          const allScreenSyllables = this.wrapper.qsa(
            ".lyric-syllable-container",
          );
          if (allScreenSyllables) {
            allScreenSyllables.forEach((el) => {
              const idx = parseInt(el.elm.getAttribute("data-index"), 10);
              if (idx < targetSyllable.globalIndex)
                el.classOff("active").classOn("completed");
            });
          }

          let sweepEndTick =
            targetSyllable.tick +
            Math.min(targetSyllable.durationTicks, 2 * ppqm);
          if (targetSyllable.rawText.match(/[\r\n\/\\]$/))
            sweepEndTick = targetSyllable.tick + ppqm;

          let durationS =
            getSecondsForTick(sweepEndTick, midiInfo.tempoChanges, ppqm) -
            targetSyllable.absoluteTime;
          durationS = Math.max(0.1, Math.min(durationS, 1.5));

          const newSyllableEl = this.wrapper.qs(
            `.lyric-syllable-container[data-index="${targetSyllable.globalIndex}"]`,
          );
          if (newSyllableEl) {
            newSyllableEl.style({ "--syllable-duration": `${durationS}s` });
            newSyllableEl.classOn("active");
          }
          currentVisualIndex++;
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

        if (this.parsedLrc[0].time > 4.0) {
          this.countdowns.push(this.parsedLrc[0].time);
        }

        for (let i = 0; i < this.parsedLrc.length - 1; i++) {
          let cur = this.parsedLrc[i];
          let next = this.parsedLrc[i + 1];
          if (next.time - cur.time > 8.0) {
            this.countdowns.push(next.time);
          }
        }
      }
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

      if (this.interludes && this.interludes.length > 0) {
        let inInterlude = this.interludes.find(
          (ind) => currentTime >= ind.start && currentTime < ind.end,
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
            this.dom.midiContainer.styleJs({
              opacity: "0",
              pointerEvents: "none",
            });
          }
        } else {
          if (this.state.isInterludeActive) {
            this.state.isInterludeActive = false;
            this.dom.interludeOverlay.classOff("visible");
            this.dom.midiContainer.styleJs({
              opacity: "1",
              pointerEvents: "all",
            });
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
    if (this.dom.midiContainer) {
      this.dom.midiContainer.styleJs({ opacity: "1", pointerEvents: "all" });
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
    if (this.boundTempoUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TempoEvent",
        this.boundTempoUpdate,
      );

    this.boundTimeUpdate = null;
    this.boundLyricEvent = null;
    this.boundScoreUpdate = null;
    this.boundTempoUpdate = null;
  }

  /**
   * Triggers downstream progression steps in response to system audio signals.
   *
   * @param {Event} e - Payload encapsulating system stream statuses.
   * @returns {Promise<void>}
   */
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
        state: `Main Menu`,
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

    this.dom.rankDisplay
      .text("")
      .styleJs({ transform: "scale(0.8)", opacity: "0", color: "#fff" });
    this.dom.finalScoreDisplay.text("0");

    this.dom.postSongScreen.styleJs({ opacity: "1", pointerEvents: "all" });

    const s = scoreData.finalScore;
    let rank = "Good";
    let rankColor = "#aed581";
    if (s == 100) {
      // Wow! You're THE Star of the show!
      rank = "HOW DID YOU PULL THAT OFF";
      rankColor = "#00e676";
    } else if (s >= 98) {
      // Bravo! Keep singing!
      rank = "WHAT";
      rankColor = "#00e676";
    } else if (s >= 90) {
      // Wow, you're an awesome singer!
      rank = "EXCELLENT";
      rankColor = "#29b6f6";
    } else if (s >= 80) {
      // Great singing!
      rank = "GREAT";
      rankColor = "#ffee58";
    } else if (s >= 60) {
      // Nice job!
      rank = "GOOD";
      rankColor = "#ffca28";
    } else if (s >= 50) {
      // You're getting there!
      rank = "DECENT";
      rankColor = "#ffca28";
    } else if (s >= 20) {
      // Not bad!
      rank = "NICE TRY";
      rankColor = "#ffca28";
    } else {
      // Practice makes perfect!
      rank = "yikes";
      rankColor = "#ef5350";
    }

    const playAudioSequence = async () => {
      await new Promise((r) => setTimeout(r, 1000));
      if (this.state.scoreSkipped) return;

      const fanfareFinished = await this.Forte.playSfx(
        "/assets/audio/fanfare.mid",
      );
      if (!fanfareFinished || this.state.scoreSkipped) return;

      const narrations =
        this.libraryInfo?.manifest?.additionalContents?.scoreNarrations;
      if (narrations && Array.isArray(narrations)) {
        const match = narrations.find((n) => s >= n.min && s <= n.max);
        if (match && match.file) {
          const narrationUrl = new URL("http://127.0.0.1:9864/getFile");
          narrationUrl.searchParams.append(
            "path",
            pathJoin([this.libraryInfo.path, match.file]),
          );
          await this.Forte.playSfx(narrationUrl.href);
        }
      }
    };
    playAudioSequence();

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

      if (
        typeof window !== "undefined" &&
        typeof window.confetti === "function"
      ) {
        if (!this.state.scoreSkipped) {
          window.confetti({
            position: {
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            },
          });
        }
      }

      if (this.state.scoreSkipped) return;
      this.dom.rankDisplay.text(rank).styleJs({
        transform: "scale(1)",
        opacity: "1",
        color: rankColor,
        transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      });
    };

    await Promise.race([
      (async () => {
        await animate();
        await new Promise((r) => setTimeout(r, 12000));
      })(),
      new Promise((resolve) => {
        this.state.scoreSkipResolver = resolve;
      }),
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
      if (
        this.state.mode === "player" &&
        this.state.lastPlaybackStatus === "playing"
      ) {
        this.infoBar.showTemp(
          "ACCESS DENIED",
          "Please stop playback to enter Setup.",
          3000,
        );
        return;
      }
      if (!this.state.isPromptingSetup) {
        this.state.isPromptingSetup = true;
        this.dom.standbyScreen.classOff("hidden");
        this.dom.standbyBumper.classOn("hidden");
        this.dom.standbyText
          .classOff("hidden")
          .text("REBOOT TO SETUP? PRESS ENTER");
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

  /**
   * Processes numerical keypresses against the active code input buffer strings.
   *
   * @param {string} digit - An individual character ranging "0"-"9".
   */
  handleDigitInput(digit) {
    const target =
      this.state.mode === "player" ? "reservationNumber" : "songNumber";
    this.state[target] =
      this.state[target].length >= 5 ? digit : this.state[target] + digit;
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
    } else if (
      this.state.mode === "yt-search" &&
      !this.dom.searchInput.getValue()
    )
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
        state: "",
      });

      sessionStorage.setItem("encore_boot_setup", "true");
      window.location.reload();
      return;
    }
    const isInputFocused = document.activeElement === this.dom.searchInput.elm;
    const isSearchActive =
      this.state.isSearchOverlayVisible ||
      this.state.mode === "yt-search" ||
      isInputFocused ||
      (this.dom.searchWindow.elm.classList.contains("has-results") &&
        this.state.highlightedSearchIndex !== -1);

    if (this.state.mode === "menu") {
      if (isSearchActive) {
        if (this.state.highlightedSearchIndex !== -1) {
          const res =
            this.state.searchResults[this.state.highlightedSearchIndex];
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
      if (isSearchActive) {
        if (this.state.highlightedSearchIndex !== -1) {
          const res =
            this.state.searchResults[this.state.highlightedSearchIndex];
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

          const fmt = this.getFormatInfo(song);
          const fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;

          this.infoBar.showTemp(
            "RESERVED",
            `${codeSpan} ${fmtBadge} <span class="info-bar-title">${song.title}</span>`,
            4000,
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
    const hasResults =
      this.dom.searchWindow.elm.classList.contains("has-results");

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
    const isSearchActive =
      this.state.mode === "yt-search" ||
      this.state.isSearchOverlayVisible ||
      isInputFocused ||
      this.dom.searchWindow.elm.classList.contains("has-results");

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
              this.state.highlightedSearchIndex + change,
            ),
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
        Math.min(this.songList.length - 1, idx),
      );
      this.updateMenuUI();
    } else if (this.state.mode === "player") {
      if (this.state.currentSongIsYouTube) return;
      const change = dir === "up" ? 1 : -1;
      const cur = this.Forte.getPlaybackState().transpose || 0;
      const next = Math.max(-24, Math.min(24, cur + change));
      this.Forte.setTranspose(next);
      this.infoBar.showTemp("TRANSPOSE", (next > 0 ? "+" : "") + next, 3000);
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

  /**
   * Translates volume commands into absolute level shifts.
   *
   * @param {string} dir - Literal string "up" or "down".
   */
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
          commandsSent: 0,
        };
        this.updateRemoteCount();
        console.log("[LINK] New remote connected.", this.state.knownRemotes);
        this.infoBar.showTemp("LINK", "A new Remote has connected.", 5000);
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
            history: this.state.chatHistory,
          },
        });
        this.broadcastSocialState();
        return;
      }

      if (d.type === "chat_message") {
        const deviceId = this.state.activeSockets[cmd.identity];
        const sender =
          deviceId && this.state.deviceRegistry[deviceId]
            ? this.state.deviceRegistry[deviceId].nickname
            : "Guest";

        const msgObj = {
          id: Date.now(),
          sender,
          text: d.value.substring(0, 200),
          time: Date.now(),
        };

        this.state.chatHistory.push(msgObj);
        if (this.state.chatHistory.length > 100) this.state.chatHistory.shift();

        this.state.typingUsers.delete(cmd.identity);

        this.socket.emit("broadcastData", {
          type: "new_chat",
          message: msgObj,
        });
        this.broadcastSocialState();
        return;
      }

      if (d.type === "send_cheer") {
        const deviceId = this.state.activeSockets[cmd.identity];
        const sender =
          deviceId && this.state.deviceRegistry[deviceId]
            ? this.state.deviceRegistry[deviceId].nickname
            : "Guest";

        this.state.cheerQueue.push({
          nickname: sender,
          message: d.value.substring(0, 50),
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
              data: {
                type: "reserve_response",
                success: false,
                reason: "Not found",
              },
            });
          }
          break;

        case "client_yt_search":
          (async () => {
            try {
              const query = d.value;
              const res = await fetch(
                `http://127.0.0.1:9864/yt-search?q=${encodeURIComponent(query)}`,
              );
              const data = await res.json();

              const ytItems = (data.items || [])
                .filter((i) => i.type === "video")
                .map((item) => ({
                  id: item.id,
                  title: item.title,
                  channelTitle: item.channelTitle,
                  length: item.length,
                  isLive: item.isLive,
                  thumbnail:
                    item.thumbnail?.thumbnails?.[0]?.url ||
                    `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
                }));

              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: { type: "yt_search_results", results: ytItems },
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
            code: "YT",
          };

          if (this.state.mode === "menu") {
            this.startPlayer(ytSong);
          } else {
            this.state.reservationQueue.push(ytSong);
            this.infoBar.showDefault();
          }

          this.socket.emit("sendData", {
            identity: cmd.identity,
            data: { type: "reserve_response", success: true, song: ytSong },
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
