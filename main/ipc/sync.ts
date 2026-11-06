import { ipcMain, type IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { appState } from "../state";
import { logger } from "../logger";
import { calculateFileCRC32 } from "../crc32";
import { getUpdateServers } from "../update-servers";
import type { HashCache, RemoteSyncFile } from "../types";

export function registerSyncIpc(): void {
  ipcMain.handle("get-update-servers", () => getUpdateServers());

  ipcMain.handle(
    "sync-library",
    async (
      event: IpcMainInvokeEvent,
      {
        serverIp,
        serverPort,
        libraryPath,
      }: { serverIp: string; serverPort: number; libraryPath: string },
    ) => {
      try {
        if (!fs.existsSync(libraryPath)) {
          fs.mkdirSync(libraryPath, { recursive: true });
        }

        const syncCacheDir = path.join(appState.userDataPath, "SyncCache");
        if (!fs.existsSync(syncCacheDir)) {
          fs.mkdirSync(syncCacheDir, { recursive: true });
        }

        const libPathHash = crypto
          .createHash("md5")
          .update(libraryPath)
          .digest("hex");
        const hashCachePath = path.join(
          syncCacheDir,
          `hashes-${libPathHash}.json`,
        );

        let hashCache: HashCache = {};
        let cacheDirty = false;

        if (fs.existsSync(hashCachePath)) {
          try {
            hashCache = JSON.parse(
              fs.readFileSync(hashCachePath, "utf8"),
            ) as HashCache;
          } catch {
            logger.warn(
              "SYNC",
              "Failed to parse local hash cache, generating a new one.",
            );
          }
        }

        logger.info(
          "SYNC",
          `Fetching file list from ${serverIp}:${serverPort}...`,
        );
        const res = await fetch(`http://${serverIp}:${serverPort}/files`);
        const remoteFiles = (await res.json()) as RemoteSyncFile[];

        const toDownload: RemoteSyncFile[] = [];

        logger.info("SYNC", `Validating ${remoteFiles.length} files...`);
        for (let i = 0; i < remoteFiles.length; i++) {
          const rFile = remoteFiles[i];
          const localFilePath = path.join(libraryPath, rFile.name);

          event.sender.send("sync-progress", {
            status: "validating",
            current: i + 1,
            total: remoteFiles.length,
            filename: `Validating: ${rFile.name}`,
          });

          if (!fs.existsSync(localFilePath)) {
            toDownload.push(rFile);
          } else {
            const stat = fs.statSync(localFilePath);
            let localCrc: number;

            if (
              hashCache[rFile.name] &&
              hashCache[rFile.name].mtime === stat.mtimeMs
            ) {
              localCrc = hashCache[rFile.name].crc32;
            } else {
              localCrc = await calculateFileCRC32(localFilePath);
              hashCache[rFile.name] = { mtime: stat.mtimeMs, crc32: localCrc };
              cacheDirty = true;
            }

            if (localCrc !== rFile.crc32) {
              logger.warn("SYNC", `CRC mismatch for ${rFile.name}`);
              toDownload.push(rFile);
            }
          }
        }

        if (toDownload.length === 0) {
          if (cacheDirty) {
            fs.writeFileSync(hashCachePath, JSON.stringify(hashCache, null, 2));
          }
          return {
            success: true,
            message: "Library is completely up to date!",
          };
        }

        logger.info(
          "SYNC",
          `${toDownload.length} files need syncing. Starting download...`,
        );
        for (let i = 0; i < toDownload.length; i++) {
          const fileToGet = toDownload[i];
          const safeName = fileToGet.name.replace(/\\/g, "/");

          event.sender.send("sync-progress", {
            status: "downloading",
            current: i + 1,
            total: toDownload.length,
            filename: `Downloading: ${safeName}`,
            fileLoadedBytes: 0,
            fileTotalBytes: 0,
          });

          const fileUrl = `http://${serverIp}:${serverPort}/file?path=${encodeURIComponent(safeName)}`;
          const localFilePath = path.join(libraryPath, safeName);
          const dir = path.dirname(localFilePath);

          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          await new Promise<void>((resolve, reject) => {
            const req = http
              .get(fileUrl, { timeout: 15000 }, (response) => {
                if (response.statusCode !== 200) {
                  return reject(
                    new Error(
                      `Failed to get '${safeName}' (Status: ${response.statusCode ?? "unknown"})`,
                    ),
                  );
                }

                const fileTotalBytes = parseInt(
                  response.headers["content-length"] || "0",
                  10,
                );
                let fileLoadedBytes = 0;
                let lastIpcTime = 0;

                const fileStream = fs.createWriteStream(localFilePath);

                response.on("data", (chunk: Buffer) => {
                  fileLoadedBytes += chunk.length;
                  const now = Date.now();

                  if (
                    now - lastIpcTime > 50 ||
                    fileLoadedBytes === fileTotalBytes
                  ) {
                    lastIpcTime = now;
                    event.sender.send("sync-progress", {
                      status: "downloading",
                      current: i + 1,
                      total: toDownload.length,
                      filename: `Downloading: ${safeName}`,
                      fileLoadedBytes,
                      fileTotalBytes,
                    });
                  }
                });

                response.pipe(fileStream);
                fileStream.on("finish", () => {
                  fileStream.close();
                  resolve();
                });
              })
              .on("error", reject);

            req.on("timeout", () => {
              req.destroy();
              reject(
                new Error(
                  `Timeout getting '${safeName}' - Server disconnected.`,
                ),
              );
            });
          });

          const newStat = fs.statSync(localFilePath);
          hashCache[safeName] = {
            mtime: newStat.mtimeMs,
            crc32: fileToGet.crc32,
          };
          cacheDirty = true;
        }

        if (cacheDirty) {
          fs.writeFileSync(hashCachePath, JSON.stringify(hashCache, null, 2));
        }

        return {
          success: true,
          message: `Successfully synced ${toDownload.length} files.`,
        };
      } catch (error) {
        const err = error as Error;
        logger.error("SYNC", `Sync failed: ${err.message}`);
        return { success: false, error: err.message };
      }
    },
  );
}
