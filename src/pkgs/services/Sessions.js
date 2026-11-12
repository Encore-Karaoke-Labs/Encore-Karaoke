import { Peer } from "peerjs";

const pkg = {
  name: "Encore Sessions Service",
  svcName: "SessionsSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;
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
    PROTOCOL_VERSION: 4,
    SESSION_ID_LENGTH: 16,
    CHECKSUM_LENGTH: 4,
    LYRICS_CHUNK_SIZE: 48000,
    PIANOROLL_CHUNK_SIZE: 48000,

    peer: null,
    roomId: null,
    isHost: false,
    nickname: "Guest",
    connections: new Map(),
    mediaCalls: new Map(),
    micCalls: new Map(),
    _lastRoutedMode: null,
    _lastRoutedEveryoneAudible: null,

    state: {
      mode: "lounge",
      singerId: null,
      nowPlaying: null,
      playTrigger: null,
      everyoneAudible: false,
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

    enhanceSDP: function (sdp) {
      let newSdp = sdp;
      newSdp = newSdp.replace(
        /useinbandfec=1/g,
        "useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=160000",
      );
      return newSdp;
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

        this.peer.on("call", (call) => {
          const callKind = call.metadata?.kind;
          const isPerformanceCall =
            callKind === "performance" ||
            (this.state.mode === "performance" &&
              call.peer === this.state.singerId);
          const isMicCall =
            this.state.mode === "performance" &&
            this.state.everyoneAudible &&
            (callKind === "mic" || !isPerformanceCall);

          if (isPerformanceCall) {
            call.answer(undefined, {
              sdpTransform: (sdp) => this.enhanceSDP(sdp),
            });
            call.on("stream", (remoteStream) => {
              document.dispatchEvent(
                new CustomEvent("Encore.Sessions.RemoteStream", {
                  detail: remoteStream,
                }),
              );
            });
            this.mediaCalls.set(call.peer, call);
          } else if (isMicCall) {
            if (this.peer.id === this.state.singerId) {
              call.answer(undefined);
            } else {
              const forteSvc = pkg.root.Processes.getService("ForteSvc").data;
              call.answer(forteSvc.getMicAudioStream());
            }
            this.attachMicCall(call.peer, call);
          } else if (this.state.mode === "lounge") {
            const forteSvc = pkg.root.Processes.getService("ForteSvc").data;
            call.answer(forteSvc.getMicAudioStream());
            call.on("stream", (remoteStream) => {
              document.dispatchEvent(
                new CustomEvent("Encore.Sessions.LoungeStream", {
                  detail: { id: call.peer, stream: remoteStream },
                }),
              );
            });
            this.mediaCalls.set(call.peer, call);
          }
        });
      });
    },

    hostRoom: async function (profile, collisionResolverFn) {
      this.isHost = true;
      this.collisionResolver = collisionResolverFn;

      const { code } = await this.createSessionCode(profile.nickname);
      const myId = await this.initPeer(profile.nickname, code);
      this.roomId = myId;
      this.state.participants.push({
        id: myId,
        nickname: profile.nickname,
        avatar: profile.avatar,
        isHost: true,
        supportedGames: profile.supportedGames || [],
      });
      this.broadcastState();
      this.handleMediaRouting();
      return myId;
    },

    joinRoom: async function (roomId, profile) {
      this.isHost = false;
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
          const existingNames = this.state.participants.map((p) => p.nickname);

          let uniqueName = incomingProfile.nickname || "Guest";

          if (typeof this.collisionResolver === "function") {
            uniqueName = this.collisionResolver(uniqueName, existingNames);
          }

          this.state.participants.push({
            id: conn.peer,
            nickname: uniqueName,
            avatar: incomingProfile.avatar || null,
            isHost: false,
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
          this.handleMediaRouting();
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
     * Tracks an audience microphone call and routes its remote stream to the
     * local audio output.
     * @param {string} peerId - Unique ID of the peer sending the microphone.
     * @param {Object} call - PeerJS media connection.
     */
    attachMicCall: function (peerId, call) {
      this.micCalls.set(peerId, call);

      call.on("stream", (remoteStream) => {
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.LoungeStream", {
            detail: { id: peerId, stream: remoteStream },
          }),
        );
      });

      const cleanup = () => {
        if (this.micCalls.get(peerId) !== call) return;
        this.micCalls.delete(peerId);
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.PeerDisconnected", {
            detail: peerId,
          }),
        );
      };

      call.on("close", cleanup);
      call.on("error", cleanup);
    },

    handlePeerDisconnect: function (peerId) {
      if (this.isDisconnecting) return;
      if (!this.connections.has(peerId)) return;

      console.log(`[SESSIONS] Peer disconnected: ${peerId}`);

      const conn = this.connections.get(peerId);
      if (conn) conn.close();
      this.connections.delete(peerId);

      if (this.mediaCalls.has(peerId)) {
        this.mediaCalls.get(peerId).close();
        this.mediaCalls.delete(peerId);
      }

      if (this.micCalls.has(peerId)) {
        this.micCalls.get(peerId).close();
        this.micCalls.delete(peerId);
      }

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
      const modeChanged = this._lastRoutedMode !== this.state.mode;
      const playTriggerChanged =
        this._lastPlayTrigger !== this.state.playTrigger;
      const audibleChanged =
        this._lastRoutedEveryoneAudible !== this.state.everyoneAudible;

      this._lastRoutedMode = this.state.mode;
      this._lastPlayTrigger = this.state.playTrigger;
      this._lastRoutedEveryoneAudible = this.state.everyoneAudible;

      if (modeChanged || playTriggerChanged) {
        for (let call of this.mediaCalls.values()) call.close();
        this.mediaCalls.clear();
        for (let call of this.micCalls.values()) call.close();
        this.micCalls.clear();
        document.dispatchEvent(new CustomEvent("Encore.Sessions.ClearStreams"));
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.LyricsData", { detail: null }),
        );
        document.dispatchEvent(
          new CustomEvent("Encore.Sessions.PianoRollData", { detail: null }),
        );
        this.currentPerformanceStream = null;
      } else if (audibleChanged) {
        for (let [peerId, call] of this.micCalls) {
          call.close();
          document.dispatchEvent(
            new CustomEvent("Encore.Sessions.PeerDisconnected", {
              detail: peerId,
            }),
          );
        }
        this.micCalls.clear();
      }

      if (this.state.mode === "lounge") {
        const forteSvc = pkg.root.Processes.getService("ForteSvc").data;
        for (let p of this.state.participants) {
          if (p.id !== this.peer.id && this.peer.id > p.id) {
            if (!this.mediaCalls.has(p.id)) {
              const call = this.peer.call(p.id, forteSvc.getMicAudioStream());
              this.mediaCalls.set(p.id, call);
              call.on("stream", (stream) => {
                document.dispatchEvent(
                  new CustomEvent("Encore.Sessions.LoungeStream", {
                    detail: { id: p.id, stream },
                  }),
                );
              });
            }
          }
        }
      } else if (this.state.mode === "performance") {
        if (
          this.state.singerId === this.peer.id &&
          this.currentPerformanceStream
        ) {
          for (let p of this.state.participants) {
            if (p.id !== this.peer.id && !this.mediaCalls.has(p.id)) {
              const call = this.peer.call(p.id, this.currentPerformanceStream, {
                sdpTransform: (sdp) => this.enhanceSDP(sdp),
                metadata: { kind: "performance" },
              });
              this.mediaCalls.set(p.id, call);
            }
          }
        }

        if (this.state.everyoneAudible) {
          this.routeAudienceMicStreams();
        }
      }

      for (let peerId of this.mediaCalls.keys()) {
        if (!this.state.participants.find((p) => p.id === peerId)) {
          this.mediaCalls.get(peerId).close();
          this.mediaCalls.delete(peerId);
        }
      }

      for (let peerId of this.micCalls.keys()) {
        if (!this.state.participants.find((p) => p.id === peerId)) {
          this.micCalls.get(peerId).close();
          this.micCalls.delete(peerId);
        }
      }
    },

    /**
     * Routes audience microphones during a performance when the host enables
     * the "everyone audible" option.
     */
    routeAudienceMicStreams: function () {
      if (this.state.mode !== "performance" || !this.state.everyoneAudible) {
        return;
      }
      if (!this.peer || this.peer.id === this.state.singerId) return;

      const forteSvc = pkg.root.Processes.getService("ForteSvc").data;
      const micStream = forteSvc.getMicAudioStream();
      if (!micStream) return;

      for (let p of this.state.participants) {
        if (p.id === this.peer.id) continue;

        const shouldInitiate =
          p.id === this.state.singerId || this.peer.id > p.id;
        if (!shouldInitiate || this.micCalls.has(p.id)) continue;

        const call = this.peer.call(p.id, micStream, {
          metadata: { kind: "mic" },
        });
        this.attachMicCall(p.id, call);
      }
    },

    broadcastPerformance: function (mediaStream) {
      this.currentPerformanceStream = mediaStream;
      this.handleMediaRouting();
    },

    resetState: function () {
      this.roomId = null;
      this.isHost = false;
      this.connections.clear();
      this.mediaCalls.clear();
      this.micCalls.clear();
      this.currentPerformanceStream = null;
      this._lastRoutedMode = null;
      this._lastPlayTrigger = null;
      this._lastRoutedEveryoneAudible = null;
      this.isDisconnecting = false;
      this.collisionResolver = null;
      if (this._lyricsChunkBuffers) this._lyricsChunkBuffers.clear();
      if (this._pianoRollChunkBuffers) this._pianoRollChunkBuffers.clear();

      this.state = {
        mode: "lounge",
        singerId: null,
        nowPlaying: null,
        playTrigger: null,
        everyoneAudible: false,
        queue: [],
        participants: [],
        chatHistory: [],
        leaderboard: [],
      };

      console.log("[SESSIONS] Service state has been reset to default.");
      document.dispatchEvent(new CustomEvent("Encore.Sessions.ClearStreams"));
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
