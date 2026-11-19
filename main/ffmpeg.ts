import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { appState } from "./state";

/**
 * Resolves the bundled FFmpeg binary for the current install layout.
 */
export function getFfmpegPath(): string {
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  let ffmpegExecutable: string;
  if (app.isPackaged) {
    ffmpegExecutable = path.join(process.resourcesPath, "bin", binaryName);
  } else {
    ffmpegExecutable = path.join(
      appState.appRoot,
      "resources",
      "bin",
      binaryName,
    );
  }

  if (process.platform !== "win32" && fs.existsSync(ffmpegExecutable)) {
    try {
      fs.chmodSync(ffmpegExecutable, 0o755);
    } catch {}
  }

  return ffmpegExecutable;
}
