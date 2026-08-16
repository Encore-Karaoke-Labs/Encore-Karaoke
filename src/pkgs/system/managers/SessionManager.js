import Html from "../../../libs/html.js";

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
    this.handlePeerDisconnected = this.handlePeerDisconnected.bind(this);
    this.handleHostDisconnected = this.handleHostDisconnected.bind(this);
    this.handleKicked = this.handleKicked.bind(this);
    this.handleForceStop = this.handleForceStop.bind(this);
    this.handleChatHistorySync = this.handleChatHistorySync.bind(this);
    this.handleChat = this.handleChat.bind(this);
    this.handleCheer = this.handleCheer.bind(this);
    this.lastNavSfxTime = 0;
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
    const maxCapacity = 8;

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
        "SESSION",
        "Already connected to this Session.",
        3000,
      );
      return;
    }

    if (state.isSessionActive) {
      this.ctx.modules.infoBar.showTemp(
        "SESSION",
        "Already connected to a Session.",
        3000,
      );
      return;
    }

    this.ctx.state.isSessionModalOpen = true;
    this.ctx.dom.sessionModal.classOff("hidden");
    this.renderSessionView("deeplink-prompt", roomCode);
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
   * Called to register the document event listeners mapping from CherryTree Services
   */
  init() {
    document.addEventListener(
      "CherryTree.Sessions.StateUpdate",
      this.handleStateUpdate,
    );
    document.addEventListener(
      "CherryTree.Sessions.RemoteScore",
      this.handleRemoteScore,
    );
    document.addEventListener(
      "CherryTree.Sessions.SkipScore",
      this.handleSkipScore,
    );
    document.addEventListener(
      "CherryTree.Sessions.RemoteStream",
      this.handleRemoteStream,
    );
    document.addEventListener(
      "CherryTree.Sessions.LoungeStream",
      this.handleLoungeStream,
    );
    document.addEventListener(
      "CherryTree.Sessions.ClearStreams",
      this.handleClearStreams,
    );
    document.addEventListener(
      "CherryTree.Sessions.PeerDisconnected",
      this.handlePeerDisconnected,
    );
    document.addEventListener(
      "CherryTree.Sessions.HostDisconnected",
      this.handleHostDisconnected,
    );
    document.addEventListener("CherryTree.Sessions.Kicked", this.handleKicked);
    document.addEventListener(
      "CherryTree.Sessions.ForceStop",
      this.handleForceStop,
    );
    document.addEventListener(
      "CherryTree.Sessions.ChatHistorySync",
      this.handleChatHistorySync,
    );
    document.addEventListener("CherryTree.Sessions.Chat", this.handleChat);
    document.addEventListener("CherryTree.Sessions.Cheer", this.handleCheer);
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

          if (sState.nowPlaying) {
            root.playback.startPlayer(sState.nowPlaying);
            setTimeout(() => {
              const stream = this.ctx.modules.recorder.getBroadcastStream();
              if (stream) SessionsSvc.broadcastPerformance(stream);
            }, 1000);
          }
        } else {
          root.playback.stopPlayer();
          root.ui.setMode("player");

          dom.playerUi.classOn("hidden");
          dom.bgvContainer.classOn("hidden");
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

            const timeSinceStart = sState.playTrigger
              ? Math.abs(Date.now() - sState.playTrigger)
              : 99999;
            if (timeSinceStart < 8000) {
              dom.introTitle.text(
                root.playback.truncateTitleIfNeeded(sState.nowPlaying.title),
              );
              dom.introArtist.text(sState.nowPlaying.artist);
              dom.introMeta.text(`Singer: ${singerName}`);
              dom.introCard.classOn("visible");
              setTimeout(() => {
                if (state.mode === "player") dom.introCard.classOff("visible");
              }, 3500);
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
    } else if (sState.mode === "lounge" && prevMode !== "lounge") {
      dom.sessionRemoteContainer.classOn("hidden");
      dom.sessionRemoteVideo.elm.srcObject = null;
      if (this.ctx.modules.recorder)
        this.ctx.modules.recorder.stopBroadcastStream();

      state.isTransitioning = false;
      root.ui.setMode("menu");
      root.ui.startLoungeBackground();

      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
      this.updateDiscordSessionRPC();
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
      const mockScoreData = { finalScore: e.detail.entry.score };
      state.remoteScoreEntry = e.detail.entry;
      state.currentScoreEntryId = e.detail.entry.id;

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
    this.ctx.dom.sessionRemoteVideo.elm.srcObject = e.detail;
    this.ctx.dom.sessionRemoteVideo.elm.volume = this.ctx.state.volume;
  }

  handleLoungeStream(e) {
    this.ctx.services.Forte.playRemoteStream(e.detail.id, e.detail.stream);
  }

  handleClearStreams() {
    this.ctx.services.Forte.clearRemoteStreams();
  }

  handlePeerDisconnected(e) {
    this.ctx.services.Forte.stopRemoteStream(e.detail);
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
    if (this.ctx.state.mode === "player") {
      this.ctx.root.playback.stopPlayer();
      this.ctx.modules.infoBar.showTemp(
        "SKIPPED",
        "The host skipped the current performance.",
        4000,
      );
    }
  }

  performSessionDisconnect() {
    this.ctx.root.games.hideOverlay();

    const state = this.ctx.state;
    const dom = this.ctx.dom;
    const root = this.ctx.root;

    if (state.isSessionActive) {
      this.ctx.services.Forte.playSfx("/assets/audio/session_end.wav");
    }

    if (this.ctx.services.Forte.setScoringEnabled) {
      const userPref = this.ctx.config.audioConfig?.enableScoring !== false;
      this.ctx.services.Forte.setScoringEnabled(userPref);
    }

    state.isSessionActive = false;
    state.sessionRoomId = null;
    state.knownParticipants = [];
    this.updateDiscordSessionRPC();

    root.ui.stopLoungeBackground();
    this.ctx.services.Forte.clearRemoteStreams();
    if (this.ctx.modules.recorder)
      this.ctx.modules.recorder.stopBroadcastStream();

    root.playback.stopPlayer();
    dom.sessionRemoteContainer.classOn("hidden");

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
    this.ctx.state.isSessionModalOpen = isOpening;

    if (isOpening) {
      this.ctx.dom.sessionModal.classOff("hidden");
      this.renderSessionView(
        this.ctx.state.isSessionActive ? "active" : "select",
      );
    } else {
      this.ctx.dom.sessionModal.classOn("hidden");
    }
  }

  reserveSongInSession(song) {
    this.ctx.services.SessionsSvc.requestSong(song);
    this.showReservationNotification(song);
  }

  showReservationNotification(song) {
    const codeSpan = song.code
      ? `<span class="info-bar-code">${song.code}</span>`
      : `<span class="info-bar-code is-youtube">YT</span>`;
    const fmt = this.ctx.root.library.getFormatInfo(song);
    const fmtBadge = `<span class="format-badge" style="background-color: ${fmt.color}">${fmt.label}</span>`;

    this.ctx.modules.infoBar.showTemp(
      "RESERVED",
      `${codeSpan} ${fmtBadge} <span class="info-bar-title">${song.title}</span>`,
      4000,
    );
  }

  renderSessionView(view, extraData = null) {
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
          await Identity.updateProfile(nickInput.getValue());
          dom.sessionContentArea.clear();
          new Html("h2")
            .text(isHost ? "CREATING..." : "JOINING...")
            .styleJs({ fontSize: "2rem", color: "#ffd700" })
            .appendTo(dom.sessionContentArea);

          try {
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
              const room = roomInput.getValue().trim();
              await SessionsSvc.joinRoom(room, sessionProfile);
              state.isSessionActive = true;
              state.isSessionHost = false;
              state.sessionRoomId = room;
              this.updateDiscordSessionRPC();
            }

            this.ctx.services.Forte.playSfx("/assets/audio/session_start.wav");

            if (this.ctx.services.Forte.setScoringEnabled) {
              this.ctx.services.Forte.setScoringEnabled(true);
            }

            state.sessionMode = "lounge";
            if (dom.sessionChatContainer)
              dom.sessionChatContainer.classOff("hidden");
            this.renderSessionView("active");
            root.ui.startLoungeBackground();
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
                    '<ion-icon name="key-outline" style="font-size: 1.2rem;"></ion-icon><span>COPY CODE</span>',
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

      if (state.isSessionHost && SessionsSvc.state.mode === "lounge") {
        new Html("button")
          .classOn("session-btn", "primary")
          .styleJs({
            width: "100%",
            maxHeight: "65px",
            fontSize: "1.3rem",
            flexShrink: "0",
          })
          .text("MINIGAMES")
          .on("click", () => this.renderSessionView("games"))
          .appendTo(leftCol);
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
        .classOn("session-active-col", "leaderboard-col")
        .appendTo(layout);
      new Html("h2")
        .classOn("session-leaderboard-title")
        .text("TOP PERFORMANCES")
        .appendTo(rightCol);
      const leaderboardList = new Html("div")
        .classOn("session-leaderboard-list")
        .appendTo(rightCol);

      const topScores = SessionsSvc.state.leaderboard || [];

      if (topScores.length === 0) {
        new Html("div")
          .classOn("session-leaderboard-empty")
          .text("No scores yet. Sing a song to get on the board!")
          .appendTo(leaderboardList);
      } else {
        topScores.slice(0, 10).forEach((entry, index) => {
          const row = new Html("div")
            .classOn("session-leaderboard-row")
            .appendTo(leaderboardList);
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
              .text(game.name)
              .appendTo(listPanel);
            if (activeGame.id === game.id) item.classOn("mixer-item--active");
            item.on("click", () => {
              activeGame = game;
              renderList();
              renderDetails();
            });
          });
        };

        renderList();
        renderDetails();
      }
    }
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
      } else if (state.sessionModalView === "games") {
        this.renderSessionView("active");
      } else {
        this.toggleSessionModal(false);
      }
      return;
    }

    const modalEl = dom.sessionContentArea.elm;
    const focusables = Array.from(
      modalEl.querySelectorAll("button, input, .session-tile"),
    );
    if (!focusables.length) return;

    const activeEl = document.activeElement;
    const currentIndex = focusables.indexOf(activeEl);
    const isInput = activeEl && activeEl.tagName === "INPUT";

    if (e.key === "Enter") {
      if (activeEl && activeEl.classList.contains("session-tile")) {
        e.preventDefault();
        activeEl.click();
      } else if (isInput) {
        e.preventDefault();
        const primaryBtn = modalEl.querySelector(".session-btn.primary");
        if (primaryBtn) primaryBtn.click();
      }
      return;
    }

    if (isInput && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }

    if (["ArrowDown", "ArrowRight", "Tab"].includes(e.key)) {
      e.preventDefault();
      this.playNavSfx("nav");
      let nextIndex = currentIndex + 1;
      if (nextIndex >= focusables.length) nextIndex = 0;
      focusables[nextIndex].focus();
    } else if (
      ["ArrowUp", "ArrowLeft"].includes(e.key) ||
      (e.key === "Tab" && e.shiftKey)
    ) {
      e.preventDefault();
      this.playNavSfx("nav");
      let nextIndex = currentIndex - 1;
      if (nextIndex < 0) nextIndex = focusables.length - 1;
      focusables[nextIndex].focus();
    }
  }

  destroy() {
    document.removeEventListener(
      "CherryTree.Sessions.StateUpdate",
      this.handleStateUpdate,
    );
    document.removeEventListener(
      "CherryTree.Sessions.RemoteScore",
      this.handleRemoteScore,
    );
    document.removeEventListener(
      "CherryTree.Sessions.SkipScore",
      this.handleSkipScore,
    );
    document.removeEventListener(
      "CherryTree.Sessions.RemoteStream",
      this.handleRemoteStream,
    );
    document.removeEventListener(
      "CherryTree.Sessions.LoungeStream",
      this.handleLoungeStream,
    );
    document.removeEventListener(
      "CherryTree.Sessions.ClearStreams",
      this.handleClearStreams,
    );
    document.removeEventListener(
      "CherryTree.Sessions.PeerDisconnected",
      this.handlePeerDisconnected,
    );
    document.removeEventListener(
      "CherryTree.Sessions.HostDisconnected",
      this.handleHostDisconnected,
    );
    document.removeEventListener(
      "CherryTree.Sessions.Kicked",
      this.handleKicked,
    );
    document.removeEventListener(
      "CherryTree.Sessions.ForceStop",
      this.handleForceStop,
    );
    document.removeEventListener(
      "CherryTree.Sessions.ChatHistorySync",
      this.handleChatHistorySync,
    );
    document.removeEventListener("CherryTree.Sessions.Chat", this.handleChat);
    document.removeEventListener("CherryTree.Sessions.Cheer", this.handleCheer);
  }
}
