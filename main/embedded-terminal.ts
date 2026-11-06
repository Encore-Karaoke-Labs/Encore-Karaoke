import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { exec, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { appState } from "./state";
import { logger } from "./logger";
import type {
  ExecCommandPayload,
  InteractiveShellPayload,
  ProcessCommandResult,
  ProcessOptions,
  SpawnCommandPayload,
} from "./types";

const runningProcesses = new Map<string, ChildProcess>();
let cachedSystemShell: string | null = null;

function getSystemShell(): string {
  if (cachedSystemShell) return cachedSystemShell;

  if (process.platform === "win32") {
    cachedSystemShell = "powershell.exe";
    return cachedSystemShell;
  }

  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) {
    cachedSystemShell = process.env.SHELL;
    return cachedSystemShell;
  }

  const commonShells = [
    "/bin/bash",
    "/bin/sh",
    "/bin/ash",
    "/bin/dash",
    "/bin/zsh",
  ];

  for (const sh of commonShells) {
    if (fs.existsSync(sh)) {
      cachedSystemShell = sh;
      return cachedSystemShell;
    }
  }

  cachedSystemShell = "/bin/sh";
  return cachedSystemShell;
}

function sendProcessEvent(
  sender: WebContents,
  channel: string,
  data: Record<string, unknown>,
): void {
  if (!sender.isDestroyed()) sender.send(channel, data);
}

/**
 * Registers the process-control IPC used by the debug terminal.
 *
 * Only called for embedded builds: the terminal grants arbitrary shell access,
 * which should never be exposed on a normal desktop install.
 */
export function registerEmbeddedTerminalIpc(): void {
  ipcMain.handle(
    "exec-command",
    async (
      event: IpcMainInvokeEvent,
      payload: ExecCommandPayload | string,
    ): Promise<ProcessCommandResult> => {
      if (event.sender !== appState.appViewWebContents) {
        return { success: false, error: "Unauthorized sender." };
      }

      const command = typeof payload === "string" ? payload : payload?.command;
      const options: ProcessOptions =
        typeof payload === "object" && payload !== null
          ? (payload.options ?? {})
          : {};

      if (!command || typeof command !== "string") {
        return { success: false, error: "Invalid command string provided." };
      }

      const execOptions = {
        timeout: options.timeout ?? 30000,
        maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
        cwd: options.cwd ?? process.cwd(),
        shell:
          typeof options.shell === "string" ? options.shell : getSystemShell(),
        env: { ...process.env, ...options.env },
      };

      return new Promise<ProcessCommandResult>((resolve) => {
        exec(command, execOptions, (error, stdout, stderr) => {
          if (error) {
            resolve({
              success: false,
              stdout: stdout ? stdout.toString() : "",
              stderr: stderr ? stderr.toString() : "",
              exitCode: typeof error.code === "number" ? error.code : 1,
              error: error.message,
            });
          } else {
            resolve({
              success: true,
              stdout: stdout ? stdout.toString() : "",
              stderr: stderr ? stderr.toString() : "",
              exitCode: 0,
              error: null,
            });
          }
        });
      });
    },
  );

  ipcMain.handle(
    "spawn-command",
    async (
      event: IpcMainInvokeEvent,
      payload: SpawnCommandPayload,
    ): Promise<ProcessCommandResult> => {
      if (event.sender !== appState.appViewWebContents) {
        return { success: false, error: "Unauthorized sender." };
      }

      const { taskId, command, args = [], options = {} } = payload ?? {};

      if (
        typeof taskId !== "string" ||
        !taskId ||
        typeof command !== "string" ||
        !command
      ) {
        return { success: false, error: "taskId and command are required." };
      }

      if (runningProcesses.has(taskId)) {
        return { success: false, error: `Process ${taskId} already running.` };
      }

      try {
        const child = spawn(command, args, {
          cwd: options.cwd ?? process.cwd(),
          shell: options.shell === undefined ? getSystemShell() : options.shell,
          env: { ...process.env, ...options.env },
        });

        runningProcesses.set(taskId, child);

        child.stdout?.on("data", (chunk: Buffer) => {
          sendProcessEvent(event.sender, "spawn-stdout", {
            taskId,
            data: chunk.toString("utf-8"),
          });
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          sendProcessEvent(event.sender, "spawn-stderr", {
            taskId,
            data: chunk.toString("utf-8"),
          });
        });

        child.on("error", (err: Error) => {
          sendProcessEvent(event.sender, "spawn-error", {
            taskId,
            error: err.message,
          });
        });

        child.on("close", (code, signal) => {
          runningProcesses.delete(taskId);
          sendProcessEvent(event.sender, "spawn-exit", {
            taskId,
            exitCode: code,
            signal,
          });
        });

        return { success: true, pid: child.pid, error: null };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.on(
    "kill-process",
    (
      event: IpcMainEvent,
      payload: { taskId?: string; signal?: NodeJS.Signals | number },
    ) => {
      if (event.sender !== appState.appViewWebContents) return;

      const { taskId, signal = "SIGTERM" } = payload ?? {};
      if (typeof taskId !== "string") return;

      const child = runningProcesses.get(taskId);
      if (!child) return;

      try {
        child.kill(signal);
        runningProcesses.delete(taskId);
      } catch (error) {
        const err = error as Error;
        logger.error(
          "SYSTEM",
          `Failed to kill process ${taskId}: ${err.message}`,
        );
      }
    },
  );

  ipcMain.on(
    "write-process-stdin",
    (event: IpcMainEvent, payload: { taskId?: string; data?: string }) => {
      if (event.sender !== appState.appViewWebContents) return;

      const { taskId, data } = payload ?? {};
      if (typeof taskId !== "string" || typeof data !== "string") return;

      runningProcesses.get(taskId)?.stdin?.write(data);
    },
  );

  ipcMain.handle(
    "spawn-interactive-shell",
    async (
      event: IpcMainInvokeEvent,
      payload: InteractiveShellPayload,
    ): Promise<ProcessCommandResult> => {
      if (event.sender !== appState.appViewWebContents) {
        return { success: false, error: "Unauthorized sender." };
      }

      const { taskId } = payload ?? {};
      if (typeof taskId !== "string" || !taskId) {
        return { success: false, error: "taskId is required." };
      }

      if (runningProcesses.has(taskId)) {
        return { success: false, error: "Already running" };
      }

      const shellCommand = getSystemShell();
      const shellArgs = process.platform === "win32" ? ["-NoLogo"] : ["-i"];

      try {
        const child = spawn(shellCommand, shellArgs, {
          cwd: process.cwd(),
          shell: false,
          env: { ...process.env },
        });

        runningProcesses.set(taskId, child);

        child.stdout?.on("data", (chunk: Buffer) => {
          sendProcessEvent(event.sender, "spawn-stdout", {
            taskId,
            data: chunk.toString("utf-8"),
          });
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          sendProcessEvent(event.sender, "spawn-stderr", {
            taskId,
            data: chunk.toString("utf-8"),
          });
        });

        child.on("error", (err: Error) => {
          sendProcessEvent(event.sender, "spawn-error", {
            taskId,
            error: err.message,
          });
        });

        child.on("close", (code, signal) => {
          runningProcesses.delete(taskId);
          sendProcessEvent(event.sender, "spawn-exit", {
            taskId,
            exitCode: code,
            signal,
          });
        });

        return { success: true, pid: child.pid, error: null };
      } catch (error) {
        const err = error as Error;
        return { success: false, error: err.message };
      }
    },
  );
}

export function killAllProcesses(): void {
  for (const child of runningProcesses.values()) {
    try {
      child.kill();
    } catch {}
  }
  runningProcesses.clear();
}
