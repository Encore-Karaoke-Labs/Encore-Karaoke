import Html from "/libs/html.js";
import settingsLib from "../../libs/settingsLib.js";

let wrapper, card, Ui, Pid, Sfx, Forte, FsSvc, root;
let currentStep = 0;

// --- Config Object (Simplified for new Forte API) ---
let config = {
  setupComplete: false,
  libraryPath: "",
  audioConfig: {
    mix: {
      instrumental: {
        outputDevice: null,
        volume: 1,
      },
      // Vocal effects and buffer size are removed.
      // We only need to store the mic used for scoring.
      scoring: {
        inputDevice: null,
      },
    },
  },
};

// --- State Management ---
let micDevices, playbackDevices;
let encoreLibraries = null;
let selectedMicIndex = 0,
  selectedPlaybackDeviceIndex = 0,
  selectedLibraryIndex = 0;
let mainVolume = 1.0;
let backgroundScanInterval = null;

function startBackgroundScan() {
  if (backgroundScanInterval) return;
  backgroundScanInterval = setInterval(async () => {
    const foundLibs = await FsSvc.findEncoreLibraries();
    const oldPaths = encoreLibraries?.map((l) => l.path).join(",");
    const newPaths = foundLibs.map((l) => l.path).join(",");
    if (oldPaths !== newPaths) {
      encoreLibraries = foundLibs;
      if (!encoreLibraries[selectedLibraryIndex]) {
        selectedLibraryIndex = 0;
      }
      if (currentStep === 3) {
        // Adjusted step index
        renderStep(currentStep);
      }
    }
  }, 3000);
}

function stopBackgroundScan() {
  if (backgroundScanInterval) {
    clearInterval(backgroundScanInterval);
    backgroundScanInterval = null;
  }
}

function showDeviceModal(title, devices, onSelect) {
  const modalBackdrop = new Html("div")
    .class("modal-backdrop")
    .appendTo(wrapper);
  const modalContent = new Html("div")
    .class("modal-content")
    .appendTo(modalBackdrop);
  new Html("h2").text(title).appendTo(modalContent);
  const deviceList = new Html("div").class("modal-list").appendTo(modalContent);
  const navRows = [];
  devices.forEach((deviceName, index) => {
    const deviceButton = new Html("button")
      .class("modal-list-item")
      .text(deviceName)
      .on("click", () => {
        onSelect(index);
        closeModal();
      })
      .appendTo(deviceList);
    navRows.push([deviceButton.elm]);
  });
  Ui.becomeTopUi(Pid, modalBackdrop);
  Ui.init(Pid, "horizontal", navRows);
  anime({
    targets: modalBackdrop.elm,
    opacity: [0, 1],
    duration: 200,
    easing: "easeOutQuad",
  });
  anime({
    targets: modalContent.elm,
    translateY: [50, 0],
    opacity: [0, 1],
    duration: 300,
    easing: "easeOutExpo",
    delay: 50,
  });
  function closeModal() {
    Ui.giveUpUi(Pid);
    anime({
      targets: modalContent.elm,
      translateY: [0, -50],
      opacity: [1, 0],
      duration: 200,
      easing: "easeInExpo",
      complete: () => {
        modalBackdrop.cleanup();
      },
    });
  }
}

async function handleLibraryScan() {
  renderStep(currentStep, { isScanning: true });
  const foundLibs = await FsSvc.findEncoreLibraries();
  encoreLibraries = foundLibs;
  selectedLibraryIndex = 0;
  startBackgroundScan();
  renderStep(currentStep);
}

const setupSteps = [
  {
    title: "Welcome to Encore!",
    mascot: "assets/img/oobe/hoshi_hi_icon.png",
    content: (cardBody) => {
      new Html("p")
        .text(
          "Hello! Before you start singing, let's make sure everything looks and sounds perfect.",
        )
        .appendTo(cardBody);
      new Html("p")
        .text("First, does the application scaling look right to you?")
        .appendTo(cardBody);
    },
    actions: (cardFooter) => {
      const adjustBtn = new Html("button")
        .text("Adjust Display Scale")
        .appendTo(cardFooter)
        .class("button-secondary")
        .on("click", () => {
          settingsLib.uiScaling(root.Pid, wrapper, Ui);
        });
      const nextBtn = new Html("button")
        .text("Looks Good, Next!")
        .appendTo(cardFooter)
        .class("button-primary")
        .on("click", nextStep);
      return [adjustBtn.elm, nextBtn.elm];
    },
  },
  {
    title: "Microphone & Audio Setup",
    content: (cardBody) => {
      new Html("p")
        .html(
          "Select your microphone for <strong>scoring</strong> and your main audio output for music playback. <br/><strong>Note:</strong> You will not hear your own voice during this setup.",
        )
        .appendTo(cardBody);

      const inputDisplay = new Html("div")
        .class("device-display")
        .appendTo(cardBody);
      const inputName = new Html("span").text(
        micDevices[selectedMicIndex]?.label || "Default",
      );
      const inputBtn = new Html("button")
        .text("Change")
        .class("button-tertiary")
        .on("click", () => {
          const deviceLabels = micDevices.map((d) => d.label);
          showDeviceModal("Select Scoring Microphone", deviceLabels, (i) => {
            selectedMicIndex = i;
            // --- FIX #1: Correct path to scoring object ---
            config.audioConfig.mix.scoring.inputDevice = micDevices[i].deviceId;
            Forte.setMicDevice(micDevices[i].deviceId);
            renderStep(currentStep);
          });
        });
      new Html("label")
        .text("Scoring Input (Microphone)")
        .appendTo(inputDisplay);
      inputName.appendTo(inputDisplay);
      inputBtn.appendTo(inputDisplay);

      const playbackDisplay = new Html("div")
        .class("device-display")
        .appendTo(cardBody);
      const playbackName = new Html("span").text(
        playbackDevices[selectedPlaybackDeviceIndex]?.label || "Default",
      );
      const playbackBtn = new Html("button")
        .text("Change")
        .class("button-tertiary")
        .on("click", () => {
          const deviceLabels = playbackDevices.map((d) => d.label);
          showDeviceModal("Select Main Audio Output", deviceLabels, (i) => {
            selectedPlaybackDeviceIndex = i;
            config.audioConfig.mix.instrumental.outputDevice =
              playbackDevices[i].deviceId;
            Forte.setPlaybackDevice(playbackDevices[i].deviceId);
            renderStep(currentStep);
          });
        });
      new Html("label").text("Main Audio Output").appendTo(playbackDisplay);
      playbackName.appendTo(playbackDisplay);
      playbackBtn.appendTo(playbackDisplay);

      return [inputBtn.elm, playbackBtn.elm];
    },
    actions: (cardFooter) => {
      const backBtn = new Html("button")
        .text("Back")
        .appendTo(cardFooter)
        .class("button-secondary")
        .on("click", prevStep);
      const nextBtn = new Html("button")
        .text("Next")
        .appendTo(cardFooter)
        .class("button-primary")
        .on("click", nextStep);
      return [backBtn.elm, nextBtn.elm];
    },
  },
  {
    title: "Volume Balance",
    content: (cardBody) => {
      new Html("p")
        .text(
          "Adjust the main volume to a comfortable level. You should hear background music to help you test.",
        )
        .appendTo(cardBody);
      const sliderControl = new Html("div")
        .class("slider-control")
        .appendTo(cardBody);
      const minusBtn = new Html("button")
        .class("slider-button")
        .text("-")
        .on("click", () => {
          mainVolume = Math.max(0, mainVolume - 0.05);
          Forte.setTrackVolume(mainVolume);
          renderStep(currentStep);
        })
        .appendTo(sliderControl);
      const slider = new Html("input")
        .attr({ type: "range", min: 0, max: 1, step: 0.01, value: mainVolume })
        .on("input", (e) => {
          mainVolume = parseFloat(e.target.value);
          Forte.setTrackVolume(mainVolume);
          document.querySelector(
            ".volume-label",
          ).textContent = `Main Volume: ${Math.round(mainVolume * 100)}%`;
        })
        .appendTo(sliderControl);
      const plusBtn = new Html("button")
        .class("slider-button")
        .text("+")
        .on("click", () => {
          mainVolume = Math.min(1, mainVolume + 0.05);
          Forte.setTrackVolume(mainVolume);
          renderStep(currentStep);
        })
        .appendTo(sliderControl);
      new Html("p")
        .class("volume-label")
        .text(`Main Volume: ${Math.round(mainVolume * 100)}%`)
        .appendTo(cardBody);
      return [[minusBtn.elm, slider.elm, plusBtn.elm]];
    },
    actions: (cardFooter) => {
      const backBtn = new Html("button")
        .text("Back")
        .appendTo(cardFooter)
        .class("button-secondary")
        .on("click", prevStep);
      const nextBtn = new Html("button")
        .text("Next")
        .appendTo(cardFooter)
        .class("button-primary")
        .on("click", nextStep);
      return [backBtn.elm, nextBtn.elm];
    },
  },
  {
    title: "Song Library",
    content: (cardBody, flags) => {
      if (flags?.isScanning) {
        new Html("div").class("spinner").appendTo(cardBody);
        new Html("p").text("Scanning...").appendTo(cardBody);
        return [];
      }
      if (encoreLibraries === null) {
        new Html("p")
          .text("Plug in your drive with an 'EncoreLibrary' folder.")
          .appendTo(cardBody);
        const s = new Html("button")
          .text("Scan for Libraries")
          .class("button-primary")
          .on("click", handleLibraryScan)
          .appendTo(cardBody);
        return [s.elm];
      }
      if (encoreLibraries.length === 0) {
        new Html("p").text("No song libraries found.").appendTo(cardBody);
        new Html("p")
          .text(
            "Please check your drive connection. We'll detect new libraries automatically.",
          )
          .appendTo(cardBody);
        new Html("div").class("spinner").appendTo(cardBody);
        return [];
      }
      const selectedLib = encoreLibraries[selectedLibraryIndex];
      const libraryCard = new Html("div")
        .class("library-card")
        .appendTo(cardBody);
      const header = new Html("div")
        .class("library-header")
        .appendTo(libraryCard);
      new Html("h3").text(selectedLib.manifest.title).appendTo(header);
      new Html("p")
        .class("library-path")
        .text(selectedLib.path)
        .appendTo(header);
      new Html("p")
        .class("library-desc")
        .text(selectedLib.manifest.description)
        .appendTo(libraryCard);
      const changeBtn = new Html("button")
        .text("Change Library")
        .class("button-primary")
        .on("click", () => {
          const libraryTitles = encoreLibraries.map(
            (lib) => lib.manifest.title,
          );
          showDeviceModal("Select a Song Library", libraryTitles, (i) => {
            selectedLibraryIndex = i;
            renderStep(currentStep);
          });
        })
        .appendTo(cardBody);
      return [changeBtn.elm];
    },
    actions: (cardFooter) => {
      const backBtn = new Html("button")
        .text("Back")
        .appendTo(cardFooter)
        .class("button-secondary")
        .on("click", prevStep);
      const nextBtn = new Html("button")
        .text("Next")
        .appendTo(cardFooter)
        .class("button-primary")
        .on("click", nextStep);
      return [backBtn.elm, nextBtn.elm];
    },
  },
  {
    title: "You're All Set!",
    content: (cardBody) => {
      new Html("p")
        .text("Encore is now configured for your system.")
        .appendTo(cardBody);
      const selectedLib = encoreLibraries?.[selectedLibraryIndex];
      if (selectedLib) {
        new Html("p")
          .html(
            `Your song library is set to: <strong>${selectedLib.manifest.title}</strong>`,
          )
          .appendTo(cardBody);
      } else {
        new Html("p")
          .text("No song library was selected. You can add one later.")
          .appendTo(cardBody);
      }
      new Html("p").text("Enjoy the show! ✨").appendTo(cardBody);
    },
    actions: (cardFooter) => {
      const backBtn = new Html("button")
        .text("Back")
        .appendTo(cardFooter)
        .class("button-secondary")
        .on("click", prevStep);
      const finishBtn = new Html("button")
        .text("Start Singing!")
        .appendTo(cardFooter)
        .class("button-primary")
        .on("click", finishSetup);
      return [backBtn.elm, finishBtn.elm];
    },
  },
];

function nextStep() {
  if (currentStep < setupSteps.length - 1) {
    renderStep(currentStep + 1);
  }
}
function prevStep() {
  if (currentStep > 0) {
    renderStep(currentStep - 1);
  }
}
async function finishSetup() {
  const selectedLib = encoreLibraries?.[selectedLibraryIndex];
  config.setupComplete = true;
  config.libraryPath = selectedLib?.path || "";
  config.audioConfig.mix.instrumental.volume = mainVolume;
  // --- FIX #2: Correct path to scoring object ---
  config.audioConfig.mix.scoring.inputDevice =
    micDevices[selectedMicIndex]?.deviceId || "default";

  console.log("Setup Finished! Final config:", config);

  await window.desktopIntegration.ipc.send("updateConfig", config);

  Sfx.playSfx("game_start.wav");
  root.end();
}

async function renderStep(stepIndex, flags = {}) {
  currentStep = stepIndex;
  const step = setupSteps[currentStep];

  window.desktopIntegration !== undefined &&
    window.desktopIntegration.ipc.send("setRPC", {
      details: `Setting up for the first time...`,
      state: `Step ${currentStep + 1} of ${setupSteps.length}`,
    });

  if (
    step.title === "Song Library" &&
    encoreLibraries === null &&
    !flags.isScanning
  ) {
    handleLibraryScan();
    return;
  } else if (step.title === "Song Library") {
    startBackgroundScan();
  } else {
    stopBackgroundScan();
  }

  const oldHeight = card.elm ? card.elm.offsetHeight : 0;
  card.clear();
  let progress = new Html("div").class("progress-tracker").appendTo(card);
  for (let i = 0; i < setupSteps.length; i++) {
    let indicator = new Html("div").class("step-indicator").appendTo(progress);
    if (i === currentStep) indicator.classOn("active");
  }
  let header = new Html("div").class("card-header").appendTo(card);
  if (step.mascot) {
    new Html("img")
      .attr({ src: step.mascot })
      .class("mascot-avatar")
      .appendTo(header);
  }
  new Html("h1").text(step.title).appendTo(header);
  let body = new Html("div").class("card-body").appendTo(card);
  let footer = new Html("div").class("card-footer").appendTo(card);

  const contentElements = step.content(body, flags) || [];
  const actionElements = step.actions(footer) || [];
  Ui.becomeTopUi(Pid, wrapper);
  const navRows = [];
  contentElements.forEach((elm) => {
    if (Array.isArray(elm)) {
      navRows.push(elm);
    } else {
      navRows.push([elm]);
    }
  });
  if (actionElements.length > 0) {
    navRows.push(actionElements);
  }
  Ui.init(Pid, "horizontal", navRows);

  const newHeight = card.elm.scrollHeight;
  if (oldHeight > 0 && !flags.isScanning) {
    card.elm.style.height = `${oldHeight}px`;
    anime({
      targets: card.elm,
      height: [oldHeight, newHeight],
      duration: 300,
      easing: "cubicBezier(0.79,0.14,0.15,0.86)",
      complete: () => {
        card.elm.style.height = "auto";
      },
    });
  } else {
    card.elm.style.height = "auto";
  }
}

const pkg = {
  name: "Encore Setup",
  type: "app",
  privs: 0,
  start: async function (Root) {
    root = Root;
    Pid = Root.Pid;
    Ui = Root.Processes.getService("UiLib").data;
    Sfx = Root.Processes.getService("SfxLib").data;
    Forte = Root.Processes.getService("ForteSvc").data;
    FsSvc = Root.Processes.getService("FsSvc").data;

    [micDevices, playbackDevices] = await Promise.all([
      Forte.getMicDevices(),
      Forte.getPlaybackDevices(),
    ]);

    const initialPlaybackState = Forte.getPlaybackState();
    selectedPlaybackDeviceIndex = playbackDevices.findIndex(
      (d) => d.deviceId === initialPlaybackState.currentDeviceId,
    );
    if (selectedPlaybackDeviceIndex === -1) selectedPlaybackDeviceIndex = 0;

    selectedMicIndex = micDevices.findIndex((d) => d.deviceId === "default");
    if (selectedMicIndex === -1) selectedMicIndex = 0;

    wrapper = new Html("div").class("full-ui").appendTo("body").styleJs({
      background: "linear-gradient(135deg, #E0F7FA 0%, #F8E8FF 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
    new Html("style")
      .text(
        `
      .onboarding-card { background-color: rgba(20, 20, 30, 0.85); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37); border-radius: 1rem; padding: 2rem; width: clamp(300px, 60%, 800px); display: flex; flex-direction: column; gap: 1.5rem; color: white; }
      .progress-tracker { display: flex; gap: 0.5rem; justify-content: center; } .step-indicator { width: 1rem; height: 1rem; background-color: rgba(255,255,255,0.2); border-radius: 50%; transition: all 0.3s ease; } .step-indicator.active { background-color: #89CFF0; transform: scale(1.2); } .card-header { display: flex; align-items: center; gap: 1rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem; } .mascot-avatar { width: 60px; height: 60px; border-radius: 50%; object-fit: cover; } .card-header h1 { font-size: 2.5rem; margin: 0; } .card-body { font-size: 1.1rem; line-height: 1.6; text-align: center; } .card-footer { display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem; }
      .button-primary, .button-secondary, .button-tertiary { border: none; padding: 0.8rem 1.5rem; font-size: 1rem; border-radius: 0.25rem; cursor: pointer; transition: all 0.2s ease; }
      .button-primary { background-color: #89CFF0; color: #14141E; font-weight: bold; } .button-primary:hover { transform: translateY(-2px); box-shadow: 0 4px 10px -2px #89CFF088; }
      .button-secondary { background-color: rgba(255,255,255,0.1); color: white; } .button-secondary:hover { background-color: rgba(255,255,255,0.2); }
      .button-tertiary { background-color: transparent; border: 1px solid rgba(255,255,255,0.3); color: white; padding: 0.5rem 1rem; } .button-tertiary:hover { background-color: rgba(255,255,255,0.1); }
      .device-display { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; align-items: center; text-align: left; gap: 0.5rem 1rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 0.25rem; margin-top: 1.5rem; }
      .device-display label { font-weight: bold; font-size: 0.9rem; opacity: 0.7; grid-column: 1 / -1; }
      .device-display span { font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .device-display button { grid-row: 2; grid-column: 2; }
      .slider-control-group { text-align: left; background: rgba(0,0,0,0.2); border-radius: 0.25rem; padding: 1rem; margin-top: 1.5rem; }
      .slider-control { display: flex; align-items: center; gap: 1rem; margin-top: 0.5rem; }
      .slider-button { font-size: 1.5rem; width: 40px; height: 40px; padding: 0; line-height: 40px; border-radius: 0.25rem; background-color: rgba(255,255,255,0.1); color: white; } .slider-button:hover { background-color: rgba(255,255,255,0.2); }
      .slider-control .value-display { flex-grow: 1; text-align: center; font-size: 1.2rem; font-weight: bold; padding: 0.5rem; background-color: rgba(0,0,0,0.2); border-radius: 0.25rem; }
      .slider-control input[type=range] { flex-grow: 1; cursor: pointer; }
      .volume-label { font-weight: bold; margin-top: 1rem; }
      .library-card { text-align: left; background: rgba(0,0,0,0.2); border-radius: 0.25rem; padding: 1.5rem; margin-top: 1rem; }
      .library-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.5rem 1rem; }
      .library-header h3 { margin: 0; font-size: 1.5rem; } .library-path { font-size: 0.9rem; opacity: 0.6; }
      .library-desc { font-size: 1rem; opacity: 0.8; margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; }
      .modal-backdrop { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
      .modal-content { background: #1C1C2E; border-radius: 0.25rem; padding: 2rem; width: clamp(300px, 50%, 600px); max-height: 80%; display: flex; flex-direction: column; border: 1px solid rgba(255, 255, 255, 0.1); }
      .modal-content h2 { margin-top: 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1rem; }
      .modal-list { overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; }
      .modal-list-item { background: transparent; border: none; color: white; padding: 1rem; font-size: 1.1rem; text-align: left; border-radius: 0.25rem; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .modal-list-item:hover { background: rgba(255,255,255,0.1); }
      .card-body .spinner { width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.2); border-top-color: #89CFF0; border-radius: 50%; animation: spin 1s linear infinite; margin: 1rem auto; } @keyframes spin { to { transform: rotate(360deg); } }
      .card-body > .button-primary { display: block; margin: 1.5rem auto 0; }
    `,
      )
      .appendTo(wrapper);

    card = new Html("div").class("onboarding-card").appendTo(wrapper);
    renderStep(currentStep);
    anime({
      targets: card.elm,
      translateY: [50, 0],
      opacity: [0, 1],
      duration: 500,
      easing: "easeOutExpo",
    });
  },
  end: async function () {
    stopBackgroundScan();
    Forte.stopTrack();
    Ui.cleanup(Pid);
    Sfx.playSfx("deck_ui_out_of_game_detail.wav");
    await anime({
      targets: card.elm,
      translateY: [0, -50],
      opacity: [1, 0],
      duration: 300,
      easing: "easeInExpo",
    }).finished;
    Ui.giveUpUi(Pid);
    wrapper.cleanup();
    window.location.reload();
  },
};

export default pkg;
