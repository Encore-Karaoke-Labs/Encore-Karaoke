import Html from "../libs/html.js";
import { findSongByCode } from "../libs/songLookup.js";

export const DEFAULT_INFO_BAR_ICON = "information-circle";

/**
 * IonIcon name mapping for standard Encore InfoBar message labels.
 */
export const INFO_BAR_LABEL_ICONS = {
  // Playback & Queue
  CURRENT: "musical-notes",
  "UP NEXT": "play-forward",
  PAUSED: "pause",
  PAUSE: "pause",
  "AUTO SKIP": "play-skip-forward",
  EXTENDED: "time",

  // Audio, Sound Engine & Balance
  VOLUME: "volume-high",
  "MIC VOLUME": "mic",
  TRANSPOSE: "swap-vertical",
  BALANCE: "git-compare",
  CHORUS: "people",
  MELODY: "musical-notes",
  RHYTHM: "pulse-outline",

  // Visuals & Video
  BGV: "videocam",
  "VIDEO SYNC": "sync",
  LYRICS: "text",
  FULLSCREEN: "scan",

  // Sessions, Recordings & Operations
  RECORDING: "radio-button-on",
  RESERVING: "keypad",
  QUEUE: "list",
  SESSIONS: "people-circle",
  SETUP: "settings",
  UPDATE: "cloud-download",
  ERROR: "alert-circle",
};

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
    this.persistentState = { label: "", content: "", icon: null };
    this.defaultIcon = DEFAULT_INFO_BAR_ICON;

    this.cycleInterval = null;
    this.currentCycleView = "UP_NEXT"; // "UP_NEXT" | "NOW_PLAYING"
    this.cycleDuration = 10000; // Time in ms between views
    this._isInternalCycleUpdate = false;
  }

  /**
   * Resolves the appropriate IonIcon name for a given label.
   * @param {string} label - The message label
   * @param {string|null} customIcon - Optional explicit icon override
   * @returns {string} - IonIcon name
   */
  resolveIcon(label, customIcon = null) {
    if (customIcon) return customIcon;
    if (!label) return this.defaultIcon;
    const normalizedKey = String(label).trim().toUpperCase();
    return INFO_BAR_LABEL_ICONS[normalizedKey] || this.defaultIcon;
  }

  /**
   * Updates the label DOM element with an icon and label text.
   * @param {string} label - The label string to display
   * @param {string|null} customIcon - Optional custom icon
   */
  renderLabel(label, customIcon = null) {
    if (!this.labelEl) return;
    if (!label && label !== 0) {
      this.labelEl.html("");
      return;
    }

    const iconName = this.resolveIcon(label, customIcon);
    this.labelEl.html(
      `<ion-icon class="info-bar-label-icon" name="${iconName}"></ion-icon><span class="info-bar-label-text">${label}</span>`,
    );
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
   * @param {string|null} [icon=null] - Optional IonIcon name override
   */
  show(label, content, icon = null) {
    if (!this._isInternalCycleUpdate) {
      this.stopCycle();
    }
    this.persistentState = { label, content, icon };
    if (!this.isTempVisible && this.labelEl && this.contentEl) {
      this.renderLabel(label, icon);
      this.contentEl.html(content);
    }
  }

  /**
   * Display temporary information that auto-dismisses
   * @param {string} label - The label to display
   * @param {string} content - The HTML content to display
   * @param {number} duration - Duration in milliseconds before auto-dismissing
   * @param {string|null} [icon=null] - Optional IonIcon name override
   */
  showTemp(label, content, duration, icon = null) {
    if (this.timeout) clearTimeout(this.timeout);
    this.isTempVisible = true;
    this.renderLabel(label, icon);
    this.contentEl.html(content);
    this.bar.classOn("temp-visible");
    this.timeout = setTimeout(() => {
      this.isTempVisible = false;
      this.timeout = null;
      this.renderLabel(this.persistentState.label, this.persistentState.icon);
      this.contentEl.html(this.persistentState.content);
      this.bar.classOff("temp-visible");
    }, duration);
  }

  /**
   * Display the live instrumental volume in the InfoBar.
   * @param {number} pct - Volume percentage (0-100).
   */
  showVolume(pct) {
    this.showTemp(
      "VOLUME",
      `<div class="volume-display"><div class="volume-slider-container"><div class="volume-slider-fill" style="width: ${pct}%"></div></div><span class="volume-percentage">${pct}%</span></div>`,
      3000,
    );
  }

  /**
   * Display the live mic monitor volume in the InfoBar.
   * @param {number} pct - Mic volume percentage (0-200).
   */
  showMicVolume(pct) {
    this.showTemp(
      "MIC VOLUME",
      `<div class="volume-display"><div class="volume-slider-container"><div class="volume-slider-fill" style="width: ${pct / 2}%"></div></div><span class="volume-percentage">${pct}%</span></div>`,
      3000,
    );
  }

  /**
   * Display the live transpose value in the InfoBar.
   * @param {number} value - Transpose in semitones (-24 to 24).
   */
  showTranspose(value) {
    const next = Number(value);
    let left = 50;
    let width = 0;
    if (next > 0) width = (next / 24) * 50;
    else if (next < 0) {
      width = (Math.abs(next) / 24) * 50;
      left = 50 - width;
    }
    this.showTemp(
      "TRANSPOSE",
      `<div class="transpose-display"><div class="transpose-min">-24</div><div class="transpose-slider-container"><div class="transpose-slider-center-line"></div><div class="transpose-slider-fill" style="left: ${left}%; width: ${width}%;"></div></div><div class="transpose-max">+24</div><span class="transpose-value">${next > 0 ? "+" : ""}${next} st</span></div>`,
      3000,
    );
  }

  /**
   * Display the live tempo value in the InfoBar.
   * @param {number} value - Tempo multiplier (0.5 to 2.0).
   */
  showTempo(value) {
    const next = Number(value);
    const proportion = (next - 0.5) / 1.5;
    const width = proportion * 100;
    this.showTemp(
      "TEMPO",
      `<div class="tempo-display"><div class="tempo-min">0.5x</div><div class="tempo-slider-container"><div class="tempo-slider-fill" style="width: ${width}%"></div></div><div class="tempo-max">2.0x</div><span class="tempo-value">${next.toFixed(1)}x</span></div>`,
      3000,
    );
  }

  /**
   * Display the live balance (multiplex pan) in the InfoBar.
   * @param {number} pan - Pan value (-1 to 1).
   */
  showBalance(pan) {
    let txt = "BALANCED";
    if (pan <= -0.99) txt = "INSTRUMENTAL";
    else if (pan >= 0.99) txt = "VOCAL GUIDE";
    else txt = pan < 0 ? `◀ ${Math.abs(Math.round(pan * 100))}% INST` : `VOC ${Math.round(pan * 100)}% ▶`;
    this.showTemp("BALANCE", txt, 3000);
  }

  /**
   * Display the chorus on/off state in the InfoBar.
   * @param {boolean} enabled - Whether chorus is enabled.
   */
  showChorus(enabled) {
    this.showTemp(
      "CHORUS",
      `<div class="volume-display" style="display: flex; align-items: center; justify-content: center; width: 100%;"><div style="font-weight: 700; color: #ffd700; font-size: 1.2rem;">CHORUS ${enabled ? "ON" : "OFF"}</div></div>`,
      3000,
    );
  }

  /**
   * Display the guide melody level in the InfoBar.
   * @param {string} label - Level label (e.g. "NORMAL").
   * @param {number} value - Level value (0-127).
   * @param {string} color - Level color.
   */
  showMelody(label, value, color) {
    this.showTemp(
      "MELODY",
      `<div class="volume-display" style="display: flex; align-items: center; width: 100%; gap: 1rem;">
        <div style="font-weight: 700; color: ${color}; width: 85px; text-align: left;">${label}</div>
        <div class="volume-slider-container" style="flex-grow: 1; height: 12px; background-color: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; overflow: hidden;">
          <div class="volume-slider-fill" style="height: 100%; background-color: ${color}; border-radius: 6px; transition: width 0.1s linear; width: ${(value / 127) * 100}%"></div>
        </div>
      </div>`,
      3000,
    );
  }

  /**
   * Display the rhythm carousel in the InfoBar.
   * @param {Array} rhythms - The rhythm list.
   * @param {number} currentIndex - The index of the selected rhythm.
   */
  showRhythm(rhythms, currentIndex) {
    this.showTemp(
      "RHYTHM",
      `<div class="rhythm-carousel" style="opacity: 0; transition: opacity 0.2s ease-out;">
        ${rhythms
          .map((rhythm, idx) => {
            const isSelected = idx === currentIndex;
            const rhythmNumber = (idx + 1).toString().padStart(2, "0");
            const label = rhythm.original
              ? "ORIGINAL"
              : `RHYTHM ${rhythmNumber}`;
            return `
            <div class="rhythm-item ${isSelected ? "selected" : ""}">
              <span>${label}</span>
              <span>${rhythm.name}</span>
            </div>
          `;
          })
          .join("")}
      </div>`,
      3000,
    );
  }

  /**
   * Display the drum kit carousel in the InfoBar.
   * @param {Array} drums - The available drum presets.
   * @param {number} currentIndex - The index of the selected preset.
   */
  showKit(drums, currentIndex) {
    this.showTemp(
      "KIT",
      `<div class="rhythm-carousel" style="opacity: 0; transition: opacity 0.2s ease-out;">
        ${drums
          .map((preset, idx) => {
            const isSelected = idx === currentIndex;
            const kitNumber = (idx + 1).toString().padStart(2, "0");
            return `
            <div class="rhythm-item ${isSelected ? "selected" : ""}">
              <span>KIT ${kitNumber}</span>
              <span>${preset.name.substring(0, 12)}</span>
            </div>
          `;
          })
          .join("")}
      </div>`,
      3000,
    );
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
    const song = findSongByCode(songMap, reservationNumber);

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
