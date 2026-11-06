import { ipcMain } from "electron";
import OBSWebSocket, { EventSubscription } from "obs-websocket-js";
import Config from "../config-manager";
import { appState } from "./state";
import { logger } from "./logger";
import type { OBSConfig } from "./types";

class ObsService {
  private client: OBSWebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private scenes: string[] = [];
  private currentScene = "";
  private lastError: string | null = null;

  public getStatus(): {
    connected: boolean;
    reconnecting: boolean;
    currentScene: string;
    scenes: string[];
    error: string | null;
  } {
    return {
      connected: this.connected,
      reconnecting: this.reconnecting,
      currentScene: this.currentScene,
      scenes: this.scenes,
      error: this.lastError,
    };
  }

  public registerIpc(): void {
    ipcMain.handle("obs-connect", async (_event, config) => {
      return await this.connect(config);
    });

    ipcMain.handle("obs-disconnect", async () => {
      await this.disconnect();
      return { success: true };
    });

    ipcMain.handle("obs-get-status", () => this.getStatus());

    ipcMain.handle("obs-set-scene", async (_event, sceneName: string) => {
      if (!this.client || !this.connected) return false;
      try {
        await this.client.call("SetCurrentProgramScene", { sceneName });
        return true;
      } catch (e) {
        logger.error(
          "OBS",
          `Manual scene switch error: ${(e as Error).message}`,
        );
        return false;
      }
    });

    ipcMain.on(
      "obs-trigger-state",
      (_event, state: "idle" | "singing" | "score") => {
        void this.triggerSceneForState(state);
      },
    );
  }

  public initialize(): void {
    const config = this.getStoredConfig();
    if (config.enabled) {
      void this.connect();
    }
  }

  public async connect(cfg?: {
    host?: string;
    port?: number;
    password?: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const stored = this.getStoredConfig();
    const host = cfg?.host ?? stored.host ?? "127.0.0.1";
    const port = cfg?.port ?? stored.port ?? 4455;
    const password = cfg?.password ?? stored.password ?? "";

    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {}
      this.client = null;
    }

    this.client = new OBSWebSocket();

    this.client.on("ConnectionClosed", (error) => {
      logger.warn(
        "OBS",
        `Connection closed: ${error?.message || "Unknown reason"}`,
      );
      this.connected = false;
      this.currentScene = "";
      this.scenes = [];
      this.lastError = error?.message || "Connection closed";
      this.broadcastStatus();

      const currentConfig = this.getStoredConfig();
      if (currentConfig.autoReconnect && !this.reconnecting) {
        this.scheduleReconnect();
      }
    });

    this.client.on("CurrentProgramSceneChanged", (data) => {
      this.currentScene = data.sceneName;
      if (
        appState.appViewWebContents &&
        !appState.appViewWebContents.isDestroyed()
      ) {
        appState.appViewWebContents.send("obs-scene-changed", data.sceneName);
      }
    });

    this.client.on("SceneListChanged", async () => {
      if (!this.client || !this.connected) return;
      try {
        const list = await this.client.call("GetSceneList");
        this.scenes = (list.scenes as Array<{ sceneName: string }>).map(
          (s) => s.sceneName,
        );
        if (
          appState.appViewWebContents &&
          !appState.appViewWebContents.isDestroyed()
        ) {
          appState.appViewWebContents.send("obs-scenes-update", this.scenes);
        }
      } catch (e) {
        logger.error(
          "OBS",
          `Failed to refresh scene list: ${(e as Error).message}`,
        );
      }
    });

    try {
      logger.info("OBS", `Connecting to ws://${host}:${port}...`);
      this.lastError = null;
      await this.client.connect(`ws://${host}:${port}`, password, {
        eventSubscriptions: EventSubscription.All | EventSubscription.Scenes,
        rpcVersion: 1,
      });

      this.connected = true;
      this.reconnecting = false;
      logger.info("OBS", "Connected successfully to OBS Studio.");

      const list = await this.client.call("GetSceneList");
      this.currentScene = list.currentProgramSceneName;
      this.scenes = (list.scenes as Array<{ sceneName: string }>).map(
        (s) => s.sceneName,
      );

      this.broadcastStatus();
      return { success: true };
    } catch (err) {
      const error = err as Error & { code?: number };
      this.connected = false;
      this.lastError = error.message || "Failed to connect to OBS.";
      logger.error("OBS", `Connection error: ${this.lastError}`);
      this.broadcastStatus();

      // Error code 4009 = Authentication Failed
      const currentConfig = this.getStoredConfig();
      if (error.code !== 4009 && currentConfig.autoReconnect) {
        this.scheduleReconnect();
      }

      return { success: false, error: this.lastError };
    }
  }

  public async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {}
      this.client = null;
    }
    this.connected = false;
    this.currentScene = "";
    this.scenes = [];
    this.lastError = null;
    this.broadcastStatus();
  }

  public async triggerSceneForState(
    state: "idle" | "singing" | "score",
  ): Promise<void> {
    if (!this.client || !this.connected) return;
    const cfg = this.getStoredConfig();
    const targetScene = cfg.scenes?.[state];

    if (
      !targetScene ||
      targetScene.trim() === "" ||
      targetScene === "__none__"
    ) {
      return;
    }

    try {
      logger.info(
        "OBS",
        `Automating scene switch -> [${state.toUpperCase()}]: "${targetScene}"`,
      );
      await this.client.call("SetCurrentProgramScene", {
        sceneName: targetScene,
      });
    } catch (err) {
      logger.error(
        "OBS",
        `Failed to set scene "${targetScene}": ${(err as Error).message}`,
      );
    }
  }

  private getStoredConfig(): OBSConfig {
    return (
      (Config.getItem("obsConfig") as OBSConfig) || {
        host: "127.0.0.1",
        port: 4455,
        password: "",
        enabled: false,
        autoReconnect: true,
        scenes: { idle: "", singing: "", score: "" },
      }
    );
  }

  private broadcastStatus(): void {
    if (
      appState.appViewWebContents &&
      !appState.appViewWebContents.isDestroyed()
    ) {
      appState.appViewWebContents.send("obs-status-update", this.getStatus());
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnecting = true;
    this.broadcastStatus();

    this.reconnectTimer = setTimeout(async () => {
      logger.info("OBS", "Attempting automatic reconnection to OBS...");
      await this.connect();
    }, 5000);
  }
}

export const obsService = new ObsService();
