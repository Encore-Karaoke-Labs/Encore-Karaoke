import Html from "../../../libs/html.js";
import { Peer } from "peerjs";

export default class NetworkManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;
    this.socket = null;

    this.ctx.state.knownRemotes = {};
    this.ctx.state.activeSockets = {};
    this.ctx.state.deviceRegistry = {};
    this.ctx.state.typingUsers = new Set();
    this.ctx.state.chatHistory = [];
    this.ctx.state.cheerQueue = [];

    this.activeDanmaku = [];
    this.lastDanmakuTime = performance.now();
    this.danmakuRafId = null;
    this.MAX_DANMAKU = 200;
    this.danmakuCtx = null;
    this.isDanmakuDirty = false;

    this.resizeDanmakuCanvas = this.resizeDanmakuCanvas.bind(this);
  }

  async init() {
    const canvas = this.ctx.dom.danmakuCanvas.elm;
    this.danmakuCtx = canvas.getContext("2d", { alpha: true });
    window.addEventListener("resize", this.resizeDanmakuCanvas);
    this.resizeDanmakuCanvas();
    this.drawDanmakuFrame();

    this.socket = io({
      query: { clientType: "app" },
      transports: ["websocket"],
    });

    this.socket.on("connect", () => {
      console.log("[LINK] Connected to server.");
      this.socket.emit("broadcastData", { type: "ready" });
    });

    this.socket.on("remotes", (allRemoteData) => {
      this.ctx.state.knownRemotes = allRemoteData;
      this.updateRemoteCount();
      console.log("[LINK] Loaded remote data", this.ctx.state.knownRemotes);
    });

    this.setupSocketListeners();
  }

  resizeDanmakuCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.ctx.dom.danmakuCanvas.elm.width = w * dpr;
    this.ctx.dom.danmakuCanvas.elm.height = h * dpr;
    this.ctx.dom.danmakuCanvas.styleJs({ width: `${w}px`, height: `${h}px` });

    if (this.danmakuCtx) {
      this.danmakuCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.danmakuCtx.scale(dpr, dpr);
    }
  }

  updateRemoteCount() {
    if (this.ctx.dom.qrConnectedCount) {
      const count = Object.keys(this.ctx.state.knownRemotes || {}).length;
      this.ctx.dom.qrConnectedCount.text(count.toString());
      if (count > 0) {
        this.ctx.dom.qrContainer.classOn("has-remotes");
      } else {
        this.ctx.dom.qrContainer.classOff("has-remotes");
      }
    }
  }

  refreshQRCode() {
    const dom = this.ctx.dom;
    if (!dom.qrContainer) return;
    const img = dom.qrContainer.elm.querySelector("img");
    if (!img) return;

    fetch(`http://127.0.0.1:${this.ctx.state.actualPort}/cloud_info`)
      .then((r) => r.json())
      .then((info) => {
        if (!info.roomCode) throw new Error("No cloud connection");
        const remoteUrl = `${info.relayUrl}/?room=${info.roomCode}`;
        img.src = `http://127.0.0.1:${this.ctx.state.actualPort}/qr?url=${encodeURIComponent(remoteUrl)}`;
        dom.qrContainer.classOff("hidden");
      })
      .catch(() => {
        // Fallback to local IP network
        fetch(`http://127.0.0.1:${this.ctx.state.actualPort}/local_ip`)
          .then((r) => r.text())
          .then((ip) => {
            if (!ip) throw new Error("No local network connection");
            const remoteUrl = `http://${ip}:${this.ctx.state.actualPort}/remote`;
            img.src = `http://127.0.0.1:${this.ctx.state.actualPort}/qr?url=${encodeURIComponent(remoteUrl)}`;
            dom.qrContainer.classOff("hidden");
          })
          .catch(() => {
            dom.qrContainer.classOn("hidden");
          });
      });
  }

  broadcastSocialState() {
    const state = this.ctx.state;
    const activeUsersCount = Object.keys(state.activeSockets).length;

    const typingNicks = Array.from(state.typingUsers)
      .map((socketId) => {
        const devId = state.activeSockets[socketId];
        return devId && state.deviceRegistry[devId]
          ? state.deviceRegistry[devId].nickname
          : null;
      })
      .filter(Boolean);

    this.socket.emit("broadcastData", {
      type: "social_update",
      typing: typingNicks,
      usersCount: activeUsersCount,
      users: state.deviceRegistry,
    });
  }

  processCheerQueue() {
    if (this.ctx.state.cheerQueue.length === 0) return;
    while (this.ctx.state.cheerQueue.length > 0) {
      const cheer = this.ctx.state.cheerQueue.shift();
      this.displayCheer(cheer);
    }
  }

  displayCheer(cheer) {
    if (!this.danmakuCtx) return;

    if (this.activeDanmaku.length >= this.MAX_DANMAKU) {
      this.activeDanmaku.shift();
    }

    const fontSize = Math.max(20, Math.floor(window.innerHeight * 0.035));
    this.danmakuCtx.font = `900 ${fontSize}px "Radio Canada", sans-serif`;

    const senderText = `${cheer.nickname} | `;
    const msgText = cheer.message;

    const senderWidth = this.danmakuCtx.measureText(senderText).width;
    const msgWidth = this.danmakuCtx.measureText(msgText).width;
    const totalWidth = senderWidth + msgWidth;

    const safeAreaHeight = window.innerHeight * 0.45;
    const topPadding = window.innerHeight * 0.05;
    const usableHeight = safeAreaHeight - topPadding;
    const laneHeight = fontSize * 1.5;
    const laneCount = Math.max(1, Math.floor(usableHeight / laneHeight));

    const lane = Math.floor(Math.random() * laneCount);
    const y = topPadding + lane * laneHeight + fontSize / 2;

    const duration = 6 + Math.random() * 4;
    const speed = (window.innerWidth + totalWidth) / duration;

    this.activeDanmaku.push({
      sender: senderText,
      message: msgText,
      senderWidth,
      totalWidth,
      x: window.innerWidth,
      y,
      speed,
      fontSize,
    });

    if (!this.danmakuRafId) {
      this.lastDanmakuTime = performance.now(); // Reset time to prevent massive dt jump
      this.drawDanmakuFrame();
    }
  }

  drawDanmakuFrame() {
    if (this.activeDanmaku.length === 0) {
      if (this.danmakuCtx && this.isDanmakuDirty) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.danmakuCtx.clearRect(0, 0, w, h);
        this.isDanmakuDirty = false;
      }
      this.danmakuRafId = null;
      return;
    }

    this.isDanmakuDirty = true;

    const now = performance.now();
    let dt = (now - this.lastDanmakuTime) / 1000;
    if (dt > 0.1) dt = 0.1; // Clamp DT to prevent instant bounds teleportation
    this.lastDanmakuTime = now;

    if (this.danmakuCtx) {
      const canvas = this.ctx.dom.danmakuCanvas.elm;
      const w = parseFloat(canvas.style.width) || window.innerWidth;
      const h = parseFloat(canvas.style.height) || window.innerHeight;

      this.danmakuCtx.clearRect(0, 0, w, h);

      this.danmakuCtx.textBaseline = "middle";
      this.danmakuCtx.lineJoin = "round";

      for (let i = this.activeDanmaku.length - 1; i >= 0; i--) {
        const d = this.activeDanmaku[i];
        d.x -= d.speed * dt;

        if (d.x + d.totalWidth < 0) {
          this.activeDanmaku.splice(i, 1);
          continue;
        }

        this.danmakuCtx.font = `900 ${d.fontSize}px "Radio Canada", sans-serif`;
        this.danmakuCtx.lineWidth = d.fontSize * 0.18;

        this.danmakuCtx.strokeStyle = "#000000";
        this.danmakuCtx.strokeText(d.sender, d.x, d.y);
        this.danmakuCtx.fillStyle = "#ffd700";
        this.danmakuCtx.fillText(d.sender, d.x, d.y);

        const msgX = d.x + d.senderWidth;
        this.danmakuCtx.strokeStyle = "#000000";
        this.danmakuCtx.strokeText(d.message, msgX, d.y);
        this.danmakuCtx.fillStyle = "#ffffff";
        this.danmakuCtx.fillText(d.message, msgX, d.y);
      }
    }
    this.danmakuRafId = requestAnimationFrame(() => this.drawDanmakuFrame());
  }

  setupSocketListeners() {
    const state = this.ctx.state;
    const root = this.ctx.root;
    const input = root.input;

    this.socket.on("cloud-status", (status) => {
      if (status.connected) {
        this.ctx.modules.infoBar.showTemp(
          "LINK",
          `Cloud Link Ready - PIN: <span style="color:#89cff0">${status.roomCode}</span>`,
          5000,
        );
      } else {
        this.ctx.modules.infoBar.showTemp(
          "LINK",
          "Cloud Link disconnected. Reconnecting...",
          5000,
        );
      }
      this.refreshQRCode();
    });

    this.socket.on("join", (joinInformation) => {
      if (joinInformation.type == "remote") {
        state.knownRemotes[joinInformation.identity] = {
          connectedAt: new Date(Date.now()).toISOString(),
          commandsSent: 0,
        };
        this.updateRemoteCount();
        this.ctx.modules.infoBar.showTemp(
          "LINK",
          "A new Remote has connected.",
          5000,
        );
      }
    });

    this.socket.on("leave", (leaveInformation) => {
      delete state.knownRemotes[leaveInformation.identity];
      delete state.activeSockets[leaveInformation.identity];
      state.typingUsers.delete(leaveInformation.identity);
      this.updateRemoteCount();
      this.broadcastSocialState();
    });

    this.socket.on("execute-command", (cmd) => {
      const d = cmd.data;

      if (d.type === "set_nickname") {
        const deviceId = d.deviceId || cmd.identity;
        const existingNames = Object.entries(state.deviceRegistry)
          .filter(([id, _]) => id !== deviceId)
          .map(([_, data]) => data.nickname);

        const uniqueName = this.ctx.services.Identity.resolveCollision(
          d.value,
          existingNames,
        );

        state.deviceRegistry[deviceId] = { nickname: uniqueName };
        state.activeSockets[cmd.identity] = deviceId;

        this.socket.emit("sendData", {
          identity: cmd.identity,
          data: {
            type: "social_init",
            nickname: uniqueName,
            history: state.chatHistory,
          },
        });
        this.broadcastSocialState();
        return;
      }

      if (d.type === "chat_message") {
        const deviceId = state.activeSockets[cmd.identity];
        const sender =
          deviceId && state.deviceRegistry[deviceId]
            ? state.deviceRegistry[deviceId].nickname
            : "Guest";

        state.typingUsers.delete(cmd.identity);
        this.broadcastSocialState();

        if (state.isSessionActive) {
          this.ctx.services.SessionsSvc.broadcastChat(
            sender,
            d.value.substring(0, 200),
          );
        } else {
          const msgObj = {
            id: Date.now(),
            sender,
            text: d.value.substring(0, 200),
            time: Date.now(),
          };
          state.chatHistory.push(msgObj);
          if (state.chatHistory.length > 100) state.chatHistory.shift();

          this.socket.emit("broadcastData", {
            type: "new_chat",
            message: msgObj,
          });
        }
        return;
      }
      if (d.type === "send_cheer") {
        const deviceId = state.activeSockets[cmd.identity];
        const sender =
          deviceId && state.deviceRegistry[deviceId]
            ? state.deviceRegistry[deviceId].nickname
            : "Guest";

        if (state.isSessionActive) {
          this.ctx.services.SessionsSvc.broadcastCheer(
            sender,
            d.value.substring(0, 50),
          );
        } else {
          state.cheerQueue.push({
            nickname: sender,
            message: d.value.substring(0, 50),
          });
          this.processCheerQueue();
        }
        return;
      }
      if (d.type === "typing_state") {
        if (d.value) state.typingUsers.add(cmd.identity);
        else state.typingUsers.delete(cmd.identity);
        this.broadcastSocialState();
        return;
      }

      switch (d.type) {
        case "digit":
          state.showSongList = true;
          input.handleDigitInput(d.value);
          break;
        case "backspace":
          input.handleBackspace();
          break;
        case "reserve":
        case "enter":
          input.handleEnter();
          break;
        case "stop":
          input.handleEscape();
          break;
        case "vol_up":
          input.handleVolume("up");
          break;
        case "vol_down":
          input.handleVolume("down");
          break;
        case "key_up":
          input.handleNav("up");
          break;
        case "key_down":
          input.handleNav("down");
          break;
        case "key_down":
          input.handleNav("down");
          break;
        case "toggle_melody":
          input.cycleGuideMelody();
          break;
        case "cycle_rhythm":
          input.cycleDrumPreset("right");
          break;
        case "toggle_chorus":
          input.handleChorusToggle();
          break;
        case "pan_left":
        case "pan_left":
          input.handlePan("left");
          break;
        case "pan_right":
          input.handlePan("right");
          break;
        case "toggle_recording":
          if (
            state.mode === "player" &&
            !state.currentSongIsYouTube &&
            !state.isScoreScreenActive
          ) {
            if (state.isSessionActive) {
              this.ctx.modules.infoBar.showTemp(
                "RECORDING",
                "Disabled during an active Session.",
                4000,
              );
              this.ctx.modules.dialog(
                new Html("div")
                  .classOn("temp-dialog-text")
                  .text("NOT AVAILABLE"),
                2000,
              );
            } else {
              this.ctx.modules.recorder.toggle();
            }
          }
          break;
        case "toggle_bgv":
          if (!state.currentSongIsMV) {
            input.handleBracket("]");
          } else {
            this.ctx.modules.infoBar.showTemp(
              "BGV",
              `This function is not available in Music Videos.`,
              5000,
            );
            this.ctx.modules.dialog(
              new Html("div").classOn("temp-dialog-text").text("NOT AVAILABLE"),
              2000,
            );
          }
          break;
        case "yt_search_open":
          if (!state.isTransitioning) input.handleYKey();
          break;
        case "yt_search_close":
          if (state.mode === "yt-search") root.ui.setMode("menu");
          else root.ui.toggleSearchOverlay(false);
          break;
        case "nav_up":
          input.handleNav("up");
          break;
        case "nav_down":
          input.handleNav("down");
          break;
        case "yt_search_query":
          this.ctx.dom.searchInput.elm.value = d.value;
          root.library.performSearch(d.value);
          break;
        case "get_song_list":
          const chunkSize = 1500;
          const totalSongs = state.songList.length;

          if (totalSongs === 0) {
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: { type: "songlist_chunk", contents: [], isLast: true },
            });
            break;
          }

          for (let i = 0; i < totalSongs; i += chunkSize) {
            const chunk = state.songList.slice(i, i + chunkSize).map((s) => ({
              code: s.code,
              title: s.title,
              artist: s.artist,
              type: s.type,
              path: s.path,
              videoPath: s.videoPath,
              chorusPath: s.chorusPath,
            }));
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "songlist_chunk",
                contents: chunk,
                isLast: i + chunkSize >= totalSongs,
              },
            });
          }
          break;

        case "remote_local_search":
          const rawQuery = d.value || "";
          const searchRes =
            this.ctx.root.library.getLocalSearchResults(rawQuery);
          const mappedResults = searchRes.map((s) => ({
            code: s.code,
            title: s.title,
            artist: s.artist,
            type: s.type,
            path: s.path,
            videoPath: s.videoPath,
            chorusPath: s.chorusPath,
          }));

          this.socket.emit("sendData", {
            identity: cmd.identity,
            data: { type: "remote_search_results", results: mappedResults },
          });
          break;

        case "reserve_code":
          const s = state.songMap.get(d.value.padStart(5, "0"));
          if (s) {
            state.mode === "menu"
              ? root.playback.startPlayer(s)
              : (state.reservationQueue.push(s),
                this.ctx.modules.infoBar.showDefault());
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "reserve_response",
                success: true,
                song: { code: s.code, title: s.title, artist: s.artist },
              },
            });
          } else {
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "reserve_response",
                success: false,
                reason: "Not found",
              },
            });
          }
          break;

        case "client_yt_search":
          (async () => {
            if (state.isSessionActive) {
              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: { type: "yt_search_results", results: [] },
              });
              return;
            }
            try {
              const query = d.value;
              const res = await fetch(
                `http://127.0.0.1:${state.actualPort}/yt-search?q=${encodeURIComponent(query)}`,
              );
              const data = await res.json();
              const ytItems = (data.items || [])
                .filter((i) => i.type === "video")
                .map((item) => ({
                  id: item.id,
                  title: item.title,
                  channelTitle: item.channelTitle,
                  length: item.length,
                  isLive: item.isLive,
                  thumbnail:
                    item.thumbnail?.thumbnails?.[0]?.url ||
                    `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
                }));
              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: { type: "yt_search_results", results: ytItems },
              });
            } catch (e) {
              console.error("Client YT Search failed", e);
            }
          })();
          break;

        case "reserve_yt":
          const ytSong = {
            title: d.value.title,
            artist: d.value.artist || d.value.channelTitle,
            path: d.value.path || `yt://${d.value.id}`,
            durationText: d.value.durationText,
            isLive: d.value.isLive,
            code: "YT",
          };
          if (state.mode === "menu") root.playback.startPlayer(ytSong);
          else {
            state.reservationQueue.push(ytSong);
            this.ctx.modules.infoBar.showDefault();
          }
          this.socket.emit("sendData", {
            identity: cmd.identity,
            data: { type: "reserve_response", success: true, song: ytSong },
          });

        case "request_camera_peer":
          const cameraSvc = this.ctx.services.CameraSvc;
          if (cameraSvc) {
            if (cameraSvc.isBusy()) {
              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: {
                  type: "camera_error",
                  message: "Camera is already in use by another user.",
                },
              });
              break;
            }

            cameraSvc.initPeer().then((peerId) => {
              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: { type: "camera_peer_id", peerId },
              });
            });
          }
          break;
        case "request_instrument_peer":
          if (!this.ctx.state.instrumentPeer) {
            this.ctx.state.instrumentPeer = new Peer({ debug: 2 });

            this.ctx.state.instrumentPeer.on("open", (id) => {
              this.socket.emit("sendData", {
                identity: cmd.identity,
                data: { type: "instrument_peer_id", peerId: id },
              });
            });

            this.ctx.state.instrumentPeer.on("connection", (conn) => {
              conn.on("data", (data) => {
                if (
                  data &&
                  (data.type === "note_on" || data.type === "note_off")
                ) {
                  console.log(
                    `[INSTRUMENT] ${data.type.toUpperCase()} | Channel: ${data.channel} | Note: ${data.note} | Velocity: ${data.velocity}`,
                  );
                }
              });
            });

            this.ctx.state.instrumentPeer.on("error", (err) => {
              console.error("[INSTRUMENT] PeerJS Host Error:", err);
            });
          } else {
            this.socket.emit("sendData", {
              identity: cmd.identity,
              data: {
                type: "instrument_peer_id",
                peerId: this.ctx.state.instrumentPeer.id,
              },
            });
          }
          break;
      }
    });
  }

  destroy() {
    window.removeEventListener("resize", this.resizeDanmakuCanvas);
    if (this.danmakuRafId) {
      cancelAnimationFrame(this.danmakuRafId);
      this.danmakuRafId = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
