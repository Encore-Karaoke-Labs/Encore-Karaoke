import {
  networkingUtility_default
} from "../../chunk-CHA2DGDG.js";
import {
  Html
} from "../../chunk-FX4GTR7E.js";
import "../../chunk-7D4SUZUM.js";

// src/pkgs/system/EncoreLoader.js
var wrapper;
var Ui;
var Pid;
var root;
var statusP;
var actualPort = 9864;
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
var pkg = {
  name: "Encore Loader",
  type: "app",
  privs: 0,
  /**
   * Creates a modal to allow the user to select from multiple detected libraries.
   *
   * @param {Array<Object>} libraries - The list of found library objects.
   * @returns {Promise<string>} A promise resolving to the selected library path.
   */
  async promptUserToSelectLibrary(libraries) {
    return new Promise((resolve) => {
      let selectedIndex = 0;
      const modal = new Html("div").class("modal-container").appendTo(wrapper).styleJs({ color: "white" });
      const content = new Html("div").class("modal-content").appendTo(modal);
      new Html("h2").text("Multiple Libraries Found").appendTo(content);
      new Html("p").text("Please select which library you'd like to use for this session.").appendTo(content);
      const buttonsContainer = new Html("div").class("modal-buttons").styleJs({ flexDirection: "column", alignItems: "stretch" }).appendTo(content);
      const cleanupAndResolve = (path) => {
        document.removeEventListener("keydown", handleKeyDown);
        modal.cleanup();
        resolve(path);
      };
      libraries.forEach((lib) => {
        new Html("button").html(
          `${lib.manifest.title}<br><small style="opacity: 0.7;">${lib.path}</small>`
        ).styleJs({
          textAlign: "left",
          lineHeight: "1.5",
          height: "auto",
          padding: "1rem"
        }).on("click", () => cleanupAndResolve(lib.path)).appendTo(buttonsContainer);
      });
      const libraryButtons = buttonsContainer.elm.children;
      const updateSelection = () => {
        for (let i = 0; i < libraryButtons.length; i++) {
          libraryButtons[i].classList.toggle("over", i === selectedIndex);
        }
        libraryButtons[selectedIndex]?.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      };
      const handleKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          selectedIndex = (selectedIndex + 1) % libraryButtons.length;
        } else if (e.key === "ArrowUp") {
          selectedIndex = (selectedIndex - 1 + libraryButtons.length) % libraryButtons.length;
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
      "No library detected.\nOpen the Library Manager to import a Library by clicking the LIB button."
    );
    return new Promise((resolve) => {
      const intervalId = setInterval(async () => {
        const foundLibraries = await fsSvc.findEncoreLibraries();
        if (foundLibraries.length > 0) {
          clearInterval(intervalId);
          resolve(foundLibraries[0].path);
        }
      }, 3e3);
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
    statusP.text("Loading Library...");
    const progressHandler = (e) => {
      if (this.aborted) return;
      statusP.text(
        `Loading library...
${e.detail.current}/${e.detail.total} (${e.detail.percentage}%)`
      );
    };
    document.addEventListener(
      "CherryTree.FsSvc.SongList.Progress",
      progressHandler
    );
    const success = await fsSvc.buildSongList(libraryPath);
    document.removeEventListener(
      "CherryTree.FsSvc.SongList.Progress",
      progressHandler
    );
    if (this.aborted) return false;
    if (!success) {
      return false;
    }
    if (this.f2Handler) {
      document.removeEventListener("keydown", this.f2Handler);
      this.f2Handler = null;
    }
    const libInfo = fsSvc.getLibraryInfo();
    const config = await window.config.getAll();
    if (libInfo?.manifest?.additionalContents?.soundFont && config.audioConfig?.useLibraryFont) {
      statusP.text("Loading sounds...");
      const url = new URL(`http://127.0.0.1:${actualPort}/getFile`);
      const soundFontPath = pathJoin([
        libInfo.path,
        libInfo.manifest.additionalContents.soundFont
      ]);
      url.searchParams.append("path", soundFontPath);
      await forteSvc.loadSoundFont(url.href);
    }
    await root.Libs.startPkg("system:EncoreHome", []);
    document.addEventListener(
      "CherryTree.UI.Ready",
      () => {
        root.end();
      },
      { once: true }
    );
    return true;
  },
  /**
   * Orchestrates the initial boot logic, handling library detection, setup redirects, and loading sequences.
   *
   * @returns {Promise<void>}
   */
  async startLoadingSequence() {
    let fsSvc = root.Processes.getService("FsSvc").data;
    if (window.setupRequested) {
      window.setupRequested = false;
      statusP.text("Entering System Setup...");
      setTimeout(() => {
        this.end();
        root.Core.pkg.run("system:EncoreSetup", []);
      }, 500);
      return;
    }
    this.f2Handler = (e) => {
      if (e.key === "F2" && !this.aborted) {
        this.aborted = true;
        document.removeEventListener("keydown", this.f2Handler);
        statusP.text("Entering System Setup...");
        sessionStorage.setItem("encore_boot_setup", "true");
        setTimeout(() => window.location.reload(), 500);
      }
    };
    document.addEventListener("keydown", this.f2Handler);
    try {
      const config = await window.config.getAll();
      let currentLibraryPath = config.libraryPath;
      if (currentLibraryPath) {
        if (!this.aborted) {
          const loaded = await this.proceedWithLoading(currentLibraryPath);
          if (!loaded) {
            console.warn(
              "Configured library not found. Falling back to search."
            );
            await window.config.merge({ libraryPath: null });
            currentLibraryPath = null;
            statusP.text("Library missing. Re-evaluating...");
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
            libraryPath,
            setupComplete: true
          });
          await this.proceedWithLoading(libraryPath);
        } else if (foundLibraries.length > 1) {
          statusP.text("Multiple libraries found. Please choose one.");
          const selectedPath = await this.promptUserToSelectLibrary(foundLibraries);
          if (this.aborted) return;
          await window.config.merge({
            libraryPath: selectedPath,
            setupComplete: true
          });
          await this.proceedWithLoading(selectedPath);
        } else {
          const libraryPath = await this.waitForLibrary();
          if (this.aborted) return;
          statusP.text("Library detected! Loading...");
          await window.config.merge({
            libraryPath,
            setupComplete: true
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
  start: async function(Root) {
    root = Root;
    actualPort = await networkingUtility_default.getPort();
    window.desktopIntegration?.ipc.send("setRPC", {
      details: "Booting up..."
    });
    Pid = Root.Pid;
    Ui = Root.Processes.getService("UiLib").data;
    wrapper = new Html("div").class("full-ui").appendTo("body").styleJs({
      color: "black",
      opacity: 1
    });
    let imgContainer = new Html("div").styleJs({
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      overflow: "hidden"
    }).appendTo(wrapper);
    let mascotImg = new Html("img").attr({ src: "assets/img/oobe/hoshi_hi.png" }).styleJs({
      position: "absolute",
      top: "0",
      left: "-250px",
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: 0
    }).appendTo(imgContainer);
    let elementContainer = new Html("div").styleJs({
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      display: "flex",
      padding: "80px"
    }).appendTo(wrapper);
    new Html("div").styleJs({ height: "100%", width: "50%" }).appendTo(elementContainer);
    let right = new Html("div").styleJs({
      height: "100%",
      width: "50%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "right"
    }).appendTo(elementContainer);
    let telebiText = new Html("p").styleJs({
      fontSize: "2rem",
      textAlign: "right",
      margin: "0",
      padding: "0",
      fontWeight: "500"
    }).text("\u30C6\u30EC\u30D3").appendTo(right);
    let encoreH1 = new Html("h1").styleJs({
      fontFamily: "Rajdhani",
      fontSize: "10rem",
      lineHeight: "9rem",
      fontWeight: "bold",
      textAlign: "right",
      margin: "0",
      padding: "0",
      overflow: "hidden"
    }).appendTo(right);
    encoreH1.html(
      "ENCORE".split("").map(
        (letter) => `<span class="encore-letter" style="display: inline-block;">${letter}</span>`
      ).join("")
    );
    let karaokeH2 = new Html("h2").styleJs({
      margin: "0",
      padding: "0",
      fontFamily: "Rajdhani",
      fontSize: "3.5rem",
      lineHeight: "2rem",
      fontWeight: "bold",
      textAlign: "right"
    }).text("KARAOKE").appendTo(right);
    new Html("br").appendTo(right);
    new Html("br").appendTo(right);
    statusP = new Html("p").text("Booting up...").appendTo(right).styleJs({
      textAlign: "right",
      fontSize: "2rem",
      whiteSpace: "pre-wrap"
    });
    const tl = anime.timeline({
      easing: "easeInOutExpo"
    });
    tl.add(
      {
        targets: mascotImg.elm,
        translateX: ["-50%", 0],
        opacity: [0, 1],
        duration: 1200
      },
      0
    ).add(
      {
        targets: ".encore-letter",
        translateY: ["100%", 0],
        opacity: [0, 1],
        delay: anime.stagger(70)
      },
      "-=1000"
    ).add(
      {
        targets: [telebiText.elm, karaokeH2.elm],
        translateY: [-20, 0],
        opacity: [0, 1],
        duration: 800
      },
      "-=600"
    ).add(
      { targets: statusP.elm, opacity: [0, 1], duration: 1e3 },
      "-=500"
    ).complete = () => {
      statusP.classOn("pulse-status");
      this.startLoadingSequence();
    };
    Ui.init(Pid, "horizontal", []);
  },
  end: async function() {
    if (this.f2Handler) document.removeEventListener("keydown", this.f2Handler);
    Ui.cleanup(Pid);
    await Ui.transition("fadeOut", wrapper, 500);
    wrapper.cleanup();
  }
};
var EncoreLoader_default = pkg;
export {
  EncoreLoader_default as default
};
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
//# sourceMappingURL=EncoreLoader.js.map
