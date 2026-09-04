import Html from "../../../libs/html.js";

/**
 * @param {Object} context - The shared context
 */
export default class InputManager {
  constructor(context) {
    this.ctx = context;

    this.drums = [];
    this.currentDrumPresetIndex = -1;

    this.guideMelodyLevels = [
      { label: "OFF", value: 0 },
      { label: "SOFT", value: 45 },
      { label: "NORMAL", value: 90 },
      { label: "STRONG", value: 127 },
    ];
    this.currentGuideMelodyIndex = 2;
    this.lastNavSfxTime = 0;
  }

  /**
   * Plays a navigation sound effect.
   * @param {string} sfxName - The name of the wav file (without extension)
   */
  playNavSfx(sfxName) {
    if (this.ctx.state.isNavSfxEnabled === false) return;

    const now = Date.now();
    if (now - this.lastNavSfxTime < 80) return;

    this.lastNavSfxTime = now;
    this.ctx.services.Forte.playSfx(`/assets/audio/${sfxName}.wav`);
  }

  /**
   * Global catch mechanism translating keyboard presses into mapped command functions.
   *
   * @param {KeyboardEvent} e - A raw DOM keydown occurrence.
   */
  handleKeyDown(e) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const ui = this.ctx.root.ui;
    const playback = this.ctx.root.playback;
    const sessions = this.ctx.root.sessions;
    const recordings = this.ctx.root.recordings;
    const modules = this.ctx.modules;

    if (state.isDriveDisconnected) {
      e.preventDefault();
      return;
    }

    if (modules.mixer.isVisible) {
      modules.mixer.handleKeyDown(e);
      return;
    }

    if (this.ctx.root.games && this.ctx.root.games.isVisible) {
      return;
    }

    if (
      dom.sessionChatInput &&
      document.activeElement === dom.sessionChatInput.elm
    ) {
      return;
    }

    const isSearchInputFocused =
      dom.searchInput && document.activeElement === dom.searchInput.elm;

    // Session Chat Shortcuts
    if (
      state.isSessionActive &&
      !state.isSearchOverlayVisible &&
      state.mode !== "yt-search" &&
      !isSearchInputFocused &&
      !state.isSessionModalOpen
    ) {
      if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        state.chatInputMode = "chat";
        dom.sessionChatMode.text("CHAT").elm.className =
          "session-chat-mode mode-chat";
        dom.sessionChatInput.elm.focus();
        return;
      }
    }

    if (e.key === "F2") {
      e.preventDefault();
      if (
        state.mode === "player" &&
        (state.lastPlaybackStatus === "playing" ||
          state.lastPlaybackStatus === "paused")
      ) {
        modules.infoBar.showTemp(
          "SETUP",
          "Please stop playback to enter Setup.",
          3000,
        );
        return;
      }
      if (state.mode === "setup") {
        this.ctx.root.setup.exitSetup();
      } else {
        ui.setMode("setup");
      }
      return;
    }

    if (state.mode === "setup") {
      this.ctx.root.setup.handleKeyDown(e);
      return;
    }

    if (state.isDeletePromptOpen) {
      e.preventDefault();
      if (e.key === "Escape") recordings.cancelDeletePrompt();
      else if (e.key === "Enter") recordings.confirmDeleteRecording();
      return;
    }

    if (state.isSessionModalOpen) {
      sessions.handleKeyDown(e);
      return;
    }

    if (e.key.toLowerCase() === "s") {
      if (
        state.mode === "menu" &&
        !state.isTypingNumber &&
        !state.isSearchOverlayVisible
      ) {
        e.preventDefault();
        sessions.toggleSessionModal();
        return;
      }
    }

    if (state.isPlayingRecording) {
      e.preventDefault();
      recordings.triggerRecOsd();

      if (e.key === "Escape" || e.key === "Backspace") {
        recordings.closeRecordingPlayer();
      } else if (e.key === " " || e.key === "Enter") {
        const v = dom.recVideoPlayer.elm;
        v.paused ? v.play() : v.pause();
      } else if (e.key === "ArrowLeft") {
        dom.recVideoPlayer.elm.currentTime = Math.max(
          0,
          dom.recVideoPlayer.elm.currentTime - 5,
        );
      } else if (e.key === "ArrowRight") {
        dom.recVideoPlayer.elm.currentTime += 5;
      } else if (e.key === "-" || e.key === "_") {
        this.handleVolume("down");
        dom.recVideoPlayer.elm.volume = state.volume;
      } else if (e.key === "=" || e.key === "+") {
        this.handleVolume("up");
        dom.recVideoPlayer.elm.volume = state.volume;
      }
      return;
    }

    if (state.isRecordingsOpen) {
      e.preventDefault();
      if (e.key === "Escape" || e.key === "Backspace") {
        recordings.toggleRecordingsList(false);
      } else if (e.key === "ArrowUp") {
        const newIdx = Math.max(0, state.highlightedRecordingIndex - 1);
        if (state.mode !== "player") {
          if (newIdx === state.highlightedRecordingIndex)
            this.playNavSfx("out_of_bounds");
          else this.playNavSfx("nav");
        }
        state.highlightedRecordingIndex = newIdx;
        recordings.updateRecordingsHighlight();
      } else if (e.key === "ArrowDown") {
        const newIdx = Math.min(
          state.recordingsData.length - 1,
          state.highlightedRecordingIndex + 1,
        );
        if (state.mode !== "player") {
          if (newIdx === state.highlightedRecordingIndex)
            this.playNavSfx("out_of_bounds");
          else this.playNavSfx("nav");
        }
        state.highlightedRecordingIndex = newIdx;
        recordings.updateRecordingsHighlight();
      } else if (e.key === "Enter") {
        const rec = state.recordingsData[state.highlightedRecordingIndex];
        if (rec) recordings.playRecording(rec);
      } else if (e.key === "Delete") {
        const rec = state.recordingsData[state.highlightedRecordingIndex];
        if (rec) recordings.openDeletePrompt(rec);
      }
      return;
    }

    if (state.isQueueOverlayVisible) {
      e.preventDefault();

      const doDelete = () => {
        if (
          !state.isSessionActive &&
          state.highlightedQueueIndex >= 0 &&
          state.highlightedQueueIndex < state.reservationQueue.length
        ) {
          state.reservationQueue.splice(state.highlightedQueueIndex, 1);
          if (state.highlightedQueueIndex >= state.reservationQueue.length) {
            state.highlightedQueueIndex = Math.max(
              0,
              state.reservationQueue.length - 1,
            );
          }
          if (state.reservationQueue.length === 0) {
            state.highlightedQueueIndex = -1;
            state.isQueueDeleteHighlighted = false;
          }

          this.ctx.modules.infoBar.showTemp(
            "QUEUE",
            "Song removed from queue.",
            3000,
          );
          setTimeout(() => this.ctx.modules.infoBar.showDefault(), 3000);
          ui.renderQueue();
        } else if (state.isSessionActive) {
          this.playNavSfx("out_of_bounds");
          this.ctx.modules.infoBar.showTemp(
            "QUEUE",
            "Cannot delete in Sessions mode.",
            3000,
          );
        }
      };

      if (e.key === "Escape" || e.key.toLowerCase() === "q") {
        ui.toggleQueueOverlay(false);
      } else if (e.key === "ArrowUp") {
        const queueLen = state.isSessionActive
          ? this.ctx.services.SessionsSvc?.state?.queue?.length || 0
          : state.reservationQueue.length;
        if (queueLen === 0) return;
        state.highlightedQueueIndex = Math.max(
          0,
          state.highlightedQueueIndex - 1,
        );
        state.isQueueDeleteHighlighted = false;
        ui.updateQueueHighlight();
      } else if (e.key === "ArrowDown") {
        const queueLen = state.isSessionActive
          ? this.ctx.services.SessionsSvc?.state?.queue?.length || 0
          : state.reservationQueue.length;
        if (queueLen === 0) return;
        state.highlightedQueueIndex = Math.min(
          queueLen - 1,
          state.highlightedQueueIndex + 1,
        );
        state.isQueueDeleteHighlighted = false;
        ui.updateQueueHighlight();
      } else if (e.key === "ArrowRight") {
        if (
          !state.isSessionActive &&
          state.highlightedQueueIndex >= 0 &&
          !state.isQueueDeleteHighlighted
        ) {
          state.isQueueDeleteHighlighted = true;
          ui.updateQueueHighlight();
        }
      } else if (e.key === "ArrowLeft") {
        if (!state.isSessionActive && state.isQueueDeleteHighlighted) {
          state.isQueueDeleteHighlighted = false;
          ui.updateQueueHighlight();
        }
      } else if (e.key === "Enter" && state.isQueueDeleteHighlighted) {
        doDelete();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        doDelete();
      }
      return;
    }
    if (state.isYtSkipWarningActive && e.key === "ArrowUp") {
      e.preventDefault();
      playback.extendYoutubeSkip();
      return;
    }

    if (state.isScoreScreenActive) {
      if (["Enter", " ", "Escape"].includes(e.key)) {
        if (state.scoreSkipResolver) {
          this.ctx.services.Forte.stopSfx();
          state.scoreSkipped = true;
          state.scoreSkipResolver();
          if (state.isSessionActive) {
            this.ctx.services.SessionsSvc.broadcastSkipScore();
          }
        }
        e.preventDefault();
      }
      return;
    }

    if (isSearchInputFocused) {
      if (e.key === "Backspace" && !dom.searchInput.getValue()) {
        e.preventDefault();
        this.handleBackspace();
        return;
      }
      if (!["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) return;
      e.preventDefault();
    } else {
      e.preventDefault();
    }

    if (state.mode === "menu" && !state.showSongList) {
      if (
        (e.key >= "0" && e.key <= "9") ||
        e.key.startsWith("Arrow") ||
        e.key.toLowerCase() === "y"
      ) {
        state.showSongList = true;
      }
    }

    if (e.key.toLowerCase() === "m") {
      modules.mixer.toggle();
      return;
    }

    if (e.key.toLowerCase() === "r") {
      if (state.mode === "player" && !state.currentSongIsYouTube) {
        if (state.isSessionActive) {
          modules.infoBar.showTemp(
            "RECORDING",
            "Disabled during an active Session.",
            4000,
          );
          modules.dialog(
            new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
            2000,
          );
        } else {
          modules.recorder.toggle();
        }
      } else if (state.mode === "menu") {
        recordings.toggleRecordingsList();
      }
      return;
    }

    if (
      e.key.toLowerCase() === "q" &&
      !isSearchInputFocused &&
      !state.isSearchOverlayVisible
    ) {
      e.preventDefault();
      ui.toggleQueueOverlay(!state.isQueueOverlayVisible);
      return;
    }

    if (e.key >= "0" && e.key <= "9") this.handleDigitInput(e.key);
    else if (e.key === "Backspace") this.handleBackspace();
    else if (e.key === "Enter") this.handleEnter();
    else if (e.key === "Escape") this.handleEscape();
    else if (e.key === "ArrowUp") this.handleNav("up");
    else if (e.key === "ArrowDown") this.handleNav("down");
    else if (e.key === "ArrowLeft") this.handlePan("left");
    else if (e.key === "ArrowRight") this.handlePan("right");
    else if (e.key === "-" && !e.shiftKey) this.handleVolume("down");
    else if (e.key === "=" && !e.shiftKey) this.handleVolume("up");
    else if (e.key === "_" || (e.key === "-" && e.shiftKey))
      this.handleMicVolume("down");
    else if (e.key === "+" || (e.key === "=" && e.shiftKey))
      this.handleMicVolume("up");
    else if (e.key === "[" || e.key === "]") this.handleBracket(e.key);
    else if (e.key === ";") this.cycleDrumPreset("left");
    else if (e.key === "'") this.cycleDrumPreset("right");
    else if (e.key.toLowerCase() === "c") this.handleChorusToggle();
    else if (e.key.toLowerCase() === "g") this.cycleGuideMelody();
    else if (e.key.toLowerCase() === "y") this.handleYKey();
    else if (e.key === " ") this.handleSpace();
  }

  /**
   * Toggles pause when the space bar is pressed.
   */
  handleSpace() {
    if (this.ctx.state.mode === "player") {
      this.ctx.root.playback.togglePause();
    }
  }

  /**
   * Toggles Chorus
   */
  handleChorusToggle() {
    const state = this.ctx.state;
    const Forte = this.ctx.services.Forte;
    const modules = this.ctx.modules;

    if (state.mode !== "player") return;

    const pbState = Forte.getPlaybackState();

    if (!state.currentSongIsMIDI || !pbState.hasChorus) {
      modules.infoBar.showTemp(
        "CHORUS",
        "Not available for this format.",
        3000,
      );
      if (typeof modules.dialog === "function") {
        modules.dialog(
          new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
          2000,
        );
      }
      return;
    }

    const isEnabled = Forte.toggleChorus();

    const html = `
      <div class="volume-display" style="display: flex; align-items: center; justify-content: center; width: 100%;">
        <div style="font-weight: 700; color: #ffd700; font-size: 1.2rem;">CHORUS ${isEnabled ? "ON" : "OFF"}</div>
      </div>
    `;
    modules.infoBar.showTemp("CHORUS", html, 3000);
  }

  /**
   * Cycles the guide melody volume between Off, Soft, Normal, and Strong.
   */
  cycleGuideMelody() {
    const state = this.ctx.state;
    const Forte = this.ctx.services.Forte;
    const modules = this.ctx.modules;

    if (state.mode !== "player") return;

    const pbState = Forte.getPlaybackState();

    if (!state.currentSongIsMIDI || !pbState.hasGuideNotes) {
      modules.infoBar.showTemp(
        "MELODY",
        "Not available for this format.",
        3000,
      );
      if (typeof modules.dialog === "function") {
        modules.dialog(
          new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
          2000,
        );
      }
      return;
    }

    this.currentGuideMelodyIndex =
      (this.currentGuideMelodyIndex + 1) % this.guideMelodyLevels.length;
    const level = this.guideMelodyLevels[this.currentGuideMelodyIndex];

    Forte.setGuideTrackVolume(level.value);

    const html = `
      <div class="volume-display" style="display: flex; align-items: center; width: 100%; gap: 1rem;">
        <div style="font-weight: 700; color: #ffd700; width: 85px; text-align: left;">${level.label}</div>
        <div class="volume-slider-container" style="flex-grow: 1; height: 12px; background-color: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; overflow: hidden;">
          <div class="volume-slider-fill" style="height: 100%; background-color: #ffd700; border-radius: 6px; transition: width 0.1s linear; width: ${(level.value / 127) * 100}%"></div>
        </div>
      </div>
    `;

    modules.infoBar.showTemp("MELODY", html, 3000);
  }

  /**
   * Cycles the active drum preset on the standard MIDI percussion channel.
   * Remembers the user's selection throughout the song.
   *
   * @param {string} direction - "left" to cycle to the previous preset, "right" to cycle to the next preset
   */
  cycleDrumPreset(direction) {
    const state = this.ctx.state;
    const Forte = this.ctx.services.Forte;
    const modules = this.ctx.modules;

    let numDir = direction === "left" ? -1 : 1;

    if (state.mode !== "player" || !state.currentSongIsMIDI) {
      modules.infoBar.showTemp(
        "RHYTHM",
        "Not available for this format.",
        3000,
      );
      modules.dialog(
        new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
        2000,
      );
      return;
    }

    this.drums = Forte.getAvailableDrumPresets();
    if (!this.drums || this.drums.length === 0) {
      modules.infoBar.showTemp("RHYTHM", "No rhythm patches available", 3000);
      return;
    }

    const channelNumber = 9;

    if (this.currentDrumPresetIndex === -1) {
      const current = Forte.getCurrentDrumPreset(channelNumber);
      if (current) {
        const matchedIndex = this.drums.findIndex(
          (p) =>
            p.program === current.program &&
            p.bankMSB === current.bankMSB &&
            p.bankLSB === current.bankLSB,
        );
        this.currentDrumPresetIndex = matchedIndex !== -1 ? matchedIndex : 0;
      } else {
        this.currentDrumPresetIndex = 0;
      }
    }

    const nextIndex =
      (this.currentDrumPresetIndex + numDir + this.drums.length) %
      this.drums.length;
    const nextPreset = this.drums[nextIndex];

    if (Forte.switchDrumPreset(channelNumber, nextPreset)) {
      this.currentDrumPresetIndex = nextIndex;

      const html = `
        <div class="rhythm-carousel" style="opacity: 0; transition: opacity 0.2s ease-out;">
          ${this.drums
            .map((preset, idx) => {
              const isSelected = idx === this.currentDrumPresetIndex;
              const rhythmNumber = (idx + 1).toString().padStart(2, "0");
              return `
              <div class="rhythm-item ${isSelected ? "selected" : ""}">
                <span>RHYTHM ${rhythmNumber}</span>
                <span>${preset.name.substring(0, 12)}</span>
              </div>
            `;
            })
            .join("")}
        </div>
      `;

      modules.infoBar.showTemp("RHYTHM", html, 3000);

      setTimeout(() => {
        const carousel = document.querySelector(".rhythm-carousel");
        const activeRhythm = carousel?.querySelector(".rhythm-item.selected");
        if (carousel && activeRhythm) {
          activeRhythm.scrollIntoView({
            behavior: "auto",
            block: "nearest",
            inline: "center",
          });
          carousel.style.opacity = "1";
        }
      }, 50);
    } else {
      modules.infoBar.showTemp("RHYTHM", "FAILED TO SWITCH", 3000);
    }
  }

  /**
   * Processes numerical keypresses against the active code input buffer strings.
   *
   * @param {string} digit - An individual character ranging "0"-"9".
   */
  handleDigitInput(digit) {
    const state = this.ctx.state;
    const ui = this.ctx.root.ui;

    const target = state.mode === "player" ? "reservationNumber" : "songNumber";
    state[target] = state[target].length >= 6 ? digit : state[target] + digit;

    if (state.mode !== "player") {
      if (state.isNumberSfxEnabled !== false) {
        this.ctx.services.Forte.stopSfx();
        this.ctx.services.Forte.playSfx(`/assets/audio/numbers/${digit}.wav`);
      }
      state.isTypingNumber = true;
      ui.updateMenuUI();
    } else {
      this._updateReservationUI(false);
    }
  }

  /**
   * Responds to the delete backspace key deleting elements on various modes inputs buffers.
   */
  handleBackspace() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const ui = this.ctx.root.ui;
    const infoBar = this.ctx.modules.infoBar;

    if (state.isSearchOverlayVisible && !dom.searchInput.getValue()) {
      ui.toggleSearchOverlay(false);
    } else if (state.mode === "player" && state.reservationNumber) {
      state.reservationNumber = state.reservationNumber.slice(0, -1);
      if (state.reservationNumber.length === 0) {
        this._restoreInfoBar();
        this._updateReservationUI(true);
      } else {
        this._updateReservationUI(false);
      }
    } else if (state.mode === "menu" && state.songNumber) {
      state.songNumber = state.songNumber.slice(0, -1);
      if (!state.songNumber) state.isTypingNumber = false;
      ui.updateMenuUI();
    } else if (state.mode === "yt-search" && !dom.searchInput.getValue()) {
      ui.setMode("menu");
    }
  }

  /**
   * Restores the InfoBar persistent state
   */
  _restoreInfoBar() {
    if (this.ctx.state.lastPlaybackStatus === "paused") {
      this.ctx.modules.infoBar.show(
        "PAUSED",
        "<span class='info-bar-title'>Playback is paused</span>",
      );
      this.ctx.modules.infoBar.showBar();
    } else {
      this.ctx.modules.infoBar.showDefault();
    }
  }

  /**
   * Renders the Infobar state regarding live queued reservations while typing.
   *
   * @param {boolean} isTemp - Flag indicating fading temporariness of visibility.
   */
  _updateReservationUI(isTemp) {
    const state = this.ctx.state;
    const infoBar = this.ctx.modules.infoBar;

    const displayCode = state.reservationNumber.padStart(6, "0");
    const song =
      state.songMap.get(state.reservationNumber) ??
      state.songMap.get(state.reservationNumber.padStart(5, "0")) ??
      state.songMap.get(displayCode);

    let fmtBadge = "";
    if (song) {
      const fmt = this.ctx.root.library.getFormatInfo(song);
      fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;
    }

    let songInfo = song
      ? `${fmtBadge} <span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>`
      : state.reservationNumber.length === 6
        ? `<span style="opacity: 0.5;">No song found.</span>`
        : "";
    const content = `<span class="info-bar-code">${displayCode}</span> ${songInfo}`;

    if (isTemp) {
      infoBar.showTemp("RESERVING", content, 3000);
    } else {
      if (infoBar.isTempVisible) {
        infoBar.isTempVisible = false;
        if (infoBar.timeout) {
          clearTimeout(infoBar.timeout);
          infoBar.timeout = null;
        }
        infoBar.bar.classOff("temp-visible");
      }
      infoBar.show("RESERVING", content);
      infoBar.showBar();
    }
  }

  /**
   * Action executing commits to text blocks or selections, transitioning to play.
   */
  handleEnter() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const root = this.ctx.root;

    const isInputFocused = document.activeElement === dom.searchInput.elm;
    const isSearchActive =
      state.isSearchOverlayVisible ||
      state.mode === "yt-search" ||
      isInputFocused ||
      (dom.searchWindow.elm.classList.contains("has-results") &&
        state.highlightedSearchIndex !== -1);

    if (state.mode === "menu") {
      if (isSearchActive) {
        if (state.highlightedSearchIndex !== -1) {
          const res = state.searchResults[state.highlightedSearchIndex];
          const song =
            res.type === "local"
              ? { ...res }
              : {
                  title: res.title,
                  artist: res.channelTitle,
                  path: `yt://${res.id}`,
                  durationText: res.length?.simpleText,
                  isLive: res.isLive,
                };

          state.songNumber = "";
          state.highlightedIndex = -1;
          state.isTypingNumber = false;
          state.highlightedSearchIndex = -1;
          dom.searchInput.elm.value = "";
          state.searchResults = [];

          root.ui.renderSearchResults();
          if (state.isSearchOverlayVisible) root.ui.toggleSearchOverlay(false);
          if (state.mode === "yt-search") root.ui.setMode("menu");

          if (state.isSessionActive) root.sessions.reserveSongInSession(song);
          else root.playback.startPlayer(song);
        }
        return;
      }

      if (state.isSessionActive) {
        let song = state.songNumber
          ? (state.songMap.get(state.songNumber) ??
            state.songMap.get(state.songNumber.padStart(5, "0")) ??
            state.songMap.get(state.songNumber.padStart(6, "0")))
          : state.highlightedIndex >= 0
            ? state.songList[state.highlightedIndex]
            : null;

        if (song) {
          root.sessions.reserveSongInSession(song);
          state.songNumber = "";
          state.highlightedIndex = -1;
          state.isTypingNumber = false;
          root.ui.updateMenuUI();
        }
      } else {
        if (state.reservationQueue.length) {
          root.playback.startPlayer(state.reservationQueue.shift());
        } else {
          let song = state.songNumber
            ? (state.songMap.get(state.songNumber) ??
              state.songMap.get(state.songNumber.padStart(5, "0")) ??
              state.songMap.get(state.songNumber.padStart(6, "0")))
            : state.highlightedIndex >= 0
              ? state.songList[state.highlightedIndex]
              : null;
          if (song) {
            state.songNumber = "";
            state.highlightedIndex = -1;
            state.isTypingNumber = false;
            root.playback.startPlayer(song);
          }
        }
      }
    } else if (state.mode === "player") {
      if (isSearchActive) {
        if (state.highlightedSearchIndex !== -1) {
          const res = state.searchResults[state.highlightedSearchIndex];
          const song =
            res.type === "local"
              ? { ...res }
              : {
                  title: res.title,
                  artist: res.channelTitle,
                  path: `yt://${res.id}`,
                  durationText: res.length?.simpleText,
                  isLive: res.isLive,
                };

          if (state.isSessionActive) root.sessions.reserveSongInSession(song);
          else {
            state.reservationQueue.push(song);
            root.sessions.showReservationNotification(song);
          }

          state.highlightedSearchIndex = -1;
          dom.searchInput.elm.value = "";
          state.searchResults = [];
          root.ui.renderSearchResults();
          root.ui.toggleSearchOverlay(false);
        }
        return;
      } else if (state.reservationNumber) {
        const song =
          state.songMap.get(state.reservationNumber) ??
          state.songMap.get(state.reservationNumber.padStart(5, "0")) ??
          state.songMap.get(state.reservationNumber.padStart(6, "0"));
        if (song) {
          if (state.isSessionActive) root.sessions.reserveSongInSession(song);
          else {
            state.reservationQueue.push(song);
            this._restoreInfoBar();
          }
        }
        state.reservationNumber = "";
      }
    } else if (
      state.mode === "yt-search" &&
      state.highlightedSearchIndex !== -1
    ) {
      const res = state.searchResults[state.highlightedSearchIndex];
      const song =
        res.type === "local"
          ? { ...res }
          : {
              title: res.title,
              artist: res.channelTitle,
              path: `yt://${res.id}`,
              durationText: res.length?.simpleText,
              isLive: res.isLive,
            };

      state.highlightedSearchIndex = -1;
      dom.searchInput.elm.value = "";
      state.searchResults = [];
      root.ui.renderSearchResults();

      if (state.isSessionActive) root.sessions.reserveSongInSession(song);
      else root.playback.startPlayer(song);
    }
  }

  /**
   * Action reversing states or dropping contexts.
   */
  handleEscape() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const ui = this.ctx.root.ui;

    if (state.isTransitioning) return;

    if (state.isSearchOverlayVisible) {
      ui.toggleSearchOverlay(false);
      return;
    }

    const isInputFocused = document.activeElement === dom.searchInput.elm;
    const hasResults = dom.searchWindow.elm.classList.contains("has-results");

    if (isInputFocused || hasResults || state.mode === "yt-search") {
      dom.searchInput.elm.blur();
      state.highlightedSearchIndex = -1;
      state.searchResults = [];
      dom.searchInput.elm.value = "";
      ui.renderSearchResults();
      if (state.mode === "yt-search") {
        ui.setMode("menu");
      }
      return;
    }

    if (state.mode === "menu") {
      if (state.isTypingNumber) {
        state.songNumber = "";
        state.isTypingNumber = false;
        ui.updateMenuUI();
      } else if (state.showSongList) {
        state.showSongList = false;
        state.highlightedIndex = -1;
        ui.updateMenuUI();
      }
      return;
    }

    if (state.mode.startsWith("player")) {
      if (state.reservationNumber) {
        state.reservationNumber = "";
        this._restoreInfoBar();
      } else if (state.currentSongIsYouTube) {
        this.ctx.root.playback.stopPlayer();
        this.ctx.modules.bgv.start();
        this.ctx.root.playback.transitionAfterSong();
      } else {
        this.ctx.services.Forte.stopTrack();
      }
    }
  }

  /**
   * Action traversing lists vertically.
   *
   * @param {string} dir - Literal string "up" or "down".
   */
  handleNav(dir) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;

    const isInputFocused = document.activeElement === dom.searchInput.elm;
    const isSearchActive =
      state.mode === "yt-search" ||
      state.isSearchOverlayVisible ||
      isInputFocused ||
      dom.searchWindow.elm.classList.contains("has-results");

    if (isSearchActive) {
      const change = dir === "down" ? 1 : -1;
      let sfxToPlay = "nav";
      if (isInputFocused) {
        if (change > 0 && state.searchResults.length > 0) {
          dom.searchInput.elm.blur();
          state.highlightedSearchIndex = 0;
        } else {
          sfxToPlay = "out_of_bounds";
        }
      } else {
        if (change < 0 && state.highlightedSearchIndex <= 0) {
          state.highlightedSearchIndex = -1;
          dom.searchInput.elm.focus();
        } else {
          const prevIdx = state.highlightedSearchIndex;
          state.highlightedSearchIndex = Math.max(
            0,
            Math.min(
              state.searchResults.length - 1,
              state.highlightedSearchIndex + change,
            ),
          );
          if (prevIdx === state.highlightedSearchIndex) {
            sfxToPlay = "out_of_bounds";
          }
        }
      }
      if (state.mode !== "player") {
        this.playNavSfx(sfxToPlay);
      }
      this.ctx.root.ui.updateSearchHighlight();
    } else if (state.mode === "menu") {
      const change = dir === "down" ? 1 : -1;
      state.songNumber = "";
      state.isTypingNumber = false;
      let idx = state.highlightedIndex + change;
      const newIdx = Math.max(0, Math.min(state.songList.length - 1, idx));
      if (newIdx === state.highlightedIndex) {
        this.playNavSfx("out_of_bounds");
      } else {
        this.playNavSfx("nav");
      }
      state.highlightedIndex = newIdx;
      this.ctx.root.ui.updateMenuUI();
    } else if (state.mode === "player") {
      if (state.currentSongIsYouTube) return;
      const change = dir === "up" ? 1 : -1;
      const cur = this.ctx.services.Forte.getPlaybackState().transpose || 0;
      const next = Math.max(-24, Math.min(24, cur + change));
      this.ctx.services.Forte.setTranspose(next);

      let left = 50;
      let width = 0;
      if (next > 0) width = (next / 24) * 50;
      else if (next < 0) {
        width = (Math.abs(next) / 24) * 50;
        left = 50 - width;
      }

      const html = `<div class="transpose-display"><div class="transpose-min">-24</div><div class="transpose-slider-container"><div class="transpose-slider-center-line"></div><div class="transpose-slider-fill" style="left: ${left}%; width: ${width}%;"></div></div><div class="transpose-max">+24</div><span class="transpose-value">${(next > 0 ? "+" : "") + next} st</span></div>`;
      this.ctx.modules.infoBar.showTemp("TRANSPOSE", html, 3000);
    }
  }

  /**
   * Action balancing channel splits in capable Multiplex tracks.
   *
   * @param {string} dir - Literal string "left" or "right".
   */
  handlePan(dir) {
    if (this.ctx.state.mode !== "player") return;
    const pb = this.ctx.services.Forte.getPlaybackState();
    if (!pb.isMultiplexed) return;

    const change = dir === "right" ? 0.2 : -0.2;
    const pan = Math.max(
      -1,
      Math.min(1, parseFloat((pb.multiplexPan + change).toFixed(1))),
    );
    this.ctx.services.Forte.setMultiplexPan(pan);

    let txt = "BALANCED";
    if (pan <= -0.99) {
      txt = "INSTRUMENTAL";
      this.ctx.modules.dialog(
        new Html("div").classOn("temp-dialog-text").text("VOCAL OFF"),
      );
    } else if (pan >= 0.99) {
      txt = "VOCAL GUIDE";
      this.ctx.modules.dialog(
        new Html("div").classOn("temp-dialog-text").text("INST. OFF"),
      );
    } else {
      txt =
        pan < 0
          ? `◀ ${Math.abs(Math.round(pan * 100))}% INST`
          : `VOC ${Math.round(pan * 100)}% ▶`;
    }
    this.ctx.modules.infoBar.showTemp("BALANCE", txt, 3000);
  }

  /**
   * Translates volume commands into absolute level shifts.
   *
   * @param {string} dir - Literal string "up" or "down".
   */
  handleVolume(dir) {
    const state = this.ctx.state;
    state.volume = Math.max(
      0,
      Math.min(1, state.volume + (dir === "up" ? 0.05 : -0.05)),
    );
    this.ctx.services.Forte.setTrackVolume(state.volume);
    this.ctx.services.Forte.setMusicRecordingVolume(state.volume);

    if (this.ctx.dom.sessionRemoteVideo)
      this.ctx.dom.sessionRemoteVideo.elm.volume = state.volume;

    if (state.currentSongIsYouTube) {
      try {
        window.volume.setVolume(state.volume * state.windowsVolume);
      } catch (e) {}
    }

    const p = Math.round(state.volume * 100);
    this.ctx.modules.infoBar.showTemp(
      "VOLUME",
      `<div class="volume-display"><div class="volume-slider-container"><div class="volume-slider-fill" style="width: ${p}%"></div></div><span class="volume-percentage">${p}%</span></div>`,
      3000,
    );
    window.config.setItem("audioConfig.mix.instrumental.volume", state.volume);
  }

  /**
   * Translates mic volume commands into live monitor level shifts.
   *
   * @param {string} dir - Literal string "up" or "down".
   */
  handleMicVolume(dir) {
    let currentVol =
      this.ctx.services.Forte.getVocalChainState().micMonitorVolume ?? 1.0;
    let newVol = Math.max(
      0,
      Math.min(2.0, currentVol + (dir === "up" ? 0.05 : -0.05)),
    );
    this.ctx.services.Forte.setMicMonitorVolume(newVol);
    this.ctx.services.Forte.setMicRecordingVolume(newVol);
    const p = Math.round(newVol * 100);
    this.ctx.modules.infoBar.showTemp(
      "MIC VOLUME",
      `<div class="volume-display"><div class="volume-slider-container"><div class="volume-slider-fill" style="width: ${p / 2}%"></div></div><span class="volume-percentage">${p}%</span></div>`,
      3000,
    );
  }

  /**
   * Action triggering BGV sequence cyclings or MV sync drifting.
   *
   * @param {string} key - A "[" or "]" literal character indicating direction.
   */
  handleBracket(key) {
    const state = this.ctx.state;
    const bgv = this.ctx.modules.bgv;

    if (state.currentSongIsMV) {
      state.videoSyncOffset += key === "]" ? 10 : -10;
      this.ctx.modules.infoBar.showTemp(
        "VIDEO SYNC",
        (state.videoSyncOffset > 0 ? "+" : "") + state.videoSyncOffset + " ms",
        3000,
      );
      window.config.setItem("videoConfig.syncOffset", state.videoSyncOffset);
    } else {
      bgv.cycleCategory(key === "[" ? -1 : 1);
      const cats = [
        "Off",
        "Auto",
        ...bgv.categories.map((c) => c.BGV_CATEGORY),
      ];
      const html = `<div class="bgv-carousel" style="opacity: 0; transition: opacity 0.2s ease-out;">${cats.map((c) => `<div class="bgv-item ${c === bgv.selectedCategory ? "selected" : ""}"><span>${c}</span></div>`).join("")}</div>`;

      this.ctx.modules.infoBar.showTemp("BGV", html, 3000);
      try {
        window.config.setItem(
          "videoConfig.defaultBgvCategory",
          bgv.selectedCategory,
        );
      } catch (e) {}

      setTimeout(() => {
        const carousel = document.querySelector(".bgv-carousel");
        const activeCat = carousel?.querySelector(".bgv-item.selected");
        if (carousel && activeCat) {
          activeCat.scrollIntoView({
            behavior: "auto",
            block: "nearest",
            inline: "center",
          });
          carousel.style.opacity = "1";
        }
      }, 50);
    }
  }

  /**
   * Handler bridging the user shortcut jumping into a search flow layout.
   */
  handleYKey() {
    if (this.ctx.state.isTransitioning) return;
    if (this.ctx.state.mode === "menu") this.ctx.root.ui.setMode("yt-search");
    else if (this.ctx.state.mode === "player")
      this.ctx.root.ui.toggleSearchOverlay(
        !this.ctx.state.isSearchOverlayVisible,
      );
  }
}
