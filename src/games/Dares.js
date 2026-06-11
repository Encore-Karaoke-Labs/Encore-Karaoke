import Html from "../libs/html.js";

const DEFAULT_DARES = [
  "Sing your next song using a Mickey Mouse voice.",
  "Let the host pick your next song.",
  "You must stand on one leg for the duration of the next singer's song.",
  "Take a shot of a beverage chosen by the highest scorer.",
  "Sing your next song facing away from the screen.",
];

const V_WIDTH = 1920;
const V_HEIGHT = 1080;

// Fisher-Yates Shuffle
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function easeOutCubic(t, b, c, d) {
  t /= d;
  t--;
  return c * (t * t * t + 1) + b;
}

export default class DaresGame {
  constructor(context, manager) {
    this.ctx = context;
    this.manager = manager;
    this.id = "dares";
    this.name = "Karaoke Penalty Dares";
    this.version = "1.1.0";

    this.daresList = [];
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
    this.rollTarget = "";
    this.rollDare = "";
    this.rollStartTime = 0;
    this.isAutoMode = false;

    this.playerWheelEndAngle = 0;
    this.dareWheelEndAngle = 0;
    this.playersCache = [];
    this.daresCache = [];

    this.handlePluginData = this.handlePluginData.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  async init() {
    document.addEventListener(
      "CherryTree.Sessions.PluginData",
      this.handlePluginData,
    );
    const savedDares = await window.config.getItem("games.dares.list");
    this.daresList =
      savedDares && savedDares.length > 0 ? savedDares : [...DEFAULT_DARES];
  }

  onPlaybackStateChange(state, payload) {
    if (state === "playing" && this.isActive) {
      this.handleEscape();
      return;
    }

    if (
      state === "score_screen_end" &&
      this.isAutoMode &&
      this.ctx.services.SessionsSvc.isHost
    ) {
      const lb = this.ctx.services.SessionsSvc.state.leaderboard;
      if (!lb || lb.length < 2) return;

      this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
        action: "open_room",
        dares: this.daresList,
      });
      this.openCanvasRoom(this.daresList);

      setTimeout(() => {
        if (this.isActive && this.view === "menu") {
          this.triggerSpin();
        }
      }, 2000);
    }
  }

  renderSettings(container) {
    const containerElm = container.elm || container;

    new Html("p")
      .text(
        "Karaoke Penalty Dares is a fun mini-game to spice up your session! A random player will be chosen by the wheel to perform a randomly selected dare. Add your own custom dares, spin the wheels, and see who faces the penalty!",
      )
      .styleJs({
        opacity: 0.8,
        padding: "1rem",
        textAlign: "center",
        fontSize: "1.1rem",
        lineHeight: "1.5",
      })
      .appendTo(containerElm);

    new Html("p")
      .text(
        "Click START GAME below to launch the game for everyone in the room.",
      )
      .styleJs({ opacity: 0.5, padding: "0 1rem", textAlign: "center" })
      .appendTo(containerElm);
  }

  saveDares() {
    if (this.daresList.length === 0) this.daresList = [...DEFAULT_DARES];
    window.config.setItem("games.dares.list", this.daresList);
  }

  onHostTrigger() {
    this.ctx.root.sessions.toggleSessionModal(false);
    this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
      action: "open_room",
      dares: this.daresList,
    });
    this.openCanvasRoom(this.daresList);
  }

  handleEscape() {
    if (this.ctx.services.SessionsSvc.isHost) {
      this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
        action: "dismiss",
      });
      this.closeCanvasRoom();
    }
  }

  handlePluginData(e) {
    const { pluginId, payload } = e.detail;
    if (pluginId !== this.id) return;

    switch (payload.action) {
      case "open_room":
        if (!this.ctx.services.SessionsSvc.isHost) {
          this.ctx.root.sessions.toggleSessionModal(false);
          this.openCanvasRoom(payload.dares);
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
      case "add_dare":
        if (this.ctx.services.SessionsSvc.isHost) {
          this.daresList.push(payload.text);
          this.saveDares();
          this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
            action: "sync_dares",
            dares: this.daresList,
          });
        }
        break;
      case "sync_dares":
        this.daresList = payload.dares;
        break;
      case "sync_auto_mode":
        this.isAutoMode = payload.enabled;
        break;
      case "start_sequence":
        this.startSequence(
          payload.targetPlayer,
          payload.targetDare,
          payload.players,
          payload.dares,
          payload.playerEndAngle,
          payload.dareEndAngle,
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

  openCanvasRoom(initialDares) {
    if (initialDares) this.daresList = initialDares;
    this.isActive = true;
    this.view = "menu";
    this.cursors.clear();

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

  openAddDareModal() {
    const containerElm = this.manager.container.elm || this.manager.container;

    const wrap = new Html("div")
      .styleJs({
        position: "absolute",
        inset: 0,
        zIndex: 99999,
        background: "rgba(10, 10, 20, 0.95)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "'Rajdhani', sans-serif",
      })
      .appendTo(containerElm);

    const box = new Html("div")
      .styleJs({
        background: "#141423",
        border: "1px solid #89cff0",
        padding: "2rem",
        borderRadius: "12px",
        width: "100%",
        maxWidth: "500px",
        textAlign: "center",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
      })
      .appendTo(wrap);

    new Html("h2")
      .text("ADD NEW DARE")
      .styleJs({
        color: "#89cff0",
        marginTop: 0,
        fontSize: "2.2rem",
        letterSpacing: "2px",
      })
      .appendTo(box);

    new Html("p")
      .text("Enter a fun penalty for the wheel!")
      .styleJs({
        color: "rgba(255, 255, 255, 0.6)",
        marginBottom: "1.5rem",
        fontSize: "1.1rem",
      })
      .appendTo(box);

    const input = new Html("input")
      .attr({ type: "text", placeholder: "Type a dare here..." })
      .styleJs({
        width: "100%",
        marginBottom: "1.5rem",
        textAlign: "center",
        fontSize: "1.3rem",
        padding: "1rem",
        background: "rgba(0, 0, 0, 0.3)",
        color: "#fff",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "12px",
        boxSizing: "border-box",
        fontFamily: "'Radio Canada', sans-serif",
        outline: "none",
        transition: "border-color 0.2s",
      })
      .appendTo(box);

    input.on("focus", () => input.styleJs({ borderColor: "#89cff0" }));
    input.on("blur", () =>
      input.styleJs({ borderColor: "rgba(255, 255, 255, 0.15)" }),
    );

    const btnRow = new Html("div")
      .styleJs({ display: "flex", gap: "0.75rem", width: "100%" })
      .appendTo(box);

    new Html("button")
      .text("CANCEL")
      .styleJs({
        flex: 1,
        height: "60px",
        fontSize: "1.2rem",
        fontWeight: "700",
        fontFamily: "'Rajdhani', sans-serif",
        background: "rgba(255, 255, 255, 0.05)",
        border: "1px solid rgba(255, 255, 255, 0.15)",
        borderRadius: "12px",
        color: "#fff",
        cursor: "pointer",
        transition: "all 0.15s",
      })
      .on(
        "mouseenter",
        (e) => (e.target.style.background = "rgba(255, 255, 255, 0.1)"),
      )
      .on(
        "mouseleave",
        (e) => (e.target.style.background = "rgba(255, 255, 255, 0.05)"),
      )
      .on("click", () => wrap.cleanup())
      .appendTo(btnRow);

    new Html("button")
      .text("ADD DARE")
      .styleJs({
        flex: 1,
        height: "60px",
        fontSize: "1.2rem",
        fontWeight: "700",
        fontFamily: "'Rajdhani', sans-serif",
        background: "#89cff0",
        border: "none",
        borderRadius: "12px",
        color: "#0a0a14",
        cursor: "pointer",
        transition: "all 0.15s",
      })
      .on("mouseenter", (e) => (e.target.style.filter = "brightness(1.1)"))
      .on("mouseleave", (e) => (e.target.style.filter = "none"))
      .on("click", () => {
        const val = input.getValue().trim();
        if (val) {
          if (this.ctx.services.SessionsSvc.isHost) {
            this.daresList.push(val);
            this.saveDares();
            this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
              action: "sync_dares",
              dares: this.daresList,
            });
          } else {
            this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
              action: "add_dare",
              text: val,
            });
          }
        }
        wrap.cleanup();
      })
      .appendTo(btnRow);

    setTimeout(() => input.elm.focus(), 100);
    input.on("keyup", (e) => {
      if (e.key === "Enter") btnRow.elm.lastChild.click();
    });
  }

  sendCursor(vx, vy) {
    const SessionsSvc = this.ctx.services.SessionsSvc;
    if (!SessionsSvc || !SessionsSvc.peer) return;

    SessionsSvc.broadcastPluginData(this.id, {
      action: "cursor",
      peerId: SessionsSvc.peer.id,
      name: IdentitySvcName(this.ctx),
      x: vx,
      y: vy,
    });
  }

  getColorForPeer(id) {
    if (!id) return "hsl(0, 80%, 60%)";
    let hash = 0;
    for (let i = 0; i < id.length; i++)
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 80%, 60%)`;
  }

  renderLoop() {
    if (!this.isActive) return;
    const ctx = this.ctx2d;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    ctx.fillStyle = "#0a0a19";
    ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);

    ctx.strokeStyle = "rgba(137, 207, 240, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < V_WIDTH; i += 60) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, V_HEIGHT);
      ctx.stroke();
    }
    for (let i = 0; i < V_HEIGHT; i += 60) {
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
    const isHost = this.ctx.services.SessionsSvc.isHost;

    ctx.fillStyle = "#e94560";
    ctx.font = "bold 70px 'Rajdhani', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("KARAOKE PENALTY DARES", V_WIDTH / 2, 120);

    ctx.fillStyle = "#89cff0";
    ctx.font = "24px 'Radio Canada', sans-serif";
    ctx.fillText(
      "Host spins the wheel to select a random dare for a random player!",
      V_WIDTH / 2,
      170,
    );

    const listX = V_WIDTH / 2 - 500;
    let listY = 250;

    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(listX - 30, listY - 40, 1060, 500);
    ctx.strokeStyle = "#89cff0";
    ctx.strokeRect(listX - 30, listY - 40, 1060, 500);

    const visibleDares = this.daresList.slice(0, 9);

    visibleDares.forEach((dare, i) => {
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 24px 'Rajdhani', sans-serif";

      const truncDare = dare.length > 80 ? dare.substring(0, 80) + "..." : dare;
      ctx.fillText(`• ${truncDare}`, listX, listY + i * 50);

      if (isHost) {
        this.drawButton(
          ctx,
          "✕",
          listX + 980,
          listY + i * 50 - 26,
          35,
          35,
          "#ff5555",
          () => {
            this.daresList.splice(i, 1);
            this.saveDares();
            this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
              action: "sync_dares",
              dares: this.daresList,
            });
          },
        );
      }
    });

    if (this.daresList.length > 9) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#89cff0";
      ctx.fillText(
        `...and ${this.daresList.length - 9} more.`,
        listX,
        listY + 440,
      );
    }

    if (isHost) {
      this.drawButton(
        ctx,
        "START SPIN",
        V_WIDTH / 2 - 480,
        800,
        220,
        60,
        "#ffd700",
        () => {
          this.triggerSpin();
        },
      );

      this.drawButton(
        ctx,
        `AUTO: ${this.isAutoMode ? "ON" : "OFF"}`,
        V_WIDTH / 2 - 240,
        800,
        220,
        60,
        this.isAutoMode ? "#55ff55" : "#aaaaaa",
        () => {
          this.isAutoMode = !this.isAutoMode;
          this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
            action: "sync_auto_mode",
            enabled: this.isAutoMode,
          });
        },
      );

      this.drawButton(
        ctx,
        "+ ADD DARE",
        V_WIDTH / 2 + 20,
        800,
        220,
        60,
        "#89cff0",
        () => {
          this.openAddDareModal();
        },
      );

      this.drawButton(
        ctx,
        "CLOSE ROOM",
        V_WIDTH / 2 + 260,
        800,
        220,
        60,
        "#ff5555",
        () => {
          this.handleEscape();
        },
      );
    } else {
      this.drawButton(
        ctx,
        "+ ADD DARE",
        V_WIDTH / 2 - 110,
        800,
        220,
        60,
        "#89cff0",
        () => {
          this.openAddDareModal();
        },
      );
    }
  }

  drawSequence(ctx) {
    const elapsed = Date.now() - this.rollStartTime;
    const PLAYER_DUR = 5000;
    const PAUSE_DUR = 2500;
    const DARE_DUR = 5000;

    if (elapsed < PLAYER_DUR + PAUSE_DUR) {
      let currentAngle = this.playerWheelEndAngle;
      let isSpinning = false;

      if (elapsed < PLAYER_DUR) {
        currentAngle = easeOutCubic(
          elapsed,
          0,
          this.playerWheelEndAngle,
          PLAYER_DUR,
        );
        isSpinning = true;
      }

      this.drawGenericWheel(
        ctx,
        "WHO WILL FACE THE PENALTY?",
        isSpinning
          ? "SPINNING..."
          : `TARGET ACQUIRED: ${this.rollTarget.toUpperCase()}`,
        this.playersCache,
        currentAngle,
        isSpinning,
      );
    } else if (elapsed < PLAYER_DUR + PAUSE_DUR + DARE_DUR) {
      const dareElapsed = elapsed - (PLAYER_DUR + PAUSE_DUR);
      let currentAngle = this.dareWheelEndAngle;
      let isSpinning = false;

      if (dareElapsed < DARE_DUR) {
        currentAngle = easeOutCubic(
          dareElapsed,
          0,
          this.dareWheelEndAngle,
          DARE_DUR,
        );
        isSpinning = true;
      }

      this.drawGenericWheel(
        ctx,
        "WHAT IS THEIR FATE?",
        isSpinning ? "SPINNING..." : "PENALTY SELECTED!",
        this.daresCache,
        currentAngle,
        isSpinning,
        true,
      );
    } else {
      this.view = "result";
      if (this.ctx.services.SessionsSvc.isHost) {
        this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
          action: "show_result",
        });
      }
    }
  }

  drawGenericWheel(
    ctx,
    title,
    subtitle,
    items,
    currentAngle,
    isSpinning,
    isDare = false,
  ) {
    const cx = V_WIDTH / 2;
    const cy = 520;
    const radius = 350;

    ctx.textAlign = "center";
    ctx.fillStyle = "#ff5555";
    ctx.font = "bold 60px 'Rajdhani', sans-serif";
    ctx.fillText(title, cx, 100);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(currentAngle);

    const numSlices = items.length;
    const sliceAngle = (Math.PI * 2) / numSlices;

    for (let i = 0; i < numSlices; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, i * sliceAngle, (i + 1) * sliceAngle);
      ctx.closePath();

      // Alternate colors, prevent last slice from matching first if odd
      ctx.fillStyle = i % 2 === 0 ? "#1a1a3a" : "#e94560";
      if (numSlices % 2 !== 0 && i === numSlices - 1) ctx.fillStyle = "#89cff0";

      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.rotate(i * sliceAngle + sliceAngle / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 24px 'Rajdhani', sans-serif";

      let text = items[i];
      if (isDare && text.length > 22) text = text.substring(0, 20) + "...";

      ctx.fillText(text, radius - 20, 8);
      ctx.restore();
    }
    ctx.restore();

    // Wheel Pointer (Top Center)
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy - radius - 20);
    ctx.lineTo(cx + 20, cy - radius - 20);
    ctx.lineTo(cx, cy - radius + 20);
    ctx.closePath();
    ctx.fillStyle = "#ffd700";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    // Bottom Status Box
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(cx - 500, cy + 390, 1000, 100);
    ctx.strokeStyle = "#89cff0";
    ctx.lineWidth = 3;
    ctx.strokeRect(cx - 500, cy + 390, 1000, 100);

    ctx.fillStyle = isSpinning ? "#fff" : "#ffd700";
    ctx.font = "bold 40px 'Rajdhani', sans-serif";
    ctx.fillText(subtitle, cx, cy + 455);
  }

  drawResult(ctx) {
    ctx.textAlign = "center";

    ctx.fillStyle = "#ff5555";
    ctx.font = "bold 90px 'Rajdhani', sans-serif";
    ctx.fillText("PENALTY SELECTED!", V_WIDTH / 2, V_HEIGHT / 2 - 200);

    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 120px 'Rajdhani', sans-serif";
    ctx.fillText(this.rollTarget.toUpperCase(), V_WIDTH / 2, V_HEIGHT / 2 - 40);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 50px 'Radio Canada', sans-serif";

    const maxWidth = 1400;
    const words = `"${this.rollDare}"`.split(" ");
    let line = "";
    let y = V_HEIGHT / 2 + 100;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + " ";
      if (ctx.measureText(testLine).width > maxWidth && n > 0) {
        ctx.fillText(line, V_WIDTH / 2, y);
        line = words[n] + " ";
        y += 60;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, V_WIDTH / 2, y);

    if (this.ctx.services.SessionsSvc.isHost) {
      this.drawButton(
        ctx,
        "BACK TO MENU",
        V_WIDTH / 2 - 200,
        V_HEIGHT / 2 + 300,
        400,
        70,
        "#89cff0",
        () => {
          this.view = "menu";
          this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
            action: "back_to_menu",
          });
        },
      );
    }
  }

  drawCursors(ctx) {
    for (let [peerId, cursor] of this.cursors.entries()) {
      if (peerId === this.ctx.services.SessionsSvc.peer?.id) continue;
      this.renderSingleCursor(
        ctx,
        cursor.x,
        cursor.y,
        cursor.color,
        cursor.name,
      );
    }
    const myName = IdentitySvcName(this.ctx);
    const myColor = this.getColorForPeer(
      this.ctx.services.SessionsSvc.peer?.id,
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

    if (text === "✕") {
      const pad = 12;
      ctx.beginPath();
      ctx.moveTo(x + pad, y + pad);
      ctx.lineTo(x + w - pad, y + h - pad);
      ctx.moveTo(x + w - pad, y + pad);
      ctx.lineTo(x + pad, y + h - pad);
      ctx.strokeStyle = isHovered ? "#000" : color;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.fillStyle = isHovered ? "#000" : color;
      ctx.font = "bold 28px 'Rajdhani', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + w / 2, y + h / 2 + 2);
      ctx.textBaseline = "alphabetic";
    }

    this.activeButtons.push({ x, y, w, h, onClick });
  }

  triggerSpin() {
    const SessionsSvc = this.ctx.services.SessionsSvc;

    let parts = SessionsSvc.state.participants.map((p) => p.nickname);
    if (parts.length === 0)
      parts = ["Player 1", "Player 2", "Player 3", "Player 4"];

    let targetName = parts[Math.floor(Math.random() * parts.length)];

    const lb = SessionsSvc.state.leaderboard;
    if (lb && lb.length > 0) {
      const lowestScorer = lb[lb.length - 1].singerName;
      if (!parts.includes(lowestScorer)) {
        parts.push(lowestScorer);
      }
      targetName = lowestScorer;
    }

    const targetPlayerIndex = parts.indexOf(targetName);

    const daresDeck = shuffleArray(this.daresList);
    if (daresDeck.length === 0) daresDeck.push("Take a shot!");

    const targetDareIndex = Math.floor(Math.random() * daresDeck.length);
    const dare = daresDeck[targetDareIndex];

    const pSliceAngle = (Math.PI * 2) / parts.length;
    const pTargetRotation =
      -Math.PI / 2 - (targetPlayerIndex * pSliceAngle + pSliceAngle / 2);
    const pFinalAngle = pTargetRotation - Math.PI * 2 * 6;

    const dSliceAngle = (Math.PI * 2) / daresDeck.length;
    const dTargetRotation =
      -Math.PI / 2 - (targetDareIndex * dSliceAngle + dSliceAngle / 2);
    const dFinalAngle = dTargetRotation - Math.PI * 2 * 6;

    const startTime = Date.now();

    SessionsSvc.broadcastPluginData(this.id, {
      action: "start_sequence",
      targetPlayer: targetName,
      targetDare: dare,
      players: parts,
      dares: daresDeck,
      playerEndAngle: pFinalAngle,
      dareEndAngle: dFinalAngle,
      startTime: startTime,
    });

    this.startSequence(
      targetName,
      dare,
      parts,
      daresDeck,
      pFinalAngle,
      dFinalAngle,
      startTime,
    );
  }

  startSequence(player, dare, players, dares, pEnd, dEnd, startTime) {
    this.rollTarget = player;
    this.rollDare = dare;
    this.playersCache = players;
    this.daresCache = dares;
    this.playerWheelEndAngle = pEnd;
    this.dareWheelEndAngle = dEnd;
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

function IdentitySvcName(ctx) {
  try {
    const peerId = ctx.services.SessionsSvc.peer?.id;
    if (!peerId) return ctx.services.Identity.getProfile().nickname || "Player";
    const p = ctx.services.SessionsSvc.state.participants.find(
      (p) => p.id === peerId,
    );
    return p
      ? p.nickname
      : ctx.services.Identity.getProfile().nickname || "Player";
  } catch (e) {
    return "Player";
  }
}
