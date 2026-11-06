import { Client } from "@xhayper/discord-rpc";
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { DISCORD_CLIENT_ID } from "./runtime";
import { deepLinks } from "./deep-links";
import { logger } from "./logger";
import type { RPCSetPayload } from "./types";

class DiscordRpcService {
  private client = new Client({ clientId: DISCORD_CLIENT_ID });
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private currentState = "Booting up...";

  public getCurrentState(): string {
    return this.currentState;
  }

  public initialize(): void {
    this.setup();
    this.client
      .login()
      .catch(() => logger.error("DISCORD", "Initial login failed"));
  }

  public registerIpc(): void {
    ipcMain.on("setRPC", (event: IpcMainEvent, arg: RPCSetPayload) => {
      this.currentState = arg.state;

      const activityPayload: Record<string, unknown> = {
        state: arg.state,
        details: arg.details,
        largeImageKey: "hoshi",
        largeImageText: "Encore Karaoke",
      };

      if (arg.startTimestamp)
        activityPayload.startTimestamp = arg.startTimestamp;
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

      void this.client.user?.setActivity(activityPayload);

      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) win.webContents.send("update-now-playing", arg);
    });
  }

  private setup(): void {
    this.client.on("ready", async () => {
      logger.info("DISCORD", "Encore Karaoke RPC is ready!");
      this.reconnectAttempts = 0;

      try {
        await this.client.subscribe("ACTIVITY_JOIN");
        await this.client.subscribe("ACTIVITY_JOIN_REQUEST");
        logger.info("DISCORD", "Subscribed to ACTIVITY_JOIN events.");
      } catch (error) {
        logger.error("DISCORD", "Failed to subscribe to join events:");
        logger.error("DISCORD", error);
      }

      void this.client.user?.setActivity({
        details: this.currentState,
        largeImageKey: "hoshi",
        largeImageText: "Encore Karaoke",
      });
    });

    this.client.on("ACTIVITY_JOIN", (data: unknown) => {
      const secret =
        typeof data === "string"
          ? data
          : (data as { secret?: string } | undefined)?.secret;
      logger.info("DISCORD", `Received join secret from Discord: ${secret}`);
      if (secret) {
        deepLinks.handleDeepLink(
          secret.startsWith("encore://")
            ? secret
            : `encore://session/${secret}`,
        );
      }
    });

    this.client.on("ACTIVITY_JOIN_REQUEST", (user: any) => {
      logger.info(
        "DISCORD",
        `Join request received from: ${user?.username ?? "Unknown"}`,
      );
    });

    this.client.on("disconnected", () => {
      if (this.isReconnecting) return;
      logger.warn("DISCORD", "Disconnected. Reconnecting in 15s...");
      this.isReconnecting = true;
      const interval = setInterval(() => {
        this.reconnectAttempts++;
        logger.info(
          "DISCORD",
          `Reconnection attempt ${this.reconnectAttempts}/3`,
        );
        void this.client.destroy();
        this.client = new Client({ clientId: DISCORD_CLIENT_ID });
        this.setup();
        this.client
          .login()
          .catch(() => logger.error("DISCORD", "Login failed"));
        if (this.reconnectAttempts >= 3) {
          logger.error("DISCORD", "Failed to reconnect after 3 attempts.");
          clearInterval(interval);
          this.isReconnecting = false;
          this.reconnectAttempts = 0;
        }
      }, 15000);
    });
  }
}

export const discordRpc = new DiscordRpcService();
