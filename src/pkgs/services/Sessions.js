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
    PROTOCOL_VERSION: 3,
    SESSION_ID_LENGTH: 16,
    CHECKSUM_LENGTH: 4,

    peer: null,
    roomId: null,
    isHost: false,
    nickname: "Guest",
    connections: new Map(),
    mediaCalls: new Map(),
    _lastRoutedMode: null,

    state: {
      mode: "lounge",
      singerId: null,
      nowPlaying: null,
      playTrigger: null,
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
        "useinbandfec=1; stereo=1; sprop-stereo=1; cbr=1; maxaveragebitrate=510000",
      );
      newSdp = newSdp.replace(
        /a=mid:video\r\n/g,
        "a=mid:video\r\nb=AS:4000\r\n",
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
          if (
            this.state.mode === "performance" &&
            call.peer === this.state.singerId
          ) {
            call.answer(undefined, {
              sdpTransform: (sdp) => this.enhanceSDP(sdp),
            });
            call.on("stream", (remoteStream) => {
              document.dispatchEvent(
                new CustomEvent("CherryTree.Sessions.RemoteStream", {
                  detail: remoteStream,
                }),
              );
            });
          } else if (this.state.mode === "lounge") {
            const forteSvc = pkg.root.Processes.getService("ForteSvc").data;
            call.answer(forteSvc.getMicAudioStream());
            call.on("stream", (remoteStream) => {
              document.dispatchEvent(
                new CustomEvent("CherryTree.Sessions.LoungeStream", {
                  detail: { id: call.peer, stream: remoteStream },
                }),
              );
            });
          }
          this.mediaCalls.set(call.peer, call);
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
              new CustomEvent("CherryTree.Sessions.Kicked", {
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
            new CustomEvent("CherryTree.Sessions.StateUpdate", {
              detail: this.state,
            }),
          );

          if (
            this.state.chatHistory &&
            this.state.chatHistory.length > prevChatLength
          ) {
            document.dispatchEvent(
              new CustomEvent("CherryTree.Sessions.ChatHistorySync", {
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
              new CustomEvent("CherryTree.Sessions.Kicked", {
                detail: data.reason,
              }),
            );
          }
        } else if (data.type === "force_stop") {
          if (!this.isHost && conn.peer === this.roomId) {
            document.dispatchEvent(
              new CustomEvent("CherryTree.Sessions.ForceStop"),
            );
          }
        } else if (data.type === "submit_score") {
          if (this.isHost) {
            this.state.leaderboard.push(data.entry);
            this.state.leaderboard.sort((a, b) => b.score - a.score);
            if (this.state.leaderboard.length > 20)
              this.state.leaderboard.length = 20;

            this.broadcastState();

            const scoreEvent = { type: "remote_score", entry: data.entry };
            for (let c of this.connections.values()) {
              if (c.open) c.send(scoreEvent);
            }
            document.dispatchEvent(
              new CustomEvent("CherryTree.Sessions.RemoteScore", {
                detail: scoreEvent,
              }),
            );
          }
        } else if (data.type === "remote_score") {
          if (!this.isHost) {
            document.dispatchEvent(
              new CustomEvent("CherryTree.Sessions.RemoteScore", {
                detail: data,
              }),
            );
          }
        } else if (data.type === "skip_score") {
          document.dispatchEvent(
            new CustomEvent("CherryTree.Sessions.SkipScore"),
          );
          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }
        } else if (data.type === "chat_message" || data.type === "cheer") {
          document.dispatchEvent(
            new CustomEvent(
              `CherryTree.Sessions.${data.type === "chat_message" ? "Chat" : "Cheer"}`,
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
            new CustomEvent("CherryTree.Sessions.PluginData", { detail: data }),
          );
          if (this.isHost) {
            for (let c of this.connections.values()) {
              if (c.open && c.peer !== conn.peer) c.send(data);
            }
          }
        }
      });

      conn.on("close", () => this.handlePeerDisconnect(conn.peer));
      conn.on("error", () => this.handlePeerDisconnect(conn.peer));
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

      document.dispatchEvent(
        new CustomEvent("CherryTree.Sessions.PeerDisconnected", {
          detail: peerId,
        }),
      );

      if (!this.isHost && peerId === this.roomId) {
        this.leaveRoom();
        document.dispatchEvent(
          new CustomEvent("CherryTree.Sessions.HostDisconnected"),
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
        new CustomEvent("CherryTree.Sessions.StateUpdate", {
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
        new CustomEvent("CherryTree.Sessions.Chat", { detail: data }),
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
        new CustomEvent("CherryTree.Sessions.Cheer", { detail: data }),
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
        new CustomEvent("CherryTree.Sessions.PluginData", { detail: data }),
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

    submitScore: function (score, songTitle) {
      const p = this.state.participants.find(
        (part) => part.id === this.peer.id,
      );

      const entry = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        singerName: p ? p.nickname : "Singer",
        avatar: p ? p.avatar : null,
        songTitle: songTitle || "Unknown Song",
        score: score,
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

      this._lastRoutedMode = this.state.mode;
      this._lastPlayTrigger = this.state.playTrigger;

      if (modeChanged || playTriggerChanged) {
        for (let call of this.mediaCalls.values()) call.close();
        this.mediaCalls.clear();
        document.dispatchEvent(
          new CustomEvent("CherryTree.Sessions.ClearStreams"),
        );
        this.currentPerformanceStream = null;
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
                  new CustomEvent("CherryTree.Sessions.LoungeStream", {
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
              });
              this.mediaCalls.set(p.id, call);
            }
          }
        }
      }

      for (let peerId of this.mediaCalls.keys()) {
        if (!this.state.participants.find((p) => p.id === peerId)) {
          this.mediaCalls.get(peerId).close();
          this.mediaCalls.delete(peerId);
        }
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
      this.currentPerformanceStream = null;
      this._lastRoutedMode = null;
      this._lastPlayTrigger = null;
      this.isDisconnecting = false;
      this.collisionResolver = null;

      this.state = {
        mode: "lounge",
        singerId: null,
        nowPlaying: null,
        playTrigger: null,
        queue: [],
        participants: [],
        chatHistory: [],
        leaderboard: [],
      };

      console.log("[SESSIONS] Service state has been reset to default.");
      document.dispatchEvent(
        new CustomEvent("CherryTree.Sessions.ClearStreams"),
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
