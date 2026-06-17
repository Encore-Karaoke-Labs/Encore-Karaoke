import Fuse from "fuse.js";
import Romanizer from "../../../modules/Romanizer.js";

export default class LibraryManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;
    this.fuse = null;
    this.ytSearchAbortController = null;
    this.libraryInfo = null;

    this.ctx.state.searchResults = [];
    this.ctx.state.highlightedSearchIndex = -1;
    this.ctx.state.isSearching = false;
    this.ctx.state.isSearchOverlayVisible = false;
  }

  /**
   * Initializes the library by loading local song files from the FileSystem service
   * and kicking off the background search indexer.
   */
  async init() {
    const FsSvc = this.ctx.services.FsSvc;

    this.libraryInfo = FsSvc.getLibraryInfo();
    this.ctx.state.songList = FsSvc.getSongList();
    this.ctx.state.newSongsList = FsSvc.getNewSongs
      ? FsSvc.getNewSongs() || []
      : [];
    this.ctx.state.songMap = new Map(
      this.ctx.state.songList.map((s) => [s.code, s]),
    );

    if (window.desktopIntegration) {
      window.desktopIntegration.ipc.send("setRPC", {
        details: `Browsing ${this.ctx.state.songList.length} Songs...`,
        state: `Main Menu`,
      });
    }

    this.buildSearchIndex();
  }

  /**
   * Determines format display details (label and color) based on a song's type/path.
   *
   * @param {Object} song - The song metadata object.
   * @returns {{label: string, color: string}} Style information for the given format.
   */
  getFormatInfo(song) {
    const colors = {
      MTV: "#2F6CD1",
      RealSound: "#B02FD1",
      MIDI: "#D12F9E",
      Multiplex: "#2FD147",
      YouTube: "#D12F2F",
    };

    if (
      song.type === "youtube" ||
      (song.path && song.path.startsWith("yt://"))
    ) {
      return { label: "YT", color: colors.YouTube };
    }

    if (song.videoPath) {
      return { label: "MTV", color: colors.MTV };
    }

    if (
      song.type === "multiplexed" ||
      (song.path && song.path.toLowerCase().includes("multiplex"))
    ) {
      return { label: "MP", color: colors.Multiplex };
    }

    if (
      song.type === "mid" ||
      song.type === "kar" ||
      (song.path && (song.path.endsWith(".mid") || song.path.endsWith(".kar")))
    ) {
      return { label: "MIDI", color: colors.MIDI };
    }

    return { label: "RS", color: colors.RealSound };
  }

  /**
   * Builds a search index in the background to prevent lagging the UI during searches.
   * Also asynchronously romanizes Asian characters for better searchability.
   */
  async buildSearchIndex() {
    console.log("[Encore] Building search index...");

    // Helper to generate acronyms ("Ang Huling El Bimbo" -> "aheb")
    const getAcronym = (text) => {
      if (!text) return "";
      return text
        .replace(/['’]/g, "")
        .split(/[-_.,;:'"()\[\]{}&/|\s]+/)
        .filter(Boolean)
        .map((word) => word[0].toLowerCase())
        .join("");
    };

    const fuseOptions = {
      includeScore: true,
      includeMatches: true,
      threshold: 0.4,
      ignoreLocation: true,
      useExtendedSearch: true,
      keys: [
        { name: "code", weight: 5.0 },
        { name: "title", weight: 3.0 },
        { name: "_titleAcronym", weight: 2.8 },
        { name: "artist", weight: 2.0 },
        { name: "_artistAcronym", weight: 1.8 },
        { name: "_romaTitle", weight: 1.5 },
        { name: "_romaTitleAcronym", weight: 1.4 },
        { name: "_romaArtist", weight: 1.0 },
      ],
    };

    const asianRegex =
      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

    for (let song of this.ctx.state.songList) {
      song._titleAcronym = getAcronym(song.title);
      song._artistAcronym = getAcronym(song.artist);
    }

    this.fuse = new Fuse(this.ctx.state.songList, fuseOptions);

    for (let song of this.ctx.state.songList) {
      let needsRoma = false;
      if (asianRegex.test(song.title) && !song._romaTitle) {
        song._romaTitle = await Romanizer.romanize(song.title);
        needsRoma = true;
      }
      if (asianRegex.test(song.artist) && !song._romaArtist) {
        song._romaArtist = await Romanizer.romanize(song.artist);
        needsRoma = true;
      }

      if (needsRoma) {
        song._romaTitleAcronym = getAcronym(song._romaTitle);
        song._romaArtistAcronym = getAcronym(song._romaArtist);
      }
    }

    this.fuse = new Fuse(this.ctx.state.songList, fuseOptions);
    console.log("[Encore] Search index complete.");
  }

  /**
   * Internal search logic to retrieve results from the indexer synchronously.
   *
   * @param {string} rawQuery - Text input to search.
   * @returns {Array} - Formatted and sorted local results.
   */
  getLocalSearchResults(rawQuery) {
    if (!rawQuery || !this.fuse) return [];

    const cleanQuery = rawQuery
      .replace(/[-_.,;:'"()\[\]{}&/|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const tokens = cleanQuery.split(" ").filter(Boolean);
    let fuseQuery;

    if (tokens.length > 1) {
      fuseQuery = {
        $and: tokens.map((token) => ({
          $or: [
            { code: token },
            { title: token },
            { artist: token },
            { _romaTitle: token },
            { _romaArtist: token },
            { _titleAcronym: token },
            { _artistAcronym: token },
            { _romaTitleAcronym: token },
            { _romaArtistAcronym: token },
          ],
        })),
      };
    } else {
      fuseQuery = {
        $or: [
          { code: cleanQuery },
          { title: cleanQuery },
          { artist: cleanQuery },
          { _romaTitle: cleanQuery },
          { _romaArtist: cleanQuery },
          { _titleAcronym: cleanQuery },
          { _artistAcronym: cleanQuery },
          { _romaTitleAcronym: cleanQuery },
          { _romaArtistAcronym: cleanQuery },
        ],
      };
    }

    const fuseResults = this.fuse.search(fuseQuery);

    let localResults = fuseResults.slice(0, 75).map((result) => {
      const s = result.item;
      let displayRomaTitle = null;
      let displayRomaArtist = null;

      if (result.matches) {
        for (const match of result.matches) {
          if (match.key.includes("_romaTitle")) displayRomaTitle = s._romaTitle;
          if (match.key.includes("_romaArtist"))
            displayRomaArtist = s._romaArtist;
        }
      }
      return { ...s, type: "local", displayRomaTitle, displayRomaArtist };
    });

    const isNumericQuery = /^\d+$/.test(rawQuery);
    const queryNumber = isNumericQuery ? parseInt(rawQuery, 10) : null;
    const normQuery = rawQuery.replace(/[\W_]+/g, "");

    localResults.sort((a, b) => {
      let aExactCode =
        isNumericQuery && parseInt(a.code, 10) === queryNumber ? 1 : 0;
      let bExactCode =
        isNumericQuery && parseInt(b.code, 10) === queryNumber ? 1 : 0;
      if (aExactCode !== bExactCode) return bExactCode - aExactCode;

      let aExactTitle =
        a.title && a.title.toLowerCase().replace(/[\W_]+/g, "") === normQuery
          ? 1
          : 0;
      let bExactTitle =
        b.title && b.title.toLowerCase().replace(/[\W_]+/g, "") === normQuery
          ? 1
          : 0;
      if (aExactTitle !== bExactTitle) return bExactTitle - aExactTitle;

      return 0;
    });

    return localResults;
  }

  /**
   * Queries both local indexing and YouTube APIs to render a blended set of results.
   *
   * @param {string} query - The raw text input from the user.
   */
  async performSearch(query) {
    const rawQuery = query.trim().toLowerCase();
    const state = this.ctx.state;
    const ui = this.ctx.root.ui;

    if (!rawQuery) {
      state.searchResults = [];
      ui.renderSearchResults();
      return;
    }

    state.isSearching = true;

    const localResults = this.getLocalSearchResults(rawQuery);

    state.searchResults = [...localResults];
    ui.renderSearchResults();

    if (state.isSessionActive) {
      state.isSearching = false;
      return;
    }

    if (this.ytSearchAbortController) {
      this.ytSearchAbortController.abort();
    }
    this.ytSearchAbortController = new AbortController();

    try {
      const res = await fetch(
        `http://127.0.0.1:${state.actualPort}/yt-search?q=${encodeURIComponent(rawQuery)}`,
        { signal: this.ytSearchAbortController.signal },
      );
      const data = await res.json();
      const ytItems = (data.items || [])
        .filter((i) => i.type === "video")
        .map((i) => ({ ...i, type: "youtube" }));

      state.searchResults = [...localResults, ...ytItems];
      ui.renderSearchResults();
    } catch (e) {
      if (e.name === "AbortError") {
        console.log("[Encore] YT Search aborted");
      } else {
        console.error("[Encore] YT Search failed", e);
      }
    } finally {
      state.isSearching = false;
    }
  }
}
