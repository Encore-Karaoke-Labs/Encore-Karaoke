import Html from "../../libs/html.js";
import { hasPlatformHint, isEmbedded } from "../../libs/platformHints.js";

let wrapper;
let bootTimeline;

const pkg = {
  name: "Boot Manager",
  type: "app",
  privs: 1,
  start: async function (Root) {
    console.log("[BootManager] Started", Root);

    document.body.style.backgroundColor = "#080810";
    document.body.style.margin = "0";

    let columns = Math.max(1, Math.floor(window.innerWidth / 50));
    let rows = Math.max(1, Math.floor(window.innerHeight / 50));

    const config = await window.config.getAll();
    console.log("[BootManager] config", config);

    let BOOT_BG_URL = "/assets/img/boot/bg.png";

    if (await hasPlatformHint("shizuku")) {
      BOOT_BG_URL = "/assets/img/boot/shizuku.png";
    }

    wrapper = new Html("div")
      .class("flex")
      .styleJs({
        width: "100%",
        height: "100%",
        position: "absolute",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        top: "0",
        left: "0",
        opacity: 1,
        backgroundColor: "#080810",
      })
      .appendTo("body");

    const bootBackdrop = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        zIndex: 0,
      })
      .appendTo(wrapper);

    const bootBg = new Html("img")
      .attr({ src: BOOT_BG_URL, alt: "", draggable: "false" })
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "50% 14%",
        pointerEvents: "none",
        transform: "scale(1.04)",
        transformOrigin: "50% 35%",
        willChange: "transform",
        filter: "brightness(1.4)",
      })
      .appendTo(bootBackdrop);

    new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        background:
          "linear-gradient(to bottom, rgba(102, 102, 102, 0) 0%, rgba(0, 0, 0, 0.59) 100%)",
      })
      .appendTo(bootBackdrop);

    const tilesCanvas = new Html("canvas")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
      })
      .appendTo(wrapper);

    const ctx = tilesCanvas.elm.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    tilesCanvas.elm.width = viewW * dpr;
    tilesCanvas.elm.height = viewH * dpr;
    ctx.scale(dpr, dpr);

    const originX = viewW / 2;
    const originY = viewH / 2;
    const maxDist = Math.hypot(originX, originY);
    const RIPPLE_FEATHER = 0.1;
    const RIPPLE_MAX_RADIUS = 1 + RIPPLE_FEATHER * 2;
    const CREST_COLOR = "#89cff0";
    const CREST_RGB = "137, 207, 240";

    const xEdges = Array.from(
      { length: columns + 1 },
      (_, i) => Math.round((i * viewW * dpr) / columns) / dpr,
    );
    const yEdges = Array.from(
      { length: rows + 1 },
      (_, i) => Math.round((i * viewH * dpr) / rows) / dpr,
    );

    const canvasTiles = [];
    for (let r = 0; r < rows; r++) {
      const y = yEdges[r];
      const h = yEdges[r + 1] - y;

      for (let c = 0; c < columns; c++) {
        const x = xEdges[c];
        const w = xEdges[c + 1] - x;
        const dx = x + w / 2 - originX;
        const dy = y + h / 2 - originY;
        const angle = Math.atan2(dy, dx);
        const wobble =
          (Math.sin(angle * 3) * 0.55 + Math.sin(angle * 5 + 1.7) * 0.45) *
          0.008;

        canvasTiles.push({
          x,
          y,
          w,
          h,
          dist: Math.max(0, Math.hypot(dx, dy) / maxDist + wobble),
        });
      }
    }
    canvasTiles.sort((a, b) => a.dist - b.dist);

    const smoothstep = (edge0, edge1, value) => {
      const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    const paintIdleCover = () => {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, viewW, viewH);
    };
    paintIdleCover();

    /**
     * Draws one frame of the boot ripple.
     *
     * @param {number} progress - Wave progress from 0 to 1.
     */
    const renderRipple = (progress) => {
      const p = Math.min(1, Math.max(0, progress));
      const eased = 1 - Math.pow(1 - p, 1.55);
      const wave = eased * RIPPLE_MAX_RADIUS;
      const inner = wave - RIPPLE_FEATHER;
      const outer = wave + RIPPLE_FEATHER;
      const count = canvasTiles.length;

      let start = 0;
      while (start < count && canvasTiles[start].dist < inner) start++;
      let end = start;
      while (end < count && canvasTiles[end].dist <= outer) end++;

      ctx.clearRect(0, 0, viewW, viewH);
      ctx.globalCompositeOperation = "source-over";

      if (end < count) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000000";
        ctx.beginPath();
        for (let i = end; i < count; i++) {
          const tile = canvasTiles[i];
          ctx.rect(tile.x, tile.y, tile.w, tile.h);
        }
        ctx.fill();
      }

      for (let i = start; i < end; i++) {
        const tile = canvasTiles[i];
        const local =
          (wave - tile.dist + RIPPLE_FEATHER) / (RIPPLE_FEATHER * 2);
        const alpha = 1 - smoothstep(0.35, 1, local);
        if (alpha <= 0.002) continue;

        ctx.globalAlpha = alpha;
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
      }

      ctx.fillStyle = CREST_COLOR;
      for (let i = start; i < end; i++) {
        const tile = canvasTiles[i];
        const local =
          (wave - tile.dist + RIPPLE_FEATHER) / (RIPPLE_FEATHER * 2);
        const glow = Math.sin(Math.PI * local) * 0.42;
        if (glow <= 0.01) continue;

        ctx.globalAlpha = glow;
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
      }

      ctx.globalAlpha = 1;

      const crestAlpha =
        Math.min(1, p * 10) * (1 - smoothstep(0.98, 1.18, wave)) * 0.16;
      if (crestAlpha > 0.005) {
        const radius = wave * maxDist;
        const band = RIPPLE_FEATHER * maxDist;
        const r0 = Math.max(0, radius - band);
        const r1 = radius + band;
        const centre = (radius - r0) / Math.max(1, r1 - r0);
        const gradient = ctx.createRadialGradient(
          originX,
          originY,
          r0,
          originX,
          originY,
          r1,
        );

        gradient.addColorStop(0, `rgba(${CREST_RGB}, 0)`);
        gradient.addColorStop(
          Math.max(0, centre - 0.2),
          `rgba(${CREST_RGB}, ${crestAlpha * 0.35})`,
        );
        gradient.addColorStop(centre, `rgba(190, 235, 255, ${crestAlpha})`);
        gradient.addColorStop(
          Math.min(1, centre + 0.2),
          `rgba(${CREST_RGB}, ${crestAlpha * 0.35})`,
        );
        gradient.addColorStop(1, `rgba(${CREST_RGB}, 0)`);

        const bx = Math.max(0, originX - r1);
        const by = Math.max(0, originY - r1);
        const bw = Math.min(viewW, originX + r1) - bx;
        const bh = Math.min(viewH, originY + r1) - by;

        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = gradient;
        ctx.fillRect(bx, by, bw, bh);
        ctx.globalCompositeOperation = "source-over";
      }
    };

    let terebiText = "テレビ";
    if (Math.floor(Math.random() * 100) == 7) {
      terebiText = "テレサ";
    }
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
        position: "relative",
        zIndex: 10,
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

    const warningScreen = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
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
        "Encore Karaoke may contain rapid color changes, flashing lights, and visual patterns<br>that may trigger seizures for people with photosensitive epilepsy.<br><br>Viewer discretion is advised.",
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
        beginAnimation();
      }
    }

    function beginAnimation() {
      const RIPPLE_DURATION = 1300;
      const rippleState = { progress: 0 };

      bootTimeline = anime.timeline({
        easing: "easeInOutExpo",
        complete: () => {
          ctx.clearRect(0, 0, viewW, viewH);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          setTimeout(() => {
            checkServicesLoaded();
          }, 1000);
        },
        begin: () => {
          startupSound.volume =
            config.audioConfig?.mix?.instrumental?.volume ?? 1;
          startupSound.play();
        },
      });

      bootTimeline.add({
        targets: ".terebi-char",
        translateY: ["100%", 0],
        opacity: [0, 1],
        delay: anime.stagger(80),
      });

      bootTimeline.add({
        targets: terebiH1.elm,
        scale: [1, 0.75],
        opacity: [1, 0],
        duration: 400,
      });

      bootTimeline.add({
        targets: rippleState,
        progress: [0, 1],
        duration: RIPPLE_DURATION,
        easing: "linear",
        begin: () => {
          document.body.style.backgroundColor = "#1c2955";
        },
        update: () => {
          renderRipple(rippleState.progress);
          bootBg.elm.style.filter = `brightness(${1 + 0.4 * (1 - rippleState.progress)})`;
        },
        complete: () => {
          ctx.clearRect(0, 0, viewW, viewH);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        },
      });

      bootTimeline.add(
        {
          targets: bootBg.elm,
          scale: [1.04, 1],
          duration: RIPPLE_DURATION,
          easing: "easeOutCubic",
        },
        `-=${RIPPLE_DURATION}`,
      );
    }

    if (await isEmbedded()) {
      await Root.Core.pkg.run("services:Terminal", [], true);
    }
    await Root.Core.pkg.run("services:UiLib", [], true);
    await Root.Core.pkg.run("services:Forte", [], true);
    await Root.Core.pkg.run("services:FsSvc", [], true);
    await Root.Core.pkg.run("services:Updates", [], true);
    await Root.Core.pkg.run("services:Identity", [], true);
    await Root.Core.pkg.run("services:Sessions", [], true);
    await Root.Core.pkg.run("services:Camera", [], true);

    async function checkServicesLoaded() {
      let curInterval = setInterval(() => {
        try {
          Root.Processes.getService("UiLib").data;
          Root.Processes.getService("FsSvc").data;
          Root.Processes.getService("ForteSvc").data;
          Root.Processes.getService("UpdateSvc").data;
          Root.Processes.getService("IdentitySvc").data;
          Root.Processes.getService("SessionsSvc").data;
          Root.Processes.getService("CameraSvc").data;
          clearInterval(curInterval);
          doEverythingElse();
        } catch (e) {
          console.error("One or more services are failing to load", e);
        }
      }, 50);
    }

    async function doEverythingElse() {
      let tvName = "Encore Karaoke";
      Root.Security.setSecureVariable("TV_NAME", tvName);

      await Root.Core.pkg.run("system:EncoreLoader", [], true);
      const loaderWait = setInterval(() => {
        if (!document.getElementById("encore-loader")) return;
        clearInterval(loaderWait);
        wrapper?.cleanup();
        wrapper = null;
      }, 50);

      setTimeout(() => {
        clearInterval(loaderWait);
        if (wrapper) {
          wrapper.cleanup();
          wrapper = null;
        }
      }, 15000);

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
    if (bootTimeline) bootTimeline.pause();
    document.body.style.backgroundColor = "";
    if (wrapper) {
      wrapper.cleanup();
    }
  },
};

export default pkg;
