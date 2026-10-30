import Html from "../../libs/html.js";
import NetworkingUtility from "../../libs/networkingUtility.js";

import DriveRecoveryManager from "./managers/DriveRecoveryManager.js";
import GamesManager from "./managers/GamesManager.js";
import InputManager from "./managers/InputManager.js";
import LibraryManager from "./managers/LibraryManager.js";
import LyricsEngine from "./managers/LyricsEngine.js";
import NetworkManager from "./managers/NetworkManager.js";
import PlaybackManager from "./managers/PlaybackManager.js";
import RecordingsManager from "./managers/RecordingsManager.js";
import SessionManager from "./managers/SessionManager.js";
import SetupManager from "./managers/SetupManager.js";
import StreamManager from "./managers/StreamManager.js";
import UIManager from "./managers/UIManager.js";

import { BGVModule } from "../../modules/BGVPlayer.js";
import generateDialog from "../../modules/Dialog.js";
import { InfoBarModule } from "../../modules/InfoBar.js";
import { MixerModule } from "../../modules/Mixer.js";
import { RecorderModule } from "../../modules/Recorder.js";
import { ScoreHUDModule } from "../../modules/ScoreHUD.js";

/**
 * Joins path parts with a given separator, normalizing leading and trailing slashes.
 */
function pathJoin(parts, sep) {
  const separator = sep || "/";
  parts = parts.map((part, index) => {
    if (index) part = part.replace(new RegExp("^" + separator), "");
    if (index !== parts.length - 1)
      part = part.replace(new RegExp(separator + "$"), "");
    return part;
  });
  return parts.join(separator);
}

class EncoreController {
  constructor(Root, config) {
    this.Root = Root;
    this.config = config;

    this.services = {
      Pid: Root.Pid,
      Ui: Root.Processes.getService("UiLib").data,
      FsSvc: Root.Processes.getService("FsSvc").data,
      Forte: Root.Processes.getService("ForteSvc").data,
      Updates: Root.Processes.getService("UpdateSvc").data,
      Identity: Root.Processes.getService("IdentitySvc").data,
      SessionsSvc: Root.Processes.getService("SessionsSvc")?.data,
      CameraSvc: Root.Processes.getService("CameraSvc")?.data,
    };

    this.state = {
      actualPort: 9864,
      mode: "menu",
      songNumber: "",
      highlightedIndex: -1,
      reservationNumber: "",
      windowsVolume: 1,
      volume: config.audioConfig?.mix?.instrumental?.volume ?? 1,
      videoSyncOffset: config.videoConfig?.syncOffset || 0,
      isStreamModalOpen: false,
      isHelpModalOpen: false,

      systemFonts: ["Radio Canada"],
      lyricFontFamily: config.videoConfig?.lyricFontFamily || "Radio Canada",
      lyricFontSizeScale: config.videoConfig?.lyricFontSizeScale ?? 1.0,
      lyricLineGapScale: config.videoConfig?.lyricLineGapScale ?? 1.0,
      lyricBottomMargin: config.videoConfig?.lyricBottomMargin ?? 0,
      lyricAlignment: config.videoConfig?.lyricAlignment || "center",
      isLyricCustomizerVisible: false,
      lyricCustomizerIndex: 0,
      lyricCustomizerView: "main",
      lyricCustomizerFontIndex: 0,

      isTransitioning: false,
      isTypingNumber: false,
      numberEntryInInfoBar: config.numberEntryInInfoBar ?? false,
      currentSongIsYouTube: false,
      currentSongIsMultiplexed: false,
      currentSongIsMIDI: false,
      currentSongIsMV: false,
      lastPlaybackStatus: null,

      isQueueOverlayVisible: false,
      isQueueDeleteHighlighted: false,
      highlightedQueueIndex: -1,

      isScoreFanfareEnabled: config.audioConfig?.enableScoreFanfare ?? true,
      isScoreNarrationEnabled: config.audioConfig?.enableScoreNarration ?? true,
      isScoreHudEnabled: config.audioConfig?.enableScoreHud ?? true,
      isNavSfxEnabled: config.audioConfig?.enableNavSfx ?? true,
      isNumberSfxEnabled: config.audioConfig?.enableNumberSfx ?? true,
      isScoreScreenActive: false,
      scoreSkipResolver: null,
      scoreSkipped: false,

      showSongList: false,

      isEasterEggInterludeEnabled: config.enableEasterEggInterludes ?? false,
      displayGuideMelody: config.displayGuide ?? true,

      songList: [],
      songMap: new Map(),
    };

    this._isSetlistSyncQueued = false;
    this.queueSetlistSync = () => {
      if (this._isSetlistSyncQueued) return;
      this._isSetlistSyncQueued = true;
      queueMicrotask(() => {
        this._isSetlistSyncQueued = false;
        this.syncSetlistOverlay();
        if (this.state.mode === "player") {
          this.infoBar?.showDefault();
        }
      });
    };

    const createObservedQueue = (initialArray) => {
      return new Proxy(initialArray, {
        set: (target, property, value, receiver) => {
          const result = Reflect.set(target, property, value, receiver);
          // Trigger when an item is added, replaced, or array length changes
          if (property === "length" || !isNaN(Number(property))) {
            this.queueSetlistSync();
          }
          return result;
        },
        deleteProperty: (target, property) => {
          const result = Reflect.deleteProperty(target, property);
          this.queueSetlistSync();
          return result;
        },
      });
    };

    let _rawReservationQueue = [];
    let _observedReservationQueue = createObservedQueue(_rawReservationQueue);

    Object.defineProperty(this.state, "reservationQueue", {
      get: () => _observedReservationQueue,
      set: (newQueue) => {
        _rawReservationQueue = Array.isArray(newQueue) ? newQueue : [];
        _observedReservationQueue = createObservedQueue(_rawReservationQueue);
        this.queueSetlistSync();
      },
      configurable: true,
      enumerable: true,
    });

    this.dom = {};

    this.mixer = new MixerModule(this.services.Forte, this.state);
    this.bgv = new BGVModule();
    this.scoreHud = new ScoreHUDModule();

    this.infoBar = new InfoBarModule(
      () => {
        const isSession = Boolean(
          this.state.isSessionActive && this.services.SessionsSvc,
        );
        const sessionState = isSession ? this.services.SessionsSvc.state : null;

        let currentSong = null;
        if (!this.state.isScoreScreenActive) {
          if (isSession) {
            if (sessionState?.mode === "performance") {
              currentSong =
                sessionState.nowPlaying || this.state.currentSong || null;
            }
          } else if (this.state.currentSong) {
            currentSong = this.state.currentSong;
          }
        }

        if (currentSong && currentSong.code && this.state.songMap) {
          const localMatch =
            this.state.songMap.get(Number(currentSong.code)) ||
            this.state.songMap.get(String(currentSong.code));
          if (localMatch) {
            currentSong = { ...localMatch, ...currentSong };
          }
        }

        return {
          currentSong,
          reservationQueue: isSession
            ? sessionState?.queue || []
            : this.state.reservationQueue || [],
          songMap: this.state.songMap,
          mode: this.state.mode,
        };
      },
      () =>
        this.recorder?.isRecording && this.recorder?.mediaRecorder
          ? `REC <span style="color: #ff5555">●</span> ${this.recorder.getRecordingTimeString()}`
          : false,
      (s) => this.library.getFormatInfo(s),
    );

    this.recorder = new RecorderModule(
      this.services.Forte,
      this.bgv,
      this.infoBar,
      generateDialog,
    );

    this.context = {
      root: this,
      state: this.state,
      dom: this.dom,
      services: this.services,
      config: this.config,
      modules: {
        mixer: this.mixer,
        bgv: this.bgv,
        scoreHud: this.scoreHud,
        infoBar: this.infoBar,
        recorder: this.recorder,
        dialog: generateDialog,
      },
    };

    this.driveRecovery = new DriveRecoveryManager(this.context);
    this.context.modules.driveRecovery = this.driveRecovery;

    this.ui = new UIManager(this.context);
    this.library = new LibraryManager(this.context);
    this.lyrics = new LyricsEngine(this.context);
    this.playback = new PlaybackManager(this.context);
    this.network = new NetworkManager(this.context);
    this.sessions = new SessionManager(this.context);
    this.recordings = new RecordingsManager(this.context);
    this.input = new InputManager(this.context);
    this.setup = new SetupManager(this.context);
    this.games = new GamesManager(this.context);
    this.stream = new StreamManager(this.context);

    this.context.modules.stream = this.stream;
    this.context.modules.lyrics = this.lyrics;

    this.boundKeydown = (e) => this.input.handleKeyDown(e);
  }

  syncSetlistOverlay() {
    if (!window.setlistOverlay?.sendUpdate) return;

    const isSession = Boolean(
      this.state.isSessionActive && this.services.SessionsSvc,
    );
    const sessionState = isSession ? this.services.SessionsSvc.state : null;

    const queueList = isSession
      ? sessionState?.queue || []
      : this.state.reservationQueue || [];

    let currentSong = null;
    if (!this.state.isScoreScreenActive) {
      if (isSession) {
        if (sessionState?.mode === "performance") {
          currentSong =
            sessionState.nowPlaying || this.state.currentSong || null;
        }
      } else if (this.state.currentSong) {
        currentSong = this.state.currentSong;
      }
    }

    const formatSong = (s) => {
      if (!s) return null;

      let enriched = s;
      if (s.code && this.state.songMap) {
        const localMatch =
          this.state.songMap.get(Number(s.code)) ||
          this.state.songMap.get(String(s.code));
        if (localMatch) {
          enriched = { ...localMatch, ...s };
        }
      }

      const fmt = this.library ? this.library.getFormatInfo(enriched) : null;
      return {
        code: enriched.code
          ? String(enriched.code).padStart(6, "0")
          : enriched.path?.startsWith("yt://")
            ? "YT"
            : "",
        title: enriched.title || "Unknown Title",
        artist: enriched.artist || "Unknown Artist",
        singer: enriched.requesterNickname || enriched.singer || null,
        formatLabel: fmt?.label || "RS",
        formatColor: fmt?.color || "#B02FD1",
        isYouTube: Boolean(enriched.path?.startsWith("yt://")),
        isMV: Boolean(enriched.videoPath),
      };
    };

    window.setlistOverlay.sendUpdate({
      nowPlaying: formatSong(currentSong),
      queue: queueList.map((item, idx) => ({
        ...formatSong(item),
        order: idx + 1,
      })),
      total: queueList.length,
    });
  }

  handleDeepLink(url) {
    if (!url || typeof url !== "string") return;
    console.log("[EncoreHome] Processing Deep Link URL:", url);

    const isSongPlaying =
      this.state.mode === "player" ||
      this.state.mode.startsWith("player") ||
      this.state.isScoreScreenActive ||
      this.state.lastPlaybackStatus === "playing" ||
      this.state.lastPlaybackStatus === "paused";

    if (isSongPlaying) {
      this.infoBar.showTemp(
        "SESSIONS",
        "Cannot join a session while a song is playing.",
        4000,
      );
      return;
    }

    const isInMainMenu = this.state.mode === "menu";
    if (!isInMainMenu) {
      this.infoBar.showTemp(
        "SESSIONS",
        "Please return to the Main Menu to join a session.",
        4000,
      );
      return;
    }

    try {
      let roomCode = null;
      if (url.startsWith("encore://session/")) {
        const raw = url.replace("encore://session/", "");
        roomCode = raw.split("?")[0].split("/")[0].trim();
      } else {
        const normalized = url.replace(/^encore:\/\//, "https://");
        const parsed = new URL(normalized);
        if (parsed.hostname === "session") {
          roomCode = parsed.pathname.replace(/^\//, "").split("/")[0].trim();
        }
      }

      if (roomCode) {
        this.sessions.promptDeepLinkSession(roomCode);
      }
    } catch (e) {
      console.error("[EncoreHome] Failed to parse deep link URL:", url, e);
    }
  }

  async handleIpcCommand(action, payload) {
    switch (action) {
      case "play-pause": {
        if (this.state.mode === "player") {
          this.playback.togglePause();
        }
        const pb = this.services.Forte.getPlaybackState();
        return {
          status: pb?.status || "stopped",
          mode: this.state.mode,
        };
      }

      case "play-or-reserve-song": {
        let song = payload;

        if (typeof payload === "string" || typeof payload === "number") {
          const str = String(payload).trim();
          song =
            this.state.songMap.get(str) ||
            this.state.songMap.get(Number(str)) ||
            this.state.songMap.get(str.padStart(6, "0")) ||
            null;
        }

        if (!song) {
          return { success: false, reason: "Song not found." };
        }

        if (this.state.mode === "menu") {
          this.ui.menuTransitionSource = "list";
          this.state.songNumber = "";
          this.state.isTypingNumber = false;
          this.playback.startPlayer(song);
          return { success: true, action: "playing", song };
        }

        if (this.state.mode.startsWith("player")) {
          if (this.state.isSessionActive) {
            this.sessions.reserveSongInSession(song);
          } else {
            this.state.reservationQueue.push(song);

            const fmt = this.library.getFormatInfo(song);
            const codeDisplay = song.code
              ? String(song.code).padStart(6, "0")
              : "YT";
            const html = `<span class="info-bar-code">${codeDisplay}</span> <span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span> <span class="info-bar-title">${song.title}</span><span class="info-bar-artist">- ${song.artist}</span>`;
            this.infoBar.showTemp("RESERVED", html, 3000);
          }
          return { success: true, action: "queued", song };
        }

        return { success: false, reason: "Invalid app state." };
      }

      case "get-playback-info": {
        const pb = this.services.Forte.getPlaybackState();
        let currentSong = this.state.currentSong || null;

        if (currentSong && currentSong.code && this.state.songMap) {
          const match =
            this.state.songMap.get(Number(currentSong.code)) ||
            this.state.songMap.get(String(currentSong.code));
          if (match) currentSong = { ...match, ...currentSong };
        }

        const fmt = currentSong
          ? this.library.getFormatInfo(currentSong)
          : null;

        return {
          mode: this.state.mode,
          status:
            pb?.status ||
            (this.state.currentSongIsYouTube ? "playing" : "stopped"),
          currentTime: pb?.currentTime ?? 0,
          duration: pb?.duration ?? 0,
          currentSong: currentSong
            ? {
                code: currentSong.code
                  ? String(currentSong.code).padStart(6, "0")
                  : null,
                title: currentSong.title,
                artist: currentSong.artist,
                format: fmt?.label || "RS",
                isYouTube: Boolean(this.state.currentSongIsYouTube),
                isMV: Boolean(this.state.currentSongIsMV),
                isMIDI: Boolean(this.state.currentSongIsMIDI),
              }
            : null,
          volume: this.state.volume,
          transpose: pb?.transpose ?? 0,
          multiplexPan: pb?.multiplexPan ?? 0,
          score: pb?.score?.finalScore ?? 0,
          isDuet: Boolean(this.state.isDuet),
          queueLength: this.state.reservationQueue.length,
        };
      }

      case "get-song-list": {
        const offset = Math.max(0, Number(payload?.offset) || 0);
        const limit =
          payload?.limit !== undefined && payload?.limit !== null
            ? Number(payload.limit)
            : 100;
        const total = this.state.songList.length;

        const slice =
          limit > 0
            ? this.state.songList.slice(offset, offset + limit)
            : this.state.songList.slice(offset);

        return {
          total,
          offset,
          limit,
          songs: slice.map((s) => {
            const fmt = this.library.getFormatInfo(s);
            return {
              ...s, // Preserve path, chorusPath, videoPath, type, etc.
              code: String(s.code).padStart(6, "0"),
              format: fmt.label,
              formatColor: fmt.color,
            };
          }),
        };
      }

      case "search-songs": {
        const query =
          typeof payload === "object" && payload !== null
            ? payload.query
            : String(payload || "");
        const limit = Number(payload?.limit) || 50;

        if (!query.trim()) {
          return { query: "", results: [] };
        }

        const rawResults = await this.library.getLocalSearchResults(query);
        const sliced = rawResults.slice(0, limit).map((s) => {
          const fmt = this.library.getFormatInfo(s);
          return {
            ...s,
            code: String(s.code).padStart(6, "0"),
            format: fmt.label,
            formatColor: fmt.color,
          };
        });

        return {
          query,
          count: sliced.length,
          results: sliced,
        };
      }

      case "search-songs": {
        const query =
          typeof payload === "object" && payload !== null
            ? payload.query
            : String(payload || "");
        const limit = Number(payload?.limit) || 50;

        if (!query.trim()) {
          return { query: "", results: [] };
        }

        const rawResults = await this.library.getLocalSearchResults(query);
        const sliced = rawResults.slice(0, limit).map((s) => {
          const fmt = this.library.getFormatInfo(s);
          return {
            code: String(s.code).padStart(6, "0"),
            title: s.title,
            artist: s.artist,
            displayRomaTitle: s.displayRomaTitle || null,
            displayRomaArtist: s.displayRomaArtist || null,
            format: fmt.label,
            formatColor: fmt.color,
          };
        });

        return {
          query,
          count: sliced.length,
          results: sliced,
        };
      }

      case "key-change": {
        if (this.state.mode !== "player") {
          return { success: false, reason: "Not in player mode." };
        }

        if (
          this.state.currentSongIsYouTube ||
          this.state.currentSongIsStandaloneVideo
        ) {
          this.infoBar.showTemp(
            "TRANSPOSE",
            "Not available for this format.",
            3000,
          );
          return { success: false, reason: "Not available for this format." };
        }

        const Forte = this.services.Forte;
        const cur = Forte.getPlaybackState().transpose || 0;
        let next = cur;

        if (typeof payload === "number") {
          next = cur + payload;
        } else if (payload === "up") {
          next = cur + 1;
        } else if (payload === "down") {
          next = cur - 1;
        } else if (typeof payload === "object" && payload !== null) {
          if (payload.value !== undefined) next = Number(payload.value);
          else if (payload.step !== undefined)
            next = cur + Number(payload.step);
        } else {
          next = cur + 1;
        }

        next = Math.max(-24, Math.min(24, Math.round(next)));
        Forte.setTranspose(next);

        let left = 50;
        let width = 0;
        if (next > 0) width = (next / 24) * 50;
        else if (next < 0) {
          width = (Math.abs(next) / 24) * 50;
          left = 50 - width;
        }

        const html = `<div class="transpose-display"><div class="transpose-min">-24</div><div class="transpose-slider-container"><div class="transpose-slider-center-line"></div><div class="transpose-slider-fill" style="left: ${left}%; width: ${width}%;"></div></div><div class="transpose-max">+24</div><span class="transpose-value">${(next > 0 ? "+" : "") + next} st</span></div>`;
        this.infoBar.showTemp("TRANSPOSE", html, 3000);

        return { success: true, transpose: next };
      }

      case "toggle-chorus": {
        if (this.state.mode !== "player") {
          return { success: false, reason: "Not in player mode." };
        }

        const Forte = this.services.Forte;
        const pbState = Forte.getPlaybackState();

        if (!this.state.currentSongIsMIDI || !pbState.hasChorus) {
          this.infoBar.showTemp(
            "CHORUS",
            "Not available for this format.",
            3000,
          );
          return { success: false, reason: "Not available for this format." };
        }

        let isEnabled;
        if (typeof payload === "boolean") {
          const currentState = Boolean(
            this.playback?.chorusElement && !this.playback.chorusElement.paused,
          );
          isEnabled =
            currentState === payload ? currentState : Forte.toggleChorus();
        } else {
          isEnabled = Forte.toggleChorus();
        }

        const html = `
          <div class="volume-display" style="display: flex; align-items: center; justify-content: center; width: 100%;">
            <div style="font-weight: 700; color: #ffd700; font-size: 1.2rem;">CHORUS ${isEnabled ? "ON" : "OFF"}</div>
          </div>
        `;
        this.infoBar.showTemp("CHORUS", html, 3000);

        return { success: true, isChorusEnabled: isEnabled };
      }

      case "guide-melody": {
        if (this.state.mode !== "player") {
          return { success: false, reason: "Not in player mode." };
        }

        const Forte = this.services.Forte;
        const pbState = Forte.getPlaybackState();

        if (!pbState.hasGuideNotes) {
          this.infoBar.showTemp(
            "MELODY",
            "Not available for this format.",
            3000,
          );
          return { success: false, reason: "Not available for this format." };
        }

        const levels = this.input.guideMelodyLevels;
        let selectedLevel;

        if (payload === undefined || payload === "cycle") {
          this.input.currentGuideMelodyIndex =
            (this.input.currentGuideMelodyIndex + 1) % levels.length;
          selectedLevel = levels[this.input.currentGuideMelodyIndex];
        } else if (typeof payload === "string") {
          const upper = payload.toUpperCase();
          const matchIdx = levels.findIndex((l) => l.label === upper);
          if (matchIdx !== -1) {
            this.input.currentGuideMelodyIndex = matchIdx;
            selectedLevel = levels[matchIdx];
          }
        } else if (typeof payload === "number") {
          if (payload >= 0 && payload < levels.length) {
            this.input.currentGuideMelodyIndex = payload;
            selectedLevel = levels[payload];
          } else {
            const clamped = Math.max(0, Math.min(127, Math.round(payload)));
            selectedLevel = { label: `${clamped}`, value: clamped };
          }
        }

        if (!selectedLevel) {
          selectedLevel = levels[this.input.currentGuideMelodyIndex];
        }

        Forte.setGuideTrackVolume(selectedLevel.value);

        const html = `
          <div class="volume-display" style="display: flex; align-items: center; width: 100%; gap: 1rem;">
            <div style="font-weight: 700; color: #ffd700; width: 85px; text-align: left;">${selectedLevel.label}</div>
            <div class="volume-slider-container" style="flex-grow: 1; height: 12px; background-color: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; overflow: hidden;">
              <div class="volume-slider-fill" style="height: 100%; background-color: #ffd700; border-radius: 6px; transition: width 0.1s linear; width: ${(selectedLevel.value / 127) * 100}%"></div>
            </div>
          </div>
        `;
        this.infoBar.showTemp("MELODY", html, 3000);

        return {
          success: true,
          label: selectedLevel.label,
          volume: selectedLevel.value,
        };
      }

      default:
        throw new Error(`Unsupported IPC action: ${action}`);
    }
  }

  async init() {
    this.context.wrapper = new Html("div").classOn("full-ui").appendTo("body");
    this.context.wrapper.classOn("loading");
    this.services.Forte.setPianoRollContainer(this.context.wrapper);

    const micVol =
      this.config.audioConfig?.micMonitorVolume ??
      this.config.audioConfig?.micRecordingVolume ??
      1.0;
    this.services.Forte.setMicMonitorVolume(micVol);
    this.services.Forte.setMicRecordingVolume(micVol);

    if (this.config.audioConfig?.micLatency) {
      await this.services.Forte.setLatency(this.config.audioConfig.micLatency);
    }

    if (this.config.audioConfig?.enableScoring !== undefined) {
      this.services.Forte.setScoringEnabled(
        this.config.audioConfig.enableScoring,
      );
    } else {
      this.services.Forte.setScoringEnabled(true);
    }

    if (this.config.displayGuide !== undefined) {
      if (this.services.Forte.setDisplayGuideMelody) {
        this.services.Forte.setDisplayGuideMelody(this.config.displayGuide);
      }
    } else {
      if (this.services.Forte.setDisplayGuideMelody) {
        this.services.Forte.setDisplayGuideMelody(true);
      }
    }

    this.state.actualPort = await NetworkingUtility.getPort();
    try {
      this.state.windowsVolume = await window.volume.getVolume();
    } catch (e) {}

    const sfx = [
      "fanfare.mid",
      "fanfare-2.mid",
      "fanfare-3.mid",
      "fanfare-4.mid",
      "scores/0.wav",
      "scores/20.wav",
      "scores/50.wav",
      "scores/70.wav",
      "scores/100.wav",
      "nav.wav",
      "out_of_bounds.wav",
      "session_start.wav",
      "session_end.wav",
      "drive_disconnected.wav",
      "drive_mismatch.wav",
      "drive_reconnected.wav",
      ...Array.from({ length: 10 }, (_, i) => `numbers/${i}.wav`),
    ];
    await Promise.all(
      sfx.map((s) => this.services.Forte.loadSfx(`/assets/audio/${s}`)),
    );

    this.versionInformation = await window.version.getVersionInformation();
    this.updateInformation = await this.services.Updates.getUpdateInformation();
    document.title = `Encore Karaoke ${this.versionInformation.channel} v${this.versionInformation.number} (${this.versionInformation.codename})`;

    await this.services.Forte.setTrackVolume(this.state.volume);
    await this.services.Forte.setMusicRecordingVolume(this.state.volume);
    const micDevice = this.config.audioConfig?.mix?.scoring?.inputDevice;
    if (micDevice) await this.services.Forte.setMicDevice(micDevice);
    else await this.services.Forte.setMicDevice("default");

    const savedMidiDevices = this.config.audioConfig?.midiOutputDevices || [
      this.config.audioConfig?.midiOutputDevice || "internal",
      "none",
      "none",
      "none",
    ];
    if (this.services.Forte.setMidiOutputDevice) {
      for (let port = 0; port < 4; port++) {
        const dev =
          savedMidiDevices[port] ?? (port === 0 ? "internal" : "none");
        await this.services.Forte.setMidiOutputDevice(dev, port);
      }
    }

    const savedChain = this.config.audioConfig?.vocalChain || [];
    await this.services.Forte.loadVocalChain(savedChain);

    this.state.systemFonts = ["Radio Canada"];
    try {
      if ("queryLocalFonts" in window) {
        const fonts = await window.queryLocalFonts();
        const uniqueFonts = [...new Set(fonts.map((f) => f.family))].sort();
        this.state.systemFonts = [
          "Radio Canada",
          ...uniqueFonts.filter((f) => f !== "Radio Canada"),
        ];
      }
    } catch (e) {
      console.warn("[EncoreHome] Could not query local fonts:", e);
    }

    this.ui.buildAll();

    this.infoBar.mount(this.dom.topBarContainer);
    this.scoreHud.mount(this.context.wrapper);
    this.mixer.mount(this.context.wrapper);
    this.bgv.mount(this.dom.bgvContainer);
    this.recorder.mount(this.context.wrapper);
    this.recorder.setUiRefs({
      playerUi: this.dom.playerUi,
      lyricsCanvas: this.dom.lyricsCanvas,
      scoreDisplay: this.scoreHud.scoreDisplay,
      danmakuCanvas: this.dom.danmakuCanvas,
      postSongScreen: this.dom.postSongScreen,
      scoreHeadlineText: this.dom.scoreHeadlineText,
      scoreTitleText: this.dom.scoreTitleText,
      finalScoreDisplay: this.dom.finalScoreDisplay,
      rankDisplay: this.dom.rankDisplay,
    });

    await this.library.init();
    await this.network.init();
    this.sessions.init();
    this.recordings.init();
    this.lyrics.init();
    this.setup.init();
    this.games.init();

    this.driveRecovery.buildUI();
    this.driveRecovery.captureLibraryFingerprint();

    window.addEventListener("keydown", this.boundKeydown);

    // Deep Link Listener Registration
    if (window.deepLink?.onDeepLink) {
      this._deepLinkCleanup = window.deepLink.onDeepLink((url) =>
        this.handleDeepLink(url),
      );
    }

    // Karaoke External IPC Listener Registration
    this._karaokeIpcListener = async (_event, req) => {
      const { replyChannel, action, payload } = req;
      try {
        const result = await this.handleIpcCommand(action, payload);
        this.services.Ui?.ipc?.send?.(replyChannel, result) ??
          window.desktopIntegration?.ipc?.send(replyChannel, result);
      } catch (err) {
        const errorPayload = { error: err.message };
        this.services.Ui?.ipc?.send?.(replyChannel, errorPayload) ??
          window.desktopIntegration?.ipc?.send(replyChannel, errorPayload);
      }
    };

    window.desktopIntegration?.ipc?.on(
      "karaoke:request",
      this._karaokeIpcListener,
    );

    const libraryInfo = this.library.libraryInfo;
    const skipToFirst = Boolean(
      libraryInfo?.manifest?.flags?.skipToFirstNoteOn,
    );
    if (this.services.Forte?.setSkipToFirstNoteOn) {
      this.services.Forte.setSkipToFirstNoteOn(skipToFirst);
    }
    if (libraryInfo?.manifest?.additionalContents?.bgvCategories) {
      const enableDefaultBgv =
        libraryInfo?.manifest?.flags?.enableDefaultCategories ?? true;

      if (enableDefaultBgv) {
        await this.bgv.loadManifestCategories();
      }

      const enableMtvCategory =
        libraryInfo?.manifest?.flags?.enableMtvCategory ?? true;

      const mtvPaths = this.state.songList
        .filter((s) => s.videoPath)
        .map((s) => s.videoPath);

      if (enableMtvCategory && mtvPaths.length) {
        this.bgv.addDynamicCategory({
          BGV_CATEGORY: "MTV",
          BGV_LIST: mtvPaths,
          isAbsolute: true,
        });
      }

      try {
        const userBgvs = await this.services.FsSvc.getUserBGVs();
        if (userBgvs && userBgvs.length > 0) {
          this.bgv.addDynamicCategory({
            BGV_CATEGORY: "User BGV",
            BGV_LIST: userBgvs,
            isAbsolute: true,
          });
        }
      } catch (e) {}

      let libraryBgvCategories =
        libraryInfo.manifest.additionalContents.bgvCategories;
      libraryBgvCategories.forEach((category) => {
        let tempPaths = [];
        category.BGV_LIST.forEach((vidPath) =>
          tempPaths.push(pathJoin([libraryInfo.path, vidPath])),
        );
        this.bgv.addDynamicCategory({
          BGV_CATEGORY: category.BGV_CATEGORY,
          BGV_LIST: tempPaths,
          isAbsolute: true,
        });
      });
    }

    try {
      const savedCategory = this.config.videoConfig?.defaultBgvCategory;
      if (savedCategory) this.bgv.selectedCategory = savedCategory;
      else this.bgv.selectedCategory = "Auto";
    } catch (e) {
      this.bgv.selectedCategory = "Auto";
    }

    try {
      const savedFillMode = this.config.videoConfig?.bgvFillMode || "cover";
      this.bgv.setFillMode(savedFillMode);
    } catch (e) {
      this.bgv.setFillMode("fill");
    }

    this.ui.startBumperCycle();
    await this.bgv.updatePlaylistForCategory();

    if (this.updateInformation) {
      if (this.updateInformation.number != this.versionInformation.number) {
        if (
          (this.config.releaseChannel ?? "") == "BETA" ||
          this.updateInformation.channel == "RELEASE"
        ) {
          this.infoBar.showTemp(
            "UPDATE",
            `Encore has a new version: v${this.updateInformation.number} ${this.updateInformation.channel} (${this.updateInformation.codename})`,
            3000,
          );
        }
      }
    }

    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("Encore.UI.Ready"));
      setTimeout(() => {
        this.context.wrapper.classOff("loading");
        this.services.Ui.transition("fadeIn", this.context.wrapper);
        this.ui.setMode("menu");

        this.syncSetlistOverlay();

        // Signal Main Process that boot sequence is complete
        if (window.deepLink?.signalReady) {
          window.deepLink.signalReady();
        }
      }, 100);
    }, 100);
  }

  destroy() {
    if (this._deepLinkCleanup) this._deepLinkCleanup();
    if (this._karaokeIpcListener) {
      window.desktopIntegration?.ipc?.off(
        "karaoke:request",
        this._karaokeIpcListener,
      );
      this._karaokeIpcListener = null;
    }
    if (this.boundKeydown)
      window.removeEventListener("keydown", this.boundKeydown);
    if (this.stream) this.stream.destroy();
    this.playback.cleanupPlayerEvents();
    this.network.destroy();
    this.sessions.destroy();
    this.setup.destroy();
    this.games.destroy();
    this.driveRecovery.destroy();
    this.library.destroy();
    if (this.recorder.isRecording) this.recorder.stop();
    this.bgv.stop();
    this.services.Forte.stopTrack();
    this.infoBar?.destroy?.();
    this.context.wrapper.cleanup();
  }
}

let controller;

const pkg = {
  name: "Encore Home",
  type: "app",
  privs: 0,
  start: async function (Root) {
    const config = await window.config.getAll();
    controller = new EncoreController(Root, config);
    await controller.init();
  },
  end: async function () {
    if (controller) {
      controller.destroy();
      controller = null;
    }
  },
};

export default pkg;
