import Html from "/libs/html.js";

export class InfoBarModule {
  constructor(stateProvider, recorderCheck) {
    this.getState = stateProvider; // Function returning { reservationQueue, songMap }
    this.checkRecording = recorderCheck; // Function returning bool
    this.bar = null;
    this.labelEl = null;
    this.contentEl = null;
    this.timeout = null;
    this.isTempVisible = false;
    this.persistentState = { label: "", content: "" };
    console.log("[INFOBAR] InfoBar element initialized.");
  }

  mount(container) {
    this.bar = new Html("div").classOn("info-bar").appendTo(container);
    this.labelEl = new Html("div").classOn("info-bar-label").appendTo(this.bar);
    this.contentEl = new Html("div")
      .classOn("info-bar-content")
      .appendTo(this.bar);
  }

  show(label, content) {
    this.persistentState = { label, content };
    if (!this.isTempVisible) {
      this.labelEl.text(label);
      this.contentEl.html(content);
    }
  }

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

  showBar() {
    this.bar.classOn("persist-visible");
  }
  hideBar() {
    this.bar.classOff("persist-visible");
  }

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
      this.show(
        "UP NEXT",
        `${codeSpan} <span class="info-bar-title">${nextSong.title}</span> <span class="info-bar-artist">- ${nextSong.artist}${extra}</span>`,
      );
      this.showBar();
    } else {
      this.hideBar();
      this.show("UP NEXT", "—");
    }
  }

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
