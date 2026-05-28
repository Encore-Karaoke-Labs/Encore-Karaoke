import Html from "../../../libs/html.js";

export default class GamesManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;
    this.loadedGames = new Map();
    this.container = null;
  }

  async init() {
    this.container = new Html("div")
      .classOn("games-api-container", "hidden")
      .styleJs({
        position: "absolute",
        inset: "0",
        zIndex: "500",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.8)",
        backdropFilter: "blur(8px)",
      })
      .appendTo(this.ctx.wrapper);

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

  showOverlay() {
    this.container.classOff("hidden");
  }

  hideOverlay() {
    this.container.classOn("hidden");
    this.container.clear();
  }

  getAvailableGames() {
    const gamesList = [];
    for (const [id, instance] of this.loadedGames.entries()) {
      gamesList.push({ id, name: instance.name || id, instance });
    }
    return gamesList;
  }

  destroy() {
    for (const game of this.loadedGames.values()) {
      if (typeof game.destroy === "function") game.destroy();
    }
    this.loadedGames.clear();
    if (this.container) this.container.cleanup();
  }
}
