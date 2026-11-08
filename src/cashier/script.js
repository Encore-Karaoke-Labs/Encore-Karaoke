const socket = io("/", {
  query: { clientType: "cashier" },
});

const statusEl = document.getElementById("conn-status");
const userListEl = document.getElementById("user-list");
const selectedUserNameEl = document.getElementById("selected-user-name");
const creditsDisplay = document.getElementById("credits-display");
const creditsSub = document.getElementById("credits-sub");
const unitNote = document.getElementById("unit-note");
const freePlayBtn = document.getElementById("freeplay-btn");
const resetAllBtn = document.getElementById("reset-all");
const retailBanner = document.getElementById("retail-banner");

const defaultHost = {
  nickname: "Main Player",
  credits: 0,
  songsRemaining: 0,
  timeRemainingMs: 0,
};

let usersData = { HOST: { ...defaultHost } };
let freePlay = false;
let retail = { enabled: false, creditUnit: "songs", creditValue: 1 };
let selectedUserId = "HOST";

const deadlines = {};

if (!window.desktopIntegration?.ipc?.send) {
  const controls = document.getElementById("window-controls");
  if (controls) controls.style.display = "none";
}

function ipcSend(channel) {
  window.desktopIntegration?.ipc?.send?.(channel);
}

function sendCommand(type, value) {
  socket.emit("remote-command", { type, value });
}

function addCredits(amount) {
  sendCommand("add_credits", { target: selectedUserId, value: amount });
}

function resetTargetCredits() {
  sendCommand("reset_credits", { target: selectedUserId });
}

function resetAllUsers() {
  if (confirm("Are you sure you want to reset ALL users' credits to 0?")) {
    sendCommand("reset_credits", { target: "ALL" });
  }
}

function toggleFreePlay() {
  const next = !freePlay;
  freePlay = next;
  render();
  sendCommand("set_freeplay", next);
}

function selectUser(id) {
  selectedUserId = id;
  render();
}

function getRemainingMs(id) {
  const entry = usersData[id];
  if (!entry) return 0;

  if (retail.creditUnit === "time") {
    const deadline = deadlines[id];
    if (deadline !== undefined) {
      return Math.max(0, deadline - Date.now());
    }
    return Math.max(0, Number(entry.timeRemainingMs) || 0);
  }

  return 0;
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}`;
}

function setControlsDisabled(disabled) {
  document.querySelectorAll(".grid .btn").forEach((button) => {
    button.disabled = disabled;
  });
  if (resetAllBtn) resetAllBtn.disabled = disabled;
}

function createUserCard(id, info) {
  const card = document.createElement("div");
  card.className = `user-card ${id === selectedUserId ? "active" : ""}`;
  card.onclick = () => selectUser(id);

  const infoWrap = document.createElement("div");
  infoWrap.className = "user-info";

  const name = document.createElement("span");
  name.className = "user-name";
  name.textContent =
    info.nickname || (id === "HOST" ? "Main Player" : "Singer");

  const kind = document.createElement("span");
  kind.className = "user-kind";
  kind.textContent = id === "HOST" ? "Main Machine" : "Mobile User";

  infoWrap.appendChild(name);
  infoWrap.appendChild(kind);

  const badge = document.createElement("div");
  badge.className = "user-credits-badge";
  badge.textContent = freePlay ? "FREE" : String(info.credits || 0);

  card.appendChild(infoWrap);
  card.appendChild(badge);
  return card;
}

function render() {
  const host = usersData.HOST || defaultHost;

  userListEl.innerHTML = "";
  userListEl.appendChild(createUserCard("HOST", { ...defaultHost, ...host }));

  const otherIds = Object.keys(usersData)
    .filter((id) => id !== "HOST")
    .sort((a, b) =>
      String(usersData[a]?.nickname || "").localeCompare(
        String(usersData[b]?.nickname || ""),
      ),
    );

  for (const id of otherIds) {
    userListEl.appendChild(createUserCard(id, usersData[id]));
  }

  if (!usersData[selectedUserId]) {
    selectedUserId = "HOST";
  }

  const activeUser = usersData[selectedUserId] || defaultHost;
  selectedUserNameEl.textContent = (
    activeUser.nickname || "Main Player"
  ).toUpperCase();

  creditsDisplay.textContent = freePlay
    ? "FREE"
    : String(Number(activeUser.credits) || 0);
  creditsDisplay.classList.toggle("free", freePlay);

  retailBanner.classList.toggle("hidden", retail.enabled);
  setControlsDisabled(!retail.enabled);

  freePlayBtn.classList.toggle("active", freePlay);
  freePlayBtn.textContent = freePlay ? "FREE PLAY: ON" : "TOGGLE FREE PLAY";

  if (!retail.enabled) {
    unitNote.textContent = "Enable retail mode in Setup → Cashier & Credits.";
    creditsSub.textContent = "Retail mode is disabled.";
  } else {
    const unitLabel =
      retail.creditUnit === "time" ? "MINUTE(S) OF TIME" : "SONG(S)";
    unitNote.textContent = `1 CREDIT = ${retail.creditValue} ${unitLabel}`;
    updateSelectedSub();
  }
}

function updateSelectedSub() {
  if (!retail.enabled || !creditsSub) return;

  const activeUser = usersData[selectedUserId] || defaultHost;

  if (freePlay) {
    creditsSub.textContent = "Free play is active — songs are not charged.";
    return;
  }

  if (retail.creditUnit === "time") {
    creditsSub.textContent = `${formatTime(
      getRemainingMs(selectedUserId),
    )} remaining`;
  } else {
    creditsSub.textContent = `${Number(activeUser.songsRemaining) || 0} song(s) remaining`;
  }
}

function applySocialUpdate(payload) {
  freePlay = Boolean(payload.freePlay);

  if (payload.retail) {
    retail = {
      enabled: Boolean(payload.retail.enabled),
      creditUnit: payload.retail.creditUnit === "time" ? "time" : "songs",
      creditValue: Math.max(1, Number(payload.retail.creditValue) || 1),
    };
  }

  usersData =
    payload.users && typeof payload.users === "object"
      ? payload.users
      : { HOST: { ...defaultHost } };

  const now = Date.now();
  for (const [id, info] of Object.entries(usersData)) {
    deadlines[id] = now + Math.max(0, Number(info.timeRemainingMs) || 0);
  }

  if (!usersData[selectedUserId]) {
    selectedUserId = "HOST";
  }

  render();
}

socket.on("connect", () => {
  statusEl.textContent = "CONNECTED TO HOST";
  statusEl.classList.add("connected");
  setTimeout(() => sendCommand("get_social_state", true), 200);
});

socket.on("disconnect", () => {
  statusEl.textContent = "DISCONNECTED";
  statusEl.classList.remove("connected");
  creditsDisplay.textContent = "--";
  creditsSub.textContent = "Waiting for host...";
});

socket.on("fromRemote", (payload) => {
  if (payload?.type === "social_update") {
    applySocialUpdate(payload);
  }
});

setInterval(() => {
  if (retail.enabled && retail.creditUnit === "time") {
    updateSelectedSub();
  }
}, 500);

render();
