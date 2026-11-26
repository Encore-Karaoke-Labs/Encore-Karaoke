import {
  AudioPresets,
  ConnectionState,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import SessionTransport from "./SessionTransport.js";

export const DEFAULT_LIVEKIT_TOKEN_URL =
  "https://sessions.encorekaraoke.org/livekit-token";

const MIC_TRACK_NAME = "session-mic";
const PERFORMANCE_TRACK_NAME = "performance";
const CAMERA_TRACK_PREFIX = "camera:";

/**
 * Builds an error that retrying will not fix (missing account, rejected token,
 * bad configuration), so the transport is not restarted on every state update.
 * @param {string} message
 * @returns {Error & {permanent: true}}
 */
function permanentError(message) {
  const error = new Error(message);
  error.permanent = true;
  return error;
}

/**
 * Summarizes a JWT for diagnostics without exposing its signature.
 * @param {string} token
 * @returns {Object|null}
 */
function describeToken(token) {
  try {
    const [headerPart, payloadPart] = String(token).split(".");
    const decode = (part) => {
      const normalized = String(part).replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
      );
      const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    const header = decode(headerPart);
    const payload = decode(payloadPart);
    return {
      kid: header.kid,
      alg: header.alg,
      cat: header.cat,
      iss: payload.iss,
      azp: payload.azp,
      exp: payload.exp,
      sub: payload.sub ? "present" : null,
    };
  } catch {
    return null;
  }
}

/**
 * Requests a LiveKit access token for the current Session room.
 * @param {Object} session - The Sessions service data object.
 * @param {string} roomName - Session room id.
 * @returns {Promise<{token: string, url: string}>}
 */
export async function requestLiveKitToken(session, roomName) {
  const identity = session.getIdentityService?.();
  const clerkToken = await identity?.getSessionToken?.();

  if (!clerkToken?.token) {
    throw permanentError(
      "LiveKit Sessions require an Encore account. Sign in and try again.",
    );
  }

  const tokenUrl =
    (await session.getLiveKitTokenUrl?.()) || DEFAULT_LIVEKIT_TOKEN_URL;

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clerkToken.token}`,
      },
      body: JSON.stringify({ roomName: String(roomName) }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      error?.name === "AbortError"
        ? "The LiveKit token service did not respond in time."
        : `Could not reach the LiveKit token service: ${
            error instanceof Error ? error.message : String(error)
          }`,
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* The error below covers unreadable responses. */
  }

  if (!response.ok) {
    const serverMessage =
      payload?.error || `LiveKit token request failed (${response.status}).`;

    console.warn(
      "[SESSIONS] LiveKit token request was rejected:",
      response.status,
      describeToken(clerkToken.token),
    );

    throw permanentError(
      response.status === 401
        ? `Your Encore account session could not be verified (${serverMessage}). Sign out and back in, then try again.`
        : serverMessage,
    );
  }

  if (!payload?.token || !payload?.url) {
    throw permanentError(
      "The LiveKit token service returned an incomplete response.",
    );
  }

  return { token: payload.token, url: payload.url };
}

/**
 * LiveKit media transport.
 */
export default class LiveKitTransport extends SessionTransport {
  /**
   * @param {Object} session - The Sessions service data object.
   */
  constructor(session) {
    super(session);
    this.name = "livekit";
    this.label = "LiveKit cloud";
    this.requiresAccount = true;

    /** @type {Room|null} */
    this.room = null;
    this.identity = null;

    /** @type {Map<string, {publication: Object, originTrack: MediaStreamTrack, sourceTrack: MediaStreamTrack, stream: MediaStream|null}>} */
    this.publications = new Map();

    /** Invalidates in-flight publishes when a track is replaced quickly. */
    this._publishTokens = new Map();

    /** @type {Map<string, {id: string|null, name: string, stream: MediaStream}>} */
    this.remoteTracks = new Map();

    this._reconcileScheduled = false;
  }

  async connect() {
    if (this.status === "connecting" || this.status === "connected") return;

    const session = this.session;
    if (!session.roomId) throw new Error("No Session room is active.");

    this.setStatus("connecting");

    const { token, url } = await requestLiveKitToken(session, session.roomId);

    const room = new Room({
      adaptiveStream: false,
      dynacast: true,
      autoSubscribe: true,
    });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      this._handleRemoteTrack(track, publication, participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      this._handleRemoteTrackEnded(track, publication, participant);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this._handleParticipantLeft(participant);
    });

    room.on(RoomEvent.Reconnecting, () => {
      this.setStatus("connecting");
    });

    room.on(RoomEvent.Reconnected, () => {
      this.setStatus("connected");
      this.scheduleReconcile();
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      if (!this.room) return;
      this.setStatus(
        "error",
        reason
          ? `Disconnected from LiveKit (${String(reason)}).`
          : "Disconnected from LiveKit.",
      );
    });

    try {
      await room.connect(url, token);
    } catch (error) {
      try {
        room.disconnect();
      } catch {
        /* Ignore teardown errors. */
      }
      this.room = null;
      throw error;
    }

    if (this.room !== room) return;

    this.identity = room.localParticipant?.identity || this.identity;
    this.setStatus("connected");
    this._syncExistingRemoteTracks();
    this.reconcile();
  }

  async disconnect() {
    this._reconcileScheduled = false;

    for (const key of [...this.publications.keys()]) {
      await this._unpublish(key);
    }
    this.publications.clear();
    this._publishTokens.clear();

    for (const entry of this.remoteTracks.values()) {
      this.stopStream(entry.stream);
    }
    this.remoteTracks.clear();

    const room = this.room;
    this.room = null;
    this.identity = null;

    if (room) {
      try {
        room.disconnect();
      } catch (error) {
        console.warn("[SESSIONS] Could not disconnect from LiveKit:", error);
      }
    }
  }

  /**
   * Republishes camera tracks when the local camera stream changes.
   */
  handleCameraSourceChanged() {
    this.scheduleReconcile();
  }

  /**
   * Coalesces reconcile calls into a microtask so bursts of state updates only
   * publish once.
   */
  scheduleReconcile() {
    if (this._reconcileScheduled) return;
    this._reconcileScheduled = true;

    queueMicrotask(() => {
      this._reconcileScheduled = false;
      this.reconcile();
    });
  }

  /**
   * Brings published tracks in line with the current Session state.
   * @param {{modeChanged?: boolean, playTriggerChanged?: boolean, audibleChanged?: boolean}} [_changes]
   */
  reconcile(_changes = {}) {
    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected) return;

    const desired = new Map();

    const micSourceTrack = this._shouldPublishMic()
      ? this.session.getSessionMicStream()?.getAudioTracks?.()[0] || null
      : null;
    if (micSourceTrack) {
      const existing = this.publications.get(MIC_TRACK_NAME);
      if (
        existing &&
        existing.originTrack === micSourceTrack &&
        existing.sourceTrack.readyState === "live"
      ) {
        desired.set(MIC_TRACK_NAME, { existing: true });
      } else {
        const micStream = this.cloneMicStream();
        const track = micStream?.getAudioTracks?.()[0];
        if (track) {
          desired.set(MIC_TRACK_NAME, {
            originTrack: micSourceTrack,
            track,
            ownedStream: micStream,
            options: {
              name: MIC_TRACK_NAME,
              source: Track.Source.Microphone,
              stream: "session",
              audioPreset: AudioPresets.speech,
              dtx: true,
              red: true,
            },
          });
        }
      }
    }

    const performanceTrack = this._performanceAudioTrack();
    if (performanceTrack) {
      const existing = this.publications.get(PERFORMANCE_TRACK_NAME);
      if (existing && existing.originTrack === performanceTrack) {
        desired.set(PERFORMANCE_TRACK_NAME, { existing: true });
      } else {
        desired.set(PERFORMANCE_TRACK_NAME, {
          originTrack: performanceTrack,
          track: performanceTrack,
          ownedStream: null,
          options: {
            name: PERFORMANCE_TRACK_NAME,
            source: Track.Source.Unknown,
            stream: "performance",
            audioPreset: AudioPresets.music,
            dtx: false,
            red: true,
          },
        });
      }
    }

    if (this.session.cameraEnabled) {
      for (const source of this.session.getLocalCameraSources()) {
        const stream = this.session.cameraStreams[source];
        const track = stream?.getVideoTracks?.()[0];
        if (!track || track.readyState === "ended") continue;

        const name = `${CAMERA_TRACK_PREFIX}${source}`;
        const existing = this.publications.get(name);
        if (existing && existing.originTrack === track) {
          desired.set(name, { existing: true });
          continue;
        }

        desired.set(name, {
          originTrack: track,
          track,
          ownedStream: null,
          options: {
            name,
            source: Track.Source.Unknown,
            stream: "camera",
            simulcast: true,
          },
        });
      }
    }

    for (const key of [...this.publications.keys()]) {
      if (!desired.has(key)) void this._unpublish(key);
    }

    for (const [key, entry] of desired) {
      if (entry.existing) continue;
      void this._publish(
        key,
        entry.originTrack,
        entry.track,
        entry.options,
        entry.ownedStream,
      );
    }
  }

  /**
   * Whether this participant should publish its Session microphone.
   * @returns {boolean}
   */
  _shouldPublishMic() {
    const session = this.session;
    if (!session.getSessionMicStream()) return false;
    if (session.state.mode === "lounge") return true;
    if (session.state.mode !== "performance") return false;
    if (this.isSinger()) return false;
    return Boolean(session.state.everyoneAudible);
  }

  /**
   * The audio track of the local performance stream, when this participant is
   * the singer.
   * @returns {MediaStreamTrack|null}
   */
  _performanceAudioTrack() {
    if (!this.isSinger()) return null;
    const stream = this.session.currentPerformanceStream;
    const track = stream?.getAudioTracks?.()[0] || null;
    return track && track.readyState === "live" ? track : null;
  }

  /**
   * Publishes one local track.
   * @param {string} key
   * @param {MediaStreamTrack} originTrack - The Session bus track being sent.
   * @param {MediaStreamTrack} track - The track handed to LiveKit.
   * @param {Object} options - LiveKit TrackPublishOptions.
   * @param {MediaStream|null} ownedStream - Stream cloned by this transport.
   */
  async _publish(key, originTrack, track, options, ownedStream) {
    const token = (this._publishTokens.get(key) || 0) + 1;
    this._publishTokens.set(key, token);

    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected) {
      this.stopStream(ownedStream);
      return;
    }

    if (track.readyState === "ended") {
      this.stopStream(ownedStream);
      return;
    }

    let publication = null;
    try {
      publication = await room.localParticipant.publishTrack(track, options);
    } catch (error) {
      this.stopStream(ownedStream);
      if (this._publishTokens.get(key) !== token) return;

      console.warn(`[SESSIONS] Could not publish ${key} to LiveKit:`, error);
      this.dispatch("Encore.Sessions.TransportStatus", {
        transport: this.name,
        label: this.label,
        status: this.status,
        error: `Could not publish Session media: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    if (this.room !== room || this._publishTokens.get(key) !== token) {
      try {
        await room.localParticipant.unpublishTrack(
          publication.track || track,
          Boolean(ownedStream),
        );
      } catch {
        /* The connection may already be gone. */
      }
      this.stopStream(ownedStream);
      return;
    }

    this.publications.set(key, {
      publication,
      originTrack,
      sourceTrack: track,
      stream: ownedStream || null,
    });
  }

  /**
   * Unpublishes one local track and releases transport-owned resources.
   * @param {string} key
   */
  async _unpublish(key) {
    this._publishTokens.set(key, (this._publishTokens.get(key) || 0) + 1);

    const entry = this.publications.get(key);
    if (!entry) return;
    this.publications.delete(key);

    const room = this.room;
    if (room) {
      try {
        await room.localParticipant.unpublishTrack(
          entry.publication?.track || entry.sourceTrack,
          Boolean(entry.stream),
        );
      } catch (error) {
        console.warn(
          `[SESSIONS] Could not unpublish ${key} from LiveKit:`,
          error,
        );
      }
    }

    this.stopStream(entry.stream);
  }

  /**
   * Maps a LiveKit track to the Session participant and stream kind, then
   * forwards it to the same events the PeerJS transport uses.
   * @param {Object} track - LiveKit RemoteTrack.
   * @param {Object} publication - LiveKit RemoteTrackPublication.
   * @param {Object} participant - LiveKit RemoteParticipant.
   */
  _handleRemoteTrack(track, publication, participant) {
    const sid = track.sid || publication?.trackSid;
    if (!sid) return;

    const id = this.participantIdForIdentity(participant?.identity || null);
    // LiveKit exposes the publishing name as `trackName`; `name` only exists
    // on the Room itself, so reading it leaves every track unnamed.
    const name = publication?.trackName || "";
    const stream = new MediaStream([track.mediaStreamTrack]);

    this.remoteTracks.set(sid, { id, name, stream });

    if (!id) {
      console.warn(
        `[SESSIONS] LiveKit track from unknown participant ${participant?.identity}`,
      );
      return;
    }

    if (name.startsWith(CAMERA_TRACK_PREFIX)) {
      this.dispatch("Encore.Sessions.CameraStream", {
        id,
        source:
          name.slice(CAMERA_TRACK_PREFIX.length) === "remote"
            ? "remote"
            : "local",
        stream,
      });
      return;
    }

    if (name === PERFORMANCE_TRACK_NAME) {
      this.dispatch("Encore.Sessions.RemoteStream", { id, stream });
      return;
    }

    if (name === MIC_TRACK_NAME) {
      this.dispatch("Encore.Sessions.LoungeStream", { id, stream });
    }
  }

  /**
   * Cleans up a remote track that is no longer subscribed.
   * @param {Object} track
   * @param {Object} publication
   * @param {Object} participant
   */
  _handleRemoteTrackEnded(track, publication, participant) {
    const sid = track?.sid || publication?.trackSid;
    const entry = sid ? this.remoteTracks.get(sid) : null;
    if (!entry) return;

    this.remoteTracks.delete(sid);

    const id =
      entry.id || this.participantIdForIdentity(participant?.identity || null);
    if (!id) return;

    if (entry.name.startsWith(CAMERA_TRACK_PREFIX)) {
      this.dispatch("Encore.Sessions.CameraStreamEnded", {
        id,
        source:
          entry.name.slice(CAMERA_TRACK_PREFIX.length) === "remote"
            ? "remote"
            : "local",
      });
      return;
    }

    this.dispatch("Encore.Sessions.PeerDisconnected", id);
  }

  /**
   * Releases every track belonging to a participant that left the room.
   * @param {Object} participant - LiveKit RemoteParticipant.
   */
  _handleParticipantLeft(participant) {
    const id = this.participantIdForIdentity(participant?.identity || null);
    if (!id) return;

    for (const [sid, entry] of [...this.remoteTracks]) {
      if (entry.id !== id) continue;
      this.remoteTracks.delete(sid);

      if (entry.name.startsWith(CAMERA_TRACK_PREFIX)) {
        this.dispatch("Encore.Sessions.CameraStreamEnded", {
          id,
          source:
            entry.name.slice(CAMERA_TRACK_PREFIX.length) === "remote"
              ? "remote"
              : "local",
        });
      }
    }

    this.dispatch("Encore.Sessions.PeerDisconnected", id);
  }

  /**
   * LiveKit only emits TrackSubscribed for tracks published after we join.
   */
  _syncExistingRemoteTracks() {
    const room = this.room;
    if (!room) return;

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (!track) continue;
        this._handleRemoteTrack(track, publication, participant);
      }
    }
  }
}
