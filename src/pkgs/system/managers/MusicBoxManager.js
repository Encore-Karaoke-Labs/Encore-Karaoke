import NetworkingUtility from "../../../libs/networkingUtility.js";

const DEFAULT_WAIT_SECONDS = 60;
const MIN_WAIT_SECONDS = 5;
const MAX_WAIT_SECONDS = 600;
const NEXT_TRACK_DELAY_MS = 300;
const DEFAULT_VOLUME = 0.5;

/**
 * Music Box plays random library songs as background music for the Main Menu.
 */
export default class MusicBoxManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    this.playing = false;
    this.playbackStarted = false;
    this.currentSong = null;
    this.startTimer = null;
    this.nextTrackTimer = null;
    this.generation = 0;

    this.shuffleBag = [];
    this.lastSongCode = null;

    this.boundActivity = () => this.handleUserActivity();
    this.boundPlaybackUpdate = (event) => this.handlePlaybackUpdate(event);
  }

  init() {
    window.addEventListener("keydown", this.boundActivity, true);
    window.addEventListener("pointerdown", this.boundActivity, true);
    window.addEventListener("wheel", this.boundActivity, {
      capture: true,
      passive: true,
    });
    document.addEventListener(
      "Encore.Forte.Playback.Update",
      this.boundPlaybackUpdate,
    );
  }

  destroy() {
    window.removeEventListener("keydown", this.boundActivity, true);
    window.removeEventListener("pointerdown", this.boundActivity, true);
    window.removeEventListener("wheel", this.boundActivity, true);
    document.removeEventListener(
      "Encore.Forte.Playback.Update",
      this.boundPlaybackUpdate,
    );
    this.stop();
  }

  /**
   * Returns the Music Box settings with safe defaults.
   *
   * @returns {{enabled: boolean, waitSeconds: number}}
   */
  getSettings() {
    const config = this.ctx.config.musicBoxConfig || {};
    return {
      enabled: config.enabled === true,
      waitSeconds: this.getWaitSeconds(),
      volume: this.getVolume(),
    };
  }

  /**
   * Music Box volume as a fraction of the Music volume, clamped to 0-1.
   *
   * @returns {number}
   */
  getVolume() {
    const configured = Number(this.ctx.config.musicBoxConfig?.volume);
    if (!Number.isFinite(configured)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, configured));
  }

  /**
   * Applies the Music Box volume on top of the Music volume while playing.
   */
  applyVolume() {
    if (!this.playing) return;
    this.ctx.services.Forte.setBackgroundVolume?.(this.getVolume());
  }

  /**
   * Idle time before the Music Box starts, clamped to the supported range.
   *
   * @returns {number} Seconds.
   */
  getWaitSeconds() {
    const configured = Number(this.ctx.config.musicBoxConfig?.waitSeconds);
    if (!Number.isFinite(configured)) return DEFAULT_WAIT_SECONDS;
    return Math.max(
      MIN_WAIT_SECONDS,
      Math.min(MAX_WAIT_SECONDS, Math.round(configured)),
    );
  }

  /**
   * True when the Music Box can play in the current app state.
   *
   * @returns {boolean}
   */
  isRunnable() {
    const state = this.ctx.state;
    if (!this.getSettings().enabled) return false;
    if (state.mode !== "menu") return false;
    if (state.isSessionActive) return false;
    if (state.isDriveDisconnected) return false;
    if (this.ctx.root.retail?.enabled) return false;
    if (state.isTransitioning) return false;
    if (state.isTypingNumber || state.showSongList) return false;
    if (state.isSearchOverlayVisible || state.isQueueOverlayVisible) {
      return false;
    }
    if (state.currentSong) return false;
    if (state.isPlayingRecording) return false;
    return this._getPlayableSongs().length > 0;
  }

  /**
   * Called whenever the UI mode changes.
   *
   * @param {string} mode - The new UI mode.
   */
  onModeChanged(mode) {
    if (mode === "menu" && !this.playing) {
      this.scheduleStart();
    } else if (mode !== "menu") {
      this.stop();
    }
  }

  /**
   * Arms the idle timer. Safe to call repeatedly; each call resets it.
   */
  scheduleStart() {
    this.clearStartTimer();
    if (this.playing || !this.getSettings().enabled) return;

    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      this.start();
    }, this.getWaitSeconds() * 1000);
  }

  /**
   * Any user input stops the Music Box and restarts the idle countdown.
   */
  handleUserActivity() {
    if (!this.getSettings().enabled) return;

    this._stopPlayback();
    if (this.ctx.state.mode === "menu") this.scheduleStart();
    else this.clearStartTimer();
  }

  /**
   * Starts background playback if the app is idle in the Main Menu.
   *
   * @returns {boolean} True when a song was started.
   */
  start() {
    if (this.playing || !this.isRunnable()) return false;

    const song = this._pickNextSong();
    if (!song) return false;

    this.playing = true;
    this.currentSong = song;
    this.ctx.services.Forte.setBackgroundVolume?.(this.getVolume());
    this._playSong(song);
    return true;
  }

  /**
   * Stops playback and cancels any pending idle/next-song timers.
   */
  stop() {
    this.clearStartTimer();
    this._stopPlayback();
  }

  /**
   * Stops only the active playback, leaving the idle timer to the caller.
   */
  _stopPlayback() {
    const wasPlaying = this.playing;

    this.playing = false;
    this.playbackStarted = false;
    this.currentSong = null;
    this.generation++;
    this._clearNextTrackTimer();

    if (!wasPlaying) return;

    this.ctx.services.Forte.stopTrack();
    this.ctx.services.Forte.setBackgroundVolume?.(1);
    this._restoreScoringPreference();
  }

  /**
   * Loads and plays a library song through the main playback engine.
   *
   * @param {Object} song - The song to play.
   */
  async _playSong(song) {
    const run = ++this.generation;

    try {
      const url = (await NetworkingUtility.getFileLink(song.path)).href;

      let chorusUrl = null;
      if (song.chorusPath) {
        try {
          chorusUrl = (await NetworkingUtility.getFileLink(song.chorusPath))
            .href;
        } catch (error) {
          console.warn("[MusicBox] Could not resolve chorus track:", error);
        }
      }

      if (run !== this.generation || !this.playing) return;

      const loaded = await this.ctx.services.Forte.loadTrack(
        url,
        chorusUrl,
        null,
        { background: true },
      );
      if (run !== this.generation || !this.playing) {
        // Only clear the engine if nothing else has taken it over (for
        // example a user-started song that began while this was loading).
        if (this.ctx.state.mode === "menu" && !this.ctx.state.currentSong) {
          this.ctx.services.Forte.stopTrack();
        }
        return;
      }

      if (!loaded) {
        this._scheduleNextTrack(run);
        return;
      }

      this.playbackStarted = true;
      await this.ctx.services.Forte.playTrack();

      if (run !== this.generation || !this.playing) return;

      // If playback never actually started, move on instead of stalling.
      if (
        this.playbackStarted &&
        this.ctx.services.Forte.getPlaybackState?.().status !== "playing"
      ) {
        this.playbackStarted = false;
        this._scheduleNextTrack(run);
      }
    } catch (error) {
      console.error("[MusicBox] Failed to play background song:", error);
      if (run === this.generation) {
        this.playbackStarted = false;
        this._scheduleNextTrack(run);
      }
    }
  }

  /**
   * Tracks natural playback completion reported by the engine.
   *
   * @param {CustomEvent} event - Encore.Forte.Playback.Update event.
   */
  handlePlaybackUpdate(event) {
    if (!this.playing || !this.playbackStarted) return;
    if (event?.detail?.status !== "stopped") return;

    this.playbackStarted = false;
    this.currentSong = null;
    this._restoreScoringPreference();

    if (!this.isRunnable()) {
      this.stop();
      return;
    }

    this._scheduleNextTrack(this.generation);
  }

  /**
   * Plays the next random track after a short gap.
   *
   * @param {number} run - Generation token of the current run.
   */
  _scheduleNextTrack(run) {
    this._clearNextTrackTimer();
    this.nextTrackTimer = setTimeout(() => {
      this.nextTrackTimer = null;
      if (run !== this.generation || !this.playing) return;

      if (!this.isRunnable()) {
        this.stop();
        return;
      }

      const song = this._pickNextSong();
      if (!song) {
        this.stop();
        return;
      }

      this.currentSong = song;
      this._playSong(song);
    }, NEXT_TRACK_DELAY_MS);
  }

  /**
   * Restores the configured scoring preference after background playback.
   */
  _restoreScoringPreference() {
    if (!this.ctx.services.Forte.setScoringEnabled) return;
    const enabled = this.ctx.config.audioConfig?.enableScoring !== false;
    this.ctx.services.Forte.setScoringEnabled(enabled);
  }

  /**
   * Picks a random song
   *
   * @returns {Object|null}
   */
  _pickNextSong() {
    const songs = this._getPlayableSongs();
    if (songs.length === 0) return null;
    if (songs.length === 1) return songs[0];

    if (this.shuffleBag.length === 0) {
      this.shuffleBag = songs.map((_, index) => index);
      for (let i = this.shuffleBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.shuffleBag[i], this.shuffleBag[j]] = [
          this.shuffleBag[j],
          this.shuffleBag[i],
        ];
      }

      const nextIndex = this.shuffleBag[this.shuffleBag.length - 1];
      if (
        this.lastSongCode !== null &&
        songs[nextIndex]?.code === this.lastSongCode
      ) {
        const swapIndex = this.shuffleBag.length - 2;
        const endIndex = this.shuffleBag.length - 1;
        [this.shuffleBag[endIndex], this.shuffleBag[swapIndex]] = [
          this.shuffleBag[swapIndex],
          this.shuffleBag[endIndex],
        ];
      }
    }

    const index = this.shuffleBag.pop();
    const song = songs[index];
    this.lastSongCode = song?.code ?? null;
    return song || null;
  }

  /**
   * Library songs that can be handed to the main playback engine.
   *
   * @returns {Object[]}
   */
  _getPlayableSongs() {
    const songs = this.ctx.state.songList || [];
    return songs.filter(
      (song) =>
        song && typeof song.path === "string" && !song.path.startsWith("yt://"),
    );
  }

  _clearNextTrackTimer() {
    if (this.nextTrackTimer) {
      clearTimeout(this.nextTrackTimer);
      this.nextTrackTimer = null;
    }
  }

  clearStartTimer() {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }
}
