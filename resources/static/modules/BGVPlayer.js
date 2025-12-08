import Html from "/libs/html.js";

export class BGVModule {
  constructor() {
    this.videoElements = [];
    this.playlist = [];
    this.currentIndex = 0;
    this.activePlayerIndex = 0;
    this.container = null;
    this.categories = [];
    this.selectedCategory = "Auto";
    this.isManualMode = false;
    this.activeManualPlayer = null;
    this.FADE_DURATION = 1200;
    this.PRELOAD_DELAY = 500;
    this.PORT = 9864;
    console.log("[BGV] BGV Player initialized.");
  }

  mount(container) {
    this.container = container;
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
        .appendTo(this.container);
      const elm = videoEl.elm;
      elm.volume = 0;
      elm.addEventListener("volumechange", () => (elm.volume = 0));
      this.videoElements.push(elm);
    }
  }

  async loadManifestCategories() {
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

  addDynamicCategory(category) {
    if (category && category.BGV_LIST && category.BGV_LIST.length > 0) {
      this.categories.push(category);
    }
  }

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
    // Shuffle
    for (let i = this.playlist.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.playlist[i], this.playlist[j]] = [
        this.playlist[j],
        this.playlist[i],
      ];
    }
    await this.cleanStop();
    this.currentIndex = 0;
    this.start();
  }

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
  }

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
      if (this.isManualMode) return;
      preloadPlayer.src = this.playlist[this.currentIndex];
      preloadPlayer.load();
    }, this.PRELOAD_DELAY);
  }

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
  }

  async playSingleVideo(url) {
    this.isManualMode = true;
    await this.cleanStop();
    const activePlayer = this.videoElements[this.activePlayerIndex];
    activePlayer.src = url;
    activePlayer.load();
    activePlayer.style.opacity = "1";
    this.activeManualPlayer = activePlayer;
    return activePlayer;
  }

  async resumePlaylist() {
    if (!this.isManualMode) return;
    this.isManualMode = false;
    this.activeManualPlayer = null;
    await this.updatePlaylistForCategory();
  }

  stop() {
    this.cleanStop().catch(console.error);
  }
}
