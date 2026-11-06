import { parsePlatformHints } from "../platform-hints";

export interface VersionInformation {
  number: string;
  channel: string;
  codename: string;
}

export const PROTOCOL_PREFIX = "encore";
export const DISCORD_CLIENT_ID = "1408795513397973052";
export const DISCORD_PROTOCOL_PREFIX = `discord-${DISCORD_CLIENT_ID}`;

export const platformHints = parsePlatformHints(process.argv);

export const versionInformation: VersionInformation = {
  number: "1.16.0",
  channel: platformHints.embedded ? "EMBEDDED" : "BETA",
  codename: "Pisces",
};

export const kioskEnabled = platformHints.kiosk;
export const kioskMode = platformHints.kioskMode;
export const isLowLatency = platformHints.lowLatency;
export const isDev = process.argv.includes("--dev");
