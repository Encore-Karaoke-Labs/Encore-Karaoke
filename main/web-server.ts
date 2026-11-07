import type { Bonjour } from "bonjour-service";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import crypto from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import mime from "mime-types";
import qrcode from "qrcode";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import si from "systeminformation";
import youtubesearchapi from "youtube-search-api";
import { appState } from "./state";
import { logger } from "./logger";
import { versionInformation } from "./runtime";
import type { OverlayHub } from "./overlays";
import type { RemoteInfo } from "./types";

const CLOUD_URL = "https://olive.nxw.pw:8443";
const RELAY_URL = "https://enmoku.encorekaraoke.org/1.11.0/";

export class WebServer {
  private readonly server: Express = express();
  private readonly serverHttp = http.createServer(this.server);
  private readonly io = new SocketIOServer(this.serverHttp);
  private readonly bonjourId = `encore-link-${crypto.randomUUID()}`;
  private readonly knownRemotes: Record<string, RemoteInfo> = {};
  private localIp: string | null = null;
  private activeRoomCode: string | null = null;
  private cloudSocket: ClientSocket | null = null;
  private tryPort = 9864;
  private started = false;

  private readonly bonjour: Bonjour;
  private readonly overlayHub: OverlayHub;

  public constructor(bonjour: Bonjour, overlayHub: OverlayHub) {
    this.bonjour = bonjour;
    this.overlayHub = overlayHub;
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.registerMiddleware();
    this.registerRoutes();
    this.detectLocalIp();
    this.setupCloudRelay();
    this.registerSocketRelay();
    this.overlayHub.registerRoutes(this.server);

    return new Promise<void>((resolve) => {
      this.serverHttp.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          logger.warn(
            "SERVER",
            `Port ${this.tryPort} is in use. Trying ${this.tryPort + 1}...`,
          );
          this.tryPort++;
          this.serverHttp.listen(this.tryPort);
        } else {
          logger.error("SERVER", `Server error: ${err.message}`);
        }
      });

      this.serverHttp.on("listening", () => {
        const address = this.serverHttp.address();
        appState.port =
          typeof address === "object" && address ? address.port : this.tryPort;

        this.bonjour.publish({
          name: this.bonjourId,
          type: "enmoku",
          port: appState.port,
          txt: {
            deviceName: os.hostname(),
            versionInformation: `${versionInformation.channel} ${versionInformation.number} (${versionInformation.codename})`,
          },
        });
        this.bonjour.find({ type: "enmoku" }, (service) => {
          if (service.name === this.bonjourId) {
            logger.info("LINK", "Encore Link is now discoverable");
          }
        });
        logger.info(
          "SERVER",
          `Encore Karaoke server running on stable port ${appState.port}`,
        );
        resolve();
      });

      this.serverHttp.listen(this.tryPort);
    });
  }

  private registerMiddleware(): void {
    this.server.use(express.static(appState.staticAssetsPath));
    this.server.use(express.json());
    this.server.use(cors());
  }

  private verifyFileToken(req: Request, res: Response): boolean {
    const fToken = req.query.token;
    if (!fToken) {
      res.status(403).json({ error: "Provide an access token to continue." });
      return false;
    }
    if (fToken !== appState.fileToken) {
      res.status(403).json({ error: "Invalid access token" });
      return false;
    }
    return true;
  }

  private registerRoutes(): void {
    this.server.get("/local_ip", (_req: Request, res: Response) => {
      res.send(this.localIp);
    });

    this.server.get("/qr", (req: Request, res: Response) => {
      const url = req.query["url"] as string;
      if (!url) {
        res.status(400).send("Missing URL");
        return;
      }
      qrcode.toDataURL(url, (err, dataUrl) => {
        if (err || !dataUrl) {
          res.status(500).send("QR Error");
          return;
        }
        const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
        res.setHeader("content-type", "image/png");
        res.send(buffer);
      });
    });

    this.server.get("/drives", async (req: Request, res: Response) => {
      if (!this.verifyFileToken(req, res)) return;
      logger.debug("FILE", "Requesting drives");
      try {
        const disks = await si.fsSize();
        const mountPoints = [...new Set(disks.map((d) => d.mount))];
        res.json(mountPoints);
      } catch (error) {
        const err = error as Error;
        logger.error("FILE", `Failed to get drives: ${err.message}`);
        res.status(500).send(err.message);
      }
    });

    this.server.get("/user-bgv-list", async (_req: Request, res: Response) => {
      try {
        if (!fs.existsSync(appState.userBGVPath)) {
          res.json([]);
          return;
        }

        const files = await fs.promises.readdir(appState.userBGVPath);
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
          .map((f) => path.join(appState.userBGVPath, f));

        res.json(videos);
      } catch (error) {
        const err = error as Error;
        logger.error("FILE", `Failed to read User BGVs: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    this.server.post("/list", (req: Request, res: Response) => {
      const dir = req.body.dir as string;
      if (!this.verifyFileToken(req, res)) return;
      if (!dir) {
        res
          .status(400)
          .json({ error: true, error_msg: "No directory provided" });
        return;
      }

      fs.stat(dir, (err, stats) => {
        if (err || !stats.isDirectory()) {
          res.status(400).json({ error: true, error_msg: "Invalid directory" });
          return;
        }

        fs.readdir(dir, async (readErr, files) => {
          if (readErr) {
            res.status(400).json({ error: true, error_msg: "Read error" });
            return;
          }

          const respData: Array<{
            name: string;
            type: "file" | "folder";
            created: number;
            modified: number;
          }> = [];

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
            } catch {
              /* Ignore inaccessible files. */
            }
          }
          res.json(respData);
        });
      });
    });

    this.server.get("/getFile", (req: Request, res: Response) => {
      const fPath = req.query.path as string;
      if (!this.verifyFileToken(req, res)) return;
      if (!fPath) {
        res.status(400).json({ error: "No path" });
        return;
      }

      fs.stat(fPath, (err, stats) => {
        if (err || stats.isDirectory()) {
          res.status(400).json({ error: "Invalid file" });
          return;
        }

        if (fPath.endsWith(".lrc")) {
          res.sendFile(fPath, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
          return;
        }

        if (fPath.endsWith(".cho")) {
          res.sendFile(fPath, {
            headers: { "Content-Type": "audio/mpeg" },
          });
          return;
        }

        const mimeType = mime.lookup(fPath) || "application/octet-stream";
        res.sendFile(fPath, { headers: { "Content-Type": mimeType } });
      });
    });

    this.server.get("/yt-search", async (req: Request, res: Response) => {
      const q = req.query.q as string;
      logger.info("YOUTUBE", `Searching: ${q}`);
      const results = (await (youtubesearchapi as any).GetListByKeyword(
        q,
        false,
      )) as unknown;
      res.json(results);
    });

    this.server.post("/auth/create-hash", (req: Request, res: Response) => {
      const { password } = req.body as { password?: string };
      if (!password) {
        res.status(400).json({ error: "Password required" });
        return;
      }
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto
        .createHash("sha256")
        .update(password + salt)
        .digest("hex");
      res.json({ salt, hash });
    });

    this.server.post("/auth/verify-hash", (req: Request, res: Response) => {
      const { password, salt, hash } = req.body as {
        password?: string;
        salt?: string;
        hash?: string;
      };
      if (!password || !salt || !hash) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }
      const computedHash = crypto
        .createHash("sha256")
        .update(password + salt)
        .digest("hex");
      res.json({ valid: computedHash === hash });
    });
  }

  private detectLocalIp(): void {
    const udpSocket = dgram.createSocket("udp4");
    udpSocket.connect(80, "8.8.8.8", () => {
      this.localIp = udpSocket.address().address;
      logger.info("SERVER", `Local IP detected: ${this.localIp}`);
      udpSocket.close();
    });
  }

  private setupCloudRelay(): void {
    this.cloudSocket = ioClient(CLOUD_URL, {
      query: { clientType: "host" },
    });

    this.cloudSocket.on("connect", () => {
      logger.info(
        "CLOUD",
        `Successfully connected to EnMoku Cloud Relay at ${CLOUD_URL}`,
      );
    });

    this.cloudSocket.on("room-created", (data: { roomCode: string }) => {
      this.activeRoomCode = data.roomCode;
      logger.info("CLOUD", `Cloud Room is ready! PIN: ${this.activeRoomCode}`);
      this.io.to("karaoke-app").emit("cloud-status", {
        connected: true,
        roomCode: this.activeRoomCode,
        relayUrl: RELAY_URL,
      });
    });

    this.cloudSocket.on("connect_error", (err: Error) => {
      logger.error(
        "CLOUD",
        `Connection to relay failed: ${err.message}. Will retry.`,
      );
      if (this.activeRoomCode !== null) {
        this.activeRoomCode = null;
        this.io.to("karaoke-app").emit("cloud-status", { connected: false });
      }
    });

    this.cloudSocket.on("disconnect", (reason: string) => {
      logger.warn("CLOUD", `Disconnected from relay: ${reason}`);
      this.activeRoomCode = null;
      this.io.to("karaoke-app").emit("cloud-status", { connected: false });
    });

    this.cloudSocket.on(
      "remote-connected",
      ({ identity }: { identity: string }) => {
        logger.info("LINK", `Cloud Remote connected: ${identity}`);
        this.knownRemotes[identity] = {
          connectedAt: new Date().toISOString(),
          type: "cloud",
        };
        this.io.to("karaoke-app").emit("join", { type: "remote", identity });
      },
    );

    this.cloudSocket.on(
      "remote-command",
      (payload: { identity: string; data: unknown }) => {
        logger.debug(
          "LINK",
          `Cloud Command from ${payload.identity}: ${JSON.stringify(payload.data)}`,
        );
        this.io.to("karaoke-app").emit("execute-command", payload);
      },
    );

    this.cloudSocket.on(
      "remote-disconnected",
      ({ identity }: { identity: string }) => {
        logger.info("LINK", `Cloud Remote disconnected: ${identity}`);
        delete this.knownRemotes[identity];
        this.io.to("karaoke-app").emit("leave", { type: "remote", identity });
      },
    );

    this.server.get("/cloud_info", (_req: Request, res: Response) => {
      if (!this.activeRoomCode) {
        res
          .status(503)
          .json({ error: "Cloud relay not connected. Please wait." });
        return;
      }
      res.json({
        relayUrl: RELAY_URL,
        roomCode: this.activeRoomCode,
      });
    });
  }

  private registerSocketRelay(): void {
    this.io.on("connection", (socket: Socket) => {
      const clientType = socket.handshake.query.clientType as
        string | undefined;

      if (clientType === "app") {
        logger.info("LINK", "Main App connected to Socket");
        void socket.join("karaoke-app");
        socket.emit("remotes", this.knownRemotes);

        socket.on(
          "sendData",
          (msg: { identity?: string; data: unknown } | undefined) => {
            if (!msg) return;
            if (msg.identity && msg.identity.startsWith("cloud_")) {
              const actualSocketId = msg.identity.replace("cloud_", "");
              this.cloudSocket?.emit("host-response", {
                identity: actualSocketId,
                data: msg.data,
              });
            } else if (msg.identity) {
              this.io.to(msg.identity).emit("fromRemote", msg.data);
            }
          },
        );
        socket.on("broadcastData", (msg: unknown) => {
          socket.broadcast.emit("fromRemote", msg);
          this.cloudSocket?.emit("host-broadcast", msg);
        });
        return;
      }

      if (clientType === "remote") {
        logger.info("LINK", `Local Remote connected: ${socket.id}`);
        this.io.to("karaoke-app").emit("join", {
          type: clientType,
          identity: socket.id,
        });
        this.knownRemotes[socket.id] = {
          connectedAt: new Date().toISOString(),
          type: "local",
        };
        socket.on("remote-command", (data: unknown) => {
          logger.debug(
            "LINK",
            `Local Command from ${socket.id}: ${JSON.stringify(data)}`,
          );
          this.io.to("karaoke-app").emit("execute-command", {
            identity: socket.id,
            data,
          });
        });
        socket.on("disconnect", () => {
          logger.info("LINK", `Local Remote disconnected: ${socket.id}`);
          this.io.to("karaoke-app").emit("leave", {
            type: clientType,
            identity: socket.id,
          });
          delete this.knownRemotes[socket.id];
        });
        return;
      }
    });
  }
}
