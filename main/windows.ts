import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  WebContentsView,
  type Event as ElectronEvent,
  type Input,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { exec } from "node:child_process";
import path from "node:path";
import Config from "../config-manager";
import { appState } from "./state";
import {
  isDev,
  kioskEnabled,
  kioskMode,
  platformHints,
  versionInformation,
} from "./runtime";
import { logger } from "./logger";
import { addZoom, getZoomFactor, reduceZoom, resetZoom } from "./zoom";

const titleBarHeight = 55;

let popoutSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let isPoppedOut = false;
let updateMainWindowBounds: () => void = () => {};

const getBooleanSetting = (value: unknown): boolean =>
  value === true || value === 1 || value === "true" || value === "1";

export function sendAppStateToControl(ready: boolean): void {
  if (appState.controlView && !appState.controlView.webContents.isDestroyed()) {
    appState.controlView.webContents.send("karaoke:app-state", ready);
  }
}

export function popOutAppView(): void {
  if (kioskEnabled || platformHints.has("no-popout")) return;
  if (isPoppedOut || !appState.mainWindow || !appState.appView) return;

  const targetAppView = appState.appView;
  isPoppedOut = true;
  Config.setItem("popoutEnabled", true);

  // Detach the main app view from main window
  appState.mainWindow.contentView.removeChildView(targetAppView);

  const savedBounds = Config.getItem("popoutBounds") as
    { x: number; y: number; width: number; height: number } | undefined;
  const savedFullscreen = getBooleanSetting(Config.getItem("popoutFullscreen"));

  appState.popoutWindow = new BrowserWindow({
    title: "Encore Karaoke - Screen Display",
    x: savedBounds?.x,
    y: savedBounds?.y,
    width: savedBounds?.width ?? 1280,
    height: savedBounds?.height ?? 720,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    alwaysOnTop: false,
    ...(process.platform === "win32"
      ? { icon: path.join(appState.appRoot, "resources/icon.ico") }
      : process.platform === "linux"
        ? { icon: path.join(appState.appRoot, "resources/icon.png") }
        : {}),
    webPreferences: {
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  appState.popoutWindow.contentView.addChildView(targetAppView);

  const updatePopoutBounds = (): void => {
    if (!appState.popoutWindow || appState.popoutWindow.isDestroyed()) return;
    const bounds = appState.popoutWindow.getContentBounds();
    targetAppView.setBounds({
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    });
  };

  const savePopoutWindowState = (debounced: boolean = false): void => {
    if (popoutSaveTimeout) clearTimeout(popoutSaveTimeout);
    const actualFunction = (): void => {
      if (!appState.popoutWindow || appState.popoutWindow.isDestroyed()) return;
      const isFS = appState.popoutWindow.isFullScreen();
      Config.setItem("popoutFullscreen", isFS);
      if (!isFS) {
        Config.setItem("popoutBounds", appState.popoutWindow.getBounds());
      }
      logger.debug("POPOUT", "Saved state!");
    };
    if (!debounced) {
      actualFunction();
      return;
    }
    popoutSaveTimeout = setTimeout(actualFunction, 30);
  };

  appState.popoutWindow.on("resize", () => {
    updatePopoutBounds();
    savePopoutWindowState();
  });
  appState.popoutWindow.on("move", () => {
    savePopoutWindowState(true);
  });
  appState.popoutWindow.on("maximize", updatePopoutBounds);
  appState.popoutWindow.on("unmaximize", updatePopoutBounds);

  appState.popoutWindow.on("enter-full-screen", () => {
    updatePopoutBounds();
    savePopoutWindowState();
    targetAppView.webContents.send("fullscreen-state-changed", true);
  });

  appState.popoutWindow.on("leave-full-screen", () => {
    updatePopoutBounds();
    savePopoutWindowState();
    targetAppView.webContents.send("fullscreen-state-changed", false);
  });

  updatePopoutBounds();

  if (savedFullscreen) {
    appState.popoutWindow.setFullScreen(true);
  }

  appState.controlView = new WebContentsView({
    webPreferences: {
      preload: path.join(appState.appRoot, "preload.js"),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  appState.mainWindow.contentView.addChildView(appState.controlView);
  updateMainWindowBounds();
  appState.controlView.webContents.on("did-finish-load", () => {
    sendAppStateToControl(appState.isRendererReady);
  });
  void appState.controlView.webContents.loadURL(
    `http://127.0.0.1:${appState.port}/control/index.html`,
  );

  appState.popoutWindow.on("close", () => {
    if (appState.isAppQuitting) return;

    if (
      isPoppedOut &&
      appState.mainWindow &&
      !appState.mainWindow.isDestroyed()
    ) {
      dockBackAppView(true);
    }
  });

  appState.popoutWindow.on("closed", () => {
    appState.popoutWindow = null;
  });

  if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
    appState.mainWindow.webContents.send("popout-state-changed", true);
  }
  logger.info("POPOUT", "Encore popped out to secondary window.");
}

export function dockBackAppView(userInitiated: boolean = true): void {
  if (
    appState.isAppQuitting ||
    !appState.mainWindow ||
    appState.mainWindow.isDestroyed()
  ) {
    isPoppedOut = false;
    appState.popoutWindow = null;
    return;
  }

  if (!isPoppedOut || !appState.appView) return;

  if (popoutSaveTimeout) clearTimeout(popoutSaveTimeout);

  const targetAppView = appState.appView;
  isPoppedOut = false;

  if (userInitiated && !appState.isAppQuitting) {
    Config.setItem("popoutEnabled", false);
  }

  if (appState.popoutWindow && !appState.popoutWindow.isDestroyed()) {
    try {
      appState.popoutWindow.contentView.removeChildView(targetAppView);
      appState.popoutWindow.close();
    } catch (e) {
      logger.error("POPOUT", `Error closing popout window: ${e}`);
    }
    appState.popoutWindow = null;
  }

  // Properly destroy and dereference controlView
  if (appState.controlView) {
    try {
      if (!appState.mainWindow.isDestroyed()) {
        appState.mainWindow.contentView.removeChildView(appState.controlView);
      }
      if (!appState.controlView.webContents.isDestroyed()) {
        appState.controlView.webContents.stop();
        appState.controlView.webContents.close();
      }
    } catch (e) {
      logger.error("POPOUT", `Error destroying controlView: ${e}`);
    }
    appState.controlView = null;
  }

  if (!appState.mainWindow.isDestroyed()) {
    try {
      appState.mainWindow.contentView.addChildView(targetAppView);
      updateMainWindowBounds();
      appState.mainWindow.webContents.send("popout-state-changed", false);
    } catch (e) {
      logger.error("POPOUT", `Error re-docking appView: ${e}`);
    }
  }

  logger.info("POPOUT", "Encore docked back to main window.");
}

export function createMainWindow(): void {
  const shouldStartFullscreen = getBooleanSetting(
    Config.getItem("fullscreenEnabled"),
  );

  const initialBounds = platformHints.embedded
    ? screen.getPrimaryDisplay().bounds
    : { width: 1280, height: 774 };

  const win = new BrowserWindow({
    title: `Encore Karaoke ${versionInformation.channel} ${versionInformation.number} (${versionInformation.codename})`,
    ...initialBounds,
    frame: !platformHints.embedded,
    resizable: !platformHints.embedded,
    movable: !platformHints.embedded,
    enableLargerThanScreen: platformHints.embedded,
    kiosk: kioskEnabled,
    ...(process.platform === "win32"
      ? { icon: path.join(appState.appRoot, "resources/icon.ico") }
      : process.platform === "linux"
        ? { icon: path.join(appState.appRoot, "resources/icon.png") }
        : {}),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 20 },
    backgroundColor: "#000",
    webPreferences: {
      preload: path.join(appState.appRoot, "preload.js"),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  appState.mainWindow = win;

  win.on("closed", () => {
    appState.mainWindow = null;
    if (
      appState.controlView &&
      !appState.controlView.webContents.isDestroyed()
    ) {
      appState.controlView.webContents.close();
      appState.controlView = null;
    }
    if (appState.popoutWindow && !appState.popoutWindow.isDestroyed()) {
      appState.popoutWindow.close();
      appState.popoutWindow = null;
    }
  });

  const localAppView = new WebContentsView({
    webPreferences: {
      preload: path.join(appState.appRoot, "preload.js"),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  appState.appView = localAppView;
  appState.appViewWebContents = localAppView.webContents;

  win.contentView.addChildView(localAppView);

  localAppView.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        appState.isRendererReady = false;
        sendAppStateToControl(false);
      }
    },
  );

  updateMainWindowBounds = (): void => {
    if (!win || win.isDestroyed()) return;
    const isFullScreen = win.isFullScreen() || win.isKiosk();
    const currentActiveView = isPoppedOut
      ? appState.controlView
      : appState.appView;
    if (!currentActiveView) return;

    if (isFullScreen) {
      const displayBounds = screen.getDisplayMatching(win.getBounds()).bounds;
      currentActiveView.setBounds({
        x: 0,
        y: 0,
        width: displayBounds.width,
        height: displayBounds.height,
      });
    } else {
      const bounds = win.getContentBounds();
      if (bounds.width === 0 || bounds.height === 0) return;
      currentActiveView.setBounds({
        x: 0,
        y: titleBarHeight,
        width: bounds.width,
        height: bounds.height - titleBarHeight,
      });
    }
  };

  win.on("resize", updateMainWindowBounds);
  win.on("maximize", updateMainWindowBounds);
  win.on("enter-full-screen", () => {
    updateMainWindowBounds();
    localAppView.webContents.send("fullscreen-state-changed", true);
  });

  win.on("leave-full-screen", () => {
    updateMainWindowBounds();
    localAppView.webContents.send("fullscreen-state-changed", false);
  });
  win.on("restore", () => setTimeout(updateMainWindowBounds, 50));
  win.on("show", () => setTimeout(updateMainWindowBounds, 50));
  updateMainWindowBounds();

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("popout-state-changed", isPoppedOut);
  });

  const shouldStartPoppedOut = getBooleanSetting(
    Config.getItem("popoutEnabled"),
  );
  if (shouldStartPoppedOut && !kioskEnabled) {
    popOutAppView();
  }

  if (shouldStartFullscreen && !kioskEnabled) {
    win.setFullScreen(true);
  }

  void win.loadURL(
    `file://${appState.appRoot}/resources/titlebar.html?platform=${process.platform}`,
  );
  void localAppView.webContents.loadURL(
    `http://127.0.0.1:${appState.port}/index.html`,
  );
  localAppView.webContents.setZoomFactor(getZoomFactor());

  const reloadPage = (): void => {
    if (!kioskEnabled) {
      if (isPoppedOut) {
        appState.controlView?.webContents.reload();
      } else {
        localAppView.webContents.reload();
      }
    }
  };

  win.on("focus", () => {
    if (isPoppedOut) {
      appState.controlView?.webContents.focus();
    } else {
      localAppView.webContents.focus();
    }

    globalShortcut.register("CommandOrControl+0", resetZoom);
    globalShortcut.register("CommandOrControl+plus", addZoom);
    globalShortcut.register("CommandOrControl+=", addZoom);
    globalShortcut.register("CommandOrControl+-", reduceZoom);
    globalShortcut.register("CommandOrControl+_", reduceZoom);
    globalShortcut.register("CommandOrControl+r", reloadPage);
  });

  win.on("blur", () => {
    globalShortcut.unregister("CommandOrControl+0");
    globalShortcut.unregister("CommandOrControl+plus");
    globalShortcut.unregister("CommandOrControl+=");
    globalShortcut.unregister("CommandOrControl+-");
    globalShortcut.unregister("CommandOrControl+_");
    globalShortcut.unregister("CommandOrControl+r");
  });

  if (kioskEnabled) {
    win.setKiosk(true);
    win.setAlwaysOnTop(true);

    updateMainWindowBounds();
    setTimeout(updateMainWindowBounds, 50);

    if (kioskMode && process.platform === "win32") {
      exec("taskkill /f /im explorer.exe", (error) => {
        if (error) {
          logger.error(
            "SYSTEM",
            "Failed to kill explorer.exe: " + error.message,
          );
        } else {
          logger.info("SYSTEM", "Explorer killed for kiosk mode");
        }
      });
    }
  }

  localAppView.webContents.on("devtools-opened", () => {
    const css = `:root { --sys-color-base: var(--ref-palette-neutral100); } .-theme-with-dark-background { --sys-color-base: var(--ref-palette-secondary25); } body { --default-font-family: system-ui,sans-serif; }`;
    void localAppView.webContents.devToolsWebContents?.executeJavaScript(
      `const s = document.createElement('style'); s.innerHTML = '${css.replaceAll("\n", " ")}'; document.body.append(s); document.body.classList.remove('platform-windows');`,
    );
  });

  const handleSpecialKeys = (event: ElectronEvent, input: Input): void => {
    if (input.type === "keyDown") {
      if (input.alt && input.key === "F4") {
        event.preventDefault();
        app.quit();
        return;
      }

      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i")
      ) {
        if (!isDev) {
          event.preventDefault();
          return;
        }
        if (localAppView.webContents.isDevToolsOpened()) {
          localAppView.webContents.closeDevTools();
        } else {
          localAppView.webContents.openDevTools({ mode: "detach" });
        }
        event.preventDefault();
      }

      if (input.key === "F11") {
        if (!kioskEnabled) {
          const targetWin =
            BrowserWindow.getFocusedWindow() ??
            (isPoppedOut ? appState.popoutWindow : win);

          if (targetWin && !targetWin.isDestroyed()) {
            targetWin.setFullScreen(!targetWin.isFullScreen());
          }
        }
        event.preventDefault();
      }
    }
  };

  win.webContents.on("before-input-event", handleSpecialKeys);
  localAppView.webContents.on("before-input-event", handleSpecialKeys);
}

export function registerWindowIpc(): void {
  ipcMain.on("popout-toggle", () => {
    if (isPoppedOut) {
      dockBackAppView();
    } else {
      popOutAppView();
    }
  });

  ipcMain.handle("popout-get-status", () => isPoppedOut);

  ipcMain.on("window-minimize", (event: IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("window-maximize", (event: IpcMainEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) win.restore();
      else win.maximize();
    }
  });
  ipcMain.on("window-close", (event: IpcMainEvent) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin === appState.mainWindow) {
      appState.isAppQuitting = true;
      app.quit();
    } else {
      senderWin?.close();
    }
  });

  ipcMain.on("app-close", () => {
    appState.isAppQuitting = true;
    app.quit();
  });

  ipcMain.handle("fullscreen-get", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isFullScreen() : false;
  });
  ipcMain.handle(
    "fullscreen-set",
    (event: IpcMainInvokeEvent, fullscreen: boolean) => {
      if (platformHints.embedded) return false;
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return false;
      win.setFullScreen(Boolean(fullscreen));
      return win.isFullScreen();
    },
  );
  ipcMain.handle("fullscreen-toggle", (event: IpcMainInvokeEvent) => {
    if (platformHints.embedded) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const nextState = !win.isFullScreen();
    win.setFullScreen(nextState);
    return nextState;
  });
}
