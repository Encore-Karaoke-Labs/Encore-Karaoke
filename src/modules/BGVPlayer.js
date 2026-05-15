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
    this.customCanvas = null;
    this.customCtx = null;
    this.resizeObserver = null;
    this.canvasOnlyMode = false;

    this.imageCanvas = null;
    this.imageCtx = null;
    this.imageRafId = null;
    this.imageTimeout = null;
    this.IMAGE_DURATION = 15000;
    this.CROSSFADE_DURATION = 1500;
    this.currentImageState = null;
    this.prevImageState = null;

    this.playlist = [];
    this.currentIndex = 0;
    this.container = null;
    this.categories = [];
    this.selectedCategory = "Auto";
    this.isManualMode = false;
    this.activeManualPlayer = null;
    this.PORT = 9864;
    this.transitionTimeout = null;
    this.imageCleanupTimeout = null;
    this.currentLoadId = null;
    console.log("[BGV] BGV Player initialized.");
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

    this.imageCanvas = new Html("canvas")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity: "0",
        transition: "opacity 0.5s ease-in-out",
        willChange: "opacity",
        zIndex: "5",
      })
      .appendTo(this.container).elm;

    this.imageCtx = this.imageCanvas.getContext("2d", { alpha: false });

    this.customCanvas = new Html("canvas")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "10",
      })
      .appendTo(this.container).elm;

    this.customCtx = this.customCanvas.getContext("2d", { alpha: true });

    this.resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;

        this.customCanvas.width = width * dpr;
        this.customCanvas.height = height * dpr;
        if (this.customCtx) {
          this.customCtx.setTransform(1, 0, 0, 1, 0, 0);
          this.customCtx.scale(dpr, dpr);
        }

        this.imageCanvas.width = width * dpr;
        this.imageCanvas.height = height * dpr;
        if (this.imageCtx) {
          this.imageCtx.setTransform(1, 0, 0, 1, 0, 0);
          this.imageCtx.scale(dpr, dpr);

          if (this.currentImage) {
            this._drawImageCover(this.currentImage);
          }
        }
      }
    });
    this.resizeObserver.observe(this.container.elm);
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
   * Generates random Pan and Zoom parameters for the Ken Burns effect
   * @private
   */
  _generateKenBurns(img, now) {
    const types = [
      "zoomIn",
      "zoomOut",
      "panLeft",
      "panRight",
      "panUp",
      "panDown",
    ];
    const type = types[Math.floor(Math.random() * types.length)];

    let startScale = 1.0,
      endScale = 1.0;
    let startPanX = 0,
      endPanX = 0;
    let startPanY = 0,
      endPanY = 0;

    const scaleAmount = 1.15;
    const panAmount = 0.05;

    switch (type) {
      case "zoomIn":
        startScale = 1.0;
        endScale = scaleAmount;
        break;
      case "zoomOut":
        startScale = scaleAmount;
        endScale = 1.0;
        break;
      case "panLeft":
        startScale = scaleAmount;
        endScale = scaleAmount;
        startPanX = panAmount;
        endPanX = -panAmount;
        break;
      case "panRight":
        startScale = scaleAmount;
        endScale = scaleAmount;
        startPanX = -panAmount;
        endPanX = panAmount;
        break;
      case "panUp":
        startScale = scaleAmount;
        endScale = scaleAmount;
        startPanY = panAmount;
        endPanY = -panAmount;
        break;
      case "panDown":
        startScale = scaleAmount;
        endScale = scaleAmount;
        startPanY = -panAmount;
        endPanY = panAmount;
        break;
    }

    return {
      img,
      startTime: now,
      startScale,
      endScale,
      startPanX,
      endPanX,
      startPanY,
      endPanY,
    };
  }

  /**
   * The animation loop that handles Crossfades and Ken Burns motion
   * @private
   */
  _renderImageFrame(now) {
    if (!this.imageCtx || !this.imageCanvas) return;
    if (this.canvasOnlyMode) return;

    this.imageRafId = requestAnimationFrame((t) => this._renderImageFrame(t));

    const dpr = window.devicePixelRatio || 1;
    const w = this.imageCanvas.width / dpr;
    const h = this.imageCanvas.height / dpr;

    this.imageCtx.clearRect(0, 0, w, h);

    const drawState = (state, opacity) => {
      if (!state || !state.img) return;

      const elapsed = Math.max(0, now - state.startTime);
      const progress = Math.min(1.0, elapsed / this.IMAGE_DURATION);

      const currentScale =
        state.startScale + (state.endScale - state.startScale) * progress;
      const currentPanX =
        state.startPanX + (state.endPanX - state.startPanX) * progress;
      const currentPanY =
        state.startPanY + (state.endPanY - state.startPanY) * progress;

      const imgRatio = state.img.width / state.img.height;
      const canvasRatio = w / h;

      let drawW = w;
      let drawH = h;
      if (imgRatio > canvasRatio) drawW = h * imgRatio;
      else drawH = w / imgRatio;

      this.imageCtx.save();
      this.imageCtx.globalAlpha = opacity;

      this.imageCtx.translate(w / 2, h / 2);
      this.imageCtx.scale(currentScale, currentScale);
      this.imageCtx.translate(currentPanX * w, currentPanY * h);
      this.imageCtx.drawImage(state.img, -drawW / 2, -drawH / 2, drawW, drawH);

      this.imageCtx.restore();
    };

    let currentOpacity = 1.0;
    if (this.currentImageState) {
      const elapsed = now - this.currentImageState.startTime;
      if (elapsed < this.CROSSFADE_DURATION) {
        currentOpacity = elapsed / this.CROSSFADE_DURATION;
      }
    }

    if (this.prevImageState && currentOpacity < 1.0) {
      drawState(this.prevImageState, 1.0);
    } else if (currentOpacity >= 1.0) {
      this.prevImageState = null;
    }

    if (this.currentImageState) {
      drawState(this.currentImageState, currentOpacity);
    }
  }

  /**
   * Start playback of the current playlist
   */
  start() {
    if (this.isManualMode || this.playlist.length === 0 || this.canvasOnlyMode)
      return;
    this._playUrl(this.playlist[this.currentIndex]);
  }

  /**
   * Advance to the next video in playlist with fade transition
   */
  playNext() {
    if (this.isManualMode || this.playlist.length === 0 || this.canvasOnlyMode)
      return;
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;

    this.videoElement.style.opacity = "0";

    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);

    this.transitionTimeout = setTimeout(() => {
      this._playUrl(this.playlist[this.currentIndex]);
    }, 500);
  }

  /**
   * Internal method to load and play a media URL
   * @private
   * @param {string} url - The media URL to play
   */
  _playUrl(url) {
    const isImage = url.match(/\.(jpeg|jpg|gif|png|webp|bmp)(\?.*)?$/i) != null;

    this.currentLoadId = Date.now();
    const loadId = this.currentLoadId;

    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    if (this.imageTimeout) clearTimeout(this.imageTimeout);
    if (this.imageCleanupTimeout) clearTimeout(this.imageCleanupTimeout);

    if (isImage) {
      this.videoElement.style.opacity = "0";
      if (!this.videoElement.paused) this.videoElement.pause();

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (this.currentLoadId !== loadId) return;

        const now = performance.now();
        this.prevImageState = this.currentImageState;
        this.currentImageState = this._generateKenBurns(img, now);

        this.imageCanvas.style.opacity = "1";

        if (!this.imageRafId) {
          this.imageRafId = requestAnimationFrame((t) =>
            this._renderImageFrame(t),
          );
        }

        this.imageTimeout = setTimeout(
          () => this.playNext(),
          this.IMAGE_DURATION,
        );
      };
      img.onerror = (e) => {
        if (this.currentLoadId !== loadId) return;
        console.warn("[BGV] Image load error, skipping:", e);
        this.playNext();
      };
      img.src = url;
    } else {
      if (this.imageCanvas) this.imageCanvas.style.opacity = "0";

      this.imageCleanupTimeout = setTimeout(() => {
        if (this.imageRafId) cancelAnimationFrame(this.imageRafId);
        this.imageRafId = null;
        this.currentImageState = null;
        this.prevImageState = null;
      }, 500);

      const v = this.videoElement;
      const onCanPlay = () => {
        if (this.currentLoadId !== loadId) {
          v.removeEventListener("canplay", onCanPlay);
          return;
        }

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

    this.currentLoadId = Date.now();
    const loadId = this.currentLoadId;

    if (this.imageTimeout) clearTimeout(this.imageTimeout);
    if (this.imageCleanupTimeout) clearTimeout(this.imageCleanupTimeout);
    if (this.imageCanvas) this.imageCanvas.style.opacity = "0";

    this.imageCleanupTimeout = setTimeout(() => {
      if (this.imageRafId) cancelAnimationFrame(this.imageRafId);
      this.imageRafId = null;
      this.currentImageState = null;
      this.prevImageState = null;
    }, 500);

    if (this.canvasOnlyMode) {
      this.videoElement.style.display = "";
    }

    this.videoElement.style.opacity = "0";
    this.videoElement.src = url;
    this.videoElement.load();

    await new Promise((resolve) => {
      const onCanPlay = () => {
        if (this.currentLoadId === loadId) {
          this.videoElement.style.opacity = "1";
        }
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
   * Returns the 2D rendering context of the custom BGV overlay
   * @returns {CanvasRenderingContext2D}
   */
  getCustomContext() {
    return this.customCtx;
  }

  /**
   * Returns the custom BGV canvas element
   * @returns {HTMLCanvasElement}
   */
  getCustomCanvas() {
    return this.customCanvas;
  }

  /**
   * Clears the custom overlay graphics
   */
  clearCustomGraphics() {
    if (!this.customCtx || !this.customCanvas) return;
    const rect = this.container.elm.getBoundingClientRect();
    this.customCtx.clearRect(0, 0, rect.width, rect.height);
  }

  /**
   * Toggles Canvas-Only Mode. Disables the video element to save CPU/GPU resources.
   * @param {boolean} enabled - True to disable video and rely only on customCanvas.
   */
  setCanvasOnlyMode(enabled) {
    this.canvasOnlyMode = enabled;

    if (enabled) {
      if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.removeAttribute("src");
        this.videoElement.load();
        this.videoElement.style.display = "none";
        this.videoElement.style.opacity = "0";
      }
      if (this.transitionTimeout) clearTimeout(this.transitionTimeout);

      if (this.imageTimeout) clearTimeout(this.imageTimeout);
      if (this.imageCanvas) {
        this.imageCanvas.style.display = "none";
        this.imageCanvas.style.opacity = "0";
      }
      this.currentImage = null;

      if (this.imageRafId) cancelAnimationFrame(this.imageRafId);
      this.imageRafId = null;
      this.currentImageState = null;
      this.prevImageState = null;

      console.log(
        "[BGV] Switched to Canvas-Only Mode. Media engines disabled.",
      );
    } else {
      if (this.videoElement) this.videoElement.style.display = "";
      if (this.imageCanvas) this.imageCanvas.style.display = "";

      console.log("[BGV] Restored Media Mode.");
      this.start();
    }
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

    if (this.imageTimeout) clearTimeout(this.imageTimeout);
    if (this.imageCanvas) this.imageCanvas.style.opacity = "0";
    if (this.imageCleanupTimeout) clearTimeout(this.imageCleanupTimeout);

    if (this.imageRafId) {
      cancelAnimationFrame(this.imageRafId);
      this.imageRafId = null;
    }
    this.currentImageState = null;
    this.prevImageState = null;
  }
}
