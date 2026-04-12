if (require("electron-squirrel-startup")) app.quit();

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dgram = require("dgram");
const { exec } = require("child_process");

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
    console.log(`[${new Date().toLocaleTimeString()}] [INFO] [${tag}] ${msg}`),
  warn: (tag, msg) =>
    console.warn(`[${new Date().toLocaleTimeString()}] [WARN] [${tag}] ${msg}`),
  error: (tag, msg) =>
    console.error(
      `[${new Date().toLocaleTimeString()}] [ERR ] [${tag}] ${msg}`,
    ),
  debug: (tag, msg) =>
    console.log(`[${new Date().toLocaleTimeString()}] [DBUG] [${tag}] ${msg}`),
};

// Initialization
const versionInformation = {
  number: "1.1.0",
  channel: "BETA",
  codename: "Virgo",
};

const kioskEnabled = process.argv.includes("--kiosk");

const PORT = 9864;
const server = express();
const serverHttp = http.createServer(server);
const io = new Server(serverHttp);

const kuroshiro = new Kuroshiro();
kuroshiro.init(new KuromojiAnalyzer());

const userData = app.getPath("userData");
logger.info("SYSTEM", `User Data Path: ${userData}`);
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

function setupDiscordRPC() {
  discordClient.on("ready", () => {
    logger.info("DISCORD", "Encore Karaoke RPC is ready!");
    rpcReconnAttempts = 0;
    discordClient.user?.setActivity({
      details: "Booting up...",
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
server.use(express.static("public"));
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

server.get("/romanize", async (req, res) => {
  res.send(
    await kuroshiro.convert(req.query.t, { to: "romaji", mode: "spaced" }),
  );
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

// Main App Startup
const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 752,
    icon: "resources/icon.png",
    autoHideMenuBar: true,
    thickFrame: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.setBackgroundColor("#000");
  win.loadURL(`http://127.0.0.1:${PORT}/index.html`);
  if (kioskEnabled) {
    win.setKiosk(true);
    win.setAlwaysOnTop(true);
    if (process.platform === "win32") {
      exec("taskkill /f /im explorer.exe", (error) => {
        if (error) {
          logger.error(
            "SYSTEM",
            "Failed to kill explorer.exe: " + error.message,
          );
        } else {
          logger.info("SYSTEM", "Explorer killed for kiosk mode");
        }
      });
    }
  }

  win.webContents.on("devtools-opened", () => {
    const css = `:root { --sys-color-base: var(--ref-palette-neutral100); } .-theme-with-dark-background { --sys-color-base: var(--ref-palette-secondary25); } body { --default-font-family: system-ui,sans-serif; }`;
    win.webContents.devToolsWebContents.executeJavaScript(
      `const s = document.createElement('style'); s.innerHTML = '${css.replaceAll("\n", " ")}'; document.body.append(s); document.body.classList.remove('platform-windows');`,
    );
  });
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
  ipcMain.on("setRPC", (event, arg) => {
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
    logger.info("SERVER", `Encore Karaoke server running on port ${PORT}`);
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
