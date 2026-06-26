import Html from "../../../libs/html.js";
import NetworkingUtility from "../../../libs/networkingUtility.js";

export default class RecordingsManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    const state = this.ctx.state;
    state.isRecordingsOpen = false;
    state.isPlayingRecording = false;
    state.isDeletePromptOpen = false;
    state.pendingDeleteRec = null;
    state.recordingsData = [];
    state.highlightedRecordingIndex = 0;

    this.recOsdTimeout = null;

    this.itemHeight = 85;
    this.renderedItems = new Map();
    this.listContent = null;
    this.scrollRaf = null;

    this.boundHandleScroll = this.handleScroll.bind(this);
  }

  init() {
    this.ctx.dom.recordingsList.styleJs({
      overflowY: "auto",
      position: "relative",
    });
  }

  /**
   * Shows the On-Screen Display (OSD) for the recording player and sets a timeout to auto-hide it.
   */
  triggerRecOsd() {
    const dom = this.ctx.dom;
    dom.recVideoOsd.classOff("hidden");
    if (this.recOsdTimeout) clearTimeout(this.recOsdTimeout);

    this.recOsdTimeout = setTimeout(() => {
      if (dom.recVideoPlayer && !dom.recVideoPlayer.elm.paused) {
        dom.recVideoOsd.classOn("hidden");
      }
    }, 3500);
  }

  /**
   * Opens or closes the Recordings Browser list.
   * @param {boolean|null} forceShow - Explicit state to set. If null, it toggles.
   */
  async toggleRecordingsList(forceShow = null) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;

    if (state.isTransitioning) return;

    const isOpening =
      forceShow !== null
        ? forceShow
        : dom.recordingsScreen.elm.classList.contains("hidden");

    if (isOpening) {
      state.isRecordingsOpen = true;
      dom.recordingsScreen.classOff("hidden");
      state.highlightedRecordingIndex = 0;
      await this.refreshRecordingsList();
    } else {
      state.isRecordingsOpen = false;
      dom.recordingsScreen.classOn("hidden");
      this.closeRecordingPlayer();
      this.cancelDeletePrompt();
    }
  }

  async refreshRecordingsList() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;

    dom.recordingsList.elm.removeEventListener(
      "scroll",
      this.boundHandleScroll,
    );
    dom.recordingsList.clear();
    this.renderedItems.clear();
    state.recordingsData = [];

    try {
      const recordings =
        await window.desktopIntegration.ipc.invoke("get-recordings");

      if (!recordings || recordings.length === 0) {
        new Html("div")
          .styleJs({
            opacity: "0.5",
            fontStyle: "italic",
            padding: "2rem",
            textAlign: "center",
            fontSize: "1.2rem",
          })
          .text("No recordings found. Go sing a song and capture the moment!")
          .appendTo(dom.recordingsList);
        return;
      }

      state.recordingsData = recordings;

      const totalHeight = state.recordingsData.length * this.itemHeight;
      this.listContent = new Html("div")
        .styleJs({
          height: `${totalHeight}px`,
          position: "relative",
          width: "100%",
        })
        .appendTo(dom.recordingsList);

      dom.recordingsList.elm.addEventListener("scroll", this.boundHandleScroll);

      this.renderVisibleItems();
      this.updateRecordingsHighlight();
    } catch (e) {
      new Html("div")
        .styleJs({
          opacity: "0.5",
          fontStyle: "italic",
          padding: "2rem",
          textAlign: "center",
          fontSize: "1.2rem",
          color: "#ff5555",
        })
        .text("Failed to load recordings.")
        .appendTo(dom.recordingsList);
    }
  }

  handleScroll() {
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => {
      this.renderVisibleItems();
    });
  }

  renderVisibleItems() {
    const state = this.ctx.state;
    const container = this.ctx.dom.recordingsList.elm;

    if (!state.recordingsData.length || !this.listContent) return;

    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight || window.innerHeight;

    const buffer = 3;
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / this.itemHeight) - buffer,
    );
    const endIndex = Math.min(
      state.recordingsData.length - 1,
      Math.floor((scrollTop + clientHeight) / this.itemHeight) + buffer,
    );

    const visibleIndices = new Set();
    for (let i = startIndex; i <= endIndex; i++) {
      visibleIndices.add(i);
    }

    for (const [idx, itemHtml] of this.renderedItems.entries()) {
      if (!visibleIndices.has(idx)) {
        itemHtml.elm.remove();
        this.renderedItems.delete(idx);
      }
    }

    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.renderedItems.has(i)) {
        const itemElement = this.createRecordingItemDOM(
          i,
          state.recordingsData[i],
        );
        this.renderedItems.set(i, itemElement);
      }
    }
  }

  createRecordingItemDOM(idx, rec) {
    const state = this.ctx.state;

    const item = new Html("div")
      .classOn("rec-item")
      .styleJs({
        position: "absolute",
        top: `${idx * this.itemHeight}px`,
        left: "0",
        right: "0",
        height: `${this.itemHeight}px`,
        cursor: "var(--cursor-pointer)",
        margin: "0",
        boxSizing: "border-box",
      })
      .appendTo(this.listContent);

    if (idx === state.highlightedRecordingIndex) {
      item.classOn("active");
    }

    const displayTitle =
      rec.title.split("-").slice(0, -3).join("-") || rec.title;

    const infoCol = new Html("div")
      .styleJs({
        display: "flex",
        flexDirection: "column",
        flexGrow: "1",
        justifyContent: "center",
      })
      .appendTo(item);

    new Html("div").classOn("rec-title").text(displayTitle).appendTo(infoCol);

    new Html("div")
      .classOn("rec-date")
      .text(new Date(rec.date).toLocaleString())
      .appendTo(infoCol);

    const deleteBtn = new Html("div")
      .text("✕")
      .styleJs({
        color: "rgba(255, 85, 85, 0.5)",
        cursor: "var(--cursor-pointer)",
        fontWeight: "bold",
        fontSize: "1.5rem",
        padding: "0.5rem 1rem",
        marginLeft: "1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "color 0.2s ease, transform 0.2s ease",
      })
      .appendTo(item);

    deleteBtn.elm.onmouseover = () =>
      deleteBtn.styleJs({ color: "#ff5555", transform: "scale(1.2)" });
    deleteBtn.elm.onmouseout = () =>
      deleteBtn.styleJs({
        color: "rgba(255, 85, 85, 0.5)",
        transform: "scale(1)",
      });

    item.on("click", (e) => {
      if (e.target === deleteBtn.elm) return;
      state.highlightedRecordingIndex = idx;
      this.updateRecordingsHighlight();
      this.playRecording(rec);
    });

    deleteBtn.on("click", (e) => {
      e.stopPropagation();
      state.highlightedRecordingIndex = idx;
      this.updateRecordingsHighlight();
      this.openDeletePrompt(rec);
    });

    return item;
  }

  updateRecordingsHighlight() {
    const state = this.ctx.state;
    const container = this.ctx.dom.recordingsList.elm;

    for (const [idx, item] of this.renderedItems.entries()) {
      const isHi = idx === state.highlightedRecordingIndex;
      item[isHi ? "classOn" : "classOff"]("active");
    }

    const targetTop = state.highlightedRecordingIndex * this.itemHeight;
    const targetBottom = targetTop + this.itemHeight;

    if (targetTop < container.scrollTop) {
      container.scrollTop = targetTop;
    } else if (targetBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = targetBottom - container.clientHeight;
    }
  }

  /**
   * Triggers playback of a specific recorded file using the local streaming endpoint.
   * @param {Object} rec - The recording metadata object
   */
  async playRecording(rec) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;

    state.isPlayingRecording = true;
    const videoUrl = await NetworkingUtility.getFileLink(rec.videoPath);

    const displayTitle =
      rec.title.split("-").slice(0, -3).join("-") || rec.title;
    dom.recVideoTitle.text(displayTitle);

    dom.recVideoPlayer.elm.volume = state.volume;
    dom.recVideoPlayer.attr({ src: videoUrl.href });

    dom.recPlayerOverlay.classOff("hidden");
    dom.recVideoPlayer.elm.play();

    this.triggerRecOsd();
  }

  closeRecordingPlayer() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;

    state.isPlayingRecording = false;
    dom.recVideoPlayer.elm.pause();
    dom.recVideoPlayer.attr({ src: "" });
    dom.recPlayerOverlay.classOn("hidden");

    if (this.recOsdTimeout) clearTimeout(this.recOsdTimeout);
  }

  /**
   * Opens the confirmation prompt before deleting a video.
   * @param {Object} rec - The recording object to queue for deletion.
   */
  openDeletePrompt(rec) {
    const displayTitle =
      rec.title.split("-").slice(0, -3).join("-") || rec.title;
    this.ctx.state.pendingDeleteRec = rec;
    this.ctx.state.isDeletePromptOpen = true;
    this.ctx.dom.recDeleteText.text(
      `Are you sure you want to permanently delete "${displayTitle}"?`,
    );
    this.ctx.dom.recDeleteOverlay.classOff("hidden");
  }

  cancelDeletePrompt() {
    this.ctx.state.isDeletePromptOpen = false;
    this.ctx.state.pendingDeleteRec = null;
    this.ctx.dom.recDeleteOverlay.classOn("hidden");
  }

  async confirmDeleteRecording() {
    const state = this.ctx.state;

    if (!state.pendingDeleteRec) return;

    const success = await window.desktopIntegration.ipc.invoke(
      "delete-recording",
      state.pendingDeleteRec.id,
    );

    if (success) {
      this.ctx.modules.infoBar.showTemp(
        "DELETED",
        "Recording session removed.",
        3000,
      );
      state.highlightedRecordingIndex = Math.max(
        0,
        state.highlightedRecordingIndex - 1,
      );
      await this.refreshRecordingsList();
    } else {
      this.ctx.modules.infoBar.showTemp(
        "ERROR",
        "Failed to delete recording.",
        3000,
      );
    }

    this.cancelDeletePrompt();
  }
}
