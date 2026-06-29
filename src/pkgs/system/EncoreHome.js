import Html from "../../libs/html.js";
import NetworkingUtility from "../../libs/networkingUtility.js";

import UIManager from "./managers/UIManager.js";
import LibraryManager from "./managers/LibraryManager.js";
import InputManager from "./managers/InputManager.js";
import PlaybackManager from "./managers/PlaybackManager.js";
import LyricsEngine from "./managers/LyricsEngine.js";
import NetworkManager from "./managers/NetworkManager.js";
import SessionManager from "./managers/SessionManager.js";
import RecordingsManager from "./managers/RecordingsManager.js";
import SetupManager from "./managers/SetupManager.js";
import GamesManager from "./managers/GamesManager.js";

import { MixerModule } from "../../modules/Mixer.js";
import { BGVModule } from "../../modules/BGVPlayer.js";
import { ScoreHUDModule } from "../../modules/ScoreHUD.js";
import { InfoBarModule } from "../../modules/InfoBar.js";
import { RecorderModule } from "../../modules/Recorder.js";
import generateDialog from "../../modules/Dialog.js";

/**
 * Joins path parts with a given separator, normalizing leading and trailing slashes.
 */
function pathJoin(parts, sep) {
  const separator = sep || "/";
  parts = parts.map((part, index) => {
    if (index) part = part.replace(new RegExp("^" + separator), "");
    if (index !== parts.length - 1)
      part = part.replace(new RegExp(separator + "$"), "");
    return part;
  });
  return parts.join(separator);
}

class EncoreController {
  constructor(Root, config) {
    this.Root = Root;
    this.config = config;

    this.services = {
      Pid: Root.Pid,
      Ui: Root.Processes.getService("UiLib").data,
      FsSvc: Root.Processes.getService("FsSvc").data,
      Forte: Root.Processes.getService("ForteSvc").data,
      Updates: Root.Processes.getService("UpdateSvc").data,
      Identity: Root.Processes.getService("IdentitySvc").data,
      SessionsSvc: Root.Processes.getService("SessionsSvc")?.data,
      CameraSvc: Root.Processes.getService("CameraSvc")?.data,
    };

    this.state = {
      actualPort: 9864,
      mode: "menu",
      songNumber: "",
      highlightedIndex: -1,
      reservationNumber: "",
      reservationQueue: [],
      windowsVolume: 1,
      volume: config.audioConfig?.mix?.instrumental?.volume ?? 1,
      videoSyncOffset: config.videoConfig?.syncOffset || 0,

      isTransitioning: false,
      isTypingNumber: false,
      currentSongIsYouTube: false,
      currentSongIsMultiplexed: false,
      currentSongIsMIDI: false,
      currentSongIsMV: false,
      lastPlaybackStatus: null,

      isQueueOverlayVisible: false,
      isQueueDeleteHighlighted: false,
      highlightedQueueIndex: -1,

      isScoreFanfareEnabled: config.audioConfig?.enableScoreFanfare ?? true,
      isScoreNarrationEnabled: config.audioConfig?.enableScoreNarration ?? true,
      isNavSfxEnabled: config.audioConfig?.enableNavSfx ?? true,
      isScoreScreenActive: false,
      scoreSkipResolver: null,
      scoreSkipped: false,

      showSongList: false,

      isEasterEggInterludeEnabled: config.enableEasterEggInterludes ?? false,

      songList: [],
      songMap: new Map(),
    };

    this.dom = {};

    this.mixer = new MixerModule(this.services.Forte);
    this.bgv = new BGVModule();
    this.scoreHud = new ScoreHUDModule();

    this.infoBar = new InfoBarModule(
      () => ({
        reservationQueue:
          this.state.isSessionActive && this.services.SessionsSvc
            ? this.services.SessionsSvc.state.queue
            : this.state.reservationQueue,
        songMap: this.state.songMap,
      }),
      () =>
        this.recorder?.isRecording && this.recorder?.mediaRecorder
          ? `REC <span style="color: #ff5555">●</span> ${this.recorder.getRecordingTimeString()}`
          : false,
      (s) => this.library.getFormatInfo(s),
    );

    this.recorder = new RecorderModule(
      this.services.Forte,
      this.bgv,
      this.infoBar,
      generateDialog,
    );

    this.context = {
      root: this,
      state: this.state,
      dom: this.dom,
      services: this.services,
      config: this.config,
      modules: {
        mixer: this.mixer,
        bgv: this.bgv,
        scoreHud: this.scoreHud,
        infoBar: this.infoBar,
        recorder: this.recorder,
        dialog: generateDialog,
      },
    };

    this.ui = new UIManager(this.context);
    this.library = new LibraryManager(this.context);
    this.lyrics = new LyricsEngine(this.context);
    this.playback = new PlaybackManager(this.context);
    this.network = new NetworkManager(this.context);
    this.sessions = new SessionManager(this.context);
    this.recordings = new RecordingsManager(this.context);
    this.input = new InputManager(this.context);
    this.setup = new SetupManager(this.context);
    this.games = new GamesManager(this.context);

    this.boundKeydown = (e) => this.input.handleKeyDown(e);
  }

  async init() {
    this.context.wrapper = new Html("div").classOn("full-ui").appendTo("body");
    this.context.wrapper.classOn("loading");
    this.services.Forte.setPianoRollContainer(this.context.wrapper);

    if (this.config.audioConfig?.micRecordingVolume !== undefined) {
      this.services.Forte.setMicRecordingVolume(
        this.config.audioConfig.micRecordingVolume,
      );
    }
    if (this.config.audioConfig?.musicRecordingVolume !== undefined) {
      this.services.Forte.setMusicRecordingVolume(
        this.config.audioConfig.musicRecordingVolume,
      );
    }
    if (this.config.audioConfig?.micMonitorVolume !== undefined) {
      this.services.Forte.setMicMonitorVolume(
        this.config.audioConfig.micMonitorVolume,
      );
    }

    if (this.config.audioConfig?.micLatency) {
      await this.services.Forte.setLatency(this.config.audioConfig.micLatency);
    }

    this.state.actualPort = await NetworkingUtility.getPort();
    try {
      this.state.windowsVolume = await window.volume.getVolume();
    } catch (e) {}

    const sfx = [
      "fanfare.mid",
      "fanfare-2.mid",
      "fanfare-3.mid",
      "fanfare-4.mid",
      "scores/0.wav",
      "scores/20.wav",
      "scores/50.wav",
      "scores/70.wav",
      "nav.wav",
      "out_of_bounds.wav",
      "session_start.wav",
      "session_end.wav",
      ...Array.from({ length: 10 }, (_, i) => `numbers/${i}.wav`),
    ];
    await Promise.all(
      sfx.map((s) => this.services.Forte.loadSfx(`/assets/audio/${s}`)),
    );

    this.versionInformation = await window.version.getVersionInformation();
    document.title = `Encore Karaoke ${this.versionInformation.channel} v${this.versionInformation.number} (${this.versionInformation.codename})`;

    await this.services.Forte.setTrackVolume(this.state.volume);
    const micDevice = this.config.audioConfig?.mix?.scoring?.inputDevice;
    if (micDevice) await this.services.Forte.setMicDevice(micDevice);
    else await this.services.Forte.setMicDevice("default");

    const savedChain = this.config.audioConfig?.vocalChain || [];
    await this.services.Forte.loadVocalChain(savedChain);

    this.ui.buildAll();

    this.infoBar.mount(this.dom.topBarContainer);
    this.scoreHud.mount(this.context.wrapper);
    this.mixer.mount(this.context.wrapper);
    this.bgv.mount(this.dom.bgvContainer);
    this.recorder.mount(this.context.wrapper);
    this.recorder.setUiRefs({
      playerUi: this.dom.playerUi,
      lyricsCanvas: this.dom.lyricsCanvas,
      scoreDisplay: this.scoreHud.scoreDisplay,
      danmakuCanvas: this.dom.danmakuCanvas,
    });

    await this.library.init();
    await this.network.init();
    this.sessions.init();
    this.recordings.init();
    this.lyrics.init();
    this.setup.init();
    this.games.init();

    window.addEventListener("keydown", this.boundKeydown);

    const libraryInfo = this.library.libraryInfo;
    if (libraryInfo?.manifest?.additionalContents?.bgvCategories) {
      await this.bgv.loadManifestCategories();
      const mtvPaths = this.state.songList
        .filter((s) => s.videoPath)
        .map((s) => s.videoPath);
      if (mtvPaths.length) {
        this.bgv.addDynamicCategory({
          BGV_CATEGORY: "MTV",
          BGV_LIST: mtvPaths,
          isAbsolute: true,
        });
      }

      try {
        const userBgvs = await this.services.FsSvc.getUserBGVs();
        if (userBgvs && userBgvs.length > 0) {
          this.bgv.addDynamicCategory({
            BGV_CATEGORY: "User BGV",
            BGV_LIST: userBgvs,
            isAbsolute: true,
          });
        }
      } catch (e) {}

      let libraryBgvCategories =
        libraryInfo.manifest.additionalContents.bgvCategories;
      libraryBgvCategories.forEach((category) => {
        let tempPaths = [];
        category.BGV_LIST.forEach((vidPath) =>
          tempPaths.push(pathJoin([libraryInfo.path, vidPath])),
        );
        this.bgv.addDynamicCategory({
          BGV_CATEGORY: category.BGV_CATEGORY,
          BGV_LIST: tempPaths,
          isAbsolute: true,
        });
      });
    }

    try {
      const savedCategory = this.config.videoConfig?.defaultBgvCategory;
      if (savedCategory) this.bgv.selectedCategory = savedCategory;
      else this.bgv.selectedCategory = "Auto";
    } catch (e) {
      this.bgv.selectedCategory = "Auto";
    }

    this.ui.startBumperCycle();
    await this.bgv.updatePlaylistForCategory();

    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("CherryTree.UI.Ready"));
      setTimeout(() => {
        this.context.wrapper.classOff("loading");
        this.services.Ui.transition("fadeIn", this.context.wrapper);
        this.ui.setMode("menu");
      }, 100);
    }, 100);
  }

  destroy() {
    if (this.boundKeydown)
      window.removeEventListener("keydown", this.boundKeydown);
    this.playback.cleanupPlayerEvents();
    this.network.destroy();
    this.sessions.destroy();
    this.setup.destroy();
    this.games.destroy();
    if (this.recorder.isRecording) this.recorder.stop();
    this.bgv.stop();
    this.services.Forte.stopTrack();
    this.context.wrapper.cleanup();
  }
}

let controller;

const pkg = {
  name: "Encore Home",
  type: "app",
  privs: 0,
  start: async function (Root) {
    const config = await window.config.getAll();
    controller = new EncoreController(Root, config);
    await controller.init();
  },
  end: async function () {
    if (controller) {
      controller.destroy();
      controller = null;
    }
  },
};

export default pkg;
