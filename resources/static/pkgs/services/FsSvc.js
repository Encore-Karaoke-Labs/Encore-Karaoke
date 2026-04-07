const jsmediatags = window.jsmediatags;

// Internal state for the service to hold the cached song list and manifest
const state = {
  currentLibraryPath: null,
  currentManifest: null,
  songList: [],
  isBuilding: false,
};

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
      const url = `http://localhost:9864/getFile?${params.toString()}`;
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
      const url = `http://localhost:9864/drives`;
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
      const url = `http://localhost:9864/list`;
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
     * Scans all root drives for 'EncoreLibrary' folders and reads their manifests.
     * @returns {Promise<Array<{path: string, manifest: object}>>} A list of library objects.
     */
    findEncoreLibraries: async () => {
      const drives = await pkg.data.getDrives();
      const checkPromises = drives.map(async (drive) => {
        const driveRoot = `${drive}/`;
        const rootContents = await pkg.data.getFolder(driveRoot);
        const libraryFolder = rootContents.find(
          (item) => item.name === "EncoreLibrary" && item.type === "folder",
        );

        if (libraryFolder) {
          const libraryPath = `${driveRoot}EncoreLibrary/`;
          const manifestPath = `${libraryPath}manifest.json`;
          const manifestContent = await pkg.data.readFile(manifestPath);
          let manifest = {
            title: `Unknown Library (${libraryPath})`,
            description: "Could not read or parse the manifest.json file.",
          };
          if (manifestContent) {
            try {
              manifest = JSON.parse(manifestContent);
            } catch (e) {
              console.warn(`[FsSvc] Invalid JSON in ${manifestPath}`);
            }
          }
          return { path: libraryPath, manifest };
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
      const currentSignature = files
        .map((f) => `${f.name}:${f.modified}`)
        .join("|");
      const cachedSignature = await window.localforage.getItem(signatureKey);

      // Check Cache
      if (cachedSignature === currentSignature) {
        const cachedList = await window.localforage.getItem(cacheKey);
        if (cachedList) {
          console.log(
            `[FsSvc] Cache is fresh. Loaded ${cachedList.length} songs.`,
          );
          state.songList = cachedList;
          state.currentLibraryPath = libraryPath;
          state.currentManifest = loadedManifest;
          state.isBuilding = false;
          dispatchSongListReady();
          return true;
        }
      }

      console.log(
        "[FsSvc] Cache is stale or missing. Starting full library build...",
      );
      state.currentLibraryPath = libraryPath;
      state.currentManifest = loadedManifest;
      state.songList = [];

      const newSongList = [];
      let songCodeCounter = 1;
      const audioExtensions = new Set(["wav", "mp3", "m4a"]);
      const videoExtensions = new Set(["mp4", "mkv", "webm", "avi"]);
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
            const urlObj = new URL("http://127.0.0.1:9864/getFile");
            urlObj.searchParams.append("path", fullPath);
            const tags = await new Promise((resolve, reject) => {
              jsmediatags.read(urlObj.href, {
                onSuccess: resolve,
                onError: reject,
              });
            });
            if (tags.tags.title) title = tags.tags.title;
            if (tags.tags.artist) artist = tags.tags.artist;
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
          newSongList.push({
            code: String(songCodeCounter++).padStart(5, "0"),
            artist,
            title,
            type: songData.type,
            path: fullPath,
            lrcPath: songData.lrcPath,
            videoPath: videoPath,
          });
        }

        processed++;
        dispatchBuildProgress(processed, totalFiles);
      }

      state.songList = newSongList;
      console.log(
        `[FsSvc] Build complete. Found ${state.songList.length} songs.`,
      );

      await window.localforage.setItem(cacheKey, newSongList);
      await window.localforage.setItem(signatureKey, currentSignature);

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
  },

  end: async function () {
    console.log("[FsSvc] File System Service stopped.");
  },
};

export default pkg;
