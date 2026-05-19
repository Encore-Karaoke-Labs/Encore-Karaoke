import Html from "../../../libs/html.js";

export default class PlaybackManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    this.ytWarningTimer = null;
    this.ytAutoSkipTimer = null;

    this.boundPlaybackUpdate = this.handlePlaybackUpdate.bind(this);
    this.boundTempoUpdate = null;
    this.boundScoreUpdate = null;
    this.boundDuetEvent = null;

    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      this.boundPlaybackUpdate,
    );
  }

  parseDuration(durationStr) {
    if (!durationStr) return 0;
    const parts = durationStr.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  truncateTitleIfNeeded(title) {
    if (!title) return title;
    const words = title.trim().split(/\s+/);
    if (words.length > 8) {
      return words.slice(0, 8).join(" ") + "...";
    }
    return title;
  }

  scheduleYoutubeSkip(seconds) {
    this.clearYoutubeTimers();

    const totalMs = (seconds + 5) * 1000;
    const warningDuration = 10 * 1000;
    const warnAt = Math.max(0, totalMs - warningDuration);

    console.log(
      `[Encore] Scheduling YT Skip in ${totalMs / 1000}s (Warn at ${warnAt / 1000}s)`,
    );

    this.ytWarningTimer = setTimeout(() => {
      this.ctx.state.isYtSkipWarningActive = true;
      this.ctx.modules.infoBar.showTemp(
        "AUTO SKIP",
        "Song ending in 10s. Press <span class='key-badge'>UP</span> to extend (+30s).",
        10000,
      );
    }, warnAt);

    this.ytAutoSkipTimer = setTimeout(() => {
      console.log("[Encore] Auto-skipping YouTube track.");
      this.stopPlayer();
      this.ctx.modules.bgv.start();
      this.transitionAfterSong();
    }, totalMs);
  }

  extendYoutubeSkip() {
    if (!this.ctx.state.isYtSkipWarningActive) return;

    this.clearYoutubeTimers();
    this.ctx.state.isYtSkipWarningActive = false;
    this.scheduleYoutubeSkip(35);
    this.ctx.modules.infoBar.showTemp(
      "EXTENDED",
      "Time extended by 30 seconds.",
      3000,
    );
  }

  clearYoutubeTimers() {
    if (this.ytAutoSkipTimer) clearTimeout(this.ytAutoSkipTimer);
    if (this.ytWarningTimer) clearTimeout(this.ytWarningTimer);
    this.ytAutoSkipTimer = null;
    this.ytWarningTimer = null;
    this.ctx.state.isYtSkipWarningActive = false;
  }

  /**
   * Begins loading and processing of a track object, transitioning into playback mode.
   *
   * @param {Object} song - The target metadata object describing the media track.
   */
  async startPlayer(song) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const modules = this.ctx.modules;
    const root = this.ctx.root;
    const Forte = this.ctx.services.Forte;

    state.isTransitioning = true;
    modules.recorder.setSongInfo(song);
    this.cleanupPlayerEvents();

    if (root.lyrics) root.lyrics.reset();
    if (root.input) root.input.currentDrumPresetIndex = -1;
    if (root.input) root.input.currentGuideMelodyIndex = 2;

    dom.countdownDisplay.classOff("visible").text("");
    modules.scoreHud.hide();
    dom.introCard.classOff("visible");
    dom.introMeta.clear();
    dom.interludeOverlay.classOff("visible");
    state.isInterludeActive = false;
    dom.formatIndicator.styleJs({ opacity: "0" });

    state.currentSongIsMultiplexed = false;
    state.isDuet = false;

    this.boundDuetEvent = () => {
      state.isDuet = true;
      if (root.lyrics) root.lyrics.requestCanvasCacheUpdate = true;
    };
    document.addEventListener(
      "CherryTree.Forte.Playback.DuetDetected",
      this.boundDuetEvent,
    );

    state.currentSongIsYouTube = song.path.startsWith("yt://");
    state.currentSongIsMV = !!song.videoPath;
    state.reservationNumber = "";

    root.ui.setMode("player");
    if (state.currentSongIsYouTube)
      this.ctx.wrapper.classOn("mode-player-youtube");

    window.desktopIntegration.ipc.send("setRPC", {
      details: song.title,
      state: song.artist,
    });

    if (root.network && root.network.socket) {
      root.network.socket.emit("broadcastData", {
        type: "now_playing",
        song: {
          ...song,
          isYouTube: state.currentSongIsYouTube,
          isMV: state.currentSongIsMV,
        },
      });
    }

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
      });
    }

    if (state.currentSongIsYouTube) {
      Forte.stopTrack();
      Forte.togglePianoRollVisibility(false);

      try {
        state.windowsVolume = await window.volume.getVolume();
      } catch (e) {}
      let maxVolume = state.windowsVolume;
      try {
        window.volume.setVolume(state.volume * maxVolume);
      } catch (e) {}

      modules.bgv.stop();
      dom.bgvContainer.classOn("hidden");
      dom.ytContainer.classOff("hidden");
      dom.ytIframe.attr({
        src: `https://cdpn.io/pen/debug/oNPzxKo?v=${song.path.substring(5)}&autoplay=1`,
        allow:
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      });

      if (!song.isLive && song.durationText) {
        const seconds = this.parseDuration(song.durationText);
        if (seconds > 0) this.scheduleYoutubeSkip(seconds);
      }

      dom.lyricsCanvas.classOn("hidden");
      dom.formatIndicator.styleJs({
        backgroundImage: 'url("/assets/img/icons/yt.png")',
        opacity: "1",
      });
      state.isTransitioning = false;
    } else {
      let mvPlayer = null;
      dom.lyricsCanvas.styleJs({ opacity: "0" }).classOff("hidden");

      if (state.currentSongIsMV) {
        const videoUrl = new URL(
          `http://127.0.0.1:${state.actualPort}/getFile`,
        );
        videoUrl.searchParams.append("path", song.videoPath);
        mvPlayer = await modules.bgv.playSingleVideo(videoUrl.href);
      } else {
        modules.bgv.resumePlaylist();
      }

      dom.bgvContainer.classOff("hidden");
      dom.ytContainer.classOn("hidden");
      dom.ytIframe.attr({ src: "" });

      const trackUrl = new URL(`http://127.0.0.1:${state.actualPort}/getFile`);
      trackUrl.searchParams.append("path", song.path);
      await Forte.loadTrack(trackUrl.href);

      const pbState = Forte.getPlaybackState();
      state.currentSongIsMultiplexed = pbState.isMultiplexed;
      state.currentSongIsMIDI = pbState.isMidi;

      if (
        state.currentSongIsMultiplexed ||
        (state.currentSongIsMIDI && pbState.hasGuideNotes)
      ) {
        Forte.togglePianoRollVisibility(true);
      } else {
        Forte.togglePianoRollVisibility(false);
      }

      let icon = state.currentSongIsMV
        ? "mtv.png"
        : state.currentSongIsMultiplexed
          ? "mp.png"
          : pbState.isMidi
            ? "midi.png"
            : "rs.png";
      dom.formatIndicator.styleJs({
        backgroundImage: `url("/assets/img/icons/${icon}")`,
        opacity: "1",
      });

      if (!state.currentSongIsYouTube) {
        modules.scoreHud.show(0);
        Forte.togglePianoRollVisibility(
          state.currentSongIsMultiplexed || state.currentSongIsMIDI,
        );
      }

      dom.introTitle.text(this.truncateTitleIfNeeded(song.title));
      dom.introArtist.text(song.artist);
      dom.introCard.classOn("visible");
      dom.lyricsCanvas.styleJs({ opacity: "1" });

      state.currentBpm = pbState.midiInfo
        ? pbState.midiInfo.initialBpm || 120
        : 120;
      this.boundTempoUpdate = (e) => {
        state.currentBpm = e.detail.bpm;
      };
      document.addEventListener(
        "CherryTree.Forte.Playback.TempoEvent",
        this.boundTempoUpdate,
      );

      if (root.lyrics) {
        await root.lyrics.setupLyrics(song, pbState);
        root.lyrics.setupTimeUpdate(mvPlayer);
      }

      if (!state.currentSongIsYouTube) {
        this.boundScoreUpdate = (e) =>
          modules.scoreHud.show(e.detail.finalScore);
        document.addEventListener(
          "CherryTree.Forte.Scoring.Update",
          this.boundScoreUpdate,
        );
      }

      setTimeout(() => {
        if (state.mode !== "player") {
          state.isTransitioning = false;
          return;
        }
        dom.introCard.classOff("visible");
        if (mvPlayer) mvPlayer.play().catch(console.error);
        Forte.playTrack();
        state.isTransitioning = false;
        setTimeout(() => {
          if (state.scoreSkipped) state.scoreSkipped = false;
        }, 5000);
      }, 2500);
    }
  }

  stopPlayer() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const modules = this.ctx.modules;

    modules.recorder.clearSongInfo();
    dom.introCard.classOff("visible");
    dom.ytContainer.classOn("hidden");
    dom.ytIframe.attr({ src: "" });
    this.clearYoutubeTimers();
    dom.bgvContainer.classOff("hidden");
    this.ctx.services.Forte.stopTrack();
    this.cleanupPlayerEvents();
    dom.countdownDisplay.classOff("visible").text("");
    dom.formatIndicator.styleJs({ opacity: "0" });

    state.isInterludeActive = false;
    if (dom.interludeOverlay) dom.interludeOverlay.classOff("visible");
    if (dom.lyricsCanvas)
      dom.lyricsCanvas.styleJs({ opacity: "1", pointerEvents: "all" });

    if (state.currentSongIsYouTube) {
      try {
        window.volume.setVolume(state.windowsVolume);
      } catch (e) {}
    }

    state.currentSongIsMV = false;
    state.currentSongIsYouTube = false;
    state.currentSongIsMultiplexed = false;

    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  }

  cleanupPlayerEvents() {
    if (this.ctx.root.lyrics) this.ctx.root.lyrics.cleanupEvents();

    if (this.boundScoreUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Scoring.Update",
        this.boundScoreUpdate,
      );
    if (this.boundTempoUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TempoEvent",
        this.boundTempoUpdate,
      );
    if (this.boundDuetEvent)
      document.removeEventListener(
        "CherryTree.Forte.Playback.DuetDetected",
        this.boundDuetEvent,
      );

    this.boundScoreUpdate = null;
    this.boundTempoUpdate = null;
    this.boundDuetEvent = null;
  }

  async handlePlaybackUpdate(e) {
    const { status } = e.detail || {};
    const state = this.ctx.state;

    if (
      state.mode.startsWith("player") &&
      state.lastPlaybackStatus === "playing" &&
      status === "stopped"
    ) {
      if (state.isTransitioning) return;
      state.isTransitioning = true;
      this.ctx.services.Forte.togglePianoRollVisibility(false);

      if (this.ctx.modules.recorder.isRecording)
        this.ctx.modules.recorder.stop();

      const wasLocalAudio = !state.currentSongIsYouTube;
      const wasMV = state.currentSongIsMV;
      this.ctx.modules.scoreHud.hide();

      if (wasMV) await this.ctx.modules.bgv.resumePlaylist();
      this.stopPlayer();

      if (wasLocalAudio) {
        const finalScore = this.ctx.services.Forte.getPlaybackState().score;

        if (
          state.isSessionActive &&
          this.ctx.services.SessionsSvc.state.mode === "performance" &&
          this.ctx.services.SessionsSvc.state.singerId ===
            this.ctx.services.SessionsSvc.peer.id
        ) {
          const songTitle =
            this.ctx.services.SessionsSvc.state.nowPlaying?.title ||
            "Unknown Song";
          state.currentScoreEntryId = this.ctx.services.SessionsSvc.submitScore(
            finalScore.finalScore,
            songTitle,
          );
        }

        await this.showPostSongScreen(finalScore);
        state.currentScoreEntryId = null;
      }
      this.transitionAfterSong();
    }
    state.lastPlaybackStatus = status;
  }

  transitionAfterSong() {
    const state = this.ctx.state;
    const root = this.ctx.root;

    if (state.isSessionActive) {
      if (
        this.ctx.services.SessionsSvc.state.mode === "performance" &&
        this.ctx.services.SessionsSvc.state.singerId ===
          this.ctx.services.SessionsSvc.peer.id
      ) {
        this.ctx.modules.recorder.stopBroadcastStream();
        if (this.ctx.services.SessionsSvc.isHost) {
          this.ctx.services.SessionsSvc.advanceQueue();
        } else {
          const hostConn = this.ctx.services.SessionsSvc.connections.get(
            this.ctx.services.SessionsSvc.roomId,
          );
          if (hostConn && hostConn.open) hostConn.send({ type: "song_ended" });
        }
      }
      setTimeout(() => {
        state.isTransitioning = false;
      }, 1500);
      return;
    }

    if (state.reservationQueue.length > 0) {
      const next = state.reservationQueue.shift();
      this.ctx.modules.infoBar.showDefault();
      setTimeout(() => this.startPlayer(next), 250);
    } else {
      root.ui.setMode("menu");
      window.desktopIntegration.ipc.send("setRPC", {
        details: `Browsing ${state.songList.length} Songs...`,
        state: `Main Menu`,
      });
      setTimeout(() => {
        if (!state.reservationQueue.length) state.isTransitioning = false;
      }, 1500);
    }
  }

  async showPostSongScreen(scoreData) {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const Forte = this.ctx.services.Forte;
    const root = this.ctx.root;

    state.isScoreScreenActive = true;
    dom.postSongScreen.classOff("show-leaderboard");

    if (state.isSessionActive) {
      const singerName = state.remoteScoreEntry
        ? state.remoteScoreEntry.singerName
        : this.ctx.services.Identity.getProfile().nickname;
      dom.scoreTitleText.text(`${singerName.toUpperCase()}'S SCORE`);
      dom.scoreSessionLeaderboard.clear();
      dom.scoreSessionLeaderboard.classOn("hidden");

      new Html("h3")
        .text("TOP PERFORMANCES")
        .appendTo(dom.scoreSessionLeaderboard);
      const lbGrid = new Html("div")
        .classOn("score-lb-grid")
        .appendTo(dom.scoreSessionLeaderboard);
      const topScores = this.ctx.services.SessionsSvc.state.leaderboard || [];

      topScores.slice(0, 5).forEach((entry, index) => {
        const row = new Html("div").classOn("score-lb-row").appendTo(lbGrid);
        if (entry.id === state.currentScoreEntryId)
          row.classOn("is-current-singer");

        new Html("span")
          .classOn("score-lb-rank")
          .text(`#${index + 1}`)
          .appendTo(row);
        const avatar = new Html("img").classOn("score-lb-avatar").appendTo(row);
        if (entry.avatar) avatar.attr({ src: entry.avatar });
        else avatar.styleJs({ background: "#444" });

        const details = new Html("div")
          .classOn("score-lb-details")
          .appendTo(row);
        new Html("span")
          .classOn("score-lb-name")
          .text(entry.singerName)
          .appendTo(details);
        new Html("span")
          .classOn("score-lb-song")
          .text(entry.songTitle)
          .appendTo(details);
        new Html("span")
          .classOn("score-lb-score")
          .text(Math.floor(entry.score))
          .appendTo(row);
      });
    } else {
      dom.scoreTitleText.text("YOUR SCORE");
      dom.scoreSessionLeaderboard.classOn("hidden");
    }

    dom.rankDisplay
      .text("")
      .styleJs({ transform: "scale(0.8)", opacity: "0", color: "#fff" });
    dom.finalScoreDisplay.text("0");
    dom.postSongScreen.styleJs({ opacity: "1", pointerEvents: "all" });

    const s = Math.floor(scoreData.finalScore);
    let rank = "Good",
      rankColor = "#aed581";
    if (s == 100) {
      rank = "HOW DID YOU PULL THAT OFF";
      rankColor = "#00e676";
    } else if (s >= 98) {
      rank = "WHAT";
      rankColor = "#00e676";
    } else if (s >= 90) {
      rank = "EXCELLENT";
      rankColor = "#29b6f6";
    } else if (s >= 80) {
      rank = "GREAT";
      rankColor = "#ffee58";
    } else if (s >= 60) {
      rank = "GOOD";
      rankColor = "#ffca28";
    } else if (s >= 50) {
      rank = "DECENT";
      rankColor = "#ffca28";
    } else if (s >= 20) {
      rank = "NICE TRY";
      rankColor = "#ffca28";
    } else {
      rank = "yikes";
      rankColor = "#ef5350";
    }

    const playAudioSequence = async () => {
      await new Promise((r) => setTimeout(r, 1000));
      if (state.scoreSkipped) return;

      let fanfareUrl = "/assets/audio/fanfare-2.mid";
      if (s == 100) fanfareUrl = "/assets/audio/fanfare-4.mid";
      else if (s >= 70) fanfareUrl = "/assets/audio/fanfare-3.mid";
      else if (s >= 20) fanfareUrl = "/assets/audio/fanfare.mid";

      if (state.isScoreFanfareEnabled) {
        const fanfareFinished = await Forte.playSfx(fanfareUrl, 0.5);
        if (!fanfareFinished || state.scoreSkipped) return;
      } else {
        await new Promise((r) => setTimeout(r, 4000));
      }

      let playedNarration = false;
      if (state.isScoreNarrationEnabled) {
        const libraryInfo = root.library?.libraryInfo;
        const narrations =
          libraryInfo?.manifest?.additionalContents?.scoreNarrations;
        if (narrations && Array.isArray(narrations)) {
          const match = narrations.find((n) => s >= n.min && s <= n.max);
          if (match && match.file) {
            const joinPath = (p1, p2) =>
              p1.replace(/\/$/, "") + "/" + p2.replace(/^\//, "");
            const narrationUrl = new URL(
              `http://127.0.0.1:${state.actualPort}/getFile`,
            );
            narrationUrl.searchParams.append(
              "path",
              joinPath(libraryInfo.path, match.file),
            );
            await Forte.playSfx(narrationUrl.href);
            playedNarration = true;
          }
        }
        if (!playedNarration) {
          let defaultNarrationUrl = "/assets/audio/scores/0.wav";
          if (s >= 70) defaultNarrationUrl = "/assets/audio/scores/70.wav";
          else if (s >= 50) defaultNarrationUrl = "/assets/audio/scores/50.wav";
          else if (s >= 20) defaultNarrationUrl = "/assets/audio/scores/20.wav";
          await Forte.playSfx(defaultNarrationUrl);
        }
      } else {
        await new Promise((r) => setTimeout(r, 5000));
      }
    };

    const animate = async () => {
      const dur = 3800;
      const start = performance.now();
      await new Promise((r) => {
        if (state.scoreSkipped) return;
        const tick = () => {
          const now = performance.now();
          const p = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          dom.finalScoreDisplay.text(Math.floor(s * ease));
          if (p < 1) requestAnimationFrame(tick);
          else r();
        };
        requestAnimationFrame(tick);
      });

      if (
        typeof window !== "undefined" &&
        typeof window.confetti === "function" &&
        !state.scoreSkipped &&
        s >= 70
      ) {
        window.confetti({
          position: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
          count: 67,
          fade: true,
        });
      }

      if (state.scoreSkipped) return;
      dom.rankDisplay.text(rank).styleJs({
        transform: "scale(1)",
        opacity: "1",
        color: rankColor,
        transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      });

      if (state.isSessionActive) {
        setTimeout(() => {
          if (state.scoreSkipped) return;
          dom.postSongScreen.classOn("show-leaderboard");
          dom.scoreSessionLeaderboard.classOff("hidden");
        }, 1500);
      }
    };

    await Promise.race([
      Promise.all([animate(), playAudioSequence()]),
      new Promise((resolve) => {
        state.scoreSkipResolver = resolve;
      }),
    ]);

    dom.postSongScreen.styleJs({ opacity: "0", pointerEvents: "none" });
    state.isScoreScreenActive = false;
    state.scoreSkipResolver = null;
    await new Promise((r) => setTimeout(r, 400));
  }

  async runCalibrationSequence() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const modules = this.ctx.modules;

    if (state.isTransitioning) return;
    state.isTransitioning = true;

    dom.calibTitle.text("LATENCY COMPENSATION");
    dom.calibText.html(
      "Please place your microphone near your speakers and ensure the room is quiet.<br>The test will begin in five (5) seconds...",
    );
    dom.calibrationScreen.classOn("visible");

    await new Promise((r) => setTimeout(r, 5000));
    dom.calibText.text("Calibrating... A series of beeps will play.");

    try {
      const lat = await this.ctx.services.Forte.runLatencyTest();
      window.config.setItem("audioConfig.micLatency", lat);
      dom.calibTitle.text("CALIBRATION COMPLETE");
      dom.calibText.text(
        `Measured audio latency is ${(lat * 1000).toFixed(0)} ms.`,
      );
      modules.infoBar.showTemp(
        "CALIBRATION",
        `Success! ${(lat * 1000).toFixed(0)} ms`,
        5000,
      );
    } catch (e) {
      console.error("[Encore] Calibration failed:", e);
      dom.calibTitle.text("CALIBRATION FAILED");
      dom.calibText.html(
        `Could not get a reliable measurement.<br>Please check your microphone input, speaker volume, and reduce background noise.`,
      );
      modules.infoBar.showTemp(
        "CALIBRATION",
        "Failed. Please try again.",
        5000,
      );
    }

    await new Promise((r) => setTimeout(r, 6000));
    dom.calibrationScreen.classOff("visible");
    state.isTransitioning = false;
  }
}
