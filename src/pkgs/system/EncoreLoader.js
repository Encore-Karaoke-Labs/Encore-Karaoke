import { defineCustomElements } from "ionicons/loader";
import Html from "../../libs/html.js";
import NetworkingUtility from "../../libs/networkingUtility.js";

let wrapper, Ui, Pid, Sfx;
let root;
let statusP;
let progressFill;
let progressSheen;
let progressAnim;
let progressIndeterminate = false;
let actualPort = 9864;

const BOOT_BG_URL = "/assets/img/boot/bg.png";

/**
 * Stops the indeterminate sweep and hides its highlight.
 */
function stopIndeterminate() {
  progressIndeterminate = false;

  if (progressAnim) {
    progressAnim.pause();
    progressAnim = null;
  }

  if (progressSheen) progressSheen.elm.style.opacity = "0";
}

/**
 * Paints the boot progress bar to a specific percentage.
 *
 * @param {number} percent - Progress value between 0 and 100.
 */
function setProgress(percent) {
  if (!progressFill) return;

  const value = Math.max(0, Math.min(100, Number(percent) || 0));

  stopIndeterminate();

  progressFill.elm.style.transition =
    "width 0.45s cubic-bezier(0.22, 1, 0.36, 1)";
  progressFill.elm.style.width = `${value}%`;
}

function setIndeterminate() {
  if (!progressFill || !progressSheen || progressIndeterminate) return;

  progressIndeterminate = true;
  progressSheen.elm.style.opacity = "1";

  progressAnim = anime({
    targets: progressSheen.elm,
    left: ["-30%", "100%"],
    duration: 1400,
    easing: "easeInOutSine",
    loop: true,
  });
}

/**
 * Joins path parts with a given separator, normalizing leading and trailing slashes.
 *
 * @author anneb (Modified by community)
 * @license CC BY-SA 4.0
 * @see https://stackoverflow.com/a
 *
 * @param {string[]} parts - The path segments to join.
 * @param {string} [sep="/"] - The separator to use.
 * @returns {string} The normalized joined path.
 */
function pathJoin(parts, sep) {
  const separator = sep || "/";
  parts = parts.map((part, index) => {
    if (index) {
      part = part.replace(new RegExp("^" + separator), "");
    }
    if (index !== parts.length - 1) {
      part = part.replace(new RegExp(separator + "$"), "");
    }
    return part;
  });
  return parts.join(separator);
}

const pkg = {
  name: "Encore Loader",
  type: "app",
  privs: 0,

  /**
   * Plays boot videos
   *
   * @param {string} videoPath - Absolute local path to the video file.
   * @param {boolean} [skippable=true] - Whether user can skip playback.
   * @returns {Promise<void>} Resolves when video finishes, fails, or is skipped.
   */
  async playBootVideo(
    videoPath,
    skippable = true,
    playVolume = 1,
    fillMode = "cover",
  ) {
    return new Promise(async (resolve) => {
      let settled = false;
      let stallTimeout = null;

      const videoContainer = new Html("div")
        .styleJs({
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
          zIndex: "1000",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          opacity: "0",
          transition: "opacity 0.25s ease",
        })
        .appendTo(wrapper);

      const video = document.createElement("video");
      video.preload = "auto";
      video.autoplay = true;
      video.playsInline = true;
      video.volume = playVolume;

      Object.assign(video.style, {
        width: "100%",
        height: "100%",
        objectFit: fillMode,
        backgroundColor: "#000",
      });

      const finish = (freezeFrame = true) => {
        if (settled) return;
        settled = true;

        if (stallTimeout) clearTimeout(stallTimeout);
        document.removeEventListener("keydown", handleKeyDown);

        video.pause();

        if (!freezeFrame) {
          video.removeAttribute("src");
          video.load();
          videoContainer.cleanup();
        } else {
          videoContainer.styleJs({ opacity: "1" });
        }

        resolve();
      };

      const handleKeyDown = (e) => {
        if (skippable && ["Enter", " ", "Escape"].includes(e.key)) {
          e.preventDefault();
          finish(true);
        }
      };

      const resetStallTimer = () => {
        if (stallTimeout) clearTimeout(stallTimeout);
        stallTimeout = setTimeout(() => {
          console.warn("Boot video stalled or buffering too long. Skipping.");
          finish(false);
        }, 6000);
      };

      video.addEventListener("waiting", resetStallTimer);
      video.addEventListener("stalled", resetStallTimer);

      video.addEventListener("playing", () => {
        if (stallTimeout) clearTimeout(stallTimeout);
        videoContainer.styleJs({ opacity: "1" });
      });

      video.addEventListener("canplay", () => {
        video.play().catch((err) => {
          console.warn("Autoplay was prevented or video decode failed:", err);
          finish(false);
        });
      });

      video.addEventListener("ended", () => finish(true));

      video.addEventListener("error", () => {
        console.warn(
          "Boot video encountered an error. Proceeding directly to app.",
        );
        finish(false);
      });

      if (skippable) {
        document.addEventListener("keydown", handleKeyDown);
      }

      try {
        const link = await NetworkingUtility.getFileLink(videoPath);
        video.src = link.href;
        videoContainer.elm.appendChild(video);
      } catch (err) {
        console.warn("Could not generate stream URL for boot video:", err);
        finish(false);
      }
    });
  },

  /**
   * Creates a modal to allow the user to select from multiple detected libraries.
   *
   * @param {Array<Object>} libraries - The list of found library objects.
   * @returns {Promise<string>} A promise resolving to the selected library path.
   */
  async promptUserToSelectLibrary(libraries) {
    return new Promise((resolve) => {
      let selectedIndex = 0;

      const modal = new Html("div")
        .class("modal-container")
        .appendTo(wrapper)
        .styleJs({ color: "white" });

      const content = new Html("div").class("modal-content").appendTo(modal);
      new Html("h2").text("Multiple Libraries Found").appendTo(content);
      new Html("p")
        .text("Please select which library you'd like to use for this session.")
        .appendTo(content);

      const buttonsContainer = new Html("div")
        .class("modal-buttons")
        .styleJs({ flexDirection: "column", alignItems: "stretch" })
        .appendTo(content);

      const cleanupAndResolve = (path) => {
        document.removeEventListener("keydown", handleKeyDown);
        modal.cleanup();
        resolve(path);
      };

      libraries.forEach((lib) => {
        new Html("button")
          .html(
            `${lib.manifest.title}<br><small style="opacity: 0.7;">${lib.path}</small>`,
          )
          .styleJs({
            textAlign: "left",
            lineHeight: "1.5",
            height: "auto",
            padding: "1rem",
          })
          .on("click", () => cleanupAndResolve(lib.path))
          .appendTo(buttonsContainer);
      });

      const libraryButtons = buttonsContainer.elm.children;

      const updateSelection = () => {
        for (let i = 0; i < libraryButtons.length; i++) {
          libraryButtons[i].classList.toggle("over", i === selectedIndex);
        }
        libraryButtons[selectedIndex]?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      };

      const handleKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          selectedIndex = (selectedIndex + 1) % libraryButtons.length;
        } else if (e.key === "ArrowUp") {
          selectedIndex =
            (selectedIndex - 1 + libraryButtons.length) % libraryButtons.length;
        } else if (e.key === "Enter") {
          libraryButtons[selectedIndex]?.click();
          return;
        }
        updateSelection();
      };

      document.addEventListener("keydown", handleKeyDown);
      updateSelection();
    });
  },

  /**
   * Enters a polling state, waiting for a valid library drive to be connected.
   *
   * @returns {Promise<string>} A promise that resolves with the path of the first library found.
   */
  async waitForLibrary() {
    const fsSvc = root.Processes.getService("FsSvc").data;
    statusP.text(
      "No library detected. Open Library Manager to import a Library (LIB).",
    );

    return new Promise((resolve) => {
      const intervalId = setInterval(async () => {
        const foundLibraries = await fsSvc.findEncoreLibraries();
        if (foundLibraries.length > 0) {
          clearInterval(intervalId);
          resolve(foundLibraries[0].path);
        }
      }, 3000);
    });
  },

  /**
   * The core loading logic executing after a library path has been determined.
   * Parses the song list, loads sound fonts, and transitions to the main application.
   *
   * @param {string} libraryPath - The full absolute path to the selected library.
   * @returns {Promise<boolean>} True if successful, False if the library failed to load.
   */
  async proceedWithLoading(libraryPath) {
    let fsSvc = root.Processes.getService("FsSvc").data;
    let forteSvc = root.Processes.getService("ForteSvc").data;

    statusP.text("Loading library...");
    setIndeterminate();

    const progressHandler = (e) => {
      if (this.aborted) return;
      setProgress(30 + e.detail.percentage * 0.7);
      statusP.text(
        `Loading library... ${e.detail.current}/${e.detail.total} (${e.detail.percentage}%)`,
      );
    };

    document.addEventListener(
      "Encore.FsSvc.SongList.Progress",
      progressHandler,
    );

    const success = await fsSvc.buildSongList(libraryPath);

    document.removeEventListener(
      "Encore.FsSvc.SongList.Progress",
      progressHandler,
    );

    if (this.aborted) return false;

    if (!success) {
      return false;
    }

    setProgress(100);

    const libInfo = fsSvc.getLibraryInfo();
    const config = await window.config.getAll();

    let mode = config.audioConfig?.soundfontMode;
    if (!mode) {
      mode =
        config.audioConfig?.useLibraryFont !== false ? "library" : "default";
    }

    let fontUrlToLoad = null;

    if (mode === "custom" && config.audioConfig?.customSoundfontPath) {
      const url = await NetworkingUtility.getFileLink(
        config.audioConfig.customSoundfontPath,
      );
      fontUrlToLoad = url.href;
    } else if (
      mode === "library" &&
      libInfo?.manifest?.additionalContents?.soundFont
    ) {
      const soundFontPath = pathJoin([
        libInfo.path,
        libInfo.manifest.additionalContents.soundFont,
      ]);
      const url = await NetworkingUtility.getFileLink(soundFontPath);
      fontUrlToLoad = url.href;
    }

    if (fontUrlToLoad) {
      statusP.text("Loading sounds...");
      try {
        await forteSvc.loadSoundFont(fontUrlToLoad);
      } catch (err) {
        console.error(
          "Failed to load preferred soundfont. Proceeding with system default.",
          err,
        );
      }
    }

    if (this.aborted) return false;

    const bootVideoRel = libInfo?.manifest?.additionalContents?.bootVideo;
    if (bootVideoRel) {
      const fullBootVideoPath = pathJoin([libInfo.path, bootVideoRel]);
      await this.playBootVideo(
        fullBootVideoPath,
        true,
        config.audioConfig?.mix?.instrumental?.volume ?? 1,
        config.videoConfig?.bgvFillMode || "cover",
      );
    }

    if (this.aborted) return false;

    await root.Libs.startPkg("system:EncoreHome", []);

    document.addEventListener(
      "Encore.UI.Ready",
      () => {
        root.end();
      },
      { once: true },
    );

    return true;
  },

  /**
   * Orchestrates the initial boot logic, handling library detection and loading sequences.
   *
   * @returns {Promise<void>}
   */
  async startLoadingSequence() {
    let fsSvc = root.Processes.getService("FsSvc").data;

    statusP.text("Loading components");
    setIndeterminate();

    defineCustomElements(window, {
      resourcesUrl: "/assets/img/icons/",
    });

    try {
      const config = await window.config.getAll();
      let currentLibraryPath = config.libraryPath;

      if (currentLibraryPath) {
        if (!this.aborted) {
          const loaded = await this.proceedWithLoading(currentLibraryPath);
          if (!loaded) {
            console.warn(
              "Configured library not found. Falling back to search.",
            );
            await window.config.merge({ libraryPath: null });
            currentLibraryPath = null;
            statusP.text("Library missing. Re-evaluating...");
            setIndeterminate();
          } else {
            return;
          }
        }
      }

      if (!currentLibraryPath) {
        statusP.text("Searching for libraries...");
        const foundLibraries = await fsSvc.findEncoreLibraries();

        if (this.aborted) return;

        if (foundLibraries.length === 1) {
          statusP.text("Found one library. Configuring automatically...");
          const libraryPath = foundLibraries[0].path;
          await window.config.merge({
            libraryPath: libraryPath,
            setupComplete: true,
          });
          await this.proceedWithLoading(libraryPath);
        } else if (foundLibraries.length > 1) {
          statusP.text("Multiple libraries found. Please choose one.");
          const selectedPath =
            await this.promptUserToSelectLibrary(foundLibraries);

          if (this.aborted) return;

          await window.config.merge({
            libraryPath: selectedPath,
            setupComplete: true,
          });
          await this.proceedWithLoading(selectedPath);
        } else {
          const libraryPath = await this.waitForLibrary();
          if (this.aborted) return;

          statusP.text("Library detected! Loading...");
          await window.config.merge({
            libraryPath: libraryPath,
            setupComplete: true,
          });
          await this.proceedWithLoading(libraryPath);
        }
      }
    } catch (error) {
      console.error("Failed to load or process config:", error);
      statusP.text("Configuration error. Please restart the application.");
    }
  },

  /**
   * Initializes the loader application, setting up the UI and boot animations.
   *
   * @param {Object} Root - The root CherryTree system context.
   */
  start: async function (Root) {
    root = Root;
    actualPort = await NetworkingUtility.getPort();
    window.desktopIntegration?.ipc.send("setRPC", {
      details: "Booting up...",
    });

    Pid = Root.Pid;
    Ui = Root.Processes.getService("UiLib").data;

    wrapper = new Html("div")
      .class("full-ui")
      .id("encore-loader")
      .appendTo("body")
      .styleJs({
        color: "#ffffff",
        opacity: 1,
        backgroundColor: "#1c2955",
        zIndex: "1000",
        overflow: "hidden",
      });

    // Full-bleed boot artwork. The image is cover-cropped slightly toward the
    // top so the character sits exactly where it does in the design.
    const bgLayer = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        zIndex: "0",
      })
      .appendTo(wrapper);

    new Html("img")
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
      })
      .appendTo(bgLayer);

    new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        zIndex: "1",
        pointerEvents: "none",
        background:
          "linear-gradient(to bottom, rgba(102, 102, 102, 0) 0%, rgba(0, 0, 0, 0.59) 100%)",
      })
      .appendTo(wrapper);

    const content = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        zIndex: "2",
      })
      .appendTo(wrapper);

    const logoClip = new Html("div")
      .styleJs({
        position: "absolute",
        left: "6.25%",
        top: "11.111%",
        width: "38.333%",
        overflow: "hidden",
      })
      .appendTo(content);

    const logoImg = new Html("img")
      .attr({ src: "/assets/img/logo.svg", alt: "Encore Karaoke" })
      .styleJs({
        display: "block",
        width: "100%",
        height: "auto",
        opacity: "0",
      })
      .appendTo(logoClip);

    // "Booting..." display type.
    const bootingClip = new Html("div")
      .styleJs({
        position: "absolute",
        left: "6.25%",
        top: "67.083%",
        width: "35.298%",
        overflow: "hidden",
      })
      .appendTo(content);

    const bootingImg = new Html("img")
      .attr({ src: "/assets/img/boot/booting.svg", alt: "Booting..." })
      .styleJs({
        display: "block",
        width: "100%",
        height: "auto",
        opacity: "0",
      })
      .appendTo(bootingClip);

    const progressWrap = new Html("div")
      .styleJs({
        position: "absolute",
        left: "6.25%",
        top: "82.7176%",
        width: "35.2865%",
      })
      .appendTo(content);

    const progressTrack = new Html("div")
      .styleJs({
        position: "relative",
        width: "100%",
        height: "4.6296vh",
        backgroundColor: "#1c2955",
        borderRadius: "0.6944vh",
        overflow: "hidden",
        opacity: "0",
      })
      .appendTo(progressWrap);

    progressFill = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "0",
        height: "100%",
        width: "0%",
        backgroundColor: "#89cff0",
        borderRadius: "0.6944vh",
        transition: "width 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "width",
      })
      .appendTo(progressTrack);

    progressSheen = new Html("div")
      .styleJs({
        position: "absolute",
        top: "0",
        left: "-30%",
        width: "30%",
        height: "100%",
        pointerEvents: "none",
        opacity: "0",
        willChange: "left",
        background:
          "linear-gradient(90deg, rgba(137, 207, 240, 0) 0%, rgba(137, 207, 240, 0.9) 50%, rgba(137, 207, 240, 0) 100%)",
      })
      .appendTo(progressTrack);

    statusP = new Html("p")
      .text("Booting up...")
      .appendTo(progressWrap)
      .styleJs({
        margin: "2.037vh 0 0 0",
        padding: "0",
        fontFamily: '"Radio Canada", sans-serif',
        fontSize: "1.8229vw",
        fontWeight: "400",
        lineHeight: "1.2",
        color: "#ffffff",
        whiteSpace: "pre-wrap",
        opacity: "0",
      });

    const tl = anime.timeline({ easing: "easeOutExpo" });

    tl
      .add(
        {
          targets: logoImg.elm,
          translateY: ["100%", 0],
          opacity: [0, 1],
          duration: 1100,
        },
        150,
      )
      .add(
        {
          targets: bootingImg.elm,
          translateY: ["100%", 0],
          opacity: [0, 1],
          duration: 1000,
        },
        "-=850",
      )
      .add(
        {
          targets: progressTrack.elm,
          opacity: [0, 1],
          scaleX: [0.97, 1],
          duration: 700,
        },
        "-=750",
      )
      .add(
        {
          targets: statusP.elm,
          opacity: [0, 1],
          translateY: [10, 0],
          duration: 700,
        },
        "-=500",
      ).complete = () => {
      this.startLoadingSequence();
    };

    Ui.init(Pid, "horizontal", []);
  },

  end: async function () {
    stopIndeterminate();
    document.body.style.backgroundColor = "";
    Ui.cleanup(Pid);
    await Ui.transition("fadeOut", wrapper, 500);
    wrapper.cleanup();
  },
};

export default pkg;
