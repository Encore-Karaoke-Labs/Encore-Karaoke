const urlParams = new URLSearchParams(window.location.search);
const isMac = urlParams.get("platform") === "darwin";
if (isMac) {
  document.body.classList.add("is-mac");
  document.getElementById("openFolderBtn").innerText = "Open in Finder";
}
const ipc = window.desktopIntegration.ipc;
window.ipc = ipc;

let appData = { active: null, libraries: [] };
let selectedLib = null;
let bgvData = [];
let bgvSaveTimeout = null;
let manifestSaveTimeout = null;

let bumperData = [];
let bumperSaveTimeout = null;
let bumperVirtualList = null;
const imagePreviewCache = new Map();

let songIndex = []; // Pre-normalized array of { raw: string, lower: string }
let filteredIndices = null; // Int array of matched indices in songIndex, null = all
let activeSongScanToken = 0;
let songSearchDebounceTimer = null;
let songListScrollAttached = false;
const SONG_ROW_HEIGHT = 36;
const SONG_OVERSCAN = 8;

let bgvVirtualLists = {};

/**
 * Reusable Virtual List component
 */
class VirtualList {
  constructor({
    container,
    itemHeight,
    maxHeight = Infinity,
    overscan = 5,
    items = [],
    renderItem,
    onEmpty,
  }) {
    this.container = container;
    this.itemHeight = itemHeight;
    this.maxHeight = maxHeight;
    this.overscan = overscan;
    this.items = items;
    this.renderItem = renderItem;
    this.onEmpty = onEmpty;

    this.renderedStart = -1;
    this.renderedEnd = -1;
    this.ticking = false;

    this.initDOM();
    this.attachEvents();
    this.render();
  }

  initDOM() {
    this.container.innerHTML = "";
    this.container.style.position = "relative";

    this.spacer = document.createElement("div");
    this.spacer.className = "vlist-spacer";

    this.content = document.createElement("div");
    this.content.className = "vlist-content";

    this.container.appendChild(this.spacer);
    this.container.appendChild(this.content);
  }

  attachEvents() {
    this.scrollListener = () => {
      if (!this.ticking) {
        requestAnimationFrame(() => {
          this.updateVisibleRange();
          this.ticking = false;
        });
        this.ticking = true;
      }
    };
    this.container.addEventListener("scroll", this.scrollListener, {
      passive: true,
    });

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.container.clientHeight > 0) {
          this.updateVisibleRange(true);
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  setItems(newItems, preserveScroll = false) {
    this.items = newItems || [];
    if (!preserveScroll) {
      this.container.scrollTop = 0;
    }
    this.renderedStart = -1;
    this.renderedEnd = -1;
    this.render();
  }

  render() {
    if (!this.items || this.items.length === 0) {
      this.spacer.style.height = "0px";
      this.content.innerHTML = "";
      this.content.style.transform = "translateY(0px)";
      this.container.style.overflowY = "hidden";
      if (this.onEmpty) {
        const emptyEl =
          typeof this.onEmpty === "function"
            ? this.onEmpty()
            : this.onEmpty;
        if (typeof emptyEl === "string") {
          this.content.innerHTML = emptyEl;
        } else if (emptyEl) {
          this.content.appendChild(emptyEl);
        }
      }
      return;
    }

    const totalHeight = this.items.length * this.itemHeight;
    this.spacer.style.height = `${totalHeight}px`;

    if (Number.isFinite(this.maxHeight)) {
      if (totalHeight > this.maxHeight) {
        this.container.style.height = `${this.maxHeight}px`;
        this.container.style.overflowY = "auto";
      } else {
        this.container.style.height = `${totalHeight}px`;
        this.container.style.overflowY = "hidden";
      }
    } else {
      this.container.style.overflowY = "auto";
    }

    this.updateVisibleRange(true);
  }

  updateVisibleRange(force = false) {
    if (!this.items || this.items.length === 0) return;

    const clientHeight = this.container.clientHeight;
    if (clientHeight === 0) return;

    const scrollTop = this.container.scrollTop;
    const start = Math.max(
      0,
      Math.floor(scrollTop / this.itemHeight) - this.overscan,
    );
    const end = Math.min(
      this.items.length,
      Math.ceil((scrollTop + clientHeight) / this.itemHeight) +
        this.overscan,
    );

    if (
      !force &&
      start === this.renderedStart &&
      end === this.renderedEnd
    ) {
      return;
    }

    this.renderedStart = start;
    this.renderedEnd = end;

    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const itemEl = this.renderItem(this.items[i], i);
      fragment.appendChild(itemEl);
    }

    this.content.innerHTML = "";
    this.content.appendChild(fragment);
    this.content.style.transform = `translateY(${start * this.itemHeight}px)`;
  }

  destroy() {
    if (this.scrollListener) {
      this.container.removeEventListener("scroll", this.scrollListener);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }
}

const AVAILABLE_FLAGS = [
  {
    key: "isSongHub",
    title: "SongHub Library",
    description:
      "This Library is used on SongHub. Enables support for SongHub's file & extension naming scheme.",
    defaultValue: false,
  },
  {
    key: "flipArtistTitle",
    title: "Invert Filename Order (Song Title - Artist Name)",
    description:
      "When enabled, files like <code>Ang Huling El Bimbo - Eraserheads.kar</code> will be indexed as Title: <b>Ang Huling El Bimbo</b> and Artist: <b>Eraserheads</b>.",
    defaultValue: false,
  },
  {
    key: "enableMtvCategory",
    title: "Automatic MV Category",
    description:
      "When enabled, music videos found in the library are automatically registered as an <b>MV</b> Background Video category.",
    defaultValue: true,
  },
  {
    key: "enableDefaultCategories",
    title: "Add Default Background Videos",
    description:
      "When enabled, Encore will load its default background video categories, such as <b>3D</b>.",
    defaultValue: true,
  },
  {
    key: "skipToFirstNoteOn",
    title: "Skip Leading Silence (First Note-On)",
    description:
      "When enabled, MIDI playback immediately jumps to the first note played.",
    defaultValue: false,
  },
];

function renderFlags() {
  const container = document.getElementById("flags-container");
  if (!container) return;
  container.innerHTML = "";

  const flags = selectedLib?.manifest?.flags || {};

  AVAILABLE_FLAGS.forEach((flag) => {
    const isChecked =
      flags[flag.key] !== undefined
        ? Boolean(flags[flag.key])
        : flag.defaultValue;

    const label = document.createElement("label");
    label.className = "flag-item";
    label.htmlFor = `flag-${flag.key}`;

    label.innerHTML = `
      <input
        type="checkbox"
        id="flag-${flag.key}"
        ${isChecked ? "checked" : ""}
        onchange="onFlagChange()"
      />
      <div class="flag-text-group">
        <span class="flag-title">${escapeHtml(flag.title)}</span>
        <p class="flag-desc">${flag.description}</p>
      </div>
    `;
    container.appendChild(label);
  });
}

function hasFlagChanges() {
  if (!selectedLib) return false;
  const currentFlags = selectedLib.manifest.flags || {};
  return AVAILABLE_FLAGS.some((flag) => {
    const input = document.getElementById(`flag-${flag.key}`);
    if (!input) return false;
    const currentVal =
      currentFlags[flag.key] !== undefined
        ? Boolean(currentFlags[flag.key])
        : flag.defaultValue;
    return input.checked !== currentVal;
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

let confirmCallback = null;
function openConfirmModal(title, text, onConfirm) {
  document.getElementById("modal-title").innerText = title;
  document.getElementById("modal-desc").innerText = text;
  confirmCallback = onConfirm;
  document.getElementById("confirm-modal").classList.remove("hidden");
}
function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.add("hidden");
  confirmCallback = null;
}
document
  .getElementById("modal-confirm-btn")
  .addEventListener("click", () => {
    if (confirmCallback) confirmCallback();
    closeConfirmModal();
  });

function triggerEntranceAnimation(element) {
  if (!element) return;
  element.style.animation = "none";
  void element.offsetHeight;
  element.style.animation = "";
}

async function loadData() {
  appData = await ipc.invoke("libmgr-get-config");

  if (selectedLib) {
    selectedLib =
      appData.libraries.find((l) => l.path === selectedLib.path) || null;
  }

  if (!selectedLib && appData.libraries.length > 0) {
    selectedLib =
      appData.libraries.find((l) => l.path === appData.active) ||
      appData.libraries[0];
  }

  renderSidebar();

  if (selectedLib) {
    renderMainPane();

    const selectedItem = document.querySelector(".lib-item.selected");
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: "nearest" });
    }
  } else {
    document.getElementById("main-pane").style.display = "none";
    document.getElementById("empty-pane").style.display = "flex";
  }
}

function renderSidebar() {
  const container = document.getElementById("lib-list");
  container.innerHTML = "";

  appData.libraries.forEach((lib) => {
    const isActive = appData.active === lib.path;
    const isSelected = selectedLib && selectedLib.path === lib.path;

    const item = document.createElement("div");
    item.className = `lib-item ${isActive ? "active-lib" : ""} ${isSelected ? "selected" : ""}`;
    item.onclick = () => {
      flushAllAutoSaves();
      selectedLib = lib;
      renderSidebar();
      renderMainPane();
    };

    item.innerHTML = `
      <div class="lib-status-indicator" title="${isActive ? "Currently Active Engine Library" : "Standby"}"></div>
      <div class="lib-item-info">
        <div class="lib-item-title">${escapeHtml(lib.manifest.title || "Unknown Library")}</div>
        <div class="lib-item-path">${escapeHtml(lib.path)}</div>
      </div>
      <div class="lib-focus-notch">
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
          <path d="M1 1.5L5.5 6L1 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    `;
    container.appendChild(item);
  });
}

function updateSidebarTitle(path, newTitle) {
  const items = document.querySelectorAll(".lib-item");
  appData.libraries.forEach((lib, idx) => {
    if (lib.path === path && items[idx]) {
      const titleEl = items[idx].querySelector(".lib-item-title");
      if (titleEl) {
        titleEl.innerText = newTitle || "Unknown Library";
      }
    }
  });
}

function updateBootVideoDisplay() {
  const bootVideo = selectedLib?.manifest?.additionalContents?.bootVideo;
  const displayEl = document.getElementById("lib-boot-video");
  const clearBtn = document.getElementById("clear-boot-video-btn");
  if (!displayEl) return;

  if (bootVideo) {
    displayEl.innerText = bootVideo;
    displayEl.style.color = "var(--text-main)";
    if (clearBtn) clearBtn.style.display = "block";
  } else {
    displayEl.innerText = "None";
    displayEl.style.color = "var(--text-muted)";
    if (clearBtn) clearBtn.style.display = "none";
  }
}

function renderMainPane() {
  imagePreviewCache.clear();
  document.getElementById("empty-pane").style.display = "none";
  document.getElementById("main-pane").style.display = "flex";

  document.getElementById("lib-title").value =
    selectedLib.manifest.title || "";
  document.getElementById("lib-desc").value =
    selectedLib.manifest.description || "";
  document.getElementById("lib-path").innerText = selectedLib.path;

  updateBootVideoDisplay();

  const isActive = appData.active === selectedLib.path;
  const actionContainer = document.getElementById(
    "active-action-container",
  );
  if (!isActive) {
    actionContainer.innerHTML = `<button class="action-btn success" onclick="setActive()">Set as Active & Reboot</button>`;
  } else {
    actionContainer.innerHTML = `<button class="action-btn outline" disabled style="opacity:0.5;">Currently Active</button>`;
  }

  bgvData = selectedLib.manifest.additionalContents?.bgvCategories || [];
  bumperData =
    selectedLib.manifest.additionalContents?.bumperImages || [];
  renderFlags();
  setOverviewStatus("idle");
  setBgvStatus("idle");
  setBumperStatus("idle");
  renderBgvs();
  renderBumpers();
  loadSongs();

  const activeTab = document.querySelector(".tab-content.active");
  if (activeTab) {
    triggerEntranceAnimation(activeTab);
  }
}

function onFlagChange() {
  if (selectedLib) {
    queueManifestAutoSave(true);
  }
}

async function chooseBootVideo() {
  if (!selectedLib) return;
  const res = await ipc.invoke(
    "libmgr-select-boot-video",
    selectedLib.path,
  );

  if (res?.error) {
    showToast(res.error, "var(--danger)");
    return;
  }

  if (res?.relativePath) {
    selectedLib.manifest.additionalContents =
      selectedLib.manifest.additionalContents || {};
    selectedLib.manifest.additionalContents.bootVideo = res.relativePath;
    updateBootVideoDisplay();
    queueManifestAutoSave(true);
    showToast("Boot video linked to manifest!", "var(--success)");
  }
}

function clearBootVideo() {
  if (!selectedLib) return;
  if (selectedLib.manifest?.additionalContents?.bootVideo) {
    delete selectedLib.manifest.additionalContents.bootVideo;
    updateBootVideoDisplay();
    queueManifestAutoSave(true);
    showToast("Boot video removed from manifest.", "var(--text-muted)");
  }
}

function switchTab(tabId) {
  flushAllAutoSaves();
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));

  const clickedBtn =
    typeof event !== "undefined" && event?.target
      ? event.target.closest(".tab-btn")
      : null;

  if (clickedBtn) {
    clickedBtn.classList.add("active");
  } else {
    const tabNames = ["overview", "songs", "bgvs", "bumpers"];
    const idx = tabNames.indexOf(tabId);
    if (idx !== -1 && tabButtons[idx]) {
      tabButtons[idx].classList.add("active");
    }
  }

  const target = document.getElementById("tab-" + tabId);
  if (target) {
    target.classList.add("active");
    triggerEntranceAnimation(target);
  }

  requestAnimationFrame(() => {
    if (tabId === "songs") {
      renderSongVirtualList();
    } else if (tabId === "bgvs") {
      Object.values(bgvVirtualLists).forEach((vl) => {
        if (vl) vl.updateVisibleRange(true);
      });
    } else if (tabId === "bumpers") {
      if (bumperVirtualList) bumperVirtualList.updateVisibleRange(true);
    }
  });
}

function showSongState(state, message = "") {
  const container = document.getElementById("song-list-container");
  const statusEl = document.getElementById("song-status-display");
  const counterEl = document.getElementById("song-total-count");
  const searchInput = document.getElementById("song-search-input");

  if (state === "scanning") {
    container.style.display = "none";
    statusEl.style.display = "flex";
    statusEl.innerHTML = "Scanning directory...";
    if (counterEl) counterEl.innerText = "SCANNING...";
    if (searchInput) searchInput.disabled = true;
  } else if (state === "ready") {
    statusEl.style.display = "none";
    container.style.display = "block";
    if (searchInput) searchInput.disabled = false;
  } else if (state === "empty") {
    container.style.display = "none";
    statusEl.style.display = "flex";
    statusEl.innerHTML = escapeHtml(
      message || "No valid media files found in the root directory.",
    );
    if (counterEl) counterEl.innerText = "0 FILES";
    if (searchInput) searchInput.disabled = false;
  } else if (state === "error") {
    container.style.display = "none";
    statusEl.style.display = "flex";
    statusEl.innerHTML = `
      <div style="color:var(--danger); margin-bottom:12px;">${escapeHtml(message || "Failed to scan directory.")}</div>
      <button class="action-btn outline" onclick="loadSongs()">Retry</button>
    `;
    if (counterEl) counterEl.innerText = "ERROR";
    if (searchInput) searchInput.disabled = true;
  }
}

async function loadSongs() {
  const token = ++activeSongScanToken;
  const targetPath = selectedLib?.path;

  if (!targetPath) {
    showSongState("empty", "No library selected.");
    return;
  }

  const searchInput = document.getElementById("song-search-input");
  if (searchInput) searchInput.value = "";
  filteredIndices = null;

  showSongState("scanning");

  try {
    const songs = await ipc.invoke(
      "libmgr-get-library-contents",
      targetPath,
    );

    if (token !== activeSongScanToken) return;

    const rawList = Array.isArray(songs) ? songs : [];

    songIndex = new Array(rawList.length);
    for (let i = 0; i < rawList.length; i++) {
      const raw = rawList[i];
      songIndex[i] = {
        raw: raw,
        lower: raw.toLowerCase(),
      };
    }

    if (songIndex.length === 0) {
      showSongState(
        "empty",
        "No valid media files found in the root directory.",
      );
    } else {
      showSongState("ready");
      attachSongListEvents();
      updateSongCounter();
      renderSongVirtualList(true);
    }
  } catch (err) {
    if (token !== activeSongScanToken) return;
    console.error("Failed to load library songs:", err);
    showSongState("error", err?.message || String(err));
  }
}

function attachSongListEvents() {
  const container = document.getElementById("song-list-container");
  if (!container || songListScrollAttached) return;

  let ticking = false;
  container.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          renderSongVirtualList(false);
          ticking = false;
        });
        ticking = true;
      }
    },
    { passive: true },
  );

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (container.clientHeight > 0) {
        renderSongVirtualList(false);
      }
    });
    ro.observe(container);
  }

  songListScrollAttached = true;
}

function renderSongVirtualList(resetScroll = false) {
  const container = document.getElementById("song-list-container");
  const spacer = document.getElementById("song-vlist-spacer");
  const content = document.getElementById("song-vlist-content");

  if (!container || !spacer || !content) return;

  if (resetScroll) {
    container.scrollTop = 0;
  }

  const total =
    filteredIndices !== null ? filteredIndices.length : songIndex.length;

  if (total === 0) {
    spacer.style.height = "0px";
    content.style.transform = "translateY(0px)";
    content.innerHTML =
      "<div class='empty-state' style='padding:40px'>No matching media files found.</div>";
    return;
  }

  spacer.style.height = `${total * SONG_ROW_HEIGHT}px`;

  const clientHeight = container.clientHeight;
  if (clientHeight === 0) return; // Tab is hidden

  const scrollTop = container.scrollTop;
  const start = Math.max(
    0,
    Math.floor(scrollTop / SONG_ROW_HEIGHT) - SONG_OVERSCAN,
  );
  const end = Math.min(
    total,
    Math.ceil((scrollTop + clientHeight) / SONG_ROW_HEIGHT) +
      SONG_OVERSCAN,
  );

  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const itemIdx = filteredIndices !== null ? filteredIndices[i] : i;
    const songRaw = songIndex[itemIdx].raw;

    const row = document.createElement("div");
    row.className = "song-row";
    row.title = songRaw;
    row.textContent = songRaw;
    fragment.appendChild(row);
  }

  content.innerHTML = "";
  content.appendChild(fragment);
  content.style.transform = `translateY(${start * SONG_ROW_HEIGHT}px)`;
}

function updateSongCounter() {
  const counterEl = document.getElementById("song-total-count");
  if (!counterEl) return;

  const count =
    filteredIndices !== null ? filteredIndices.length : songIndex.length;
  counterEl.innerText = `${count.toLocaleString()} ${count === 1 ? "FILE" : "FILES"}`;
}

function onSongSearchInput(query) {
  if (songSearchDebounceTimer) {
    clearTimeout(songSearchDebounceTimer);
  }
  songSearchDebounceTimer = setTimeout(() => {
    songSearchDebounceTimer = null;
    performSongSearch(query);
  }, 75);
}

function performSongSearch(query) {
  if (!songIndex || songIndex.length === 0) return;

  const raw = (query || "").trim().toLowerCase();
  if (!raw) {
    filteredIndices = null;
  } else {
    const terms = raw.split(/\s+/).filter(Boolean);
    const termCount = terms.length;
    const total = songIndex.length;
    const matched = [];

    if (termCount === 1) {
      const t0 = terms[0];
      for (let i = 0; i < total; i++) {
        if (songIndex[i].lower.includes(t0)) {
          matched.push(i);
        }
      }
    } else {
      for (let i = 0; i < total; i++) {
        const str = songIndex[i].lower;
        let match = true;
        for (let t = 0; t < termCount; t++) {
          if (!str.includes(terms[t])) {
            match = false;
            break;
          }
        }
        if (match) {
          matched.push(i);
        }
      }
    }
    filteredIndices = matched;
  }

  updateSongCounter();
  renderSongVirtualList(true);
}

function setOverviewStatus(state) {
  const el = document.getElementById("overview-status");
  if (!el) return;
  if (state === "saving") {
    el.style.color = "var(--accent)";
    el.innerText = "SAVING...";
  } else if (state === "saved") {
    el.style.color = "var(--success)";
    el.innerText = "CHANGES SAVED";
    setTimeout(() => {
      if (el.innerText === "CHANGES SAVED") {
        el.style.color = "var(--text-muted)";
        el.innerText = "AUTOSAVED";
      }
    }, 2500);
  } else if (state === "error") {
    el.style.color = "var(--danger)";
    el.innerText = "SAVE FAILED";
  } else {
    el.style.color = "var(--text-muted)";
    el.innerText = "AUTOSAVED";
  }
}

function queueManifestAutoSave(immediate = false) {
  if (manifestSaveTimeout) {
    clearTimeout(manifestSaveTimeout);
    manifestSaveTimeout = null;
  }

  if (immediate) {
    saveManifest();
  } else {
    setOverviewStatus("saving");
    manifestSaveTimeout = setTimeout(() => {
      manifestSaveTimeout = null;
      saveManifest();
    }, 600);
  }
}

function flushManifestAutoSave() {
  if (manifestSaveTimeout) {
    clearTimeout(manifestSaveTimeout);
    manifestSaveTimeout = null;
  }
  if (selectedLib) {
    const titleInput = document.getElementById("lib-title");
    const descInput = document.getElementById("lib-desc");

    if (titleInput && descInput) {
      if (
        selectedLib.manifest.title !== titleInput.value ||
        selectedLib.manifest.description !== descInput.value ||
        hasFlagChanges()
      ) {
        saveManifest();
      }
    }
  }
}

function onTitleInput(val) {
  if (selectedLib) {
    updateSidebarTitle(selectedLib.path, val);
    queueManifestAutoSave(false);
  }
}

function onDescInput() {
  if (selectedLib) {
    queueManifestAutoSave(false);
  }
}

async function saveManifest() {
  if (!selectedLib) return;
  const titleVal = document.getElementById("lib-title").value;
  const descVal = document.getElementById("lib-desc").value;
  selectedLib.manifest.title = titleVal;
  selectedLib.manifest.description = descVal;

  selectedLib.manifest.flags = selectedLib.manifest.flags || {};
  AVAILABLE_FLAGS.forEach((flag) => {
    const input = document.getElementById(`flag-${flag.key}`);
    if (input) {
      selectedLib.manifest.flags[flag.key] = input.checked;
    }
  });

  setOverviewStatus("saving");

  const res = await ipc.invoke("libmgr-update-manifest", {
    folderPath: selectedLib.path,
    manifestData: selectedLib.manifest,
  });

  if (res && res.success) {
    setOverviewStatus("saved");
    const libInConfig = appData.libraries.find(
      (l) => l.path === selectedLib.path,
    );
    if (libInConfig) {
      libInConfig.manifest = selectedLib.manifest;
    }
    updateSidebarTitle(selectedLib.path, titleVal);
  } else {
    setOverviewStatus("error");
    console.error(
      "Manifest Save Error:",
      res ? res.error : "Unknown error",
    );
    showToast(
      `Failed to autosave details: ${res ? res.error : "Unknown error"}`,
      "var(--danger)",
    );
  }
}

function destroyBgvVirtualLists() {
  Object.values(bgvVirtualLists).forEach((vl) => {
    if (vl && typeof vl.destroy === "function") {
      vl.destroy();
    }
  });
  bgvVirtualLists = {};
}

function renderBgvs() {
  destroyBgvVirtualLists();
  const container = document.getElementById("bgv-container");
  container.innerHTML = "";

  if (!bgvData || bgvData.length === 0) {
    container.innerHTML =
      "<div class='empty-state' style='padding:20px'>No BGV Categories defined.</div>";
    return;
  }

  bgvData.forEach((cat, cIdx) => {
    const catDiv = document.createElement("div");
    catDiv.className = "bgv-category";

    const videoCount = cat.BGV_LIST ? cat.BGV_LIST.length : 0;

    catDiv.innerHTML = `
      <div class="bgv-category-header">
        <input type="text" value="${escapeHtml(cat.BGV_CATEGORY || "")}" 
          oninput="updateBgvCategoryName(${cIdx}, this.value)" 
          onchange="flushBgvAutoSave()" 
          onblur="flushBgvAutoSave()"
          placeholder="Category Name (e.g. KPOP)">
        <span class="bgv-count-badge" id="bgv-badge-${cIdx}">${videoCount.toLocaleString()} ${videoCount === 1 ? "video" : "videos"}</span>
        <div style="display: flex; gap: 10px; align-items: center;">
          <button class="action-btn outline" style="padding: 5px 10px; font-size: 0.9rem;" onclick="addVideoToCategory(${cIdx})">+ Add Videos</button>
          <button class="action-btn danger" style="padding: 5px 10px; font-size: 0.9rem;" onclick="confirmRemoveBgvCategory(${cIdx})">Delete Category</button>
        </div>
      </div>
      <div class="bgv-category-body" id="bgv-body-${cIdx}"></div>
    `;

    container.appendChild(catDiv);

    const bodyEl = catDiv.querySelector(`#bgv-body-${cIdx}`);
    if (!cat.BGV_LIST || cat.BGV_LIST.length === 0) {
      bodyEl.innerHTML = `<div style="color:var(--text-muted); font-size: 0.9rem; padding: 10px;">No videos in this category.</div>`;
    } else {
      const viewportEl = document.createElement("div");
      viewportEl.className = "bgv-virtual-viewport";
      viewportEl.id = `bgv-viewport-${cIdx}`;
      bodyEl.appendChild(viewportEl);

      bgvVirtualLists[cIdx] = new VirtualList({
        container: viewportEl,
        itemHeight: 34,
        maxHeight: 272,
        overscan: 4,
        items: cat.BGV_LIST,
        renderItem: (vid, vIdx) => {
          const row = document.createElement("div");
          row.className = "bgv-file-row";
          row.title = vid;
          row.innerHTML = `
            <span>${escapeHtml(vid)}</span>
            <button type="button" tabindex="-1" onclick="removeVideoFromCategory(${cIdx}, ${vIdx})" title="Remove video">✕</button>
          `;
          return row;
        },
        onEmpty: () =>
          `<div style="color:var(--text-muted); font-size: 0.9rem; padding: 10px;">No videos in this category.</div>`,
      });
    }
  });
}

function setBgvStatus(state) {
  const el = document.getElementById("bgv-status");
  if (!el) return;
  if (state === "saving") {
    el.style.color = "var(--accent)";
    el.innerText = "SAVING...";
  } else if (state === "saved") {
    el.style.color = "var(--success)";
    el.innerText = "CHANGES SAVED";
    setTimeout(() => {
      if (el.innerText === "CHANGES SAVED") {
        el.style.color = "var(--text-muted)";
        el.innerText = "AUTOSAVED";
      }
    }, 2500);
  } else if (state === "error") {
    el.style.color = "var(--danger)";
    el.innerText = "SAVE FAILED";
  } else {
    el.style.color = "var(--text-muted)";
    el.innerText = "AUTOSAVED";
  }
}

function queueBgvAutoSave(immediate = false) {
  if (bgvSaveTimeout) {
    clearTimeout(bgvSaveTimeout);
    bgvSaveTimeout = null;
  }

  if (immediate) {
    saveBgvs();
  } else {
    setBgvStatus("saving");
    bgvSaveTimeout = setTimeout(() => {
      bgvSaveTimeout = null;
      saveBgvs();
    }, 600);
  }
}

function flushBgvAutoSave() {
  if (bgvSaveTimeout) {
    clearTimeout(bgvSaveTimeout);
    bgvSaveTimeout = null;
    saveBgvs();
  }
}

function flushAllAutoSaves() {
  flushManifestAutoSave();
  flushBgvAutoSave();
  flushBumperAutoSave();
}

function addBgvCategory() {
  bgvData.push({ BGV_CATEGORY: "New Category", BGV_LIST: [] });
  renderBgvs();
  queueBgvAutoSave(true);
}

function updateBgvCategoryName(idx, val) {
  if (bgvData[idx]) {
    bgvData[idx].BGV_CATEGORY = val;
    queueBgvAutoSave(false);
  }
}

function confirmRemoveBgvCategory(idx) {
  const catName = bgvData[idx]?.BGV_CATEGORY || "Category";
  openConfirmModal(
    "DELETE CATEGORY",
    `Are you sure you want to delete the category "${catName}"? This will not delete the video files from your disk.`,
    () => {
      bgvData.splice(idx, 1);
      renderBgvs();
      queueBgvAutoSave(true);
    },
  );
}

function removeVideoFromCategory(cIdx, vIdx) {
  if (bgvData[cIdx]?.BGV_LIST) {
    bgvData[cIdx].BGV_LIST.splice(vIdx, 1);
    if (bgvData[cIdx].BGV_LIST.length === 0) {
      renderBgvs();
    } else {
      const badge = document.getElementById(`bgv-badge-${cIdx}`);
      if (badge) {
        const count = bgvData[cIdx].BGV_LIST.length;
        badge.innerText = `${count.toLocaleString()} ${count === 1 ? "video" : "videos"}`;
      }
      const vl = bgvVirtualLists[cIdx];
      if (vl) {
        vl.setItems(bgvData[cIdx].BGV_LIST, true);
      } else {
        renderBgvs();
      }
    }
    queueBgvAutoSave(true);
  }
}

async function addVideoToCategory(idx) {
  const res = await ipc.invoke(
    "libmgr-select-bgv-files",
    selectedLib.path,
  );
  if (res && res.outsideCount > 0) {
    showToast(
      `${res.outsideCount} ${res.outsideCount > 1 ? "videos" : "video"} must be inside the library folder!`,
      "var(--danger)",
    );
  }

  if (res && res.relativePaths && res.relativePaths.length > 0) {
    if (!bgvData[idx].BGV_LIST) bgvData[idx].BGV_LIST = [];
    let added = false;
    res.relativePaths.forEach((p) => {
      if (!bgvData[idx].BGV_LIST.includes(p)) {
        bgvData[idx].BGV_LIST.push(p);
        added = true;
      }
    });
    if (added) {
      renderBgvs();
      queueBgvAutoSave(true);
    }
  }
}

async function saveBgvs() {
  if (!selectedLib) return;
  selectedLib.manifest.additionalContents =
    selectedLib.manifest.additionalContents || {};
  selectedLib.manifest.additionalContents.bgvCategories = bgvData;

  setBgvStatus("saving");

  const res = await ipc.invoke("libmgr-update-manifest", {
    folderPath: selectedLib.path,
    manifestData: selectedLib.manifest,
  });

  if (res && res.success) {
    setBgvStatus("saved");
    const libInConfig = appData.libraries.find(
      (l) => l.path === selectedLib.path,
    );
    if (libInConfig) {
      libInConfig.manifest = selectedLib.manifest;
    }
  } else {
    setBgvStatus("error");
    console.error("BGV Save Error:", res ? res.error : "Unknown error");
    showToast(
      `Failed to autosave BGV: ${res ? res.error : "Unknown error"}`,
      "var(--danger)",
    );
  }
}

function destroyBumperVirtualList() {
  if (
    bumperVirtualList &&
    typeof bumperVirtualList.destroy === "function"
  ) {
    bumperVirtualList.destroy();
    bumperVirtualList = null;
  }
}

function getFullBumperPath(relPath) {
  if (!selectedLib || !selectedLib.path) return "";
  const base = selectedLib.path.replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = String(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  return `${base}/${rel}`;
}

function openImagePreviewModal(imgPath) {
  const fullPath = getFullBumperPath(imgPath);
  const titleEl = document.getElementById("preview-modal-title");
  const imgEl = document.getElementById("preview-modal-img");
  const modal = document.getElementById("image-preview-modal");

  if (titleEl) titleEl.innerText = imgPath;

  if (imagePreviewCache.has(fullPath)) {
    imgEl.src = imagePreviewCache.get(fullPath);
  } else {
    imgEl.src = "";
    ipc.invoke("libmgr-get-image-preview", fullPath).then((dataUrl) => {
      if (dataUrl) {
        imagePreviewCache.set(fullPath, dataUrl);
        imgEl.src = dataUrl;
      }
    });
  }

  modal.classList.remove("hidden");
}

function closeImagePreviewModal() {
  const modal = document.getElementById("image-preview-modal");
  const imgEl = document.getElementById("preview-modal-img");
  if (modal) modal.classList.add("hidden");
  if (imgEl) imgEl.src = "";
}

function renderBumpers() {
  destroyBumperVirtualList();
  const container = document.getElementById("bumper-list-viewport");
  if (!container) return;

  bumperVirtualList = new VirtualList({
    container: container,
    itemHeight: 52,
    overscan: 4,
    items: bumperData,
    renderItem: (imgPath, idx) => {
      const row = document.createElement("div");
      row.className = "bumper-file-row";
      row.title = imgPath;

      const fullPath = getFullBumperPath(imgPath);

      const thumbBox = document.createElement("div");
      thumbBox.className = "bumper-thumb-box";
      thumbBox.title = "Click to enlarge preview";
      thumbBox.onclick = () => openImagePreviewModal(imgPath);

      const img = document.createElement("img");
      img.alt = "preview";

      if (imagePreviewCache.has(fullPath)) {
        img.src = imagePreviewCache.get(fullPath);
      } else {
        ipc
          .invoke("libmgr-get-image-preview", fullPath)
          .then((dataUrl) => {
            if (dataUrl) {
              imagePreviewCache.set(fullPath, dataUrl);
              img.src = dataUrl;
            }
          });
      }

      thumbBox.appendChild(img);

      const label = document.createElement("span");
      label.className = "bumper-path-label";
      label.textContent = imgPath;

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.tabIndex = -1;
      delBtn.className = "bumper-remove-btn";
      delBtn.title = "Remove image";
      delBtn.textContent = "✕";
      delBtn.onclick = () => removeBumperImage(idx);

      row.appendChild(thumbBox);
      row.appendChild(label);
      row.appendChild(delBtn);

      return row;
    },
    onEmpty: () =>
      `<div class="empty-state" style="padding: 40px">No idle images configured for this library. Click "+ Add Images" to select images.</div>`,
  });
}

function setBumperStatus(state) {
  const el = document.getElementById("bumper-status");
  if (!el) return;
  if (state === "saving") {
    el.style.color = "var(--accent)";
    el.innerText = "SAVING...";
  } else if (state === "saved") {
    el.style.color = "var(--success)";
    el.innerText = "CHANGES SAVED";
    setTimeout(() => {
      if (el.innerText === "CHANGES SAVED") {
        el.style.color = "var(--text-muted)";
        el.innerText = "AUTOSAVED";
      }
    }, 2500);
  } else if (state === "error") {
    el.style.color = "var(--danger)";
    el.innerText = "SAVE FAILED";
  } else {
    el.style.color = "var(--text-muted)";
    el.innerText = "AUTOSAVED";
  }
}

function queueBumperAutoSave(immediate = false) {
  if (bumperSaveTimeout) {
    clearTimeout(bumperSaveTimeout);
    bumperSaveTimeout = null;
  }

  if (immediate) {
    saveBumpers();
  } else {
    setBumperStatus("saving");
    bumperSaveTimeout = setTimeout(() => {
      bumperSaveTimeout = null;
      saveBumpers();
    }, 600);
  }
}

function flushBumperAutoSave() {
  if (bumperSaveTimeout) {
    clearTimeout(bumperSaveTimeout);
    bumperSaveTimeout = null;
    saveBumpers();
  }
}

async function addBumperImages() {
  if (!selectedLib) return;
  const res = await ipc.invoke(
    "libmgr-select-bumper-images",
    selectedLib.path,
  );

  if (res && res.outsideCount > 0) {
    showToast(
      `${res.outsideCount} ${res.outsideCount > 1 ? "images" : "image"} must be inside the library folder!`,
      "var(--danger)",
    );
  }

  if (res && res.relativePaths && res.relativePaths.length > 0) {
    let added = false;
    res.relativePaths.forEach((p) => {
      if (!bumperData.includes(p)) {
        bumperData.push(p);
        added = true;
      }
    });
    if (added) {
      renderBumpers();
      queueBumperAutoSave(true);
    }
  }
}

function removeBumperImage(idx) {
  if (bumperData && idx >= 0 && idx < bumperData.length) {
    bumperData.splice(idx, 1);
    if (bumperVirtualList) {
      bumperVirtualList.setItems(bumperData, true);
    } else {
      renderBumpers();
    }
    queueBumperAutoSave(true);
  }
}

async function saveBumpers() {
  if (!selectedLib) return;
  selectedLib.manifest.additionalContents =
    selectedLib.manifest.additionalContents || {};
  selectedLib.manifest.additionalContents.bumperImages = bumperData;

  setBumperStatus("saving");

  const res = await ipc.invoke("libmgr-update-manifest", {
    folderPath: selectedLib.path,
    manifestData: selectedLib.manifest,
  });

  if (res && res.success) {
    setBumperStatus("saved");
    const libInConfig = appData.libraries.find(
      (l) => l.path === selectedLib.path,
    );
    if (libInConfig) {
      libInConfig.manifest = selectedLib.manifest;
    }
  } else {
    setBumperStatus("error");
    console.error(
      "Bumper Save Error:",
      res ? res.error : "Unknown error",
    );
    showToast(
      `Failed to autosave Bumper images: ${res ? res.error : "Unknown error"}`,
      "var(--danger)",
    );
  }
}

async function scanDrives() {
  showToast("Scanning drives...");
  const foundCount = await ipc.invoke("libmgr-scan-drives");
  if (foundCount > 0)
    showToast(`Found ${foundCount} new libraries!`, "var(--success)");
  else showToast("No new libraries found.", "var(--text-muted)");
  loadData();
}

async function addLibrary() {
  const addedPath = await ipc.invoke("libmgr-add-library");
  if (addedPath) {
    appData = await ipc.invoke("libmgr-get-config");
    selectedLib = appData.libraries.find((l) => l.path === addedPath);
    showToast("Library added successfully!", "var(--success)");
    loadData();
  }
}

function openFolder() {
  ipc.send("libmgr-open-folder", selectedLib.path);
}

async function setActive() {
  flushAllAutoSaves();
  const res = await ipc.invoke("libmgr-set-active", selectedLib.path);
  if (!res.success) {
    showToast(res.reason, "var(--danger)");
  } else {
    showToast("System rebooting to load library...", "var(--accent)");
    loadData();
  }
}

function confirmRemoveLibrary() {
  if (manifestSaveTimeout) {
    clearTimeout(manifestSaveTimeout);
    manifestSaveTimeout = null;
  }
  if (bgvSaveTimeout) {
    clearTimeout(bgvSaveTimeout);
    bgvSaveTimeout = null;
  }
  if (bumperSaveTimeout) {
    clearTimeout(bumperSaveTimeout);
    bumperSaveTimeout = null;
  }
  openConfirmModal(
    "REMOVE LIBRARY",
    `Remove "${selectedLib.manifest.title || "Unknown Library"}" from the list?\n\n(No actual files will be deleted)`,
    async () => {
      await ipc.invoke("libmgr-remove-library", selectedLib.path);
      selectedLib = null;
      loadData();
    },
  );
}

function showToast(msg, color = "var(--accent)") {
  const toast = document.getElementById("toast");
  toast.style.borderColor = color;
  toast.style.color = color;
  toast.innerText = msg;
  toast.style.opacity = "1";
  setTimeout(() => (toast.style.opacity = "0"), 4000);
}

async function exportSongbook() {
  if (!selectedLib) return;
  flushAllAutoSaves();

  const res = await ipc.invoke("libmgr-export-songbook", {
    folderPath: selectedLib.path,
    libraryTitle: selectedLib.manifest.title || "Custom Library",
  });

  if (res.pending) {
    document
      .getElementById("export-progress-modal")
      .classList.remove("hidden");
    document.getElementById("export-phase-text").innerText =
      "STARTING EXPORT";
    document.getElementById("export-status-text").innerText =
      "Initializing...";
    document.getElementById("export-progress-fill").style.width = "0%";
  } else if (!res.success && res.reason !== "canceled") {
    showToast(`Error: ${res.reason}`, "var(--danger)");
  }
}

ipc.on("songbook-export-progress", (event, data) => {
  document.getElementById("export-phase-text").innerText =
    data.phase.toUpperCase();
  document.getElementById("export-status-text").innerText =
    `Processing: ${data.current} / ${data.total}`;
  document.getElementById("export-progress-fill").style.width =
    `${data.percentage}%`;
});

ipc.on("songbook-export-complete", (event, res) => {
  document
    .getElementById("export-progress-modal")
    .classList.add("hidden");
  if (res.success) {
    showToast("Songbook exported successfully!", "var(--success)");
  } else {
    showToast(`Failed: ${res.reason}`, "var(--danger)");
  }
});

// Expose handlers referenced by inline HTML event attributes so they
// remain callable after the script is bundled (esbuild IIFE scopes top-level
// declarations, otherwise inline onclick/oninput handlers would break).
window.scanDrives = scanDrives;
window.addLibrary = addLibrary;
window.switchTab = switchTab;
window.onTitleInput = onTitleInput;
window.flushManifestAutoSave = flushManifestAutoSave;
window.onDescInput = onDescInput;
window.chooseBootVideo = chooseBootVideo;
window.clearBootVideo = clearBootVideo;
window.openFolder = openFolder;
window.exportSongbook = exportSongbook;
window.confirmRemoveLibrary = confirmRemoveLibrary;
window.onSongSearchInput = onSongSearchInput;
window.onFlagChange = onFlagChange;
window.closeConfirmModal = closeConfirmModal;
window.closeImagePreviewModal = closeImagePreviewModal;
window.addBgvCategory = addBgvCategory;
window.flushBgvAutoSave = flushBgvAutoSave;
window.updateBgvCategoryName = updateBgvCategoryName;
window.confirmRemoveBgvCategory = confirmRemoveBgvCategory;
window.addVideoToCategory = addVideoToCategory;
window.removeVideoFromCategory = removeVideoFromCategory;
window.addBumperImages = addBumperImages;
window.removeBumperImage = removeBumperImage;

loadData();
