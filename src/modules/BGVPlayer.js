import Html from "../libs/html.js";
import NetworkingUtility from "../libs/networkingUtility.js";

/**
 * BGVModule - Encore's BGV playback module
 * Features single-buffered video element with smooth transitions and manual override capability
 */
export class BGVModule {
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
      "[BGV] BGV Player initialized (Single Buffer / Performance Mode).",
    );
  }

  /**
   * Mount the video player to a container element
   * @param {HTMLElement} container - The DOM container for video playback
   */
  async mount(container) {
    this.PORT = await NetworkingUtility.getPort();
    this.container = container;
    this.container.styleJs({
      backgroundColor: "#000",
      overflow: "hidden",
    });

    this.videoElement = new Html("video")
      .attr({
        muted: true,
        autoplay: false,
        playsInline: true,
        defaultMuted: true,
        preload: "auto",
      })
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: "0",
        transition: "opacity 0.5s ease-in-out",
        willChange: "opacity",
        transform: "translateZ(0)",
      })
      .appendTo(this.container).elm;

    this.videoElement.volume = 0;
    this.videoElement.addEventListener(
      "volumechange",
      () => (this.videoElement.volume = 0),
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
    this.PORT = await NetworkingUtility.getPort();
    try {
      const response = await fetch(
        `http://127.0.0.1:${this.PORT}/assets/video/bgv/manifest.json`,
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

    const catList = isAuto
      ? this.categories
      : this.categories.filter((c) => c.BGV_CATEGORY === this.selectedCategory);

    for (const cat of catList) {
      if (cat.isAbsolute) {
        allVideos.push(
          ...cat.BGV_LIST.map((path) => {
            const url = new URL(`http://127.0.0.1:${this.PORT}/getFile`);
            url.searchParams.append("path", path);
            return url.href;
          }),
        );
      } else {
        allVideos.push(...cat.BGV_LIST.map((path) => assetBaseUrl + path));
      }
    }

    this.playlist = allVideos;
    // Shuffle playlist using Fisher-Yates algorithm
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [
        this.playlist[j],
        this.playlist[i],
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
      ...this.categories.map((c) => c.BGV_CATEGORY),
    ];
    let currentIndex = allCategoryNames.indexOf(this.selectedCategory);
    currentIndex =
      (currentIndex + direction + allCategoryNames.length) %
      allCategoryNames.length;
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
      v.play()
        .then(() => {
          v.style.opacity = "1";
        })
        .catch((e) => console.error("[BGV] Play failed", e));
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
}
