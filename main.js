if (require("electron-squirrel-startup")) app.quit();

const YouTubeCastReceiver = require("yt-cast-receiver");
const youtubesearchapi = require("youtube-search-api");
const { app, BrowserWindow, ipcMain } = require("electron");
const { Client } = require("@xhayper/discord-rpc");
const nodeDiskInfo = require("node-disk-info");
const { Player } = require("yt-cast-receiver");
const { Worker } = require("worker_threads");
const ytdl = require("@distube/ytdl-core");
const { Server } = require("socket.io");
const express = require("express");
const mime = require("mime-types");
const qrcode = require("qrcode");
const dgram = require("dgram");
const path = require("path");
const cors = require("cors");
const http = require("http");
const fs = require("fs");

const port = 9864;
const server = express();
const serverHttp = http.createServer(server);
const io = new Server(serverHttp);

let userData = app.getPath("userData");
console.log("userData", userData);

const configPath = path.join(userData, "karaoke-config.json");

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      karaokeConfig = JSON.parse(data);
      console.log("[CONFIG] Loaded configuration from file");
    } else {
      console.log("[CONFIG] No config file found, using defaults");
    }
  } catch (error) {
    console.error("[CONFIG] Error loading config:", error);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(karaokeConfig, null, 2));
    console.log("[CONFIG] Saved configuration to file");
  } catch (error) {
    console.error("[CONFIG] Error saving config:", error);
  }
}

let karaokeConfig = {
  setupComplete: false,
  libraryPath: "",
  audioConfig: {
    bufferSize: 1024,
    mix: {
      instrumental: {
        outputDevice: null,
        volume: 1,
      },
      vocal: {
        inputDevice: null,
        outputDevice: null,
        volume: 1,
        effects: [
          { plugin: "NoiseGate", params: { threshold_db: -35 } },
          { plugin: "HighpassFilter", params: { cutoff_frequency_hz: 100 } },
          { plugin: "Gain", params: { gain_db: 5 } },
          { plugin: "Compressor", params: { threshold_db: -18, ratio: 3.5 } },
          { plugin: "Gain", params: { gain_db: 7 } },
          {
            plugin: "HighShelfFilter",
            params: { cutoff_frequency_hz: 4438, gain_db: 2.4 },
          },
          {
            plugin: "Reverb",
            params: { room_size: 0.7, wet_level: 0.15 },
          },
          {
            plugin: "PeakFilter",
            params: { cutoff_frequency_hz: 676, gain_db: -2.5 },
          },
        ],
      },
    },
  },
};

loadConfig();

let local_ip = null;
const s = dgram.createSocket("udp4");
s.connect(80, "8.8.8.8", () => {
  local_ip = s.address().address;
  console.log("[SERVER] Fetched local IP");
  s.close();
});

server.use(express.static("resources/static"));
server.use(express.json());
server.use(cors());

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    icon: "icon.png",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadURL(`http://127.0.0.1:${port}/index.html`);

  win.webContents.on("devtools-opened", () => {
    const css = `
    :root {
        --sys-color-base: var(--ref-palette-neutral100);
        --source-code-font-family: consolas;
        --source-code-font-size: 12px;
        --monospace-font-family: consolas;
        --monospace-font-size: 12px;
        --default-font-family: system-ui, sans-serif;
        --default-font-size: 12px;
    }
    .-theme-with-dark-background {
        --sys-color-base: var(--ref-palette-secondary25);
    }
    body {
        --default-font-family: system-ui,sans-serif;
    }`;
    win.webContents.devToolsWebContents.executeJavaScript(`
    const overriddenStyle = document.createElement('style');
    overriddenStyle.innerHTML = '${css.replaceAll("\n", " ")}';
    document.body.append(overriddenStyle);
    document.body.classList.remove('platform-windows');`);
  });
};

class SocketPlayer extends Player {
  constructor(socket) {
    super();
    this.socket = socket;
    this.volume = { level: 100, muted: false };
    this.position = 0;
    this.duration = 0;
  }
  doPause() {
    return new Promise((resolve, reject) => {
      console.log("pause");
      this.socket.emit("pause");
      resolve(true);
    });
  }
  doPlay(video, position) {
    return new Promise((resolve, reject) => {
      console.log("play", video);
      this.position = 0;
      this.socket.emit("play", video);
      resolve(true);
    });
  }
  doResume() {
    return new Promise((resolve, reject) => {
      console.log("resume");
      this.socket.emit("resume");
      resolve(true);
    });
  }
  doStop() {
    return new Promise((resolve, reject) => {
      console.log("stop");
      this.position = 0;
      this.socket.emit("stop");
      resolve(true);
    });
  }
  doSeek(position) {
    return new Promise((resolve, reject) => {
      console.log("seek", position);
      this.position = position;
      this.socket.emit("seek", position);
      resolve(true);
    });
  }
  doSetVolume(volume) {
    return new Promise((resolve, reject) => {
      console.log("volume", volume);
      this.volume = volume;
      this.socket.emit("volume", volume);
      resolve(true);
    });
  }
  doGetVolume() {
    return new Promise((resolve, reject) => {
      resolve(this.volume);
    });
  }
  doGetPosition() {
    return new Promise((resolve, reject) => {
      resolve(this.position);
    });
  }
  doGetDuration() {
    return new Promise((resolve, reject) => {
      resolve(this.duration);
    });
  }
  setDuration(duration) {
    // console.log(duration);
    this.duration = duration;
  }
  setPosition(position) {
    // console.log(position);
    this.position = position;
  }
  setVolume(volume) {
    this.volume = volume;
    return new Promise((resolve, reject) => {
      console.log("volume", volume);
      this.socket.emit("volume", volume);
      resolve(true);
    });
  }
  resetPosition() {
    this.position = 0;
  }
}

let client = new Client({
  clientId: "1408795513397973052",
});

client.on("ready", () => {
  console.log("[DISCORD] Encore Karaoke is ready!");
  client.user?.setActivity({
    details: "Booting up...",
    largeImageKey: "hoshi",
    largeImageText: "Encore Karaoke",
  });
});

let reconnectionAttempts = 0,
  isReconnecting = false;
client.on("disconnected", () => {
  if (isReconnecting) {
    console.log(
      "[DISCORD] Not attempting to reconnect while another reconnection attempt is in progress.",
    );
    return;
  }
  console.log(
    "[DISCORD] Discord IPC disconnected. Reconnecting in 15 seconds...",
  );

  isReconnecting = true;
  let interval = setInterval(() => {
    reconnectionAttempts++;
    console.log(`[DISCORD] Trying to reconnect... ${reconnectionAttempts}/3`);
    client.destroy();
    client = new Client({
      clientId: "1408795513397973052",
    });
    if (reconnectionAttempts === 3) {
      console.log(
        "[DISCORD] Not reconnecting after 3 failed connection attempts.",
      );
      clearInterval(interval);
      reconnectionAttempts = 0;
      isReconnecting = false;
    }
  }, 15_000);
});

app.whenReady().then(() => {
  client.login();

  // Add IPC handlers for config
  ipcMain.handle("getConfig", () => karaokeConfig);
  ipcMain.on("updateConfig", (event, newConfig) => {
    karaokeConfig = newConfig;
    saveConfig();
  });

  io.on("connection", async (socket) => {
    // --- START: Added for Encore Link ---
    const clientType = socket.handshake.query.clientType;

    if (clientType === "app") {
      console.log("[LINK] Main App connected.");
      socket.join("karaoke-app"); // The app joins a room
      socket.on("disconnect", () => {
        console.log("[LINK] Main App disconnected.");
      });
      return; // Don't proceed to YouTubeCastReceiver setup for the app's link connection
    }

    if (clientType === "remote") {
      console.log("[LINK] Remote connected.");
      socket.on("remote-command", (data) => {
        console.log("[LINK] Received command from remote:", data);
        // Send command to the 'karaoke-app' room
        io.to("karaoke-app").emit("execute-command", data);
      });
      socket.on("disconnect", () => {
        console.log("[LINK] Remote disconnected.");
      });
      return; // Don't proceed to YouTubeCastReceiver setup for remotes
    }
    // --- END: Added for Encore Link ---

    // --- Existing YouTubeCastReceiver logic ---
    console.log("connection attempt");
    const details = socket.handshake.auth;
    if (!details || !details.name) {
      console.log(
        "Connection rejected: Not a remote/app and no YT Cast auth details.",
      );
      socket.disconnect();
      return;
    }

    const player = new SocketPlayer(socket);
    const receiver = new YouTubeCastReceiver(player, {
      device: {
        name: details.name,
        screenName: details.screenName,
        brand: details.brand,
        model: details.model,
      },
    });
    receiver.on("senderConnect", (sender) => {
      socket.emit("clientConnected", sender);
    });
    receiver.on("senderDisconnect", (sender) => {
      socket.emit("clientDisconnect", sender);
    });
    try {
      await receiver.start();
      socket.emit("success");
    } catch (error) {
      socket.emit("error", error);
    }

    socket.on("volume", (volume) => {
      player.setVolume({ level: volume, muted: false });
    });
    socket.on("duration", (duration) => {
      player.setDuration(duration);
    });
    socket.on("position", (position) => {
      player.setPosition(position);
    });
    socket.on("finishedPlaying", async () => {
      player.resetPosition();
      await player.pause();
      await player.next();
    });
    socket.on("disconnect", async () => {
      console.log("App disconnected, closing receiver");
      try {
        await receiver.stop();
      } catch (error) {
        console.log("How the fuck does it have an error here!???");
        console.log(error);
      }
    });
  });

  server.get("/local_ip", (req, res) => {
    res.send(local_ip);
  });
  server.get("/qr", (req, res) => {
    qrcode.toDataURL(req.query["url"], (err, url) => {
      const buffer = Buffer.from(url.split(",")[1], "base64");
      res.setHeader("content-type", "image/png");
      res.send(buffer);
    });
  });
  server.get("/drives", (req, res) => {
    console.log("[FILE] Requesting drives");
    nodeDiskInfo
      .getDiskInfo()
      .then((disks) => {
        let driveNames = [];
        disks.forEach((disk) => {
          driveNames.push(disk.mounted);
        });
        res.json(driveNames);
      })
      .catch((reason) => {
        res.status(500).send(reason);
      });
  });
  server.post("/list", (req, res) => {
    const dir = req.body.dir;
    console.log("[FILE] Requested directory:", dir);

    if (!dir) {
      return res
        .status(400)
        .json({ error: true, error_msg: "Please provide a directory path!" });
    }

    fs.stat(dir, (err, stats) => {
      if (err) {
        return res
          .status(400)
          .json({ error: true, error_msg: "Error accessing directory!" });
      }

      if (stats.isFile()) {
        return res
          .status(400)
          .json({ error: true, error_msg: "This is a file!" });
      }

      fs.readdir(dir, async (err, files) => {
        if (err) {
          return res
            .status(400)
            .json({ error: true, error_msg: "Error reading directory!" });
        }

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
          } catch (error) {
            console.error(`Error reading file ${file}: ${error.message}`);
          }
        }

        res.json(respData);
      });
    });
  });
  server.get("/getFile", (req, res) => {
    const fPath = req.query.path;
    console.log("[FILE] Requested file:", fPath);

    if (!fPath) {
      return res
        .status(400)
        .json({ error: true, error_msg: "Please provide a file path!" });
    }

    fs.stat(fPath, (err, stats) => {
      if (err) {
        return res
          .status(400)
          .json({ error: true, error_msg: "Error accessing file!" });
      }

      if (stats.isDirectory()) {
        return res
          .status(400)
          .json({ error: true, error_msg: "This is a directory!" });
      }

      // Changed: allow files with unknown mime types to be served as text
      let mimeType = mime.lookup(fPath);
      if (!mimeType) {
        console.log(
          `[FILE] Unknown mime type for "${fPath}", defaulting to text/plain`,
        );
        mimeType = "text/plain; charset=utf-8";
      }

      res.sendFile(fPath, { headers: { "Content-Type": mimeType } });
    });
  });
  server.get("/yt-search", async (req, res) => {
    const searchTerm = req.query.q;
    console.log(`[YouTube] Searching for ${searchTerm}...`);
    let results = await youtubesearchapi.GetListByKeyword(searchTerm, false);
    res.status(200).json(results);
  });

  server.use(express.static("public"));
  serverHttp.listen(port, () => {
    console.log(`[SERVER] Encore Karaoke server listening on port ${port}`);
    createWindow();
  });

  // Electron IPC
  ipcMain.on("setRPC", (event, arg) => {
    client.user?.setActivity({
      state: arg.state,
      details: arg.details,
      endTimestamp: arg.endTimestamp,
      largeImageKey: "hoshi",
      largeImageText: "Encore Karaoke",
      buttons: arg.button1 && [
        {
          label: arg.button1.label,
          url: arg.button1.url,
        },
      ],
    });
  });
});
