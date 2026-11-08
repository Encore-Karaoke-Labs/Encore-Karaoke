import { Bonjour } from "bonjour-service";
import { app, powerSaveBlocker, session } from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";
import { exec } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Config from "./config-manager";
import { appState } from "./main/state";
import { isLowLatency, kioskMode, platformHints } from "./main/runtime";
import { logger } from "./main/logger";
import { registerProtocolsIfEnabled } from "./main/protocols";
import { deepLinks } from "./main/deep-links";
import { discordRpc } from "./main/discord-rpc";
import { obsService } from "./main/obs";
import { OverlayHub } from "./main/overlays";
import { WebServer } from "./main/web-server";
import { startUpdateServerDiscovery } from "./main/update-servers";
import { createMainWindow, registerWindowIpc } from "./main/windows";
import { initZoom } from "./main/zoom";
import { registerAppIpc } from "./main/ipc/app";
import { registerPlaybackIpc } from "./main/ipc/playback";
import { registerRecordingsIpc } from "./main/ipc/recordings";
import { registerStreamingIpc } from "./main/ipc/streaming";
import { registerSyncIpc } from "./main/ipc/sync";
import { registerSongbookIpc } from "./main/songbook";
import { registerLibraryManagerIpc } from "./main/library-manager";
import { registerCashierIpc } from "./main/cashier";
import {
  killAllProcesses,
  registerEmbeddedTerminalIpc,
} from "./main/embedded-terminal";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (electronSquirrelStartup) {
  app.quit();
  process.exit(0);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

appState.appRoot = __dirname;
appState.staticAssetsPath = app.isPackaged
  ? path.join(process.resourcesPath, "static")
  : path.join(__dirname, "resources", "static");
appState.fileToken = crypto.randomUUID();
appState.userDataPath = app.getPath("userData");
appState.userVideosPath = app.getPath("videos");
appState.userBGVPath = path.join(appState.userVideosPath, "Encore User BGV");

registerProtocolsIfEnabled();

const bonjour = new Bonjour();
const overlayHub = new OverlayHub();
const webServer = new WebServer(bonjour, overlayHub);
startUpdateServerDiscovery(bonjour);

logger.info("SYSTEM", `User Data Path: ${appState.userDataPath}`);
logger.info("SYSTEM", `User Videos Path: ${appState.userVideosPath}`);

try {
  if (!fs.existsSync(appState.userBGVPath)) {
    fs.mkdirSync(appState.userBGVPath, { recursive: true });
    logger.info(
      "SYSTEM",
      `Created User BGV directory at: ${appState.userBGVPath}`,
    );
  }
} catch (error) {
  const err = error as Error;
  logger.error("SYSTEM", `Failed to create User BGV directory: ${err.message}`);
}

try {
  Config.init(appState.userDataPath);
  logger.info("CONFIG", "Configuration loaded successfully.");
} catch (error) {
  const err = error as Error;
  logger.error("CONFIG", err.message);
}

initZoom();
deepLinks.init();
deepLinks.registerAppHandlers();

if (isLowLatency) {
  logger.warn(
    "SYSTEM",
    "Low-latency audio mode is VERY experimental and may lead to degraded audio performance!",
  );
  app.commandLine.appendSwitch("audio-buffer-size", "256");
  app.commandLine.appendSwitch("enable-exclusive-audio");
  app.commandLine.appendSwitch("alsa-output-buffer-size", "512");
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

app.commandLine.appendSwitch(
  "disable-features",
  [
    "CalculateNativeWinOcclusion",
    "IntensiveWakeUpThrottling",
    "UseEcoQoSForBackgroundProcess",
    "ThrottleDisplayNoneAndVisibilityHiddenFrame",
  ].join(","),
);

app.commandLine.appendSwitch("disable-direct-composition-video-overlays");

void app.whenReady().then(async () => {
  appState.powerSaveId = powerSaveBlocker.start("prevent-display-sleep");
  logger.info(
    "SYSTEM",
    `Power save blocker active (ID: ${appState.powerSaveId})`,
  );

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if ((permission as string) === "local-fonts") callback(true);
      else callback(true);
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      if ((permission as string) === "local-fonts") return true;
      return true;
    },
  );

  setTimeout(() => {
    logger.debug("GPU", app.getGPUFeatureStatus());
  }, 2000);

  if (platformHints.has("no-discord")) {
    logger.info("DISCORD", "Rich Presence disabled by platform hints.");
  } else {
    discordRpc.initialize();
  }

  overlayHub.start();

  registerAppIpc();
  registerPlaybackIpc();
  registerRecordingsIpc();
  registerStreamingIpc();
  registerSyncIpc();
  registerSongbookIpc();
  registerLibraryManagerIpc();
  registerCashierIpc();
  registerWindowIpc();
  deepLinks.registerIpc();
  discordRpc.registerIpc();
  obsService.registerIpc();
  overlayHub.registerIpc();

  if (platformHints.embedded) {
    registerEmbeddedTerminalIpc();
  }

  obsService.initialize();

  await webServer.start();
  createMainWindow();
});

app.on("before-quit", () => {
  appState.isAppQuitting = true;
  overlayHub.dispose();
  if (kioskMode && process.platform === "win32") {
    exec("explorer.exe", (error) => {
      if (error) {
        logger.error(
          "SYSTEM",
          "Failed to restart explorer.exe: " + error.message,
        );
      } else {
        logger.info("SYSTEM", "Explorer restarted");
      }
    });
  }
});

app.on("will-quit", () => {
  killAllProcesses();

  if (
    appState.powerSaveId !== null &&
    powerSaveBlocker.isStarted(appState.powerSaveId)
  ) {
    powerSaveBlocker.stop(appState.powerSaveId);
  }
});
