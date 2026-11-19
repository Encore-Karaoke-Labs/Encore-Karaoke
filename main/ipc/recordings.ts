import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { getFfmpegPath } from "../ffmpeg";
import { logger } from "../logger";
import { appState } from "../state";
import type {
  FinishRecordingPayload,
  RecordingChunkPayload,
  RecordingTrack,
  StartRecordingPayload,
} from "../types";

interface ActiveTrack {
  handle: FileHandle;
  writeChain: Promise<void>;
}

interface ActiveRecording {
  id: string;
  ownerId: number;
  dir: string;
  tracks: Record<RecordingTrack, ActiveTrack>;
  error: string | null;
  closed: boolean;
  detachOwner: () => void;
}

const RECORDING_TRACKS: RecordingTrack[] = ["video", "mic", "music"];

/** Marks a folder whose recording is still being written. */
const RECORDING_MARKER = ".recording";

const TRACK_FILES: Record<RecordingTrack, string> = {
  video: "Mix-Video.webm",
  mic: "Vocal-Track.webm",
  music: "Instrumental-Track.webm",
};

const activeRecordings = new Map<string, ActiveRecording>();

function getRecordingsDir(): string {
  return path.join(appState.userVideosPath, "Encore Recordings");
}

function sanitizeTitle(title?: string): string {
  const safe = (title || "Session").replace(/[^a-z0-9]/gi, "_").slice(0, 120);
  return safe || "Session";
}

function chunkToBuffer(chunk: ArrayBuffer | Uint8Array): Buffer {
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return Buffer.from(chunk);
}

/**
 * Closes every track handle for a recording. Safe to call more than once.
 */
async function closeTrackHandles(recording: ActiveRecording): Promise<void> {
  for (const track of RECORDING_TRACKS) {
    try {
      await recording.tracks[track].handle.close();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Drains any pending writes and releases the recording's file handles.
 */
async function drainRecording(recording: ActiveRecording): Promise<void> {
  recording.closed = true;
  await Promise.all(
    RECORDING_TRACKS.map((track) => recording.tracks[track].writeChain),
  );
  await closeTrackHandles(recording);
  recording.detachOwner();
}

/**
 * Runs FFmpeg and resolves true only when it exits cleanly.
 */
function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpegPath = getFfmpegPath();
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";

    child.stderr?.on("data", (data: Buffer) => {
      if (stderr.length < 4000) stderr += data.toString();
    });

    child.on("error", (error) => {
      logger.warn("SYSTEM", `FFmpeg failed to start: ${error.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        logger.warn(
          "SYSTEM",
          `FFmpeg exited with code ${code ?? "unknown"}: ${stderr.trim()}`,
        );
        resolve(false);
      }
    });
  });
}

/**
 * Converts a streamed WebM audio stem into the WAV file users expect.
 */
async function convertStemToWav(stemPath: string): Promise<void> {
  const source = `${stemPath}.webm`;
  const target = `${stemPath}.wav`;
  const temp = `${stemPath}.wav.part`;

  let size = 0;
  try {
    size = (await fs.promises.stat(source)).size;
  } catch {
    return;
  }

  if (size === 0) {
    await fs.promises.rm(source, { force: true });
    return;
  }

  if (!fs.existsSync(getFfmpegPath())) {
    logger.warn(
      "SYSTEM",
      "FFmpeg is unavailable; keeping compressed audio stem as WebM.",
    );
    return;
  }

  const converted = await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    source,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-rf64",
    "auto",
    "-f",
    "wav",
    temp,
  ]);

  if (!converted) {
    await fs.promises.rm(temp, { force: true });
    return;
  }

  await fs.promises.rm(target, { force: true });
  await fs.promises.rename(temp, target);
  await fs.promises.rm(source, { force: true });
}

async function finalizeAudioStems(dir: string): Promise<void> {
  await convertStemToWav(path.join(dir, "Vocal-Track"));
  await convertStemToWav(path.join(dir, "Instrumental-Track"));
}

/**
 * Rewrites the streamed video into a seekable file.
 */
async function finalizeVideo(dir: string): Promise<void> {
  const target = path.join(dir, "Mix-Video.webm");
  const temp = `${target}.part`;
  const backup = `${target}.backup`;

  let size = 0;
  try {
    size = (await fs.promises.stat(target)).size;
  } catch {
    return;
  }
  if (size === 0) return;

  if (!fs.existsSync(getFfmpegPath())) {
    logger.warn(
      "SYSTEM",
      "FFmpeg is unavailable; recording will not be seekable.",
    );
    return;
  }

  const remuxed = await runFfmpeg([
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    target,
    "-map",
    "0",
    "-c",
    "copy",
    "-cues_to_front",
    "1",
    "-f",
    "matroska",
    temp,
  ]);

  if (!remuxed) {
    await fs.promises.rm(temp, { force: true });
    logger.warn(
      "SYSTEM",
      "Video remux failed; keeping the original, non-seekable file.",
    );
    return;
  }

  try {
    await fs.promises.rm(backup, { force: true });
    await fs.promises.rename(target, backup);
    try {
      await fs.promises.rename(temp, target);
    } catch (error) {
      await fs.promises.rename(backup, target);
      throw error;
    }
    await fs.promises.rm(backup, { force: true });
  } catch (error) {
    const err = error as Error;
    await fs.promises.rm(temp, { force: true });
    logger.warn(
      "SYSTEM",
      `Failed to replace the remuxed video: ${err.message}`,
    );
  }
}

export function registerRecordingsIpc(): void {
  ipcMain.handle("get-recordings", async () => {
    const recordingsDir = getRecordingsDir();
    try {
      if (!fs.existsSync(recordingsDir)) return [];
      const items = await fs.promises.readdir(recordingsDir, {
        withFileTypes: true,
      });
      const recordings: Array<{
        id: string;
        title: string;
        date: number;
        videoPath: string;
      }> = [];

      for (const item of items) {
        if (item.isDirectory()) {
          const sessionPath = path.join(recordingsDir, item.name);
          const videoPath = path.join(sessionPath, "Mix-Video.webm");

          if (fs.existsSync(path.join(sessionPath, RECORDING_MARKER))) continue;

          if (fs.existsSync(videoPath)) {
            const stat = await fs.promises.stat(videoPath);
            recordings.push({
              id: item.name,
              title: item.name,
              date: stat.mtimeMs,
              videoPath: videoPath,
            });
          }
        }
      }
      return recordings.sort((a, b) => b.date - a.date); // Newest first.
    } catch (error) {
      const err = error as Error;
      logger.error("SYSTEM", `Failed to get recordings: ${err.message}`);
      return [];
    }
  });

  ipcMain.handle(
    "delete-recording",
    async (_event: IpcMainInvokeEvent, dirName: string) => {
      if (
        !dirName ||
        dirName.includes("..") ||
        dirName.includes("/") ||
        dirName.includes("\\")
      ) {
        return false;
      }
      const targetPath = path.join(getRecordingsDir(), dirName);
      try {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
        logger.info("SYSTEM", `Recording session deleted: ${dirName}`);
        return true;
      } catch (error) {
        const err = error as Error;
        logger.error("SYSTEM", `Failed to delete recording: ${err.message}`);
        return false;
      }
    },
  );

  ipcMain.handle(
    "recording-start",
    async (event: IpcMainInvokeEvent, data?: StartRecordingPayload) => {
      const id = randomUUID();
      const safeTitle = sanitizeTitle(data?.songTitle);
      const timestamp = new Date().toISOString().replace(/:/g, "-");
      const sessionPath = path.join(
        getRecordingsDir(),
        `${safeTitle}-${timestamp}`,
      );

      try {
        await fs.promises.mkdir(sessionPath, { recursive: true });
        await fs.promises.writeFile(
          path.join(sessionPath, RECORDING_MARKER),
          "",
        );

        const tracks = {} as Record<RecordingTrack, ActiveTrack>;
        for (const track of RECORDING_TRACKS) {
          const handle = await fs.promises.open(
            path.join(sessionPath, TRACK_FILES[track]),
            "w",
          );
          tracks[track] = { handle, writeChain: Promise.resolve() };
        }

        const onOwnerLost = () => {
          const recording = activeRecordings.get(id);
          if (!recording) return;
          logger.warn(
            "SYSTEM",
            "Renderer closed during recording; closing partial files.",
          );
          activeRecordings.delete(id);
          void drainRecording(recording);
        };

        const onNavigation = (
          details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
        ) => {
          if (!details.isMainFrame || details.isSameDocument) return;
          onOwnerLost();
        };

        event.sender.once("destroyed", onOwnerLost);
        event.sender.once("render-process-gone", onOwnerLost);
        event.sender.on("did-start-navigation", onNavigation);

        activeRecordings.set(id, {
          id,
          ownerId: event.sender.id,
          dir: sessionPath,
          tracks,
          error: null,
          closed: false,
          detachOwner: () => {
            event.sender.removeListener("destroyed", onOwnerLost);
            event.sender.removeListener("render-process-gone", onOwnerLost);
            event.sender.removeListener("did-start-navigation", onNavigation);
          },
        });

        logger.info("SYSTEM", `Recording session started: ${sessionPath}`);
        return { success: true, id, path: sessionPath };
      } catch (error) {
        const err = error as Error;
        await fs.promises.rm(sessionPath, { recursive: true, force: true });
        logger.error(
          "SYSTEM",
          `Failed to start recording session: ${err.message}`,
        );
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "recording-append",
    async (event: IpcMainInvokeEvent, data: RecordingChunkPayload) => {
      const recording = data?.id ? activeRecordings.get(data.id) : null;
      if (
        !recording ||
        recording.closed ||
        recording.ownerId !== event.sender.id
      ) {
        return { success: false, error: "Recording session is not active." };
      }

      const track = data.track;
      if (!RECORDING_TRACKS.includes(track)) {
        return { success: false, error: "Unknown recording track." };
      }

      let buffer: Buffer;
      try {
        buffer = chunkToBuffer(data.chunk);
      } catch {
        return { success: false, error: "Invalid recording chunk." };
      }

      if (buffer.byteLength === 0) return { success: true };
      if (buffer.byteLength > 64 * 1024 * 1024) {
        return { success: false, error: "Recording chunk is too large." };
      }

      const activeTrack = recording.tracks[track];
      activeTrack.writeChain = activeTrack.writeChain.then(async () => {
        if (recording.error) return;
        try {
          await activeTrack.handle.write(buffer);
        } catch (error) {
          const err = error as Error;
          recording.error = err.message;
          logger.error(
            "SYSTEM",
            `Failed to write ${track} recording chunk: ${err.message}`,
          );
        }
      });

      await activeTrack.writeChain;
      return recording.error
        ? { success: false, error: recording.error }
        : { success: true };
    },
  );

  ipcMain.handle(
    "recording-finish",
    async (event: IpcMainInvokeEvent, data: FinishRecordingPayload) => {
      const recording = data?.id ? activeRecordings.get(data.id) : null;
      if (!recording || recording.ownerId !== event.sender.id) {
        return { success: false, error: "Recording session is not active." };
      }

      activeRecordings.delete(recording.id);

      try {
        await drainRecording(recording);

        if (recording.error) {
          await fs.promises.rm(path.join(recording.dir, RECORDING_MARKER), {
            force: true,
          });
          return { success: false, error: recording.error };
        }

        await finalizeVideo(recording.dir);
        await finalizeAudioStems(recording.dir);
        await fs.promises.rm(path.join(recording.dir, RECORDING_MARKER), {
          force: true,
        });

        logger.info("SYSTEM", `Recording session exported: ${recording.dir}`);
        return { success: true, path: recording.dir };
      } catch (error) {
        const err = error as Error;
        logger.error(
          "SYSTEM",
          `Failed to save recording session: ${err.message}`,
        );
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "recording-cancel",
    async (event: IpcMainInvokeEvent, data: FinishRecordingPayload) => {
      const recording = data?.id ? activeRecordings.get(data.id) : null;
      if (!recording || recording.ownerId !== event.sender.id) return false;

      activeRecordings.delete(recording.id);
      try {
        await drainRecording(recording);
        await fs.promises.rm(recording.dir, {
          recursive: true,
          force: true,
        });
        return true;
      } catch (error) {
        const err = error as Error;
        logger.warn(
          "SYSTEM",
          `Failed to cancel recording session: ${err.message}`,
        );
        return false;
      }
    },
  );
}
