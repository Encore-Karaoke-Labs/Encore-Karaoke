import Html from "/libs/html.js";
import langManager from "../../libs/l10n/manager.js";

let wrapper;

const pkg = {
  name: "Boot Manager",
  type: "app",
  privs: 1,
  start: async function (Root) {
    console.log("[BootManager] Started", Root);
    const loadingScreen = document.querySelector("#loading");
    if (loadingScreen) loadingScreen.remove();

    document.body.style.backgroundColor = "black";

    // --- Create Main UI Wrapper ---
    wrapper = new Html("div")
      .class("flex")
      .styleJs({
        width: "100%",
        height: "100%",
        position: "absolute",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        top: 0,
        left: 0,
        opacity: 1,
      })
      .appendTo("body");

    // --- Create Terebi Text Elements for Animation ---
    const terebiText = "テレビ";
    const terebiH1 = new Html("h1")
      .styleJs({
        fontFamily: "Rajdhani, sans-serif",
        fontSize: "15rem",
        lineHeight: "18rem",
        fontWeight: "bold",
        textAlign: "center",
        margin: 0,
        padding: 0,
        color: "white",
        display: "flex",
        opacity: 0,
      })
      .html(
        terebiText
          .split("")
          .map(
            (char) =>
              `<div class="char-mask" style="display: inline-block; overflow: hidden;">
                 <span class="terebi-char" style="display: inline-block;">${char}</span>
               </div>`,
          )
          .join(""),
      )
      .appendTo(wrapper);

    // --- Sound and Animation Loading Logic ---
    let startupSound = new Audio("/assets/audio/startup.wav");
    let hasLoaded = false;
    startupSound.addEventListener("loadeddata", () => {
      if (hasLoaded === true) return;
      hasLoaded = true;
      beginAnimation();
    });
    setTimeout(() => {
      startupSound.load();
    }, 16);

    console.log("waiting for load");

    function beginAnimation() {
      console.log("LOADED, beginning animation.");

      document.body.style.transition = "background-color 0.5s ease-in-out";

      const tl = anime.timeline({
        easing: "easeInOutExpo",
        complete: () => {
          document.body.style.backgroundColor = "white";
          setTimeout(() => {
            wrapper.cleanup();
            checkServicesLoaded();
          }, 1000);
        },
        begin: () => {
          startupSound.volume = 1;
          startupSound.play();
        },
      });

      // 2. Animate Terebi characters rising up
      tl.add({
        targets: ".terebi-char",
        translateY: ["100%", 0],
        opacity: [0, 1],
        delay: anime.stagger(80),
      });

      // 3. Zoom out and fade the text
      tl.add({
        targets: terebiH1.elm,
        scale: [1, 0.75],
        opacity: [1, 0],
        duration: 500,
      });
    }

    // --- Load Core Services ---
    await Root.Core.pkg.run("services:SfxLib", [], true);
    await Root.Core.pkg.run("services:UiLib", [], true);
    await Root.Core.pkg.run("services:Forte", [], true);
    await Root.Core.pkg.run("services:FsSvc", [], true);

    async function checkServicesLoaded() {
      let curInterval = setInterval(() => {
        try {
          let SfxLib = Root.Processes.getService("SfxLib").data;
          let UiLib = Root.Processes.getService("UiLib").data;
          let FsSvc = Root.Processes.getService("FsSvc").data;
          let Forte = Root.Processes.getService("ForteSvc").data;
          clearInterval(curInterval);
          doEverythingElse();
        } catch (e) {
          console.log("One or more services are not loaded, waiting...", e);
        }
      }, 50);
    }

    async function doEverythingElse() {
      let tvName = "Encore Karaoke";
      Root.Security.setSecureVariable("TV_NAME", tvName);

      await Root.Core.pkg.run("system:EncoreLoader", [], true);

      let mvT;

      window.addEventListener("mousemove", (e) => {
        clearTimeout(mvT);
        document.body.classList.remove("mouse-disabled");
        window.mouseDisabled = false;
        mvT = setTimeout(() => {
          window.mouseDisabled = true;
          document.body.classList.add("mouse-disabled");
          console.log("Mouse is inactive");
        }, 4000);
      });

      return;
    }
  },
  end: async function () {
    // Good practice to clean up global changes
    document.body.style.backgroundColor = "";
    if (wrapper) {
      wrapper.cleanup();
    }
  },
};

export default pkg;
