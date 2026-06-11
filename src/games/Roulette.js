import Html from "../libs/html.js";

const V_WIDTH = 1920;
const V_HEIGHT = 1080;

export default class RouletteGame {
  constructor(context, manager) {
    this.ctx = context;
    this.manager = manager;
    this.id = "roulette";
    this.name = "Karaoke Roulette";
    this.version = "1.0.0";

    this.cursors = new Map(); // peerId -> { x, y, name, color }

    // Canvas & Coordinate State
    this.canvas = null;
    this.ctx2d = null;
    this.rafId = null;
    this.isActive = false;
    this.activeButtons = [];
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Mouse Tracking & Sync
    this.localMouse = { x: -100, y: -100 };
    this.lastSentMouse = { x: -100, y: -100 };
    this.cursorTick = null;

    // Game Sequence State
    this.view = "menu"; // 'menu', 'sequence', 'result'
    this.rollTargetSong = null;
    this.rollStartTime = 0;

    this.songsCache = [];

    this.handlePluginData = this.handlePluginData.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  async init() {
    document.addEventListener(
      "CherryTree.Sessions.PluginData",
      this.handlePluginData,
    );
  }

  onPlaybackStateChange(state, payload) {
    if (state === "playing" && this.isActive) {
      this.handleEscape();
    }
  }

  onHostTrigger() {
    this.ctx.root.sessions.toggleSessionModal(false);
    if (this.ctx.state.isSessionActive) {
      this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
        action: "open_room",
      });
    }
    this.openCanvasRoom();
  }

  handleEscape() {
    if (
      this.ctx.state.isSessionActive &&
      this.ctx.services.SessionsSvc?.isHost
    ) {
      this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
        action: "dismiss",
      });
    }
    this.closeCanvasRoom();
  }

  handlePluginData(e) {
    const { pluginId, payload } = e.detail;
    if (pluginId !== this.id) return;

    switch (payload.action) {
      case "open_room":
        if (!this.ctx.services.SessionsSvc.isHost) {
          this.ctx.root.sessions.toggleSessionModal(false);
          this.openCanvasRoom();
        }
        break;
      case "cursor":
        this.cursors.set(payload.peerId, {
          x: payload.x,
          y: payload.y,
          name: payload.name,
          color: this.getColorForPeer(payload.peerId),
        });
        break;
      case "start_sequence":
        this.startSequence(
          payload.targetSong,
          payload.songsCache,
          payload.startTime,
        );
        break;
      case "show_result":
        this.view = "result";
        break;
      case "back_to_menu":
        this.view = "menu";
        break;
      case "dismiss":
        this.closeCanvasRoom();
        break;
    }
  }

  openCanvasRoom() {
    this.isActive = true;
    this.view = "menu";
    this.cursors.clear();

    // Cache local songs only (filter out YouTube to avoid networking issues during the game)
    const allSongs = this.ctx.state.songList || [];
    this.songsCache = allSongs.filter(
      (s) => s.path && !s.path.startsWith("yt://"),
    );

    this.manager.showOverlay(this.id);
    const container = this.manager.container;
    container.clear();

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.cursor = "none";
    container.elm.appendChild(this.canvas);
    this.ctx2d = this.canvas.getContext("2d");

    window.addEventListener("resize", this.handleResize);
    this.handleResize();

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const physicalX = e.clientX - rect.left;
      const physicalY = e.clientY - rect.top;
      this.localMouse.x = (physicalX - this.offsetX) / this.scale;
      this.localMouse.y = (physicalY - this.offsetY) / this.scale;
    });

    this.canvas.addEventListener("click", () => {
      for (let btn of this.activeButtons) {
        if (
          this.localMouse.x >= btn.x &&
          this.localMouse.x <= btn.x + btn.w &&
          this.localMouse.y >= btn.y &&
          this.localMouse.y <= btn.y + btn.h
        ) {
          if (
            this.ctx.services.Forte &&
            typeof this.ctx.services.Forte.playSfx === "function"
          ) {
            this.ctx.services.Forte.playSfx("/assets/audio/nav.wav", 0.5);
          }
          btn.onClick();
          break;
        }
      }
    });

    this.cursorTick = setInterval(() => {
      if (
        this.localMouse.x !== this.lastSentMouse.x ||
        this.localMouse.y !== this.lastSentMouse.y
      ) {
        this.sendCursor(this.localMouse.x, this.localMouse.y);
        this.lastSentMouse = { ...this.localMouse };
      }
    }, 16);

    this.rafId = requestAnimationFrame(() => this.renderLoop());
  }

  closeCanvasRoom() {
    this.isActive = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.cursorTick) clearInterval(this.cursorTick);
    window.removeEventListener("resize", this.handleResize);
    this.manager.hideOverlay();
  }

  handleResize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    this.scale = Math.min(
      this.canvas.width / V_WIDTH,
      this.canvas.height / V_HEIGHT,
    );
    this.offsetX = (this.canvas.width - V_WIDTH * this.scale) / 2;
    this.offsetY = (this.canvas.height - V_HEIGHT * this.scale) / 2;
  }

  sendCursor(vx, vy) {
    if (!this.ctx.state.isSessionActive) return; // Don't send cursor if offline
    const SessionsSvc = this.ctx.services.SessionsSvc;
    if (!SessionsSvc || !SessionsSvc.peer) return;

    SessionsSvc.broadcastPluginData(this.id, {
      action: "cursor",
      peerId: SessionsSvc.peer.id,
      name: this.getIdentityName(),
      x: vx,
      y: vy,
    });
  }

  getColorForPeer(id) {
    if (!id) return "hsl(0, 80%, 60%)";
    let hash = 0;
    for (let i = 0; i < id.length; i++)
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 80%, 60%)`;
  }

  getIdentityName() {
    try {
      const peerId = this.ctx.services.SessionsSvc?.peer?.id;
      if (!peerId)
        return (
          this.ctx.services.Identity.getProfile().nickname || "Local Player"
        );
      const p = this.ctx.services.SessionsSvc.state.participants.find(
        (p) => p.id === peerId,
      );
      return p
        ? p.nickname
        : this.ctx.services.Identity.getProfile().nickname || "Player";
    } catch (e) {
      return "Player";
    }
  }

  renderLoop() {
    if (!this.isActive) return;
    const ctx = this.ctx2d;

    // Background clearing
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Deep space background with glowing grid
    ctx.fillStyle = "#05050A";
    ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

    ctx.strokeStyle = "rgba(137, 207, 240, 0.05)";
    ctx.lineWidth = 2;
    for (let i = 0; i < V_WIDTH; i += 80) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, V_HEIGHT);
      ctx.stroke();
    }
    for (let i = 0; i < V_HEIGHT; i += 80) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(V_WIDTH, i);
      ctx.stroke();
    }

    this.activeButtons = [];

    if (this.view === "menu") this.drawMenu(ctx);
    else if (this.view === "sequence") this.drawSequence(ctx);
    else if (this.view === "result") this.drawResult(ctx);

    this.drawCursors(ctx);
    ctx.restore();

    this.rafId = requestAnimationFrame(() => this.renderLoop());
  }

  drawMenu(ctx) {
    const isHost =
      !this.ctx.state.isSessionActive || this.ctx.services.SessionsSvc.isHost;

    ctx.fillStyle = "#89cff0";
    ctx.font = "bold 90px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "#89cff0";
    ctx.shadowBlur = 20;
    ctx.fillText("KARAOKE ROULETTE", V_WIDTH / 2, V_HEIGHT / 2 - 150);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#fff";
    ctx.font = "30px 'Radio Canada', sans-serif";
    ctx.fillText(
      "Let fate decide. A completely random song will be chosen.",
      V_WIDTH / 2,
      V_HEIGHT / 2 - 50,
    );

    if (this.songsCache.length === 0) {
      ctx.fillStyle = "#ff5555";
      ctx.fillText(
        "Error: No local songs found in library!",
        V_WIDTH / 2,
        V_HEIGHT / 2 + 50,
      );
      return;
    }

    if (isHost) {
      this.drawButton(
        ctx,
        "START ROULETTE",
        V_WIDTH / 2 - 425,
        V_HEIGHT / 2 + 150,
        400,
        70,
        "#ffd700",
        () => {
          this.triggerSpin();
        },
      );

      this.drawButton(
        ctx,
        "CLOSE ROOM",
        V_WIDTH / 2 + 25,
        V_HEIGHT / 2 + 150,
        400,
        70,
        "#ff5555",
        () => {
          this.handleEscape();
        },
      );
    } else {
      ctx.fillStyle = "#ffd700";
      ctx.font = "bold 40px 'Rajdhani', sans-serif";
      ctx.fillText(
        "WAITING FOR HOST TO SPIN...",
        V_WIDTH / 2,
        V_HEIGHT / 2 + 150,
      );
    }
  }

  drawSequence(ctx) {
    const elapsed = Date.now() - this.rollStartTime;
    const SEQUENCE_TIME = 4000;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    let displaySongCode = "00000";
    let displaySongTitle = "Searching Database...";

    if (elapsed < SEQUENCE_TIME) {
      const randomIdx = Math.floor(elapsed / 50) % this.songsCache.length;
      displaySongCode = this.songsCache[randomIdx].code || "?????";
      displaySongTitle = this.songsCache[randomIdx].title;
    } else {
      this.view = "result";
      if (
        this.ctx.state.isSessionActive &&
        this.ctx.services.SessionsSvc.isHost
      ) {
        this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
          action: "show_result",
        });
      }
      return;
    }

    ctx.font = "bold 70px 'Rajdhani', sans-serif";
    ctx.fillStyle = "#aaaaaa";
    ctx.fillText("WHAT ARE WE SINGING?", V_WIDTH / 2, V_HEIGHT / 2 - 150);

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(V_WIDTH / 2 - 150, V_HEIGHT / 2 - 50, 300, 100);
    ctx.strokeStyle = "#aaaaaa";
    ctx.lineWidth = 3;
    ctx.strokeRect(V_WIDTH / 2 - 150, V_HEIGHT / 2 - 50, 300, 100);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 70px 'Rajdhani', sans-serif";
    ctx.fillText(displaySongCode, V_WIDTH / 2, V_HEIGHT / 2 + 5);

    ctx.font = "bold 80px 'Radio Canada', sans-serif";

    let renderTitle = displaySongTitle;
    if (ctx.measureText(renderTitle).width > V_WIDTH - 200) {
      renderTitle = renderTitle.substring(0, 40) + "...";
    }
    ctx.fillText(renderTitle, V_WIDTH / 2, V_HEIGHT / 2 + 150);
  }

  drawResult(ctx) {
    const isHost =
      !this.ctx.state.isSessionActive || this.ctx.services.SessionsSvc.isHost;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "bold 80px 'Rajdhani', sans-serif";
    ctx.fillStyle = "#89cff0";
    ctx.shadowColor = "#89cff0";
    ctx.shadowBlur = 20;
    ctx.fillText("SONG SELECTED!", V_WIDTH / 2, V_HEIGHT / 2 - 200);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(V_WIDTH / 2 - 150, V_HEIGHT / 2 - 50, 300, 100);
    ctx.strokeStyle = "#ffd700";
    ctx.lineWidth = 4;
    ctx.strokeRect(V_WIDTH / 2 - 150, V_HEIGHT / 2 - 50, 300, 100);

    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 70px 'Rajdhani', sans-serif";
    ctx.fillText(
      this.rollTargetSong.code || "?????",
      V_WIDTH / 2,
      V_HEIGHT / 2 + 5,
    );

    ctx.fillStyle = "#fff";
    ctx.font = "bold 80px 'Radio Canada', sans-serif";

    let renderTitle = this.rollTargetSong.title;
    if (ctx.measureText(renderTitle).width > V_WIDTH - 200) {
      renderTitle = renderTitle.substring(0, 40) + "...";
    }
    ctx.fillText(renderTitle, V_WIDTH / 2, V_HEIGHT / 2 + 150);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 40px 'Radio Canada', sans-serif";
    ctx.fillText(
      this.rollTargetSong.artist || "Unknown Artist",
      V_WIDTH / 2,
      V_HEIGHT / 2 + 230,
    );

    if (isHost) {
      this.drawButton(
        ctx,
        "PLAY SONG",
        V_WIDTH / 2 - 400,
        V_HEIGHT / 2 + 350,
        350,
        70,
        "#55ff55",
        () => {
          if (this.ctx.state.isSessionActive) {
            this.ctx.root.sessions.reserveSongInSession(this.rollTargetSong);
          } else {
            this.ctx.root.playback.startPlayer(this.rollTargetSong);
          }
          this.handleEscape();
        },
      );

      this.drawButton(
        ctx,
        "BACK TO MENU",
        V_WIDTH / 2 + 50,
        V_HEIGHT / 2 + 350,
        350,
        70,
        "#ff5555",
        () => {
          this.view = "menu";
          if (this.ctx.state.isSessionActive) {
            this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
              action: "back_to_menu",
            });
          }
        },
      );
    }
  }

  drawCursors(ctx) {
    for (let [peerId, cursor] of this.cursors.entries()) {
      if (peerId === this.ctx.services.SessionsSvc?.peer?.id) continue;
      this.renderSingleCursor(
        ctx,
        cursor.x,
        cursor.y,
        cursor.color,
        cursor.name,
      );
    }
    const myName = this.getIdentityName();
    const myColor = this.getColorForPeer(
      this.ctx.services.SessionsSvc?.peer?.id,
    );
    this.renderSingleCursor(
      ctx,
      this.localMouse.x,
      this.localMouse.y,
      myColor,
      myName,
    );
  }

  renderSingleCursor(ctx, x, y, color, name) {
    if (x < 0 || y < 0) return;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20, y + 20);
    ctx.lineTo(x + 7, y + 20);
    ctx.lineTo(x, y + 32);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.font = "16px sans-serif";
    const tw = ctx.measureText(name).width;
    ctx.fillRect(x + 20, y + 24, tw + 16, 26);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.fillText(name, x + 28, y + 43);
  }

  drawButton(ctx, text, x, y, w, h, color, onClick) {
    const isHovered =
      this.localMouse.x >= x &&
      this.localMouse.x <= x + w &&
      this.localMouse.y >= y &&
      this.localMouse.y <= y + h;

    ctx.fillStyle = isHovered ? color : "rgba(0,0,0,0.8)";
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = isHovered ? "#fff" : color;
    ctx.lineWidth = isHovered ? 4 : 2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = isHovered ? "#000" : color;
    ctx.font = "bold 32px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2 + 4);

    this.activeButtons.push({ x, y, w, h, onClick });
  }

  triggerSpin() {
    const randomSong =
      this.songsCache[Math.floor(Math.random() * this.songsCache.length)];
    const startTime = Date.now();

    const networkSongsCache = Array.from({ length: 50 }, () => {
      const s =
        this.songsCache[Math.floor(Math.random() * this.songsCache.length)];
      return { title: s.title, code: s.code };
    });

    if (this.ctx.state.isSessionActive) {
      this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
        action: "start_sequence",
        targetSong: {
          title: randomSong.title,
          code: randomSong.code,
          artist: randomSong.artist,
          path: randomSong.path,
        },
        songsCache: networkSongsCache,
        startTime: startTime,
      });
    }

    this.startSequence(randomSong, networkSongsCache, startTime);
  }

  startSequence(song, songsCache, startTime) {
    this.rollTargetSong = song;
    this.songsCache = songsCache;
    this.rollStartTime = startTime || Date.now();
    this.view = "sequence";
  }

  destroy() {
    document.removeEventListener(
      "CherryTree.Sessions.PluginData",
      this.handlePluginData,
    );
    this.closeCanvasRoom();
  }
}
