import Html from "/libs/html.js";

let wrapper, Ui, Pid, Sfx;
let root;
let statusP;

const pkg = {
  name: "Encore Loader",
  type: "app",
  privs: 0,

  // Add the loading sequence function
  async startLoadingSequence() {
    let forte = root.Processes.getService("ForteSvc").data;
    let fsSvc = root.Processes.getService("FsSvc").data;
    statusP.text("Loading Forte Sound Engine...");

    try {
      const config = await window.desktopIntegration.ipc.invoke("getConfig");
      console.log(config);
      if (!config.setupComplete) {
        await forte.playTrack();
        await root.Libs.startPkg("system:EncoreSetup", []);
        this.end();
      } else {
        statusP.text("Loading Library...");
        document.addEventListener("CherryTree.FsSvc.SongList.Progress", (e) => {
          statusP.text(
            `Loading library...\n${e.detail.current}/${e.detail.total} (${e.detail.percentage}%)`,
          );
        });
        fsSvc.buildSongList(config.libraryPath);
        document.addEventListener(
          "CherryTree.FsSvc.SongList.Ready",
          async () => {
            await root.Libs.startPkg("system:EncoreHome", []);
          },
          { once: true },
        );
      }
    } catch (error) {
      // Assume config is corrupted
      console.error("Failed to load config:", error);
      await forte.playTrack();
      await root.Libs.startPkg("system:EncoreSetup", []);
      this.end();
    }
  },

  start: async function (Root) {
    root = Root;
    // --- Existing Setup ---
    window.desktopIntegration !== undefined &&
      window.desktopIntegration.ipc.send("setRPC", {
        details: "Booting up...",
      });

    Pid = Root.Pid;
    Ui = Root.Processes.getService("UiLib").data;
    Sfx = Root.Processes.getService("SfxLib").data;

    // --- Create UI Elements (now transparent) ---
    wrapper = new Html("div").class("full-ui").appendTo("body").styleJs({
      // backgroundColor: "white", // This is no longer needed
      color: "black",
      opacity: 1,
    });

    let imgContainer = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      })
      .appendTo(wrapper);

    // Store the image element in a variable to target it with anime.js
    let mascotImg = new Html("img")
      .attr({ src: "assets/img/oobe/hoshi_hi.png" })
      .styleJs({
        position: "absolute",
        top: "0",
        left: "-250px",
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 0,
      })
      .appendTo(imgContainer);

    let elementContainer = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        padding: "80px",
      })
      .appendTo(wrapper);

    new Html("div")
      .styleJs({ height: "100%", width: "50%" })
      .appendTo(elementContainer);

    let right = new Html("div")
      .styleJs({
        height: "100%",
        width: "50%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "right",
      })
      .appendTo(elementContainer);

    // --- Store Text Elements in Variables to Animate Them ---
    let telebiText = new Html("p")
      .styleJs({
        fontSize: "2rem",
        textAlign: "right",
        margin: "0",
        padding: "0",
        fontWeight: "500",
      })
      .text("テレビ")
      .appendTo(right);

    let encoreH1 = new Html("h1")
      .styleJs({
        fontFamily: "Rajdhani",
        fontSize: "10rem",
        lineHeight: "9rem",
        fontWeight: "bold",
        textAlign: "right",
        margin: "0",
        padding: "0",
        overflow: "hidden",
      })
      .appendTo(right);

    encoreH1.html(
      "ENCORE"
        .split("")
        .map(
          (letter) =>
            `<span class="encore-letter" style="display: inline-block;">${letter}</span>`,
        )
        .join(""),
    );

    let karaokeH2 = new Html("h2")
      .styleJs({
        margin: "0",
        padding: "0",
        fontFamily: "Rajdhani",
        fontSize: "3.5rem",
        lineHeight: "2rem",
        fontWeight: "bold",
        textAlign: "right",
      })
      .text("KARAOKE")
      .appendTo(right);

    new Html("br").appendTo(right);
    new Html("br").appendTo(right);

    statusP = new Html("p")
      .text("Booting up...")
      .appendTo(right)
      .styleJs({ textAlign: "right", fontSize: "2rem" });

    Ui.becomeTopUi(Pid, wrapper);

    // --- ANIMATION SEQUENCE ---
    const tl = anime.timeline({
      easing: "easeInOutExpo",
    });

    // 1. Mascot slides in from the left.
    tl.add(
      {
        targets: mascotImg.elm,
        translateX: ["-50%", 0],
        opacity: [0, 1],
        duration: 1200,
      },
      0,
    );

    // 2. "ENCORE" letters fly in, staggered
    tl.add(
      {
        targets: ".encore-letter",
        translateY: ["100%", 0],
        opacity: [0, 1],
        delay: anime.stagger(70),
      },
      "-=1000",
    );

    // 3. "テレビ" and "KARAOKE" fade and slide in
    tl.add(
      {
        targets: [telebiText.elm, karaokeH2.elm],
        translateY: [-20, 0],
        opacity: [0, 1],
        duration: 800,
      },
      "-=600",
    );

    // 4. "Booting up..." text fades in last
    tl.add(
      {
        targets: statusP.elm,
        opacity: [0, 1],
        duration: 1000,
      },
      "-=500",
    ).complete = () => {
      anime({
        targets: statusP.elm,
        opacity: [1, 0.3],
        duration: 1000,
        direction: "alternate",
        loop: true,
        easing: "easeInOutSine",
      });

      this.startLoadingSequence();
    };

    Ui.init(Pid, "horizontal", []);
  },
  end: async function () {
    Ui.cleanup(Pid);
    await Ui.transition("fadeOut", wrapper, 500);
    Ui.giveUpUi(Pid);
    wrapper.cleanup();
  },
};

export default pkg;
