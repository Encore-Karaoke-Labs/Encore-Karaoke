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
    if (this.data && typeof this.data.leaveRoom === "function") {
      this.data.leaveRoom();
    }
  },
  data: {
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
    },

    peerOptions: { debug: 1 },

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

    initPeer: function (nickname) {
      this.isDisconnecting = false;
      this.nickname = nickname;
      return new Promise((resolve, reject) => {
        this.peer = new Peer(this.peerOptions);

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

    hostRoom: async function (nickname) {
      this.isHost = true;
      const myId = await this.initPeer(nickname);
      this.roomId = myId;
      this.state.participants.push({
        id: myId,
        nickname: nickname,
        isHost: true,
      });
      this.broadcastState();
      this.handleMediaRouting();
      return myId;
    },

    joinRoom: async function (roomId, nickname) {
      this.isHost = false;
      const myId = await this.initPeer(nickname);
      this.roomId = roomId;

      const conn = this.peer.connect(roomId, { metadata: { nickname } });
      this.setupConnection(conn);

      return new Promise((resolve) => conn.on("open", () => resolve(myId)));
    },

    setupConnection: function (conn) {
      conn.on("open", () => {
        this.connections.set(conn.peer, conn);
        if (this.isHost) {
          this.state.participants.push({
            id: conn.peer,
            nickname: conn.metadata.nickname,
            isHost: false,
          });
          this.broadcastState();
          this.handleMediaRouting(true);
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
          this.state = data.state;
          document.dispatchEvent(
            new CustomEvent("CherryTree.Sessions.StateUpdate", {
              detail: this.state,
            }),
          );
          this.handleMediaRouting();
        } else if (data.type === "reserve_song" && this.isHost) {
          this.state.queue.push({
            ...data.song,
            requesterId: conn.peer,
            requesterNickname: conn.metadata.nickname,
          });
          if (this.state.mode === "lounge") {
            this.advanceQueue();
          } else {
            this.broadcastState();
          }
        } else if (data.type === "song_ended" && this.isHost) {
          this.advanceQueue();
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
      this.handleMediaRouting(true);
    },

    broadcastState: function () {
      if (!this.isHost) return;
      document.dispatchEvent(
        new CustomEvent("CherryTree.Sessions.StateUpdate", {
          detail: this.state,
        }),
      );
      for (let conn of this.connections.values()) {
        if (conn.open) conn.send({ type: "state_sync", state: this.state });
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

    handleMediaRouting: function (forceRebuild = false) {
      if (
        !forceRebuild &&
        this._lastRoutedMode === this.state.mode &&
        this.state.mode === "performance"
      )
        return;
      this._lastRoutedMode = this.state.mode;

      for (let call of this.mediaCalls.values()) call.close();
      this.mediaCalls.clear();
      document.dispatchEvent(
        new CustomEvent("CherryTree.Sessions.ClearStreams"),
      );

      if (this.state.mode === "lounge") {
        const forteSvc = pkg.root.Processes.getService("ForteSvc").data;
        for (let p of this.state.participants) {
          if (p.id !== this.peer.id && this.peer.id > p.id) {
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
    },

    broadcastPerformance: function (mediaStream) {
      for (let p of this.state.participants) {
        if (p.id !== this.peer.id) {
          const call = this.peer.call(p.id, mediaStream, {
            sdpTransform: (sdp) => this.enhanceSDP(sdp),
          });
          this.mediaCalls.set(p.id, call);
        }
      }
    },

    leaveRoom: function () {
      this.isDisconnecting = true;
      if (this.peer) this.peer.destroy();
      this.peer = null;
      this.roomId = null;
      this.isHost = false;
      this.connections.clear();
      this.mediaCalls.clear();
      this.state.queue = [];
      this.state.participants = [];
      document.dispatchEvent(
        new CustomEvent("CherryTree.Sessions.ClearStreams"),
      );
    },
  },
};
export default pkg;
