import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContentsView,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import si from "systeminformation";
import Config from "../config-manager";
import { appState } from "./state";
import { logger } from "./logger";
import { platformHints } from "./runtime";
import { discordRpc } from "./discord-rpc";
import type { KnownLibraryItem, LibraryManifest } from "./types";

export function registerLibraryManagerIpc(): void {
  ipcMain.on("open-library-manager", () => {
    if (platformHints.has("no-library-manager")) {
      logger.info("SYSTEM", "Library Manager disabled by platform hints.");
      return;
    }

    if (appState.libraryManagerWin) {
      appState.libraryManagerWin.focus();
      return;
    }

    appState.libraryManagerWin = new BrowserWindow({
      title: "Encore Library Manager",
      width: 1000,
      height: 700,
      ...(process.platform === "darwin"
        ? {}
        : { icon: path.join(appState.appRoot, "resources/icon.png") }),
      frame: process.platform === "darwin",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      trafficLightPosition: { x: 14, y: 19 },
      backgroundColor: "#080810",
      webPreferences: {
        preload: path.join(appState.appRoot, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    void appState.libraryManagerWin.loadURL(
      `file://${appState.appRoot}/resources/library-manager.html?platform=${process.platform}`,
    );

    appState.libraryManagerWin.on("closed", () => {
      if (appState.isSongbookBuildActive) {
        logger.info(
          "SYSTEM",
          "Library Manager closed. Cancelling songbook build...",
        );
        appState.isSongbookBuildActive = false;
        if (
          appState.appViewWebContents &&
          !appState.appViewWebContents.isDestroyed()
        ) {
          logger.info("SYSTEM", "Sending cancel-songbook-build to appView");
          appState.appViewWebContents.send("cancel-songbook-build");
        } else {
          logger.warn("SYSTEM", "appViewWebContents is not available");
        }
      }
      appState.libraryManagerWin = null;
    });
  });

  ipcMain.handle("libmgr-get-config", () => {
    const knownPaths = (Config.getItem("knownLibraries") as string[]) || [];
    const libraries: KnownLibraryItem[] = [];

    for (const libPath of knownPaths) {
      const manifestPath = path.join(libPath, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(
            fs.readFileSync(manifestPath, "utf8"),
          ) as LibraryManifest;
          libraries.push({ path: libPath, manifest });
        } catch {
          libraries.push({
            path: libPath,
            manifest: {
              title: "Invalid Library",
              description: "Corrupt manifest.json",
            },
          });
        }
      }
    }

    return {
      active: Config.getItem("libraryPath") as string | null,
      libraries: libraries,
    };
  });

  ipcMain.handle("libmgr-scan-drives", async () => {
    try {
      const disks = await si.fsSize();
      const mountPoints = [...new Set(disks.map((d) => d.mount))];
      const known = (Config.getItem("knownLibraries") as string[]) || [];
      let foundCount = 0;

      for (const mount of mountPoints) {
        let checkPath = path.join(mount, "EncoreLibrary").replace(/\\/g, "/");
        if (!checkPath.endsWith("/")) checkPath += "/";

        if (
          fs.existsSync(path.join(checkPath, "manifest.json")) &&
          !known.includes(checkPath)
        ) {
          known.push(checkPath);
          foundCount++;
        }
      }

      Config.setItem("knownLibraries", known);
      return foundCount;
    } catch {
      return 0;
    }
  });

  ipcMain.handle(
    "libmgr-add-library",
    async (event: IpcMainInvokeEvent): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        title: "Select or Create Encore Library Folder",
        properties: ["openDirectory", "createDirectory"],
      });

      if (result.canceled || result.filePaths.length === 0) return null;

      let folderPath = result.filePaths[0].replace(/\\/g, "/");
      if (!folderPath.endsWith("/")) folderPath += "/";

      const manifestPath = path.join(folderPath, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        const folderName = path.basename(path.dirname(folderPath));
        const defaultManifest: LibraryManifest = {
          title: `${folderName} (Custom Library)`,
          description: "A custom library created via Encore Library Manager.",
          flags: {
            flipArtistTitle: false,
            enableMtvCategory: true,
            enableDefaultCategories: true,
            isSongHub: false,
            skipToFirstNoteOn: false,
          },
          additionalContents: { bgvCategories: [], bumperImages: [] },
        };
        fs.writeFileSync(
          manifestPath,
          JSON.stringify(defaultManifest, null, 2),
        );
      }

      const known = (Config.getItem("knownLibraries") as string[]) || [];
      if (!known.includes(folderPath)) {
        known.push(folderPath);
        Config.setItem("knownLibraries", known);
      }

      return folderPath;
    },
  );

  ipcMain.on(
    "libmgr-open-folder",
    (_event: IpcMainEvent, targetPath: string) => {
      if (fs.existsSync(targetPath)) void shell.openPath(targetPath);
    },
  );

  ipcMain.handle(
    "libmgr-get-library-contents",
    async (_event: IpcMainInvokeEvent, folderPath: string) => {
      try {
        const files = await fs.promises.readdir(folderPath);
        const allowedExts = [
          ".mp3",
          ".wav",
          ".m4a",
          ".mid",
          ".kar",
          ".mp4",
          ".mkv",
          ".webm",
          ".avi",
        ];
        const songs = files.filter((f) =>
          allowedExts.includes(path.extname(f).toLowerCase()),
        );
        return songs;
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    "libmgr-select-boot-video",
    async (
      event: IpcMainInvokeEvent,
      folderPath: string,
    ): Promise<{ relativePath?: string; error?: string }> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { error: "Window not found." };

      const result = await dialog.showOpenDialog(win, {
        title: "Select Boot Video",
        defaultPath: folderPath,
        properties: ["openFile"],
        filters: [
          {
            name: "Video Files",
            extensions: ["mp4", "webm", "mkv", "mov", "avi"],
          },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) return {};

      const selectedFile = result.filePaths[0].replace(/\\/g, "/");
      const normalizedFolder = folderPath
        .replace(/\\/g, "/")
        .replace(/\/+$/, "");

      if (!selectedFile.startsWith(normalizedFolder + "/")) {
        return {
          error:
            "The boot video file must be located inside the library folder!",
        };
      }

      const relativePath = selectedFile.substring(normalizedFolder.length + 1);
      return { relativePath };
    },
  );

  ipcMain.handle(
    "libmgr-select-bgv-files",
    async (
      event: IpcMainInvokeEvent,
      folderPath: string,
    ): Promise<{ relativePaths: string[]; outsideCount: number }> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { relativePaths: [], outsideCount: 0 };
      const result = await dialog.showOpenDialog(win, {
        title: "Select Background Videos",
        defaultPath: folderPath,
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Videos and Images",
            extensions: [
              "mp4",
              "mkv",
              "webm",
              "avi",
              "mov",
              "png",
              "jpg",
              "jpeg",
              "webp",
            ],
          },
        ],
      });

      if (result.canceled) return { relativePaths: [], outsideCount: 0 };

      const relativePaths: string[] = [];
      let outsideCount = 0;

      for (const filePath of result.filePaths) {
        const normalizedFile = filePath.replace(/\\/g, "/");
        const normalizedFolder = folderPath.replace(/\\/g, "/");

        if (normalizedFile.startsWith(normalizedFolder)) {
          let relPath = normalizedFile.substring(normalizedFolder.length);
          if (relPath.startsWith("/")) relPath = relPath.substring(1);
          relativePaths.push(relPath);
        } else {
          outsideCount++;
        }
      }
      return { relativePaths, outsideCount };
    },
  );

  ipcMain.handle(
    "libmgr-select-bumper-images",
    async (
      event: IpcMainInvokeEvent,
      folderPath: string,
    ): Promise<{ relativePaths: string[]; outsideCount: number }> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { relativePaths: [], outsideCount: 0 };
      const result = await dialog.showOpenDialog(win, {
        title: "Select Idle Bumper Images",
        defaultPath: folderPath,
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Image Files",
            extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
          },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled) return { relativePaths: [], outsideCount: 0 };

      const relativePaths: string[] = [];
      let outsideCount = 0;

      for (const filePath of result.filePaths) {
        const normalizedFile = filePath.replace(/\\/g, "/");
        const normalizedFolder = folderPath.replace(/\\/g, "/");

        if (normalizedFile.startsWith(normalizedFolder)) {
          let relPath = normalizedFile.substring(normalizedFolder.length);
          if (relPath.startsWith("/")) relPath = relPath.substring(1);
          relativePaths.push(relPath);
        } else {
          outsideCount++;
        }
      }
      return { relativePaths, outsideCount };
    },
  );

  ipcMain.handle(
    "libmgr-get-image-preview",
    async (_event: IpcMainInvokeEvent, fullPath: string) => {
      try {
        if (!fullPath || typeof fullPath !== "string") return null;
        const normalized = path.normalize(fullPath);
        if (!fs.existsSync(normalized)) return null;

        const mimeType = mime.lookup(normalized) || "image/png";
        const buf = await fs.promises.readFile(normalized);
        return `data:${mimeType};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "libmgr-update-manifest",
    (
      _event: IpcMainInvokeEvent,
      payload: { folderPath: string; manifestData: LibraryManifest },
    ) => {
      try {
        if (!payload || !payload.folderPath) {
          return { success: false, error: "No folder path provided." };
        }

        const { folderPath, manifestData } = payload;
        const manifestPath = path.join(folderPath, "manifest.json");

        if (!fs.existsSync(manifestPath)) {
          return {
            success: false,
            error: "manifest.json does not exist at the target path.",
          };
        }

        fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
        return { success: true };
      } catch (e) {
        const err = e as Error;
        logger.error(
          "SYSTEM",
          `Failed to save manifest at ${payload?.folderPath}: ${err.message}`,
        );
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "libmgr-remove-library",
    async (_event: IpcMainInvokeEvent, folderPath: string) => {
      let known = (Config.getItem("knownLibraries") as string[]) || [];
      known = known.filter((p: string) => p !== folderPath);
      Config.setItem("knownLibraries", known);
      if (Config.getItem("libraryPath") === folderPath) {
        Config.setItem("libraryPath", null);
      }
      return { success: true };
    },
  );

  ipcMain.handle(
    "libmgr-set-active",
    async (_event: IpcMainInvokeEvent, folderPath: string) => {
      const safeStates = ["Main Menu", "Booting up...", null, undefined, ""];
      if (!safeStates.includes(discordRpc.getCurrentState())) {
        return {
          success: false,
          reason: "Cannot change libraries while a song is playing.",
        };
      }
      Config.setItem("libraryPath", folderPath);
      const mainWin = BrowserWindow.getAllWindows().find(
        (w) => w !== appState.libraryManagerWin,
      );
      if (mainWin) {
        const view = mainWin.contentView.children[0] as
          WebContentsView | undefined;
        if (view) view.webContents.reload();
      }
      return { success: true };
    },
  );
}
