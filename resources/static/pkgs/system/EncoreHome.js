import Html from "/libs/html.js";

let wrapper, Ui, Pid, FsSvc, Forte;

// We need to store event listeners so we can remove them later.
let keydownHandler = null;
let timeUpdateHandler = null;
let playbackUpdateHandler = null;
let lyricEventHandler = null; // Listener for our custom lyric events
let scoreUpdateHandler = null; // Listener for real-time score updates
let lastPlaybackStatus = null;

let songList;

const config = await window.desktopIntegration.ipc.invoke("getConfig");

// --- BGVPlayer Module ---
// ... (This module is unchanged from previous version)
const BGVPlayer = {
  videoElements: [],
  playlist: [],
  currentIndex: 0,
  activePlayerIndex: 0,
  bgvContainer: null,
  FADE_DURATION: 1200, // ms
  PRELOAD_DELAY: 500, // ms
  categories: [], // Store available categories
  selectedCategory: "Auto", // Default to Auto mode
  isManualMode: false, // Flag for when an MV is playing
  activeManualPlayer: null, // Holds the video element playing an MV

  async init(container) {
    this.bgvContainer = container;
    for (let i = 0; i < 2; i++) {
      const videoEl = new Html("video")
        .attr({
          muted: true,
          autoplay: false,
          playsInline: true,
          defaultMuted: true,
        })
        .styleJs({
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: i === 0 ? "1" : "0",
          transform: "scale(1.01)",
          transition: `opacity ${this.FADE_DURATION}ms ease-in-out`,
          willChange: "opacity",
        })
        .appendTo(this.bgvContainer);

      const elm = videoEl.elm;
      elm.volume = 0;
      elm.addEventListener("volumechange", () => (elm.volume = 0));
      this.videoElements.push(elm);
    }
  },

  async loadManifestCategories() {
    const manifestUrl = "http://127.0.0.1:9864/assets/video/bgv/manifest.json";
    try {
      const response = await fetch(manifestUrl);
      this.categories = await response.json();
    } catch (error) {
      console.error("[BGV] Failed to load video manifest:", error);
      this.bgvContainer.text("Could not load background videos.");
      this.categories = []; // Ensure it's an array on failure
    }
  },

  addDynamicCategory(category) {
    if (category && category.BGV_LIST && category.BGV_LIST.length > 0) {
      this.categories.push(category);
    }
  },

  async updatePlaylistForCategory() {
    const assetBaseUrl = "http://127.0.0.1:9864/assets/video/bgv/";
    this.playlist = [];

    let allVideos = [];

    if (this.selectedCategory === "Auto") {
      for (const cat of this.categories) {
        if (cat.isAbsolute) {
          const urls = cat.BGV_LIST.map((videoPath) => {
            const url = new URL("http://127.0.0.1:9864/getFile");
            url.searchParams.append("path", videoPath);
            return url.href;
          });
          allVideos.push(...urls);
        } else {
          const urls = cat.BGV_LIST.map(
            (videoPath) => assetBaseUrl + videoPath,
          );
          allVideos.push(...urls);
        }
      }
    } else {
      const category = this.categories.find(
        (c) => c.BGV_CATEGORY === this.selectedCategory,
      );
      if (category) {
        if (category.isAbsolute) {
          allVideos = category.BGV_LIST.map((videoPath) => {
            const url = new URL("http://127.0.0.1:9864/getFile");
            url.searchParams.append("path", videoPath);
            return url.href;
          });
        } else {
          allVideos = category.BGV_LIST.map(
            (videoPath) => assetBaseUrl + videoPath,
          );
        }
      }
    }

    this.playlist = allVideos;

    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [
        this.playlist[j],
        this.playlist[i],
      ];
    }

    console.log(
      `[BGV] Loaded ${this.playlist.length} videos for category: ${this.selectedCategory}`,
    );

    await this.cleanStop();
    this.currentIndex = 0;
    this.start();
  },

  async cleanStop() {
    this.videoElements.forEach((vid) => {
      vid.onended = null;
      vid.pause();
    });
    await new Promise((resolve) => setTimeout(resolve, this.FADE_DURATION));
    this.videoElements.forEach((vid) => {
      vid.removeAttribute("src");
      vid.load();
      vid.style.opacity =
        vid === this.videoElements[this.activePlayerIndex] ? "1" : "0";
    });
  },

  cycleCategory(direction) {
    if (this.isManualMode) return;
    const allCategoryNames = [
      "Auto",
      ...this.categories.map((c) => c.BGV_CATEGORY),
    ];
    let currentIndex = allCategoryNames.indexOf(this.selectedCategory);
    currentIndex =
      (currentIndex + direction + allCategoryNames.length) %
      allCategoryNames.length;
    this.selectedCategory = allCategoryNames[currentIndex];
    this.updatePlaylistForCategory();
  },

  start() {
    if (this.isManualMode || this.playlist.length === 0) return;
    const activePlayer = this.videoElements[this.activePlayerIndex];
    const preloadPlayer = this.videoElements[1 - this.activePlayerIndex];
    activePlayer.loop = false;
    preloadPlayer.loop = false;
    activePlayer.src = this.playlist[this.currentIndex];
    activePlayer.play().catch(console.error);
    activePlayer.onended = () => this.playNext();
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    setTimeout(() => {
      if (this.isManualMode) return; // Don't preload if mode changed
      preloadPlayer.src = this.playlist[this.currentIndex];
      preloadPlayer.load();
    }, this.PRELOAD_DELAY);
  },

  playNext() {
    if (this.isManualMode) return;
    const currentPlayer = this.videoElements[this.activePlayerIndex];
    const nextPlayer = this.videoElements[1 - this.activePlayerIndex];
    nextPlayer.play().catch(console.error);
    setTimeout(() => {
      currentPlayer.style.opacity = "0";
      nextPlayer.style.opacity = "1";
    }, 50);
    this.activePlayerIndex = 1 - this.activePlayerIndex;
    nextPlayer.onended = () => this.playNext();
    setTimeout(() => {
      if (this.isManualMode) return;
      this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
      currentPlayer.src = this.playlist[this.currentIndex];
      currentPlayer.load();
    }, this.FADE_DURATION + this.PRELOAD_DELAY);
  },

  async playSingleVideo(url) {
    this.isManualMode = true;
    await this.cleanStop();
    const activePlayer = this.videoElements[this.activePlayerIndex];
    activePlayer.src = url;
    activePlayer.load();
    activePlayer.style.opacity = "1";
    this.activeManualPlayer = activePlayer;
    return activePlayer;
  },

  async resumePlaylist() {
    if (!this.isManualMode) return;
    this.isManualMode = false;
    this.activeManualPlayer = null;
    await this.updatePlaylistForCategory();
  },

  stop() {
    this.cleanStop().catch(console.error);
  },
};

// --- Romanizer Module ---
// ... (This module is unchanged)
const Romanizer = {
  getPlaceholder(text, placeholderChar) {
    return text.replace(/\S/g, placeholderChar);
  },
  async romanize(text) {
    if (!text || !text.trim()) return null;

    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)) {
      try {
        const params = new URLSearchParams({ t: text });
        const url = `http://127.0.0.1:9864/romanize?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
          console.error(
            `[Romanizer] Failed to fetch romanization for: ${text}`,
          );
          return null;
        }
        return await res.text();
      } catch (err) {
        console.error(`[Romanizer] Network error during romanization:`, err);
        return null;
      }
    }

    if (/[\uac00-\ud7af]/.test(text)) {
      return Aromanize.romanize(text);
    }

    return null;
  },
};

// --- InfoBar Module ---
const InfoBar = {
  bar: null,
  labelEl: null,
  contentEl: null,
  timeout: null,
  maxLength: 5,
  isTempVisible: false,
  oldLabel: null,
  oldContent: null,

  init(container, maxLength) {
    this.maxLength = maxLength;
    this.bar = new Html("div").class("info-bar").appendTo(container);
    this.labelEl = new Html("div").class("info-bar-label").appendTo(this.bar);
    this.contentEl = new Html("div")
      .class("info-bar-content")
      .appendTo(this.bar);
  },

  show(label, content, options = {}) {
    if (this.timeout) clearTimeout(this.timeout);

    if (options.duration) {
      // If this is the first temporary message in a sequence, store the persistent state.
      if (!this.isTempVisible) {
        this.oldLabel = this.labelEl.getText();
        this.oldContent = this.contentEl.getHtml();
      }
      this.isTempVisible = true;

      this.labelEl.text(label);
      this.contentEl.html(content);
      this.bar.classOn("temp-visible");

      this.timeout = setTimeout(() => {
        this.isTempVisible = false;
        this.timeout = null;
        this.bar.classOff("temp-visible");

        // After fade out, restore the old content.
        setTimeout(() => {
          // Only restore if another temp message hasn't appeared in the meantime
          if (!this.isTempVisible) {
            this.labelEl.text(this.oldLabel);
            this.contentEl.html(this.oldContent);
          }
        }, 300); // Must match CSS transition duration
      }, options.duration);
    } else {
      // This is a persistent message. Clear any temporary state.
      this.isTempVisible = false;
      this.oldLabel = null;
      this.oldContent = null;

      this.labelEl.text(label);
      this.contentEl.html(content);
    }
  },

  showDefault() {
    const { reservationQueue } = this.context();
    if (reservationQueue.length > 0) {
      const nextSong = reservationQueue[0];
      const extra =
        reservationQueue.length > 1 ? ` (+${reservationQueue.length - 1})` : "";

      if (nextSong) {
        const codeSpan = nextSong.code
          ? `<span class="info-bar-code">${nextSong.code}</span>`
          : `<span class="info-bar-code is-youtube">YT</span>`;

        const content = `${codeSpan}
                         <span class="info-bar-title">${nextSong.title}</span>
                         <span class="info-bar-artist">- ${nextSong.artist}${extra}</span>`;
        this.show("UP NEXT", content);
      }
    } else {
      this.show("UP NEXT", "—");
    }
  },

  showReservation(reservationNumber) {
    const { songMap } = this.context();
    const displayCode = reservationNumber.padStart(this.maxLength, "0");
    const song = songMap.get(displayCode);
    let songInfo = "";

    if (song) {
      songInfo = `<span class="info-bar-title">${song.title}</span>
                  <span class="info-bar-artist">- ${song.artist}</span>`;
    } else if (reservationNumber.length === this.maxLength) {
      songInfo = `<span style="opacity: 0.5;">No song found.</span>`;
    }

    const content = `<span class="info-bar-code">${displayCode}</span> ${songInfo}`;
    this.show("RESERVING", content);
  },

  context() {
    return { reservationQueue: [], songMap: new Map() };
  },
};

// --- ScoreHUD Module ---
// ... (This module is unchanged)
const ScoreHUD = {
  hud: null,
  scoreDisplay: null,

  init(container) {
    this.hud = new Html("div").class("score-hud").appendTo(container);
    new Html("div").class("score-hud-label").text("SCORE").appendTo(this.hud);
    this.scoreDisplay = new Html("div")
      .class("score-hud-value")
      .appendTo(this.hud);
    this.hide();
  },

  show(score) {
    this.scoreDisplay.text(Math.floor(score));
    this.hud.classOn("visible");
  },

  hide() {
    this.hud.classOff("visible");
  },
};

const pkg = {
  name: "Encore Home",
  type: "app",
  privs: 0,
  start: async function (Root) {
    Pid = Root.Pid;
    Ui = Root.Processes.getService("UiLib").data;
    FsSvc = Root.Processes.getService("FsSvc").data;
    Forte = Root.Processes.getService("ForteSvc").data;

    wrapper = new Html("div").class("full-ui").appendTo("body");
    Ui.becomeTopUi(Pid, wrapper);

    console.log("[Encore] Preloading UI sound effects...");
    const sfxToLoad = ["fanfare.mp3", "fanfare-2.mp3"];
    for (let i = 0; i < 10; i++) {
      sfxToLoad.push(`numbers/${i}.wav`);
    }
    await Promise.all(
      sfxToLoad.map((sfx) => Forte.loadSfx(`/assets/audio/${sfx}`)),
    );
    console.log("[Encore] All UI sound effects preloaded.");

    const socket = io({ query: { clientType: "app" } });
    socket.on("connect", () => console.log("[LINK] Connected to server."));

    songList = FsSvc.getSongList();
    const songMap = new Map(songList.map((song) => [song.code, song]));
    let songItemElements = [];
    const maxLength = 5;
    let state = {
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
    };

    InfoBar.context = () => ({
      reservationQueue: state.reservationQueue,
      songMap: songMap,
    });

    window.desktopIntegration.ipc.send("setRPC", {
      details: `Browsing ${songList.length} Songs...`,
      state: `Main Menu`,
    });

    await Forte.setTrackVolume(config.audioConfig.mix.instrumental.volume);
    if (config.audioConfig.micLatency) {
      await Forte.setLatency(config.audioConfig.micLatency);
    }
    if (config.audioConfig.mix.scoring.inputDevice) {
      await Forte.setMicDevice(config.audioConfig.mix.scoring.inputDevice);
    }

    const bgvContainer = new Html("div")
      .class("bgv-container")
      .appendTo(wrapper);
    const youtubePlayerContainer = new Html("div")
      .class("youtube-player-container", "hidden")
      .appendTo(wrapper);
    const youtubeIframe = new Html("iframe").appendTo(youtubePlayerContainer);

    const overlay = new Html("div").class("overlay-ui").appendTo(wrapper);
    const searchUi = new Html("div").class("search-ui").appendTo(wrapper);
    const playerUi = new Html("div")
      .class("player-ui", "hidden")
      .appendTo(wrapper);

    const postSongScoreScreen = new Html("div")
      .class("post-song-score-screen")
      .appendTo(wrapper);
    const scoreCard = new Html("div")
      .class("score-card")
      .appendTo(postSongScoreScreen);
    const scoreHeader = new Html("div")
      .class("score-header")
      .appendTo(scoreCard);
    new Html("div")
      .class("score-header-title")
      .text("YOUR SCORE")
      .appendTo(scoreHeader);
    new Html("div")
      .class("score-header-subtitle")
      .text("ADVANCED SCORING")
      .appendTo(scoreHeader);
    const scoreMain = new Html("div").class("score-main").appendTo(scoreCard);
    const finalScoreContainer = new Html("div")
      .class("final-score-container")
      .appendTo(scoreMain);
    new Html("div")
      .class("final-score-label")
      .text("YOUR SCORE")
      .appendTo(finalScoreContainer);
    const finalScoreDisplay = new Html("div")
      .class("final-score")
      .appendTo(finalScoreContainer);
    const scoreDetails = new Html("div")
      .class("score-details")
      .appendTo(scoreCard);
    const createGauge = (label, className) => {
      const container = new Html("div")
        .class("score-gauge-container")
        .appendTo(scoreDetails);
      new Html("span")
        .class("score-gauge-label")
        .text(label)
        .appendTo(container);
      const gauge = new Html("div")
        .class("score-gauge", className)
        .appendTo(container);
      const valueDisplay = new Html("span")
        .class("score-gauge-value")
        .appendTo(gauge);
      return { gauge, valueDisplay };
    };
    const keyRhythmGauge = createGauge("Key/Rhythm", "gauge-key-rhythm");
    const vibratoGauge = createGauge("Vibrato", "gauge-vibrato");
    const upbandGauge = createGauge("Upband", "gauge-upband");
    const downbandGauge = createGauge("Downband", "gauge-downband");

    InfoBar.init(wrapper, maxLength);
    ScoreHUD.init(wrapper);

    // --- REVISION: Create a persistent, reusable calibration screen ---
    const calibrationScreen = new Html("div")
      .class("calibration-screen")
      .appendTo(wrapper);
    const calibrationTitle = new Html("h1").appendTo(calibrationScreen);
    const calibrationText = new Html("p").appendTo(calibrationScreen);

    new Html("style")
      .text(
        `
        /* ... (General styles are unchanged) ... */
        .loading * { opacity: 0 !important; }
        .bgv-container { position: absolute; inset: 0; background-color: #000; overflow: hidden; z-index: 1; }
        .youtube-player-container { position: absolute; inset: 0; z-index: 2; background: #000; }
        .youtube-player-container iframe { width: 100%; height: 100%; border: none; }
        .qr-code-container { position: absolute; bottom: 2rem; left: 2rem; z-index: 11; display: flex; align-items: center; gap: 0.5rem; background: rgba(0,0,0,0.5); padding: 0.5rem; border-radius: 0.25rem; }
        .qr-code-container img { width: 50px; height: 50px; }
        .qr-code-container p { margin: 0; font-family: 'Rajdhani', sans-serif; font-size: 0.9rem; color: rgba(255,255,255,0.7); }
        .mode-player .qr-code-container, .mode-yt-search .qr-code-container { display: none; }
        .overlay-ui { display: flex; align-items: stretch; gap: 3rem; position: relative; width: 100%; height: 100%; padding: 2rem 3rem; background: linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 20%, transparent 50%, rgba(0,0,0,0.9) 100%); transition: opacity 0.3s ease-out; z-index: 10; }
        .hidden { opacity: 0; pointer-events: none; }
        .left-panel { flex: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: opacity 0.3s ease-out; }
        .right-panel { flex: 3; display: flex; flex-direction: column; background: rgba(10,10,20,0.7); border: 1px solid rgba(255,255,255,0.2); border-radius: 0.5rem; padding: 1.5rem; overflow: hidden; transition: opacity 0.3s ease-out; }
        .main-content { text-align: center; color: white; text-shadow: 2px 2px 8px rgba(0,0,0,0.8); }
        .main-content h1 { font-size: 2rem; font-weight: 500; margin-bottom: 0.5rem; }
        .number-display { font-family: 'Rajdhani', sans-serif; font-size: 10rem; line-height: 1; font-weight: 700; border: 2px solid rgba(255,255,255,0.3); border-radius: 0.5rem; padding: 1rem 2rem; letter-spacing: 0.5rem; transition: all 0.2s ease; }
        .number-display.active { transform: scale(1.02); border-color: #89CFF0; box-shadow: 0 0 20px #89CFF066; }
        .song-info { margin-top: 1.5rem; height: 100px; } .song-title { font-size: 2.5rem; font-weight: bold; } .song-artist { font-size: 1.5rem; opacity: 0.8; }
        .search-hint { margin-top: 1rem; font-size: 1.2rem; opacity: 0.5; font-family: 'Rajdhani', sans-serif; }
        .right-panel h2 { margin: 0 0 1rem 0; text-align: center; }
        .song-list-container { flex-grow: 1; overflow-y: auto; }
        .song-item { display: flex; padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background-color 0.2s; } .song-item.highlighted { background-color: #89CFF044; }
        .song-item-code { font-family: 'Rajdhani', sans-serif; font-weight: 700; width: 80px; color: #89CFF0; } .song-item-title { flex-grow: 1; } .song-item-artist { width: 30%; text-align: right; opacity: 0.7; }

        /* REVISION: Final Polished Spotlight Search Styling */
        .search-ui {
            position: absolute;
            display: flex;
            z-index: 20000000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease-out;
            /* Base position for overlay to prevent flash */
            top: calc(2rem + 50px + 1rem);
            left: 0;
            right: 0;
            bottom: auto;
            align-items: flex-start;
            justify-content: center;
        }
        .mode-yt-search .search-ui,
        .search-overlay-active .search-ui {
            opacity: 1;
            pointer-events: all;
            z-index: 200000;
        }

        .mode-yt-search .search-ui {
            /* Override to full screen */
            inset: 0;
            padding-top: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(10px);
            align-items: center;
            z-index: 2000000;
        }
        .mode-yt-search .search-window {
            width: 90%;
            max-width: 1200px;
            height: 80vh;
            background: rgba(10,10,20,0.8);
            gap: 1.5rem;
            padding: 1.5rem;
        }
        
        .search-window {
            border: 1px solid rgba(137, 207, 240, 0.4);
            border-radius: 0.5rem;
            display: flex;
            flex-direction: column;
            gap: 0;
            transition: height 0.25s ease-in-out, box-shadow 0.25s ease-in-out;
            overflow: hidden;
            z-index: 2000000;
        }
        
        .search-overlay-active .search-window {
            background: rgba(10, 10, 20, 0.95);
            width: 60vw;
            max-width: 800px;
            height: auto;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        .search-overlay-active .search-input { padding: 1.2rem; }
        .search-overlay-active .search-results-container {
            max-height: 0;
            overflow-y: auto;
            transition: max-height 0.25s ease-in-out;
            border-top: none;
        }

        .search-overlay-active .search-window.has-results {
             box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .search-overlay-active .search-window.has-results .search-results-container {
             max-height: 50vh;
             border-top: 1px solid rgba(255,255,255,0.2);
             padding: 1rem;
        }

        .search-input { font-family: 'Rajdhani', sans-serif; font-size: 2rem; background: rgba(0,0,0,0.4); border: 2px solid rgba(255,255,255,0.3); border-radius: 0.5rem; color: white; width: 100%; text-align: center; outline: none; transition: all 0.2s ease; flex-shrink: 0; }
        .search-input:focus { border-color: #89CFF0; box-shadow: 0 0 20px #89CFF066; }
        
        .search-window:not(.has-results) .search-results-container { padding: 0; }
        .search-result-item { display: flex; align-items: center; gap: 1rem; padding: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); transition: background-color 0.2s; }
        .search-result-item:last-child { border-bottom: none; }
        .search-result-item.highlighted { background-color: #89CFF044; }
        .search-thumbnail-wrapper { position: relative; }
        .search-thumbnail { width: 120px; height: 68px; object-fit: cover; border-radius: 0.25rem; flex-shrink: 0; }
        .search-duration { position: absolute; bottom: 0.2rem; right: 0.2rem; background: rgba(0,0,0,0.8); color: white; font-size: 0.8rem; padding: 0.1rem 0.3rem; border-radius: 0.2rem; }
        .search-info { display: flex; flex-direction: column; overflow: hidden; }
        .search-title { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-channel { font-size: 0.9rem; opacity: 0.7; }
        
        .player-ui { position: absolute; inset: 0; padding: 2rem; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; transition: background 0.3s ease-out; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 50%); z-index: 15; padding-bottom: 5vh; }
        .mode-player-youtube .player-ui {
            background: transparent;
        }

        /* ... (rest of styles are unchanged) ... */
        .player-bottom-section { width: 100%; max-width: 1200px; display: flex; flex-direction: column; align-items: center; gap: 1rem; }
        .countdown-display { width: 9rem; height: 9rem; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: radial-gradient(circle at 50% 120%, #f7b733, #fc4a1a); font-family: 'Rajdhani', sans-serif; font-weight: 900; font-size: 6rem; color: #000; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); box-shadow: inset 0 0 10px rgba(0,0,0,0.5), 0 5px 15px rgba(0,0,0,0.4); border: 4px solid #4d4d4d; opacity: 0; transform: scale(0.8); transition: opacity 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); pointer-events: none; line-height: 1; }
        .countdown-display.visible { opacity: 1; transform: scale(1); }
        .lyrics-container, .midi-lyrics-container { width: 100%; height: auto; position: relative; transition: opacity 0.3s ease; }
        .lyrics-container { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1rem; }
        .midi-lyrics-container { display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 1rem; }
        .lyric-line { margin: 0; text-align: center; font-size: 4.5rem; font-weight: bold; text-shadow: 2px 2px 6px #000; transition: color 0.3s ease, opacity 0.3s ease; color: rgba(255, 255, 255, 0.4); -webkit-text-stroke: 0; text-stroke: 0; }
        .lyric-line.past { opacity: 0.5; }
        .lyric-line.active { color: #FFFFFF; text-shadow: none; -webkit-text-stroke: 6px #010141; text-stroke: 6px #010141; paint-order: stroke fill; }
        .lyric-line-original { line-height: 1.2; }
        .lyric-line-romanized { font-size: 1.5rem; color: rgba(255, 255, 255, 0.5); line-height: 1.1; font-weight: 500; letter-spacing: 0.05em; }
        .lyric-line.active .lyric-line-romanized { color: #FFFFFF; }
        .midi-lyric-line { display: flex; justify-content: center; flex-wrap: nowrap; white-space: pre; color: rgba(255, 255, 255, 0.4); }
        .midi-lyric-line.next { opacity: 0.5; }
        .lyric-syllable-container { display: inline-flex; flex-direction: column; align-items: center; margin: 0; }
        .lyric-syllable-original, .lyric-syllable-romanized { position: relative; color: rgba(255, 255, 255, 0.4); }
        .lyric-syllable-original::after, .lyric-syllable-romanized::after { content: attr(data-text); position: absolute; top: 0; left: 0; width: 0; color: #FFFFFF; text-shadow: none; -webkit-text-stroke: 5px #010141; text-stroke: 5px #010141; paint-order: stroke fill; overflow: hidden; transition: width 0.1s linear; }
        .lyric-syllable-container.active .lyric-syllable-original::after,
        .lyric-syllable-container.active .lyric-syllable-romanized::after { width: 100%; }
        .lyric-syllable-original { font-size: inherit; }
        .lyric-syllable-romanized { font-size: 1rem; margin-top: 0.25rem; line-height: 1; font-weight: 500; }
        .player-progress { width: 100%; max-width: 1200px; height: 10px; background: rgba(255,255,255,0.2); border-radius: 5px; margin-top: 1rem; }
        .progress-bar { width: 0%; height: 100%; background-color: #89CFF0; border-radius: 5px; transition: width 0.1s linear; }
        .intro-card { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 80%; max-width: 900px; padding: 2rem 3rem; background: linear-gradient(105deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 27, 75, 0.95) 100%); border: 1px solid rgba(137, 207, 240, 0.4); border-radius: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: left; font-family: 'Rajdhani', sans-serif; color: white; z-index: 16; opacity: 0; transition: opacity 0.4s ease-out, transform 0.4s ease-out; pointer-events: none; display: flex; flex-direction: column; gap: 0.5rem; }
        .intro-card.visible { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        .intro-card-title, .intro-card-artist { opacity: 0; transform: translateY(20px); transition: opacity 0.4s ease-out, transform 0.4s ease-out; }
        .intro-card.visible .intro-card-title { opacity: 1; transform: translateY(0); transition-delay: 0.2s; }
        .intro-card.visible .intro-card-artist { opacity: 1; transform: translateY(0); transition-delay: 0.3s; }
        .intro-card-title { font-size: 4rem; font-weight: 700; letter-spacing: 0.05em; line-height: 1.1; text-shadow: 2px 2px 8px rgba(0,0,0,0.5); }
        .intro-card-artist { font-size: 1.5rem; font-weight: 500; opacity: 0.8; border-top: 1px solid rgba(255,255,255,0.3); padding-top: 0.75rem; margin-top: 0.5rem; }
        .info-bar { position: absolute; top: 2rem; left: 3rem; right: 3rem; height: 50px; display: flex; align-items: stretch; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.2); border-radius: 0.5rem; font-family: 'Rajdhani', sans-serif; color: white; z-index: 25; overflow: hidden; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
        .mode-player .info-bar, .info-bar.temp-visible { opacity: 1; pointer-events: auto; }
        .info-bar-label { flex: 0 0 160px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.3); font-size: 1.2rem; font-weight: 700; color: #FFD700; letter-spacing: 0.1rem; border-right: 1px solid rgba(255,255,255,0.2); }
        .info-bar-content { flex-grow: 1; display: flex; align-items: center; gap: 1rem; padding: 0 1.5rem; font-size: 1.6rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .info-bar-code { font-weight: 700; color: #89CFF0; letter-spacing: 0.1rem; }
        .info-bar-code.is-youtube { color: #FF5555; letter-spacing: 0; }
        .info-bar-title { font-weight: bold; }
        .info-bar-artist { opacity: 0.7; }
        .bgv-category-item { padding: 0.25rem 0.75rem; margin: 0 0.1rem; border-radius: 0.25rem; opacity: 0.6; transition: all 0.2s ease; font-size: 1.2rem; }
        .bgv-category-item.selected { opacity: 1; font-weight: bold; color: #000; background-color: #89CFF0; }
        .info-bar-content .volume-display { display: flex; align-items: center; width: 100%; gap: 1rem; }
        .info-bar-content .volume-slider-container { flex-grow: 1; height: 12px; background-color: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; overflow: hidden; }
        .info-bar-content .volume-slider-fill { height: 100%; background-color: #89CFF0; border-radius: 6px; transition: width 0.1s linear; }
        .info-bar-content .volume-percentage { font-size: 1.6rem; font-weight: 700; width: 70px; text-align: right; }
        .score-hud { position: absolute; bottom: 2rem; right: 3rem; padding: 0.5rem 1.2rem; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.2); border-radius: 0.5rem; font-family: 'Rajdhani', sans-serif; color: white; z-index: 26; display: flex; flex-direction: row; align-items: baseline; gap: 0.75rem; opacity: 0; transition: opacity 0.3s ease, bottom 0.3s ease; pointer-events: none; }
        .score-hud.visible { opacity: 1; }
        .score-hud-label { font-size: 1rem; font-weight: 700; color: #FFD700; letter-spacing: 0.1rem; }
        .score-hud-value { font-size: 2.5rem; font-weight: 700; color: #89CFF0; letter-spacing: 0.1rem; line-height: 1; }
        .post-song-score-screen { position: absolute; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(10px); display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; z-index: 50; opacity: 0; transition: opacity 0.5s ease; pointer-events: none; }
        .post-song-score-screen.visible { opacity: 1; pointer-events: all; }
        .score-card { background: linear-gradient(145deg, rgba(20, 20, 40, 0.85), rgba(10, 10, 20, 0.9)); border: 1px solid rgba(137, 207, 240, 0.4); border-radius: 1rem; width: 90%; max-width: 900px; padding: 2rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: 'Rajdhani', sans-serif; }
        .score-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 1rem; margin-bottom: 1.5rem; }
        .score-header-title { font-size: 2.5rem; font-weight: 700; letter-spacing: 0.1em; color: #89CFF0; text-shadow: 0 0 5px #89CFF0; }
        .score-header-subtitle { font-size: 1.5rem; opacity: 0.8; }
        .score-main { display: flex; justify-content: center; align-items: center; margin-bottom: 2rem; }
        .final-score-container { text-align: center; }
        .final-score { font-family: 'Orbitron', sans-serif; font-size: 10rem; font-weight: 900; line-height: 1; text-shadow: 0 0 10px #fff, 0 0 20px #89CFF0, 0 0 30px #89CFF0; color: #f0f0f0; }
        .final-score-label { font-size: 1.2rem; color: #FFD700; letter-spacing: 0.2rem; }
        .score-details { display: flex; justify-content: space-around; gap: 1rem; padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.2); }
        .score-gauge-container { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
        .score-gauge-label { font-size: 1.2rem; font-weight: 700; }
        .score-gauge { position: relative; width: 140px; height: 140px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background-color: rgba(0,0,0,0.3); }
        .score-gauge::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(var(--gauge-color) calc(var(--value) * 1%), #444 0); mask: radial-gradient(transparent 65%, black 66%); -webkit-mask: radial-gradient(transparent 65%, black 66%); transition: background 0.5s ease-out; }
        .score-gauge-value { font-family: 'Orbitron', sans-serif; font-size: 2.5rem; font-weight: 700; z-index: 1; }
        .gauge-key-rhythm { --gauge-color: #3b82f6; }
        .gauge-vibrato { --gauge-color: #22c55e; }
        .gauge-upband { --gauge-color: #f59e0b; }
        .gauge-downband { --gauge-color: #ef4444; }
        /* --- REVISION: Added styles for new calibration screen --- */
        .calibration-screen { position: absolute; inset: 0; background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center; flex-direction: column; color: white; font-family: 'Rajdhani', sans-serif; z-index: 999999; opacity: 0; transition: opacity 0.5s ease; pointer-events: none; text-align: center; padding: 2rem; }
        .calibration-screen.visible { opacity: 1; pointer-events: all; }
        .calibration-screen h1 { font-size: 3rem; letter-spacing: 0.1em; color: #89CFF0; margin-bottom: 1rem; }
        .calibration-screen p { font-size: 1.5rem; opacity: 0.8; max-width: 60ch; }
    `,
      )
      .appendTo(wrapper);

    // ... (UI element creation is unchanged) ...
    wrapper.classOn("loading");
    const leftPanel = new Html("div").class("left-panel").appendTo(overlay);
    const rightPanel = new Html("div").class("right-panel").appendTo(overlay);
    const mainContent = new Html("div")
      .class("main-content")
      .appendTo(leftPanel);
    new Html("h1").text("Enter Song Number").appendTo(mainContent);
    const numberDisplay = new Html("div")
      .class("number-display")
      .appendTo(mainContent);
    const songInfo = new Html("div").class("song-info").appendTo(mainContent);
    const songTitle = new Html("h2").class("song-title").appendTo(songInfo);
    const songArtist = new Html("p").class("song-artist").appendTo(songInfo);
    new Html("p")
      .class("search-hint")
      .html("Press 'Y' to Search YouTube<br>Press 'C' to Calibrate Audio")
      .appendTo(mainContent);
    new Html("h2").text("Song List").appendTo(rightPanel);
    const songListContainer = new Html("div")
      .class("song-list-container")
      .appendTo(rightPanel);
    songList.forEach((song) => {
      const item = new Html("div")
        .class("song-item")
        .appendTo(songListContainer);
      new Html("div").class("song-item-code").text(song.code).appendTo(item);
      new Html("div").class("song-item-title").text(song.title).appendTo(item);
      new Html("div")
        .class("song-item-artist")
        .text(song.artist)
        .appendTo(item);
      songItemElements.push(item);
    });

    const qrContainer = new Html("div")
      .class("qr-code-container")
      .appendTo(wrapper);
    const qrImg = new Html("img").appendTo(qrContainer);
    new Html("p").text("Use your phone as a remote!").appendTo(qrContainer);

    try {
      const response = await fetch("http://127.0.0.1:9864/local_ip");
      const local_ip = await response.text();
      const remoteUrl = `http://${local_ip}:9864/remote`;
      qrImg.attr({
        src: `http://127.0.0.1:9864/qr?url=${encodeURIComponent(remoteUrl)}`,
      });
    } catch (e) {
      console.error("Could not fetch local IP for QR code", e);
      qrContainer.classOn("hidden");
    }

    const searchWindow = new Html("div")
      .class("search-window")
      .appendTo(searchUi);
    const searchInput = new Html("input")
      .class("search-input")
      .attr({
        type: "text",
        placeholder: "Type here and press Enter to search...",
      })
      .appendTo(searchWindow);
    const searchResultsContainer = new Html("div")
      .class("search-results-container")
      .appendTo(searchWindow);

    const introCard = new Html("div").class("intro-card").appendTo(playerUi);
    const introCardTitle = new Html("div")
      .class("intro-card-title")
      .appendTo(introCard);
    const introCardArtist = new Html("div")
      .class("intro-card-artist")
      .appendTo(introCard);

    const bottomSection = new Html("div")
      .class("player-bottom-section")
      .appendTo(playerUi);
    const countdownDisplay = new Html("div")
      .class("countdown-display")
      .appendTo(bottomSection);
    const lrcLyricsContainer = new Html("div")
      .class("lyrics-container")
      .appendTo(bottomSection);
    const lrcLineDisplay1 = new Html("div")
      .class("lyric-line")
      .appendTo(lrcLyricsContainer);
    const lrcLineDisplay2 = new Html("div")
      .class("lyric-line", "next")
      .appendTo(lrcLyricsContainer);
    const midiLyricsContainer = new Html("div")
      .class("midi-lyrics-container")
      .appendTo(bottomSection);
    const midiLineDisplay1 = new Html("div")
      .class("lyric-line", "midi-lyric-line")
      .appendTo(midiLyricsContainer);
    const midiLineDisplay2 = new Html("div")
      .class("lyric-line", "midi-lyric-line", "next")
      .appendTo(midiLyricsContainer);
    const playerProgress = new Html("div")
      .class("player-progress")
      .appendTo(bottomSection);
    const progressBar = new Html("div")
      .class("progress-bar")
      .appendTo(playerProgress);

    // ... (Functions from here down are updated)
    // ... (animateNumber, animateGauge, showPostSongScreen are unchanged)
    let countdownTimers = [];
    let nextLineUpdateTimeout = null;

    function animateNumber(element, target, duration, isFloat = true) {
      return new Promise((resolve) => {
        let start = 0;
        const currentText = element.getText();
        if (currentText && !isNaN(parseFloat(currentText))) {
          start = parseFloat(currentText);
        }
        const startTime = performance.now();
        const update = () => {
          const elapsed = performance.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const currentValue = start + (target - start) * progress;
          element.text(
            isFloat ? currentValue.toFixed(2) : Math.round(currentValue),
          );
          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            element.text(isFloat ? target.toFixed(2) : Math.round(target));
            resolve();
          }
        };
        requestAnimationFrame(update);
      });
    }

    function animateGauge(gaugeElements, target, duration) {
      return new Promise((resolve) => {
        const { gauge, valueDisplay } = gaugeElements;
        let start = 0;
        const startTime = performance.now();
        const update = () => {
          const elapsed = performance.now() - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const currentValue = start + (target - start) * progress;
          gauge.styleJs({ "--value": currentValue });
          valueDisplay.text(`${Math.round(currentValue)}%`);
          if (progress < 1) {
            requestAnimationFrame(update);
          } else {
            gauge.styleJs({ "--value": target });
            valueDisplay.text(`${Math.round(target)}%`);
            resolve();
          }
        };
        requestAnimationFrame(update);
      });
    }

    async function showPostSongScreen(scoreData) {
      state.isTransitioning = true;
      finalScoreDisplay.text("0.00");
      [keyRhythmGauge, vibratoGauge, upbandGauge, downbandGauge].forEach(
        ({ gauge, valueDisplay }) => {
          gauge.styleJs({ "--value": 0 });
          valueDisplay.text("0%");
        },
      );
      postSongScoreScreen.classOn("visible");
      Forte.playSfx("/assets/audio/fanfare.mp3");
      await new Promise((r) => setTimeout(r, 500));
      await animateNumber(finalScoreDisplay, scoreData.finalScore, 2000, true);
      await Promise.all([
        animateGauge(keyRhythmGauge, scoreData.details.pitchAndRhythm, 1500),
        animateGauge(vibratoGauge, scoreData.details.vibrato, 1500),
        animateGauge(upbandGauge, scoreData.details.upband, 1500),
        animateGauge(downbandGauge, scoreData.details.downband, 1500),
      ]);
      await new Promise((r) => setTimeout(r, 7000));
      postSongScoreScreen.classOff("visible");
      await new Promise((r) => setTimeout(r, 500));
      state.isTransitioning = false;
    }

    // --- REVISION: New function to manage the calibration UI flow ---
    async function runCalibrationSequence() {
      if (state.isTransitioning) return;
      state.isTransitioning = true;

      calibrationTitle.text("LATENCY COMPENSATION");
      calibrationText.html(
        "Please place your microphone near your speakers and ensure the room is quiet.<br>The test will begin in five (5) seconds...",
      );
      calibrationScreen.classOn("visible");

      await new Promise((r) => setTimeout(r, 5000)); // Give user time to prepare

      calibrationText.text("Calibrating... A series of beeps will play.");

      try {
        const latencyS = await Forte.runLatencyTest();
        const latencyMs = (latencyS * 1000).toFixed(0);
        const updatedConfig = JSON.parse(JSON.stringify(config));
        if (!updatedConfig.audioConfig) updatedConfig.audioConfig = {};
        updatedConfig.audioConfig.micLatency = latencyS;
        window.desktopIntegration.ipc.send("updateConfig", updatedConfig);
        calibrationTitle.text("CALIBRATION COMPLETE");
        calibrationText.text(`Measured audio latency is ${latencyMs} ms.`);
        InfoBar.show("CALIBRATION", `Success! Latency: ${latencyMs} ms`, {
          duration: 5000,
        });
      } catch (e) {
        console.error("[Encore] Calibration failed:", e);
        calibrationTitle.text("CALIBRATION FAILED");
        calibrationText.html(
          `Could not get a reliable measurement.<br>Please check your microphone input, speaker volume, and reduce background noise.`,
        );
        InfoBar.show("CALIBRATION", "Failed. Please try again.", {
          duration: 5000,
        });
      }

      await new Promise((r) => setTimeout(r, 6000)); // Show results for 6 seconds
      calibrationScreen.classOff("visible");
      state.isTransitioning = false;
    }

    const toggleSearchOverlay = (visible) => {
      if (state.currentSongIsMultiplexed) {
        Forte.togglePianoRollVisibility(!visible);
      }
      if (visible) {
        state.isSearchOverlayVisible = true;
        wrapper.classOn("search-overlay-active");
        searchInput.elm.focus();
        searchInput.elm.select();
      } else {
        state.isSearchOverlayVisible = false;
        wrapper.classOff("search-overlay-active");
        searchWindow.classOff("has-results");
        searchInput.elm.blur();

        setTimeout(() => {
          if (state.isSearchOverlayVisible) return;
          searchInput.val("");
          state.searchResults = [];
          state.highlightedSearchIndex = -1;
          searchResultsContainer.clear();
        }, 300);

        if (state.mode === "player") {
          if (state.reservationNumber.length > 0) {
            InfoBar.showReservation(state.reservationNumber);
          } else {
            InfoBar.showDefault();
          }
        }
      }
    };

    const setMode = (newMode) => {
      state.mode = newMode;
      wrapper.classOff(
        "mode-menu",
        "mode-player",
        "mode-yt-search",
        "mode-player-youtube",
      );
      wrapper.classOn(`mode-${newMode}`);

      overlay.classOn("hidden");
      playerUi.classOn("hidden");

      if (state.isSearchOverlayVisible) toggleSearchOverlay(false);

      if (newMode === "menu") {
        overlay.classOff("hidden");
        searchInput.elm.blur();
        updateMenuUI();
      } else if (newMode === "player") {
        if (state.currentSongIsMultiplexed) {
          Forte.togglePianoRollVisibility(true);
        }
        playerUi.classOff("hidden");
        InfoBar.showDefault();
      } else if (newMode === "yt-search") {
        if (state.currentSongIsMultiplexed) {
          Forte.togglePianoRollVisibility(false);
        }
        searchInput.elm.focus();
        searchInput.elm.select();
      }
    };

    const renderSearchResults = () => {
      searchResultsContainer.clear();
      state.highlightedSearchIndex = -1;

      if (state.isSearching) {
        searchResultsContainer.text("Searching...");
        searchWindow.classOff("has-results");
        return;
      }
      if (state.searchResults.length === 0) {
        searchResultsContainer.text("No results found.");
        searchWindow.classOff("has-results");
        return;
      }

      searchWindow.classOn("has-results");
      state.searchResults.forEach((result) => {
        const item = new Html("div")
          .class("search-result-item")
          .appendTo(searchResultsContainer);
        const thumbWrapper = new Html("div")
          .class("search-thumbnail-wrapper")
          .appendTo(item);
        new Html("img")
          .class("search-thumbnail")
          .attr({ src: result.thumbnail.thumbnails[0].url })
          .appendTo(thumbWrapper);
        if (result.length && result.length.simpleText) {
          new Html("span")
            .class("search-duration")
            .text(result.length.simpleText)
            .appendTo(thumbWrapper);
        }
        const info = new Html("div").class("search-info").appendTo(item);
        new Html("div").class("search-title").text(result.title).appendTo(info);
        new Html("div")
          .class("search-channel")
          .text(result.channelTitle)
          .appendTo(info);
      });
      updateSearchHighlight();
    };

    const updateMenuUI = () => {
      let activeSong = null;
      let displayCode = state.songNumber.padStart(maxLength, "0");
      if (state.songNumber.length > 0) {
        state.highlightedIndex = -1;
        activeSong = songMap.get(displayCode);
      } else if (state.highlightedIndex >= 0) {
        activeSong = songList[state.highlightedIndex];
        if (activeSong) displayCode = activeSong.code;
      }
      numberDisplay.text(displayCode);
      if (activeSong) {
        numberDisplay.classOn("active");
        songTitle.text(activeSong.title);
        songArtist.text(activeSong.artist);
      } else {
        numberDisplay.classOff("active");
        songTitle.text(
          state.songNumber.length === maxLength ? "Song Not Found" : "",
        );
        songArtist.text("");
      }
      songItemElements.forEach((item, index) => {
        if (index === state.highlightedIndex) {
          item.classOn("highlighted");
          item.elm.scrollIntoView({ block: "nearest" });
        } else {
          item.classOff("highlighted");
        }
      });
    };

    const updateSearchHighlight = () => {
      const items = searchResultsContainer.qsa(".search-result-item");
      if (!items) return;
      items.forEach((item, index) => {
        if (index === state.highlightedSearchIndex) {
          item.classOn("highlighted");
          item.elm.scrollIntoView({ block: "nearest" });
        } else {
          item.classOff("highlighted");
        }
      });
    };

    const performSearch = async () => {
      const query = searchInput.getValue().trim();
      if (!query) {
        state.searchResults = [];
        renderSearchResults();
        return;
      }
      state.isSearching = true;
      state.searchResults = [];
      renderSearchResults();
      try {
        const response = await fetch(
          `http://127.0.0.1:9864/yt-search?q=${encodeURIComponent(query)}`,
        );
        if (!response.ok) throw new Error("Search request failed");
        const data = await response.json();
        const items = data.items || [];
        state.searchResults = items.filter((item) => item.type === "video");
      } catch (error) {
        console.error("YouTube search failed:", error);
        state.searchResults = [];
      } finally {
        state.isSearching = false;
        renderSearchResults();
      }
    };

    searchInput.on("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performSearch();
      }
    });

    const startPlayer = async (song) => {
      state.isTransitioning = true;
      if (nextLineUpdateTimeout) clearTimeout(nextLineUpdateTimeout);
      countdownTimers.forEach(clearTimeout);
      nextLineUpdateTimeout = null;
      countdownTimers = [];
      countdownDisplay.classOff("visible").text("");
      if (timeUpdateHandler)
        document.removeEventListener(
          "CherryTree.Forte.Playback.TimeUpdate",
          timeUpdateHandler,
        );
      if (lyricEventHandler)
        document.removeEventListener(
          "CherryTree.Forte.Playback.LyricEvent",
          lyricEventHandler,
        );
      if (scoreUpdateHandler)
        document.removeEventListener(
          "CherryTree.Forte.Scoring.Update",
          scoreUpdateHandler,
        );
      timeUpdateHandler = null;
      lyricEventHandler = null;
      scoreUpdateHandler = null;
      lrcLineDisplay1.clear();
      lrcLineDisplay2.clear();
      midiLineDisplay1.clear();
      midiLineDisplay2.clear();
      ScoreHUD.hide();
      introCard.classOff("visible");
      state.currentSongIsYouTube = song.path.startsWith("yt://");
      state.currentSongIsMV = !!song.videoPath;
      state.reservationNumber = "";

      setMode("player");
      if (state.currentSongIsYouTube) {
        wrapper.classOn("mode-player-youtube");
      }

      window.desktopIntegration.ipc.send("setRPC", {
        details: song.title,
        state: song.artist,
      });
      if (state.currentSongIsYouTube) {
        BGVPlayer.stop();
        bgvContainer.classOn("hidden");
        youtubePlayerContainer.classOff("hidden");
        const videoId = song.path.substring(5);
        youtubeIframe.attr({
          src: `https://cdpn.io/pen/debug/oNPzxKo?v=${videoId}&autoplay=1`,
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        });
        lrcLyricsContainer.classOn("hidden");
        midiLyricsContainer.classOn("hidden");
        playerProgress.classOn("hidden");
        state.isTransitioning = false;
      } else {
        let mvPlayer = null;
        lrcLyricsContainer.styleJs({ opacity: "0" });
        midiLyricsContainer.styleJs({ opacity: "0" });
        if (state.currentSongIsMV) {
          console.log(`[Encore] Playing MV: ${song.videoPath}`);
          const videoUrl = new URL("http://127.0.0.1:9864/getFile");
          videoUrl.searchParams.append("path", song.videoPath);
          mvPlayer = await BGVPlayer.playSingleVideo(videoUrl.href);
        } else {
          BGVPlayer.resumePlaylist();
        }
        bgvContainer.classOff("hidden");
        youtubePlayerContainer.classOn("hidden");
        youtubeIframe.attr({ src: "" });
        lrcLyricsContainer.classOff("hidden");
        midiLyricsContainer.classOff("hidden");
        playerProgress.classOff("hidden");
        const trackUrl = new URL("http://127.0.0.1:9864/getFile");
        trackUrl.searchParams.append("path", song.path);
        await Forte.loadTrack(trackUrl.href);
        const playbackState = Forte.getPlaybackState();
        state.currentSongIsMultiplexed = playbackState.isMultiplexed;
        if (state.currentSongIsMultiplexed) {
          ScoreHUD.show(0);
        }
        introCardTitle.text(song.title);
        introCardArtist.text(song.artist);
        introCard.classOn("visible");
        let lrcParsedLyrics = [],
          currentLrcIndex = -1;
        const scheduleCountdown = (targetTime, currentTime) => {
          countdownTimers.forEach(clearTimeout);
          countdownTimers = [];
          const delays = {
            show3: (targetTime - 3 - currentTime) * 1000,
            show2: (targetTime - 2 - currentTime) * 1000,
            show1: (targetTime - 1 - currentTime) * 1000,
            hide: (targetTime - currentTime) * 1000,
          };
          if (delays.show3 > 0)
            countdownTimers.push(
              setTimeout(() => {
                countdownDisplay.text("3").classOn("visible");
              }, delays.show3),
            );
          if (delays.show2 > 0)
            countdownTimers.push(
              setTimeout(() => {
                countdownDisplay.text("2");
              }, delays.show2),
            );
          if (delays.show1 > 0)
            countdownTimers.push(
              setTimeout(() => {
                countdownDisplay.text("1");
              }, delays.show1),
            );
          if (delays.hide > 0)
            countdownTimers.push(
              setTimeout(() => {
                countdownDisplay.classOff("visible").text("");
              }, delays.hide),
            );
        };
        if (playbackState.isMidi) {
          midiLyricsContainer.styleJs({ display: "flex" });
          lrcLyricsContainer.styleJs({ display: "none" });
          const allSyllables = [];
          const lines = [];
          let currentLineSyllables = [];
          let displayableSyllableIndex = 0;
          for (const syllableText of playbackState.decodedLyrics) {
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
          const displayLines = [midiLineDisplay1, midiLineDisplay2];
          let currentSongLineIndex = -1;
          const renderLine = (displayEl, lineData) => {
            displayEl.clear();
            if (!lineData) return;
            lineData.forEach((s) => {
              const container = new Html("div")
                .class("lyric-syllable-container")
                .attr({ "data-index": s.globalIndex })
                .appendTo(displayEl);
              new Html("span")
                .class("lyric-syllable-original")
                .attr({ "data-text": s.text })
                .text(s.text)
                .appendTo(container);
              if (s.romanized) {
                new Html("span")
                  .class("lyric-syllable-romanized")
                  .attr({ "data-text": s.romanized })
                  .text(s.romanized)
                  .appendTo(container);
              }
            });
          };
          displayLines.forEach((line) =>
            line.clear().classOff("active", "next"),
          );
          renderLine(displayLines[0], lines[0]);
          renderLine(displayLines[1], lines[1]);
          displayLines[0].classOn("active");
          displayLines[1].classOn("next");
          lyricEventHandler = (e) => {
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
            const newSyllableEl = wrapper.qs(
              `.lyric-syllable-container[data-index="${index}"]`,
            );
            if (newSyllableEl) newSyllableEl.classOn("active");
          };
          document.addEventListener(
            "CherryTree.Forte.Playback.LyricEvent",
            lyricEventHandler,
          );
        } else if (song.lrcPath) {
          midiLyricsContainer.styleJs({ display: "none" });
          lrcLyricsContainer.styleJs({ display: "flex" });
          const lrcText = await FsSvc.readFile(song.lrcPath);
          const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
          if (lrcText) {
            const lines = lrcText.split("\n");
            const lyricPromises = lines.map(async (line) => {
              const match = line.match(timeRegex);
              if (!match) return null;
              const time =
                parseInt(match[1]) * 60 +
                parseInt(match[2]) +
                parseInt(match[3].padEnd(3, "0")) / 1000;
              const text = line.replace(timeRegex, "").trim();
              if (!text) return null;
              const romanized = await Romanizer.romanize(text);
              return { time, text, romanized };
            });
            lrcParsedLyrics = (await Promise.all(lyricPromises)).filter(
              Boolean,
            );
          }
        }
        if (state.currentSongIsMultiplexed) {
          scoreUpdateHandler = (e) => {
            const scoreData = e.detail;
            ScoreHUD.show(scoreData.finalScore);
          };
          document.addEventListener(
            "CherryTree.Forte.Scoring.Update",
            scoreUpdateHandler,
          );
        }
        const PRE_ROLL_DELAY_MS = 2500;
        setTimeout(() => {
          if (state.mode !== "player") {
            state.isTransitioning = false;
            return;
          }
          introCard.classOff("visible");
          lrcLyricsContainer.styleJs({ opacity: "1" });
          midiLyricsContainer.styleJs({ opacity: "1" });
          if (lrcParsedLyrics.length > 0) {
            const lrcDisplayLines = [lrcLineDisplay1, lrcLineDisplay2];
            const renderLrcLine = (displayEl, lineData) => {
              displayEl.clear();
              if (!lineData) return;
              new Html("div")
                .class("lyric-line-original")
                .text(lineData.text)
                .appendTo(displayEl);
              if (lineData.romanized) {
                new Html("div")
                  .class("lyric-line-romanized")
                  .text(lineData.romanized)
                  .appendTo(displayEl);
              }
            };
            lrcDisplayLines.forEach((line) =>
              line.clear().classOff("active", "next"),
            );
            renderLrcLine(lrcDisplayLines[0], lrcParsedLyrics[0]);
            renderLrcLine(lrcDisplayLines[1], lrcParsedLyrics[1]);
            lrcDisplayLines[1].classOn("next");
            if (lrcParsedLyrics[0].time > 8.0) {
              scheduleCountdown(lrcParsedLyrics[0].time, 0);
            }
          }
          if (mvPlayer) mvPlayer.play().catch(console.error);
          Forte.playTrack();
          state.isTransitioning = false;
        }, PRE_ROLL_DELAY_MS);
        timeUpdateHandler = (e) => {
          const { currentTime, duration } = e.detail;
          progressBar.styleJs({ width: `${(currentTime / duration) * 100}%` });
          if (mvPlayer) {
            const TOLERANCE_MS = 50,
              HARD_SYNC_THRESHOLD_MS = 500,
              CORRECTION_RATE = 1.05;
            const targetVideoTime = currentTime + state.videoSyncOffset / 1000;
            const driftMs = (targetVideoTime - mvPlayer.currentTime) * 1000;
            if (Math.abs(driftMs) > HARD_SYNC_THRESHOLD_MS) {
              mvPlayer.currentTime = targetVideoTime;
              mvPlayer.playbackRate = 1.0;
            } else if (Math.abs(driftMs) > TOLERANCE_MS) {
              mvPlayer.playbackRate =
                driftMs > 0 ? CORRECTION_RATE : 1.0 / CORRECTION_RATE;
            } else if (mvPlayer.playbackRate !== 1.0) {
              mvPlayer.playbackRate = 1.0;
            }
          }
          if (lrcParsedLyrics.length === 0 || playbackState.isMidi) return;
          let newIndex = -1;
          for (let i = lrcParsedLyrics.length - 1; i >= 0; i--)
            if (currentTime >= lrcParsedLyrics[i].time) {
              newIndex = i;
              break;
            }
          if (newIndex !== currentLrcIndex) {
            if (nextLineUpdateTimeout) clearTimeout(nextLineUpdateTimeout);
            currentLrcIndex = newIndex;
            if (newIndex < 0) return;
            const lrcDisplayLines = [lrcLineDisplay1, lrcLineDisplay2];
            const renderLrcLine = (displayEl, lineData) => {
              displayEl.clear();
              if (!lineData) return;
              new Html("div")
                .class("lyric-line-original")
                .text(lineData.text)
                .appendTo(displayEl);
              if (lineData.romanized) {
                new Html("div")
                  .class("lyric-line-romanized")
                  .text(lineData.romanized)
                  .appendTo(displayEl);
              }
            };
            const activeDisplay = lrcDisplayLines[currentLrcIndex % 2];
            const nextDisplay = lrcDisplayLines[(currentLrcIndex + 1) % 2];
            activeDisplay.classOn("active").classOff("next");
            nextDisplay.classOff("active").classOn("next");
            const currentLine = lrcParsedLyrics[currentLrcIndex];
            const nextLine = lrcParsedLyrics[currentLrcIndex + 1];
            let lineDurationMs = 5000;
            if (nextLine) {
              lineDurationMs = (nextLine.time - currentLine.time) * 1000;
              if (lineDurationMs / 1000 > 8.0) {
                scheduleCountdown(nextLine.time, currentTime);
              }
            }
            const delay = lineDurationMs / 2;
            nextLineUpdateTimeout = setTimeout(() => {
              renderLrcLine(nextDisplay, nextLine);
            }, delay);
          }
        };
        document.addEventListener(
          "CherryTree.Forte.Playback.TimeUpdate",
          timeUpdateHandler,
        );
      }
    };

    const stopPlayer = () => {
      introCard.classOff("visible");
      youtubePlayerContainer.classOn("hidden");
      youtubeIframe.attr({ src: "" });
      bgvContainer.classOff("hidden");
      Forte.stopTrack();
      if (nextLineUpdateTimeout) clearTimeout(nextLineUpdateTimeout);
      countdownTimers.forEach(clearTimeout);
      nextLineUpdateTimeout = null;
      countdownTimers = [];
      countdownDisplay.classOff("visible").text("");
      if (timeUpdateHandler)
        document.removeEventListener(
          "CherryTree.Forte.Playback.TimeUpdate",
          timeUpdateHandler,
        );
      if (lyricEventHandler)
        document.removeEventListener(
          "CherryTree.Forte.Playback.LyricEvent",
          lyricEventHandler,
        );
      if (scoreUpdateHandler)
        document.removeEventListener(
          "CherryTree.Forte.Scoring.Update",
          scoreUpdateHandler,
        );
      ScoreHUD.hide();
      InfoBar.showDefault();
      timeUpdateHandler = null;
      lyricEventHandler = null;
      scoreUpdateHandler = null;
      lastPlaybackStatus = null;
      state.currentSongIsYouTube = false;
      state.currentSongIsMultiplexed = false;
      state.currentSongIsMV = false;
    };

    const transitionAfterSong = () => {
      if (state.reservationQueue.length > 0) {
        const nextSong = state.reservationQueue.shift();
        InfoBar.showDefault();
        if (nextSong) {
          setTimeout(() => startPlayer(nextSong), 250);
        }
      } else {
        setMode("menu");
        window.desktopIntegration.ipc.send("setRPC", {
          details: `Browsing ${songList.length} Songs...`,
          state: `Main Menu`,
        });
      }
    };

    const handleSubmit = () => {
      let songToPlay = null;
      if (state.songNumber.length > 0)
        songToPlay = songMap.get(state.songNumber.padStart(maxLength, "0"));
      else if (state.highlightedIndex >= 0)
        songToPlay = songList[state.highlightedIndex];
      if (songToPlay) {
        state.songNumber = "";
        state.highlightedIndex = -1;
        startPlayer(songToPlay);
      }
    };

    const handleDigitInput = (digit) => {
      // REVISION: Corrected logic for targeting reservation number
      const target =
        state.mode === "player" ? "reservationNumber" : "songNumber";
      state[target] =
        state[target].length >= maxLength ? digit : state[target] + digit;

      if (state.mode !== "player") {
        Forte.playSfx(`/assets/audio/numbers/${digit}.wav`);
      }

      if (state.mode === "player") {
        InfoBar.showReservation(state[target]);
      } else {
        updateMenuUI();
      }
    };

    const handleBackspace = () => {
      if (state.isSearchOverlayVisible && searchInput.getValue().length === 0) {
        toggleSearchOverlay(false);
      } else if (state.mode === "player" && !state.isSearchOverlayVisible) {
        if (state.reservationNumber.length > 0) {
          state.reservationNumber = state.reservationNumber.slice(0, -1);
          if (state.reservationNumber.length > 0) {
            InfoBar.showReservation(state.reservationNumber);
          } else {
            InfoBar.showDefault();
          }
        }
      } else if (state.mode === "menu") {
        if (state.songNumber.length > 0) {
          state.songNumber = state.songNumber.slice(0, -1);
          updateMenuUI();
        }
      } else if (
        state.mode === "yt-search" &&
        searchInput.getValue().length === 0
      ) {
        setMode("menu");
      }
    };

    const handleEnter = () => {
      if (state.mode === "menu") {
        if (state.reservationQueue.length > 0) {
          // If we have queued songs in menu mode, start playing them
          const nextSong = state.reservationQueue.shift();
          startPlayer(nextSong);
        } else {
          handleSubmit();
        }
      } else if (state.mode === "player") {
        if (state.isSearchOverlayVisible) {
          if (state.highlightedSearchIndex !== -1) {
            const video = state.searchResults[state.highlightedSearchIndex];
            if (video) {
              const songToReserve = {
                title: video.title,
                artist: video.channelTitle,
                path: `yt://${video.id}`,
              };
              state.reservationQueue.push(songToReserve);
              InfoBar.show(
                "RESERVED",
                `<span class="info-bar-code is-youtube">YT</span> ${songToReserve.title}`,
                { duration: 4000 },
              );
              toggleSearchOverlay(false);
            }
          }
        } else {
          if (state.reservationNumber.length > 0) {
            const code = state.reservationNumber.padStart(maxLength, "0");
            const song = songMap.get(code);
            if (song) {
              state.reservationQueue.push(song);
              state.reservationNumber = "";
              InfoBar.showDefault();
            }
          }
        }
      } else if (state.mode === "yt-search") {
        if (state.highlightedSearchIndex !== -1) {
          const video = state.searchResults[state.highlightedSearchIndex];
          if (video) {
            const songToPlay = {
              title: video.title,
              artist: video.channelTitle,
              path: `yt://${video.id}`,
            };
            startPlayer(songToPlay);
          }
        }
      }
    };

    const handleEscape = () => {
      if (state.isTransitioning) return;

      if (state.isSearchOverlayVisible) {
        toggleSearchOverlay(false);
        return;
      }

      if (state.mode === "player" || state.mode === "mode-player-youtube") {
        if (state.reservationNumber.length > 0) {
          state.reservationNumber = "";
          InfoBar.showDefault();
        } else {
          if (state.currentSongIsYouTube) {
            stopPlayer();
            BGVPlayer.start();
            transitionAfterSong();
          } else {
            Forte.stopTrack();
          }
        }
      } else if (state.mode === "yt-search") {
        setMode("menu");
      }
    };

    const handleVolume = (direction) => {
      const change = direction === "up" ? 0.05 : -0.05;
      state.volume = Math.max(0, Math.min(1, state.volume + change));
      Forte.setTrackVolume(state.volume);

      const volumePercent = Math.round(state.volume * 100);
      const volumeContent = `
        <div class="volume-display">
            <div class="volume-slider-container">
                <div class="volume-slider-fill" style="width: ${volumePercent}%"></div>
            </div>
            <span class="volume-percentage">${volumePercent}%</span>
        </div>
      `;
      InfoBar.show("VOLUME", volumeContent, { duration: 3000 });

      const updatedConfig = {
        ...config,
        audioConfig: {
          ...config.audioConfig,
          mix: {
            ...config.audioConfig.mix,
            instrumental: {
              ...config.audioConfig.mix.instrumental,
              volume: state.volume,
            },
          },
        },
      };
      window.desktopIntegration.ipc.send("updateConfig", updatedConfig);
    };

    const handleTranspose = (direction) => {
      if (state.mode !== "player" || state.currentSongIsYouTube) return;
      const playbackState = Forte.getPlaybackState();
      const change = direction === "up" ? 1 : -1;
      const newTranspose = Math.max(
        -24,
        Math.min(24, (playbackState.transpose || 0) + change),
      );
      Forte.setTranspose(newTranspose);
      InfoBar.show(
        "TRANSPOSE",
        `${newTranspose > 0 ? "+" : ""}${newTranspose}`,
        { duration: 3000 },
      );
    };

    const handleVideoSync = (direction) => {
      if (state.mode !== "player" || !state.currentSongIsMV) return;
      state.videoSyncOffset += direction === "up" ? 10 : -10;
      InfoBar.show(
        "VIDEO SYNC",
        `${state.videoSyncOffset > 0 ? "+" : ""}${state.videoSyncOffset} ms`,
        { duration: 3000 },
      );
      const updatedConfig = JSON.parse(JSON.stringify(config));
      if (!updatedConfig.videoConfig) updatedConfig.videoConfig = {};
      updatedConfig.videoConfig.syncOffset = state.videoSyncOffset;
      window.desktopIntegration.ipc.send("updateConfig", updatedConfig);
    };

    const handleMultiplexPan = (direction) => {
      const playbackState = Forte.getPlaybackState();
      if (state.mode !== "player" || !playbackState.isMultiplexed) return;
      const change = direction === "right" ? 0.2 : -0.2;
      const newPan = parseFloat(
        Math.max(-1, Math.min(1, playbackState.multiplexPan + change)).toFixed(
          1,
        ),
      );
      Forte.setMultiplexPan(newPan);
      let displayText = "BALANCED";
      if (newPan <= -0.99) displayText = "INSTRUMENTAL";
      else if (newPan >= 0.99) displayText = "VOCAL GUIDE";
      else if (newPan < 0)
        displayText = `◀ ${Math.abs(Math.round(newPan * 100))}% INST`;
      else if (newPan > 0) displayText = `VOC ${Math.round(newPan * 100)}% ▶`;
      InfoBar.show("VOCAL BALANCE", displayText, { duration: 3000 });
    };

    const handleMenuNav = (direction) => {
      if (state.mode !== "menu") return;
      const change = direction === "down" ? 1 : -1;
      state.songNumber = "";
      let newIndex = state.highlightedIndex;
      if (change > 0)
        newIndex = Math.min(
          songList.length - 1,
          newIndex < 0 ? 0 : newIndex + 1,
        );
      else newIndex = Math.max(0, newIndex - 1);
      if (newIndex !== state.highlightedIndex)
        state.highlightedIndex = newIndex;
      updateMenuUI();
    };

    const handleSearchNav = (direction) => {
      if (state.mode !== "yt-search" && !state.isSearchOverlayVisible) return;
      const change = direction === "down" ? 1 : -1;
      const isSearchInputFocused = document.activeElement === searchInput.elm;
      if (isSearchInputFocused && change > 0) {
        searchInput.elm.blur();
        state.highlightedSearchIndex = 0;
      } else if (
        !isSearchInputFocused &&
        change < 0 &&
        state.highlightedSearchIndex <= 0
      ) {
        state.highlightedSearchIndex = -1;
        searchInput.elm.focus();
      } else if (state.searchResults.length > 0) {
        state.highlightedSearchIndex = Math.max(
          0,
          Math.min(
            state.searchResults.length - 1,
            state.highlightedSearchIndex + change,
          ),
        );
      }
      updateSearchHighlight();
    };

    // REVISION: Final robust keydown handler with backspace fix
    keydownHandler = (e) => {
      const isSearchInputFocused = document.activeElement === searchInput.elm;

      if (isSearchInputFocused) {
        if (e.key === "Backspace" && searchInput.getValue().length === 0) {
          e.preventDefault();
          handleBackspace();
          return;
        }
        if (["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) {
          e.preventDefault();
        } else {
          return; // Allow all other keys (including Backspace with text) to type
        }
      } else {
        // Not focused, prevent default for all our commands
        e.preventDefault();
      }

      // Command handling logic
      if (e.key >= "0" && e.key <= "9") handleDigitInput(e.key);
      else if (e.key === "Backspace") handleBackspace();
      else if (e.key === "Enter") handleEnter();
      else if (e.key === "Escape") handleEscape();
      else if (e.key === "ArrowUp") {
        if (state.mode === "menu") handleMenuNav("up");
        else if (state.mode === "yt-search" || state.isSearchOverlayVisible)
          handleSearchNav("up");
        else if (state.mode === "player") handleTranspose("up");
      } else if (e.key === "ArrowDown") {
        if (state.mode === "menu") handleMenuNav("down");
        else if (state.mode === "yt-search" || state.isSearchOverlayVisible)
          handleSearchNav("down");
        else if (state.mode === "player") handleTranspose("down");
      } else if (e.key === "ArrowLeft") {
        handleMultiplexPan("left");
      } else if (e.key === "ArrowRight") {
        handleMultiplexPan("right");
      } else if (e.key === "-") handleVolume("down");
      else if (e.key === "=") handleVolume("up");
      else if (e.key === "[" || e.key === "]") {
        if (state.currentSongIsMV) {
          handleVideoSync(e.key === "]" ? "up" : "down");
        } else {
          BGVPlayer.cycleCategory(e.key === "[" ? -1 : 1);
          const allCategoryNames = [
            "Auto",
            ...BGVPlayer.categories.map((c) => c.BGV_CATEGORY),
          ];
          const content = allCategoryNames
            .map((cat) =>
              cat === BGVPlayer.selectedCategory
                ? `<span class="bgv-category-item selected">${cat}</span>`
                : `<span class="bgv-category-item">${cat}</span>`,
            )
            .join("");
          InfoBar.show("BGV", content, { duration: 3000 });
        }
      } else if (e.key.toLowerCase() === "y") {
        if (state.isTransitioning) return;
        if (state.mode === "menu") setMode("yt-search");
        else if (state.mode === "player")
          toggleSearchOverlay(!state.isSearchOverlayVisible);
      } else if (e.key.toLowerCase() === "c") {
        if (state.mode === "menu") {
          runCalibrationSequence();
        }
      }
    };

    socket.on("connect", () => console.log("[LINK] Connected to server."));

    const validateAndReserveSong = (code) => {
      const displayCode = code.padStart(maxLength, "0");
      const song = songMap.get(displayCode);

      if (song) {
        // If we're in menu mode and nothing is playing, start this song immediately
        if (state.mode === "menu") {
          startPlayer(song);
        } else {
          state.reservationQueue.push(song);
          InfoBar.showDefault();
        }
        return { success: true, song };
      }

      return { success: false };
    };

    socket.on("execute-command", (commandObj) => {
      let data = commandObj.data;
      console.log("[LINK] Executing command:", data);
      console.log("[LINK] From socket id:", commandObj.identity);
      switch (data.type) {
        case "digit":
          handleDigitInput(data.value);
          break;
        case "backspace":
          handleBackspace();
          break;
        case "reserve":
        case "enter":
          handleEnter();
          break;
        case "stop":
          handleEscape();
          break;
        case "vol_up":
          handleVolume("up");
          break;
        case "vol_down":
          handleVolume("down");
          break;
        case "key_up":
          handleTranspose("up");
          break;
        case "key_down":
          handleTranspose("down");
          break;
        case "pan_left":
          handleMultiplexPan("left");
          break;
        case "pan_right":
          handleMultiplexPan("right");
          break;
        case "yt_search_open":
          if (!state.isTransitioning) {
            if (state.mode === "menu") setMode("yt-search");
            else if (state.mode === "player") toggleSearchOverlay(true);
          }
          break;
        case "yt_search_close":
          if (state.mode === "yt-search") setMode("menu");
          else if (state.isSearchOverlayVisible) toggleSearchOverlay(false);
          break;
        case "nav_up":
          handleSearchNav("up");
          break;
        case "nav_down":
          handleSearchNav("down");
          break;
        case "yt_search_query":
          searchInput.elm.value = data.value;
          performSearch();
          break;
        case "get_song_list":
          socket.emit("sendData", {
            identity: commandObj.identity,
            data: { type: "songlist", contents: songList },
          });
          break;
        case "reserve_code":
          const result = validateAndReserveSong(data.value);
          socket.emit("sendData", {
            identity: commandObj.identity,
            data: {
              type: "reserve_response",
              success: result.success,
              song: result.success
                ? {
                    code: result.song.code,
                    title: result.song.title,
                    artist: result.song.artist,
                  }
                : null,
            },
          });
          break;
      }
    });

    playbackUpdateHandler = async (e) => {
      const { status } = e.detail || {};
      if (
        (state.mode === "player" || state.mode === "mode-player-youtube") &&
        lastPlaybackStatus === "playing" &&
        status === "stopped"
      ) {
        if (state.isTransitioning) return;
        state.isTransitioning = true;

        const wasMultiplexed = state.currentSongIsMultiplexed;
        const wasMV = state.currentSongIsMV;
        ScoreHUD.hide();
        if (wasMV) {
          await BGVPlayer.resumePlaylist();
        }
        stopPlayer();
        if (wasMultiplexed) {
          const finalScoreData = Forte.getPlaybackState().score;
          await showPostSongScreen(finalScoreData);
        }

        transitionAfterSong();
        setTimeout(() => {
          if (state.reservationQueue.length === 0)
            state.isTransitioning = false;
        }, 1500);
      }
      lastPlaybackStatus = status;
    };
    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      playbackUpdateHandler,
    );

    window.addEventListener("keydown", keydownHandler);

    wrapper.classOn("loading");
    // await new Promise((r) => setTimeout(r, 500));
    document.dispatchEvent(
      new CustomEvent("CherryTree.Loading.SetText", {
        detail: "Loading BGVs...",
      }),
    );
    await BGVPlayer.init(bgvContainer);
    await BGVPlayer.loadManifestCategories();
    const mtvPaths = songList
      .filter((song) => song.videoPath)
      .map((song) => song.videoPath);
    if (mtvPaths.length > 0) {
      BGVPlayer.addDynamicCategory({
        BGV_CATEGORY: "MTV",
        BGV_LIST: mtvPaths,
        isAbsolute: true,
      });
      console.log(
        `[BGV] Injected "MTV" category with ${mtvPaths.length} videos.`,
      );
    }
    await BGVPlayer.updatePlaylistForCategory();
    setTimeout(() => {
      wrapper.classOff("loading");
      Ui.transition("fadeIn", wrapper);
      setMode("menu");
    }, 100);
  },
  end: async function () {
    if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
    if (timeUpdateHandler)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        timeUpdateHandler,
      );
    if (playbackUpdateHandler)
      document.removeEventListener(
        "CherryTree.Forte.Playback.Update",
        playbackUpdateHandler,
      );
    if (lyricEventHandler)
      document.removeEventListener(
        "CherryTree.Forte.Playback.LyricEvent",
        lyricEventHandler,
      );
    if (scoreUpdateHandler)
      document.removeEventListener(
        "CherryTree.Forte.Scoring.Update",
        scoreUpdateHandler,
      );
    keydownHandler = null;
    timeUpdateHandler = null;
    playbackUpdateHandler = null;
    lyricEventHandler = null;
    scoreUpdateHandler = null;
    lastPlaybackStatus = null;
    BGVPlayer.stop();
    Forte.stopTrack();
    Ui.cleanup(Pid);
    Ui.giveUpUi(Pid);
    wrapper.cleanup();
  },
};

export default pkg;
