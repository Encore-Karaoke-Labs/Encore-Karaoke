import Html from "../libs/html.js";

/**
 * InfoBar module for displaying song information, playback state, and recording status
 */
export class InfoBarModule {
  /**
   * @param {Function} stateProvider - Callback to get current application state
   * @param {Function} recorderCheck - Callback to check if recording is active
   * @param {Function} formatProvider - Callback to get format badge information for songs
   */
  constructor(stateProvider, recorderCheck, formatProvider) {
    this.getState = stateProvider;
    this.checkRecording = recorderCheck;
    this.getFormatInfo = formatProvider;
    this.bar = null;
    this.labelEl = null;
    this.contentEl = null;
    this.timeout = null;
    this.isTempVisible = false;
    this.persistentState = { label: "", content: "" };

    this.cycleInterval = null;
    this.currentCycleView = "UP_NEXT"; // "UP_NEXT" | "NOW_PLAYING"
    this.cycleDuration = 5000; // Time in ms between views
    this._isInternalCycleUpdate = false;
  }

  /**
   * Mount the InfoBar to a container element
   * @param {HTMLElement} container - The container to mount the InfoBar to
   */
  mount(container) {
    this.bar = new Html("div").classOn("info-bar").appendTo(container);
    this.labelEl = new Html("div").classOn("info-bar-label").appendTo(this.bar);
    this.contentEl = new Html("div")
      .classOn("info-bar-content")
      .appendTo(this.bar);
  }

  /**
   * Display persistent information in the InfoBar.
   * @param {string} label - The label to display
   * @param {string} content - The HTML content to display
   */
  show(label, content) {
    if (!this._isInternalCycleUpdate) {
      this.stopCycle();
    }
    this.persistentState = { label, content };
    if (!this.isTempVisible && this.labelEl && this.contentEl) {
      this.labelEl.text(label);
      this.contentEl.html(content);
    }
  }

  /**
   * Display temporary information that auto-dismisses
   * @param {string} label - The label to display
   * @param {string} content - The HTML content to display
   * @param {number} duration - Duration in milliseconds before auto-dismissing
   */
  showTemp(label, content, duration) {
    if (this.timeout) clearTimeout(this.timeout);
    this.isTempVisible = true;
    this.labelEl.text(label);
    this.contentEl.html(content);
    this.bar.classOn("temp-visible");
    this.timeout = setTimeout(() => {
      this.isTempVisible = false;
      this.timeout = null;
      this.labelEl.text(this.persistentState.label);
      this.contentEl.html(this.persistentState.content);
      this.bar.classOff("temp-visible");
    }, duration);
  }

  /**
   * Show the InfoBar with persistent visibility
   */
  showBar() {
    this.bar?.classOn("persist-visible");
  }

  /**
   * Hide the InfoBar and stop any background cycling
   */
  hideBar() {
    this.stopCycle();
    this.bar?.classOff("persist-visible");
  }

  /**
   * Start the timer to alternate between NOW PLAYING and UP NEXT
   */
  startCycle() {
    if (this.cycleInterval) return;
    this.cycleInterval = setInterval(() => {
      this.cycleNext();
    }, this.cycleDuration);
  }

  /**
   * Stop the cycling timer
   */
  stopCycle() {
    if (this.cycleInterval) {
      clearInterval(this.cycleInterval);
      this.cycleInterval = null;
    }
  }

  /**
   * Advance to the next view in the cycle
   */
  cycleNext() {
    // Never interrupt temporary alerts (RESERVING, AUTO SKIP, etc.)
    if (this.isTempVisible) return;

    const { currentSong, reservationQueue = [] } = this.getState() || {};
    const hasQueue = reservationQueue && reservationQueue.length > 0;
    const hasCurrent = Boolean(currentSong);

    // If conditions for cycling are no longer met (song ended or queue cleared)
    if (!hasCurrent || !hasQueue) {
      this.showDefault();
      return;
    }

    this.currentCycleView =
      this.currentCycleView === "UP_NEXT" ? "NOW_PLAYING" : "UP_NEXT";

    this.renderCycleView();
  }

  /**
   * Renders whichever view is currently active in the cycle
   */
  renderCycleView() {
    const { currentSong, reservationQueue = [] } = this.getState() || {};
    this._isInternalCycleUpdate = true;
    try {
      if (this.currentCycleView === "NOW_PLAYING" && currentSong) {
        this.show("CURRENT", this.renderNowPlayingContent(currentSong));
      } else if (reservationQueue.length > 0) {
        this.show("UP NEXT", this.renderUpNextContent(reservationQueue));
      } else if (currentSong) {
        this.show("CURRENT", this.renderNowPlayingContent(currentSong));
      }
    } finally {
      this._isInternalCycleUpdate = false;
    }
  }

  /**
   * Renders the HTML markup for the currently playing song
   * @param {Object} song
   * @returns {string}
   */
  renderNowPlayingContent(song) {
    if (!song) return "";
    const isYt =
      !song.code ||
      (typeof song.path === "string" && song.path.startsWith("yt://"));
    const codeSpan = song.code
      ? `<span class="info-bar-code">${String(song.code).padStart(6, "0")}</span>`
      : `<span class="info-bar-code is-youtube">YT</span>`;

    let fmtBadge = "";
    if (this.getFormatInfo) {
      const fmt = this.getFormatInfo(song);
      if (fmt) {
        fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
      }
    }

    const singer = song.requesterNickname || song.singer;
    const singerSpan = singer
      ? ` <span class="info-bar-singer" style="opacity: 0.8; font-size: 0.9em;">(${singer})</span>`
      : "";

    const safeTitle = (song.title || "Unknown Title").replace(/"/g, "&quot;");
    const safeArtist = (song.artist || "Unknown Artist").replace(
      /"/g,
      "&quot;",
    );

    return `<div class="info-bar-current">${codeSpan} ${fmtBadge} <span class="info-bar-title">${safeTitle}</span> <span class="info-bar-artist">- ${safeArtist}</span>${singerSpan}</div>`;
  }

  /**
   * Renders the HTML markup for the UP NEXT song and upcoming badges
   * @param {Array} queue
   * @returns {string}
   */
  renderUpNextContent(queue) {
    if (!queue || queue.length === 0) return "—";
    const nextSong = queue[0];
    const isYt =
      !nextSong.code ||
      (typeof nextSong.path === "string" && nextSong.path.startsWith("yt://"));
    const codeSpan = nextSong.code
      ? `<span class="info-bar-code">${String(nextSong.code).padStart(6, "0")}</span>`
      : `<span class="info-bar-code is-youtube">YT</span>`;

    let fmtBadge = "";
    if (this.getFormatInfo) {
      const fmt = this.getFormatInfo(nextSong);
      if (fmt) {
        fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
      }
    }

    const upcomingSongs = queue.slice(1);
    let upcomingHtml = "";

    if (upcomingSongs.length > 0) {
      const MAX_UPCOMING = 5;
      const displaySongs = upcomingSongs.slice(0, MAX_UPCOMING);
      const remainingCount = upcomingSongs.length - displaySongs.length;

      const codeBadges = displaySongs
        .map((s) => {
          const isItemYt =
            !s.code ||
            (typeof s.path === "string" && s.path.startsWith("yt://"));
          const codeText = s.code ? String(s.code).padStart(6, "0") : "YT";
          const ytClass = isItemYt ? " is-youtube" : "";
          const safeTitle =
            `${s.title || "Unknown"} - ${s.artist || "Unknown"}`.replace(
              /"/g,
              "&quot;",
            );
          return `<span class="info-bar-upcoming-code${ytClass}" title="${safeTitle}">${codeText}</span>`;
        })
        .join("");

      const moreBadge =
        remainingCount > 0
          ? `<span class="info-bar-upcoming-more">+${remainingCount}</span>`
          : "";

      upcomingHtml = `
        <div class="info-bar-upcoming">
          <div class="info-bar-upcoming-list">
            ${codeBadges}
            ${moreBadge}
          </div>
        </div>
      `;
    }

    const safeTitle = (nextSong.title || "Unknown Title").replace(
      /"/g,
      "&quot;",
    );
    const safeArtist = (nextSong.artist || "Unknown Artist").replace(
      /"/g,
      "&quot;",
    );

    return `<div class="info-bar-current">${codeSpan} ${fmtBadge} <span class="info-bar-title">${safeTitle}</span> <span class="info-bar-artist">- ${safeArtist}</span></div>${upcomingHtml}`;
  }

  /**
   * Display default information based on application state (recording, now playing, or up next)
   */
  showDefault() {
    if (this.checkRecording) {
      const recStatus = this.checkRecording();
      if (recStatus) {
        this.stopCycle();
        const textToDisplay =
          typeof recStatus === "string" ? recStatus : "REC ●";
        this.show("RECORDING", textToDisplay);
        this.showBar();
        return;
      }
    }

    const { currentSong, reservationQueue = [], mode } = this.getState() || {};
    const hasQueue = reservationQueue && reservationQueue.length > 0;
    const hasCurrent = Boolean(currentSong);

    if (mode === "menu" && !hasQueue) {
      this.stopCycle();
      this.hideBar();
      this.show("UP NEXT", "—");
      return;
    }

    if (hasCurrent && hasQueue) {
      this.startCycle();
      this.renderCycleView();
      this.showBar();
      return;
    }

    if (hasQueue) {
      this.stopCycle();
      this.show("UP NEXT", this.renderUpNextContent(reservationQueue));
      this.showBar();
      return;
    }

    if (hasCurrent) {
      this.stopCycle();
      this.show("CURRENT", this.renderNowPlayingContent(currentSong));
      this.showBar();
      return;
    }

    this.stopCycle();
    this.hideBar();
    this.show("UP NEXT", "—");
  }

  /**
   * Display a song reservation being entered
   * @param {string} reservationNumber - The song code being reserved
   */
  showReservation(reservationNumber) {
    const displayCode = reservationNumber.padStart(6, "0");
    const { songMap } = this.getState() || {};
    const song =
      songMap?.get(reservationNumber) ??
      songMap?.get(reservationNumber.padStart(5, "0")) ??
      songMap?.get(displayCode);

    let songInfo = song
      ? `<span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>`
      : reservationNumber.length === 6
        ? `<span style="opacity: 0.5;">No song found.</span>`
        : "";

    this.showTemp(
      "RESERVING",
      `<span class="info-bar-code">${displayCode}</span> ${songInfo}`,
      3000,
    );
  }

  /**
   * Clean up all timers and intervals
   */
  destroy() {
    this.stopCycle();
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}
