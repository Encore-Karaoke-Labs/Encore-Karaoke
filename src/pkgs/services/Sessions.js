import { Peer } from "peerjs";
import {
  createSessionTransport,
  getSessionTransportOptions,
  normalizeSessionTransport,
} from "./sessionTransports/index.js";
import { DEFAULT_LIVEKIT_TOKEN_URL } from "./sessionTransports/LiveKitTransport.js";

const pkg = {
  name: "Encore Sessions Service",
  svcName: "SessionsSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;
    document.addEventListener("Encore.Sessions.DeafenStateUpdate", (e) => {
      pkg.data.isDeafened = Boolean(e.detail?.deafened);
    });
    console.log("[SESSIONS] Sessions Service started.");
  },
  end: async function () {
    console.log("[SESSIONS] Sessions Service shutting down.");
    if (this.data && typeof this.data.leaveRoom === "function") {
      this.data.leaveRoom();
    }
  },
  data: {
    // Increment this ONLY when network structures, event behaviors,
    // or state payloads change in a way that breaks compatibility.
    PROTOCOL_VERSION: 5,
    SESSION_ID_LENGTH: 16,
    CHECKSUM_LENGTH: 4,
    LYRICS_CHUNK_SIZE: 48000,
    PIANOROLL_CHUNK_SIZE: 48000,

    peer: null,
    roomId: null,
    isHost: false,
    nickname: "Guest",
    connections: new Map(),

    transportName: "peerjs",
    transport: null,
    _transportStartToken: 0,
    _transportStarting: false,
    _transportFailedName: null,
    _transportRetryAt: 0,
    _transportFailureCount: 0,
    _transportSyncPending: false,

    cameraStreams: {},
    cameraEnabled: false,
    cameraOwnsLocal: false,
    cameraStartToken: 0,
    _cameraStreamReceivedListener: null,
    _cameraStreamEndedListener: null,
    _cameraStopping: false,
    isMuted: false,
    isDeafened: false,
    _lastRoutedMode: null,
    _lastPlayTrigger: null,
    _lastRoutedEveryoneAudible: null,
    _routing: false,

    state: {
      mode: "lounge",
      singerId: null,
      nowPlaying: null,
      playTrigger: null,
      everyoneAudible: false,
      transport: "peerjs",
      queue: [],
      participants: [],
      leaderboard: [],
    },

    peerOptions: { debug: 1 },

    base64urlEncode: function (bytes) {
      let binary = "";

      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    },

    sha256: async function (bytes) {
      return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    },

    createSessionCode: async function (hostName) {
      const encoder = new TextEncoder();
      const nameBytes = encoder.encode(hostName);

      if (nameBytes.length > 255) {
        throw new Error("Host name is too long.");
      }

      const sessionId = crypto.getRandomValues(
        new Uint8Array(this.SESSION_ID_LENGTH),
      );

      /*
        [1 byte]   version
        [1 byte]   host name length
        [N bytes]  host name
        [16 bytes] Session ID
      */
      const payload = new Uint8Array(
        2 + nameBytes.length + this.SESSION_ID_LENGTH,
      );

      payload[0] = this.PROTOCOL_VERSION;
      payload[1] = nameBytes.length;

      payload.set(nameBytes, 2);
      payload.set(sessionId, 2 + nameBytes.length);

      const hash = await this.sha256(payload);
      const checksum = hash.slice(0, this.CHECKSUM_LENGTH);
      const packet = new Uint8Array(payload.length + this.CHECKSUM_LENGTH);

      packet.set(payload);
      packet.set(checksum, payload.length);

      return {
        code: `SES${this.PROTOCOL_VERSION}-${this.base64urlEncode(packet)}`,
        sessionId,
      };
    },

    /**
     * Returns metadata for every media transport the host can choose from.
     * @returns {Array<Object>}
     */
    getTransportOptions: function () {
      return getSessionTransportOptions();
    },

    /**
     * Returns the Identity service.
     * @returns {object|null}
     */
    getIdentityService: function () {
      return pkg.root?.Processes?.getService("IdentitySvc")?.data || null;
    },

    /**
     * Maps a transport participant identity onto a Session participant id.
     *
     * @param {string|null} identity
     * @returns {string|null}
     */
    getParticipantIdForTransportIdentity: function (identity) {
      if (!identity) return null;

      const value = String(identity);
      if (this.peer?.id === value) return value;

      const participant = this.state.participants.find(
        (entry) => entry.userId && String(entry.userId) === value,
      );
      return participant?.id || null;
    },

    /**
     * Reads the LiveKit token endpoint.
     * @returns {Promise<string>}
     */
    getLiveKitTokenUrl: async function () {
      try {
        return (
          (await window.config?.getItem?.("sessionsConfig.livekitTokenUrl")) ||
          DEFAULT_LIVEKIT_TOKEN_URL
        );
      } catch (error) {
        console.warn("[SESSIONS] Could not read the LiveKit token URL:", error);
        return DEFAULT_LIVEKIT_TOKEN_URL;
      }
    },

    /**
     * Replaces the active media transport.
     *
     * @param {string} name - Transport id from getTransportOptions().
     * @returns {Promise<boolean>} Whether the requested transport is active.
     */
    startTransport: async function (name) {
      const id = normalizeSessionTransport(name);
      const token = ++this._transportStartToken;

      const previous = this.transport;
      this.transport = null;
      this._transportStarting = true;
      if (previous) {
        try {
          await previous.destroy();
        } catch (error) {
          console.warn(
            "[SESSIONS] Could not stop the previous media transport:",
            error,
          );
        }
      }

      if (token !== this._transportStartToken) return false;

      this.transportName = id;
      const transport = createSessionTransport(id, this);
      this.transport = transport;

      try {
        await transport.connect();
        if (token !== this._transportStartToken) {
          await transport.destroy();
          return false;
        }

        this._transportStarting = false;
        this._transportFailedName = null;
        this._transportRetryAt = 0;
        this._transportFailureCount = 0;
        this.handleMediaRouting();
        return true;
      } catch (error) {
        if (token !== this._transportStartToken) return false;

        this._transportStarting = false;
        this.transport = null;

        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[SESSIONS] Could not start the ${id} media transport:`,
          error,
        );
        transport.setStatus("error", message);

        this._transportFailedName = id;
        const permanent = Boolean(error && error.permanent);
        this._transportFailureCount += 1;
        if (permanent) this._transportFailureCount = 3;
        this._transportRetryAt = permanent
          ? Date.now() + 60 * 60 * 1000
          : Date.now() +
            Math.min(30000 * 2 ** (this._transportFailureCount - 1), 120000);

        if (id !== "peerjs" && this.isHost) {
          document.dispatchEvent(
            new CustomEvent("Encore.Sessions.TransportFallback", {
              detail: {
                requested: id,
                transport: "peerjs",
                error: message,
              },
            }),
          );
          this.state.transport = "peerjs";
          return this.startTransport("peerjs");
        }

        return false;
      }
    },

    /**
     * Stops the active media transport without ending the Session.
     * @returns {Promise<void>}
     */
    stopTransport: async function () {
      this._transportStartToken++;
      this._transportStarting = false;
      this._transportFailedName = null;
      this._transportRetryAt = 0;
      this._transportFailureCount = 0;
      this._transportSyncPending = false;

      const transport = this.transport;
      this.transport = null;
      if (!transport) return;

      try {
        await transport.destroy();
      } catch (error) {
        console.warn("[SESSIONS] Could not stop the media transport:", error);
      }
    },

    /**
     * Aligns the local media transport with the transport stored in Session
     * state.
     * @returns {Promise<void>}
     */
    syncTransportFromState: async function () {
      if (this.isDisconnecting) return;

      const desired = normalizeSessionTransport(this.state.transport);
      if (desired === this.transportName && this.transport) return;

      if (this._transportStarting) {
        this._transportSyncPending = true;
        return;
      }

      if (desired === this._transportFailedName) {
        if (this._transportFailureCount >= 3) return;
        if (Date.now() < this._transportRetryAt) return;
      }

      await this.startTransport(desired);

      if (this._transportSyncPending) {
        this._transportSyncPending = false;
        void this.syncTransportFromState();
      }
    },

    /**
     * Changes the room media transport.
     * @param {string} name
     * @returns {Promise<boolean>} Whether the requested transport is active.
     */
    setTransport: async function (name) {
      if (!this.isHost) return false;

      const id = normalizeSessionTransport(name);
      if (id === this.transportName) return true;

      const started = await this.startTransport(id);
      this.state.transport = this.transportName;
      this.broadcastState();
      this.handleMediaRouting();
      return started;
    },

    /**
     * Returns the microphone stream used for Session audio. This bus can be
     * muted independently of the local karaoke mic.
     * @returns {MediaStream|null}
     */
    getSessionMicStream: function () {
      const forte = pkg.root?.Processes?.getService("ForteSvc")?.data;
      return (
        forte?.getSessionMicAudioStream?.() ||
        forte?.getMicAudioStream?.() ||
        null
      );
    },

    /**
     * Returns the shared Camera service, which owns the camera the user
     * configured in Setup.
     * @returns {object|null}
     */
    getCameraService: function () {
      return pkg.root?.Processes?.getService("CameraSvc")?.data || null;
    },

    /**
     * Checks whether a media stream still has a live video track.
     * @param {MediaStream|null} stream
     * @returns {boolean}
     */
    isCameraStreamLive: function (stream) {
      if (!stream?.getVideoTracks) return false;
      return stream
        .getVideoTracks()
        .some((track) => track.readyState === "live");
    },

    /**
     * Reads the physical camera device selected in Setup.
     * @returns {Promise<string>} The saved device id, or an empty string.
     */
    getConfiguredCameraDeviceId: async function () {
      try {
        return (
          (await window.config?.getItem?.("videoConfig.cameraDeviceId")) || ""
        );
      } catch (error) {
        console.warn("[SESSIONS] Could not read camera config:", error);
        return "";
      }
    },

    /**
     * Returns the camera sources currently published by this participant.
     * @returns {Array<"local"|"remote">}
     */
    getLocalCameraSources: function () {
      return ["local", "remote"].filter((source) =>
        this.isCameraStreamLive(this.cameraStreams[source]),
      );
    },

    /**
     * Keeps the published camera set in sync while a Session is active.
     */
    attachCameraSourceListeners: function () {
      if (!this._cameraStreamReceivedListener) {
        this._cameraStreamReceivedListener = (event) => {
          if (!this.cameraEnabled) return;

          const detail = event.detail || {};
          const source = detail.source === "remote" ? "remote" : "local";
          const stream = detail.stream;
          if (!this.isCameraStreamLive(stream)) return;
          if (this.cameraStreams[source] === stream) return;

          const previous = this.cameraStreams[source];
          this.cameraStreams[source] = stream;

          if (previous) this.transport?.handleCameraSourceChanged?.(source);
          this.publishCameraStatus();
        };

        document.addEventListener(
          "Encore.Camera.StreamReceived",
          this._cameraStreamReceivedListener,
        );
      }

      if (!this._cameraStreamEndedListener) {
        this._cameraStreamEndedListener = (event) => {
          if (this._cameraStopping || !this.cameraEnabled) return;

          const source = event.detail?.source === "remote" ? "remote" : "local";
          if (!this.cameraStreams[source]) return;

          delete this.cameraStreams[source];
          if (source === "local") this.cameraOwnsLocal = false;
          this.transport?.handleCameraSourceChanged?.(source);

          if (this.getLocalCameraSources().length === 0) {
            this.stopCamera(false, false);
          }
          this.publishCameraStatus();
        };

        document.addEventListener(
          "Encore.Camera.StreamEnded",
          this._cameraStreamEndedListener,
        );
      }
    },

    detachCameraSourceListeners: function () {
      if (this._cameraStreamReceivedListener) {
        document.removeEventListener(
          "Encore.Camera.StreamReceived",
          this._cameraStreamReceivedListener,
        );
        this._cameraStreamReceivedListener = null;
      }

      if (this._cameraStreamEndedListener) {
        document.removeEventListener(
          "Encore.Camera.StreamEnded",
          this._cameraStreamEndedListener,
        );
        this._cameraStreamEndedListener = null;
      }
    },

    initPeer: function (nickname, customId = null) {
      this.isDisconnecting = false;
      this.nickname = nickname;
      return new Promise((resolve, reject) => {
        this.peer = customId
          ? new Peer(customId, this.peerOptions)
          : new Peer(this.peerOptions);

        this.peer.on("open", (id) => resolve(id));
        this.peer.on("error", (err) => reject(err));

        this.peer.on("connection", (conn) => this.setupConnection(conn));

        this.peer.on("call", (call) =>
          this.transport?.handleIncomingCall(call),
        );
      });
    },

    /**
     * Creates a Session room.
     * @param {Object} profile - Singer profile.
     * @param {Function} collisionResolverFn - Nickname collision resolver.
     * @param {{transport?: string}} [options] - Room options.
     * @returns {Promise<string>} The room id.
     */
    hostRoom: async function (profile, collisionResolverFn, options = {}) {
      this.isHost = true;
      this.collisionResolver = collisionResolverFn;
      this.isMuted = false;
      this.cameraEnabled = false;
      this.cameraStreams = {};
      this.cameraOwnsLocal = false;
      this.applySessionMute(false);
      this.isDeafened = false;
      this.applySessionDeafened(false);

      const { code } = await this.createSessionCode(profile.nickname);
      const myId = await this.initPeer(profile.nickname, code);
      this.roomId = myId;

      this.transportName = normalizeSessionTransport(options.transport);
      this.state.transport = this.transportName;

      this.state.participants.push({
        id: myId,
        nickname: profile.nickname,
        avatar: profile.avatar,
        userId: profile.userId || null,
        userIdVerified: Boolean(profile.userIdVerified),
        accountType: profile.accountType || "guest",
        isHost: true,
        isRecording: false,
        isMuted: false,
        isDeafened: false,
        cameraEnabled: false,
        cameraSources: [],
        supportedGames: profile.supportedGames || [],
      });

      await this.startTransport(this.transportName);
      this.state.transport = this.transportName;

      this.broadcastState();
      this.handleMediaRouting();
      return myId;
    },

    joinRoom: async function (roomId, profile) {
      this.isHost = false;
      this.isMuted = false;
      this.cameraEnabled = false;
      this.cameraStreams = {};
      this.cameraOwnsLocal = false;
      this.applySessionMute(false);
      this.isDeafened = false;
      this.applySessionDeafened(false);
      const myId = await this.initPeer(profile.nickname);
      this.roomId = roomId;

      const conn = this.peer.connect(roomId, {
        metadata: { profile, protocolVersion: this.PROTOCOL_VERSION },
      });
      this.setupConnection(conn);

      return new Promise((resolve) => conn.on("open", () => resolve(myId)));
    },

    setupConnection: function (conn) {
      conn.on("open", () => {
        if (this.isHost) {
          const incomingProtocol = conn.metadata?.protocolVersion || 0;
          if (incomingProtocol !== this.PROTOCOL_VERSION) {
            console.warn(
              `[SESSIONS] Rejected peer ${conn.peer} due to protocol mismatch. Expected ${this.PROTOCOL_VERSION}, got ${incomingProtocol}`,
            );
            conn.send({ type: "kicked", reason: "version_mismatch" });
            setTimeout(() => conn.close(), 500);
            return;
          }
        }

        this.connections.set(conn.peer, conn);
        if (this.isHost) {
          const incomingProfile = conn.metadata.profile || {
            nickname: conn.metadata.nickname || "Guest",
          };

          if (
            this.state.transport === "livekit" &&
            !incomingProfile.userIdVerified
          ) {
            console.warn(
              `[SESSIONS] Rejected peer ${conn.peer}: this LiveKit Session requires an Encore account.`,
            );
            this.connections.delete(conn.peer);
            conn.send({ type: "kicked", reason: "account_required" });
            setTimeout(() => conn.close(), 500);
            return;
          }

          const existingNames = this.state.participants.map((p) => p.nickname);

          let uniqueName = incomingProfile.nickname || "Guest";

          if (typeof this.collisionResolver === "function") {
            uniqueName = this.collisionResolver(uniqueName, existingNames);
          }

          this.state.participants.push({
            id: conn.peer,
            nickname: uniqueName,
            avatar: incomingProfile.avatar || null,
            userId: incomingProfile.userId || null,
            userIdVerified: Boolean(incomingProfile.userIdVerified),
            accountType: incomingProfile.accountType || "guest",
            isHost: false,
            isRecording: false,
            isMuted: false,
            isDeafened: false,
            cameraEnabled: false,
            cameraSources: [],
            supportedGames: incomingProfile.supportedGames || [],
          });
          this.broadcastState();
          this.handleMediaRouting();

          // A peer joining mid-performance needs the timed lyric bundle.
          if (this.state.mode === "performance" && this.state.singerId) {
            if (this.state.singerId === this.peer.id) {
              document.dispatchEvent(
                new CustomEvent("Encore.Sessions.LyricsRequest"),
              );
            } else {
              const singerConn = this.connections.get(this.state.singerId);
              if (singerConn && singerConn.open) {
                singerConn.send({ type: "lyrics_request" });
              }
            }
          }
        }

        if (conn.peerConnection) {
          conn.peerConnection.oniceconnectionstatechange = () => {
            const state = conn.peerConnection.iceConnectionState;
            if (
              state === "disconnected" ||
              state === "failed" ||
              state === "closed"
            ) {
              this.handlePeerDisconnect(conn.peer);
            }
          };
        }
      });

      conn.on("data", (data) => {
        if (data.type === "state_sync") {
          if (!this.isHost && data.protocolVersion !== this.PROTOCOL_VERSION) {
            console.warn(
              `[SESSIONS] Protocol mismatch with host. Expected ${this.PROTOCOL_VERSION}, got ${data.protocolVersion}`,
            );
            this.leaveRoom();
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.Kicked", {
                detail: "version_mismatch",
              }),
            );
            return;
          }

          const prevChatLength = this.state.chatHistory
            ? this.state.chatHistory.length
            : 0;
          this.state = data.state;

          document.dispatchEvent(
            new CustomEvent("Encore.Sessions.StateUpdate", {
              detail: this.state,
            }),
          );

          if (
            this.state.chatHistory &&
            this.state.chatHistory.length > prevChatLength
          ) {
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.ChatHistorySync", {
                detail: this.state.chatHistory,
              }),
            );
          }

          void this.syncTransportFromState();
          this.handleMediaRouting();
        } else if (data.type === "profile_update" && this.isHost) {
          const participant = this.state.participants.find(
            (entry) => entry.id === conn.peer,
          );
          if (participant) {
            const nickname =
              typeof data.profile?.nickname === "string"
                ? data.profile.nickname.trim().slice(0, 15)
                : "";
            const avatar =
              typeof data.profile?.avatar === "string" && data.profile.avatar
                ? data.profile.avatar
                : null;

            if (nickname) participant.nickname = nickname;
            participant.avatar = avatar;
            this.broadcastState();
          }
        } else if (data.type === "recording_status" && this.isHost) {
          this.setParticipantRecording(conn.peer, data.recording);
        } else if (data.type === "camera_status" && this.isHost) {
          this.setParticipantCamera(conn.peer, data.camera);
        } else if (data.type === "mute_status" && this.isHost) {
          this.setParticipantMuted(conn.peer, data.muted);
        } else if (data.type === "deafen_status" && this.isHost) {
          this.setParticipantDeafened(conn.peer, data.deafened);
        } else if (data.type === "reserve_song" && this.isHost) {
          const requesterNickname = conn.metadata.profile
            ? conn.metadata.profile.nickname
            : conn.metadata.nickname;
          this.state.queue.push({
            ...data.song,
            requesterId: conn.peer,
            requesterNickname: requesterNickname || "Guest",
          });
          if (this.state.mode === "lounge") {
            this.advanceQueue();
          } else {
            this.broadcastState();
          }
        } else if (data.type === "song_ended" && this.isHost) {
          if (
            this.state.mode === "performance" &&
            this.state.singerId === conn.peer
          ) {
            this.advanceQueue();
          }
        } else if (data.type === "kicked") {
          if (!this.isHost && conn.peer === this.roomId) {
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.Kicked", {
                detail: data.reason,
              }),
            );
          }
        } else if (data.type === "force_stop") {
          if (!this.isHost && conn.peer === this.roomId) {
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.ForceStop"),
            );
          }
        } else if (data.type === "submit_score") {
          if (this.isHost) {
            const entry = { ...data.entry };
            const participant =
              this.state.participants.find((p) => p.id === conn.peer) ||
              this.state.participants.find(
                (p) => p.id === this.state.nowPlaying?.requesterId,
              );
            if (participant) {
              entry.singerName = participant.nickname || entry.singerName;
              entry.avatar = participant.avatar || entry.avatar;
            }

            this.state.leaderboard.push(entry);
            this.state.leaderboard.sort((a, b) => b.score - a.score);
            if (this.state.leaderboard.length > 20)
              this.state.leaderboard.length = 20;

            this.broadcastState();

            const scoreEvent = { type: "remote_score", entry: entry };
            for (let c of this.connections.values()) {
              if (c.open) c.send(scoreEvent);
            }
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.RemoteScore", {
                detail: scoreEvent,
              }),
            );
          }
        } else if (data.type === "remote_score") {
          if (!this.isHost) {
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.RemoteScore", {
                detail: data,
              }),
            );
          }
        } else if (data.type === "skip_score") {
          document.dispatchEvent(new CustomEvent("Encore.Sessions.SkipScore"));
          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }
        } else if (data.type === "chat_message" || data.type === "cheer") {
          document.dispatchEvent(
            new CustomEvent(
              `Encore.Sessions.${data.type === "chat_message" ? "Chat" : "Cheer"}`,
              { detail: data },
            ),
          );

          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }
        } else if (data.type === "plugin_data") {
          document.dispatchEvent(
            new CustomEvent("Encore.Sessions.PluginData", { detail: data }),
          );
          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }
        } else if (data.type === "lyrics_data" || data.type === "lyrics_time") {
          if (
            this.state.singerId &&
            data.senderId &&
            data.senderId !== this.state.singerId
          ) {
            return;
          }

          // The host relays the current singer's lyrics to the rest of the room.
          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }

          if (data.senderId !== this.peer.id) {
            document.dispatchEvent(
              new CustomEvent(
                data.type === "lyrics_time"
                  ? "Encore.Sessions.LyricsTime"
                  : "Encore.Sessions.LyricsData",
                { detail: data.payload },
              ),
            );
          }
        } else if (data.type === "lyrics_data_chunk") {
          if (
            this.state.singerId &&
            data.senderId &&
            data.senderId !== this.state.singerId
          ) {
            return;
          }

          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }

          this.receiveLyricsChunk(data);
        } else if (data.type === "lyrics_request") {
          if (
            this.state.mode === "performance" &&
            this.state.singerId === this.peer.id
          ) {
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.LyricsRequest"),
            );
          }
        } else if (data.type === "track_info") {
          if (
            this.state.singerId &&
            data.senderId &&
            data.senderId !== this.state.singerId
          ) {
            return;
          }

          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }

          if (data.senderId !== this.peer.id) {
            document.dispatchEvent(
              new CustomEvent("Encore.Sessions.TrackInfo", {
                detail: data.payload,
              }),
            );
          }
        } else if (
          data.type === "pianoroll_data" ||
          data.type === "pianoroll_notes" ||
          data.type === "pianoroll_state"
        ) {
          if (
            this.state.singerId &&
            data.senderId &&
            data.senderId !== this.state.singerId
          ) {
            return;
          }

          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }

          if (data.senderId !== this.peer.id) {
            const eventName =
              data.type === "pianoroll_data"
                ? "Encore.Sessions.PianoRollData"
                : data.type === "pianoroll_notes"
                  ? "Encore.Sessions.PianoRollNotes"
                  : "Encore.Sessions.PianoRollState";

            document.dispatchEvent(
              new CustomEvent(eventName, { detail: data.payload }),
            );
          }
        } else if (data.type === "pianoroll_data_chunk") {
          if (
            this.state.singerId &&
            data.senderId &&
            data.senderId !== this.state.singerId
          ) {
            return;
          }

          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }

          this.receivePianoRollChunk(data);
        }
      });

      conn.on("close", () => this.handlePeerDisconnect(conn.peer));
      conn.on("error", () => this.handlePeerDisconnect(conn.peer));
    },

    /**
     * Enables or disables the local Session camera.
     * @param {boolean} enabled - Whether to start the camera.
     * @returns {Promise<boolean>} Whether the requested state was applied.
     */
    setCameraEnabled: async function (enabled) {
      const next = Boolean(enabled);

      if (!next) {
        const wasEnabled =
          this.cameraEnabled || this.getLocalCameraSources().length > 0;
        this.stopCamera(false);
        if (wasEnabled) this.publishCameraStatus();
        return true;
      }

      if (this.cameraEnabled && this.getLocalCameraSources().length > 0) {
        return true;
      }

      const cameraSvc = this.getCameraService();
      if (!cameraSvc) {
        throw new Error("Camera service is not available.");
      }

      this.stopCamera(false);
      const token = (this.cameraStartToken = this.cameraStartToken + 1);

      let ownsLocal = false;

      try {
        const activeSources = new Set(
          (cameraSvc.getActiveCameras?.() || [])
            .filter((camera) => this.isCameraStreamLive(camera.stream))
            .map((camera) => camera.source),
        );

        if (!activeSources.has("local")) {
          const deviceId = await this.getConfiguredCameraDeviceId();
          ownsLocal = true;
          this._cameraStopping = true;
          try {
            await cameraSvc.startLocal?.(deviceId || undefined);
          } catch (error) {
            ownsLocal = false;
            console.warn("[SESSIONS] Physical camera unavailable:", error);
          } finally {
            this._cameraStopping = false;
          }
        }

        if (token !== this.cameraStartToken) {
          if (ownsLocal) cameraSvc.stopLocal?.(false);
          return false;
        }

        const cameras = (cameraSvc.getActiveCameras?.() || []).filter(
          (camera) => this.isCameraStreamLive(camera.stream),
        );

        if (cameras.length === 0) {
          if (ownsLocal) cameraSvc.stopLocal?.(false);
          throw new Error(
            "No camera is available. Connect a camera or your phone.",
          );
        }

        this.cameraStreams = {};
        for (const camera of cameras) {
          this.cameraStreams[camera.source] = camera.stream;
        }
        this.cameraEnabled = true;
        this.cameraOwnsLocal = ownsLocal;
        this.attachCameraSourceListeners();
        this.publishCameraStatus();
        return true;
      } catch (error) {
        if (ownsLocal) cameraSvc.stopLocal?.(false);
        if (token === this.cameraStartToken) {
          this.cameraEnabled = false;
          this.cameraStreams = {};
          this.publishCameraStatus();
        }
        throw error;
      }
    },

    /**
     * Stops every published Session camera and tears down its outgoing calls.
     * @param {boolean} notify - Whether to announce the state change.
     * @param {boolean} releaseSource - Whether to stop a physical camera that
     *   this Session started. Cameras already running for BGV are left alone.
     */
    stopCamera: function (notify = true, releaseSource = true) {
      this.cameraStartToken += 1;
      this.transport?.closeOutgoingCameraCalls?.();

      const cameraSvc = this.getCameraService();
      const ownsLocal = this.cameraOwnsLocal;

      this.cameraStreams = {};
      this.cameraEnabled = false;
      this.cameraOwnsLocal = false;

      if (releaseSource && ownsLocal && cameraSvc?.stopLocal) {
        this._cameraStopping = true;
        try {
          cameraSvc.stopLocal();
        } catch (error) {
          console.warn("[SESSIONS] Could not stop the Session camera:", error);
        } finally {
          this._cameraStopping = false;
        }
      }

      this.detachCameraSourceListeners();

      if (notify) {
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.CameraStateUpdate", {
            detail: {
              cameraEnabled: false,
              cameraSources: [],
              isMuted: this.isMuted,
            },
          }),
        );
      }
    },

    /**
     * Enables or disables the local Session microphone without muting the
     * local karaoke monitoring path.
     * @param {boolean} muted - Whether the Session mic should be muted.
     */
    setMuted: function (muted) {
      const next = Boolean(muted);
      this.isMuted = next;
      this.applySessionMute(next);

      if (!next && this.isDeafened) {
        this.isDeafened = false;
        this.applySessionDeafened(false);
        this.publishLocalDeafenState();
      }

      const myId = this.peer?.id;
      const self = this.state.participants.find((p) => p.id === myId);
      if (self) self.isMuted = next;

      if (this.isHost) {
        this.broadcastState();
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) {
          hostConn.send({ type: "mute_status", muted: next });
        }
      }

      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.CameraStateUpdate", {
          detail: {
            cameraEnabled: this.cameraEnabled,
            cameraSources: this.getLocalCameraSources(),
            isMuted: next,
          },
        }),
      );
    },

    applySessionMute: function (muted) {
      const forte = pkg.root?.Processes?.getService("ForteSvc")?.data;
      forte?.setSessionMicMuted?.(Boolean(muted));
    },

    /**
     * Silences incoming Lounge / "everyone audible" voice streams locally.
     * @param {boolean} deafened - Whether Session voices should be muted.
     */
    setDeafened: function (deafened) {
      const next = Boolean(deafened);
      this.isDeafened = next;
      this.applySessionDeafened(next);
      this.publishLocalDeafenState();

      if (next && !this.isMuted) {
        this.setMuted(true);
      }
    },

    /**
     * Mirrors the local deafen state onto this participant and informs the room.
     */
    publishLocalDeafenState: function () {
      const myId = this.peer?.id;
      const self = this.state.participants.find((p) => p.id === myId);
      if (self) self.isDeafened = Boolean(this.isDeafened);

      if (this.isHost) {
        this.broadcastState();
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) {
          hostConn.send({
            type: "deafen_status",
            deafened: Boolean(this.isDeafened),
          });
        }
      }
    },

    applySessionDeafened: function (deafened) {
      const forte = pkg.root?.Processes?.getService("ForteSvc")?.data;
      forte?.setSessionDeafened?.(Boolean(deafened));
    },

    publishCameraStatus: function () {
      const sources = this.getLocalCameraSources();
      const enabled = sources.length > 0;

      const myId = this.peer?.id;
      const self = this.state.participants.find((p) => p.id === myId);
      if (self) {
        self.cameraEnabled = enabled;
        self.cameraSources = sources;
      }

      if (this.isHost) {
        this.broadcastState();
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) {
          hostConn.send({ type: "camera_status", camera: sources });
        }
      }

      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.CameraStateUpdate", {
          detail: {
            cameraEnabled: enabled,
            cameraSources: sources,
            isMuted: this.isMuted,
          },
        }),
      );

      this.handleMediaRouting();
    },

    /**
     * Host-side update of a participant's camera indicators.
     * @param {string} peerId - Participant peer id.
     * @param {Array<"local"|"remote">|boolean} cameras - Published sources.
     */
    setParticipantCamera: function (peerId, cameras) {
      if (!this.isHost) return;

      const participant = this.state.participants.find((p) => p.id === peerId);
      if (!participant) return;

      const list = Array.isArray(cameras)
        ? cameras.filter((source) => source === "local" || source === "remote")
        : cameras
          ? ["local"]
          : [];
      const next = Array.from(new Set(list)).sort();

      const current = Array.isArray(participant.cameraSources)
        ? [...participant.cameraSources].sort()
        : [];
      if (JSON.stringify(current) === JSON.stringify(next)) return;

      participant.cameraSources = next;
      participant.cameraEnabled = next.length > 0;
      this.broadcastState();
    },

    /**
     * Host-side update of a participant's microphone mute indicator.
     * @param {string} peerId - Participant peer id.
     * @param {boolean} muted - Whether their Session mic is muted.
     */
    setParticipantMuted: function (peerId, muted) {
      if (!this.isHost) return;

      const participant = this.state.participants.find((p) => p.id === peerId);
      if (!participant) return;

      const next = Boolean(muted);
      if (Boolean(participant.isMuted) === next) return;

      participant.isMuted = next;
      this.broadcastState();
    },

    /**
     * Host-side update of a participant's deafen indicator.
     * @param {string} peerId - Participant peer id.
     * @param {boolean} deafened - Whether they have deafened Session voices.
     */
    setParticipantDeafened: function (peerId, deafened) {
      if (!this.isHost) return;

      const participant = this.state.participants.find((p) => p.id === peerId);
      if (!participant) return;

      const next = Boolean(deafened);
      if (Boolean(participant.isDeafened) === next) return;

      participant.isDeafened = next;
      this.broadcastState();
    },

    handlePeerDisconnect: function (peerId) {
      if (this.isDisconnecting) return;
      if (!this.connections.has(peerId)) return;

      console.log(`[SESSIONS] Peer disconnected: ${peerId}`);

      const conn = this.connections.get(peerId);
      if (conn) conn.close();
      this.connections.delete(peerId);

      this.transport?.handlePeerLeft(peerId);

      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.PeerDisconnected", {
          detail: peerId,
        }),
      );

      if (!this.isHost && peerId === this.roomId) {
        this.leaveRoom();
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.HostDisconnected"),
        );
      } else if (this.isHost) {
        this.state.participants = this.state.participants.filter(
          (p) => p.id !== peerId,
        );

        this.state.queue = this.state.queue.filter(
          (song) => song.requesterId !== peerId,
        );

        if (
          this.state.mode === "performance" &&
          this.state.singerId === peerId
        ) {
          console.log(
            "[SESSIONS] Singer disconnected during performance. Skipping to next.",
          );
          this.advanceQueue();
        } else {
          this.broadcastState();
          this.handleMediaRouting(true);
        }
      }
    },

    kickParticipant: function (peerId) {
      if (!this.isHost) return;
      const conn = this.connections.get(peerId);
      if (conn && conn.open) {
        conn.send({ type: "kicked", reason: "manual" });
        setTimeout(() => this.handlePeerDisconnect(peerId), 500);
      } else {
        this.handlePeerDisconnect(peerId);
      }
    },

    skipCurrentSong: function () {
      if (!this.isHost) return;
      if (this.state.mode === "performance") {
        for (let conn of this.connections.values()) {
          if (conn.open) conn.send({ type: "force_stop" });
        }
        this.advanceQueue();
      }
    },

    /**
     * Enables or disables audience microphones during performances.
     * @param {boolean} enabled - Whether everyone should be audible.
     */
    setEveryoneAudible: function (enabled) {
      if (!this.isHost) return;

      const nextValue = Boolean(enabled);
      if (this.state.everyoneAudible === nextValue) return;

      this.state.everyoneAudible = nextValue;
      this.broadcastState();
      this.handleMediaRouting();
    },

    /**
     * Publishes whether this participant is currently recording.
     *
     * @param {boolean} recording - Whether this participant is recording.
     */
    setRecordingStatus: function (recording) {
      const nextValue = Boolean(recording);
      const myId = this.peer?.id;
      const self = this.state.participants.find((p) => p.id === myId);

      if (self) self.isRecording = nextValue;

      if (this.isHost) {
        this.broadcastState();
        return;
      }

      const hostConn = this.connections.get(this.roomId);
      if (hostConn && hostConn.open) {
        hostConn.send({ type: "recording_status", recording: nextValue });
      }
    },

    /**
     * Host-side update of a participant's recording indicator.
     *
     * @param {string} peerId - Participant peer id.
     * @param {boolean} recording - Whether they are recording.
     */
    setParticipantRecording: function (peerId, recording) {
      if (!this.isHost) return;

      const participant = this.state.participants.find((p) => p.id === peerId);
      if (!participant) return;

      const nextValue = Boolean(recording);
      if (Boolean(participant.isRecording) === nextValue) return;

      participant.isRecording = nextValue;
      this.broadcastState();
    },

    /**
     * Applies the locally saved singer profile to this participant and shares
     * it with the active Session.
     * @param {{nickname?: string, avatar?: string|null}} profile
     */
    updateLocalProfile: function (profile) {
      const myId = this.peer?.id;
      if (!myId) return;

      const nickname =
        typeof profile?.nickname === "string" ? profile.nickname.trim() : "";
      if (!nickname) return;

      const avatar =
        typeof profile?.avatar === "string" && profile.avatar
          ? profile.avatar
          : null;

      this.nickname = nickname.slice(0, 15);

      const participant = this.state.participants.find((p) => p.id === myId);
      if (!participant) return;
      if (
        participant.nickname === this.nickname &&
        participant.avatar === avatar
      ) {
        return;
      }

      participant.nickname = this.nickname;
      participant.avatar = avatar;

      if (this.isHost) {
        this.broadcastState();
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) {
          hostConn.send({
            type: "profile_update",
            profile: { nickname: this.nickname, avatar },
          });
        }
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.StateUpdate", {
            detail: this.state,
          }),
        );
      }
    },

    advanceQueue: function () {
      if (!this.isHost) return;

      if (this.state.queue.length > 0) {
        this.state.nowPlaying = this.state.queue.shift();
        this.state.mode = "performance";
        this.state.singerId = this.state.nowPlaying.requesterId;
        this.state.playTrigger = Date.now();
      } else {
        this.state.nowPlaying = null;
        this.state.mode = "lounge";
        this.state.singerId = null;
      }
      this.broadcastState();
      this.handleMediaRouting();
    },

    broadcastState: function () {
      if (!this.isHost) return;
      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.StateUpdate", {
          detail: this.state,
        }),
      );
      for (let conn of this.connections.values()) {
        if (conn.open)
          conn.send({
            type: "state_sync",
            state: this.state,
            protocolVersion: this.PROTOCOL_VERSION,
          });
      }
    },

    broadcastChat: function (sender, text) {
      const data = { type: "chat_message", sender, text };

      if (!this.state.chatHistory) this.state.chatHistory = [];
      this.state.chatHistory.push(data);
      if (this.state.chatHistory.length > 100) this.state.chatHistory.shift();

      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.Chat", { detail: data }),
      );

      if (this.isHost) {
        for (let conn of this.connections.values()) {
          if (conn.open) conn.send(data);
        }
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) hostConn.send(data);
      }
    },

    broadcastCheer: function (sender, text) {
      const data = { type: "cheer", sender, text };
      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.Cheer", { detail: data }),
      );

      if (this.isHost) {
        for (let conn of this.connections.values()) {
          if (conn.open) conn.send(data);
        }
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) hostConn.send(data);
      }
    },

    broadcastSkipScore: function () {
      const data = { type: "skip_score" };
      if (this.isHost) {
        for (let conn of this.connections.values()) {
          if (conn.open) conn.send(data);
        }
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) hostConn.send(data);
      }
    },

    broadcastPluginData: function (pluginId, payload) {
      const data = { type: "plugin_data", pluginId, payload };

      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.PluginData", { detail: data }),
      );

      if (this.isHost) {
        for (let conn of this.connections.values()) {
          if (conn.open) conn.send(data);
        }
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) hostConn.send(data);
      }
    },

    /**
     * Shares the complete timed lyric bundle with the room.
     */
    broadcastLyricsData: function (payload) {
      if (!this.canBroadcastSessionLyrics()) return;

      const json = JSON.stringify(payload ?? null);
      if (json.length <= this.LYRICS_CHUNK_SIZE) {
        this.sendSessionLyrics({
          type: "lyrics_data",
          senderId: this.peer.id,
          payload,
        });
        return;
      }

      const id = `${this.peer.id}-${Date.now()}`;
      const total = Math.ceil(json.length / this.LYRICS_CHUNK_SIZE);
      for (let index = 0; index < total; index++) {
        this.sendSessionLyrics({
          type: "lyrics_data_chunk",
          senderId: this.peer.id,
          id: id,
          index: index,
          total: total,
          chunk: json.slice(
            index * this.LYRICS_CHUNK_SIZE,
            (index + 1) * this.LYRICS_CHUNK_SIZE,
          ),
        });
      }
    },

    /**
     * Shares the singer's playback position together with the current tempo.
     */
    broadcastLyricsTime: function (currentTime, tempo = 1) {
      if (!this.canBroadcastSessionLyrics()) return;
      this.sendSessionLyrics({
        type: "lyrics_time",
        senderId: this.peer.id,
        payload: {
          time: currentTime,
          tempo: Number(tempo) || 1,
        },
      });
    },

    /**
     * Shares the current song's key and tempo.
     */
    broadcastTrackInfo: function (info) {
      if (!this.canBroadcastSessionLyrics()) return;
      this.sendSessionLyrics({
        type: "track_info",
        senderId: this.peer.id,
        payload: info,
      });
    },

    /**
     * Shares the performer's complete piano roll note chart with the room.
     */
    broadcastPianoRollData: function (payload) {
      if (!this.canBroadcastSessionLyrics()) return;

      const json = JSON.stringify(payload ?? null);
      if (json.length <= this.PIANOROLL_CHUNK_SIZE) {
        this.sendSessionLyrics({
          type: "pianoroll_data",
          senderId: this.peer.id,
          payload,
        });
        return;
      }

      const id = `${this.peer.id}-pr-${Date.now()}`;
      const total = Math.ceil(json.length / this.PIANOROLL_CHUNK_SIZE);
      for (let index = 0; index < total; index++) {
        this.sendSessionLyrics({
          type: "pianoroll_data_chunk",
          senderId: this.peer.id,
          id: id,
          index: index,
          total: total,
          chunk: json.slice(
            index * this.PIANOROLL_CHUNK_SIZE,
            (index + 1) * this.PIANOROLL_CHUNK_SIZE,
          ),
        });
      }
    },

    /**
     * Shares notes that became available after the initial piano roll bundle
     * (e.g. multiplexed guide analysis during playback).
     */
    broadcastPianoRollNotes: function (payload) {
      if (!this.canBroadcastSessionLyrics()) return;
      this.sendSessionLyrics({
        type: "pianoroll_notes",
        senderId: this.peer.id,
        payload,
      });
    },

    /**
     * Shares the performer's live piano roll state (position, pitch, score).
     */
    broadcastPianoRollState: function (payload) {
      if (!this.canBroadcastSessionLyrics()) return;
      this.sendSessionLyrics({
        type: "pianoroll_state",
        senderId: this.peer.id,
        payload,
      });
    },

    /** Whether this peer is currently the performing singer. */
    canBroadcastSessionLyrics: function () {
      if (!this.peer) return false;
      return (
        this.state.mode === "performance" &&
        this.state.singerId === this.peer.id
      );
    },

    sendSessionLyrics: function (data) {
      if (this.isHost) {
        for (let conn of this.connections.values()) {
          if (conn.open) conn.send(data);
        }
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) hostConn.send(data);
      }
    },

    /** Reassembles a chunked lyric bundle and dispatches it when complete. */
    receiveLyricsChunk: function (data) {
      if (!this._lyricsChunkBuffers) this._lyricsChunkBuffers = new Map();

      let buffer = this._lyricsChunkBuffers.get(data.id);
      if (!buffer) {
        buffer = {
          total: data.total,
          parts: new Array(data.total),
          received: 0,
        };
        this._lyricsChunkBuffers.set(data.id, buffer);
      }

      if (buffer.parts[data.index] === undefined) {
        buffer.parts[data.index] = data.chunk;
        buffer.received++;
      }
      if (buffer.received < buffer.total) return;

      this._lyricsChunkBuffers.delete(data.id);
      if (data.senderId === this.peer.id) return;

      try {
        const payload = JSON.parse(buffer.parts.join(""));
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.LyricsData", { detail: payload }),
        );
      } catch (err) {
        console.warn("[SESSIONS] Failed to assemble lyrics payload:", err);
      }
    },

    /** Reassembles a chunked piano roll bundle and dispatches it. */
    receivePianoRollChunk: function (data) {
      if (!this._pianoRollChunkBuffers) this._pianoRollChunkBuffers = new Map();

      let buffer = this._pianoRollChunkBuffers.get(data.id);
      if (!buffer) {
        buffer = {
          total: data.total,
          parts: new Array(data.total),
          received: 0,
        };
        this._pianoRollChunkBuffers.set(data.id, buffer);
      }

      if (buffer.parts[data.index] === undefined) {
        buffer.parts[data.index] = data.chunk;
        buffer.received++;
      }
      if (buffer.received < buffer.total) return;

      this._pianoRollChunkBuffers.delete(data.id);
      if (data.senderId === this.peer.id) return;

      try {
        const payload = JSON.parse(buffer.parts.join(""));
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.PianoRollData", {
            detail: payload,
          }),
        );
      } catch (err) {
        console.warn("[SESSIONS] Failed to assemble piano roll payload:", err);
      }
    },

    requestSong: function (song) {
      if (this.isHost) {
        this.state.queue.push({
          ...song,
          requesterId: this.peer.id,
          requesterNickname: this.nickname,
        });
        if (this.state.mode === "lounge") this.advanceQueue();
        else this.broadcastState();
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open)
          hostConn.send({ type: "reserve_song", song });
      }
    },

    submitScore: function (score, songTitle, details = null) {
      const p =
        this.state.participants.find((part) => part.id === this.peer?.id) ||
        this.state.participants.find(
          (part) => part.id === this.state.nowPlaying?.requesterId,
        );

      const identity = pkg.root?.Processes?.getService?.("IdentitySvc")?.data;
      const profile = identity?.getProfile?.();

      const entry = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        singerName:
          p?.nickname ||
          this.state.nowPlaying?.requesterNickname ||
          profile?.nickname ||
          this.nickname ||
          "Singer",
        avatar: p?.avatar || profile?.avatar || null,
        userId: p?.userId || profile?.userId || null,
        songTitle: songTitle || "Unknown Song",
        score: score,
        details: details,
      };

      if (this.isHost) {
        this.state.leaderboard.push(entry);
        this.state.leaderboard.sort((a, b) => b.score - a.score);
        if (this.state.leaderboard.length > 20)
          this.state.leaderboard.length = 20;

        this.broadcastState();

        const scoreEvent = { type: "remote_score", entry: entry };
        for (let c of this.connections.values()) {
          if (c.open) c.send(scoreEvent);
        }
      } else {
        const hostConn = this.connections.get(this.roomId);
        if (hostConn && hostConn.open) {
          hostConn.send({ type: "submit_score", entry });
        }

        this.state.leaderboard.push(entry);
        this.state.leaderboard.sort((a, b) => b.score - a.score);
        if (this.state.leaderboard.length > 20) {
          this.state.leaderboard.length = 20;
        }
      }
      return entry.id;
    },

    handleMediaRouting: function () {
      if (this._routing || !this.peer) return;

      this._routing = true;
      try {
        this.routeMedia();
      } finally {
        this._routing = false;
      }
    },

    /**
     * Reconciles every media call with the current Session state.
     */
    routeMedia: function () {
      const hasBaseline = this._lastRoutedMode !== null;
      const modeChanged =
        hasBaseline && this._lastRoutedMode !== this.state.mode;
      const playTriggerChanged =
        hasBaseline && this._lastPlayTrigger !== this.state.playTrigger;
      const audibleChanged =
        hasBaseline &&
        this._lastRoutedEveryoneAudible !== this.state.everyoneAudible;

      this._lastRoutedMode = this.state.mode;
      this._lastPlayTrigger = this.state.playTrigger;
      this._lastRoutedEveryoneAudible = this.state.everyoneAudible;

      if (modeChanged || playTriggerChanged) {
        document.dispatchEvent(new CustomEvent("Encore.Sessions.ClearStreams"));
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.LyricsData", { detail: null }),
        );
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.PianoRollData", { detail: null }),
        );
        this.currentPerformanceStream = null;
      }

      this.transport?.reconcile({
        modeChanged,
        playTriggerChanged,
        audibleChanged,
      });
    },

    broadcastPerformance: function (mediaStream) {
      this.currentPerformanceStream = mediaStream;
      this.handleMediaRouting();
    },

    resetState: function () {
      this.roomId = null;
      this.isHost = false;
      this.connections.clear();

      void this.stopTransport();
      this.transportName = "peerjs";
      this.transport = null;
      this.state.transport = "peerjs";

      this.currentPerformanceStream = null;
      this._lastRoutedMode = null;
      this._lastPlayTrigger = null;
      this._lastRoutedEveryoneAudible = null;
      this._routing = false;
      this.isDisconnecting = false;
      this.collisionResolver = null;

      this.stopCamera(false);
      this.isMuted = false;
      this.applySessionMute(false);
      this.isDeafened = false;
      this.applySessionDeafened(false);

      if (this._lyricsChunkBuffers) this._lyricsChunkBuffers.clear();
      if (this._pianoRollChunkBuffers) this._pianoRollChunkBuffers.clear();

      this.state = {
        mode: "lounge",
        singerId: null,
        nowPlaying: null,
        playTrigger: null,
        everyoneAudible: false,
        transport: "peerjs",
        queue: [],
        participants: [],
        chatHistory: [],
        leaderboard: [],
      };

      console.log("[SESSIONS] Service state has been reset to default.");
      document.dispatchEvent(new CustomEvent("Encore.Sessions.ClearStreams"));
      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.CameraStateUpdate", {
          detail: { cameraEnabled: false, cameraSources: [], isMuted: false },
        }),
      );
      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.LyricsData", { detail: null }),
      );
      document.dispatchEvent(
        new CustomEvent("Encore.Sessions.PianoRollData", { detail: null }),
      );
    },

    leaveRoom: function () {
      this.isDisconnecting = true;
      if (this.peer) {
        this.peer.destroy();
        this.peer = null;
      }
      this.resetState();
    },
  },
};
export default pkg;
