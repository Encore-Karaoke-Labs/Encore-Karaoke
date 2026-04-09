import Html from "/libs/html.js";

/**
 * InfoBar module for displaying song information and recording status
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
   * Display persistent information in the InfoBar
   * @param {string} label - The label to display
   * @param {string} content - The HTML content to display
   */
  show(label, content) {
    this.persistentState = { label, content };
    if (!this.isTempVisible) {
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
    this.bar.classOn("persist-visible");
  }
  /**
   * Hide the InfoBar
   */
  hideBar() {
    this.bar.classOff("persist-visible");
  }

  /**
   * Display default information based on application state (recording or up next song)
   */
  showDefault() {
    if (this.checkRecording && this.checkRecording()) {
      this.show("RECORDING", "REC ●");
      this.showBar();
      return;
    }
    const { reservationQueue } = this.getState();
    if (reservationQueue.length > 0) {
      const nextSong = reservationQueue[0];
      const extra =
        reservationQueue.length > 1 ? ` (+${reservationQueue.length - 1})` : "";
      const codeSpan = nextSong.code
        ? `<span class="info-bar-code">${nextSong.code}</span>`
        : `<span class="info-bar-code is-youtube">YT</span>`;

      let fmtBadge = "";
      if (this.getFormatInfo) {
        const fmt = this.getFormatInfo(nextSong);
        fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
      }

      this.show(
        "UP NEXT",
        `${codeSpan} ${fmtBadge} <span class="info-bar-title">${nextSong.title}</span> <span class="info-bar-artist">- ${nextSong.artist}${extra}</span>`,
      );
      this.showBar();
    } else {
      this.hideBar();
      this.show("UP NEXT", "—");
    }
  }

  /**
   * Display a song reservation being entered
   * @param {string} reservationNumber - The song code being reserved
   */
  showReservation(reservationNumber) {
    const { songMap } = this.getState();
    const displayCode = reservationNumber.padStart(5, "0");
    const song = songMap.get(displayCode);
    let songInfo = song
      ? `<span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>`
      : reservationNumber.length === 5
        ? `<span style="opacity: 0.5;">No song found.</span>`
        : "";
    this.showTemp(
      "RESERVING",
      `<span class="info-bar-code">${displayCode}</span> ${songInfo}`,
      3000,
    );
  }
}
