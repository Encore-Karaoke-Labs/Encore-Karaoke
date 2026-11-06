import { ipcMain, type IpcMainEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { appState } from "./state";

type OverlayMessage = { type: string; payload?: unknown };

const EMPTY_SETLIST = {
  nowPlaying: null,
  queue: [],
  total: 0,
};

/**
 * Owns the lyric/setlist overlay state and the SSE clients connected to it.
 */
export class OverlayHub {
  private latestOverlayState: OverlayMessage | null = null;
  private readonly sseOverlayClients = new Set<Response>();
  private latestSetlistState: OverlayMessage | null = null;
  private readonly sseSetlistClients = new Set<Response>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  public start(): void {
    if (this.heartbeat) return;

    this.heartbeat = setInterval(() => {
      for (const client of this.sseOverlayClients) {
        try {
          client.write(": ping\n\n");
        } catch {
          this.sseOverlayClients.delete(client);
        }
      }
      for (const client of this.sseSetlistClients) {
        try {
          client.write(": ping\n\n");
        } catch {
          this.sseSetlistClients.delete(client);
        }
      }
    }, 20000);
  }

  public dispose(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  public registerRoutes(server: Express): void {
    server.get("/overlay/lyrics/stream", (request: Request, res: Response) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders?.();

      this.sseOverlayClients.add(res);

      if (this.latestOverlayState) {
        res.write(`data: ${JSON.stringify(this.latestOverlayState)}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: "clear" })}\n\n`);
      }

      request.on("close", () => {
        this.sseOverlayClients.delete(res);
      });
    });

    server.get("/overlay/lyrics", (_req: Request, res: Response) => {
      const overlayFile = path.join(appState.appRoot, "resources/lyrics.html");
      if (fs.existsSync(overlayFile)) {
        res.sendFile(overlayFile);
      } else {
        res.status(404).send("Overlay not found.");
      }
    });

    server.get("/overlay/setlist/stream", (request: Request, res: Response) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders?.();

      this.sseSetlistClients.add(res);

      if (this.latestSetlistState) {
        res.write(`data: ${JSON.stringify(this.latestSetlistState)}\n\n`);
      } else {
        res.write(
          `data: ${JSON.stringify({ type: "setlist", payload: EMPTY_SETLIST })}\n\n`,
        );
      }

      request.on("close", () => {
        this.sseSetlistClients.delete(res);
      });
    });

    server.get("/overlay/setlist", (_req: Request, res: Response) => {
      const overlayFile = path.join(appState.appRoot, "resources/setlist.html");
      if (fs.existsSync(overlayFile)) {
        res.sendFile(overlayFile);
      } else {
        res.status(404).send("Setlist overlay not found.");
      }
    });
  }

  public registerIpc(): void {
    ipcMain.on(
      "overlay-lyrics-update",
      (_event: IpcMainEvent, payload: unknown) => {
        this.latestOverlayState = { type: "lyrics", payload };
        this.broadcastOverlayLyrics(this.latestOverlayState);
      },
    );

    ipcMain.on("overlay-lyrics-clear", () => {
      this.latestOverlayState = null;
      this.broadcastOverlayLyrics({ type: "clear" });
    });

    ipcMain.on(
      "overlay-setlist-update",
      (_event: IpcMainEvent, payload: unknown) => {
        this.latestSetlistState = { type: "setlist", payload };
        this.broadcastOverlaySetlist(this.latestSetlistState);
      },
    );

    ipcMain.on("overlay-setlist-clear", () => {
      this.latestSetlistState = {
        type: "setlist",
        payload: EMPTY_SETLIST,
      };
      this.broadcastOverlaySetlist(this.latestSetlistState);
    });
  }

  private broadcastOverlayLyrics(data: OverlayMessage): void {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseOverlayClients) {
      try {
        client.write(msg);
      } catch {
        this.sseOverlayClients.delete(client);
      }
    }
  }

  private broadcastOverlaySetlist(data: OverlayMessage): void {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseSetlistClients) {
      try {
        client.write(msg);
      } catch {
        this.sseSetlistClients.delete(client);
      }
    }
  }
}
