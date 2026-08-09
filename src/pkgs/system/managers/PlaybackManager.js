import Html from "../../../libs/html.js";
import NetworkingUtility from "../../../libs/networkingUtility.js";
import CDGraphics from "cdgraphics";

export default class PlaybackManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    this.ytWarningTimer = null;
    this.ytAutoSkipTimer = null;

    this.cdgRenderer = null;
    this.cdgRafId = null;
    this.currentCdgBitmap = null;

    this.boundTimeUpdate = null;
    this.currentMediaTime = 0;

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
   * Samples four corners of the CD+G frame buffer to identify and remove the background color.
   *
   * @param {ImageData} imageData - Raw pixel buffer from cdgraphics.
   * @returns {ImageData} - The modified ImageData with alpha transparency applied.
   */
  processCdgTransparency(imageData) {
    if (!imageData || !imageData.data) return imageData;

    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    if (data.length < 16) return imageData;

    const corners = [
      0, // Top-Left (0, 0)
      (width - 1) * 4, // Top-Right (width-1, 0)
      (height - 1) * width * 4, // Bottom-Left (0, height-1)
      ((height - 1) * width + (width - 1)) * 4, // Bottom-Right (width-1, height-1)
    ];

    const bgR = data[corners[0]];
    const bgG = data[corners[0] + 1];
    const bgB = data[corners[0] + 2];

    let matchCount = 0;
    for (const idx of corners) {
      if (data[idx] === bgR && data[idx + 1] === bgG && data[idx + 2] === bgB) {
        matchCount++;
      }
    }

    if (matchCount < 2) return imageData;

    // Set alpha = 0 for all exact matching background pixels
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === bgR && data[i + 1] === bgG && data[i + 2] === bgB) {
        data[i + 3] = 0; // Transparent
      }
    }

    return imageData;
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
    if (root.games) root.games.broadcastPlaybackState("playing", song);
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
    if (state.currentSongIsYouTube) {
      this.ctx.wrapper.classOn("mode-player-youtube");
    }

    if (song.cdgPath) {
      this.ctx.wrapper.classOn("mode-player-cdg");
    }

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
        src: `https://cdpn.io/pen/debug/oNPzxKo?v=${song.path.substring(5)}&autoplay=1&cc_load_policy=3`,
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
      this.mvPlayer = null;
      dom.lyricsCanvas.styleJs({ opacity: "0" }).classOff("hidden");

      if (state.currentSongIsMV) {
        const videoUrl = await NetworkingUtility.getFileLink(song.videoPath);
        this.mvPlayer = await modules.bgv.playSingleVideo(videoUrl.href);
      } else {
        modules.bgv.resumePlaylist();
      }

      dom.bgvContainer.classOff("hidden");
      dom.ytContainer.classOn("hidden");
      dom.ytIframe.attr({ src: "" });

      console.log("SONg", song);

      const trackUrl = await NetworkingUtility.getFileLink(song.path);
      let chorusUrl = null;
      if (song.chorusPath) {
        chorusUrl = (await NetworkingUtility.getFileLink(song.chorusPath)).href;
      }
      await Forte.loadTrack(trackUrl.href, chorusUrl);

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
          : pbState.hasChorus
            ? "chr.png"
            : pbState.isMidi
              ? "midi.png"
              : "rs.png";
      dom.formatIndicator.styleJs({
        backgroundImage: `url("/assets/img/icons/${icon}")`,
        opacity: "1",
      });

      if (!state.currentSongIsYouTube) {
        if (
          this.ctx.config.audioConfig?.enableScoring !== false ||
          state.isSessionActive
        ) {
          modules.scoreHud.show(0);
        }
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

      this.boundTimeUpdate = (e) => {
        this.currentMediaTime = e.detail.currentTime;
      };
      document.addEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundTimeUpdate,
      );

      if (root.lyrics) {
        await root.lyrics.setupLyrics(song, pbState);
        root.lyrics.setupTimeUpdate(this.mvPlayer);
      }

      if (song.cdgPath) {
        try {
          const cdgUrl = await NetworkingUtility.getFileLink(song.cdgPath);
          const cdgRes = await fetch(cdgUrl.href);
          const cdgBuffer = await cdgRes.arrayBuffer();

          this.cdgRenderer = new CDGraphics(cdgBuffer);

          const renderCdg = () => {
            if (!this.cdgRenderer) return;
            this.cdgRafId = requestAnimationFrame(renderCdg);

            const time = this.currentMediaTime || 0;
            const frame = this.cdgRenderer.render(time);

            if (frame.isChanged) {
              this.processCdgTransparency(frame.imageData);

              createImageBitmap(frame.imageData)
                .then((bitmap) => {
                  this.currentCdgBitmap = bitmap;
                })
                .catch((e) =>
                  console.error("[Encore] CDG ImageBitmap Error:", e),
                );
            }

            if (this.currentCdgBitmap) {
              const canvas = modules.bgv.getCustomCanvas();
              const ctx = modules.bgv.getCustomContext();
              if (!canvas || !ctx) return;

              const dpr = window.devicePixelRatio || 1;
              const logicalWidth = canvas.width / dpr;
              const logicalHeight = canvas.height / dpr;

              ctx.clearRect(0, 0, logicalWidth, logicalHeight);
              ctx.imageSmoothingEnabled = false;

              ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
              ctx.fillRect(0, 0, logicalWidth, logicalHeight);

              const scale = Math.min(
                logicalWidth / this.currentCdgBitmap.width,
                logicalHeight / this.currentCdgBitmap.height,
              );

              const w = this.currentCdgBitmap.width * scale;
              const h = this.currentCdgBitmap.height * scale;

              const x = (logicalWidth - w) / 2;
              const y = (logicalHeight - h) / 2;

              ctx.drawImage(this.currentCdgBitmap, x, y, w, h);
            }
          };
          this.cdgRafId = requestAnimationFrame(renderCdg);
        } catch (e) {
          console.error("[Encore] Failed to initialize CDG track:", e);
        }
      }

      if (
        !state.currentSongIsYouTube &&
        (this.ctx.config.audioConfig?.enableScoring !== false ||
          state.isSessionActive)
      ) {
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
        if (this.mvPlayer) this.mvPlayer.play().catch(console.error);
        Forte.playTrack();
        state.isTransitioning = false;
        setTimeout(() => {
          if (state.scoreSkipped) state.scoreSkipped = false;
        }, 5000);
      }, 2500);
    }
  }

  togglePause() {
    const state = this.ctx.state;
    const Forte = this.ctx.services.Forte;
    const modules = this.ctx.modules;

    if (state.mode !== "player" || state.isTransitioning) return;

    if (state.currentSongIsYouTube) {
      modules.infoBar.showTemp(
        "PAUSE",
        "Cannot pause on YouTube tracks.",
        3000,
      );
      return;
    }

    const pbState = Forte.getPlaybackState();

    if (pbState.status === "playing") {
      Forte.pauseTrack();

      if (state.currentSongIsMV && this.mvPlayer) {
        this.mvPlayer.pause();
      }

      modules.infoBar.show(
        "PAUSED",
        "<span class='info-bar-title'>Playback is paused</span>",
      );
      modules.infoBar.showBar();
    } else if (pbState.status === "paused") {
      if (state.currentSongIsMV && this.mvPlayer) {
        this.mvPlayer.play();
      }

      Forte.playTrack();

      modules.infoBar.showDefault();
    }
  }

  stopPlayer() {
    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const modules = this.ctx.modules;

    this.ctx.wrapper.classOff("mode-player-cdg");
    this.ctx.wrapper.classOff("mode-player-youtube");

    modules.recorder.clearSongInfo();
    if (this.ctx.root.games)
      this.ctx.root.games.broadcastPlaybackState("stopped", null);
    dom.introCard.classOff("visible");
    dom.ytContainer.classOn("hidden");
    dom.ytIframe.attr({ src: "" });
    this.clearYoutubeTimers();
    if (this.cdgRafId) {
      cancelAnimationFrame(this.cdgRafId);
      this.cdgRafId = null;
    }
    this.cdgRenderer = null;
    this.currentCdgBitmap = null;
    this.ctx.modules.bgv.clearCustomGraphics();
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

    if (this.boundTimeUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundTimeUpdate,
      );

    this.boundScoreUpdate = null;
    this.boundTempoUpdate = null;
    this.boundDuetEvent = null;
    this.boundTimeUpdate = null;
    this.currentMediaTime = 0;
  }

  async handlePlaybackUpdate(e) {
    const { status } = e.detail || {};
    const state = this.ctx.state;

    if (
      state.mode.startsWith("player") &&
      (state.lastPlaybackStatus === "playing" ||
        state.lastPlaybackStatus === "paused") &&
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
        const isScoringEnabled =
          this.ctx.config.audioConfig?.enableScoring !== false ||
          state.isSessionActive;

        if (isScoringEnabled) {
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
            state.currentScoreEntryId =
              this.ctx.services.SessionsSvc.submitScore(
                finalScore.finalScore,
                songTitle,
              );
          }

          await this.showPostSongScreen(finalScore);
        }
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
    if (root.games)
      root.games.broadcastPlaybackState("score_screen", scoreData);
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
            const narrationUrl = await NetworkingUtility.getFileLink(
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
    if (root.games) root.games.broadcastPlaybackState("score_screen_end", null);
    await new Promise((r) => setTimeout(r, 400));
  }
}
