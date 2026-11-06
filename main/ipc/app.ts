import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import loudness from "loudness";
import Config from "../../config-manager";
import { appState } from "../state";
import { logger } from "../logger";
import { kioskEnabled, platformHints, versionInformation } from "../runtime";
import {
  addZoom,
  applyZoomFactor,
  getZoomFactor,
  reduceZoom,
  resetZoom,
} from "../zoom";
import { lookupAlbumArt, missingAlbumArt } from "../album-art";
import { romanizeText } from "../romanize";

const { getVolume, setVolume } = loudness;

export function registerAppIpc(): void {
  ipcMain.handle("get-version", () => versionInformation);
  ipcMain.handle("get-platform-hints", () => platformHints.toJSON());
  ipcMain.handle("get-kiosk-enabled", () => kioskEnabled);
  ipcMain.handle("get-file-token", () => appState.fileToken);
  ipcMain.handle("get-port", () => appState.port);

  ipcMain.handle("config-get-all", () => Config.getAll());

  ipcMain.handle(
    "config-get-item",
    (_event: IpcMainInvokeEvent, key: string) => {
      if (typeof key !== "string") return null;
      return Config.getItem(key);
    },
  );
  ipcMain.on(
    "config-set-item",
    (_event: IpcMainEvent, { key, value }: { key: string; value: unknown }) => {
      if (typeof key !== "string") return;
      Config.setItem(key, value);
      logger.info("CONFIG", `Set '${key}'`);
    },
  );
  ipcMain.on("config-merge", (_event: IpcMainEvent, dataObject: unknown) => {
    if (typeof dataObject !== "object" || dataObject === null) return;
    Config.merge(dataObject as Record<string, unknown>);
    logger.info("CONFIG", "Configuration merged with new data.");
  });

  ipcMain.handle("get-volume", async () => getVolume());
  ipcMain.on("set-volume", async (_event: IpcMainEvent, vol: number) => {
    await setVolume(vol);
  });

  ipcMain.handle("zoom-get", () => getZoomFactor());
  ipcMain.handle("zoom-set", (_event: IpcMainInvokeEvent, value: unknown) =>
    applyZoomFactor(value),
  );
  ipcMain.handle("zoom-reset", () => resetZoom());
  ipcMain.handle("zoom-in", () => addZoom());
  ipcMain.handle("zoom-out", () => reduceZoom());

  ipcMain.handle(
    "romanize",
    async (_event: IpcMainInvokeEvent, rawJapanese: unknown) => {
      return await romanizeText(rawJapanese);
    },
  );

  ipcMain.handle(
    "album-art:get",
    async (_event: IpcMainInvokeEvent, payload?: unknown) => {
      const request =
        payload && typeof payload === "object"
          ? (payload as { title?: unknown; artist?: unknown })
          : {};
      const title =
        typeof request.title === "string"
          ? request.title.trim().slice(0, 160)
          : "";
      const artist =
        typeof request.artist === "string"
          ? request.artist.trim().slice(0, 120)
          : "";

      if (!title) return missingAlbumArt("missing-title");
      return await lookupAlbumArt(title, artist);
    },
  );

  ipcMain.handle("select-soundfont-file", async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Select Custom Soundfont",
      properties: ["openFile"],
      filters: [
        {
          name: "Soundfont Files",
          extensions: ["sf2", "sf3", "sfz", "dls"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0].replace(/\\/g, "/");
  });

  ipcMain.on("open-external", (_event: IpcMainEvent, url: string) => {
    if (
      typeof url === "string" &&
      (url.startsWith("https://") ||
        url.startsWith("http://") ||
        url.startsWith("mailto:"))
    ) {
      logger.info("SYSTEM", `Opening external URL: ${url}`);
      void shell.openExternal(url);
    }
  });

  ipcMain.on("simulate-key", (_event: IpcMainEvent, keyChar: unknown) => {
    const allowedKeys = new Set([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "]",
      "Y",
      "M",
      "R",
      "Backspace",
      "Enter",
      "Escape",
    ]);
    if (typeof keyChar !== "string" || !allowedKeys.has(keyChar)) return;
    if (!appState.isRendererReady) return;
    if (
      !appState.appViewWebContents ||
      appState.appViewWebContents.isDestroyed()
    )
      return;

    const keyLiteral = JSON.stringify(keyChar);
    appState.appViewWebContents
      .executeJavaScript(
        `
      (() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const options = { key: ${keyLiteral}, bubbles: true, cancelable: true };
        window.dispatchEvent(new KeyboardEvent("keydown", options));
        window.dispatchEvent(new KeyboardEvent("keyup", options));
      })();
    `,
      )
      .catch((err: unknown) => console.error("Simulate key error:", err));
  });
}
