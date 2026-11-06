import { app } from "electron";
import path from "node:path";
import {
  DISCORD_PROTOCOL_PREFIX,
  PROTOCOL_PREFIX,
  platformHints,
} from "./runtime";

export function registerProtocols(): void {
  const protocols = [PROTOCOL_PREFIX, DISCORD_PROTOCOL_PREFIX];

  protocols.forEach((proto) => {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(proto, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(proto);
    }
  });
}

export function registerProtocolsIfEnabled(): void {
  if (!platformHints.has("no-protocols")) {
    registerProtocols();
  }
}
