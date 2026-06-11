import Html from "../../../libs/html.js";

export default class GamesManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;
    this.loadedGames = new Map();
    this.container = null;
    this.isVisible = false;
    this.activeGameId = null;

    this.boundKeydown = (e) => {
      if (!this.isVisible) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();

        if (this.activeGameId && this.loadedGames.has(this.activeGameId)) {
          const game = this.loadedGames.get(this.activeGameId);
          if (typeof game.handleEscape === "function") {
            game.handleEscape();
            return;
          }
        }
        this.hideOverlay();
      } else {
        if (this.activeGameId && this.loadedGames.has(this.activeGameId)) {
          const game = this.loadedGames.get(this.activeGameId);
          if (typeof game.handleKeyDown === "function") {
            game.handleKeyDown(e);
          }
        }
      }
    };
  }

  async init() {
    this.container = new Html("div")
      .classOn("games-api-container", "hidden")
      .styleJs({
        position: "absolute",
        inset: "0",
        zIndex: "500000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.9)",
        backdropFilter: "blur(15px)",
      })
      .appendTo(this.ctx.wrapper.elm);

    window.addEventListener("keydown", this.boundKeydown, true);

    const gamesToLoad = this.ctx.config.enabledGames || ["/games/Dares.js"];
    console.log("[GAMES] Loading games");

    for (const gamePath of gamesToLoad) {
      try {
        const GameModule = await import(gamePath);
        const gameInstance = new GameModule.default(this.ctx, this);
        await gameInstance.init();
        this.loadedGames.set(gameInstance.id, gameInstance);
        console.log(`[GAMES API] Successfully loaded: ${gameInstance.name}`);
      } catch (e) {
        console.error(`[GAMES API] Failed to load game at ${gamePath}:`, e);
      }
    }
  }

  getAvailableGames() {
    const gamesList = [];
    for (const [id, instance] of this.loadedGames.entries()) {
      gamesList.push({
        id,
        name: instance.name || id,
        version: instance.version || "1.0.0",
        instance,
      });
    }
    return gamesList;
  }

  showOverlay(gameId) {
    this.activeGameId = gameId;
    this.container.classOff("hidden");
    this.isVisible = true;
  }

  hideOverlay() {
    if (this.container) {
      this.container.classOn("hidden");
      this.container.clear();
    }
    this.isVisible = false;
    this.activeGameId = null;
  }

  destroy() {
    window.removeEventListener("keydown", this.boundKeydown, true);
    for (const game of this.loadedGames.values()) {
      if (typeof game.destroy === "function") game.destroy();
    }
    this.loadedGames.clear();
    if (this.container) this.container.cleanup();
  }
}
