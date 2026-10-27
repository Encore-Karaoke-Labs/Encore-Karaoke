class VirtualScroller {
  constructor(containerId, contentId, itemHeight, renderCallback) {
    this.container = document.getElementById(containerId);
    this.content = document.getElementById(contentId);
    this.itemHeight = itemHeight;
    this.renderCallback = renderCallback;
    this.items = [];
    this.container.addEventListener("scroll", () => this.render());
  }

  setItems(items, resetScroll = true) {
    this.items = items || [];
    this.content.style.height = `${this.items.length * this.itemHeight}px`;
    if (resetScroll) {
      this.container.scrollTop = 0;
    }
    this.render();
  }

  render() {
    const scrollTop = this.container.scrollTop;
    const containerHeight = this.container.clientHeight;
    let startIndex = Math.max(0, Math.floor(scrollTop / this.itemHeight) - 5);
    let endIndex = Math.min(
      this.items.length,
      Math.ceil((scrollTop + containerHeight) / this.itemHeight) + 5,
    );

    this.content.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      const node = this.renderCallback(this.items[i], i);
      node.style.position = "absolute";
      node.style.top = `${i * this.itemHeight}px`;
      node.style.width = "100%";
      fragment.appendChild(node);
    }
    this.content.appendChild(fragment);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  let fullSongList = [];
  let inputBuffer = "";

  const inputDisplay = document.getElementById("input-buffer");
  const searchInput = document.getElementById("library-search");
  const playPauseBtn = document.getElementById("btn-play-pause");

  function formatSongCode(code) {
    if (code == null) return "";
    const str = String(code);
    return /^\d+$/.test(str) ? str.padStart(6, "0") : str;
  }

  function getFormatBadge(song) {
    if (song.format && song.formatColor) {
      return { label: song.format, color: song.formatColor };
    }

    if (song.chorusPath) {
      return { label: "CHR", color: "#FFD700" };
    }
    if (
      song.isYouTube ||
      song.type === "youtube" ||
      (song.path && song.path.startsWith("yt://"))
    ) {
      return { label: "YT", color: "#D12F2F" };
    }
    if (song.videoPath) return { label: "MTV", color: "#2F6CD1" };
    if (
      song.type === "multiplexed" ||
      (song.path && song.path.toLowerCase().includes("multiplex"))
    ) {
      return { label: "MP", color: "#2FD147" };
    }
    if (
      song.type === "mid" ||
      song.type === "kar" ||
      (song.path && (song.path.endsWith(".mid") || song.path.endsWith(".kar")))
    ) {
      return { label: "MIDI", color: "#D12F9E" };
    }
    return { label: "RS", color: "#B02FD1" };
  }

  let toastTimeout;
  function showToast(msg, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    isError ? toast.classList.add("error") : toast.classList.remove("error");
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function updateBufferUI() {
    inputDisplay.textContent = inputBuffer
      ? inputBuffer.padStart(6, "0")
      : "------";
  }

  async function reserveSong(song) {
    try {
      const res = await window.karaoke.playOrReserveSong(song);
      if (res && res.success) {
        showToast(
          res.action === "playing"
            ? `Playing: ${song.title}`
            : `Queued: ${song.title}`,
        );
      } else {
        showToast(res?.reason || "Could not reserve song.", true);
      }
    } catch {
      showToast("Reservation failed.", true);
    }
  }

  const songScroller = new VirtualScroller(
    "song-scroller-container",
    "songs-list",
    75,
    (song) => {
      const item = document.createElement("div");
      item.className = "song-item";
      const badge = getFormatBadge(song);
      const badgeHtml = `<span class="format-badge" style="background-color: ${badge.color}">${badge.label}</span>`;

      item.innerHTML = `
        <div class="song-code">${formatSongCode(song.code)}</div>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom: 2px;">${song.title}</div>
          <div style="font-size:0.85rem; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${badgeHtml} ${song.artist || ""}
          </div>
        </div>
      `;
      item.onclick = () => reserveSong(song);
      return item;
    },
  );

  try {
    const res = await window.karaoke.getSongList({ offset: 0, limit: 0 });
    fullSongList = res.songs || [];
    songScroller.setItems(fullSongList);
  } catch (err) {
    console.error("[Control] Failed to load songbook:", err);
  }

  async function syncPlaybackState() {
    try {
      const info = await window.karaoke.getPlaybackInfo();
      if (info && playPauseBtn) {
        playPauseBtn.textContent = info.status === "playing" ? "PAUSE" : "PLAY";
      }
    } catch {}
  }

  setInterval(syncPlaybackState, 1000);
  syncPlaybackState();

  document.querySelectorAll("button[data-type]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.type;
      const value = btn.dataset.value;

      switch (type) {
        case "digit":
          if (inputBuffer.length < 6) inputBuffer += value;
          else inputBuffer = inputBuffer.slice(1) + value;
          updateBufferUI();
          window.desktopIntegration?.ipc?.send("simulate-key", value);
          break;

        case "backspace":
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            updateBufferUI();
            window.desktopIntegration?.ipc?.send("simulate-key", "Backspace");
          }
          break;

        case "reserve":
          window.desktopIntegration?.ipc?.send("simulate-key", "Enter");
          inputBuffer = "";
          updateBufferUI();
          break;

        case "stop":
          window.desktopIntegration?.ipc?.send("simulate-key", "Escape");
          inputBuffer = "";
          updateBufferUI();
          break;

        case "play_pause":
          await window.karaoke.togglePlayPause();
          syncPlaybackState();
          break;

        case "key_up":
          await window.karaoke.keyChange("up");
          break;

        case "key_down":
          await window.karaoke.keyChange("down");
          break;

        case "vol_up":
          window.desktopIntegration?.ipc?.send("simulate-key", "=");
          break;

        case "vol_down":
          window.desktopIntegration?.ipc?.send("simulate-key", "-");
          break;

        case "toggle_melody":
          window.desktopIntegration?.ipc?.send("simulate-key", "g");
          break;

        case "cycle_rhythm":
          window.desktopIntegration?.ipc?.send("simulate-key", "\u0027");
          break;

        case "toggle_chorus":
          await window.karaoke.toggleChorus();
          break;

        case "toggle_bgv":
          window.desktopIntegration?.ipc?.send("simulate-key", "]");
          break;

        case "toggle_recording":
          window.desktopIntegration?.ipc?.send("simulate-key", "r");
          break;
      }
    });
  });

  let searchTimeout;
  searchInput.addEventListener("input", (e) => {
    const q = e.target.value;
    clearTimeout(searchTimeout);

    if (!q.trim()) {
      songScroller.setItems(fullSongList);
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        const res = await window.karaoke.searchSongs(q, 100);
        songScroller.setItems(res.results || []);
      } catch (err) {
        console.error("[Control] Search failed:", err);
      }
    }, 250);
  });
});
