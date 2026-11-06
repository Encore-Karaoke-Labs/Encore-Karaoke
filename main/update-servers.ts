import type { Bonjour, Service } from "bonjour-service";
import { logger } from "./logger";
import type { DiscoveredUpdateServer, UpdateServerInfo } from "./types";

let activeUpdateServers: DiscoveredUpdateServer[] = [];
let initialized = false;

export function startUpdateServerDiscovery(bonjour: Bonjour): void {
  if (initialized) return;
  initialized = true;

  const serverBrowser = bonjour.find({ type: "encore-server" });

  serverBrowser.on("up", async (service: Service) => {
    try {
      if (!service.referer?.address) return;
      const res = await fetch(
        `http://${service.referer.address}:${service.port}/info`,
      );
      const serverInfo = (await res.json()) as UpdateServerInfo;

      const serverId = `${service.referer.address}:${service.port}`;
      const serverObj: DiscoveredUpdateServer = {
        id: serverId,
        ip: service.referer.address,
        host: service.host,
        port: service.port,
        name: serverInfo.serverName,
        info: serverInfo.libraryInformation,
      };

      const existsIdx = activeUpdateServers.findIndex((s) => s.id === serverId);
      if (existsIdx !== -1) {
        activeUpdateServers[existsIdx] = serverObj;
      } else {
        activeUpdateServers.push(serverObj);
      }
      logger.info(
        "SYSTEM",
        `Server UP: ${serverInfo.serverName} (${serverId})`,
      );
    } catch {
      logger.error(
        "SYSTEM",
        "Failed to fetch info from a discovered UP server.",
      );
    }
  });

  serverBrowser.on("down", (service: Service) => {
    if (!service.referer?.address) return;
    const serverId = `${service.referer.address}:${service.port}`;
    activeUpdateServers = activeUpdateServers.filter((s) => s.id !== serverId);
    logger.info("SYSTEM", `Server DOWN: ${serverId}`);
  });

  bonjour.find({ type: "encore-server" }, async (service: Service) => {
    try {
      if (!service.referer?.address) return;
      const res = await fetch(
        `http://${service.referer.address}:${service.port}/info`,
      );
      const serverInfo = (await res.json()) as UpdateServerInfo;
      logger.info(
        "SYSTEM",
        `Found Encore Song Update server: ${serverInfo.serverName} (${service.host})`,
      );
      logger.info(
        "SYSTEM",
        `Library hosted: ${serverInfo.libraryInformation.title}`,
      );
    } catch (error) {
      logger.error(
        "SYSTEM",
        "Encore failed to grab info of the Song Update server",
      );
      logger.error("SYSTEM", error);
    }
  });
}

export function getUpdateServers(): DiscoveredUpdateServer[] {
  return activeUpdateServers;
}
