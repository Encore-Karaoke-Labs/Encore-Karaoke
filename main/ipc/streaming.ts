import {
  app,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { appState } from "../state";

let ffmpegStreamProcess: ChildProcess | null = null;
let streamHeaderChunk: Buffer | null = null;

/**
 * The renderer that started the stream. If it goes away (reload, crash, window
 * close) the FFmpeg process must not keep pushing video anywhere.
 */
let streamOwnerWebContents: WebContents | null = null;
let streamOwnerListeners: (() => void) | null = null;
let streamStopTimer: NodeJS.Timeout | null = null;
let streamKillTimer: NodeJS.Timeout | null = null;

function clearStopTimers(): void {
  if (streamStopTimer) {
    clearTimeout(streamStopTimer);
    streamStopTimer = null;
  }
  if (streamKillTimer) {
    clearTimeout(streamKillTimer);
    streamKillTimer = null;
  }
}

function detachStreamOwner(): void {
  if (streamOwnerListeners) {
    streamOwnerListeners();
    streamOwnerListeners = null;
  }
  streamOwnerWebContents = null;
}

function attachStreamOwner(sender: WebContents): void {
  detachStreamOwner();
  streamOwnerWebContents = sender;

  const onRendererLost = (reason: string) => {
    if (streamOwnerWebContents !== sender) return;
    stopStreamingProcess(reason);
  };

  const onProcessGone = () => onRendererLost("renderer process gone");
  const onDestroyed = () => onRendererLost("renderer destroyed");
  const onNavigation = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
  ) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    onRendererLost("renderer navigated");
  };

  sender.once("render-process-gone", onProcessGone);
  sender.once("destroyed", onDestroyed);
  sender.on("did-start-navigation", onNavigation);

  streamOwnerListeners = () => {
    sender.removeListener("render-process-gone", onProcessGone);
    sender.removeListener("destroyed", onDestroyed);
    sender.removeListener("did-start-navigation", onNavigation);
  };
}

function sendStreamStatus(running: boolean, extra?: WebContents): void {
  const targets = new Set<WebContents>();
  if (extra) targets.add(extra);
  if (streamOwnerWebContents) targets.add(streamOwnerWebContents);
  if (appState.appViewWebContents) targets.add(appState.appViewWebContents);

  for (const target of targets) {
    if (!target.isDestroyed()) {
      target.send("stream-status-changed", running);
    }
  }
}

/**
 * Tears down the FFmpeg process in escalating stages so a wedged encoder still
 * dies: close stdin, then SIGINT, then SIGKILL.
 */
export function stopStreamingProcess(reason = "requested"): void {
  const processToStop = ffmpegStreamProcess;

  clearStopTimers();
  detachStreamOwner();
  streamHeaderChunk = null;

  if (!processToStop) return;

  ffmpegStreamProcess = null;
  logger.info("STREAM", `Stopping streaming pipe (${reason})...`);

  if (processToStop.exitCode !== null || processToStop.signalCode !== null) {
    return;
  }

  try {
    processToStop.stdin?.end();
  } catch {
    // Ignored
  }

  streamStopTimer = setTimeout(() => {
    streamStopTimer = null;
    if (processToStop.exitCode !== null || processToStop.signalCode !== null)
      return;

    try {
      processToStop.kill("SIGINT");
    } catch {
      // Ignored
    }

    streamKillTimer = setTimeout(() => {
      streamKillTimer = null;
      if (processToStop.exitCode !== null || processToStop.signalCode !== null)
        return;

      logger.warn("STREAM", "FFmpeg did not exit; sending SIGKILL.");
      try {
        processToStop.kill("SIGKILL");
      } catch {
        // Ignored
      }
    }, 1500);
  }, 500);
}

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
        attachStreamOwner(streamSender);
        const startedProcess = ffmpegStreamProcess;
        let stdoutBuffer = "";
        const currentStats: Record<string, string> = {};

        startedProcess.stdout?.on("data", (chunk: Buffer) => {
          if (ffmpegStreamProcess !== startedProcess) return;

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

        startedProcess.on("close", (code) => {
          logger.info("STREAM", `FFmpeg process exited with code ${code}`);

          if (ffmpegStreamProcess === startedProcess) {
            ffmpegStreamProcess = null;
            streamHeaderChunk = null;
            detachStreamOwner();
            clearStopTimers();
          }

          sendStreamStatus(false, streamSender);
        });

        startedProcess.on("error", (err) => {
          logger.error("STREAM", `FFmpeg spawn error: ${err.message}`);

          if (ffmpegStreamProcess === startedProcess) {
            ffmpegStreamProcess = null;
            streamHeaderChunk = null;
            detachStreamOwner();
            clearStopTimers();
          }

          sendStreamStatus(false, streamSender);
        });

        const loggedDestination = targetDestination
          .replace(/^(rtmp:\/\/live\.twitch\.tv\/app\/).+$/i, "$1******")
          .replace(/(live2?\/)[^/]+/, "$1******");

        logger.info("STREAM", `Streaming pipe opened to ${loggedDestination}`);
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
    stopStreamingProcess("renderer request");
    return { success: true };
  });
}
