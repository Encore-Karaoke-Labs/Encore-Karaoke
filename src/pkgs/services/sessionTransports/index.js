import LiveKitTransport from "./LiveKitTransport.js";
import PeerJSTransport from "./PeerJSTransport.js";

/**
 * Registry of Session media transports.
 */
const TRANSPORTS = {
  peerjs: {
    id: "peerjs",
    label: "Peer-to-peer",
    shortLabel: "P2P",
    description:
      "Direct connections between singers. Free and private; but may fail behind strict networks.",
    requiresAccount: false,
    create: (session) => new PeerJSTransport(session),
  },
  livekit: {
    id: "livekit",
    label: "Server-side media",
    shortLabel: "SERVER",
    description:
      "Route Session media through Encore's servers for more reliable connectivity.",
    requiresAccount: true,
    create: (session) => new LiveKitTransport(session),
  },
};

/**
 * Normalizes an untrusted transport id.
 * @param {unknown} name
 * @returns {"peerjs"|"livekit"}
 */
export function normalizeSessionTransport(name) {
  return name === "livekit" ? "livekit" : "peerjs";
}

/**
 * Creates a transport instance for a Sessions service.
 * @param {unknown} name - Transport id.
 * @param {Object} session - The Sessions service data object.
 * @returns {import("./SessionTransport.js").default}
 */
export function createSessionTransport(name, session) {
  const id = normalizeSessionTransport(name);
  return TRANSPORTS[id].create(session);
}

/**
 * Returns UI metadata for every available transport.
 * @returns {Array<{id: string, label: string, shortLabel: string, description: string, requiresAccount: boolean}>}
 */
export function getSessionTransportOptions() {
  return Object.values(TRANSPORTS).map(({ create: _create, ...meta }) => ({
    ...meta,
  }));
}

export default TRANSPORTS;
