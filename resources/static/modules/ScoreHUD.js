import Html from "/libs/html.js";

export class ScoreHUDModule {
  constructor() {
    this.hud = null;
    this.scoreDisplay = null;
  }
  mount(container) {
    this.hud = new Html("div").classOn("score-hud").appendTo(container);
    new Html("div").classOn("score-hud-label").text("SCORE").appendTo(this.hud);
    this.scoreDisplay = new Html("div")
      .classOn("score-hud-value")
      .appendTo(this.hud);
    this.hide();
  }
  show(score) {
    this.scoreDisplay.text(Math.floor(score));
    this.hud.classOn("visible");
  }
  hide() {
    this.hud.classOff("visible");
  }
}
