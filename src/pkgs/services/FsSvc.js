import NetworkingUtility from "../../libs/networkingUtility.js";
import localforage from "localforage";
const jsmediatags = window.jsmediatags;

// Internal state for the service to hold the cached song list and manifest
const state = {
  currentLibraryPath: null,
  currentManifest: null,
  songList: [],
  newSongs: [],
  isBuilding: false,
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
    // Reset state on start
    state.currentLibraryPath = null;
    state.currentManifest = null;
    state.songList = [];
    state.isBuilding = false;
  },

  data: {
    /**
     * Reads a specific file and returns its content as text.
     * @param {string} path - The full path to the file.
     * @returns {Promise<string|null>} File content or null on error.
     */
    readFile: async (path) => {
      const params = new URLSearchParams({ path: path });
      const url = `http://localhost:${actualPort}/getFile?${params.toString()}`;
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
      const url = `http://localhost:${actualPort}/drives`;
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
      const url = `http://localhost:${actualPort}/list`;
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

      const cacheKey = `encore-songlist:${libraryPath}`;
      const signatureKey = `encore-signature:${libraryPath}`;
      const newSongsKey = `encore-newsongs:${libraryPath}`;

      const audioExtensions = new Set(["wav", "mp3", "m4a"]);
      const videoExtensions = new Set(["mp4", "mkv", "webm", "avi"]);
      const validExts = new Set([
        ...audioExtensions,
        ...videoExtensions,
        "mid",
        "kar",
        "lrc",
        "json",
      ]);

      const currentSignature = [...files]
        .filter((f) => validExts.has(f.name.split(".").pop().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => `${f.name}:${f.modified}`)
        .join("|");

      const cachedSignature = await localforage.getItem(signatureKey);
      const cachedList = (await localforage.getItem(cacheKey)) || [];
      const cachedNewSongs = (await localforage.getItem(newSongsKey)) || [];

      // Check Cache
      if (cachedSignature === currentSignature && cachedList.length > 0) {
        console.log(
          `[FsSvc] Cache is fresh. Loaded ${cachedList.length} songs.`,
        );
        state.songList = cachedList;
        state.newSongs = cachedNewSongs;
        state.currentLibraryPath = libraryPath;
        state.currentManifest = loadedManifest;
        state.isBuilding = false;
        dispatchSongListReady();
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
      const oldPaths = new Set(cachedList.map((s) => s.path));
      let songCodeCounter = 1;
      const allFilenames = new Set(files.map((f) => f.name));

      const processableFiles = files.filter(
        (file) =>
          file.type === "file" &&
          (audioExtensions.has(file.name.split(".").pop().toLowerCase()) ||
            file.name.endsWith(".mid") ||
            file.name.endsWith(".kar")),
      );

      let processed = 0;
      const totalFiles = processableFiles.length;
      dispatchBuildProgress(0, totalFiles);

      for (const file of processableFiles) {
        const filename = file.name;
        const fullPath = `${libraryPath}${filename}`;

        const isMultiplexed = filename.toLowerCase().includes(".multiplexed.");
        let basename, extension;

        extension = filename.split(".").pop().toLowerCase();

        if (isMultiplexed) {
          const regex = new RegExp(`\\.multiplexed\\.${extension}$`, "i");
          basename = filename.replace(regex, "");
        } else {
          const lastDotIndex = filename.lastIndexOf(".");
          basename =
            lastDotIndex > -1 ? filename.substring(0, lastDotIndex) : filename;
        }

        let videoPath = null;
        for (const videoExt of videoExtensions) {
          const potentialVideoName = `${basename}.${videoExt}`;
          if (allFilenames.has(potentialVideoName)) {
            videoPath = `${libraryPath}${potentialVideoName}`;
            break;
          }
        }

        let songData = null;
        let artist = "Unknown Artist";
        let title = basename.replace(/\[.*?\]/g, "").trim();

        if (
          audioExtensions.has(extension) &&
          allFilenames.has(`${basename}.lrc`)
        ) {
          songData = {
            type: isMultiplexed ? "multiplexed" : "audio",
            lrcPath: `${libraryPath}${basename}.lrc`,
          };
          try {
            const urlObj = new URL(`http://127.0.0.1:${actualPort}/getFile`);
            urlObj.searchParams.append("path", fullPath);
            const tags = await new Promise((resolve, reject) => {
              jsmediatags.read(urlObj.href, {
                onSuccess: resolve,
                onError: reject,
              });
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
          songData = { type: extension, lrcPath: null };
          let parts = title.split(" - ");
          if (parts.length >= 2) {
            artist = parts[0].trim();
            title = parts.slice(1).join(" - ").trim();
          }
        }
        if (songData) {
          const newSongObj = {
            code: String(songCodeCounter++).padStart(5, "0"),
            artist,
            title,
            type: songData.type,
            path: fullPath,
            lrcPath: songData.lrcPath,
            videoPath: videoPath,
          };
          newSongList.push(newSongObj);

          if (cachedList.length > 0 && !oldPaths.has(fullPath)) {
            newlyAddedSongs.push(newSongObj);
          }
        }
        processed++;
        dispatchBuildProgress(processed, totalFiles);
      }

      state.songList = newSongList;

      if (newlyAddedSongs.length > 0) {
        state.newSongs = newlyAddedSongs;
      } else {
        state.newSongs = cachedNewSongs;
      }

      console.log(
        `[FsSvc] Build complete. Found ${state.songList.length} songs. ${state.newSongs.length} are marked as new.`,
      );

      await localforage.setItem(cacheKey, newSongList);
      await localforage.setItem(signatureKey, currentSignature);
      await localforage.setItem(newSongsKey, state.newSongs);

      state.isBuilding = false;
      dispatchSongListReady();
      return true;
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
