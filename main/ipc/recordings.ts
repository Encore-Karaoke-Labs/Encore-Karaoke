import { ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../state";
import { logger } from "../logger";
import type { SaveRecordingPayload } from "../types";

export function registerRecordingsIpc(): void {
  ipcMain.handle("get-recordings", async () => {
    const recordingsDir = path.join(
      appState.userVideosPath,
      "Encore Recordings",
    );
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
      const targetPath = path.join(
        appState.userVideosPath,
        "Encore Recordings",
        dirName,
      );
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
    "save-recording",
    async (_event: IpcMainInvokeEvent, data: SaveRecordingPayload) => {
      try {
        const { videoBuffer, micBuffer, musicBuffer, songTitle } = data;
        const videosDir = path.join(
          appState.userVideosPath,
          "Encore Recordings",
        );

        const safeTitle = (songTitle || "Session").replace(/[^a-z0-9]/gi, "_");
        const timestamp = new Date().toISOString().replace(/:/g, "-");
        const sessionFolderName = `${safeTitle}-${timestamp}`;
        const sessionPath = path.join(videosDir, sessionFolderName);

        if (!fs.existsSync(sessionPath)) {
          fs.mkdirSync(sessionPath, { recursive: true });
        }

        const videoFile = path.join(sessionPath, "Mix-Video.webm");
        const micFile = path.join(sessionPath, "Vocal-Track.wav");
        const musicFile = path.join(sessionPath, "Instrumental-Track.wav");

        const writePromises: Promise<void>[] = [];

        if (videoBuffer) {
          writePromises.push(
            fs.promises.writeFile(videoFile, Buffer.from(videoBuffer as any)),
          );
        }

        if (micBuffer) {
          writePromises.push(
            fs.promises.writeFile(micFile, Buffer.from(micBuffer as any)),
          );
        }
        if (musicBuffer) {
          writePromises.push(
            fs.promises.writeFile(musicFile, Buffer.from(musicBuffer as any)),
          );
        }

        await Promise.all(writePromises);

        logger.info("SYSTEM", `Recording session exported: ${sessionPath}`);
        return { success: true, path: sessionPath };
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
}
