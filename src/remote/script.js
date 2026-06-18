const EncoreEnv = {
  isLocal:
    ["localhost", "127.0.0.1", "::1", ""].includes(window.location.hostname) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname) ||
    window.location.hostname.endsWith(".local") ||
    window.location.protocol === "file:",

  isSecure: window.isSecureContext,

  cloudServerUrl: "https://olive.nxw.pw:8443",
};

class VirtualScroller {
  constructor(containerId, contentId, itemHeight, renderCallback) {
    this.container = document.getElementById(containerId);
    this.content = document.getElementById(contentId);
    this.itemHeight = itemHeight;
    this.renderCallback = renderCallback;
    this.items = [];
    this.container.addEventListener("scroll", () => this.render());
  }
  setItems(items) {
    this.items = items;
    this.content.style.height = `${this.items.length * this.itemHeight}px`;
    this.container.scrollTop = 0;
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

document.addEventListener("DOMContentLoaded", () => {
  console.log(
    `[EnMoku] Environment: ${EncoreEnv.isLocal ? "LOCAL" : "CLOUD"} | Secure Context: ${EncoreEnv.isSecure}`,
  );

  const urlParams = new URLSearchParams(window.location.search);
  const roomPin = urlParams.get("room");

  const loadingOverlay = document.getElementById("loading-overlay");
  const errorOverlay = document.getElementById("error-overlay");
  const errorMessage = document.getElementById("error-message");

  let socketQuery = { clientType: "remote" };

  if (!roomPin && !EncoreEnv.isLocal) {
    loadingOverlay.classList.remove("active");
    errorMessage.innerHTML =
      "No Room PIN provided.<br><br>Please scan the QR code displayed on the TV.";
    errorOverlay.classList.add("active");
    return;
  }

  if (roomPin) {
    socketQuery.room = roomPin;
  }

  const socketEndpoint = EncoreEnv.isLocal
    ? window.location.origin
    : EncoreEnv.cloudServerUrl;

  const socket = io(socketEndpoint, {
    query: { clientType: "remote", room: roomPin },
  });

  let fullSongList = [],
    tempChunkAccumulator = [],
    ytCache = [];
  let currentLibraryTab = "local";
  let navState = { mobileLibraryOpen: false };

  function getFormatBadge(song) {
    if (
      song.isYouTube ||
      song.type === "youtube" ||
      (song.path && song.path.startsWith("yt://"))
    )
      return { label: "YT", color: "#D12F2F" };
    if (song.videoPath) return { label: "MTV", color: "#2F6CD1" };
    if (
      song.type === "multiplexed" ||
      (song.path && song.path.toLowerCase().includes("multiplex"))
    )
      return { label: "MP", color: "#2FD147" };
    if (
      song.type === "mid" ||
      song.type === "kar" ||
      (song.path && (song.path.endsWith(".mid") || song.path.endsWith(".kar")))
    )
      return { label: "MIDI", color: "#D12F9E" };
    return { label: "RS", color: "#B02FD1" };
  }

  const deviceId =
    localStorage.getItem("encore_device_id") ||
    "dev_" + Math.random().toString(36).substr(2, 9);
  localStorage.setItem("encore_device_id", deviceId);

  let myNickname = localStorage.getItem("encore_nickname") || "";
  let chatMessages = [];
  let typingTimer = null;

  const nickOverlay = document.getElementById("nickname-overlay"),
    nickInput = document.getElementById("nickname-input"),
    nickSubmit = document.getElementById("nickname-submit");

  const chatContainer = document.getElementById("chat-messages-container");
  const chatInput = document.getElementById("chat-input");

  const searchInput = document.getElementById("library-search");
  const ytSearchBtn = document.getElementById("yt-search-btn");
  const ytLoader = document.getElementById("yt-loader");
  const unifiedBackBtn = document.getElementById("unified-back-btn");
  const songlistView = document.getElementById("songlist-view");

  const tabLocal = document.getElementById("tab-local");
  const tabYt = document.getElementById("tab-yt");
  const songViewContainer = document.getElementById("song-view-container");

  const chatView = document.getElementById("chat-view");
  const tabChat = document.getElementById("tab-chat");
  const tabCheer = document.getElementById("tab-cheer");
  const chatContentArea = document.getElementById("chat-content-area");
  const cheerContentArea = document.getElementById("cheer-content-area");

  const songScroller = new VirtualScroller(
    "song-scroller-container",
    "songs-list",
    75,
    (song) => {
      const item = document.createElement("div");
      item.className = "song-item";
      const badge = getFormatBadge(song);
      const badgeHtml = `<span class="format-badge" style="background-color: ${badge.color}">${badge.label}</span>`;

      if (song.isYouTube) {
        item.innerHTML = `
        <img src="${song.thumbnail}" class="yt-thumb" loading="lazy">
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom: 2px;">${song.title}</div>
          <div style="font-size:0.85rem; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${badgeHtml} ${song.artist || ""}
          </div>
        </div>
      `;
      } else {
        item.innerHTML = `
        <div class="song-code">${song.code}</div>
        <div style="flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom: 2px;">${song.title}</div>
          <div style="font-size:0.85rem; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${badgeHtml} ${song.artist || ""}
          </div>
        </div>
      `;
      }
      item.onclick = () => reserveSong(song);
      return item;
    },
  );

  socket.on("connect", () => {
    loadingOverlay.classList.remove("active");
    errorOverlay.classList.remove("active");

    socket.emit("remote-command", { type: "get_song_list", value: "" });
    if (!myNickname) {
      nickOverlay.classList.add("active");
      nickInput.focus();
    } else {
      socket.emit("remote-command", {
        type: "set_nickname",
        value: myNickname,
        deviceId,
      });
    }
  });

  socket.on("connect_error", () => {
    loadingOverlay.classList.remove("active");
    errorMessage.innerHTML = `Connection failed.<br><br>Please ensure the ${EncoreEnv.isLocal ? "host device" : "Cloud Server"} is online.`;
    errorOverlay.classList.add("active");
  });

  socket.on("host-disconnected", () => {
    errorMessage.innerHTML =
      "The Host Player disconnected or closed.<br><br>Session ended.";
    errorOverlay.classList.add("active");
  });

  nickSubmit.onclick = () => {
    if (nickInput.value.trim()) {
      myNickname = nickInput.value.trim();
      localStorage.setItem("encore_nickname", myNickname);
      nickOverlay.classList.remove("active");
      socket.emit("remote-command", {
        type: "set_nickname",
        value: myNickname,
        deviceId,
      });
    }
  };

  nickInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") nickSubmit.onclick();
  });

  socket.on("fromRemote", (payload) => {
    if (payload.type === "songlist_chunk") {
      tempChunkAccumulator = tempChunkAccumulator.concat(payload.contents);
      if (payload.isLast) {
        fullSongList = tempChunkAccumulator;
        tempChunkAccumulator = [];
        if (currentLibraryTab === "local" && !searchInput.value.trim()) {
          songScroller.setItems(fullSongList);
        }
      }
    }

    if (payload.type === "remote_search_results") {
      if (currentLibraryTab === "local") {
        songScroller.setItems(payload.results);
      }
    }

    if (payload.type === "reserve_response") {
      if (payload.success) showToast(`Queued: ${payload.song.title}`);
      else showToast("Song not found.", true);
    }

    if (payload.type === "yt_search_results") {
      ytLoader.classList.remove("active");
      const ytItems = payload.results.map((res) => ({
        code: "YT",
        title: res.title,
        artist: res.channelTitle,
        id: res.id,
        durationText: res.length?.simpleText,
        isLive: res.isLive,
        thumbnail: res.thumbnail,
        isYouTube: true,
      }));
      ytCache = ytItems;
      if (currentLibraryTab === "yt") {
        songScroller.setItems(ytItems);
      }
    }

    if (payload.type === "social_init") {
      myNickname = payload.nickname;
      localStorage.setItem("encore_nickname", myNickname);
      chatMessages = payload.history || [];
      renderChat();
    }

    if (payload.type === "social_update") {
      const uCount = payload.usersCount || 1;
      document.getElementById("user-count").textContent =
        `${uCount} User${uCount !== 1 ? "s" : ""} Connected`;

      const typers = payload.typing.filter((n) => n !== myNickname);
      const typingIndicator = document.getElementById("typing-indicator");
      if (typers.length === 1)
        typingIndicator.textContent = `${typers[0]} is typing...`;
      else if (typers.length > 1)
        typingIndicator.textContent = `Multiple people are typing...`;
      else typingIndicator.textContent = "";
    }

    if (payload.type === "new_chat") {
      chatMessages.push(payload.message);
      renderChat();
    }
  });

  function renderChat() {
    const isNearBottom =
      chatContainer.scrollHeight -
        chatContainer.scrollTop -
        chatContainer.clientHeight <
      100;
    chatContainer.innerHTML = "";
    chatMessages.forEach((msg) => {
      const isSelf = msg.sender === myNickname;
      chatContainer.innerHTML += `<div class="chat-msg ${isSelf ? "self" : ""}"><div class="sender">${isSelf ? "You" : msg.sender}</div><div>${msg.text}</div></div>`;
    });
    if (isNearBottom || chatMessages.length === 1)
      chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  tabChat.onclick = () => {
    tabChat.classList.add("active");
    tabCheer.classList.remove("active");
    chatContentArea.style.display = "flex";
    cheerContentArea.style.display = "none";
  };
  tabCheer.onclick = () => {
    tabCheer.classList.add("active");
    tabChat.classList.remove("active");
    cheerContentArea.style.display = "flex";
    chatContentArea.style.display = "none";
  };

  document.getElementById("open-chat-btn").onclick = () => {
    chatView.classList.add("active");
    setTimeout(
      () => (chatContainer.scrollTop = chatContainer.scrollHeight),
      50,
    );
  };
  document.getElementById("close-chat-btn").onclick = () =>
    chatView.classList.remove("active");

  chatInput.addEventListener("input", (e) => {
    if (e.target.value.trim().length > 0) {
      socket.emit("remote-command", {
        type: "typing_state",
        value: true,
      });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        socket.emit("remote-command", {
          type: "typing_state",
          value: false,
        });
      }, 2000);
    } else {
      socket.emit("remote-command", {
        type: "typing_state",
        value: false,
      });
      clearTimeout(typingTimer);
    }
  });

  document.getElementById("chat-send-btn").onclick = () => {
    const v = chatInput.value.trim();
    if (v) {
      socket.emit("remote-command", { type: "chat_message", value: v });
      chatInput.value = "";
      socket.emit("remote-command", {
        type: "typing_state",
        value: false,
      });
      clearTimeout(typingTimer);
    }
  };

  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") document.getElementById("chat-send-btn").onclick();
  });

  document.querySelectorAll(".cheer-btn").forEach((btn) => {
    btn.onclick = () => {
      socket.emit("remote-command", {
        type: "send_cheer",
        value: btn.getAttribute("data-cheer"),
      });
      showToast("Cheer Sent!");
    };
  });

  document.getElementById("custom-cheer-btn").onclick = () => {
    const v = document.getElementById("custom-cheer-input").value.trim();
    if (!v) return showToast("Type a message to Cheer!");
    socket.emit("remote-command", { type: "send_cheer", value: v });
    document.getElementById("custom-cheer-input").value = "";
    showToast("Custom Cheer Sent!");
  };

  function switchToLocal() {
    currentLibraryTab = "local";
    tabLocal.classList.add("active");
    tabYt.classList.remove("active");

    searchInput.placeholder = "Search songs or artists...";
    searchInput.value = "";
    ytSearchBtn.style.display = "none";
    ytLoader.classList.remove("active");

    songScroller.setItems(fullSongList);
    unifiedBackBtn.classList.remove("desktop-visible");
  }

  function switchToYouTube() {
    currentLibraryTab = "yt";
    tabYt.classList.add("active");
    tabLocal.classList.remove("active");

    searchInput.placeholder = "Search YouTube...";
    searchInput.value = "";
    ytSearchBtn.style.display = "flex";

    unifiedBackBtn.classList.add("desktop-visible");

    if (ytCache.length > 0) {
      songScroller.setItems(ytCache);
    } else {
      songScroller.setItems([]);
    }
  }

  tabLocal.onclick = switchToLocal;
  tabYt.onclick = switchToYouTube;

  unifiedBackBtn.onclick = () => {
    if (window.innerWidth < 768) {
      songlistView.classList.remove("active");
      navState.mobileLibraryOpen = false;
    }
  };

  document.getElementById("open-library-btn").onclick = () => {
    navState.mobileLibraryOpen = true;
    songlistView.classList.add("active");
    switchToLocal();
  };

  document.getElementById("open-yt-btn").onclick = () => {
    navState.mobileLibraryOpen = true;
    songlistView.classList.add("active");
    switchToYouTube();
  };

  function triggerYTSearch() {
    const query = searchInput.value.trim();
    if (query) {
      ytLoader.classList.add("active");
      searchInput.blur();
      socket.emit("remote-command", {
        type: "client_yt_search",
        value: query,
      });
    } else {
      showToast("Enter a search term to find videos.");
    }
  }

  ytSearchBtn.onclick = triggerYTSearch;

  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && currentLibraryTab === "yt") triggerYTSearch();
  });

  let localSearchTimeout;
  searchInput.addEventListener("input", (e) => {
    if (currentLibraryTab === "yt") return;

    const query = e.target.value;
    clearTimeout(localSearchTimeout);

    if (!query.trim()) {
      songScroller.setItems(fullSongList);
      return;
    }

    localSearchTimeout = setTimeout(() => {
      socket.emit("remote-command", {
        type: "remote_local_search",
        value: query,
      });
    }, 250);
  });

  function reserveSong(song) {
    if (song.isYouTube)
      socket.emit("remote-command", { type: "reserve_yt", value: song });
    else
      socket.emit("remote-command", {
        type: "reserve_code",
        value: song.code,
      });
  }

  document.querySelectorAll("button[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      const value = btn.dataset.value;
      socket.emit("remote-command", { type, value });
    });
  });

  let toastTimeout;
  function showToast(msg, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    isError ? toast.classList.add("error") : toast.classList.remove("error");
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
  }
});
