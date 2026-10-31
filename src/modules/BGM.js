/**
 * BGMModule - Manifest-driven background music with shuffled playback.
 *
 * Each instance owns one BGM channel, so the same module can be used for any
 * future background-music need by supplying a different manifest or options.
 */
export class BGMModule {
  constructor(forte, options = {}) {
    this.forte = forte;
    this.defaultManifestPath = options.manifestPath || "";
    this.defaultVolume = Number.isFinite(options.volume) ? options.volume : 0.2;
    this.defaultFadeIn = Number.isFinite(options.fadeIn) ? options.fadeIn : 1.1;

    this.playlists = new Map();
    this.currentTrack = null;
    this.generation = 0;
  }

  /**
   * Preloads a track manifest without starting playback.
   *
   * @param {string} [manifestPath] - Manifest to preload.
   * @returns {Promise<Object[]>} The normalized tracks.
   */
  preload(manifestPath = this.defaultManifestPath) {
    if (!manifestPath) return Promise.resolve([]);
    return this.loadManifest(this.getPlaylist(manifestPath));
  }

  /**
   * Returns the cached playlist state for a manifest, creating it if needed.
   *
   * @param {string} manifestPath - Manifest URL.
   */
  getPlaylist(manifestPath) {
    let playlist = this.playlists.get(manifestPath);
    if (!playlist) {
      playlist = {
        manifestPath,
        tracks: [],
        promise: null,
        shuffleBag: [],
        lastTrackIndex: -1,
      };
      this.playlists.set(manifestPath, playlist);
    }
    return playlist;
  }

  /**
   * Reads and normalizes a playlist manifest.
   *
   * @param {Object} playlist - Playlist state from getPlaylist().
   * @returns {Promise<Object[]>} Normalized tracks.
   */
  async loadManifest(playlist) {
    if (playlist.tracks.length > 0) return playlist.tracks;
    if (playlist.promise) return playlist.promise;

    playlist.promise = (async () => {
      try {
        const response = await fetch(playlist.manifestPath, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) return playlist.tracks;

        playlist.tracks = data
          .filter((track) => track && typeof track.PATH === "string")
          .map((track) => {
            const path = track.PATH.trim();
            const trackName =
              typeof track.TRACK_NAME === "string"
                ? track.TRACK_NAME.trim()
                : "";
            const artists =
              typeof track.ARTISTS === "string" ? track.ARTISTS.trim() : "";
            return {
              name: trackName || path.split("/").pop() || "UNTITLED",
              artists,
              path,
              url: this.resolveTrackUrl(playlist.manifestPath, path),
            };
          })
          .filter((track) => track.path.length > 0);
      } catch (e) {
        console.warn(
          `[BGM] Failed to load manifest: ${playlist.manifestPath}`,
          e,
        );
        // Allow the next play attempt to retry instead of caching the failure.
        playlist.promise = null;
      }
      return playlist.tracks;
    })();

    return playlist.promise;
  }

  /**
   * Resolves a track path relative to its manifest.
   *
   * @param {string} manifestPath - Manifest URL.
   * @param {string} trackPath - Track path from the manifest.
   * @returns {string} Absolute track URL.
   */
  resolveTrackUrl(manifestPath, trackPath) {
    const base = new URL("./", new URL(manifestPath, window.location.href));
    return new URL(trackPath.replace(/^\/+/, ""), base).href;
  }

  /**
   * Picks the next track, shuffling the list so tracks are not repeated until
   * every entry has been played once.
   *
   * @param {Object} playlist - Playlist state from getPlaylist().
   * @returns {Object|null} The selected track.
   */
  pickTrack(playlist) {
    const tracks = playlist.tracks;
    if (tracks.length === 0) return null;
    if (tracks.length === 1) return tracks[0];

    if (playlist.shuffleBag.length === 0) {
      playlist.shuffleBag = tracks.map((_, index) => index);
      for (let i = playlist.shuffleBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist.shuffleBag[i], playlist.shuffleBag[j]] = [
          playlist.shuffleBag[j],
          playlist.shuffleBag[i],
        ];
      }

      const nextIndex = playlist.shuffleBag[playlist.shuffleBag.length - 1];
      if (nextIndex === playlist.lastTrackIndex) {
        const swapIndex = playlist.shuffleBag.length - 2;
        const endIndex = playlist.shuffleBag.length - 1;
        [playlist.shuffleBag[endIndex], playlist.shuffleBag[swapIndex]] = [
          playlist.shuffleBag[swapIndex],
          playlist.shuffleBag[endIndex],
        ];
      }
    }

    const index = playlist.shuffleBag.pop();
    playlist.lastTrackIndex = index;
    return tracks[index];
  }

  /**
   * Starts a randomly selected BGM track.
   *
   * @param {Object} [options] - Playback overrides.
   * @param {string} [options.manifestPath] - Manifest to play from.
   * @param {number} [options.volume] - Relative volume from 0.0 to 1.0.
   * @param {number} [options.fadeIn] - Fade-in duration in seconds.
   * @returns {Promise<Object|null>} The selected track, or null if none played.
   */
  async play(options = {}) {
    const manifestPath = options.manifestPath || this.defaultManifestPath;
    if (!manifestPath) return null;

    const volume = Number.isFinite(options.volume)
      ? options.volume
      : this.defaultVolume;
    const fadeIn = Number.isFinite(options.fadeIn)
      ? options.fadeIn
      : this.defaultFadeIn;
    const run = ++this.generation;
    const playlist = this.getPlaylist(manifestPath);

    const tracks = await this.loadManifest(playlist);
    if (run !== this.generation || tracks.length === 0) return null;

    const track = this.pickTrack(playlist);
    if (!track) return null;

    const started = await this.forte.playBgm(track.url, volume, fadeIn);
    if (!started || run !== this.generation) {
      if (started) this.forte.stopBgm(0);
      return null;
    }

    this.currentTrack = track;
    return track;
  }

  /**
   * Stops the current BGM track with a short fade.
   *
   * @param {number} [fadeOut=0.45] - Fade-out duration in seconds.
   */
  stop(fadeOut = 0.45) {
    this.generation++;
    this.currentTrack = null;
    this.forte.stopBgm(fadeOut);
  }
}
