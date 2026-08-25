import { Client } from "@xhayper/discord-rpc";
import { Bonjour } from "bonjour-service";
import { exec } from "child_process";
import cors from "cors";
import crypto from "crypto";
import dgram from "dgram";
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  WebContentsView,
} from "electron";
import electronSquirrelStartup from "electron-squirrel-startup";
import express from "express";
import fs from "fs";
import http from "http";
import _Kuroshiro from "kuroshiro";
import _KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import loudness from "loudness";
import mime from "mime-types";
import os from "os";
import path from "path";
import PDFDocument from "pdfkit";
import qrcode from "qrcode";
import { Server } from "socket.io";
import { io as ioClient } from "socket.io-client";
import si from "systeminformation";
import youtubesearchapi from "youtube-search-api";
import Config from "./config-manager.js";

const Kuroshiro = _Kuroshiro.default ?? _Kuroshiro;
const KuromojiAnalyzer = _KuromojiAnalyzer.default ?? _KuromojiAnalyzer;
const { getVolume, setVolume } = loudness;

if (electronSquirrelStartup) app.quit();

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const PROTOCOL_PREFIX = "encore";
const DISCORD_CLIENT_ID = "1408795513397973052";
const DISCORD_PROTOCOL_PREFIX = `discord-${DISCORD_CLIENT_ID}`;

function registerProtocols() {
  const protocols = [PROTOCOL_PREFIX, DISCORD_PROTOCOL_PREFIX];

  protocols.forEach((proto) => {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(proto, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(proto);
    }
  });
}

const krRegex = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/; // Hangul (Korean)
const kanaRegex = /[\u3040-\u30ff\u31f0-\u31ff]/; // Hiragana & Katakana (Japanese)
const hanIdeographsRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/; // Hanzi/Kanji/Hanja

// Logging System
const logger = {
  info: (tag, msg) =>
    console.log(`[${new Date().toLocaleTimeString()}] [INFO] [${tag}]`, msg),
  warn: (tag, msg) =>
    console.warn(`[${new Date().toLocaleTimeString()}] [WARN] [${tag}]`, msg),
  error: (tag, msg) =>
    console.error(`[${new Date().toLocaleTimeString()}] [ERR ] [${tag}]`, msg),
  debug: (tag, msg) =>
    console.log(`[${new Date().toLocaleTimeString()}] [DBUG] [${tag}]`, msg),
};

let isRendererReady = false;
let pendingDeepLinks = [];

function extractDeepLink(argv) {
  if (!Array.isArray(argv)) return null;

  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    console.log(arg);
    if (arg.startsWith("encore://")) {
      return arg;
    }

    if (arg.startsWith(DISCORD_PROTOCOL_PREFIX)) {
      let raw = arg.replace(
        new RegExp(`^${DISCORD_PROTOCOL_PREFIX}:(//)?`),
        "",
      );
      raw = raw.replace(/^(join|activity-join)\//, "").replace(/^\//, "");
      const sessionCode = raw.split("?")[0].split("/")[0].trim();

      if (sessionCode) {
        return `encore://session/${sessionCode}`;
      }
    }
  }

  return null;
}

function handleDeepLink(url) {
  if (!url || !url.startsWith("encore://")) return;
  logger.info("DEEPLINK", `Received deep link: ${url}`);

  if (
    isRendererReady &&
    appViewWebContents &&
    !appViewWebContents.isDestroyed()
  ) {
    logger.info(
      "DEEPLINK",
      `Renderer is ready. Dispatching immediately: ${url}`,
    );
    appViewWebContents.send("deep-link", url);
  } else {
    logger.info(
      "DEEPLINK",
      `Renderer not ready yet. Queuing deep link: ${url}`,
    );
    pendingDeepLinks.push(url);
  }
}

function flushPendingDeepLinks() {
  if (
    !isRendererReady ||
    !appViewWebContents ||
    appViewWebContents.isDestroyed()
  )
    return;

  while (pendingDeepLinks.length > 0) {
    const url = pendingDeepLinks.shift();
    logger.info("DEEPLINK", `Flushing queued deep link: ${url}`);
    appViewWebContents.send("deep-link", url);
  }
}

// Windows/Linux Second Instance Handler
app.on("second-instance", (event, commandLine) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }

  const deepLinkUrl = extractDeepLink(commandLine);
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl);
  }
});

// macOS Deep Link Handler
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

const initialDeepLink = extractDeepLink(process.argv);
if (initialDeepLink) {
  pendingDeepLinks.push(initialDeepLink);
}

// Initialization
const versionInformation = {
  number: "1.11.0",
  channel: "BETA",
  codename: "Pisces",
};

const kioskEnabled = process.argv.includes("--kiosk");
const isLowLatency = process.argv.includes("--low-latency");
const isDev = process.argv.includes("--dev");

let PORT = 0;
const server = express();
const serverHttp = http.createServer(server);
const io = new Server(serverHttp);
const instance = new Bonjour();
const bonjourId = `encore-link-${crypto.randomUUID()}`;

const fileToken = crypto.randomUUID();

// Pre-compute CRC32 table for maximum performance
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c;
}

// Memory-safe chunked CRC32 stream calculator
function calculateFileCRC32(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let crc = 0 ^ -1;

    stream.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ chunk[i]) & 0xff];
      }
    });

    stream.on("end", () => {
      resolve((crc ^ -1) >>> 0);
    });

    stream.on("error", reject);
  });
}

let activeUpdateServers = [];
const serverBrowser = instance.find({ type: "encore-server" });

serverBrowser.on("up", async (service) => {
  try {
    let res = await fetch(
      `http://${service.referer.address}:${service.port}/info`,
    );
    let serverInfo = await res.json();

    const serverId = `${service.referer.address}:${service.port}`;
    const serverObj = {
      id: serverId,
      ip: service.referer.address,
      host: service.host,
      port: service.port,
      name: serverInfo.serverName,
      info: serverInfo.libraryInformation,
    };

    const existsIdx = activeUpdateServers.findIndex((s) => s.id === serverId);
    if (existsIdx !== -1) {
      activeUpdateServers[existsIdx] = serverObj;
    } else {
      activeUpdateServers.push(serverObj);
    }
    logger.info("SYSTEM", `Server UP: ${serverInfo.serverName} (${serverId})`);
  } catch (e) {
    logger.error("SYSTEM", "Failed to fetch info from a discovered UP server.");
  }
});

serverBrowser.on("down", (service) => {
  const serverId = `${service.referer.address}:${service.port}`;
  activeUpdateServers = activeUpdateServers.filter((s) => s.id !== serverId);
  logger.info("SYSTEM", `Server DOWN: ${serverId}`);
});

instance.find({ type: "encore-server" }, async (service) => {
  try {
    let res = await fetch(
      `http://${service.referer.address}:${service.port}/info`,
    );
    let serverInfo = await res.json();
    logger.info(
      "SYSTEM",
      `Found Encore Song Update server: ${serverInfo.serverName} (${service.host})`,
    );
    logger.info(
      "SYSTEM",
      `Library hosted: ${serverInfo.libraryInformation.title}`,
    );
  } catch (e) {
    logger.error(
      "SYSTEM",
      "Encore failed to grab info of the Song Update server",
    );
    logger.error("SYSTEM", e);
  }
});

const kuroshiro = new Kuroshiro();
kuroshiro.init(new KuromojiAnalyzer());

const userData = app.getPath("userData");
const userVideos = app.getPath("videos");
logger.info("SYSTEM", `User Data Path: ${userData}`);
logger.info("SYSTEM", `User Videos Path: ${userVideos}`);

const userBGVDir = path.join(userVideos, "Encore User BGV");
try {
  if (!fs.existsSync(userBGVDir)) {
    fs.mkdirSync(userBGVDir, { recursive: true });
    logger.info("SYSTEM", `Created User BGV directory at: ${userBGVDir}`);
  }
} catch (e) {
  logger.error("SYSTEM", `Failed to create User BGV directory: ${e.message}`);
}

try {
  Config.init(userData);
  logger.info("CONFIG", "Configuration loaded successfully.");
} catch (e) {
  logger.error("CONFIG", e.message);
}

// Discord RPC Handling
let discordClient = new Client({ clientId: "1408795513397973052" });
let rpcReconnAttempts = 0;
let isRpcReconnecting = false;
let currentRPCState = "Booting up...";

function setupDiscordRPC() {
  discordClient.on("ready", async () => {
    logger.info("DISCORD", "Encore Karaoke RPC is ready!");
    rpcReconnAttempts = 0;

    try {
      await discordClient.subscribe("ACTIVITY_JOIN");
      await discordClient.subscribe("ACTIVITY_JOIN_REQUEST");
      logger.info("DISCORD", "Subscribed to ACTIVITY_JOIN events.");
    } catch (err) {
      logger.error("DISCORD", "Failed to subscribe to join events:", err);
    }

    discordClient.user?.setActivity({
      details: currentRPCState,
      largeImageKey: "hoshi",
      largeImageText: "Encore Karaoke",
    });
  });

  discordClient.on("ACTIVITY_JOIN", (data) => {
    const secret = typeof data === "string" ? data : data?.secret;
    logger.info("DISCORD", `Received join secret from Discord: ${secret}`);
    if (secret) {
      handleDeepLink(
        secret.startsWith("encore://") ? secret : `encore://session/${secret}`,
      );
    }
  });

  discordClient.on("ACTIVITY_JOIN_REQUEST", (user) => {
    logger.info("DISCORD", `Join request received from: ${user.username}`);
  });

  discordClient.on("disconnected", () => {
    if (isRpcReconnecting) return;
    logger.warn("DISCORD", "Disconnected. Reconnecting in 15s...");
    isRpcReconnecting = true;
    const interval = setInterval(() => {
      rpcReconnAttempts++;
      logger.info("DISCORD", `Reconnection attempt ${rpcReconnAttempts}/3`);
      discordClient.destroy();
      discordClient = new Client({ clientId: "1408795513397973052" });
      setupDiscordRPC();
      discordClient
        .login()
        .catch((e) => logger.error("DISCORD", "Login failed"));
      if (rpcReconnAttempts >= 3) {
        logger.error("DISCORD", "Failed to reconnect after 3 attempts.");
        clearInterval(interval);
        isRpcReconnecting = false;
        rpcReconnAttempts = 0;
      }
    }, 15000);
  });
}

// Server Routes & Logic
let staticAssetsPath;
if (app.isPackaged) {
  staticAssetsPath = path.join(process.resourcesPath, "static");
} else {
  staticAssetsPath = path.join(__dirname, "resources", "static");
}

server.use(express.static(staticAssetsPath));
server.use(express.json());
server.use(cors());

let local_ip = null;
const udpSocket = dgram.createSocket("udp4");
udpSocket.connect(80, "8.8.8.8", () => {
  local_ip = udpSocket.address().address;
  logger.info("SERVER", `Local IP detected: ${local_ip}`);
  udpSocket.close();
});

server.get("/local_ip", (req, res) => res.send(local_ip));

server.get("/qr", (req, res) => {
  qrcode.toDataURL(req.query["url"], (err, url) => {
    if (err) return res.status(500).send("QR Error");
    const buffer = Buffer.from(url.split(",")[1], "base64");
    res.setHeader("content-type", "image/png");
    res.send(buffer);
  });
});

server.get("/drives", async (req, res) => {
  const fToken = req.query.token;
  if (!fToken)
    return res
      .status(403)
      .json({ error: "Provide an access token to continue." });
  if (fToken != fileToken)
    return res.status(403).json({ error: "Invalid access token" });
  logger.debug("FILE", "Requesting drives");
  try {
    const disks = await si.fsSize();
    const mountPoints = [...new Set(disks.map((d) => d.mount))];
    res.json(mountPoints);
  } catch (error) {
    logger.error("FILE", `Failed to get drives: ${error.message}`);
    res.status(500).send(error.message);
  }
});

server.get("/user-bgv-list", async (req, res) => {
  try {
    if (!fs.existsSync(userBGVDir)) return res.json([]);

    const files = await fs.promises.readdir(userBGVDir);
    const videoExts = [
      ".mp4",
      ".mkv",
      ".webm",
      ".avi",
      ".mov",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
    ];

    const videos = files
      .filter((f) => videoExts.includes(path.extname(f).toLowerCase()))
      .map((f) => path.join(userBGVDir, f));

    res.json(videos);
  } catch (error) {
    logger.error("FILE", `Failed to read User BGVs: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

server.post("/list", (req, res) => {
  const dir = req.body.dir;
  const fToken = req.query.token;
  if (!fToken)
    return res
      .status(403)
      .json({ error: "Provide an access token to continue." });
  if (fToken != fileToken)
    return res.status(403).json({ error: "Invalid access token" });
  if (!dir)
    return res
      .status(400)
      .json({ error: true, error_msg: "No directory provided" });

  fs.stat(dir, (err, stats) => {
    if (err || !stats.isDirectory()) {
      return res
        .status(400)
        .json({ error: true, error_msg: "Invalid directory" });
    }

    fs.readdir(dir, async (err, files) => {
      if (err)
        return res.status(400).json({ error: true, error_msg: "Read error" });

      const respData = [];
      for (const file of files) {
        if (file.startsWith("._")) continue;
        const filePath = path.join(dir, file);
        try {
          const fileStats = await fs.promises.stat(filePath);
          respData.push({
            name: file,
            type: fileStats.isFile() ? "file" : "folder",
            created: new Date(fileStats.ctime).getTime(),
            modified: new Date(fileStats.mtime).getTime(),
          });
        } catch (e) {
          /* Ignore inaccessible files */
        }
      }
      res.json(respData);
    });
  });
});

server.get("/getFile", (req, res) => {
  const fPath = req.query.path;
  const fToken = req.query.token;
  if (!fToken)
    return res
      .status(403)
      .json({ error: "Provide an access token to continue." });
  if (fToken != fileToken)
    return res.status(403).json({ error: "Invalid access token" });
  if (!fPath) return res.status(400).json({ error: "No path" });

  fs.stat(fPath, (err, stats) => {
    if (err || stats.isDirectory())
      return res.status(400).json({ error: "Invalid file" });

    if (fPath.endsWith(".lrc")) {
      return res.sendFile(fPath, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    let mimeType = mime.lookup(fPath) || "application/octet-stream";
    res.sendFile(fPath, { headers: { "Content-Type": mimeType } });
  });
});

server.get("/yt-search", async (req, res) => {
  const q = req.query.q;
  logger.info("YOUTUBE", `Searching: ${q}`);
  let results = await youtubesearchapi.GetListByKeyword(q, false);
  res.json(results);
});

server.post("/auth/create-hash", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
  res.json({ salt, hash });
});

server.post("/auth/verify-hash", (req, res) => {
  const { password, salt, hash } = req.body;
  const computedHash = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");
  res.json({ valid: computedHash === hash });
});

const titleBarHeight = 55;
let zoomFactor = Config.getItem("zoomLevel");
if (zoomFactor == null) {
  zoomFactor = Config.getItem("zoomFactor") ?? 0.85;
}
let appViewWebContents = null;

const getBooleanSetting = (value) =>
  value === true || value === 1 || value === "true" || value === "1";

const applyZoomFactor = (nextZoomFactor) => {
  zoomFactor = Math.max(0.26, Math.min(2, Number(nextZoomFactor) || 0.85));
  Config.setItem("zoomLevel", zoomFactor);
  if (appViewWebContents && !appViewWebContents.isDestroyed()) {
    appViewWebContents.setZoomFactor(zoomFactor);
    appViewWebContents.send("zoom-level-changed", zoomFactor);
  }
  return zoomFactor;
};

const resetZoom = () => applyZoomFactor(0.85);
const addZoom = () => applyZoomFactor(zoomFactor + 0.15);
const reduceZoom = () => {
  if (zoomFactor > 0.26) {
    return applyZoomFactor(zoomFactor - 0.15);
  }
  return zoomFactor;
};

// Main App Startup
const createWindow = () => {
  const shouldStartFullscreen = getBooleanSetting(
    Config.getItem("fullscreenEnabled"),
  );

  const win = new BrowserWindow({
    title: `Encore Karaoke ${versionInformation.channel} ${versionInformation.number} (${versionInformation.codename})`,
    width: 1280,
    height: 774,
    ...(process.platform === "win32"
      ? { icon: path.join(__dirname, "resources/icon.ico") }
      : process.platform === "linux"
        ? { icon: path.join(__dirname, "resources/icon.png") }
        : {}),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 20 },
    backgroundColor: "#000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  const appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.contentView.addChildView(appView);
  appViewWebContents = appView.webContents;

  appView.webContents.on(
    "did-start-navigation",
    (event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) {
        isRendererReady = false;
      }
    },
  );

  const updateBounds = () => {
    const bounds = win.getContentBounds();
    if (bounds.width === 0 || bounds.height === 0) return;

    const isFullScreen = win.isFullScreen() || win.isKiosk();

    if (isFullScreen) {
      appView.setBounds({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height,
      });
    } else {
      appView.setBounds({
        x: 0,
        y: titleBarHeight,
        width: bounds.width,
        height: bounds.height - titleBarHeight,
      });
    }
  };

  win.on("resize", updateBounds);
  win.on("maximize", updateBounds);
  win.on("enter-full-screen", () => {
    updateBounds();
    appView.webContents.send("fullscreen-state-changed", true);
  });

  win.on("leave-full-screen", () => {
    updateBounds();
    appView.webContents.send("fullscreen-state-changed", false);
  });
  win.on("restore", () => setTimeout(updateBounds, 50));
  win.on("show", () => setTimeout(updateBounds, 50));
  updateBounds();

  if (shouldStartFullscreen && !kioskEnabled) {
    win.setFullScreen(true);
  }

  win.loadURL(
    `file://${__dirname}/resources/titlebar.html?platform=${process.platform}`,
  );
  appView.webContents.loadURL(`http://127.0.0.1:${PORT}/index.html`);
  appView.webContents.setZoomFactor(zoomFactor);

  const reloadPage = () => {
    if (!kioskEnabled) appView.webContents.reload();
  };

  win.on("focus", () => {
    appView.webContents.focus();
    globalShortcut.register("CommandOrControl+0", resetZoom);
    globalShortcut.register("CommandOrControl+plus", addZoom);
    globalShortcut.register("CommandOrControl+=", addZoom);
    globalShortcut.register("CommandOrControl+-", reduceZoom);
    globalShortcut.register("CommandOrControl+_", reduceZoom);
    globalShortcut.register("CommandOrControl+r", reloadPage);
  });

  win.on("blur", () => {
    globalShortcut.unregister("CommandOrControl+0");
    globalShortcut.unregister("CommandOrControl+plus");
    globalShortcut.unregister("CommandOrControl+=");
    globalShortcut.unregister("CommandOrControl+-");
    globalShortcut.unregister("CommandOrControl+_");
    globalShortcut.unregister("CommandOrControl+r");
  });

  if (kioskEnabled) {
    win.setKiosk(true);
    win.setAlwaysOnTop(true);
    if (process.platform === "win32") {
      exec("taskkill /f /im explorer.exe", (error) => {
        if (error)
          logger.error(
            "SYSTEM",
            "Failed to kill explorer.exe: " + error.message,
          );
        else logger.info("SYSTEM", "Explorer killed for kiosk mode");
      });
    }
  }

  appView.webContents.on("devtools-opened", () => {
    const css = `:root { --sys-color-base: var(--ref-palette-neutral100); } .-theme-with-dark-background { --sys-color-base: var(--ref-palette-secondary25); } body { --default-font-family: system-ui,sans-serif; }`;
    appView.webContents.devToolsWebContents.executeJavaScript(
      `const s = document.createElement('style'); s.innerHTML = '${css.replaceAll("\n", " ")}'; document.body.append(s); document.body.classList.remove('platform-windows');`,
    );
  });

  const handleSpecialKeys = (event, input) => {
    if (input.type === "keyDown") {
      if (input.alt && input.key === "F4") {
        event.preventDefault();
        app.quit();
        return;
      }

      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key.toLowerCase() === "i")
      ) {
        if (!isDev) {
          event.preventDefault();
          return;
        }
        if (appView.webContents.isDevToolsOpened())
          appView.webContents.closeDevTools();
        else appView.webContents.openDevTools({ mode: "detach" });
        event.preventDefault();
      }
      if (input.key === "F11") {
        if (!kioskEnabled) {
          win.setFullScreen(!win.isFullScreen());
        }
        event.preventDefault();
      }
    }
  };

  win.webContents.on("before-input-event", handleSpecialKeys);
  appView.webContents.on("before-input-event", handleSpecialKeys);
};

if (isLowLatency) {
  logger.warn(
    "SYSTEM",
    "Low-latency audio mode is VERY experimental and may lead to degraded audio performance!",
  );
  app.commandLine.appendSwitch("audio-buffer-size", "256");
  app.commandLine.appendSwitch("enable-exclusive-audio");
  app.commandLine.appendSwitch("alsa-output-buffer-size", "512");
}

app.whenReady().then(async () => {
  setTimeout(() => {
    logger.debug("GPU", app.getGPUFeatureStatus());
  }, 2000);
  setupDiscordRPC();
  discordClient
    .login()
    .catch((e) => logger.error("DISCORD", "Initial login failed"));

  const CLOUD_URL = "https://olive.nxw.pw:8443";
  const RELAY_URL = "https://enmoku.encorekaraoke.org/1.11.0/";
  const cloudSocket = ioClient(CLOUD_URL, {
    query: { clientType: "host" },
    reconnectionAttempts: 5,
  });
  let activeRoomCode = null;

  cloudSocket.on("connect", () => {
    logger.info(
      "CLOUD",
      `Successfully connected to Cloud Relay at ${CLOUD_URL}`,
    );
  });

  cloudSocket.on("room-created", (data) => {
    activeRoomCode = data.roomCode;
    logger.info("CLOUD", `Cloud Room is ready! PIN: ${activeRoomCode}`);
    io.to("karaoke-app").emit("cloud-status", {
      connected: true,
      roomCode: activeRoomCode,
      relayUrl: RELAY_URL,
    });
  });

  cloudSocket.on("connect_error", (err) => {
    logger.error(
      "CLOUD",
      `Connection to relay failed: ${err.message}. Will retry.`,
    );
    if (activeRoomCode !== null) {
      activeRoomCode = null;
      io.to("karaoke-app").emit("cloud-status", { connected: false });
    }
  });

  cloudSocket.on("disconnect", (reason) => {
    logger.warn("CLOUD", `Disconnected from relay: ${reason}`);
    activeRoomCode = null;
    io.to("karaoke-app").emit("cloud-status", { connected: false });
  });

  server.get("/cloud_info", (req, res) => {
    if (!activeRoomCode) {
      return res
        .status(503)
        .json({ error: "Cloud relay not connected. Please wait." });
    }
    res.json({
      relayUrl: RELAY_URL,
      roomCode: activeRoomCode,
    });
  });

  ipcMain.on("deep-link-ready", () => {
    logger.info(
      "DEEPLINK",
      "Renderer signaled that the boot process is complete.",
    );
    isRendererReady = true;
    flushPendingDeepLinks();
  });

  ipcMain.on("window-minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("window-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win.isMaximized()) win.restore();
    else win.maximize();
  });
  ipcMain.on("window-close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on("app-close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    BrowserWindow.getAllWindows().forEach((w) => {
      w.close();
    });
  });

  ipcMain.on("simulate-key", (event, keyChar) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const view = win.contentView.children[0];

    if (view) {
      view.webContents
        .executeJavaScript(
          `
      if (document.activeElement) document.activeElement.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '${keyChar}', bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: '${keyChar}', bubbles: true, cancelable: true }));
    `,
        )
        .catch((err) => console.error("Simulate key error:", err));
    }
  });

  ipcMain.handle("get-version", () => versionInformation);
  ipcMain.handle("get-kiosk-enabled", () => kioskEnabled);
  ipcMain.handle("deep-link-get-initial", () => {
    const url = pendingDeepLinkUrl;
    pendingDeepLinkUrl = null;
    return url;
  });
  ipcMain.handle("fullscreen-get", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isFullScreen() : false;
  });
  ipcMain.handle("fullscreen-set", (event, fullscreen) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    win.setFullScreen(Boolean(fullscreen));
    return win.isFullScreen();
  });
  ipcMain.handle("fullscreen-toggle", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const nextState = !win.isFullScreen();
    win.setFullScreen(nextState);
    return nextState;
  });
  ipcMain.handle("get-file-token", () => fileToken);
  ipcMain.handle("config-get-all", () => Config.getAll());
  ipcMain.handle("config-get-item", (event, key) => {
    if (typeof key !== "string") return null;
    return Config.getItem(key);
  });
  ipcMain.on("config-set-item", (event, { key, value }) => {
    if (typeof key !== "string") return;
    Config.setItem(key, value);
    logger.info("CONFIG", `Set '${key}'`);
  });
  ipcMain.on("config-merge", (event, dataObject) => {
    if (typeof dataObject !== "object" || dataObject === null) return;
    Config.merge(dataObject);
    logger.info("CONFIG", "Configuration merged with new data.");
  });
  ipcMain.handle("get-volume", async () => getVolume());
  ipcMain.handle("get-port", () => PORT);
  ipcMain.handle("zoom-get", () => zoomFactor);
  ipcMain.handle("zoom-set", (event, value) => applyZoomFactor(value));
  ipcMain.handle("zoom-reset", () => resetZoom());
  ipcMain.handle("zoom-in", () => addZoom());
  ipcMain.handle("zoom-out", () => reduceZoom());
  ipcMain.handle("romanize", async (event, rawJapanese) => {
    if (!rawJapanese || typeof rawJapanese !== "string") return "";

    try {
      const cleanText = rawJapanese.replace(/[\r\n\t]/g, " ").trim();
      if (!cleanText) return "";

      let romaji = await kuroshiro.convert(cleanText, {
        to: "romaji",
        mode: "spaced",
        romajiSystem: "hepburn",
      });

      romaji = romaji
        .replace(/\s+/g, " ") // Collapse multiple spaces
        .replace(/\s+([,.\?!♪~～''])/g, "$1") // Remove awkward space right before punctuation/symbols
        .replace(/([（(])\s+/g, "$1") // Remove space right after opening brackets
        .trim();

      return romaji;
    } catch (error) {
      logger.warn(
        "ROMANIZE",
        `Kuromoji conversion failed for "${rawJapanese}": ${error.message}. Using safe fallback.`,
      );

      try {
        let fallbackRomaji = await Kuroshiro.Util.kanaToRomaji(
          rawJapanese,
          "hepburn",
        );
        return fallbackRomaji.replace(/\s+/g, " ").trim();
      } catch (fallbackError) {
        logger.error(
          "ROMANIZE",
          `Fallback romanization failed: ${fallbackError.message}`,
        );
        return rawJapanese;
      }
    }
  });
  ipcMain.on("set-volume", async (event, vol) => setVolume(vol));
  ipcMain.handle("get-recordings", async () => {
    const recordingsDir = path.join(userVideos, "Encore Recordings");
    try {
      if (!fs.existsSync(recordingsDir)) return [];
      const items = await fs.promises.readdir(recordingsDir, {
        withFileTypes: true,
      });
      const recordings = [];

      for (const item of items) {
        if (item.isDirectory()) {
          const sessionPath = path.join(recordingsDir, item.name);
          const videoPath = path.join(sessionPath, "Mix-Video.webm");

          if (fs.existsSync(videoPath)) {
            const stat = await fs.promises.stat(videoPath);
            recordings.push({
              id: item.name,
              title: item.name,
              date: stat.mtimeMs,
              videoPath: videoPath,
            });
          }
        }
      }
      return recordings.sort((a, b) => b.date - a.date); // Newest first
    } catch (error) {
      logger.error("SYSTEM", `Failed to get recordings: ${error.message}`);
      return [];
    }
  });

  ipcMain.handle("delete-recording", async (event, dirName) => {
    if (
      !dirName ||
      dirName.includes("..") ||
      dirName.includes("/") ||
      dirName.includes("\\")
    ) {
      return false;
    }
    const targetPath = path.join(userVideos, "Encore Recordings", dirName);
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      logger.info("SYSTEM", `Recording session deleted: ${dirName}`);
      return true;
    } catch (error) {
      logger.error("SYSTEM", `Failed to delete recording: ${error.message}`);
      return false;
    }
  });
  ipcMain.handle("save-recording", async (event, data) => {
    try {
      const { videoBuffer, micBuffer, musicBuffer, songTitle } = data;
      const videosDir = path.join(userVideos, "Encore Recordings");

      const safeTitle = (songTitle || "Session").replace(/[^a-z0-9]/gi, "_");
      const timestamp = new Date().toISOString().replace(/:/g, "-");
      const sessionFolderName = `${safeTitle}-${timestamp}`;
      const sessionPath = path.join(videosDir, sessionFolderName);

      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      const videoFile = path.join(sessionPath, "Mix-Video.webm");
      const micFile = path.join(sessionPath, "Vocal-Track.wav");
      const musicFile = path.join(sessionPath, "Instrumental-Track.wav");

      const writePromises = [];

      if (videoBuffer) {
        writePromises.push(
          fs.promises.writeFile(videoFile, Buffer.from(videoBuffer)),
        );
      }

      if (micBuffer) {
        writePromises.push(
          fs.promises.writeFile(micFile, Buffer.from(micBuffer)),
        );
      }
      if (musicBuffer) {
        writePromises.push(
          fs.promises.writeFile(musicFile, Buffer.from(musicBuffer)),
        );
      }

      await Promise.all(writePromises);

      logger.info(
        "SYSTEM",
        `Recording session exported silently to: ${sessionPath}`,
      );
      return { success: true, path: sessionPath };
    } catch (error) {
      logger.error(
        "SYSTEM",
        `Failed to save recording session: ${error.message}`,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("select-soundfont-file", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Select Custom Soundfont",
      properties: ["openFile"],
      filters: [
        { name: "Soundfont Files", extensions: ["sf2", "sf3", "sfz", "dls"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0].replace(/\\/g, "/");
  });

  ipcMain.handle("libmgr-export-songbook", async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { folderPath, libraryTitle } = payload;

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export Encore Songbook",
      defaultPath: path.join(
        app.getPath("documents"),
        `${libraryTitle.replace(/[^a-z0-9]/gi, "_")}_Songbook.pdf`,
      ),
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });

    if (canceled || !filePath) return { success: false, reason: "canceled" };

    const mainWin = BrowserWindow.getAllWindows().find(
      (w) => !w.title.includes("Library Manager"),
    );
    if (mainWin && mainWin.contentView.children[0]) {
      mainWin.contentView.children[0].webContents.send(
        "request-songbook-data",
        { folderPath, filePath, libraryTitle },
      );
      return { success: true, pending: true };
    } else {
      return { success: false, reason: "Main app process not found." };
    }
  });

  ipcMain.on("songbook-build-progress", (event, data) => {
    isSongbookBuildActive = true;
    if (libraryManagerWin) {
      libraryManagerWin.webContents.send("songbook-export-progress", {
        phase: "Scanning Library...",
        current: data.current,
        total: data.total,
        percentage: data.percentage,
      });
    }
  });

  ipcMain.on("receive-songbook-data", (event, payload) => {
    isSongbookBuildActive = true;
    const { songs, filePath, libraryTitle } = payload;

    if (!songs || songs.length === 0) {
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send("songbook-export-complete", {
          success: false,
          reason: "Library is empty or failed to parse.",
        }),
      );
      return;
    }

    let fontRajdhani, fontRajdhaniBold, fontRadioCanada, fontJP, fontKR, fontSC;

    try {
      fontRajdhani = fs.readFileSync(
        path.join(staticAssetsPath, "assets", "fonts", "Rajdhani-Regular.ttf"),
      );
      fontRajdhaniBold = fs.readFileSync(
        path.join(staticAssetsPath, "assets", "fonts", "Rajdhani-Bold.ttf"),
      );
      fontRadioCanada = fs.readFileSync(
        path.join(
          staticAssetsPath,
          "assets",
          "fonts",
          "RadioCanada-Regular.ttf",
        ),
      );

      const jpPath = path.join(
        staticAssetsPath,
        "assets",
        "fonts",
        "NotoSansJP-Regular.ttf",
      );
      if (fs.existsSync(jpPath)) fontJP = fs.readFileSync(jpPath);
      else logger.warn("SYSTEM", "NotoSansJP-Regular.ttf missing!");

      const krPath = path.join(
        staticAssetsPath,
        "assets",
        "fonts",
        "NotoSansKR-Regular.ttf",
      );
      if (fs.existsSync(krPath)) fontKR = fs.readFileSync(krPath);
      else logger.warn("SYSTEM", "NotoSansKR-Regular.ttf missing!");

      const scPath = path.join(
        staticAssetsPath,
        "assets",
        "fonts",
        "NotoSansSC-Regular.ttf",
      );
      if (fs.existsSync(scPath)) fontSC = fs.readFileSync(scPath);
      else logger.warn("SYSTEM", "NotoSansSC-Regular.ttf missing!");
    } catch (fontErr) {
      logger.error("SYSTEM", `PDF Font Error: ${fontErr.message}`);
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send("songbook-export-complete", {
          success: false,
          reason: fontErr.message,
        }),
      );
      return;
    }

    const getFontForText = (text, defaultFont) => {
      if (fontKR && krRegex.test(text)) return "KR-Fallback";
      if (fontJP && kanaRegex.test(text)) return "JP-Fallback";
      if (hanIdeographsRegex.test(text)) {
        if (fontSC) return "SC-Fallback";
        if (fontJP) return "JP-Fallback";
      }
      return defaultFont;
    };

    try {
      songs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

      const doc = new PDFDocument({
        margin: 40,
        size: "A4",
        font: fontRajdhani,
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      doc.registerFont("Rajdhani-Bold", fontRajdhaniBold);
      doc.registerFont("RadioCanada", fontRadioCanada);
      doc.registerFont("Rajdhani", fontRajdhani);

      if (fontJP) doc.registerFont("JP-Fallback", fontJP);
      if (fontKR) doc.registerFont("KR-Fallback", fontKR);
      if (fontSC) doc.registerFont("SC-Fallback", fontSC);

      doc.rect(0, 0, doc.page.width, doc.page.height).fill("#080810");

      const coverTitleFont = getFontForText(libraryTitle, "Rajdhani-Bold");
      doc
        .fillColor("#89cff0")
        .font(coverTitleFont)
        .fontSize(65)
        .text(libraryTitle.toUpperCase(), 40, 60, {
          width: doc.page.width - 80,
          characterSpacing: 2,
          align: "left",
        });

      doc
        .fillColor("#ffd700")
        .font("Rajdhani")
        .fontSize(30)
        .text(`${songs.length} SONGS`, 40, doc.y + 10, {
          characterSpacing: 1,
          align: "left",
        });

      doc.moveDown(2);
      doc
        .fillColor("#ffffff")
        .font("RadioCanada")
        .fontSize(16)
        .text(`Generated on ${new Date().toLocaleDateString()}`, 40, doc.y, {
          align: "left",
        });

      doc.addPage();

      const margins = 40;
      const gutter = 20;
      const colWidth = (doc.page.width - margins * 2 - gutter) / 2;
      const bottomLimit = doc.page.height - margins;

      let col = 0;
      let currentY = margins;
      let currentLetter = "";

      function checkSpace(requiredHeight) {
        if (currentY + requiredHeight > bottomLimit) {
          col++;
          if (col > 1) {
            col = 0;
            doc.addPage();
          }
          currentY = margins;
        }
      }

      const processSongs = async () => {
        for (let i = 0; i < songs.length; i++) {
          const song = songs[i];
          const safeTitle = (song.title || "Unknown").replace(
            /[\u0000-\x1F\x7F-\x9F]/g,
            "",
          );
          const safeArtist = (song.artist || "Unknown").replace(
            /[\u0000-\x1F\x7F-\x9F]/g,
            "",
          );

          let firstLetter = safeTitle.charAt(0).toUpperCase();
          const isLetter = /^[A-Z]$/.test(firstLetter);
          const groupingLetter = isLetter ? firstLetter : "#";

          const needsHeader = groupingLetter !== currentLetter;
          const requiredHeight = 34 + (needsHeader ? 30 : 0);

          checkSpace(requiredHeight);

          const x = margins + col * (colWidth + gutter);

          if (needsHeader) {
            currentLetter = groupingLetter;

            doc.rect(x, currentY, colWidth, 22).fill("#89cff0");
            doc
              .fillColor("#080810")
              .fontSize(16)
              .font("Rajdhani-Bold")
              .text(currentLetter, x + 8, currentY + 3.5);

            currentY += 30;
          }

          const boxX = x;
          const boxY = currentY;
          const boxW = colWidth;
          const boxH = 30;

          doc.lineWidth(0.5).strokeColor("#cccccc");
          doc.roundedRect(boxX, boxY, boxW, boxH, 4).stroke();

          const textX = boxX + 8;
          const textY = boxY + 5;
          const infoBlockX = textX + 38;

          let formatText = "[RS]";
          let formatColor = "#B02FD1";

          if (song.videoPath) {
            formatText = "[MTV]";
            formatColor = "#2F6CD1";
          } else if (song.type === "multiplexed") {
            formatText = "[MP]";
            formatColor = "#2FD147";
          } else if (
            song.type === "mid" ||
            song.type === "kar" ||
            song.type === "midi"
          ) {
            formatText = "[MIDI]";
            formatColor = "#D12F9E";
          }

          doc
            .font("Rajdhani-Bold")
            .fontSize(12)
            .fillColor("#000000")
            .text(song.code, textX, textY, { width: 35, lineBreak: false });

          const maxInfoWidth = boxW - 40 - 8;
          doc.font("Rajdhani-Bold").fontSize(11);
          const formatWidth = doc.widthOfString(formatText);
          const gap = 4;
          const titleStartX = infoBlockX + formatWidth + gap;
          const availableTitleWidth = maxInfoWidth - formatWidth - gap;

          doc
            .fillColor(formatColor)
            .text(formatText, infoBlockX, textY, { lineBreak: false });

          let displayTitle = safeTitle;
          const titleFont = getFontForText(displayTitle, "Rajdhani-Bold");
          doc.font(titleFont).fontSize(11);

          if (doc.widthOfString(displayTitle) > availableTitleWidth) {
            while (
              displayTitle.length > 0 &&
              doc.widthOfString(displayTitle + "...") > availableTitleWidth
            ) {
              displayTitle = displayTitle.slice(0, -1);
            }
            displayTitle += "...";
          }

          doc
            .fillColor("#000000")
            .text(displayTitle, titleStartX, textY, { lineBreak: false });

          const artistFont = getFontForText(safeArtist, "RadioCanada");
          doc
            .font(artistFont)
            .fontSize(9)
            .fillColor("#555555")
            .text(safeArtist, infoBlockX, textY + 12, {
              width: maxInfoWidth,
              height: 11,
              lineBreak: false,
              ellipsis: true,
            });

          currentY += 34;

          if (i % 50 === 0 || i === songs.length - 1) {
            const currentCount = i + 1;
            BrowserWindow.getAllWindows().forEach((w) =>
              w.webContents.send("songbook-export-progress", {
                phase: "Generating PDF...",
                current: currentCount,
                total: songs.length,
                percentage: Math.round((currentCount / songs.length) * 100),
              }),
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        doc.end();
      };

      processSongs().catch((err) => {
        logger.error("SYSTEM", `PDF Loop Error: ${err.message}`);
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("songbook-export-complete", {
            success: false,
            reason: err.message,
          }),
        );
      });

      stream.on("finish", () => {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("songbook-export-complete", { success: true }),
        );
      });
      stream.on("error", (err) => {
        logger.error("SYSTEM", `PDF Stream Error: ${err.message}`);
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("songbook-export-complete", {
            success: false,
            reason: err.message,
          }),
        );
      });
    } catch (err) {
      logger.error("SYSTEM", `PDF Generation crashed: ${err.message}`);
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send("songbook-export-complete", {
          success: false,
          reason: err.message,
        }),
      );
    }
  });

  ipcMain.on("songbook-export-complete", (event, data) => {
    isSongbookBuildActive = false;
  });

  ipcMain.handle("get-update-servers", () => activeUpdateServers);
  ipcMain.handle(
    "sync-library",
    async (event, { serverIp, serverPort, libraryPath }) => {
      try {
        if (!fs.existsSync(libraryPath)) {
          fs.mkdirSync(libraryPath, { recursive: true });
        }

        const syncCacheDir = path.join(userData, "SyncCache");
        if (!fs.existsSync(syncCacheDir))
          fs.mkdirSync(syncCacheDir, { recursive: true });

        const libPathHash = crypto
          .createHash("md5")
          .update(libraryPath)
          .digest("hex");
        const hashCachePath = path.join(
          syncCacheDir,
          `hashes-${libPathHash}.json`,
        );

        let hashCache = {};
        let cacheDirty = false;

        if (fs.existsSync(hashCachePath)) {
          try {
            hashCache = JSON.parse(fs.readFileSync(hashCachePath, "utf8"));
          } catch (e) {
            logger.warn(
              "SYNC",
              "Failed to parse local hash cache, generating a new one.",
            );
          }
        }

        logger.info(
          "SYNC",
          `Fetching file list from ${serverIp}:${serverPort}...`,
        );
        const res = await fetch(`http://${serverIp}:${serverPort}/files`);
        const remoteFiles = await res.json();

        const toDownload = [];

        logger.info("SYNC", `Validating ${remoteFiles.length} files...`);
        for (let i = 0; i < remoteFiles.length; i++) {
          const rFile = remoteFiles[i];
          const localFilePath = path.join(libraryPath, rFile.name);

          event.sender.send("sync-progress", {
            status: "validating",
            current: i + 1,
            total: remoteFiles.length,
            filename: `Validating: ${rFile.name}`,
          });

          if (!fs.existsSync(localFilePath)) {
            toDownload.push(rFile);
          } else {
            const stat = fs.statSync(localFilePath);
            let localCrc;

            if (
              hashCache[rFile.name] &&
              hashCache[rFile.name].mtime === stat.mtimeMs
            ) {
              localCrc = hashCache[rFile.name].crc32;
            } else {
              localCrc = await calculateFileCRC32(localFilePath);
              hashCache[rFile.name] = { mtime: stat.mtimeMs, crc32: localCrc };
              cacheDirty = true;
            }

            if (localCrc !== rFile.crc32) {
              logger.warn("SYNC", `CRC mismatch for ${rFile.name}`);
              toDownload.push(rFile);
            }
          }
        }

        if (toDownload.length === 0) {
          if (cacheDirty)
            fs.writeFileSync(hashCachePath, JSON.stringify(hashCache, null, 2));
          return {
            success: true,
            message: "Library is completely up to date!",
          };
        }

        logger.info(
          "SYNC",
          `${toDownload.length} files need syncing. Starting download...`,
        );
        for (let i = 0; i < toDownload.length; i++) {
          const fileToGet = toDownload[i];
          const safeName = fileToGet.name.replace(/\\/g, "/");

          event.sender.send("sync-progress", {
            status: "downloading",
            current: i + 1,
            total: toDownload.length,
            filename: `Downloading: ${safeName}`,
            fileLoadedBytes: 0,
            fileTotalBytes: 0,
          });

          const fileUrl = `http://${serverIp}:${serverPort}/file?path=${encodeURIComponent(safeName)}`;
          const localFilePath = path.join(libraryPath, safeName);
          const dir = path.dirname(localFilePath);

          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          await new Promise((resolve, reject) => {
            const req = http
              .get(fileUrl, { timeout: 15000 }, (response) => {
                if (response.statusCode !== 200) {
                  return reject(
                    new Error(
                      `Failed to get '${safeName}' (Status: ${response.statusCode})`,
                    ),
                  );
                }

                const fileTotalBytes = parseInt(
                  response.headers["content-length"] || "0",
                  10,
                );
                let fileLoadedBytes = 0;
                let lastIpcTime = 0;

                const fileStream = fs.createWriteStream(localFilePath);

                response.on("data", (chunk) => {
                  fileLoadedBytes += chunk.length;
                  const now = Date.now();

                  if (
                    now - lastIpcTime > 50 ||
                    fileLoadedBytes === fileTotalBytes
                  ) {
                    lastIpcTime = now;
                    event.sender.send("sync-progress", {
                      status: "downloading",
                      current: i + 1,
                      total: toDownload.length,
                      filename: `Downloading: ${safeName}`,
                      fileLoadedBytes,
                      fileTotalBytes,
                    });
                  }
                });

                response.pipe(fileStream);
                fileStream.on("finish", () => {
                  fileStream.close();
                  resolve();
                });
              })
              .on("error", reject);

            req.on("timeout", () => {
              req.abort();
              reject(
                new Error(
                  `Timeout getting '${safeName}' - Server disconnected.`,
                ),
              );
            });
          });

          const newStat = fs.statSync(localFilePath);
          hashCache[safeName] = {
            mtime: newStat.mtimeMs,
            crc32: fileToGet.crc32,
          };
          cacheDirty = true;
        }

        if (cacheDirty) {
          fs.writeFileSync(hashCachePath, JSON.stringify(hashCache, null, 2));
        }

        return {
          success: true,
          message: `Successfully synced ${toDownload.length} files.`,
        };
      } catch (error) {
        logger.error("SYNC", `Sync failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  let libraryManagerWin = null;
  let isSongbookBuildActive = false;

  ipcMain.on("open-library-manager", () => {
    if (libraryManagerWin) {
      libraryManagerWin.focus();
      return;
    }

    libraryManagerWin = new BrowserWindow({
      title: "Encore Library Manager",
      width: 1000,
      height: 700,
      ...(process.platform === "darwin"
        ? {}
        : { icon: path.join(__dirname, "resources/icon.png") }),
      frame: process.platform !== "darwin" ? false : true,
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      trafficLightPosition: { x: 14, y: 19 },
      backgroundColor: "#080810",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    libraryManagerWin.loadURL(
      `file://${__dirname}/resources/library-manager.html?platform=${process.platform}`,
    );

    libraryManagerWin.on("closed", () => {
      if (isSongbookBuildActive) {
        logger.info(
          "SYSTEM",
          "Library Manager closed. Cancelling songbook build...",
        );
        isSongbookBuildActive = false;
        if (appViewWebContents && !appViewWebContents.isDestroyed()) {
          logger.info("SYSTEM", "Sending cancel-songbook-build to appView");
          appViewWebContents.send("cancel-songbook-build");
        } else {
          logger.warn("SYSTEM", "appViewWebContents is not available");
        }
      }
      libraryManagerWin = null;
    });
  });

  ipcMain.handle("libmgr-get-config", () => {
    const knownPaths = Config.getItem("knownLibraries") || [];
    const libraries = [];

    for (const libPath of knownPaths) {
      const manifestPath = path.join(libPath, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          libraries.push({ path: libPath, manifest });
        } catch (e) {
          libraries.push({
            path: libPath,
            manifest: {
              title: "Invalid Library",
              description: "Corrupt manifest.json",
            },
          });
        }
      }
    }

    return {
      active: Config.getItem("libraryPath"),
      libraries: libraries,
    };
  });

  ipcMain.handle("libmgr-scan-drives", async () => {
    try {
      const disks = await si.fsSize();
      const mountPoints = [...new Set(disks.map((d) => d.mount))];
      let known = Config.getItem("knownLibraries") || [];
      let foundCount = 0;

      for (const mount of mountPoints) {
        let checkPath = path.join(mount, "EncoreLibrary").replace(/\\/g, "/");
        if (!checkPath.endsWith("/")) checkPath += "/";

        if (
          fs.existsSync(path.join(checkPath, "manifest.json")) &&
          !known.includes(checkPath)
        ) {
          known.push(checkPath);
          foundCount++;
        }
      }

      Config.setItem("knownLibraries", known);
      return foundCount;
    } catch (e) {
      return 0;
    }
  });

  ipcMain.handle("libmgr-add-library", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Select or Create Encore Library Folder",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled) return null;

    let folderPath = result.filePaths[0].replace(/\\/g, "/");
    if (!folderPath.endsWith("/")) folderPath += "/";

    const manifestPath = path.join(folderPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      const folderName = path.basename(path.dirname(folderPath));
      const defaultManifest = {
        title: `${folderName} (Custom Library)`,
        description: "A custom library created via Encore Library Manager.",
        additionalContents: { bgvCategories: [], bumperImages: [] },
      };
      fs.writeFileSync(manifestPath, JSON.stringify(defaultManifest, null, 2));
    }

    let known = Config.getItem("knownLibraries") || [];
    if (!known.includes(folderPath)) {
      known.push(folderPath);
      Config.setItem("knownLibraries", known);
    }

    return folderPath;
  });

  ipcMain.on("libmgr-open-folder", (event, targetPath) => {
    if (fs.existsSync(targetPath)) shell.openPath(targetPath);
  });

  ipcMain.handle("libmgr-get-library-contents", async (event, folderPath) => {
    try {
      const files = await fs.promises.readdir(folderPath);
      const allowedExts = [
        ".mp3",
        ".wav",
        ".m4a",
        ".mid",
        ".kar",
        ".mp4",
        ".mkv",
        ".webm",
        ".avi",
      ];
      const songs = files.filter((f) =>
        allowedExts.includes(path.extname(f).toLowerCase()),
      );
      return songs;
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle("libmgr-select-bgv-files", async (event, folderPath) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Select Background Videos",
      defaultPath: folderPath,
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Videos and Images",
          extensions: [
            "mp4",
            "mkv",
            "webm",
            "avi",
            "mov",
            "png",
            "jpg",
            "jpeg",
            "webp",
          ],
        },
      ],
    });

    if (result.canceled) return { relativePaths: [], outsideCount: 0 };

    const relativePaths = [];
    let outsideCount = 0;

    for (const filePath of result.filePaths) {
      const normalizedFile = filePath.replace(/\\/g, "/");
      const normalizedFolder = folderPath.replace(/\\/g, "/");

      if (normalizedFile.startsWith(normalizedFolder)) {
        let relPath = normalizedFile.substring(normalizedFolder.length);
        if (relPath.startsWith("/")) relPath = relPath.substring(1);
        relativePaths.push(relPath);
      } else {
        outsideCount++;
      }
    }
    return { relativePaths, outsideCount };
  });

  ipcMain.handle("libmgr-update-manifest", (event, payload) => {
    try {
      if (!payload || !payload.folderPath) {
        return { success: false, error: "No folder path provided." };
      }

      const { folderPath, manifestData } = payload;
      const manifestPath = path.join(folderPath, "manifest.json");

      if (!fs.existsSync(manifestPath)) {
        return {
          success: false,
          error: "manifest.json does not exist at the target path.",
        };
      }

      fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2));
      return { success: true };
    } catch (e) {
      logger.error(
        "SYSTEM",
        `Failed to save manifest at ${payload?.folderPath}: ${e.message}`,
      );
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("libmgr-remove-library", async (event, folderPath) => {
    let known = Config.getItem("knownLibraries") || [];
    known = known.filter((p) => p !== folderPath);
    Config.setItem("knownLibraries", known);
    if (Config.getItem("libraryPath") === folderPath)
      Config.setItem("libraryPath", null);
    return { success: true };
  });

  ipcMain.handle("libmgr-set-active", async (event, folderPath) => {
    const safeStates = ["Main Menu", "Booting up...", null, undefined, ""];
    if (!safeStates.includes(currentRPCState)) {
      return {
        success: false,
        reason: "Cannot change libraries while a song is playing.",
      };
    }
    Config.setItem("libraryPath", folderPath);
    const mainWin = BrowserWindow.getAllWindows().find(
      (w) => w !== libraryManagerWin,
    );
    if (mainWin) {
      const view = mainWin.contentView.children[0];
      if (view) view.webContents.reload();
    }
    return { success: true };
  });

  ipcMain.handle("save-songbook-cache", async (event, payload) => {
    try {
      if (!payload || !payload.libraryPath) {
        return { success: false, error: "No library path provided." };
      }

      const { libraryPath, songList, newSongs, signature } = payload;
      const cachePath = path.join(libraryPath, "songdb.json");

      const cacheData = JSON.stringify(
        { signature, songList, newSongs },
        null,
        2,
      );
      await fs.promises.writeFile(cachePath, cacheData, "utf8");

      logger.info("SYSTEM", `Successfully embedded cache to ${cachePath}`);
      return { success: true };
    } catch (e) {
      logger.error("SYSTEM", `Failed to save embedded cache: ${e.message}`);
      return { success: false, error: e.message };
    }
  });

  ipcMain.on("setRPC", (event, arg) => {
    currentRPCState = arg.state;

    const activityPayload = {
      state: arg.state,
      details: arg.details,
      largeImageKey: "hoshi",
      largeImageText: "Encore Karaoke",
    };

    if (arg.startTimestamp) activityPayload.startTimestamp = arg.startTimestamp;
    if (arg.endTimestamp) activityPayload.endTimestamp = arg.endTimestamp;

    if (arg.joinSecret) {
      activityPayload.partyId = arg.partyId;
      activityPayload.partySize = arg.partySize;
      activityPayload.partyMax = arg.partyMax;
      activityPayload.joinSecret = arg.joinSecret;
      activityPayload.instance = true;
    }

    if (arg.button1 && !arg.joinSecret) {
      activityPayload.buttons = [
        { label: arg.button1.label, url: arg.button1.url },
      ];
    }

    discordClient.user?.setActivity(activityPayload);

    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.webContents.send("update-now-playing", arg);
  });

  const knownRemotes = {};

  cloudSocket.on("remote-connected", ({ identity }) => {
    logger.info("LINK", `Cloud Remote connected: ${identity}`);
    knownRemotes[identity] = {
      connectedAt: new Date().toISOString(),
      type: "cloud",
    };
    io.to("karaoke-app").emit("join", { type: "remote", identity });
  });

  cloudSocket.on("remote-command", (payload) => {
    logger.debug(
      "LINK",
      `Cloud Command from ${payload.identity}: ${JSON.stringify(payload.data)}`,
    );
    io.to("karaoke-app").emit("execute-command", payload);
  });

  cloudSocket.on("remote-disconnected", ({ identity }) => {
    logger.info("LINK", `Cloud Remote disconnected: ${identity}`);
    delete knownRemotes[identity];
    io.to("karaoke-app").emit("leave", { type: "remote", identity });
  });

  io.on("connection", async (socket) => {
    const clientType = socket.handshake.query.clientType;

    if (clientType === "app") {
      logger.info("LINK", "Main App connected to Socket");
      socket.join("karaoke-app");
      socket.emit("remotes", knownRemotes);

      socket.on("sendData", (msg) => {
        if (msg.identity && msg.identity.startsWith("cloud_")) {
          const actualSocketId = msg.identity.replace("cloud_", "");
          cloudSocket.emit("host-response", {
            identity: actualSocketId,
            data: msg.data,
          });
        } else {
          io.to(msg.identity).emit("fromRemote", msg.data);
        }
      });
      socket.on("broadcastData", (msg) => {
        socket.broadcast.emit("fromRemote", msg);
        cloudSocket.emit("host-broadcast", msg);
      });
      return;
    }

    if (clientType === "remote") {
      logger.info("LINK", `Local Remote connected: ${socket.id}`);
      io.to("karaoke-app").emit("join", {
        type: clientType,
        identity: socket.id,
      });
      knownRemotes[socket.id] = {
        connectedAt: new Date().toISOString(),
        type: "local",
      };
      socket.on("remote-command", (data) => {
        logger.debug(
          "LINK",
          `Local Command from ${socket.id}: ${JSON.stringify(data)}`,
        );
        io.to("karaoke-app").emit("execute-command", {
          identity: socket.id,
          data,
        });
      });
      socket.on("disconnect", () => {
        logger.info("LINK", `Local Remote disconnected: ${socket.id}`);
        io.to("karaoke-app").emit("leave", {
          type: clientType,
          identity: socket.id,
        });
        delete knownRemotes[socket.id];
      });
      return;
    }
  });

  let tryPort = 9864;

  serverHttp.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.warn(
        "SERVER",
        `Port ${tryPort} is in use. Trying ${tryPort + 1}...`,
      );
      tryPort++;
      serverHttp.listen(tryPort);
    } else {
      logger.error("SERVER", `Server error: ${err.message}`);
    }
  });

  serverHttp.on("listening", () => {
    PORT = serverHttp.address().port;
    instance.publish({
      name: bonjourId,
      type: "enmoku",
      port: PORT,
      txt: {
        deviceName: os.hostname(),
        versionInformation: `${versionInformation.channel} ${versionInformation.number} (${versionInformation.codename})`,
      },
    });
    instance.find({ type: "enmoku" }, async (service) => {
      if (service.name == bonjourId) {
        logger.info("LINK", "Encore Link is now discoverable");
      }
    });
    logger.info(
      "SERVER",
      `Encore Karaoke server running on stable port ${PORT}`,
    );
    createWindow();
  });

  serverHttp.listen(tryPort);
});

app.on("before-quit", () => {
  if (kioskEnabled && process.platform === "win32") {
    exec("explorer.exe", (error) => {
      if (error) {
        logger.error(
          "SYSTEM",
          "Failed to restart explorer.exe: " + error.message,
        );
      } else {
        logger.info("SYSTEM", "Explorer restarted");
      }
    });
  }
});
