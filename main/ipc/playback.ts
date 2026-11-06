import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";
import { appState } from "../state";

/**
 * Dispatches an IPC command to the main Encore app renderer view and waits for the reply.
 */
function requestAppView<T = unknown>(
  action: string,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (
      !appState.appViewWebContents ||
      appState.appViewWebContents.isDestroyed()
    ) {
      return reject(
        new Error("Encore app view is not initialized or is destroyed."),
      );
    }

    const correlationId = crypto.randomUUID();
    const replyChannel = `karaoke:reply:${correlationId}`;

    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(replyChannel);
      reject(new Error(`IPC request timeout waiting for action: ${action}`));
    }, 6000);

    ipcMain.once(replyChannel, (_event: IpcMainEvent, response: T) => {
      clearTimeout(timeout);
      resolve(response);
    });

    appState.appViewWebContents.send("karaoke:request", {
      correlationId,
      replyChannel,
      action,
      payload,
    });
  });
}

export function registerPlaybackIpc(): void {
  ipcMain.handle("karaoke:play-pause", async () => {
    return await requestAppView("play-pause");
  });

  ipcMain.handle(
    "karaoke:play-or-reserve-song",
    async (_event: IpcMainInvokeEvent, songOrCode: unknown) => {
      return await requestAppView("play-or-reserve-song", songOrCode);
    },
  );

  ipcMain.handle("karaoke:get-playback-info", async () => {
    return await requestAppView("get-playback-info");
  });

  ipcMain.handle(
    "karaoke:get-song-list",
    async (
      _event: IpcMainInvokeEvent,
      options?: { offset?: number; limit?: number },
    ) => {
      return await requestAppView("get-song-list", options);
    },
  );

  ipcMain.handle(
    "karaoke:search-songs",
    async (
      _event: IpcMainInvokeEvent,
      payload: { query: string; limit?: number } | string,
    ) => {
      return await requestAppView("search-songs", payload);
    },
  );

  ipcMain.handle(
    "karaoke:key-change",
    async (
      _event: IpcMainInvokeEvent,
      payload?: "up" | "down" | number | { step?: number; value?: number },
    ) => {
      return await requestAppView("key-change", payload);
    },
  );

  ipcMain.handle(
    "karaoke:tempo-change",
    async (_event: IpcMainInvokeEvent, direction?: "up" | "down") => {
      return await requestAppView("tempo-change", direction);
    },
  );

  ipcMain.handle(
    "karaoke:toggle-chorus",
    async (_event: IpcMainInvokeEvent, enabled?: boolean) => {
      return await requestAppView("toggle-chorus", enabled);
    },
  );

  ipcMain.handle(
    "karaoke:guide-melody",
    async (
      _event: IpcMainInvokeEvent,
      payload?: "cycle" | "OFF" | "SOFT" | "NORMAL" | "STRONG" | number,
    ) => {
      return await requestAppView("guide-melody", payload);
    },
  );

  ipcMain.handle(
    "karaoke:adjust-volume",
    async (_event: IpcMainInvokeEvent, direction?: "up" | "down") => {
      return await requestAppView("adjust-volume", direction);
    },
  );

  ipcMain.handle(
    "karaoke:adjust-mic-volume",
    async (_event: IpcMainInvokeEvent, direction?: "up" | "down") => {
      return await requestAppView("adjust-mic-volume", direction);
    },
  );

  ipcMain.handle(
    "karaoke:cycle-rhythm",
    async (_event: IpcMainInvokeEvent, direction?: "left" | "right") => {
      return await requestAppView("cycle-rhythm", direction);
    },
  );

  ipcMain.handle(
    "karaoke:cycle-bgv",
    async (_event: IpcMainInvokeEvent, direction?: number) => {
      return await requestAppView("cycle-bgv", direction);
    },
  );

  ipcMain.handle("karaoke:toggle-recording", async () => {
    return await requestAppView("toggle-recording");
  });

  ipcMain.handle("karaoke:get-queue", async () => {
    return await requestAppView("get-queue");
  });

  ipcMain.handle("karaoke:app-ready", () => appState.isRendererReady);
}
