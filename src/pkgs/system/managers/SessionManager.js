import Html from "../../../libs/html.js";
import playNavSfx from "../../../libs/sfx.js";

// Remote Session audio uses a fixed mixing key so a new performance cleanly
// replaces the previous performer without leaving a stale Web Audio source.
const SESSION_PERFORMANCE_STREAM_ID = "session-performance";

export default class SessionManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    const state = this.ctx.state;
    state.isSessionActive = false;
    state.sessionMode = "lounge"; // 'lounge' | 'performance'
    state.sessionRoomId = null;
    state.isSessionHost = false;
    state.lastPlayTrigger = null;
    state.knownParticipants = [];
    state.isSessionModalOpen = false;
    state.sessionModalView = "select";

    this.handleStateUpdate = this.handleStateUpdate.bind(this);
    this.handleRemoteScore = this.handleRemoteScore.bind(this);
    this.handleSkipScore = this.handleSkipScore.bind(this);
    this.handleRemoteStream = this.handleRemoteStream.bind(this);
    this.handleLoungeStream = this.handleLoungeStream.bind(this);
    this.handleClearStreams = this.handleClearStreams.bind(this);
    this.handleSessionLyricsData = this.handleSessionLyricsData.bind(this);
    this.handleSessionLyricsTime = this.handleSessionLyricsTime.bind(this);
    this.handleSessionLyricsRequest =
      this.handleSessionLyricsRequest.bind(this);
    this.handleSessionTrackInfo = this.handleSessionTrackInfo.bind(this);
    this.handleLocalTrackInfo = this.handleLocalTrackInfo.bind(this);
    this.handleLocalPlaybackTime = this.handleLocalPlaybackTime.bind(this);
    this.handleSessionPianoRollData =
      this.handleSessionPianoRollData.bind(this);
    this.handleSessionPianoRollNotes =
      this.handleSessionPianoRollNotes.bind(this);
    this.handleSessionPianoRollState =
      this.handleSessionPianoRollState.bind(this);
    this.handlePeerDisconnected = this.handlePeerDisconnected.bind(this);
    this.handleHostDisconnected = this.handleHostDisconnected.bind(this);
    this.handleKicked = this.handleKicked.bind(this);
    this.handleForceStop = this.handleForceStop.bind(this);
    this.handleSessionRecordingStateChange =
      this.handleSessionRecordingStateChange.bind(this);
    this.handleChatHistorySync = this.handleChatHistorySync.bind(this);
    this.handleChat = this.handleChat.bind(this);
    this.handleCheer = this.handleCheer.bind(this);

    this._lastPianoRollBroadcast = 0;
    this._sessionPianoRollSongKey = null;
    this._sessionPianoRollNoteCount = 0;
    this._lastRenderedEveryoneAudible = null;
    this._sessionViewTimer = null;
  }

  /**
   * Updates Discord Rich Presence with active Party and Session Join Secret
   */
  updateDiscordSessionRPC() {
    const state = this.ctx.state;
    const SessionsSvc = this.ctx.services.SessionsSvc;

    if (!state.isSessionActive || !state.sessionRoomId) {
      this._sessionStartTime = null;
      window.desktopIntegration.ipc.send("setRPC", {
        details: `Browsing ${state.songList.length} Songs...`,
        state: "Main Menu",
      });
      return;
    }

    if (!this._sessionStartTime) {
      this._sessionStartTime = Date.now();
    }

    const participants = SessionsSvc?.state?.participants || [];
    const currentCount = Math.max(1, participants.length);
    const maxCapacity = 10;

    let detailsText = "Session Lounge";
    let stateText = state.isSessionHost ? `Hosting a Session` : `In a Session`;

    if (
      SessionsSvc.state.mode === "performance" &&
      SessionsSvc.state.nowPlaying
    ) {
      let singerName =
        SessionsSvc.state.nowPlaying.requesterNickname || "Singer";
      detailsText = SessionsSvc.state.nowPlaying.title;
      stateText = `Singing: ${singerName}`;
    }

    const safePartyId = `party${state.sessionRoomId.replace(/[^a-zA-Z0-9]/g, "")}`;

    window.desktopIntegration.ipc.send("setRPC", {
      details: detailsText,
      state: stateText,
      startTimestamp: this._sessionStartTime,
      partyId: safePartyId,
      partySize: currentCount,
      partyMax: maxCapacity,
      joinSecret: state.sessionRoomId,
      instance: true,
    });
  }

  /**
   * Displays the Session invite prompt when an encore://session/<roomCode> URL is received.
   * @param {string} roomCode - The target room ID
   */
  promptDeepLinkSession(roomCode) {
    if (!roomCode) return;
    const state = this.ctx.state;

    if (state.isSessionActive && state.sessionRoomId === roomCode) {
      this.ctx.modules.infoBar.showTemp(
        "SESSIONS",
        "Already connected to this Session.",
        3000,
      );
      return;
    }

    if (state.isSessionActive) {
      this.ctx.modules.infoBar.showTemp(
        "SESSIONS",
        "Already connected to a Session.",
        3000,
      );
      return;
    }

    const wasHidden =
      this.ctx.dom.sessionModal.elm.classList.contains("hidden");
    this.ctx.state.isSessionModalOpen = true;
    this.ctx.dom.sessionModal.classOff("hidden");
    this.renderSessionView("deeplink-prompt", roomCode, !wasHidden);
  }

  /**
   * Plays a navigation sound effect.
   * @param {string} sfxName - The name of the wav file (without extension)
   */
  playNavSfx(sfxName) {
    return playNavSfx(this.ctx, sfxName);
  }

  /**
   * Called to register the document event listeners mapping from CherryTree Services
   */
  init() {
    document.addEventListener(
      "Encore.Sessions.StateUpdate",
      this.handleStateUpdate,
    );
    document.addEventListener(
      "Encore.Sessions.RemoteScore",
      this.handleRemoteScore,
    );
    document.addEventListener(
      "Encore.Sessions.SkipScore",
      this.handleSkipScore,
    );
    document.addEventListener(
      "Encore.Sessions.RemoteStream",
      this.handleRemoteStream,
    );
    document.addEventListener(
      "Encore.Sessions.LoungeStream",
      this.handleLoungeStream,
    );
    document.addEventListener(
      "Encore.Sessions.ClearStreams",
      this.handleClearStreams,
    );
    document.addEventListener(
      "Encore.Sessions.LyricsData",
      this.handleSessionLyricsData,
    );
    document.addEventListener(
      "Encore.Sessions.LyricsTime",
      this.handleSessionLyricsTime,
    );
    document.addEventListener(
      "Encore.Sessions.LyricsRequest",
      this.handleSessionLyricsRequest,
    );
    document.addEventListener(
      "Encore.Sessions.TrackInfo",
      this.handleSessionTrackInfo,
    );
    document.addEventListener(
      "Encore.Sessions.PeerDisconnected",
      this.handlePeerDisconnected,
    );
    document.addEventListener(
      "Encore.Sessions.HostDisconnected",
      this.handleHostDisconnected,
    );
    document.addEventListener("Encore.Sessions.Kicked", this.handleKicked);
    document.addEventListener(
      "Encore.Sessions.ForceStop",
      this.handleForceStop,
    );
    document.addEventListener(
      "Encore.Recorder.SessionStateChange",
      this.handleSessionRecordingStateChange,
    );
    document.addEventListener(
      "Encore.Sessions.ChatHistorySync",
      this.handleChatHistorySync,
    );
    document.addEventListener("Encore.Sessions.Chat", this.handleChat);
    document.addEventListener("Encore.Sessions.Cheer", this.handleCheer);
    document.addEventListener(
      "Encore.Playback.TrackInfo",
      this.handleLocalTrackInfo,
    );
    document.addEventListener(
      "Encore.Forte.Playback.TimeUpdate",
      this.handleLocalPlaybackTime,
    );
    document.addEventListener(
      "Encore.Sessions.PianoRollData",
      this.handleSessionPianoRollData,
    );
    document.addEventListener(
      "Encore.Sessions.PianoRollNotes",
      this.handleSessionPianoRollNotes,
    );
    document.addEventListener(
      "Encore.Sessions.PianoRollState",
      this.handleSessionPianoRollState,
    );
  }

  handleStateUpdate(e) {
    const sState = e.detail;
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const root = this.ctx.root;
    const SessionsSvc = this.ctx.services.SessionsSvc;
    const infoBar = this.ctx.modules.infoBar;

    const prevMode = state.sessionMode;
    state.sessionMode = sState.mode;

    const newParticipants = sState.participants || [];
    const oldParticipants = state.knownParticipants || [];
    const myId = SessionsSvc.peer.id;

    const joined = newParticipants.filter(
      (np) => np.id !== myId && !oldParticipants.find((op) => op.id === np.id),
    );
    const left = oldParticipants.filter(
      (op) => op.id !== myId && !newParticipants.find((np) => np.id === op.id),
    );

    joined.forEach((p) => {
      const avatarHtml = p.avatar
        ? `<img src="${p.avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 8px; border: 1px solid rgba(255,255,255,0.3);">`
        : `<div style="width: 28px; height: 28px; border-radius: 50%; background: #444; display: inline-block; vertical-align: middle; margin-right: 8px; border: 1px solid rgba(255,255,255,0.3);"></div>`;
      infoBar.showTemp(
        "SESSION",
        `${avatarHtml} <span style="font-weight: 700; color: #ffd700;">${p.nickname}</span> joined the room.`,
        4000,
      );
    });

    left.forEach((p) => {
      const avatarHtml = p.avatar
        ? `<img src="${p.avatar}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 8px; border: 1px solid rgba(255,255,255,0.3);">`
        : `<div style="width: 28px; height: 28px; border-radius: 50%; background: #444; display: inline-block; vertical-align: middle; margin-right: 8px; border: 1px solid rgba(255,255,255,0.3);"></div>`;
      infoBar.showTemp(
        "SESSION",
        `${avatarHtml} <span style="font-weight: 700; color: #ffd700;">${p.nickname}</span> left the room.`,
        4000,
      );
    });

    state.knownParticipants = [...newParticipants];
    this.updateDiscordSessionRPC();

    root.queueSetlistSync();

    if (state.isSessionModalOpen && state.sessionModalView === "active") {
      this.renderSessionView("active");
    }

    if (state.isSessionActive) {
      dom.sessionChatContainer.classOff("hidden");
    }

    if (sState.mode === "performance") {
      root.ui.stopLoungeBackground();

      if (sState.playTrigger !== state.lastPlayTrigger) {
        state.lastPlayTrigger = sState.playTrigger;

        if (sState.singerId === myId) {
          dom.sessionRemoteContainer.classOn("hidden");
          dom.sessionRemoteVideo.elm.srcObject = null;
          root.lyrics?.stopRemoteLyrics();
          this.ctx.services.Forte.stopRemotePianoRoll?.();

          if (sState.nowPlaying) {
            root.playback.startPlayer(sState.nowPlaying);
            setTimeout(() => {
              const stream = this.ctx.modules.recorder.getSessionAudioStream();
              if (stream) SessionsSvc.broadcastPerformance(stream);
            }, 1000);
          }
        } else {
          if (this.ctx.modules.recorder)
            this.ctx.modules.recorder.stopSessionAudioStream();
          root.playback.stopPlayer();
          this.ctx.services.Forte.stopRemotePianoRoll?.();
          root.ui.setMode("player");
          state.isTransitioning = false;

          dom.bgvContainer.classOff("hidden");
          this.ctx.modules.bgv.resumePlaylist();
          dom.introCard.classOff("visible");

          if (root.lyrics && root.lyrics.lyricsCtx) {
            root.lyrics.lyricsCtx.clearRect(
              0,
              0,
              dom.lyricsCanvas.elm.width,
              dom.lyricsCanvas.elm.height,
            );
          }

          if (sState.nowPlaying) {
            const singerName = sState.nowPlaying.requesterNickname || "Singer";

            if ("mediaSession" in navigator) {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: sState.nowPlaying.title,
                artist: `${sState.nowPlaying.artist} (Singer: ${singerName})`,
              });
            }

            this.applySessionTrackInfo(sState.nowPlaying);
            this.syncSessionRecorderInfo(sState.nowPlaying);

            const timeSinceStart = sState.playTrigger
              ? Math.abs(Date.now() - sState.playTrigger)
              : 99999;
            if (timeSinceStart < 8000) {
              this.showSessionIntroCard(sState.nowPlaying, singerName);
            }
          }

          dom.sessionRemoteContainer.classOff("hidden");
          infoBar.showTemp(
            "PERFORMANCE",
            `Everybody give a round of applause to ${sState.nowPlaying?.requesterNickname || "Singer"}!`,
            5000,
          );
        }
      }
      this.updateDiscordSessionRPC();
    } else if (sState.mode === "lounge") {
      const enteringLounge = prevMode !== "lounge";

      if (enteringLounge) {
        dom.sessionRemoteContainer.classOn("hidden");
        dom.sessionRemoteVideo.elm.srcObject = null;
        this.ctx.services.Forte.stopRemotePianoRoll?.();
        this.ctx.modules.scoreHud?.hide();
        if (this.ctx.modules.recorder)
          this.ctx.modules.recorder.stopSessionAudioStream();

        state.isTransitioning = false;
        this.syncSessionRecorderInfo(null);
        if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
      }

      // Never leave a finished performance playing behind the Lounge UI.
      if (state.mode === "player" || state.currentSong) {
        root.playback.stopPlayer();
        root.ui.setMode("menu");
      }
      if (enteringLounge) {
        root.ui.setMode("menu");
        root.ui.startLoungeBackground();
        this.updateDiscordSessionRPC();
      }
    }

    if (infoBar.isTempVisible) {
      if (this._deferredQueueUpdate) clearInterval(this._deferredQueueUpdate);
      this._deferredQueueUpdate = setInterval(() => {
        if (!infoBar.isTempVisible) {
          clearInterval(this._deferredQueueUpdate);
          infoBar.showDefault();
        }
      }, 250);
    } else {
      infoBar.showDefault();
    }
  }

  async handleRemoteScore(e) {
    const state = this.ctx.state;
    const SessionsSvc = this.ctx.services.SessionsSvc;
    if (
      state.isSessionActive &&
      SessionsSvc.state.mode === "performance" &&
      SessionsSvc.state.singerId !== SessionsSvc.peer.id
    ) {
      const mockScoreData = {
        finalScore: e.detail.entry.score,
        details: e.detail.entry.details,
      };
      state.remoteScoreEntry = e.detail.entry;
      state.currentScoreEntryId = e.detail.entry.id;

      // Mirror the performer, whose piano roll and live score HUD close out
      // when the song ends.
      this.ctx.services.Forte.stopRemotePianoRoll?.();
      this.ctx.modules.scoreHud?.hide();

      await this.ctx.root.playback.showPostSongScreen(mockScoreData);

      state.remoteScoreEntry = null;
      state.currentScoreEntryId = null;
    }
  }

  handleSkipScore() {
    const state = this.ctx.state;
    if (state.isScoreScreenActive && state.scoreSkipResolver) {
      this.ctx.services.Forte.stopSfx();
      state.scoreSkipped = true;
      state.scoreSkipResolver();
    }
  }

  handleRemoteStream(e) {
    const { stream } = e.detail || {};
    if (!stream) return;

    const videoEl = this.ctx.dom.sessionRemoteVideo.elm;
    videoEl.srcObject = stream;
    // Audio is routed through Forte's Session bus so it can be recorded and
    // streamed. Keep the element muted to avoid hearing the performer twice.
    videoEl.muted = true;
    videoEl.volume = 0;
    this.ctx.services.Forte.playRemoteStream(
      SESSION_PERFORMANCE_STREAM_ID,
      stream,
      { session: true },
    );
  }

  handleLoungeStream(e) {
    this.ctx.services.Forte.playRemoteStream(e.detail.id, e.detail.stream, {
      session: true,
    });
  }

  handleClearStreams() {
    this.ctx.services.Forte.stopRemoteStream(SESSION_PERFORMANCE_STREAM_ID);
    this.ctx.services.Forte.clearRemoteStreams();
    this.ctx.services.Forte.stopRemotePianoRoll?.();
    this.ctx.dom.sessionRemoteVideo.elm.srcObject = null;
    this.ctx.root.lyrics?.stopRemoteLyrics();

    this._lastPianoRollBroadcast = 0;
    this._sessionPianoRollSongKey = null;
    this._sessionPianoRollNoteCount = 0;
  }

  handleSessionLyricsData(e) {
    const lyrics = this.ctx.root.lyrics;
    if (!lyrics) return;
    lyrics.setupRemoteLyrics(e.detail || null);
  }

  handleSessionLyricsTime(e) {
    const lyrics = this.ctx.root.lyrics;
    if (!lyrics) return;
    lyrics.updateRemoteTimeSync(e.detail);
  }

  handleSessionLyricsRequest() {
    this.ctx.root.lyrics?.resendSessionLyrics();
    this.resendSessionPianoRoll();
  }

  handleLocalTrackInfo(e) {
    this.ctx.services.SessionsSvc?.broadcastTrackInfo?.(e.detail || null);
  }

  /**
   * Whether this client is the Session performer.
   * @returns {boolean}
   */
  isSessionSinger() {
    const SessionsSvc = this.ctx.services.SessionsSvc;
    if (!SessionsSvc?.peer || !SessionsSvc.state) return false;
    return (
      SessionsSvc.state.mode === "performance" &&
      SessionsSvc.state.singerId === SessionsSvc.peer.id
    );
  }

  /**
   * Whether this client is a non-performer in an active Session performance.
   * @returns {boolean}
   */
  isSessionAudience() {
    const SessionsSvc = this.ctx.services.SessionsSvc;
    if (!SessionsSvc?.peer || !SessionsSvc.state) return false;
    return (
      SessionsSvc.state.mode === "performance" &&
      SessionsSvc.state.singerId !== SessionsSvc.peer.id
    );
  }

  /**
   * Streams the performer's piano roll position, pitch, and note statuses to
   * the audience while a Session performance is running.
   */
  handleLocalPlaybackTime(e) {
    if (!this.isSessionSinger()) return;

    const SessionsSvc = this.ctx.services.SessionsSvc;
    const Forte = this.ctx.services.Forte;
    if (!SessionsSvc || !Forte?.getSessionPianoRollState) return;

    const now = performance.now();
    if (now - this._lastPianoRollBroadcast < 50) return;

    const songKey = this.ctx.state.currentSong?.path || null;
    if (songKey !== this._sessionPianoRollSongKey) {
      this._sessionPianoRollSongKey = songKey;
      this._sessionPianoRollNoteCount = 0;
      this._lastPianoRollBroadcast = 0;
    }

    const currentTime = Number(e.detail?.currentTime) || 0;
    const noteCount = Forte.getSessionPianoRollNoteCount
      ? Forte.getSessionPianoRollNoteCount()
      : 0;

    // Send note data before live state so statuses for newly appended notes
    // are applied after those notes exist on the audience's chart.
    if (noteCount > this._sessionPianoRollNoteCount) {
      if (this._sessionPianoRollNoteCount === 0) {
        const bundle = Forte.getSessionPianoRollBundle(songKey);
        if (bundle) {
          this._sessionPianoRollNoteCount = bundle.notes.length;
          SessionsSvc.broadcastPianoRollData(bundle);
        }
      } else {
        const notes = Forte.getSessionPianoRollNotes(
          this._sessionPianoRollNoteCount,
        );
        if (notes.length > 0) {
          SessionsSvc.broadcastPianoRollNotes({
            songKey,
            startIndex: this._sessionPianoRollNoteCount,
            notes,
          });
        }
        this._sessionPianoRollNoteCount = noteCount;
      }
    } else if (noteCount < this._sessionPianoRollNoteCount) {
      this._sessionPianoRollNoteCount = 0;
    }

    this._lastPianoRollBroadcast = now;
    SessionsSvc.broadcastPianoRollState(
      Forte.getSessionPianoRollState(currentTime),
    );
  }

  /**
   * Re-shares the current piano roll bundle (e.g. a peer joined mid-song).
   */
  resendSessionPianoRoll() {
    if (!this.isSessionSinger()) return;

    const SessionsSvc = this.ctx.services.SessionsSvc;
    const Forte = this.ctx.services.Forte;
    if (!SessionsSvc || !Forte?.getSessionPianoRollBundle) return;

    const songKey = this.ctx.state.currentSong?.path || null;
    const bundle = Forte.getSessionPianoRollBundle(songKey, false);
    if (!bundle) return;

    this._sessionPianoRollNoteCount = bundle.notes.length;
    SessionsSvc.broadcastPianoRollData(bundle);
  }

  handleSessionPianoRollData(e) {
    if (!this.isSessionAudience()) {
      this.ctx.services.Forte?.stopRemotePianoRoll?.();
      return;
    }

    const Forte = this.ctx.services.Forte;
    if (!Forte?.setupRemotePianoRoll) return;

    if (!e.detail) {
      Forte.stopRemotePianoRoll?.();
      return;
    }

    Forte.setupRemotePianoRoll(e.detail);
  }

  handleSessionPianoRollNotes(e) {
    if (!this.isSessionAudience()) return;
    if (!e.detail) return;
    this.ctx.services.Forte?.appendRemotePianoRollNotes?.(e.detail);
  }

  handleSessionPianoRollState(e) {
    if (!this.isSessionAudience()) return;

    const detail = e.detail;
    if (!detail) return;

    this.ctx.services.Forte?.updateRemotePianoRoll?.(detail);

    if (!(this.ctx.state.isScoreHudEnabled ?? true)) {
      this.ctx.modules.scoreHud?.hide();
    } else if (Number.isFinite(detail.score)) {
      this.ctx.modules.scoreHud?.show(detail.score);
    }
  }

  handleSessionTrackInfo(e) {
    this.applySessionTrackInfo(e.detail || null);

    const SessionsSvc = this.ctx.services.SessionsSvc;
    const state = this.ctx.state;
    if (!SessionsSvc?.state) return;
    if (SessionsSvc.state.mode !== "performance") return;
    if (SessionsSvc.state.singerId === SessionsSvc.peer.id) return;
    if (state.mode !== "player") return;

    const nowPlaying = SessionsSvc.state.nowPlaying;
    if (!nowPlaying) return;

    const elapsed = SessionsSvc.state.playTrigger
      ? Date.now() - SessionsSvc.state.playTrigger
      : 0;
    if (elapsed > 12000) return;
    if (this.ctx.dom.introCard.elm.classList.contains("visible")) return;

    this.showSessionIntroCard(
      nowPlaying,
      nowPlaying.requesterNickname || "Singer",
    );
  }

  showSessionIntroCard(nowPlaying, singerName) {
    const dom = this.ctx.dom;
    const state = this.ctx.state;

    dom.introTitle.text(
      this.ctx.root.playback.truncateTitleIfNeeded(nowPlaying.title),
    );
    dom.introArtist.text(nowPlaying.artist);
    dom.introMeta.text(`Singer: ${singerName}`);
    dom.introCard.classOff("exiting").classOn("visible");

    if (this._sessionIntroTimer) clearTimeout(this._sessionIntroTimer);
    if (this._sessionExitTimer) clearTimeout(this._sessionExitTimer);
    this._sessionIntroTimer = setTimeout(() => {
      this._sessionIntroTimer = null;
      if (state.mode !== "player") return;
      dom.introCard.classOff("visible").classOn("exiting");
      this._sessionExitTimer = setTimeout(() => {
        this._sessionExitTimer = null;
        dom.introCard.classOff("exiting");
      }, 650);
    }, 3500);
  }

  /**
   * Keeps the on-video metadata of a whole-session recording in sync with what
   * the room is hearing. Between songs the metadata overlay is cleared entirely.
   *
   * @param {Object|null} info - Session "now playing" metadata, if any.
   */
  syncSessionRecorderInfo(info) {
    const recorder = this.ctx.modules.recorder;
    if (!recorder?.isSessionRecording) return;

    const title = typeof info?.title === "string" ? info.title.trim() : "";
    if (title) {
      // Session feeds are rendered locally, so their lyrics are never CD+G.
      recorder.setSessionInfo(title, info.artist || "");
    } else {
      recorder.clearSongInfo();
    }
  }

  applySessionTrackInfo(info) {
    const dom = this.ctx.dom;
    if (!dom.introBpmBadge || !dom.introKeyBadge) return;

    const bpm = Number(info?.bpm);
    if (Number.isFinite(bpm) && bpm > 0) {
      dom.introBpmBadge.text(`${Math.round(bpm)} BPM`).classOff("hidden");
    } else {
      dom.introBpmBadge.text("").classOn("hidden");
    }

    if (info?.key) {
      dom.introKeyBadge.text(info.key).classOff("hidden");
    } else {
      dom.introKeyBadge.text("").classOn("hidden");
    }
  }

  handlePeerDisconnected(e) {
    const peerId = e.detail;
    this.ctx.services.Forte.stopRemoteStream(peerId);

    const SessionsSvc = this.ctx.services.SessionsSvc;
    if (SessionsSvc?.state?.singerId === peerId) {
      this.ctx.services.Forte.stopRemoteStream(SESSION_PERFORMANCE_STREAM_ID);
      this.ctx.dom.sessionRemoteVideo.elm.srcObject = null;
    }
  }

  handleHostDisconnected() {
    this.performSessionDisconnect();
    this.ctx.modules.infoBar.showTemp(
      "SESSION ENDED",
      "The host has disconnected from the room.",
      5000,
    );
  }

  handleKicked(e) {
    const reason = e.detail;
    this.ctx.services.SessionsSvc.leaveRoom();
    this.performSessionDisconnect();

    if (reason === "version_mismatch") {
      this.ctx.modules.infoBar.showTemp(
        "SESSIONS",
        "Session protocol mismatch. Please ensure both you and the host are on the latest update.",
        6000,
      );
    } else {
      this.ctx.modules.infoBar.showTemp(
        "KICKED",
        "You were kicked from the session.",
        5000,
      );
    }
  }

  handleForceStop() {
    if (this.ctx.modules.recorder)
      this.ctx.modules.recorder.stopSessionAudioStream();

    if (this.ctx.state.mode === "player") {
      this.ctx.root.playback.stopPlayer();
      this.ctx.services.Forte.stopRemotePianoRoll?.();
      this.ctx.modules.scoreHud?.hide();
      this.ctx.modules.infoBar.showTemp(
        "SKIPPED",
        "The host skipped the current performance.",
        4000,
      );
    }
  }

  /**
   * Shares this participant's whole-session recording state with the room.
   *
   * @param {CustomEvent} e - Recorder session state change event.
   */
  handleSessionRecordingStateChange(e) {
    if (!this.ctx.state.isSessionActive) return;
    this.ctx.services.SessionsSvc?.setRecordingStatus?.(
      Boolean(e.detail?.recording),
    );
  }

  performSessionDisconnect() {
    this.ctx.root.games.hideOverlay();

    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const root = this.ctx.root;

    if (state.isSessionActive) {
      this.ctx.services.Forte.playSfx("/assets/audio/session_end.wav");
    }

    if (this.ctx.services.Forte.setScoringForced) {
      this.ctx.services.Forte.setScoringForced(false);
    }

    if (this.ctx.services.Forte.setScoringEnabled) {
      const userPref = this.ctx.config.audioConfig?.enableScoring !== false;
      this.ctx.services.Forte.setScoringEnabled(userPref);
    }

    state.isSessionActive = false;
    state.sessionRoomId = null;
    state.knownParticipants = [];
    this._lastRenderedEveryoneAudible = null;
    this.updateDiscordSessionRPC();

    root.queueSetlistSync();

    root.ui.stopLoungeBackground();
    this.ctx.services.Forte.clearRemoteStreams();
    this.ctx.services.Forte.stopRemoteStream(SESSION_PERFORMANCE_STREAM_ID);
    const recorder = this.ctx.modules.recorder;
    if (recorder) {
      recorder.stopSessionAudioStream();
      if (recorder.isSessionRecording) recorder.stop();
    }

    root.playback.stopPlayer();
    dom.sessionRemoteContainer.classOn("hidden");
    this.ctx.services.Forte.stopRemotePianoRoll?.();
    this.ctx.modules.scoreHud?.hide();

    if (dom.sessionChatContainer) {
      dom.sessionChatContainer.classOn("hidden");
      dom.sessionChatMessages.clear();
    }
    if (dom.sessionRemoteVideo && dom.sessionRemoteVideo.elm) {
      dom.sessionRemoteVideo.elm.srcObject = null;
    }

    dom.bgvContainer.classOff("hidden");
    this.ctx.modules.bgv.start();

    root.ui.setMode("menu");

    if (state.isSessionModalOpen) {
      this.renderSessionView("select");
    }

    window.desktopIntegration.ipc.send("setRPC", {
      details: `Browsing ${state.songList.length} Songs...`,
      state: `Main Menu`,
    });
  }

  handleChatHistorySync(e) {
    if (this.ctx.dom.sessionChatMessages) {
      this.ctx.dom.sessionChatMessages.clear();
      e.detail.forEach((msg) => this.appendChatMessage(msg.sender, msg.text));
    }
  }

  handleChat(e) {
    const data = e.detail;
    this.appendChatMessage(data.sender, data.text);

    const msgObj = {
      id: Date.now(),
      sender: data.sender,
      text: data.text,
      time: Date.now(),
    };
    this.ctx.state.chatHistory.push(msgObj);
    if (this.ctx.state.chatHistory.length > 100)
      this.ctx.state.chatHistory.shift();

    if (this.ctx.root.network && this.ctx.root.network.socket) {
      this.ctx.root.network.socket.emit("broadcastData", {
        type: "new_chat",
        message: msgObj,
      });
    }
  }

  handleCheer(e) {
    const data = e.detail;
    const SessionsSvc = this.ctx.services.SessionsSvc;
    const isAudience =
      this.ctx.state.isSessionActive &&
      SessionsSvc.state.mode === "performance" &&
      SessionsSvc.state.singerId !== SessionsSvc.peer.id;

    if (!isAudience && this.ctx.root.network) {
      this.ctx.state.cheerQueue.push({
        nickname: data.sender,
        message: data.text,
      });
      this.ctx.root.network.processCheerQueue();
    }
  }

  toggleSessionModal(forceState = null) {
    const isOpening =
      forceState !== null ? forceState : !this.ctx.state.isSessionModalOpen;

    const wasHidden =
      this.ctx.dom.sessionModal.elm.classList.contains("hidden");

    this.ctx.state.isSessionModalOpen = isOpening;

    if (isOpening) {
      this.ctx.dom.sessionModal.classOff("hidden");
      this.renderSessionView(
        this.ctx.state.isSessionActive ? "active" : "select",
        null,
        !wasHidden,
      );
    } else {
      if (this._sessionViewTimer) {
        clearTimeout(this._sessionViewTimer);
        this._sessionViewTimer = null;
      }
      this.ctx.dom.sessionHeader.classOff("view-enter", "view-leave");
      this.ctx.dom.sessionContentArea.classOff("view-enter", "view-leave");
      this._lastRenderedEveryoneAudible = null;
      this.ctx.dom.sessionModal.classOn("hidden");
    }
  }

  reserveSongInSession(song) {
    this.ctx.services.SessionsSvc.requestSong(song);
    this.showReservationNotification(song);
  }

  showReservationNotification(song) {
    const codeSpan = song.code
      ? `<span class="info-bar-code">${String(song.code).padStart(6, "0")}</span>`
      : `<span class="info-bar-code is-youtube">YT</span>`;
    const fmt = this.ctx.root.library.getFormatInfo(song);
    const fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;

    this.ctx.modules.infoBar.showTemp(
      "RESERVED",
      `${codeSpan} ${fmtBadge} <span class="info-bar-title">${song.title}</span>`,
      4000,
    );
  }

  /**
   * Returns the navigation direction between two session views: 1 when moving
   * deeper into the session UI, -1 when moving back.
   * @param {string} fromView - The current view
   * @param {string} toView - The target view
   * @returns {number}
   */
  getSessionViewDirection(fromView, toView) {
    const order = {
      select: 0,
      "deeplink-prompt": 0,
      host: 1,
      join: 1,
      creating: 1.5,
      joining: 1.5,
      active: 2,
      leaderboard: 3,
      games: 3,
    };
    return (order[toView] ?? 0) >= (order[fromView] ?? 0) ? 1 : -1;
  }

  /**
   * Applies per-view sizing classes to the session box.
   * @param {string} view - The view being shown
   */
  _updateSessionBoxViewClass(view) {
    const box = this.ctx.dom.sessionBox;
    box.classOff("is-leaderboard-view");
    if (view === "leaderboard") box.classOn("is-leaderboard-view");
  }

  /**
   * Renders a session view, sliding the old view out and the new view in when
   * the target view differs from the current one.
   * @param {string} view - The view to render
   * @param {string|Object|null} extraData - View-specific data
   * @param {boolean} animate - Whether to animate the transition
   */
  renderSessionView(view, extraData = null, animate = true) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const previousView = state.sessionModalView;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const shouldAnimate =
      animate &&
      previousView !== view &&
      !dom.sessionModal.elm.classList.contains("hidden") &&
      !reduceMotion;

    if (this._sessionViewTimer) {
      clearTimeout(this._sessionViewTimer);
      this._sessionViewTimer = null;
    }

    if (!shouldAnimate) {
      dom.sessionHeader.classOff("view-enter", "view-leave");
      dom.sessionContentArea.classOff("view-enter", "view-leave");
      this._updateSessionBoxViewClass(view);
      state.sessionModalView = view;
      this._buildSessionView(view, extraData);
      return;
    }

    // Resize the box while the old view fades out so the incoming view is
    // already laid out in its final size.
    this._updateSessionBoxViewClass(view);

    dom.sessionBox.style({
      "--session-view-dir": String(
        this.getSessionViewDirection(previousView, view),
      ),
    });

    state.sessionModalView = view;

    dom.sessionHeader.classOff("view-enter").classOn("view-leave");
    dom.sessionContentArea.classOff("view-enter").classOn("view-leave");

    this._sessionViewTimer = setTimeout(() => {
      this._sessionViewTimer = null;
      dom.sessionHeader.classOff("view-leave");
      dom.sessionContentArea.classOff("view-leave");
      this._buildSessionView(view, extraData);

      void dom.sessionHeader.elm.offsetWidth;
      dom.sessionHeader.classOn("view-enter");
      dom.sessionContentArea.classOn("view-enter");
    }, 170);
  }

  /**
   * Builds the DOM for a session view.
   * @param {string} view - The view to render
   * @param {string|Object|null} extraData - View-specific data
   */
  _buildSessionView(view, extraData = null) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const Identity = this.ctx.services.Identity;
    const SessionsSvc = this.ctx.services.SessionsSvc;
    const root = this.ctx.root;

    state.sessionModalView = view;
    dom.sessionHeader.clear();
    dom.sessionContentArea.clear();

    if (view === "deeplink-prompt") {
      const targetRoomCode = typeof extraData === "string" ? extraData : "";

      new Html("h1").text("ENCORE SESSIONS").appendTo(dom.sessionHeader);
      new Html("p").text("You received an invite").appendTo(dom.sessionHeader);

      const container = new Html("div")
        .styleJs({
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: "1.5rem",
          maxWidth: "600px",
          margin: "auto 0",
        })
        .appendTo(dom.sessionContentArea);

      new Html("div")
        .classOn("session-tile-icon")
        .append(
          new Html("ion-icon")
            .attr({ name: "people" })
            .styleJs({ width: "70px", height: "70px", color: "#89cff0" }),
        )
        .appendTo(container);

      new Html("div")
        .classOn("session-tile-title")
        .text("JOIN REMOTE SESSION?")
        .appendTo(container);

      new Html("div")
        .classOn("session-tile-desc")
        .text(
          "You opened an invite link to join a Session. Click Continue to configure your profile and join the session.",
        )
        .appendTo(container);

      const btnRow = new Html("div")
        .classOn("session-btn-row")
        .styleJs({ width: "100%", marginTop: "1rem" })
        .appendTo(container);

      new Html("button")
        .classOn("session-btn", "danger")
        .text("CANCEL")
        .on("click", () => this.toggleSessionModal(false))
        .appendTo(btnRow);

      const continueBtn = new Html("button")
        .classOn("session-btn", "primary")
        .text("CONTINUE")
        .on("click", () => {
          if (state.isSessionActive) {
            this.performSessionDisconnect();
          }
          this.renderSessionView("join", targetRoomCode);
        })
        .appendTo(btnRow);

      setTimeout(() => continueBtn.elm.focus(), 50);
    } else if (view === "select") {
      new Html("h1").text("ENCORE SESSIONS").appendTo(dom.sessionHeader);
      new Html("p")
        .text("Sing with friends anywhere in the world.")
        .appendTo(dom.sessionHeader);

      const tileContainer = new Html("div")
        .classOn("session-tile-container")
        .appendTo(dom.sessionContentArea);

      const hostTile = new Html("div")
        .classOn("session-tile")
        .attr({ tabindex: "0" })
        .on("click", () => this.renderSessionView("host"))
        .appendTo(tileContainer);
      new Html("div")
        .classOn("session-tile-icon")
        .append(
          new Html("ion-icon")
            .attr({ name: "people" })
            .styleJs({ width: "50px", height: "50px" }),
        )
        .appendTo(hostTile);
      new Html("div")
        .classOn("session-tile-title")
        .text("HOST A SESSION")
        .appendTo(hostTile);
      new Html("div")
        .classOn("session-tile-desc")
        .text("Create a room and invite others")
        .appendTo(hostTile);

      const joinTile = new Html("div")
        .classOn("session-tile")
        .attr({ tabindex: "0" })
        .on("click", () => this.renderSessionView("join"))
        .appendTo(tileContainer);
      new Html("div")
        .classOn("session-tile-icon")
        .append(
          new Html("ion-icon")
            .attr({ name: "open" })
            .styleJs({ width: "50px", height: "50px" }),
        )
        .appendTo(joinTile);
      new Html("div")
        .classOn("session-tile-title")
        .text("JOIN A SESSION")
        .appendTo(joinTile);
      new Html("div")
        .classOn("session-tile-desc")
        .text("Enter a Room ID to start singing")
        .appendTo(joinTile);

      const btnRow = new Html("div")
        .classOn("session-btn-row")
        .styleJs({ marginTop: "2.5rem" })
        .appendTo(dom.sessionContentArea);
      new Html("button")
        .classOn("session-btn", "danger")
        .text("CANCEL")
        .on("click", () => this.toggleSessionModal(false))
        .appendTo(btnRow);
    } else if (view === "host" || view === "join") {
      const isHost = view === "host";
      new Html("h1")
        .text(isHost ? "HOST SESSION" : "JOIN SESSION")
        .appendTo(dom.sessionHeader);
      new Html("p")
        .text(
          isHost
            ? "Configure your profile and create a virtual room."
            : "Enter a Room ID and configure your profile.",
        )
        .appendTo(dom.sessionHeader);

      const profile = Identity.getProfile();
      const formLayout = new Html("div")
        .classOn("session-form-layout")
        .appendTo(dom.sessionContentArea);

      const avatarCol = new Html("div")
        .classOn("session-avatar-col")
        .appendTo(formLayout);
      const avatarImgWrapper = new Html("div")
        .classOn("session-avatar-wrapper")
        .appendTo(avatarCol);
      const avatarPreview = new Html("img")
        .classOn("session-avatar-preview")
        .appendTo(avatarImgWrapper);

      if (profile.avatar) avatarPreview.attr({ src: profile.avatar });

      const avatarBtn = new Html("button")
        .classOn("session-btn")
        .text(profile.avatar ? "Change Avatar" : "Upload Avatar")
        .appendTo(avatarCol);
      avatarBtn.on("click", () => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png, image/jpeg, image/webp";
        fileInput.onchange = async (e) => {
          const file = e.target.files[0];
          if (file) {
            try {
              const b64 = await Identity.processAvatarFile(file);
              await Identity.updateProfile(profile.nickname, b64);
              avatarPreview.attr({ src: b64 });
              avatarBtn.text("Avatar Selected!");
            } catch (err) {
              this.ctx.modules.infoBar.showTemp(
                "AVATAR",
                "Failed to process image.",
                3000,
              );
            }
          }
        };
        fileInput.click();
      });

      const inputCol = new Html("div")
        .classOn("session-input-col")
        .appendTo(formLayout);

      let roomInput = null;
      if (!isHost) {
        const initialRoomValue = typeof extraData === "string" ? extraData : "";
        roomInput = new Html("input")
          .classOn("session-input")
          .attr({ placeholder: "Room ID", value: initialRoomValue })
          .appendTo(inputCol);
      }

      const nickInput = new Html("input")
        .classOn("session-input")
        .attr({
          placeholder: "Your Nickname",
          maxlength: 15,
          value: profile.nickname,
        })
        .appendTo(inputCol);

      const btnRow = new Html("div")
        .classOn("session-btn-row")
        .styleJs({ width: "100%", marginTop: "1rem" })
        .appendTo(inputCol);
      new Html("button")
        .classOn("session-btn")
        .text("BACK")
        .on("click", () => this.renderSessionView("select"))
        .appendTo(btnRow);

      new Html("button")
        .classOn("session-btn", "primary")
        .text(isHost ? "CREATE" : "JOIN")
        .on("click", async () => {
          if (!isHost && !roomInput.getValue().trim()) return;

          const nickname = nickInput.getValue();
          const room = isHost ? null : roomInput.getValue().trim();

          this.renderSessionView(isHost ? "creating" : "joining");

          try {
            await Identity.updateProfile(nickname);
            const updatedProfile = Identity.getProfile();
            const supportedGames = root.games.getAvailableGames().map((g) => ({
              id: g.id,
              version: g.version,
            }));
            const sessionProfile = { ...updatedProfile, supportedGames };

            if (isHost) {
              const collisionFn = Identity.resolveCollision.bind(Identity);
              const roomId = await SessionsSvc.hostRoom(
                sessionProfile,
                collisionFn,
              );
              state.isSessionActive = true;
              state.isSessionHost = true;
              state.sessionRoomId = roomId;
              this.updateDiscordSessionRPC();
            } else {
              await SessionsSvc.joinRoom(room, sessionProfile);
              state.isSessionActive = true;
              state.isSessionHost = false;
              state.sessionRoomId = room;
              this.updateDiscordSessionRPC();
            }

            this.ctx.services.Forte.playSfx("/assets/audio/session_start.wav");

            if (this.ctx.services.Forte.setScoringForced) {
              this.ctx.services.Forte.setScoringForced(true);
            }
            if (this.ctx.services.Forte.setScoringEnabled) {
              this.ctx.services.Forte.setScoringEnabled(true);
            }

            state.sessionMode = "lounge";
            if (dom.sessionChatContainer)
              dom.sessionChatContainer.classOff("hidden");
            this.renderSessionView("active");
            root.ui.startLoungeBackground();
            this.ctx.modules.infoBar.showDefault();
          } catch (e) {
            this.ctx.modules.infoBar.showTemp(
              "SESSIONS",
              isHost
                ? "Failed to connect to signaling server."
                : "Failed to join room. Check ID.",
              3000,
            );
            this.renderSessionView("select");
          }
        })
        .appendTo(btnRow);

      setTimeout(() => {
        const modalEl = dom.sessionContentArea.elm;
        if (view === "select") {
          const firstTile = modalEl.querySelector(".session-tile");
          if (firstTile) firstTile.focus();
        } else if (view === "host") {
          const nickInp = modalEl.querySelector(
            'input[placeholder="Your Nickname"]',
          );
          if (nickInp) nickInp.focus();
        } else if (view === "join") {
          const roomInp = modalEl.querySelector('input[placeholder="Room ID"]');
          if (roomInp) {
            roomInp.focus();
            if (extraData) {
              const primaryBtn = modalEl.querySelector(".session-btn.primary");
              if (primaryBtn) primaryBtn.focus();
            }
          }
        } else if (view === "active") {
          const firstBtn = modalEl.querySelector("button");
          if (firstBtn) firstBtn.focus();
        }
      }, 100);
    } else if (view === "creating" || view === "joining") {
      const isHost = view === "creating";
      new Html("h1")
        .text(isHost ? "HOST SESSION" : "JOIN SESSION")
        .appendTo(dom.sessionHeader);
      new Html("p")
        .text(isHost ? "Creating your room..." : "Connecting to the room...")
        .appendTo(dom.sessionHeader);

      const loadingPane = new Html("div")
        .classOn("session-loading")
        .attr({ role: "status", "aria-live": "polite" })
        .appendTo(dom.sessionContentArea);

      new Html("img")
        .classOn("loading")
        .attr({
          src: "/assets/img/loading-spinner.svg",
          alt: "",
          draggable: "false",
        })
        .appendTo(loadingPane);

      new Html("h2")
        .classOn("session-loading-title")
        .text(isHost ? "CREATING..." : "JOINING...")
        .appendTo(loadingPane);

      new Html("p")
        .classOn("session-loading-desc")
        .text(
          isHost
            ? "Setting up your room. This will only take a moment."
            : "Connecting you to the session. This will only take a moment.",
        )
        .appendTo(loadingPane);
    } else if (view === "active") {
      new Html("h1")
        .text(state.isSessionHost ? "HOSTING SESSION" : "IN SESSION")
        .appendTo(dom.sessionHeader);
      new Html("p")
        .text("Invite your friends to sing along:")
        .appendTo(dom.sessionHeader);

      const layout = new Html("div")
        .classOn("session-active-layout")
        .appendTo(dom.sessionContentArea);
      const leftCol = new Html("div")
        .classOn("session-active-col")
        .appendTo(layout);

      const inviteCard = new Html("div")
        .classOn("session-invite-card")
        .appendTo(leftCol);

      const inviteHeader = new Html("div")
        .classOn("invite-header")
        .appendTo(inviteCard);

      const iconWrapper = new Html("div")
        .classOn("invite-icon-wrapper")
        .appendTo(inviteHeader);

      new Html("ion-icon")
        .attr({ name: "share-social-outline" })
        .appendTo(iconWrapper);

      const textGroup = new Html("div")
        .classOn("invite-text-group")
        .appendTo(inviteHeader);

      new Html("span")
        .classOn("invite-title")
        .text("SHARE THIS SESSION")
        .appendTo(textGroup);

      new Html("span")
        .classOn("invite-subtitle")
        .text("Share link or code to invite singers")
        .appendTo(textGroup);

      const actionsRow = new Html("div")
        .classOn("invite-actions-row")
        .appendTo(inviteCard);

      const copyLinkBtn = new Html("button")
        .classOn("invite-action-btn", "primary")
        .html(
          '<ion-icon name="link-outline" style="font-size: 1.2rem;"></ion-icon><span>COPY LINK</span>',
        )
        .on("click", () => {
          const shareUrl = `https://sessions.encorekaraoke.org/join/${state.sessionRoomId}`;
          navigator.clipboard
            .writeText(shareUrl)
            .then(() => {
              copyLinkBtn
                .html(
                  '<ion-icon name="checkmark-outline" style="font-size: 1.2rem;"></ion-icon><span>LINK COPIED!</span>',
                )
                .classOn("success");
              setTimeout(() => {
                copyLinkBtn
                  .html(
                    '<ion-icon name="link-outline" style="font-size: 1.2rem;"></ion-icon><span>COPY LINK</span>',
                  )
                  .classOff("success");
              }, 2000);
            })
            .catch(() => {
              this.ctx.modules.infoBar.showTemp(
                "ERROR",
                "Failed to copy link",
                3000,
              );
            });
        })
        .appendTo(actionsRow);

      const copyCodeBtn = new Html("button")
        .classOn("invite-action-btn", "secondary")
        .html(
          '<ion-icon name="code-working-outline" style="font-size: 1.2rem;"></ion-icon><span>COPY CODE</span>',
        )
        .on("click", () => {
          navigator.clipboard
            .writeText(state.sessionRoomId)
            .then(() => {
              copyCodeBtn
                .html(
                  '<ion-icon name="checkmark-outline" style="font-size: 1.2rem;"></ion-icon><span>CODE COPIED!</span>',
                )
                .classOn("success");
              setTimeout(() => {
                copyCodeBtn
                  .html(
                    '<ion-icon name="code-working-outline" style="font-size: 1.2rem;"></ion-icon><span>COPY CODE</span>',
                  )
                  .classOff("success");
              }, 2000);
            })
            .catch(() => {
              this.ctx.modules.infoBar.showTemp(
                "ERROR",
                "Failed to copy code",
                3000,
              );
            });
        })
        .appendTo(actionsRow);

      const audioSettingsCard = new Html("div")
        .classOn("session-settings-card")
        .appendTo(leftCol);

      const audibleRow = new Html("div")
        .classOn("session-toggle-row")
        .appendTo(audioSettingsCard);

      const audibleText = new Html("span")
        .classOn("session-toggle-text")
        .appendTo(audibleRow);

      new Html("span")
        .classOn("session-toggle-label")
        .text("EVERYONE AUDIBLE")
        .appendTo(audibleText);

      new Html("span")
        .classOn("session-toggle-desc")
        .text(
          state.isSessionHost
            ? "Hear all guests during performances and include them in recordings and broadcasts."
            : "Only the host can change this.",
        )
        .appendTo(audibleText);

      const audibleValue = Boolean(SessionsSvc.state.everyoneAudible);
      const audibleChanged =
        this._lastRenderedEveryoneAudible !== null &&
        this._lastRenderedEveryoneAudible !== audibleValue;
      this._lastRenderedEveryoneAudible = audibleValue;

      const audibleSwitch = new Html("button")
        .classOn("switch")
        .attr({
          type: "button",
          role: "switch",
          "aria-checked": audibleValue ? "true" : "false",
          "aria-label": "Everyone audible during performances",
        })
        .appendTo(audibleRow);

      if (audibleChanged) {
        audibleSwitch.classOn(
          audibleValue ? "switch-on-anim" : "switch-off-anim",
        );
      }

      if (state.isSessionHost) {
        audibleSwitch.on("click", () => {
          SessionsSvc.setEveryoneAudible(!SessionsSvc.state.everyoneAudible);
        });
      } else {
        audibleSwitch.attr({ disabled: "disabled" });
        audibleRow.classOn("is-readonly");
      }

      const recorder = this.ctx.modules.recorder;
      const recordingConflict =
        Boolean(recorder?.isRecording) && !recorder?.isSessionRecording;

      const recordCard = new Html("div")
        .classOn("session-settings-card")
        .appendTo(leftCol);

      const recordRow = new Html("div")
        .classOn("session-toggle-row")
        .appendTo(recordCard);

      const recordText = new Html("span")
        .classOn("session-toggle-text")
        .appendTo(recordRow);

      new Html("span")
        .classOn("session-toggle-label")
        .text("RECORD SESSION")
        .appendTo(recordText);

      const sessionRecording = Boolean(recorder?.isSessionRecording);

      new Html("span")
        .classOn("session-toggle-desc")
        .text(
          recordingConflict
            ? "A song recording is already in progress."
            : sessionRecording
              ? "Recording now. Stop to save the whole session."
              : "Capture performances and lounge breaks as one continuous recording.",
        )
        .appendTo(recordText);

      const recordSwitch = new Html("button")
        .classOn("switch")
        .attr({
          type: "button",
          role: "switch",
          "aria-checked": sessionRecording ? "true" : "false",
          "aria-label": "Record the whole session",
        })
        .appendTo(recordRow);

      if (recordingConflict) {
        recordSwitch.attr({ disabled: "disabled" });
        recordRow.classOn("is-readonly");
      } else {
        recordSwitch.on("click", () => {
          if (!recorder) return;
          if (recorder.isSessionRecording) {
            recorder.stop();
          } else if (recorder.startSessionRecording()) {
            this.syncSessionRecorderInfo(
              SessionsSvc.state.mode === "performance"
                ? SessionsSvc.state.nowPlaying
                : null,
            );
          }
          this.renderSessionView("active");
        });
      }

      const partList = new Html("div")
        .classOn("session-participants-list")
        .appendTo(leftCol);
      SessionsSvc.state.participants.forEach((p) => {
        const row = new Html("div")
          .classOn("session-participant-row")
          .appendTo(partList);
        const infoWrapper = new Html("div")
          .styleJs({ display: "flex", alignItems: "center", gap: "15px" })
          .appendTo(row);

        const avatar = new Html("img")
          .classOn("session-participant-avatar")
          .appendTo(infoWrapper);
        if (p.avatar) avatar.attr({ src: p.avatar });
        else avatar.styleJs({ background: "#444" });

        new Html("span")
          .text(`${p.nickname} ${p.isHost ? "(Host)" : ""}`)
          .styleJs({ fontSize: "1.2rem", fontWeight: "600" })
          .appendTo(infoWrapper);

        if (p.isRecording) {
          new Html("span")
            .classOn("session-recording-indicator")
            .attr({
              role: "img",
              title: "Recording",
              "aria-label": "Recording",
            })
            .append(
              new Html("ion-icon")
                .classOn("pulse-status")
                .attr({ name: "radio-button-on" }),
            )
            .appendTo(infoWrapper);
        }

        if (state.isSessionHost && !p.isHost) {
          new Html("button")
            .text("KICK")
            .classOn("session-btn", "danger", "session-kick-btn")
            .on("click", () => {
              SessionsSvc.kickParticipant(p.id);
              setTimeout(() => this.renderSessionView("active"), 200);
            })
            .appendTo(row);
        }
      });

      const rightCol = new Html("div")
        .classOn("session-active-col", "session-action-col")
        .appendTo(layout);

      const leaderboardTile = new Html("div")
        .classOn(
          "session-tile",
          "session-action-tile",
          "session-action-tile--leaderboard",
        )
        .attr({ tabindex: "0", role: "button" })
        .on("click", () => this.renderSessionView("leaderboard"))
        .appendTo(rightCol);
      new Html("div")
        .classOn("session-tile-icon")
        .append(
          new Html("ion-icon")
            .attr({ name: "trophy-outline" })
            .styleJs({ width: "46px", height: "46px" }),
        )
        .appendTo(leaderboardTile);
      new Html("div")
        .classOn("session-tile-title")
        .text("LEADERBOARD")
        .appendTo(leaderboardTile);
      new Html("div")
        .classOn("session-tile-desc")
        .text("See the top performances in this session")
        .appendTo(leaderboardTile);

      if (state.isSessionHost && SessionsSvc.state.mode === "lounge") {
        const minigamesTile = new Html("div")
          .classOn("session-tile", "session-action-tile")
          .attr({ tabindex: "0", role: "button" })
          .on("click", () => this.renderSessionView("games"))
          .appendTo(rightCol);
        new Html("div")
          .classOn("session-tile-icon")
          .append(
            new Html("ion-icon")
              .attr({ name: "game-controller-outline" })
              .styleJs({ width: "46px", height: "46px" }),
          )
          .appendTo(minigamesTile);
        new Html("div")
          .classOn("session-tile-title")
          .text("MINIGAMES")
          .appendTo(minigamesTile);
        new Html("div")
          .classOn("session-tile-desc")
          .text("Play games with everyone in the room")
          .appendTo(minigamesTile);
      }

      const btnRow = new Html("div")
        .classOn("session-btn-row")
        .styleJs({ marginTop: "auto", width: "100%" })
        .appendTo(leftCol);

      if (state.isSessionHost && SessionsSvc.state.mode === "performance") {
        new Html("button")
          .classOn("session-btn", "primary")
          .text("SKIP SONG")
          .on("click", () => {
            SessionsSvc.skipCurrentSong();
            this.toggleSessionModal(false);
          })
          .appendTo(btnRow);
      }

      new Html("button")
        .classOn("session-btn")
        .text("CLOSE MENU")
        .on("click", () => this.toggleSessionModal(false))
        .appendTo(btnRow);

      new Html("button")
        .classOn("session-btn", "danger")
        .text("LEAVE")
        .on("click", () => {
          SessionsSvc.leaveRoom();
          this.performSessionDisconnect();
        })
        .appendTo(btnRow);
    } else if (view === "games") {
      new Html("h1").text("SESSION MINIGAMES").appendTo(dom.sessionHeader);
      new Html("p")
        .text("Configure and launch games for the room.")
        .appendTo(dom.sessionHeader);

      const layout = new Html("div")
        .classOn("mixer-layout")
        .styleJs({ width: "100%", height: "100%" })
        .appendTo(dom.sessionContentArea);

      const listPanel = new Html("div")
        .classOn("mixer-list-panel")
        .styleJs({ padding: "1rem" })
        .appendTo(layout);
      const detailsPanel = new Html("div")
        .classOn("mixer-controls-panel")
        .styleJs({
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
        })
        .appendTo(layout);

      const games = root.games.getAvailableGames();

      if (games.length === 0) {
        new Html("p")
          .text("No games currently loaded.")
          .styleJs({ padding: "2rem", opacity: 0.5 })
          .appendTo(listPanel);
      } else {
        let activeGame = games[0];

        const renderDetails = () => {
          detailsPanel.clear();
          new Html("h2")
            .classOn("mixer-controls-title")
            .text(activeGame.name)
            .appendTo(detailsPanel);

          const settingsContainer = new Html("div")
            .styleJs({
              flex: "1",
              overflowY: "auto",
              marginBottom: "1rem",
              paddingRight: "1rem",
            })
            .appendTo(detailsPanel);

          if (typeof activeGame.instance.renderSettings === "function") {
            activeGame.instance.renderSettings(settingsContainer);
          } else {
            new Html("p")
              .text("No configuration needed.")
              .styleJs({ opacity: 0.5 })
              .appendTo(settingsContainer);
          }

          const participants = SessionsSvc.state.participants;
          const requiredVersion = activeGame.version;
          let missingUsers = [];

          participants.forEach((p) => {
            const pGame = (p.supportedGames || []).find(
              (g) => g.id === activeGame.id,
            );
            if (!pGame || pGame.version !== requiredVersion) {
              missingUsers.push(p.nickname);
            }
          });

          const isPlayable = missingUsers.length === 0;

          if (!isPlayable) {
            new Html("div")
              .styleJs({
                background: "rgba(255, 85, 85, 0.15)",
                border: "1px solid #ff5555",
                padding: "1rem",
                borderRadius: "8px",
                color: "#ff5555",
                marginBottom: "1rem",
                fontSize: "0.95rem",
              })
              .text(
                `Version Mismatch (Requires v${requiredVersion}). Unavailable for: ${missingUsers.join(", ")}`,
              )
              .appendTo(detailsPanel);
          }

          const btnRow = new Html("div")
            .classOn("session-btn-row")
            .styleJs({ marginTop: "auto", width: "100%" })
            .appendTo(detailsPanel);

          new Html("button")
            .classOn("session-btn")
            .text("BACK")
            .on("click", () => this.renderSessionView("active"))
            .appendTo(btnRow);

          const startBtn = new Html("button")
            .classOn("session-btn", "primary")
            .text("START GAME")
            .on("click", () => {
              if (isPlayable) activeGame.instance.onHostTrigger();
            })
            .appendTo(btnRow);

          if (!isPlayable) {
            startBtn.styleJs({ opacity: "0.4", cursor: "not-allowed" });
          }
        };

        const renderList = () => {
          listPanel.clear();
          games.forEach((game) => {
            const item = new Html("div")
              .classOn("mixer-item")
              .attr({ tabindex: "0", role: "button" })
              .text(game.name)
              .appendTo(listPanel);
            if (activeGame.id === game.id) item.classOn("mixer-item--active");
            item.on("click", () => {
              activeGame = game;
              renderList();
              renderDetails();
              const selected = listPanel.elm.querySelector(
                ".mixer-item--active",
              );
              if (selected) selected.focus();
            });
          });
        };

        renderList();
        renderDetails();
      }
    } else if (view === "leaderboard") {
      new Html("h1").text("SESSION LEADERBOARD").appendTo(dom.sessionHeader);
      new Html("p")
        .text("The top performances in this session.")
        .appendTo(dom.sessionHeader);

      const leaderboardView = new Html("div")
        .classOn("session-leaderboard-view")
        .appendTo(dom.sessionContentArea);

      const leaderboardPanel = new Html("div")
        .classOn("session-leaderboard-panel")
        .appendTo(leaderboardView);

      new Html("h2")
        .classOn("session-leaderboard-title")
        .text("TOP PERFORMANCES")
        .appendTo(leaderboardPanel);

      const leaderboardList = new Html("div")
        .classOn("session-leaderboard-list")
        .appendTo(leaderboardPanel);

      this.renderLeaderboardEntries(leaderboardList);

      const btnRow = new Html("div")
        .classOn("session-btn-row")
        .styleJs({ width: "100%", flexShrink: "0" })
        .appendTo(leaderboardView);

      new Html("button")
        .classOn("session-btn")
        .html(
          '<ion-icon name="arrow-back-outline" style="font-size: 1.2rem; vertical-align: middle; margin-right: 0.5rem;"></ion-icon><span>BACK</span>',
        )
        .on("click", () => this.renderSessionView("active"))
        .appendTo(btnRow);
    }
  }

  /**
   * Renders the session leaderboard entries into the given container.
   * @param {Html} container - The leaderboard list element
   */
  renderLeaderboardEntries(container) {
    const SessionsSvc = this.ctx.services.SessionsSvc;
    const topScores = SessionsSvc.state.leaderboard || [];

    if (topScores.length === 0) {
      new Html("div")
        .classOn("session-leaderboard-empty")
        .text("No scores yet. Sing a song to get on the board!")
        .appendTo(container);
      return;
    }

    topScores.slice(0, 10).forEach((entry, index) => {
      const row = new Html("div")
        .classOn("session-leaderboard-row")
        .appendTo(container);
      new Html("div")
        .classOn("lb-rank")
        .text(`#${index + 1}`)
        .appendTo(row);
      const avatar = new Html("img").classOn("lb-avatar").appendTo(row);
      if (entry.avatar) avatar.attr({ src: entry.avatar });
      else avatar.styleJs({ background: "#444" });

      const details = new Html("div").classOn("lb-details").appendTo(row);
      new Html("div")
        .classOn("lb-name")
        .text(entry.singerName)
        .appendTo(details);
      new Html("div")
        .classOn("lb-song")
        .text(entry.songTitle)
        .appendTo(details);
      new Html("div")
        .classOn("lb-score")
        .text(Math.floor(entry.score))
        .appendTo(row);
    });
  }

  submitSessionChat() {
    const val = this.ctx.dom.sessionChatInput.getValue().trim();
    if (!val) {
      this.ctx.dom.sessionChatInput.elm.blur();
      return;
    }

    const SessionsSvc = this.ctx.services.SessionsSvc;
    const Identity = this.ctx.services.Identity;

    const myPeerId = SessionsSvc.peer.id;
    const me = SessionsSvc.state.participants.find((p) => p.id === myPeerId);
    const sender = me
      ? me.nickname
      : Identity.getProfile().nickname || "Singer";

    if (this.ctx.state.chatInputMode === "cheer") {
      SessionsSvc.broadcastCheer(sender, val.substring(0, 50));
      this.ctx.dom.sessionChatInput.elm.value = "";
      this.ctx.dom.sessionChatInput.elm.blur();
    } else {
      SessionsSvc.broadcastChat(sender, val.substring(0, 200));
      this.ctx.dom.sessionChatInput.elm.value = "";
    }
  }

  appendChatMessage(sender, text) {
    const SessionsSvc = this.ctx.services.SessionsSvc;
    const Identity = this.ctx.services.Identity;

    const myPeerId =
      SessionsSvc && SessionsSvc.peer ? SessionsSvc.peer.id : null;
    const me =
      SessionsSvc && SessionsSvc.state
        ? SessionsSvc.state.participants.find((p) => p.id === myPeerId)
        : null;
    const myName = me
      ? me.nickname
      : Identity.getProfile().nickname || "Singer";

    let avatarUrl = "";
    if (SessionsSvc && SessionsSvc.state) {
      const p = SessionsSvc.state.participants.find(
        (part) => part.nickname === sender,
      );
      if (p && p.avatar) avatarUrl = p.avatar;
    }
    if (!avatarUrl && sender === myName) {
      avatarUrl = Identity.getProfile().avatar || "";
    }

    const isMe = sender === myName;
    const msgWrapper = new Html("div")
      .classOn("chat-message-wrapper")
      .appendTo(this.ctx.dom.sessionChatMessages);

    if (isMe) msgWrapper.classOn("is-me");

    if (!isMe) {
      if (avatarUrl) {
        new Html("img")
          .classOn("chat-avatar")
          .attr({ src: avatarUrl })
          .appendTo(msgWrapper);
      } else {
        new Html("div").classOn("chat-avatar", "fallback").appendTo(msgWrapper);
      }
    }

    const msgEl = new Html("div").classOn("chat-message").appendTo(msgWrapper);
    if (isMe) msgEl.classOn("is-me");

    new Html("span")
      .classOn("chat-sender")
      .text(sender + ": ")
      .appendTo(msgEl);
    new Html("span").classOn("chat-text").text(text).appendTo(msgEl);

    if (isMe) {
      if (avatarUrl) {
        new Html("img")
          .classOn("chat-avatar")
          .attr({ src: avatarUrl })
          .appendTo(msgWrapper);
      } else {
        new Html("div").classOn("chat-avatar", "fallback").appendTo(msgWrapper);
      }
    }

    const container = this.ctx.dom.sessionChatMessages.elm;
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Returns whether an element is currently laid out and focusable.
   * @param {HTMLElement} el - The element to check
   * @returns {boolean}
   */
  _isSessionFocusableVisible(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Collects every focusable control in the current session view.
   * @returns {HTMLElement[]}
   */
  _getSessionFocusables() {
    const modalEl = this.ctx.dom.sessionContentArea.elm;
    return Array.from(
      modalEl.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), .session-tile, .mixer-item",
      ),
    ).filter((el) => this._isSessionFocusableVisible(el));
  }

  /**
   * Measures the gap between two intervals on the same axis.
   * @param {number} minA - Start of the first interval
   * @param {number} maxA - End of the first interval
   * @param {number} minB - Start of the second interval
   * @param {number} maxB - End of the second interval
   * @returns {number}
   */
  _getIntervalGap(minA, maxA, minB, maxB) {
    if (maxB < minA) return minA - maxB;
    if (maxA < minB) return minB - maxA;
    return 0;
  }

  /**
   * Finds the next focusable element in a direction based on the rendered
   * layout. Candidates are ranked by travel distance along the pressed axis,
   * then by how well they line up on the perpendicular axis.
   * @param {HTMLElement[]} focusables - Focusable elements in the view
   * @param {HTMLElement} activeEl - Currently focused element
   * @param {string} key - The arrow key that was pressed
   * @returns {HTMLElement|null}
   */
  _getSessionDirectionalTarget(focusables, activeEl, key) {
    const direction = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    }[key];

    if (!direction) return null;
    if (!activeEl || !focusables.includes(activeEl)) {
      return focusables[0] || null;
    }

    const source = activeEl.getBoundingClientRect();
    const sourceCx = source.left + source.width / 2;
    const sourceCy = source.top + source.height / 2;
    let best = null;
    let bestScore = Infinity;

    for (const el of focusables) {
      if (el === activeEl) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const isVertical = direction === "up" || direction === "down";

      if (isVertical) {
        if (direction === "up" ? cy >= sourceCy : cy <= sourceCy) continue;
      } else if (direction === "left" ? cx >= sourceCx : cx <= sourceCx) {
        continue;
      }

      const along = Math.max(
        0,
        isVertical
          ? direction === "up"
            ? source.top - rect.bottom
            : rect.top - source.bottom
          : direction === "left"
            ? source.left - rect.right
            : rect.left - source.right,
      );

      // Keep navigation within the same visual row/column when possible by
      // penalising elements that do not overlap on the perpendicular axis.
      const crossGap = isVertical
        ? this._getIntervalGap(source.left, source.right, rect.left, rect.right)
        : this._getIntervalGap(
            source.top,
            source.bottom,
            rect.top,
            rect.bottom,
          );
      const crossCenterDelta = Math.abs(
        isVertical ? cx - sourceCx : cy - sourceCy,
      );

      const score = along + crossGap * 3 + crossCenterDelta * 0.05;
      if (score < bestScore - 0.001) {
        best = el;
        bestScore = score;
      }
    }

    return best;
  }

  handleKeyDown(e) {
    const dom = this.ctx.dom;
    const state = this.ctx.state;

    if (e.key === "Escape") {
      e.preventDefault();
      if (
        (state.sessionModalView === "host" ||
          state.sessionModalView === "join") &&
        !state.isSessionActive
      ) {
        this.renderSessionView("select");
      } else if (state.sessionModalView === "deeplink-prompt") {
        this.toggleSessionModal(false);
      } else if (
        state.sessionModalView === "games" ||
        state.sessionModalView === "leaderboard"
      ) {
        this.renderSessionView("active");
      } else {
        this.toggleSessionModal(false);
      }
      return;
    }

    const modalEl = dom.sessionContentArea.elm;
    const focusables = this._getSessionFocusables();
    if (!focusables.length) return;

    const activeEl = document.activeElement;
    const isInput = activeEl && activeEl.tagName === "INPUT";
    const isCheckbox = isInput && activeEl.type === "checkbox";

    if (e.key === "Enter") {
      if (isCheckbox) {
        e.preventDefault();
        activeEl.click();
      } else if (
        activeEl &&
        (activeEl.classList.contains("session-tile") ||
          activeEl.classList.contains("mixer-item"))
      ) {
        e.preventDefault();
        activeEl.click();
      } else if (isInput) {
        e.preventDefault();
        const primaryBtn = modalEl.querySelector(".session-btn.primary");
        if (primaryBtn) primaryBtn.click();
      }
      return;
    }

    // Left/right inside a text field move the caret instead of focus.
    if (isInput && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const currentIndex = focusables.indexOf(activeEl);
      let nextIndex = currentIndex + (e.shiftKey ? -1 : 1);
      if (nextIndex >= focusables.length) nextIndex = 0;
      if (nextIndex < 0) nextIndex = focusables.length - 1;
      this.playNavSfx("nav");
      focusables[nextIndex].focus();
      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }

    e.preventDefault();
    const target = this._getSessionDirectionalTarget(
      focusables,
      activeEl,
      e.key,
    );
    if (!target) {
      this.playNavSfx("out_of_bounds");
      return;
    }

    this.playNavSfx("nav");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  destroy() {
    if (this._sessionViewTimer) {
      clearTimeout(this._sessionViewTimer);
      this._sessionViewTimer = null;
    }
    document.removeEventListener(
      "Encore.Sessions.StateUpdate",
      this.handleStateUpdate,
    );
    document.removeEventListener(
      "Encore.Sessions.RemoteScore",
      this.handleRemoteScore,
    );
    document.removeEventListener(
      "Encore.Sessions.SkipScore",
      this.handleSkipScore,
    );
    document.removeEventListener(
      "Encore.Sessions.RemoteStream",
      this.handleRemoteStream,
    );
    document.removeEventListener(
      "Encore.Sessions.LoungeStream",
      this.handleLoungeStream,
    );
    document.removeEventListener(
      "Encore.Sessions.ClearStreams",
      this.handleClearStreams,
    );
    document.removeEventListener(
      "Encore.Sessions.LyricsData",
      this.handleSessionLyricsData,
    );
    document.removeEventListener(
      "Encore.Sessions.LyricsTime",
      this.handleSessionLyricsTime,
    );
    document.removeEventListener(
      "Encore.Sessions.LyricsRequest",
      this.handleSessionLyricsRequest,
    );
    document.removeEventListener(
      "Encore.Sessions.TrackInfo",
      this.handleSessionTrackInfo,
    );
    document.removeEventListener(
      "Encore.Sessions.PeerDisconnected",
      this.handlePeerDisconnected,
    );
    document.removeEventListener(
      "Encore.Sessions.HostDisconnected",
      this.handleHostDisconnected,
    );
    document.removeEventListener("Encore.Sessions.Kicked", this.handleKicked);
    document.removeEventListener(
      "Encore.Sessions.ForceStop",
      this.handleForceStop,
    );
    document.removeEventListener(
      "Encore.Recorder.SessionStateChange",
      this.handleSessionRecordingStateChange,
    );
    document.removeEventListener(
      "Encore.Sessions.ChatHistorySync",
      this.handleChatHistorySync,
    );
    document.removeEventListener("Encore.Sessions.Chat", this.handleChat);
    document.removeEventListener("Encore.Sessions.Cheer", this.handleCheer);
    document.removeEventListener(
      "Encore.Playback.TrackInfo",
      this.handleLocalTrackInfo,
    );
    document.removeEventListener(
      "Encore.Forte.Playback.TimeUpdate",
      this.handleLocalPlaybackTime,
    );
    document.removeEventListener(
      "Encore.Sessions.PianoRollData",
      this.handleSessionPianoRollData,
    );
    document.removeEventListener(
      "Encore.Sessions.PianoRollNotes",
      this.handleSessionPianoRollNotes,
    );
    document.removeEventListener(
      "Encore.Sessions.PianoRollState",
      this.handleSessionPianoRollState,
    );
  }
}
