import {
  app,
  BrowserWindow,
  ipcMain,
  type Event as ElectronEvent,
} from "electron";
import { appState } from "./state";
import { DISCORD_PROTOCOL_PREFIX, platformHints } from "./runtime";
import { logger } from "./logger";
import { sendAppStateToControl } from "./windows";

class DeepLinkManager {
  private readonly pendingDeepLinks: string[] = [];
  private pendingDeepLinkUrl: string | null = null;

  public init(): void {
    const initialDeepLink = this.extractDeepLink(process.argv);
    if (initialDeepLink) {
      this.pendingDeepLinks.push(initialDeepLink);
      this.pendingDeepLinkUrl = initialDeepLink;
    }
  }

  public registerAppHandlers(): void {
    // Windows/Linux Second Instance Handler
    app.on(
      "second-instance",
      (_event: ElectronEvent, commandLine: string[]) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
        }

        const deepLinkUrl = this.extractDeepLink(commandLine);
        if (deepLinkUrl) {
          this.handleDeepLink(deepLinkUrl);
        }
      },
    );

    // MacOS Deep Link Handler
    app.on("open-url", (event: ElectronEvent, url: string) => {
      event.preventDefault();
      this.handleDeepLink(url);
    });
  }

  public registerIpc(): void {
    ipcMain.handle("deep-link-get-initial", () => {
      const url =
        this.pendingDeepLinkUrl ?? this.pendingDeepLinks.shift() ?? null;
      this.pendingDeepLinkUrl = null;
      return url;
    });

    ipcMain.on("deep-link-ready", () => {
      logger.info("DEEPLINK", "Boot process is complete.");
      appState.isRendererReady = true;
      sendAppStateToControl(true);
      this.flushPendingDeepLinks();
    });
  }

  public handleDeepLink(url: string | null | undefined): void {
    if (platformHints.has("no-deep-links")) return;
    if (!url || !url.startsWith("encore://")) return;
    logger.info("DEEPLINK", `Received deep link: ${url}`);

    if (
      appState.isRendererReady &&
      appState.appViewWebContents &&
      !appState.appViewWebContents.isDestroyed()
    ) {
      logger.info("DEEPLINK", `Dispatching: ${url}`);
      appState.appViewWebContents.send("deep-link", url);
    } else {
      logger.info("DEEPLINK", `Queuing: ${url}`);
      this.pendingDeepLinks.push(url);
    }
  }

  private extractDeepLink(argv: readonly string[]): string | null {
    if (!Array.isArray(argv)) return null;

    for (const arg of argv) {
      if (typeof arg !== "string") continue;
      logger.debug("DEEPLINK", arg);

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

  private flushPendingDeepLinks(): void {
    if (
      !appState.isRendererReady ||
      !appState.appViewWebContents ||
      appState.appViewWebContents.isDestroyed()
    ) {
      return;
    }

    while (this.pendingDeepLinks.length > 0) {
      const url = this.pendingDeepLinks.shift();
      if (url) {
        logger.info("DEEPLINK", `Flushing queued deep link: ${url}`);
        appState.appViewWebContents.send("deep-link", url);
      }
    }
  }
}

export const deepLinks = new DeepLinkManager();
