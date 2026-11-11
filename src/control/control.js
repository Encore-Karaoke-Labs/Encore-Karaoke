const SONG_PAGE_SIZE = 250;
const SEARCH_RESULT_LIMIT = 200;
const PLAYBACK_POLL_MS = 1000;
const PROGRESS_TICK_MS = 250;
const APP_READY_POLL_MS = 1500;
const ARTWORK_CACHE_LIMIT = 60;

const dom = {};

function el(id) {
  return document.getElementById(id);
}

function setText(node, value) {
  if (!node) return;
  const next = value == null ? "" : String(value);
  if (node.textContent !== next) node.textContent = next;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatCode(code) {
  if (code == null || code === "") return "";
  const str = String(code);
  return /^\d+$/.test(str) ? str.padStart(6, "0") : str;
}

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString();
}

function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSigned(value) {
  const number = Math.round(Number(value) || 0);
  return number > 0 ? `+${number}` : String(number);
}

function getFormatLabel(song) {
  const explicit = song?.format || song?.formatLabel;
  if (explicit) return String(explicit).slice(0, 5);
  if (song?.chorusPath) return "CHR";
  if (
    song?.isYouTube ||
    song?.type === "youtube" ||
    (song?.path && String(song.path).startsWith("yt://"))
  ) {
    return "YT";
  }
  if (song?.videoPath) return "MV";
  if (
    song?.type === "multiplexed" ||
    (song?.path && String(song.path).toLowerCase().includes("multiplex"))
  ) {
    return "MP";
  }
  if (
    song?.type === "mid" ||
    song?.type === "kar" ||
    (song?.path &&
      (String(song.path).endsWith(".mid") ||
        String(song.path).endsWith(".kar")))
  ) {
    return "MIDI";
  }
  return "RS";
}

const FORMAT_COLORS = {
  CHR: "#FFD700",
  MIDI: "#D12F9E",
  MP: "#2FD147",
  MV: "#2F6CD1",
  RS: "#B02FD1",
  YT: "#D12F2F",
};

function getFormatColor(song) {
  const explicit = song?.formatColor;
  if (typeof explicit === "string" && /^#[0-9a-f]{6}$/i.test(explicit)) {
    return explicit;
  }
  return FORMAT_COLORS[getFormatLabel(song)] || FORMAT_COLORS.RS;
}

function applyFormatColor(badge, song) {
  badge.style.backgroundColor = getFormatColor(song);
}

function songCacheKey(song) {
  return `${song?.code || ""}|${song?.title || ""}|${song?.artist || ""}`;
}

/**
 * A fixed-height virtual scroller.
 */
class SongVirtualScroller {
  constructor({
    containerId,
    contentId,
    renderRow,
    onActivate,
    onNearEnd,
    overscan = 6,
  }) {
    this.container = el(containerId);
    this.content = el(contentId);
    this.renderRow = renderRow;
    this.onActivate = onActivate;
    this.onNearEnd = onNearEnd;
    this.overscan = overscan;

    this.items = [];
    this.renderStart = -1;
    this.renderEnd = -1;
    this.lastRowHeight = 0;
    this.frame = 0;

    this.container.addEventListener(
      "scroll",
      () => {
        this.scheduleRender();
        this.maybeRequestMore();
      },
      { passive: true },
    );

    this.content.addEventListener("click", (event) => {
      const row = event.target.closest?.(".song-item");
      if (!row) return;
      const index = Number(row.dataset.index);
      const song = this.items[index];
      if (song) this.onActivate(song);
    });

    window.addEventListener("resize", () => this.scheduleRender());
  }

  getRowHeight() {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--song-row-height",
      ),
    );
    return Number.isFinite(value) && value > 0 ? value : 62;
  }

  setItems(items, { resetScroll = true } = {}) {
    this.items = Array.isArray(items) ? items : [];
    this.content.style.height = `${this.items.length * this.getRowHeight()}px`;
    if (resetScroll) this.container.scrollTop = 0;
    this.renderStart = -1;
    this.renderEnd = -1;
    this.lastRowHeight = 0;
    if (resetScroll) {
      this.render(true);
    } else {
      this.scheduleRender();
    }
  }

  appendItems(items) {
    const next = Array.isArray(items) ? items : [];
    if (next.length === 0) return;
    this.items.push(...next);
    this.content.style.height = `${this.items.length * this.getRowHeight()}px`;
    this.render(true);
  }

  clear() {
    this.setItems([]);
  }

  scheduleRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render(force = false) {
    const rowHeight = this.getRowHeight();
    if (this.items.length > 0 && rowHeight !== this.lastRowHeight) {
      this.content.style.height = `${this.items.length * rowHeight}px`;
    }
    const viewport = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;
    const start = Math.max(
      0,
      Math.floor(scrollTop / rowHeight) - this.overscan,
    );
    const end = Math.min(
      this.items.length,
      Math.ceil((scrollTop + viewport) / rowHeight) + this.overscan,
    );

    if (
      !force &&
      start === this.renderStart &&
      end === this.renderEnd &&
      rowHeight === this.lastRowHeight
    ) {
      return;
    }

    this.renderStart = start;
    this.renderEnd = end;
    this.lastRowHeight = rowHeight;

    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const row = this.renderRow(this.items[index], index);
      row.style.top = `${index * rowHeight}px`;
      fragment.appendChild(row);
    }
    this.content.replaceChildren(fragment);
  }

  maybeRequestMore() {
    if (this.items.length === 0) return;
    const rowHeight = this.getRowHeight();
    const remaining =
      this.items.length * rowHeight -
      (this.container.scrollTop + this.container.clientHeight);
    if (remaining < rowHeight * 10) this.onNearEnd?.();
  }
}

function createSongRow(song, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "song-item";
  row.dataset.index = String(index);

  const code = document.createElement("span");
  code.className = "song-code";
  code.textContent = formatCode(song.code) || "YT";

  const copy = document.createElement("span");
  copy.className = "song-copy";

  const title = document.createElement("span");
  title.className = "song-title";
  title.textContent = song.title || "Untitled";

  const meta = document.createElement("span");
  meta.className = "song-meta";

  const badge = document.createElement("span");
  badge.className = "format-badge";
  badge.textContent = getFormatLabel(song);
  applyFormatColor(badge, song);

  const artist = document.createElement("span");
  artist.className = "song-artist";
  artist.textContent = song.artist || "Unknown artist";

  meta.append(badge, artist);
  copy.append(title, meta);
  row.append(code, copy);
  row.title = `${code.textContent} · ${title.textContent} · ${artist.textContent}`;
  row.setAttribute(
    "aria-label",
    `Reserve ${title.textContent} by ${artist.textContent}, number ${code.textContent}`,
  );

  return row;
}

function createQueueMoveButton(direction, disabled, onClick) {
  const label = direction === "up" ? "Move song up" : "Move song down";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "queue-move-btn";
  button.disabled = disabled;
  button.title = label;
  button.setAttribute("aria-label", label);

  const icon = document.createElement("span");
  icon.className = `svg-icon ${
    direction === "up" ? "icon-caret-up" : "icon-caret-down"
  }`;
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (button.disabled) return;
    onClick();
  });

  return button;
}

function createQueueRow(song, index, total, canMove, onMove) {
  const row = document.createElement("div");
  row.className = "queue-item";

  const order = document.createElement("span");
  order.className = "queue-order";
  order.textContent = String(song.order ?? index + 1);

  const copy = document.createElement("span");
  copy.className = "queue-copy";

  const title = document.createElement("span");
  title.className = "queue-title";
  title.textContent = song.title || "Untitled";

  const meta = document.createElement("span");
  meta.className = "queue-meta";

  const badge = document.createElement("span");
  badge.className = "format-badge";
  badge.textContent = getFormatLabel(song);
  applyFormatColor(badge, song);

  const artist = document.createElement("span");
  artist.className = "queue-artist";
  artist.textContent = song.artist || "Unknown artist";

  meta.append(badge, artist);
  copy.append(title, meta);
  row.append(order, copy);

  if (canMove) {
    row.classList.add("has-actions");

    const actions = document.createElement("span");
    actions.className = "queue-actions";
    actions.append(
      createQueueMoveButton("up", index === 0, () => onMove(index, -1)),
      createQueueMoveButton("down", index === total - 1, () => {
        onMove(index, 1);
      }),
    );
    row.append(actions);
  }

  row.title = `${title.textContent} · ${artist.textContent}`;

  return row;
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});

async function init() {
  const ids = [
    "btn-melody",
    "melody-value",
    "btn-rhythm",
    "rhythm-value",
    "btn-bgv",
    "bgv-value",
    "btn-chorus",
    "chorus-value",
    "btn-record",
    "record-time",
    "tab-songs",
    "tab-queue",
    "queue-count",
    "songs-view",
    "queue-view",
    "queue-list",
    "queue-state",
    "queue-state-title",
    "queue-state-copy",
    "library-search",
    "search-clear",
    "song-scroller-container",
    "songs-list",
    "list-state",
    "list-state-title",
    "list-state-copy",
    "list-retry",
    "artwork-frame",
    "now-code",
    "now-title",
    "now-artist",
    "progress-track",
    "progress-fill",
    "time-current",
    "time-total",
    "vol-value",
    "mic-value",
    "key-value",
    "tempo-value",
    "btn-play-pause",
    "play-pause-icon",
    "play-pause-label",
  ];
  for (const id of ids) dom[id] = el(id);

  let playPauseInFlight = false;
  let recordInFlight = false;
  let searchTimer = 0;
  let artToken = 0;
  let currentSongKey = "\u0000";
  let pollInFlight = false;
  let appReady = false;
  let consecutiveFailures = 0;
  let offlineNotified = false;
  let currentArtworkLoads = 0;
  let artworkPreloadToken = 0;
  let queueSongs = [];
  let queueRequestId = 0;
  let lastQueueLength = -1;
  let queueIsSession = false;
  let queueMovePending = false;
  let queueEmptyTitle = "Waiting for Encore";
  let queueEmptyCopy = "The queue loads when the app is ready.";
  const artworkCache = new Map();
  const preloadedImages = new Set();

  const playbackSnapshot = {
    currentTime: 0,
    duration: 0,
    status: "stopped",
    receivedAt: 0,
  };

  const list = {
    mode: "all",
    query: "",
    requestId: 0,
    loading: false,
    done: false,
    failed: false,
    loaded: 0,
    total: 0,
  };

  function sendKey(key) {
    if (!appReady) return;
    try {
      window.desktopIntegration?.ipc?.send?.("simulate-key", key);
    } catch {
    }
  }

  function showListState(title, copy, { retry = false } = {}) {
    setText(dom["list-state-title"], title);
    setText(dom["list-state-copy"], copy);
    if (dom["list-retry"]) dom["list-retry"].hidden = !retry;
    if (dom["list-state"]) dom["list-state"].hidden = false;
  }

  function hideListState() {
    if (dom["list-state"]) dom["list-state"].hidden = true;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function preloadImage(url) {
    if (!url) return;
    const image = new Image();
    preloadedImages.add(image);
    const release = () => preloadedImages.delete(image);
    image.addEventListener("load", release, { once: true });
    image.addEventListener("error", release, { once: true });
    image.src = url;
  }

  function renderQueue() {
    const container = dom["queue-list"];
    if (!container) return;

    const fragment = document.createDocumentFragment();
    const canMove = !queueIsSession;
    for (let index = 0; index < queueSongs.length; index++) {
      fragment.appendChild(
        createQueueRow(
          queueSongs[index],
          index,
          queueSongs.length,
          canMove,
          (from, direction) => {
            void moveQueueItem(from, direction);
          },
        ),
      );
    }
    container.replaceChildren(fragment);

    setText(dom["queue-state-title"], queueEmptyTitle);
    setText(dom["queue-state-copy"], queueEmptyCopy);
    if (dom["queue-state"]) {
      dom["queue-state"].hidden = queueSongs.length > 0;
    }
    setText(dom["queue-count"], formatCount(queueSongs.length));
  }

  async function moveQueueItem(index, direction) {
    if (!appReady || queueIsSession || queueMovePending) return;
    if (!window.karaoke?.moveQueueSong) return;

    const target = index + direction;
    if (index < 0 || index >= queueSongs.length) return;
    if (target < 0 || target >= queueSongs.length) return;

    queueMovePending = true;
    try {
      const response = await window.karaoke.moveQueueSong(index, target);
      if (response?.success) {
        await refreshQueue();
      } else if (response?.isSession) {
        queueIsSession = true;
        renderQueue();
      } else {
        await refreshQueue();
      }
    } catch {
      // The periodic refresh will resynchronize the queue.
    } finally {
      queueMovePending = false;
    }
  }

  /**
   * Warms the artwork cache for the songs that are coming up.
   */
  async function preloadQueueArtwork(songs) {
    if (!window.karaoke?.getAlbumArt) return;
    const token = ++artworkPreloadToken;

    for (const song of songs.slice(0, 10)) {
      if (token !== artworkPreloadToken) return;
      if (!song?.title) continue;

      const key = songCacheKey(song);
      if (artworkCache.has(key)) continue;

      while (token === artworkPreloadToken && currentArtworkLoads > 0) {
        await sleep(200);
      }
      if (token !== artworkPreloadToken) return;

      try {
        const result = await window.karaoke.getAlbumArt({
          title: song.title || "",
          artist: song.artist || "",
          code: song.code || "",
        });
        if (token !== artworkPreloadToken) return;

        if (result?.found && result.imageUrl) {
          cacheArtwork(key, result);
          preloadImage(result.imageUrl);
        } else {
          cacheArtwork(key, null);
        }
      } catch {
        // Artwork is optional
      }

      await sleep(1100);
    }
  }

  async function refreshQueue() {
    if (!appReady || !window.karaoke?.getQueue) return;
    const requestId = ++queueRequestId;

    try {
      const response = await window.karaoke.getQueue();
      if (requestId !== queueRequestId || !appReady) return;

      queueSongs = Array.isArray(response?.songs) ? response.songs : [];
      queueIsSession = Boolean(response?.isSession);
      queueEmptyTitle = "Queue is empty";
      queueEmptyCopy = "Songs you reserve will appear here.";
      renderQueue();
      void preloadQueueArtwork(queueSongs);
    } catch {
      if (requestId !== queueRequestId) return;
      if (queueSongs.length === 0) {
        queueEmptyTitle = "Queue unavailable";
        queueEmptyCopy =
          "Encore did not answer. It will refresh automatically.";
        renderQueue();
      }
    }
  }

  function setView(view) {
    const showQueue = view === "queue";

    if (dom["songs-view"]) dom["songs-view"].hidden = showQueue;
    if (dom["queue-view"]) dom["queue-view"].hidden = !showQueue;
    dom["tab-songs"]?.classList.toggle("is-active", !showQueue);
    dom["tab-queue"]?.classList.toggle("is-active", showQueue);
    dom["tab-songs"]?.setAttribute("aria-selected", String(!showQueue));
    dom["tab-queue"]?.setAttribute("aria-selected", String(showQueue));

    if (showQueue) {
      void refreshQueue();
    } else {
      scroller.scheduleRender();
    }
  }

  const scroller = new SongVirtualScroller({
    containerId: "song-scroller-container",
    contentId: "songs-list",
    renderRow: createSongRow,
    onActivate: (song) => {
      void reserveSong(song);
    },
    onNearEnd: () => {
      if (list.mode !== "all") return;
      if (list.loading || list.done || list.failed) return;
      void loadSongPage();
    },
  });

  async function loadSongPage({ reset = false } = {}) {
    if (!appReady) return;

    if (!window.karaoke?.getSongList) {
      showListState(
        "Songbook unavailable",
        "The desktop bridge is not ready yet.",
        { retry: true },
      );
      return;
    }

    const hadRows = scroller.items.length > 0;

    if (reset) {
      list.mode = "all";
      list.query = "";
      list.loaded = 0;
      list.total = 0;
      list.done = false;
      list.failed = false;
      list.loading = false;
      list.requestId++;
      if (hadRows) hideListState();
    }

    if (list.loading || list.done) return;

    const requestId = ++list.requestId;
    list.loading = true;
    if (list.loaded === 0 && !hadRows) {
      showListState("Loading songbook", "Reading the library index…");
    }

    try {
      const response = await window.karaoke.getSongList({
        offset: list.loaded,
        limit: SONG_PAGE_SIZE,
      });
      if (requestId !== list.requestId || list.mode !== "all") return;

      const songs = Array.isArray(response?.songs) ? response.songs : [];
      list.total = Number(response?.total) || list.loaded + songs.length;
      list.loaded += songs.length;
      list.done = list.loaded >= list.total || songs.length === 0;

      if (list.loaded === 0) {
        scroller.clear();
        showListState(
          "Songbook is empty",
          "Add songs to your library and they will appear here.",
        );
        return;
      }

      hideListState();
      if (reset && hadRows) {
        scroller.setItems(songs);
      } else {
        scroller.appendItems(songs);
      }
    } catch {
      if (requestId !== list.requestId) return;
      if (list.loaded === 0) {
        list.failed = true;
        showListState(
          "Can't load the songbook",
          "Encore did not answer. Check that the app is running, then try again.",
          { retry: true },
        );
      } else {
        list.failed = true;
      }
    } finally {
      if (requestId === list.requestId) list.loading = false;
    }
  }

  async function runSearch(query) {
    if (!appReady || !window.karaoke?.searchSongs) return;

    list.mode = "search";
    list.query = query;
    list.loaded = 0;
    list.total = 0;
    list.done = true;
    list.failed = false;
    list.loading = true;
    const requestId = ++list.requestId;

    try {
      const response = await window.karaoke.searchSongs(
        query,
        SEARCH_RESULT_LIMIT,
      );
      if (requestId !== list.requestId || list.mode !== "search") return;

      const results = Array.isArray(response?.results) ? response.results : [];
      list.loading = false;
      list.loaded = results.length;
      list.total = results.length;
      scroller.setItems(results);

      if (results.length === 0) {
        showListState(
          "No songs found",
          `Nothing matched “${query}”. Try another title or artist.`,
        );
      } else {
        hideListState();
      }
    } catch {
      if (requestId !== list.requestId) return;
      list.loading = false;
      list.failed = true;
      showListState(
        "Search failed",
        "Encore did not answer. Check that the app is running, then try again.",
        { retry: true },
      );
    }
  }

  function resetList() {
    void loadSongPage({ reset: true });
  }

  /**
   * Song reservation.
   */
  async function reserveSong(song) {
    if (!appReady || !window.karaoke?.playOrReserveSong) return false;

    const label =
      typeof song === "string" ? song : song?.title || song?.code || "song";

    try {
      const response = await window.karaoke.playOrReserveSong(song);
      if (response?.success) {
        window.setTimeout(() => {
          void refreshPlayback();
          void refreshQueue();
        }, 250);
        return true;
      }
    } catch {
    }
    return false;
  }

  function hideArtwork() {
    artToken++;
    const frame = dom["artwork-frame"];
    if (!frame) return;
    frame.replaceChildren();
    frame.hidden = true;
    const stage = frame.parentElement;
    if (!stage) return;
    const backdrop = stage.querySelector(".art-backdrop");
    if (backdrop) backdrop.remove();
  }

  function cacheArtwork(key, value) {
    if (artworkCache.size >= ARTWORK_CACHE_LIMIT) {
      const oldest = artworkCache.keys().next().value;
      if (oldest) artworkCache.delete(oldest);
    }
    artworkCache.set(key, value);
  }

  function showArtwork(imageUrl, token, song) {
    const frame = dom["artwork-frame"];
    if (!frame || token !== artToken) return;

    const stage = frame.parentElement;
    if (!stage) return;

    const existingBackdrop = stage.querySelector(".art-backdrop");
    if (existingBackdrop) existingBackdrop.remove();

    const backdrop = document.createElement("img");
    backdrop.className = "art-backdrop";
    backdrop.alt = "";
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.src = imageUrl;
    stage.insertBefore(backdrop, stage.firstChild);

    const image = document.createElement("img");
    image.className = "art-image";
    image.alt = `${song?.title || "Song"} cover`;
    image.addEventListener(
      "load",
      () => {
        if (token !== artToken) return;
        frame.hidden = false;
        image.classList.add("art-entering");
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        if (token !== artToken) return;
        hideArtwork();
      },
      { once: true },
    );

    image.src = imageUrl;
    frame.replaceChildren(image);
  }

  async function loadArtwork(song) {
    if (!song || !window.karaoke?.getAlbumArt) {
      hideArtwork();
      return;
    }

    const key = songCacheKey(song);
    const token = ++artToken;

    if (artworkCache.has(key)) {
      const cached = artworkCache.get(key);
      if (cached) showArtwork(cached.imageUrl, token, song);
      return;
    }

    currentArtworkLoads++;
    try {
      const result = await window.karaoke.getAlbumArt({
        title: song.title || "",
        artist: song.artist || "",
        code: song.code || "",
      });
      if (token !== artToken) return;

      if (result?.found && result.imageUrl) {
        cacheArtwork(key, result);
        showArtwork(result.imageUrl, token, song);
      } else {
        cacheArtwork(key, null);
      }
    } catch {
      // Artwork is optional
    } finally {
      currentArtworkLoads--;
    }
  }

  function updateSong(song) {
    const key = song ? songCacheKey(song) : "";
    if (key === currentSongKey) return;

    currentSongKey = key;
    hideArtwork();

    if (!song) {
      setText(dom["now-title"], "Nothing playing");
      dom["now-title"]?.classList.add("is-empty");
      setText(dom["now-artist"], "");
      setText(dom["now-code"], "");
      return;
    }

    const code = song.code ? formatCode(song.code) : song.isYouTube ? "YT" : "";
    setText(dom["now-title"], song.title || "Unknown song");
    dom["now-title"]?.classList.remove("is-empty");
    setText(dom["now-artist"], song.artist || "");
    setText(dom["now-code"], code);

    void loadArtwork(song);
  }

  function setVolumeUI(level) {
    const percent = Math.round(clamp(Number(level) || 0, 0, 1) * 100);
    setText(dom["vol-value"], String(percent));
  }

  function setMicUI(level) {
    const percent = Math.round(clamp(Number(level) || 0, 0, 2) * 100);
    setText(dom["mic-value"], String(percent));
  }

  function setDisabled(id, disabled, title) {
    const node = dom[id];
    if (!node) return;
    node.disabled = disabled;
    if (disabled && title) node.title = title;
    else if (!disabled) node.removeAttribute("title");
  }

  function setControlAvailability(info) {
    const hasSong = appReady && Boolean(info?.currentSong);
    const guideAvailable = hasSong && info?.hasGuideNotes !== false;
    const rhythmAvailable = hasSong && Boolean(info?.isMIDI);
    const bgvAvailable = hasSong && !info?.currentSong?.isMV;
    const chorusAvailable = hasSong && Boolean(info?.hasChorus && info?.isMIDI);

    setDisabled(
      "btn-melody",
      !guideAvailable,
      "Guide melody is not available for this format.",
    );
    setDisabled(
      "btn-rhythm",
      !rhythmAvailable,
      "Rhythm patterns are only available for MIDI songs.",
    );
    setDisabled(
      "btn-bgv",
      !bgvAvailable,
      "Background video categories are not available for this format.",
    );
    setDisabled(
      "btn-chorus",
      !chorusAvailable,
      "Chorus is not available for this format.",
    );

    return { guideAvailable, rhythmAvailable, bgvAvailable, chorusAvailable };
  }

  function updateFeatureState(info) {
    const availability = setControlAvailability(info);

    setText(
      dom["melody-value"],
      availability.guideAvailable ? info?.guideMelody || "—" : "—",
    );
    dom["btn-melody"]?.classList.toggle(
      "is-persistent",
      availability.guideAvailable && Boolean(info?.guideMelodyPersistent),
    );
    setText(
      dom["rhythm-value"],
        availability.rhythmAvailable
          ? info?.rhythmName || "Original Drums"
          : "—",
    );
    setText(
      dom["bgv-value"],
        availability.bgvAvailable
          ? info?.bgvCategory || "Auto"
          : "—",
    );

    const chorusEnabled =
      availability.chorusAvailable && Boolean(info?.chorusEnabled);
    dom["btn-chorus"]?.setAttribute(
      "aria-pressed",
      chorusEnabled ? "true" : "false",
    );
    setText(
      dom["chorus-value"],
      availability.chorusAvailable ? (chorusEnabled ? "On" : "Off") : "—",
    );
  }

  function updateRecording(info) {
    const recording = Boolean(info?.isRecording);
    dom["btn-record"]?.setAttribute(
      "aria-pressed",
      recording ? "true" : "false",
    );
    if (!dom["record-time"]) return;
    dom["record-time"].hidden = !recording;
    setText(
      dom["record-time"],
      recording ? info?.recordingTime || "00:00" : "",
    );
  }

  function setPlaybackStatus(status) {
    const normalized = String(status || "stopped").toLowerCase();
    const isPlaying = normalized === "playing";

    if (dom["play-pause-icon"]) {
      dom["play-pause-icon"].className =
        `svg-icon ${isPlaying ? "icon-pause" : "icon-play"}`;
    }
    setText(dom["play-pause-label"], isPlaying ? "Pause" : "Play");
    dom["btn-play-pause"]?.setAttribute(
      "aria-pressed",
      isPlaying ? "true" : "false",
    );
  }

  function applyPlaybackInfo(info) {
    if (!info || typeof info !== "object") return;

    const status = String(info.status || "stopped").toLowerCase();
    playbackSnapshot.currentTime = Number(info.currentTime) || 0;
    playbackSnapshot.duration = Number(info.duration) || 0;
    playbackSnapshot.status = status;
    playbackSnapshot.receivedAt = performance.now();

    setPlaybackStatus(status);
    updateSong(info.currentSong || null);
    updateFeatureState(info);
    updateRecording(info);

    setText(dom["key-value"], formatSigned(info.transpose));

    if (Number.isFinite(Number(info.tempo))) {
      setText(dom["tempo-value"], Number(info.tempo).toFixed(1));
    }

    const queueLength = Number(info.queueLength) || 0;
    setText(dom["queue-count"], formatCount(queueLength));
    if (queueLength !== lastQueueLength) {
      lastQueueLength = queueLength;
      void refreshQueue();
    }

    if (Number.isFinite(Number(info.volume))) setVolumeUI(info.volume);
    if (Number.isFinite(Number(info.micVolume))) setMicUI(info.micVolume);

    tickProgress();
  }

  async function refreshPlayback() {
    if (!appReady) return;
    if (pollInFlight || !window.karaoke?.getPlaybackInfo) return;
    pollInFlight = true;
    try {
      const info = await window.karaoke.getPlaybackInfo();
      if (!info || typeof info !== "object") {
        throw new TypeError("Invalid playback info");
      }
      consecutiveFailures = 0;
      offlineNotified = false;
      applyPlaybackInfo(info);
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= 3 && !offlineNotified) {
        offlineNotified = true;
      }
    } finally {
      pollInFlight = false;
    }
  }

  function tickProgress() {
    const snapshot = playbackSnapshot;
    let current = snapshot.currentTime;

    if (snapshot.status === "playing" && snapshot.receivedAt > 0) {
      current += (performance.now() - snapshot.receivedAt) / 1000;
    }
    if (snapshot.duration > 0) current = Math.min(snapshot.duration, current);
    current = Math.max(0, current);

    const percent =
      snapshot.duration > 0
        ? clamp((current / snapshot.duration) * 100, 0, 100)
        : 0;

    if (dom["progress-fill"]) {
      dom["progress-fill"].style.width = `${percent}%`;
    }
    dom["progress-track"]?.setAttribute(
      "aria-valuenow",
      String(Math.round(percent)),
    );
    setText(dom["time-current"], formatTime(current));
    setText(dom["time-total"], formatTime(snapshot.duration));
  }

  /**
   * Controls.
   */
  async function cycleGuideMelody() {
    if (!window.karaoke?.setGuideMelody) return;
    try {
      const response = await window.karaoke.setGuideMelody("cycle");
      if (response?.success) {
        setText(dom["melody-value"], response.label || "—");
      } else {
      }
    } catch {
    }
  }

  async function adjustMasterVolume(direction) {
    if (!window.karaoke?.adjustVolume) return;
    try {
      const response = await window.karaoke.adjustVolume(direction);
      if (response?.success) setVolumeUI(response.volume);
    } catch {
    }
  }

  async function adjustMicVolume(direction) {
    if (!window.karaoke?.adjustMicVolume) return;
    try {
      const response = await window.karaoke.adjustMicVolume(direction);
      if (response?.success) setMicUI(response.micVolume);
    } catch {
    }
  }

  async function changeKey(direction) {
    if (!window.karaoke?.keyChange) return;
    try {
      const response = await window.karaoke.keyChange(direction);
      if (response?.success) {
        setText(dom["key-value"], formatSigned(response.transpose));
      }
    } catch {
    }
  }

  async function changeTempo(direction) {
    if (!window.karaoke?.changeTempo) return;
    try {
      const response = await window.karaoke.changeTempo(direction);
      if (response?.success) {
        setText(
          dom["tempo-value"],
          response.tempo.toFixed(1),
        );
      }
    } catch {
    }
  }

  async function cycleRhythm() {
    if (!window.karaoke?.cycleRhythm) return;
    try {
      const response = await window.karaoke.cycleRhythm("right");
      if (response?.success) {
        setText(
          dom["rhythm-value"],
          response.rhythmName || "Original Drums",
        );
      }
    } catch {
    }
  }

  async function cycleBgv() {
    if (!window.karaoke?.cycleBgv) return;
    try {
      const response = await window.karaoke.cycleBgv(1);
      if (response?.success) {
        setText(dom["bgv-value"], response.category || "Auto");
      }
    } catch {
    }
  }

  async function toggleChorus() {
    if (!window.karaoke?.toggleChorus) return;
    try {
      const response = await window.karaoke.toggleChorus();
      if (response?.success) {
        const enabled = Boolean(response.isChorusEnabled);
        dom["btn-chorus"]?.setAttribute(
          "aria-pressed",
          enabled ? "true" : "false",
        );
        setText(dom["chorus-value"], enabled ? "On" : "Off");
      }
    } catch {
    }
  }

  async function toggleRecording() {
    if (recordInFlight || !window.karaoke?.toggleRecording) return;
    recordInFlight = true;
    try {
      const response = await window.karaoke.toggleRecording();
      if (response?.success) {
        updateRecording(response);
      }
    } catch {
    } finally {
      recordInFlight = false;
    }
  }

  function togglePlayPause() {
    if (playPauseInFlight || !window.karaoke?.togglePlayPause) return;
    playPauseInFlight = true;
    void window.karaoke
      .togglePlayPause()
      .then((response) => {
        if (response?.status) setPlaybackStatus(response.status);
        window.setTimeout(() => void refreshPlayback(), 200);
      })
      .catch(() => {})
      .finally(() => {
        playPauseInFlight = false;
      });
  }

  function stopPlayback() {
    sendKey("Escape");
    window.setTimeout(() => void refreshPlayback(), 350);
  }

  function clearSearch() {
    window.clearTimeout(searchTimer);
    list.requestId++;
    if (dom["library-search"]) dom["library-search"].value = "";
    if (dom["search-clear"]) dom["search-clear"].hidden = true;
    resetList();
    dom["library-search"]?.focus();
  }

  function handleAction(action, target) {
    switch (action) {
      case "digit":
        sendKey(target.dataset.digit || "");
        break;
      case "backspace":
        sendKey("Backspace");
        break;
      case "enter":
        sendKey("Enter");
        break;
      case "stop":
        stopPlayback();
        break;
      case "play-pause":
        togglePlayPause();
        break;
      case "vol-up":
        void adjustMasterVolume("up");
        break;
      case "vol-down":
        void adjustMasterVolume("down");
        break;
      case "mic-up":
        void adjustMicVolume("up");
        break;
      case "mic-down":
        void adjustMicVolume("down");
        break;
      case "key-up":
        void changeKey("up");
        break;
      case "key-down":
        void changeKey("down");
        break;
      case "tempo-up":
        void changeTempo("up");
        break;
      case "tempo-down":
        void changeTempo("down");
        break;
      case "rhythm-cycle":
        void cycleRhythm();
        break;
      case "bgv-cycle":
        void cycleBgv();
        break;
      case "chorus":
        void toggleChorus();
        break;
      case "record":
        void toggleRecording();
        break;
      case "melody-cycle":
        void cycleGuideMelody();
        break;
      case "view-songs":
        setView("songs");
        break;
      case "view-queue":
        setView("queue");
        break;
      case "clear-search":
        clearSearch();
        break;
      case "retry-songs":
        if (list.mode === "search" && list.query) {
          void runSearch(list.query);
        } else {
          resetList();
        }
        break;
      default:
        break;
    }
  }

  function setAppReady(ready) {
    if (ready === appReady) {
      if (ready && list.loaded === 0 && !list.loading && !list.done) {
        resetList();
      }
      return;
    }

    appReady = ready;
    document.body.classList.toggle("is-app-ready", ready);

    if (!ready) {
      queueRequestId++;
      artworkPreloadToken++;
      queueSongs = [];
      lastQueueLength = -1;
      queueIsSession = false;
      queueMovePending = false;
      queueEmptyTitle = "Waiting for Encore";
      queueEmptyCopy = "The queue loads when the app is ready.";
      renderQueue();
      showListState(
        "Waiting for Encore",
        "The songbook loads when the app is ready.",
      );
      updateFeatureState(null);
      return;
    }

    hideListState();
    resetList();
    void refreshPlayback().finally(() => {
      if (lastQueueLength === -1) void refreshQueue();
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-action]");
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  dom["library-search"]?.addEventListener("input", () => {
    const value = dom["library-search"].value || "";
    if (dom["search-clear"]) dom["search-clear"].hidden = value.length === 0;

    window.clearTimeout(searchTimer);
    list.requestId++;
    if (!value.trim()) {
      resetList();
      return;
    }

    searchTimer = window.setTimeout(() => {
      void runSearch(value.trim());
    }, 240);
  });

  dom["library-search"]?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearSearch();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    void refreshPlayback();
    void refreshQueue();
    tickProgress();
  });

  setText(dom["now-title"], "Nothing playing");
  dom["now-title"]?.classList.add("is-empty");
  setText(dom["now-artist"], "");
  setText(dom["now-code"], "");
  setText(dom["melody-value"], "—");
  setText(dom["rhythm-value"], "—");
  setText(dom["bgv-value"], "—");
  setText(dom["chorus-value"], "—");
  setText(dom["tempo-value"], "1.0");
  setPlaybackStatus("stopped");
  updateRecording(null);
  updateFeatureState(null);
  renderQueue();
  showListState("Loading songbook", "Waiting for Encore…");

  if (window.karaoke?.onAppState) {
    window.karaoke.onAppState((ready) => setAppReady(Boolean(ready)));
  }

  async function checkAppReady() {
    try {
      const ready = await window.karaoke?.isAppReady?.();
      if (ready) setAppReady(true);
    } catch {
      // Keep waiting just like I keep waiting for her
    }
  }

  void checkAppReady();
  window.setInterval(() => {
    if (!appReady) void checkAppReady();
  }, APP_READY_POLL_MS);

  window.setInterval(() => {
    if (!document.hidden) void refreshPlayback();
  }, PLAYBACK_POLL_MS);
  window.setInterval(() => {
    if (!document.hidden) tickProgress();
  }, PROGRESS_TICK_MS);
}
