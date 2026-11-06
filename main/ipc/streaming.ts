import {
  app,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../state";
import { logger } from "../logger";

let ffmpegStreamProcess: ChildProcess | null = null;
let streamHeaderChunk: Buffer | null = null;

function getFfmpegPath(): string {
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

export function registerStreamingIpc(): void {
  ipcMain.handle(
    "stream-start",
    async (
      event: IpcMainInvokeEvent,
      payload?: { rtmpUrl?: string; streamKey?: string; videoBitrate?: number },
    ) => {
      if (ffmpegStreamProcess) {
        logger.warn("STREAM", "Stream is already running.");
        return { success: false, reason: "Already running" };
      }

      const rtmpUrl = payload?.rtmpUrl?.trim();
      const streamKey = payload?.streamKey?.trim();

      let targetDestination = "http://127.0.0.1:8080/live";
      if (rtmpUrl) {
        targetDestination = streamKey
          ? `${rtmpUrl.replace(/\/+$/, "")}/${streamKey}`
          : rtmpUrl;
      }

      const ffmpegPath = getFfmpegPath();

      if (!fs.existsSync(ffmpegPath)) {
        logger.error("STREAM", `FFmpeg binary not found! ${ffmpegPath}`);
        return { success: false, error: "FFmpeg executable is missing." };
      }

      const ffmpegArgs = [
        "-loglevel",
        "warning",
        "-progress",
        "pipe:1",
        "-stats_period",
        "1",
        "-thread_queue_size",
        "2048",
        "-fflags",
        "+genpts+igndts+nobuffer",
        "-f",
        "matroska",
        "-i",
        "pipe:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-af",
        "aresample=async=1:first_pts=0",
        "-flags",
        "+global_header",
        "-flvflags",
        "no_duration_filesize",
        "-f",
        "flv",
        targetDestination,
      ];

      try {
        ffmpegStreamProcess = spawn(ffmpegPath, ffmpegArgs, {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });

        ffmpegStreamProcess.stdin?.on("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EOF" || err.code === "EPIPE") {
            return;
          }
          logger.error("STREAM", `stdin error: ${err.message}`);
        });

        streamHeaderChunk = null;
        const streamSender = event.sender;
        let stdoutBuffer = "";
        const currentStats: Record<string, string> = {};

        ffmpegStreamProcess.stdout?.on("data", (chunk: Buffer) => {
          stdoutBuffer += chunk.toString("utf8");
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? "";

          for (const line of lines) {
            const idx = line.indexOf("=");
            if (idx !== -1) {
              const key = line.substring(0, idx).trim();
              const val = line.substring(idx + 1).trim();
              currentStats[key] = val;

              if (key === "progress") {
                const fps = parseFloat(currentStats["fps"] || "30");
                const bitrate = currentStats["bitrate"] || "N/A";
                const dropFrames = parseInt(
                  currentStats["drop_frames"] || "0",
                  10,
                );
                const totalSize = parseInt(
                  currentStats["total_size"] || "0",
                  10,
                );
                const speedStr = currentStats["speed"] || "1.00x";
                const speedVal = parseFloat(speedStr.replace("x", "")) || 1.0;

                let health: "excellent" | "good" | "poor" = "excellent";
                if (speedVal < 0.85 || dropFrames > 30) {
                  health = "poor";
                } else if (speedVal < 0.98 || dropFrames > 5) {
                  health = "good";
                }

                if (!streamSender.isDestroyed()) {
                  streamSender.send("stream-stats", {
                    fps: isNaN(fps) ? 30 : fps,
                    bitrate,
                    dropFrames: isNaN(dropFrames) ? 0 : dropFrames,
                    totalSize: isNaN(totalSize) ? 0 : totalSize,
                    speed: speedStr,
                    health,
                  });
                }
              }
            }
          }
        });

        ffmpegStreamProcess.on("close", (code) => {
          logger.info("STREAM", `FFmpeg process exited with code ${code}`);
          ffmpegStreamProcess = null;
          streamHeaderChunk = null;
          if (
            appState.appViewWebContents &&
            !appState.appViewWebContents.isDestroyed()
          ) {
            appState.appViewWebContents.send("stream-status-changed", false);
          }
        });

        ffmpegStreamProcess.on("error", (err) => {
          logger.error("STREAM", `FFmpeg spawn error: ${err.message}`);
          ffmpegStreamProcess = null;
        });

        logger.info(
          "STREAM",
          `Streaming pipe opened to ${targetDestination.replace(/(live2?\/)[^/]+/, "$1******")}`,
        );
        return { success: true };
      } catch (error) {
        const err = error as Error;
        logger.error("STREAM", `Failed to spawn FFmpeg: ${err.message}`);
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.on("stream-chunk", (_event: IpcMainEvent, chunk: ArrayBuffer) => {
    if (
      !ffmpegStreamProcess ||
      !ffmpegStreamProcess.stdin ||
      !ffmpegStreamProcess.stdin.writable
    )
      return;

    try {
      const buffer = Buffer.from(chunk);
      if (!streamHeaderChunk) {
        streamHeaderChunk = buffer;
      }

      ffmpegStreamProcess.stdin.write(buffer, (_err) => {
        // Silently ignore write errors
      });
    } catch {
      // Ignored
    }
  });

  ipcMain.handle("stream-stop", async () => {
    if (!ffmpegStreamProcess) return { success: true };

    logger.info("STREAM", "Stopping streaming pipe...");
    return new Promise((resolve) => {
      if (ffmpegStreamProcess && ffmpegStreamProcess.stdin) {
        ffmpegStreamProcess.stdin.end();
      }
      setTimeout(() => {
        if (ffmpegStreamProcess) {
          ffmpegStreamProcess.kill("SIGINT");
          ffmpegStreamProcess = null;
        }
        streamHeaderChunk = null;
        resolve({ success: true });
      }, 500);
    });
  });
}
