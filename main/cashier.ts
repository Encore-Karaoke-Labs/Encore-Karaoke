import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import path from "node:path";
import Config from "../config-manager";
import { logger } from "./logger";
import { appState } from "./state";

function isRetailEnabled(): boolean {
  return Boolean(Config.getItem("retailConfig.enabled"));
}

function broadcastRetailState(): void {
  const enabled = isRetailEnabled();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("retail-state-changed", enabled);
    }
  }
}

export function registerCashierIpc(): void {
  ipcMain.handle("retail-get-enabled", () => isRetailEnabled());

  ipcMain.on(
    "retail-notify-changed",
    (_event: IpcMainEvent, payload?: { enabled?: boolean }) => {
      if (payload?.enabled !== undefined) {
        Config.setItem("retailConfig.enabled", Boolean(payload.enabled));
      }
      broadcastRetailState();
    },
  );

  ipcMain.on("open-cashier", () => {
    if (!isRetailEnabled()) {
      logger.info("CASHIER", "Retail mode is disabled");
      return;
    }

    if (appState.cashierWin && !appState.cashierWin.isDestroyed()) {
      appState.cashierWin.focus();
      return;
    }

    appState.cashierWin = new BrowserWindow({
      title: "Encore Cashier",
      width: 1100,
      height: 740,
      minWidth: 840,
      minHeight: 560,
      ...(process.platform === "darwin"
        ? {}
        : { icon: path.join(appState.appRoot, "resources/icon.png") }),
      frame: process.platform === "darwin",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      trafficLightPosition: { x: 14, y: 19 },
      backgroundColor: "#080810",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(appState.appRoot, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void appState.cashierWin.loadURL(
      `http://127.0.0.1:${appState.port}/cashier/index.html`,
    );

    appState.cashierWin.on("closed", () => {
      appState.cashierWin = null;
    });

    logger.info("CASHIER", "Cashier portal opened.");
  });
}
