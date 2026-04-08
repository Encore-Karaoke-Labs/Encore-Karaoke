import Html from "/libs/html.js";

let wrapper;

const pkg = {
  name: "Boot Manager",
  type: "app",
  privs: 1,
  start: async function (Root) {
    console.log("[BootManager] Started", Root);

    // 1. Instantly set the body to our dark color to prevent early flashes
    document.body.style.backgroundColor = "#080810";
    document.body.style.margin = "0";

    let shouldBootSetup =
      sessionStorage.getItem("encore_boot_setup") === "true";
    sessionStorage.removeItem("encore_boot_setup");

    let columns = Math.floor(document.body.clientWidth / 50);
    let rows = Math.floor(document.body.clientHeight / 50);

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
        backgroundColor: "#080810",
      })
      .appendTo("body");

    const f2BootListener = (e) => {
      if (e.key === "F2") {
        shouldBootSetup = true;
        window.removeEventListener("keydown", f2BootListener);
      }
    };
    window.addEventListener("keydown", f2BootListener);

    let tiles = new Html("div").classOn("tiles").appendTo(wrapper);
    const createTile = (index) => new Html("div").classOn("tile");
    const createTiles = (quantity) => {
      Array.from(Array(quantity)).map((tile, index) => {
        createTile(index).appendTo(tiles);
      });
    };

    tiles.elm.style.setProperty("--columns", columns);
    tiles.elm.style.setProperty("--rows", rows);
    createTiles(columns * rows);

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

    const setupText = new Html("div")
      .styleJs({
        position: "absolute",
        bottom: "50px",
        left: "50%",
        transform: "translateX(-50%)",
        color: "white",
        mixBlendMode: "difference",
        fontSize: "1.5rem",
        fontFamily: "Rajdhani, sans-serif",
        textAlign: "center",
        opacity: 0,
      })
      .text("Press F2 to go into Setup")
      .appendTo(wrapper);

    const warningScreen = new Html("div")
      .styleJs({
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "#080810",
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 676767,
        fontFamily: "Rajdhani, sans-serif",
        textAlign: "center",
        padding: "2rem",
      })
      .appendTo(wrapper);

    new Html("h1")
      .text("PHOTOSENSITIVITY WARNING")
      .styleJs({
        color: "#ff5555",
        fontSize: "4rem",
        margin: "0 0 1rem 0",
        letterSpacing: "0.1em",
      })
      .appendTo(warningScreen);

    new Html("p")
      .html(
        "This application contains rapid color changes, flashing lights, and visual patterns<br>that may trigger seizures for people with photosensitive epilepsy.<br><br>Viewer discretion is advised.",
      )
      .styleJs({
        margin: "0",
        fontSize: "1.8rem",
        opacity: 0.8,
        lineHeight: "1.5",
      })
      .appendTo(warningScreen);

    const loadingScreen = document.querySelector("#loading");
    if (loadingScreen) loadingScreen.remove();

    let audioLoaded = false;
    let warningDone = false;
    let hasStarted = false;

    let startupSound = new Audio("/assets/audio/startup.wav");
    startupSound.addEventListener("loadeddata", () => {
      audioLoaded = true;
      checkReadyToAnimate();
    });
    setTimeout(() => startupSound.load(), 16);

    setTimeout(() => {
      anime({
        targets: warningScreen.elm,
        opacity: 0,
        duration: 1000,
        easing: "linear",
        complete: () => {
          warningScreen.cleanup();
          warningDone = true;
          checkReadyToAnimate();
        },
      });
    }, 4000);

    function checkReadyToAnimate() {
      if (audioLoaded && warningDone && !hasStarted) {
        hasStarted = true;

        anime({
          targets: setupText.elm,
          opacity: 1,
          duration: 500,
          easing: "linear",
        });

        beginAnimation();
      }
    }

    function beginAnimation() {
      const tl = anime.timeline({
        easing: "easeInOutExpo",
        complete: () => {
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

      tl.add({
        targets: ".terebi-char",
        translateY: ["100%", 0],
        opacity: [0, 1],
        delay: anime.stagger(80),
      });

      tl.add({
        targets: terebiH1.elm,
        scale: [1, 0.75],
        opacity: [1, 0],
        duration: 400,
      });

      tl.add({
        targets: ".tile",
        opacity: [1, 0],
        delay: anime.stagger(35, {
          grid: [columns, rows],
          from: "center",
          ease: "outExpo",
          duration: 100,
        }),
        duration: 100,
        ease: "outExpo",
        begin: () => {
          // Switch the background to white ONLY precisely when the tiles start fading!
          // This prevents the white background from bleeding through sub-pixel grid gaps.
          wrapper.styleJs({ backgroundColor: "white" });
          document.body.style.backgroundColor = "white";
        },
      });
    }

    await Root.Core.pkg.run("services:UiLib", [], true);
    await Root.Core.pkg.run("services:Forte", [], true);
    await Root.Core.pkg.run("services:FsSvc", [], true);

    async function checkServicesLoaded() {
      let curInterval = setInterval(() => {
        try {
          Root.Processes.getService("UiLib").data;
          Root.Processes.getService("FsSvc").data;
          Root.Processes.getService("ForteSvc").data;
          clearInterval(curInterval);
          doEverythingElse();
        } catch (e) {}
      }, 50);
    }

    async function doEverythingElse() {
      let tvName = "Encore Karaoke";
      Root.Security.setSecureVariable("TV_NAME", tvName);

      window.removeEventListener("keydown", f2BootListener);

      anime({
        targets: setupText.elm,
        opacity: [1, 0],
        duration: 200,
        easing: "linear",
      });

      if (shouldBootSetup) {
        await Root.Core.pkg.run("system:EncoreSetup", [], true);
      } else {
        await Root.Core.pkg.run("system:EncoreLoader", [], true);
      }

      let mvT;
      window.addEventListener("mousemove", (e) => {
        clearTimeout(mvT);
        document.body.classList.remove("mouse-disabled");
        window.mouseDisabled = false;
        mvT = setTimeout(() => {
          window.mouseDisabled = true;
          document.body.classList.add("mouse-disabled");
        }, 4000);
      });
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
