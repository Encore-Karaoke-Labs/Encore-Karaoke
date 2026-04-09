import Html from "/libs/html.js";

/**
 * ScoreHUDModule - Manages the on-screen score display during karaoke sessions
 */
export class ScoreHUDModule {
  /**
   * Initializes the score HUD module
   */
  constructor() {
    this.hud = null;
    this.scoreDisplay = null;
  }

  /**
   * Mounts the score HUD into the specified container
   * @param {HTMLElement} container - The DOM element to mount the HUD into
   */
  mount(container) {
    this.hud = new Html("div").classOn("score-hud").appendTo(container);
    new Html("div").classOn("score-hud-label").text("SCORE").appendTo(this.hud);
    this.scoreDisplay = new Html("div")
      .classOn("score-hud-value")
      .appendTo(this.hud);
    this.hide();
  }

  /**
   * Displays the score HUD with the provided score value
   * @param {number} score - The score to display
   */
  show(score) {
    this.scoreDisplay.text(Math.floor(score));
    this.hud.classOn("visible");
  }

  /**
   * Hides the score HUD from view
   */
  hide() {
    this.hud.classOff("visible");
  }
}
