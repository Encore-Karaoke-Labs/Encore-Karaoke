import Html from "../libs/html.js";

const DEFAULT_DARES = [
  "Sing your next song using a Mickey Mouse voice.",
  "Let the host pick your next song.",
  "You must stand on one leg for the duration of the next singer's song.",
  "Take a shot of a beverage chosen by the highest scorer.",
  "Sing your next song facing away from the screen.",
];

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default class DaresGame {
  constructor(context, manager) {
    this.ctx = context;
    this.manager = manager;
    this.id = "dares";
    this.name = "Karaoke Penalty Dares";

    this.daresList = [];
    this.daresDeck = [];

    this.handlePluginData = this.handlePluginData.bind(this);
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

  renderSettings(container) {
    const listWrapper = new Html("div")
      .styleJs({
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        marginBottom: "1.5rem",
      })
      .appendTo(container.elm);

    const renderList = () => {
      listWrapper.clear();
      this.daresList.forEach((dare, index) => {
        const row = new Html("div")
          .styleJs({ display: "flex", gap: "0.5rem", alignItems: "center" })
          .appendTo(listWrapper);

        const input = new Html("input")
          .attr({ type: "text" })
          .classOn("session-input")
          .styleJs({
            flex: "1",
            fontSize: "1.1rem",
            padding: "0.5rem",
            textAlign: "left",
          })
          .appendTo(row);
        input.elm.value = dare;

        input.on("change", () => {
          if (input.elm.value.trim() === "") {
            this.daresList.splice(index, 1);
          } else {
            this.daresList[index] = input.elm.value.trim();
          }
          this.saveDares();
          renderList();
        });

        new Html("button")
          .text("✕")
          .classOn("session-btn", "danger")
          .styleJs({ flex: "none", width: "40px", padding: "0" })
          .on("click", () => {
            this.daresList.splice(index, 1);
            this.saveDares();
            renderList();
          })
          .appendTo(row);
      });
    };

    renderList();

    new Html("button")
      .text("+ ADD NEW DARE")
      .classOn("session-btn")
      .styleJs({ width: "100%" })
      .on("click", () => {
        this.daresList.push("New Penalty Dare");
        this.saveDares();
        renderList();
        container.elm.scrollTop = container.elm.scrollHeight;
      })
      .appendTo(container.elm);
  }

  saveDares() {
    if (this.daresList.length === 0) this.daresList = [...DEFAULT_DARES];
    window.config.setItem("games.dares.list", this.daresList);
    this.daresDeck = [];
  }

  onHostTrigger() {
    const SessionsSvc = this.ctx.services.SessionsSvc;
    const leaderboard = SessionsSvc.state.leaderboard;

    if (leaderboard.length < 1) {
      this.ctx.modules.infoBar.showTemp(
        "GAMES",
        "Not enough scores to target someone!",
        3000,
      );
      return;
    }

    this.ctx.root.sessions.toggleSessionModal(false);

    const lowestScorer = leaderboard[leaderboard.length - 1];

    if (this.daresDeck.length === 0) {
      this.daresDeck = shuffleArray(this.daresList);
    }
    const selectedDare = this.daresDeck.pop();

    SessionsSvc.broadcastPluginData(this.id, {
      action: "start_animation",
      targetName: lowestScorer.singerName,
      dareText: selectedDare,
    });
  }

  handleEscape() {
    this.ctx.services.SessionsSvc.broadcastPluginData(this.id, {
      action: "dismiss",
    });
  }

  handlePluginData(e) {
    const { pluginId, payload } = e.detail;
    if (pluginId !== this.id) return;

    if (payload.action === "start_animation") {
      this.runAnimationSequence(payload.targetName, payload.dareText);
    } else if (payload.action === "dismiss") {
      this.manager.hideOverlay();
    }
  }

  runAnimationSequence(targetName, dareText) {
    this.manager.showOverlay(this.id);
    const container = this.manager.container;
    container.clear();

    const wrapper = new Html("div")
      .styleJs({
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        textAlign: "center",
        fontFamily: "'Rajdhani', sans-serif",
      })
      .appendTo(container.elm);

    const title = new Html("h1")
      .text("KARAOKE PENALTY")
      .styleJs({
        fontSize: "5rem",
        color: "#e94560",
        letterSpacing: "10px",
        textShadow: "0 0 20px #e94560",
        marginBottom: "2rem",
      })
      .appendTo(wrapper);

    const rollingText = new Html("div")
      .styleJs({
        fontSize: "4rem",
        color: "#fff",
        fontWeight: "bold",
        background: "rgba(0,0,0,0.5)",
        padding: "1rem 4rem",
        borderRadius: "20px",
        border: "2px solid #89cff0",
        width: "80%",
        maxWidth: "1000px",
        height: "120px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      })
      .appendTo(wrapper);

    const participants = this.ctx.services.SessionsSvc.state.participants.map(
      (p) => p.nickname,
    );
    if (participants.length === 0)
      participants.push("Player 1", "Player 2", "Player 3");

    let ticks = 0;
    const sfx = this.ctx.services.Forte;

    const targetInterval = setInterval(() => {
      rollingText.text(participants[ticks % participants.length]);
      sfx.playSfx("/assets/audio/nav.wav", 0.5);
      ticks++;

      if (ticks > 30) {
        clearInterval(targetInterval);

        rollingText.text(`🎯 ${targetName.toUpperCase()} 🎯`).styleJs({
          color: "#ffd700",
          borderColor: "#ffd700",
          transform: "scale(1.1)",
          transition: "transform 0.3s ease",
        });

        setTimeout(
          () => this.rollForDare(wrapper, rollingText, dareText),
          2000,
        );
      }
    }, 60);
  }

  rollForDare(wrapper, rollingText, dareText) {
    rollingText.styleJs({
      color: "#fff",
      borderColor: "#89cff0",
      transform: "scale(1)",
    });
    let ticks = 0;
    const sfx = this.ctx.services.Forte;

    const dareInterval = setInterval(() => {
      rollingText.text(this.daresList[ticks % this.daresList.length]);
      sfx.playSfx("/assets/audio/nav.wav", 0.5);
      ticks++;

      if (ticks > 40) {
        clearInterval(dareInterval);

        rollingText.styleJs({
          height: "auto",
          minHeight: "150px",
          color: "#ff5555",
          borderColor: "#ff5555",
          transform: "scale(1.2)",
          transition: "all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        });
        rollingText.text(dareText);

        setTimeout(() => {
          new Html("p")
            .text("Press ESC or click below to dismiss")
            .styleJs({
              marginTop: "3rem",
              opacity: "0.5",
              fontSize: "1.2rem",
              fontFamily: "'Radio Canada', sans-serif",
            })
            .appendTo(wrapper);
          new Html("button")
            .text("ACCEPT FATE")
            .classOn("session-btn")
            .styleJs({
              marginTop: "1rem",
              borderColor: "#ff5555",
              color: "#ff5555",
            })
            .on("click", () => {
              this.handleEscape();
            })
            .appendTo(wrapper);
        }, 1500);
      }
    }, 50);
  }

  destroy() {
    document.removeEventListener(
      "CherryTree.Sessions.PluginData",
      this.handlePluginData,
    );
  }
}
