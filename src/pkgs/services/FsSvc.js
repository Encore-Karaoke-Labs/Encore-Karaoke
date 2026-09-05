import localforage from "localforage";
import { BasicMIDI } from "spessasynth_core";
import NetworkingUtility from "../../libs/networkingUtility.js";
const jsmediatags = window.jsmediatags;

/**
 * Attempts to detect the correct text encoding for MIDI lyrics data to prevent mojibake.
 *
 * @param {Uint8Array} uint8Array - The raw byte data of the lyrics.
 * @returns {string} The identified encoding standard.
 */
function detectEncoding(uint8Array) {
  const encodings = [
    "utf-8",
    "shift-jis",
    "euc-kr",
    "windows-1250",
    "windows-1252",
    "utf-16le",
  ];
  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(uint8Array);
      if (text.includes("\uFFFD")) continue;
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || [])
        .length;
      if (text.length > 0 && controlChars / text.length > 0.05) continue;
      return encoding;
    } catch (e) {
      continue;
    }
  }
  return "utf-8";
}

/**
 * Helper utility to process an array of items concurrently with a maximum limit.
 *
 * @param {Array} items - The items to process.
 * @param {number} maxConcurrent - Maximum number of active async tasks.
 * @param {Function} processFn - Async function to run on each item.
 * @param {Function} progressCb - Callback for reporting progress.
 * @param {AbortSignal} abortSignal - Optional abort signal to cancel processing.
 * @returns {Promise<Array>} Results mapped to the exact original array order.
 */
async function processConcurrent(
  items,
  maxConcurrent,
  processFn,
  progressCb,
  abortSignal,
) {
  const results = new Array(items.length);
  let index = 0;
  let processed = 0;

  const worker = async () => {
    while (index < items.length) {
      if (abortSignal?.aborted) {
        throw new Error("Build cancelled");
      }
      const currentIndex = index++;
      results[currentIndex] = await processFn(items[currentIndex]);
      processed++;
      if (progressCb) progressCb(processed, items.length);
    }
  };

  const workers = Array.from(
    { length: Math.min(maxConcurrent, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// Internal state for the service to hold the cached song list and manifest
const state = {
  currentLibraryPath: null,
  currentManifest: null,
  songList: [],
  newSongs: [],
  isBuilding: false,
  buildAbortController: null,
};

let actualPort = 9864;

/**
 * Dispatches a custom event to notify the OS/apps that the song list is ready or updated.
 */
function dispatchSongListReady() {
  document.dispatchEvent(
    new CustomEvent("CherryTree.FsSvc.SongList.Ready", {
      detail: {
        libraryPath: state.currentLibraryPath,
        songCount: state.songList.length,
        manifest: state.currentManifest,
      },
    }),
  );
}

/**
 * Dispatches a progress event for the song list building process.
 */
function dispatchBuildProgress(current, total) {
  document.dispatchEvent(
    new CustomEvent("CherryTree.FsSvc.SongList.Progress", {
      detail: {
        current,
        total,
        percentage: Math.round((current / total) * 100),
      },
    }),
  );
}

const pkg = {
  name: "File System Service",
  svcName: "FsSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    actualPort = await NetworkingUtility.getPort();
    console.log("[FsSvc] File System Service started.");
    state.currentLibraryPath = null;
    state.currentManifest = null;
    state.songList = [];
    state.isBuilding = false;
    state.buildAbortController = null;

    window.desktopIntegration.ipc.on("cancel-songbook-build", () => {
      console.log("[FsSvc] Received cancel-songbook-build message");
      if (state.buildAbortController) {
        console.log("[FsSvc] Build is active, aborting...");
        console.log("[FsSvc] Current build state:", {
          isBuilding: state.isBuilding,
          libraryPath: state.currentLibraryPath,
          songListLength: state.songList.length,
        });
        state.buildAbortController.abort();
        state.buildAbortController = null;
        state.isBuilding = false;
        console.log("[FsSvc] Build abort signal sent and state cleared");
      } else {
        console.log("[FsSvc] No active build to cancel");
      }
    });

    window.desktopIntegration.ipc.on(
      "request-songbook-data",
      async (event, payload) => {
        const { folderPath, filePath, libraryTitle } = payload;
        let targetSongs = [];

        const progressHandler = (e) => {
          window.desktopIntegration.ipc.send(
            "songbook-build-progress",
            e.detail,
          );
        };
        document.addEventListener(
          "CherryTree.FsSvc.SongList.Progress",
          progressHandler,
        );

        if (state.currentLibraryPath === folderPath) {
          targetSongs = pkg.data.getSongList();
        } else {
          const prevLib = state.currentLibraryPath;
          const prevManifest = state.currentManifest;
          const prevSongs = [...state.songList];
          const prevNew = [...state.newSongs];

          const success = await pkg.data.buildSongList(folderPath);
          if (success) targetSongs = pkg.data.getSongList();

          state.currentLibraryPath = prevLib;
          state.currentManifest = prevManifest;
          state.songList = prevSongs;
          state.newSongs = prevNew;

          dispatchSongListReady();
        }

        document.removeEventListener(
          "CherryTree.FsSvc.SongList.Progress",
          progressHandler,
        );

        window.desktopIntegration.ipc.send("receive-songbook-data", {
          songs: targetSongs,
          filePath,
          libraryTitle,
        });
      },
    );
  },

  data: {
    /**
     * Reads a specific file and returns its content as text.
     * @param {string} path - The full path to the file.
     * @returns {Promise<string|null>} File content or null on error.
     */
    readFile: async (path) => {
      const url = await NetworkingUtility.getFileLink(path);
      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
          const errorData = await res.json();
          console.error(
            `[FsSvc] Error fetching file ${path}:`,
            errorData.error_msg,
          );
          return null;
        }
        return await res.text();
      } catch (err) {
        console.error(`[FsSvc] Network or fetch error for file ${path}:`, err);
        return null;
      }
    },

    /**
     * Fetches a list of all available drives.
     * @returns {Promise<Array<string>>}
     */
    getDrives: async () => {
      let accessToken = await NetworkingUtility.getAccessToken();
      const url = `http://localhost:${actualPort}/drives?token=${accessToken}`;
      try {
        const res = await fetch(url);
        return await res.json();
      } catch (err) {
        return [];
      }
    },

    /**
     * Fetches the contents of a specific directory.
     * @param {string} path - The full path to the directory.
     * @returns {Promise<Array<object>>}
     */
    getFolder: async (path) => {
      let accessToken = await NetworkingUtility.getAccessToken();
      const url = `http://localhost:${actualPort}/list?token=${accessToken}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir: path }),
        });
        const data = await res.json();
        if (data.error) return null;
        return data;
      } catch (err) {
        return null;
      }
    },

    /**
     * Scans known configured libraries and root drives for Encore libraries.
     * @returns {Promise<Array<{path: string, manifest: object}>>} A list of library objects.
     */
    findEncoreLibraries: async () => {
      const config = await window.config.getAll();
      const knownPaths = config.knownLibraries || [];

      const drives = await pkg.data.getDrives();
      const checkLegacyPromises = drives.map(async (drive) => {
        const driveRoot = `${drive}/`;
        const rootContents = await pkg.data.getFolder(driveRoot);
        if (!rootContents) return null;

        const libraryFolder = rootContents.find(
          (item) => item.name === "EncoreLibrary" && item.type === "folder",
        );
        return libraryFolder ? `${driveRoot}EncoreLibrary/` : null;
      });

      const legacyPaths = (await Promise.all(checkLegacyPromises)).filter(
        Boolean,
      );

      const allPaths = [...new Set([...knownPaths, ...legacyPaths])];

      const checkPromises = allPaths.map(async (libPath) => {
        let formattedPath = libPath.replace(/\\/g, "/");
        if (!formattedPath.endsWith("/")) formattedPath += "/";

        const manifestPath = `${formattedPath}manifest.json`;
        const manifestContent = await pkg.data.readFile(manifestPath);

        if (manifestContent) {
          try {
            const manifest = JSON.parse(manifestContent);
            return { path: formattedPath, manifest };
          } catch (e) {
            console.warn(`[FsSvc] Invalid JSON in ${manifestPath}`);
            return {
              path: formattedPath,
              manifest: {
                title: "Invalid Library",
                description: "Corrupted manifest.json",
              },
            };
          }
        }
        return null;
      });

      const results = await Promise.all(checkPromises);
      return results.filter((lib) => lib !== null);
    },

    /**
     * [ACTION] Builds the song list from a library path, using a cache if available.
     * @param {string} libraryPath - The full path to the 'EncoreLibrary' folder.
     * @returns {Promise<boolean>} True if the list is ready (from cache or build), false on error.
     */
    buildSongList: async (libraryPath) => {
      if (state.isBuilding) {
        console.warn("[FsSvc] Song list build already in progress.");
        return false;
      }
      if (!libraryPath) {
        console.error("[FsSvc] buildSongList called with no library path.");
        return false;
      }

      state.isBuilding = true;
      state.buildAbortController = new AbortController();
      console.log(`[FsSvc] Checking song list for: ${libraryPath}`);

      let loadedManifest = null;
      try {
        const manifestContent = await pkg.data.readFile(
          `${libraryPath}manifest.json`,
        );
        if (manifestContent) {
          loadedManifest = JSON.parse(manifestContent);
        }
      } catch (e) {
        console.warn("[FsSvc] Failed to load manifest for current library", e);
      }

      const files = await pkg.data.getFolder(libraryPath);
      if (!files) {
        state.isBuilding = false;
        return false;
      }

      const cacheVersion = "v3"; // Standalone video file support
      const cacheKey = `encore-songlist:${cacheVersion}:${libraryPath}`;
      const signatureKey = `encore-signature:${cacheVersion}:${libraryPath}`;
      const newSongsKey = `encore-newsongs:${cacheVersion}:${libraryPath}`;

      // macOS readdir returns NFD; Windows/Linux return NFC
      const nfc = (s) => (typeof s === "string" ? s.normalize("NFC") : s);
      const isAppleDouble = (name) => name.startsWith("._");

      const audioExtensions = new Set(["wav", "mp3", "m4a", "ogg"]);
      const videoExtensions = new Set(["mp4", "mkv", "webm", "avi"]);
      const validExts = new Set([
        ...audioExtensions,
        ...videoExtensions,
        "mid",
        "kar",
        "lrc",
        "json",
        "cdg",
      ]);

      const currentSignature = [...files]
        .filter((f) => {
          if (isAppleDouble(f.name)) return false;
          const name = nfc(f.name).toLowerCase();
          if (name === "songdb.json" || name === "manifest.json") return false;
          return validExts.has(name.split(".").pop());
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => `${nfc(f.name)}:${f.modified}`)
        .join("|");

      const cachedSignature = await localforage.getItem(signatureKey);
      const cachedList = (await localforage.getItem(cacheKey)) || [];
      const cachedNewSongs = (await localforage.getItem(newSongsKey)) || [];

      let embeddedCache = null;
      try {
        const embeddedContent = await pkg.data.readFile(
          `${libraryPath}songdb.json`,
        );
        if (embeddedContent) embeddedCache = JSON.parse(embeddedContent);
      } catch (e) {
        // No embedded cache found
      }

      const toRelative = (p) =>
        nfc(
          p && (p.includes("/") || p.includes("\\"))
            ? p.replace(/\\/g, "/").split("/").pop()
            : p,
        );
      const toAbsolute = (p) => (p ? `${libraryPath}${p}` : null);

      // water up 💧💧💧
      const hydrateSong = (song) => ({
        ...song,
        path: toAbsolute(toRelative(song.path)),
        lrcPath: toAbsolute(toRelative(song.lrcPath)),
        cdgPath: toAbsolute(toRelative(song.cdgPath)),
        videoPath: toAbsolute(toRelative(song.videoPath)),
        chorusPath: toAbsolute(toRelative(song.chorusPath)),
      });

      let validCacheList = null;
      let validNewSongs = null;

      if (
        embeddedCache &&
        embeddedCache.signature === currentSignature &&
        embeddedCache.songList?.length > 0
      ) {
        validCacheList = embeddedCache.songList;
        validNewSongs = embeddedCache.newSongs || [];
        console.log(
          `[FsSvc] Embedded cache is fresh. Loaded ${validCacheList.length} songs.`,
        );
      } else if (
        cachedSignature === currentSignature &&
        cachedList.length > 0
      ) {
        validCacheList = cachedList;
        validNewSongs = cachedNewSongs;
        console.log(
          `[FsSvc] Local cache is fresh. Loaded ${validCacheList.length} songs.`,
        );
      }

      if (validCacheList) {
        state.songList = validCacheList.map(hydrateSong);
        state.newSongs = validNewSongs.map(hydrateSong);
        state.currentLibraryPath = libraryPath;
        state.currentManifest = loadedManifest;
        state.isBuilding = false;
        dispatchSongListReady();

        if (!embeddedCache || embeddedCache.signature !== currentSignature) {
          const shrinkSong = (song) => ({
            ...song,
            path: toRelative(song.path),
            lrcPath: toRelative(song.lrcPath),
            cdgPath: toRelative(song.cdgPath),
            videoPath: toRelative(song.videoPath),
            chorusPath: toRelative(song.chorusPath),
          });

          window.desktopIntegration.ipc
            .invoke("save-songbook-cache", {
              libraryPath,
              songList: validCacheList.map(shrinkSong),
              newSongs: validNewSongs.map(shrinkSong),
              signature: currentSignature,
            })
            .catch((e) =>
              console.warn("[FsSvc] Failed to write embedded cache", e),
            );
        }

        return true;
      }

      console.log(
        "[FsSvc] Cache is stale or missing. Starting full library build...",
      );
      state.currentLibraryPath = libraryPath;
      state.currentManifest = loadedManifest;
      state.songList = [];
      state.newSongs = [];

      const newSongList = [];
      const newlyAddedSongs = [];

      const previousList = embeddedCache?.songList || cachedList || [];
      const codeMap = new Map();
      let maxCode = 0;

      for (const song of previousList) {
        const relPath = toRelative(song.path);
        if (!relPath) continue;

        codeMap.set(relPath, song.code);

        const numCode = parseInt(song.code, 10);
        if (!isNaN(numCode) && numCode > maxCode) {
          maxCode = numCode;
        }
      }

      // Case- and normalization-insensitive index of what's on disk. Commercial
      // CDG libraries are typically all-uppercase ("SONG.MP3" + "SONG.CDG"),
      // and an exact-case Set lookup silently fails to pair them. Maps the
      // folded name back to the real on-disk name, which is what I/O needs.
      const byLower = new Map(
        files.map((f) => [nfc(f.name).toLowerCase(), f.name]),
      );
      const findSibling = (name) =>
        byLower.get(nfc(name).toLowerCase()) || null;

      const processableFiles = files.filter((file) => {
        if (file.type !== "file" || isAppleDouble(file.name)) return false;
        const ext = nfc(file.name).split(".").pop().toLowerCase();
        return audioExtensions.has(ext) || ext === "mid" || ext === "kar";
      });

      processableFiles.sort((a, b) => a.name.localeCompare(b.name));

      const totalFiles = processableFiles.length;
      dispatchBuildProgress(0, totalFiles);

      try {
        const parsedFilesData = await processConcurrent(
          processableFiles,
          30,
          async (file) => {
            if (state.buildAbortController?.signal.aborted) {
              throw new Error("Build cancelled");
            }
            const filename = file.name;
            const fullPath = `${libraryPath}${filename}`;

            const isMultiplexed = filename
              .toLowerCase()
              .includes(".multiplexed.");
            let basename, extension;

            extension = filename.split(".").pop().toLowerCase();

            if (isMultiplexed) {
              const regex = new RegExp(`\\.multiplexed\\.${extension}$`, "i");
              basename = filename.replace(regex, "");
            } else {
              const lastDotIndex = filename.lastIndexOf(".");
              basename =
                lastDotIndex > -1
                  ? filename.substring(0, lastDotIndex)
                  : filename;
            }

            let videoName = null;
            for (const videoExt of videoExtensions) {
              videoName = findSibling(`${basename}.${videoExt}`);
              if (videoName) break;
            }

            let chorusName = null;
            for (const audioExt of audioExtensions) {
              chorusName = findSibling(`${basename}.chorus.${audioExt}`);
              if (chorusName) break;
            }

            let songData = null;
            let artist = "Unknown Artist";
            let title = basename.replace(/\[.*?\]/g, "").trim();

            const lrcName = findSibling(`${basename}.lrc`);
            const cdgName = findSibling(`${basename}.cdg`);
            const hasLrc = Boolean(lrcName);
            const hasCdg = Boolean(cdgName);

            if (audioExtensions.has(extension) && (hasLrc || hasCdg)) {
              if (state.buildAbortController?.signal.aborted) {
                throw new Error("Build cancelled");
              }
              songData = {
                type: isMultiplexed ? "multiplexed" : hasCdg ? "cdg" : "audio",
                lrcPath: lrcName,
                cdgPath: cdgName,
              };
              try {
                const urlObj = await NetworkingUtility.getFileLink(fullPath);
                const tags = await new Promise((resolve, reject) => {
                  if (state.buildAbortController?.signal.aborted) {
                    reject(new Error("Build cancelled"));
                  } else {
                    jsmediatags.read(urlObj.href, {
                      onSuccess: resolve,
                      onError: reject,
                    });
                  }
                });
                if (tags.tags.title) title = tags.tags.title;
                if (tags.tags.artist) artist = tags.tags.artist;

                if (!tags.tags.title && !tags.tags.artist) {
                  let parts = title.split(" - ");
                  if (parts.length >= 2) {
                    artist = parts[0].trim();
                    title = parts.slice(1).join(" - ").trim();
                  }
                }
              } catch (error) {
                console.warn(
                  `[FsSvc] Tag read failed for ${filename}, using filename.`,
                );
                let parts = title.split(" - ");
                if (parts.length >= 2) {
                  artist = parts[0].trim();
                  title = parts.slice(1).join(" - ").trim();
                }
              }
            } else if (extension === "mid" || extension === "kar") {
              if (state.buildAbortController?.signal.aborted) {
                throw new Error("Build cancelled");
              }
              songData = { type: extension, lrcPath: null, cdgPath: null };
              let parsedFromMidi = false;

              if (filename.toLowerCase().endsWith(".xtsp.mid")) {
                try {
                  if (state.buildAbortController?.signal.aborted)
                    throw new Error("Build cancelled");
                  const urlObj = await NetworkingUtility.getFileLink(fullPath);
                  const res = await fetch(urlObj.href);

                  if (res.ok) {
                    const arrayBuffer = await res.arrayBuffer();
                    const parsedMidi = BasicMIDI.fromArrayBuffer(arrayBuffer);

                    let bestTitle = null;
                    let bestArtist = "Unknown Artist";
                    let foundWithDollar = false;

                    for (const track of parsedMidi.tracks) {
                      for (const e of track.events) {
                        if (
                          e.data &&
                          e.data instanceof Uint8Array &&
                          e.data.length > 2
                        ) {
                          if (e.data[0] === 0x40) {
                            const encoding = detectEncoding(e.data);
                            const text = new TextDecoder(encoding)
                              .decode(e.data)
                              .replace(/\0/g, "")
                              .trim();

                            if (text.length <= 2) continue;

                            const dollarIndex = text.indexOf("$");
                            if (dollarIndex !== -1) {
                              let rawTitle = text.substring(1, dollarIndex);
                              bestTitle = rawTitle.replace(/@/g, " ").trim();

                              const artistMatch = text.match(/\$3([^$]+)/);
                              if (artistMatch) {
                                bestArtist = artistMatch[1].trim();
                              } else {
                                const segments = text
                                  .substring(dollarIndex)
                                  .split(/\$[0-9]+/);
                                bestArtist =
                                  segments[segments.length - 1].trim() ||
                                  "Unknown Artist";
                              }
                              foundWithDollar = true;
                              break;
                            } else {
                              if (!bestTitle)
                                bestTitle = text
                                  .substring(1)
                                  .replace(/@/g, " ")
                                  .trim();
                            }
                          }
                        }
                      }
                      if (foundWithDollar) break;
                    }

                    if (bestTitle) {
                      title = bestTitle;
                      artist = bestArtist;
                      parsedFromMidi = true;
                    }
                  }
                } catch (err) {
                  console.warn(
                    `[FsSvc] Failed to parse PLATINUM metadata for ${filename}:`,
                    err,
                  );
                }
              }

              if (!parsedFromMidi) {
                let parts = title.split(" - ");
                if (parts.length >= 2) {
                  artist = parts[0].trim();
                  title = parts.slice(1).join(" - ").trim();
                }
              }
            }

            if (songData) {
              return {
                artist,
                title,
                type: songData.type,
                path: filename,
                lrcPath: songData.lrcPath,
                cdgPath: songData.cdgPath,
                videoPath: videoName,
                chorusPath: chorusName,
              };
            }
            return null;
          },
          (processed) => {
            dispatchBuildProgress(processed, totalFiles);
          },
          state.buildAbortController?.signal,
        );

        for (const parsedData of parsedFilesData) {
          if (!parsedData) continue;

          let songCode;
          if (codeMap.has(parsedData.path)) {
            songCode = codeMap.get(parsedData.path);
          } else {
            maxCode++;
            songCode = String(maxCode).padStart(6, "0");
          }

          const newSongObj = {
            code: songCode,
            artist: parsedData.artist,
            title: parsedData.title,
            type: parsedData.type,
            path: parsedData.path,
            lrcPath: parsedData.lrcPath,
            cdgPath: parsedData.cdgPath,
            videoPath: parsedData.videoPath,
            chorusPath: parsedData.chorusPath,
          };

          newSongList.push(newSongObj);

          if (previousList.length > 0 && !codeMap.has(parsedData.path)) {
            newlyAddedSongs.push(newSongObj);
          }
        }

        newSongList.sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));

        const previousNewSongs =
          embeddedCache?.newSongs || cachedNewSongs || [];
        const relativeNewSongs =
          newlyAddedSongs.length > 0
            ? newlyAddedSongs
            : previousNewSongs.map((s) => ({
                ...s,
                path: toRelative(s.path),
                lrcPath: toRelative(s.lrcPath),
                cdgPath: toRelative(s.cdgPath),
                videoPath: toRelative(s.videoPath),
                chorusPath: toRelative(s.chorusPath),
              }));

        state.songList = newSongList.map(hydrateSong);
        state.newSongs = relativeNewSongs.map(hydrateSong);

        console.log(
          `[FsSvc] Build complete. Found ${state.songList.length} songs. ${state.newSongs.length} new.`,
        );

        await localforage.setItem(cacheKey, newSongList);
        await localforage.setItem(signatureKey, currentSignature);
        await localforage.setItem(newSongsKey, relativeNewSongs);

        await window.desktopIntegration.ipc
          .invoke("save-songbook-cache", {
            libraryPath,
            songList: newSongList,
            newSongs: relativeNewSongs,
            signature: currentSignature,
          })
          .catch((err) =>
            console.warn("[FsSvc] Failed to write embedded cache", err),
          );

        state.isBuilding = false;
        state.buildAbortController = null;
        dispatchSongListReady();
        return true;
      } catch (err) {
        if (err.message === "Build cancelled") {
          console.log("[FsSvc] Song list build was cancelled successfully.");
        } else {
          console.error("[FsSvc] Error during song list build:", err.message);
        }
        state.isBuilding = false;
        state.buildAbortController = null;
        return false;
      }
    },

    /**
     * [GETTER] Instantly returns the currently cached song list.
     * @returns {Array<object>} The cached list of song objects.
     */
    getSongList: () => {
      return state.songList;
    },

    /**
     * [GETTER] Instantly returns the new song list.
     * @returns {Array<object>} The cached list of song objects.
     */
    getNewSongs: () => {
      return state.newSongs;
    },

    /**
     * [GETTER] Returns the current library path and its parsed manifest info.
     * Use this to retrieve SoundFonts, BGV lists, and library description.
     * @returns {object|null} { path: string, manifest: object } or null if no library is loaded.
     */
    getLibraryInfo: () => {
      if (!state.currentLibraryPath) return null;
      return {
        path: state.currentLibraryPath,
        manifest: state.currentManifest,
      };
    },

    /**
     * Fetches a list of custom user Background Videos.
     * @returns {Promise<Array<string>>}
     */
    getUserBGVs: async () => {
      const url = `http://localhost:${actualPort}/user-bgv-list`;
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        return await res.json();
      } catch (err) {
        console.error("[FsSvc] Failed to fetch User BGVs:", err);
        return [];
      }
    },
  },

  end: async function () {
    console.log("[FsSvc] File System Service stopped.");
  },
};

export default pkg;
