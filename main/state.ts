import type { BrowserWindow, WebContents, WebContentsView } from "electron";

/**
 * Shared references owned by the Electron main process.
 *
 * The composition root (main.ts) fills in the path fields during startup.
 * Feature modules only keep state that belongs exclusively to them.
 */
export interface AppState {
  appRoot: string;
  staticAssetsPath: string;
  userDataPath: string;
  userVideosPath: string;
  userBGVPath: string;
  fileToken: string;
  port: number;
  mainWindow: BrowserWindow | null;
  appView: WebContentsView | null;
  appViewWebContents: WebContents | null;
  controlView: WebContentsView | null;
  popoutWindow: BrowserWindow | null;
  libraryManagerWin: BrowserWindow | null;
  isAppQuitting: boolean;
  isRendererReady: boolean;
  isSongbookBuildActive: boolean;
  powerSaveId: number | null;
}

export const appState: AppState = {
  appRoot: "",
  staticAssetsPath: "",
  userDataPath: "",
  userVideosPath: "",
  userBGVPath: "",
  fileToken: "",
  port: 0,
  mainWindow: null,
  appView: null,
  appViewWebContents: null,
  controlView: null,
  popoutWindow: null,
  libraryManagerWin: null,
  isAppQuitting: false,
  isRendererReady: false,
  isSongbookBuildActive: false,
  powerSaveId: null,
};
