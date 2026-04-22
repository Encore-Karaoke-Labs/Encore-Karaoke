if (require("electron-squirrel-startup")) app.quit();

const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dgram = require("dgram");
const { exec } = require("child_process");

const Bonjour = require("bonjour-service").Bonjour;
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const qrcode = require("qrcode");

const { setVolume, getVolume } = require("loudness");

const KuromojiAnalyzer = require("kuroshiro-analyzer-kuromoji");
const Kuroshiro = require("kuroshiro").default;
const youtubesearchapi = require("youtube-search-api");
const si = require("systeminformation");
const mime = require("mime-types");

const { Client } = require("@xhayper/discord-rpc");
const Config = require("./config-manager");

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

// Initialization
const versionInformation = {
  number: "1.2.0",
  channel: "BETA",
  codename: "Virgo",
};

const kioskEnabled = process.argv.includes("--kiosk");
const isDev = process.argv.includes("--dev");

const PORT = 9864;
const server = express();
const serverHttp = http.createServer(server);
const io = new Server(serverHttp);
const instance = new Bonjour();
const bonjourId = `encore-link-${crypto.randomUUID()}`;

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
  discordClient.on("ready", () => {
    logger.info("DISCORD", "Encore Karaoke RPC is ready!");
    rpcReconnAttempts = 0;
    discordClient.user?.setActivity({
      details: currentRPCState,
      largeImageKey: "hoshi",
      largeImageText: "Encore Karaoke",
    });
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
server.use(express.static("resources/static"));
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
    const videoExts = [".mp4", ".mkv", ".webm", ".avi", ".mov"];

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
let zoomFactor = Config.getItem("zoomLevel") || 0.75;

// Main App Startup
const createWindow = () => {
  const win = new BrowserWindow({
    title: `Encore Karaoke ${versionInformation.channel} ${versionInformation.number} (${versionInformation.codename})`,
    width: 1280,
    height: 752,
    icon: "resources/icon.png",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: { x: 14, y: 20 },
    backgroundColor: "#000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      spellcheck: false,
    },
  });

  const appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.contentView.addChildView(appView);

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
  win.on("enter-full-screen", updateBounds);
  win.on("leave-full-screen", updateBounds);
  win.on("restore", () => setTimeout(updateBounds, 50));
  win.on("show", () => setTimeout(updateBounds, 50));
  updateBounds();

  win.loadURL(
    `file://${__dirname}/resources/titlebar.html?platform=${process.platform}`,
  );
  appView.webContents.loadURL(`http://127.0.0.1:${PORT}/index.html`);
  appView.webContents.setZoomFactor(zoomFactor);

  const resetZoom = () => {
    zoomFactor = 1;
    Config.setItem("zoomFactor", zoomFactor);
    appView.webContents.setZoomFactor(zoomFactor);
    return;
  };

  const addZoom = () => {
    zoomFactor = zoomFactor + 0.15;
    Config.setItem("zoomFactor", zoomFactor);
    appView.webContents.setZoomFactor(zoomFactor);
    return;
  };

  const reduceZoom = () => {
    if (zoomFactor > 0.26) {
      zoomFactor = zoomFactor - 0.15;
      Config.setItem("zoomFactor", zoomFactor);
      appView.webContents.setZoomFactor(zoomFactor);
    }
    return;
  };

  const reloadPage = () => {
    if (!kioskEnabled) appView.webContents.reload();
  };

  win.on("focus", () => {
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

app.whenReady().then(() => {
  setupDiscordRPC();
  discordClient
    .login()
    .catch((e) => logger.error("DISCORD", "Initial login failed"));

  const CLOUD_URL = "https://olive.nxw.pw:8443";
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
  });
  cloudSocket.on("connect_error", (err) => {
    logger.error(
      "CLOUD",
      `Connection to relay failed: ${err.message}. Will retry.`,
    );
    activeRoomCode = null;
  });

  server.get("/cloud_info", (req, res) => {
    if (!activeRoomCode) {
      return res
        .status(503)
        .json({ error: "Cloud relay not connected. Please wait." });
    }
    res.json({
      relayUrl: "https://link.encorekaraoke.org",
      roomCode: activeRoomCode,
    });
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
  ipcMain.handle("romanize", async (event, rawJapanese) => {
    const romaji = await kuroshiro.convert(rawJapanese, {
      to: "romaji",
      mode: "spaced",
    });
    return romaji;
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

  ipcMain.on("open-library-manager", () => {
    if (libraryManagerWin) {
      libraryManagerWin.focus();
      return;
    }

    libraryManagerWin = new BrowserWindow({
      title: "Encore Library Manager",
      width: 1000,
      height: 700,
      icon: "resources/icon.png",
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
        { name: "Videos", extensions: ["mp4", "mkv", "webm", "avi", "mov"] },
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

  ipcMain.on("setRPC", (event, arg) => {
    currentRPCState = arg.state;
    discordClient.user?.setActivity({
      state: arg.state,
      details: arg.details,
      endTimestamp: arg.endTimestamp,
      largeImageKey: "hoshi",
      largeImageText: "Encore Karaoke",
      buttons: arg.button1 && [
        { label: arg.button1.label, url: arg.button1.url },
      ],
    });
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

  serverHttp.listen(PORT, () => {
    let actualPort = serverHttp.address().port;
    instance.publish({
      name: bonjourId,
      type: "enmoku",
      port: actualPort,
    });
    instance.find({ type: "enmoku" }, async (service) => {
      if (service.name == bonjourId) {
        logger.info("LINK", "Encore Link is now discoverable");
      }
    });
    logger.info(
      "SERVER",
      `Encore Karaoke server running on port ${actualPort}`,
    );
    createWindow();
  });
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
