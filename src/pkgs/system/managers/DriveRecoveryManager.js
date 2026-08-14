import Html from "../../../libs/html.js";
import NetworkingUtility from "../../../libs/networkingUtility.js";

const MESSAGES = {
  gone: [
    "Don't worry, you probably didn't break everything <3",
    "Encore needs that drive more than I need her, trust me",
    "Sorry chief, we can't get freaky this time...",
    "The angel has flown away from me, don't tell me the drive flew away too!",
    "You'll be safe here until you plug that drive back in :)",
    "Houston, we have a problem.",
  ],
  mismatch: [
    "Hi, TikTok, YouTube, or whatever platform I'm on right now!",
    "Did this screen answer your question? :)",
    "Sorry, hun, just like my date, this isn't a match",
    "Encore doesn't want that library, just like how I don't want anyone but her <3",
    "You've found the secret screen!",
    "Dang it, you've found the secret screen! Just don't tell her I like her, okay? Who is she? Not telling...",
  ],
};

/**
 * Normalizes and joins path segments with forward slashes.
 */
function pathJoin(parts) {
  return parts
    .map((part, index) => {
      if (!part) return "";
      let p = part.replace(/\\/g, "/");
      if (index > 0) p = p.replace(/^\//, "");
      if (index < parts.length - 1) p = p.replace(/\/$/, "");
      return p;
    })
    .filter(Boolean)
    .join("/");
}

/**
 * Extracts drive letter or mount point root from an absolute path.
 */
function extractDriveInfo(fullPath) {
  const normalized = fullPath.replace(/\\/g, "/");

  // Windows: match "E:" or "C:"
  const winMatch = normalized.match(/^([a-zA-Z]:)/);
  if (winMatch) {
    return {
      driveLabel: winMatch[1].toUpperCase(),
      normalizedPath: normalized,
    };
  }

  // Linux/Unix: match mount points like "/media/user/DriveName" or "/mnt/DriveName"
  const linuxMatch = normalized.match(
    /^(\/(?:media|mnt|run\/media)\/[^/]+(?:\/[^/]+)?)/,
  );
  if (linuxMatch) {
    return {
      driveLabel: linuxMatch[1],
      normalizedPath: normalized,
    };
  }

  return {
    driveLabel: normalized.split("/")[0] || normalized,
    normalizedPath: normalized,
  };
}

export default class DriveRecoveryManager {
  /**
   * @param {Object} context - The shared application context
   */
  constructor(context) {
    this.ctx = context;
    this.isDisconnected = false;
    this.pollInterval = null;
    this.isChecking = false;
    this.currentState = "idle"; // "idle" | "disconnected" | "mismatch"

    this.cachedTarget = null;
    this.dom = {};
  }

  /**
   * Captures and locks the exact drive letter, library path, and manifest structure.
   */
  captureLibraryFingerprint() {
    const fsSvc = this.ctx.services.FsSvc;
    const libInfo = fsSvc?.getLibraryInfo();
    const songList = this.ctx.state.songList || [];

    if (!libInfo || !libInfo.manifest) {
      console.warn(
        "[DriveRecovery] Cannot lock target: No active library loaded.",
      );
      return;
    }

    const driveInfo = extractDriveInfo(libInfo.path);
    const normalizedPath = driveInfo.normalizedPath;
    const manifest = libInfo.manifest;

    this.cachedTarget = {
      driveLabel: driveInfo.driveLabel,
      libraryPath: normalizedPath,
      manifestPath: pathJoin([normalizedPath, "manifest.json"]),
      probeTrackPath: songList.length > 0 ? songList[0].path : null,
      manifest: {
        id: manifest.id || null,
        title: manifest.title || "Unknown Library",
        version: manifest.version || "1.0",
        songCount: songList.length,
      },
    };

    console.log(
      `[DriveRecovery] Locked to drive [${this.cachedTarget.driveLabel}]:`,
      this.cachedTarget,
    );
  }

  /**
   * Builds the modal overlay DOM.
   */
  buildUI() {
    if (this.dom.overlay) return;

    const wrapper = this.ctx.wrapper;

    this.dom.overlay = new Html("div")
      .classOn("drive-disconnect-overlay", "hidden")
      .appendTo(wrapper);

    this.dom.modal = new Html("div")
      .classOn("drive-disconnect-modal")
      .appendTo(this.dom.overlay);

    const iconContainer = new Html("div")
      .classOn("drive-modal-icon-wrap")
      .appendTo(this.dom.modal);

    this.dom.icon = new Html("ion-icon")
      .attr({ name: "alert-circle-outline" })
      .classOn("drive-modal-icon")
      .appendTo(iconContainer);

    this.dom.title = new Html("h1")
      .classOn("drive-modal-title")
      .text("OOPS, THE DRIVE IS GONE")
      .appendTo(this.dom.modal);

    this.dom.message = new Html("p")
      .classOn("drive-modal-message")
      .appendTo(this.dom.modal);

    new Html("br").appendTo(this.dom.modal);

    this.dom.devMessage = new Html("p")
      .classOn("drive-modal-message")
      .appendTo(this.dom.modal);
  }

  /**
   * Triggered when file access fails due to a disconnected drive.
   */
  async handleDriveDisconnected() {
    if (this.isDisconnected) return;
    this.isDisconnected = true;
    this.ctx.state.isDriveDisconnected = true;

    console.warn(
      `[DriveRecovery] Storage drive [${this.cachedTarget?.driveLabel}] was removed.`,
    );

    const ui = this.ctx.root.ui;
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const library = this.ctx.root.library;

    if (state.isSearchOverlayVisible) {
      ui?.toggleSearchOverlay(false);
    }

    if (state.mode === "yt-search") {
      ui?.setMode("menu");
    }

    if (dom.searchInput?.elm) {
      dom.searchInput.elm.blur();
      dom.searchInput.elm.value = "";
    }

    state.searchResults = [];
    state.highlightedSearchIndex = -1;

    if (library?.ytSearchAbortController) {
      library.ytSearchAbortController.abort();
      library.ytSearchAbortController = null;
    }

    if (dom.searchWindow?.elm) {
      dom.searchWindow.classOff("has-results");
    }

    if (dom.searchResultsContainer?.elm) {
      dom.searchResultsContainer.clear();
    }

    if (state.isQueueOverlayVisible) {
      ui?.toggleQueueOverlay(false);
    }

    this.ctx.modules.bgv.stop();
    this.ctx.services.Forte.stopTrack();
    this.ctx.services.Forte.togglePianoRollVisibility(false);
    if (this.ctx.modules.recorder?.isRecording) {
      this.ctx.modules.recorder.stop();
    }

    await this.ctx.services.Forte.playSfx(
      "/assets/audio/drive_disconnected.wav",
    );

    this.showModal("disconnected");
    this.startRecoveryPolling();
  }

  /**
   * Displays and updates the popup UI.
   * @param {"disconnected" | "mismatch"} type
   * @param {string} [detectedTitle]
   */
  showModal(type, detectedTitle = null) {
    if (!this.dom.overlay) this.buildUI();

    this.currentState = type;
    this.dom.overlay.classOff("hidden");

    const driveLabel = this.cachedTarget?.driveLabel || "External Drive";
    const expectedTitle =
      this.cachedTarget?.manifest?.title || "Encore Library";

    if (type === "disconnected") {
      this.dom.modal.classOff("is-mismatch").classOn("is-disconnected");
      this.dom.title.text(`OOPS, THE DRIVE IS GONE`);
      this.dom.icon.attr({ name: "cloud-offline-outline" });
      this.dom.message.html(
        `The storage device mounted at <strong>${driveLabel}</strong> was removed.<br>Please plug drive <strong>${driveLabel}</strong> back in to continue.`,
      );
      this.dom.devMessage.html(
        `<strong>${MESSAGES.gone[Math.floor(Math.random() * MESSAGES.gone.length)]}</strong>`,
      );
    } else if (type === "mismatch") {
      this.dom.modal.classOff("is-disconnected").classOn("is-mismatch");
      this.dom.icon.attr({ name: "warning-outline" });
      this.dom.title.text(`OOPS, THIS IS NOT THE RIGHT DRIVE`);
      this.dom.message.html(
        `Drive <strong>${driveLabel}</strong> is mounted, but it contains <strong>${detectedTitle || "different files"}</strong> instead of the active session's library.`,
      );
      this.dom.devMessage.html(
        `<strong>${MESSAGES.mismatch[Math.floor(Math.random() * MESSAGES.mismatch.length)]}</strong>`,
      );
    }
  }

  /**
   * Starts periodic polling specifically for the target drive letter.
   */
  startRecoveryPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      if (this.isChecking) return;
      this.isChecking = true;
      try {
        await this.checkTargetDrive();
      } finally {
        this.isChecking = false;
      }
    }, 1500);
  }

  /**
   * Directly probes the target drive letter's manifest and files.
   */
  async checkTargetDrive() {
    if (!this.cachedTarget) return;

    try {
      const manifestUrl = await NetworkingUtility.getFileLink(
        this.cachedTarget.manifestPath,
      );
      const res = await fetch(manifestUrl.href, { cache: "no-store" });

      // Scenario A: Drive is gone
      if (!res.ok) {
        if (this.currentState !== "disconnected") {
          this.showModal("disconnected");
        }
        return;
      }

      const manifest = await res.json();
      const target = this.cachedTarget.manifest;

      // Scenario B: Drive letter exists, but manifest contents differ
      const isIdMatch =
        target.id && manifest.id ? target.id === manifest.id : true;
      const isTitleMatch = target.title === manifest.title;

      if (!isIdMatch || !isTitleMatch) {
        if (this.currentState !== "mismatch") {
          await this.ctx.services.Forte.playSfx(
            "/assets/audio/drive_mismatch.wav",
          );
          this.showModal("mismatch", manifest.title || "Unrecognized Library");
        }
        return;
      }

      // Verify sample song file is readable on the drive
      if (this.cachedTarget.probeTrackPath) {
        const probeUrl = await NetworkingUtility.getFileLink(
          this.cachedTarget.probeTrackPath,
        );
        const probeRes = await fetch(probeUrl.href, {
          method: "HEAD",
          cache: "no-store",
        });
        if (!probeRes.ok && probeRes.status !== 405) {
          if (this.currentState !== "mismatch") {
            await this.ctx.services.Forte.playSfx(
              "/assets/audio/drive_mismatch.wav",
            );
            this.showModal("mismatch", "Incomplete Library Files");
          }
          return;
        }
      }

      await this.handleSuccessfulRecovery();
    } catch (e) {
      // Drive is most likely gone
      if (this.currentState !== "disconnected") {
        this.showModal("disconnected");
      }
    }
  }

  /**
   * Dismisses the popup, plays the reconnection SFX, and resumes playback.
   */
  async handleSuccessfulRecovery() {
    console.log(
      `[DriveRecovery] Drive [${this.cachedTarget.driveLabel}] verified and reconnected.`,
    );

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await this.ctx.services.Forte.playSfx(
      "/assets/audio/drive_reconnected.wav",
    );

    this.dom.modal.styleJs({
      transform: "scale(0.95)",
      opacity: "0",
      transition: "all 0.35s ease",
    });

    setTimeout(() => {
      this.dom.overlay.classOn("hidden");
      this.dom.modal.styleJs({ transform: "", opacity: "" });

      this.isDisconnected = false;
      this.ctx.state.isDriveDisconnected = false;
      this.currentState = "idle";

      this.ctx.modules.bgv.start();

      if (this.ctx.state.mode === "player") {
        this.ctx.root.playback.stopPlayer();
        this.ctx.root.ui.setMode("menu");
      }

      this.ctx.modules.infoBar.showTemp(
        "STORAGE",
        `Drive ${this.cachedTarget.driveLabel} reconnected.`,
        4000,
      );
    }, 400);
  }

  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
