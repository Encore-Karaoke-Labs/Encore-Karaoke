import SessionTransport from "./SessionTransport.js";

/**
 * Peer-to-peer media transport.
 */
export default class PeerJSTransport extends SessionTransport {
  /**
   * @param {Object} session - The Sessions service data object.
   */
  constructor(session) {
    super(session);
    this.name = "peerjs";
    this.label = "Peer-to-peer";

    this.mediaCalls = new Map();
    this.micCalls = new Map();
    this.cameraCalls = new Map();
    this.incomingCameraCalls = new Map();
    this._loungeRetryTimers = new Map();
    this._loungeRetryCounts = new Map();
  }

  async connect() {
    this.setStatus("connected");
    this.reconcile();
  }

  async disconnect() {
    for (const call of this.mediaCalls.values()) this.shutdownMediaCall(call);
    this.mediaCalls.clear();

    for (const call of this.micCalls.values()) this.shutdownMediaCall(call);
    this.micCalls.clear();

    this.closeOutgoingCameraCalls();

    for (const call of this.incomingCameraCalls.values()) {
      try {
        call.close();
      } catch (error) {
        console.warn("[SESSIONS] Could not close camera call:", error);
      }
    }
    this.incomingCameraCalls.clear();

    for (const timer of this._loungeRetryTimers.values()) clearTimeout(timer);
    this._loungeRetryTimers.clear();
    this._loungeRetryCounts.clear();
  }

  /**
   * Adds extra SDP parameters so stereo, FEC and a higher average bitrate are
   * negotiated for performance audio.
   * @param {string} sdp
   * @returns {string}
   */
  enhanceSDP(sdp) {
    return sdp.replace(
      /useinbandfec=1/g,
      "useinbandfec=1; stereo=1; sprop-stereo=1; maxaveragebitrate=160000",
    );
  }

  /**
   * Handles a media call started by another participant.
   * @param {Object} call - PeerJS MediaConnection.
   */
  handleIncomingCall(call) {
    const session = this.session;
    const callKind = call.metadata?.kind;

    if (callKind === "camera") {
      call.answer();
      this.attachCameraCall(call.peer, call);
      return;
    }

    const isPerformanceCall =
      callKind === "performance" ||
      (session.state.mode === "performance" &&
        call.peer === session.state.singerId);
    const isMicCall =
      session.state.mode === "performance" &&
      session.state.everyoneAudible &&
      (callKind === "mic" || !isPerformanceCall);

    if (isPerformanceCall) {
      call.answer(undefined, {
        sdpTransform: (sdp) => this.enhanceSDP(sdp),
      });
      call.on("stream", (remoteStream) => {
        this.dispatch("Encore.Sessions.RemoteStream", {
          id: call.peer,
          stream: remoteStream,
        });
      });
      this.mediaCalls.set(call.peer, call);
      this.trackCallClose(call.peer, call);
    } else if (isMicCall) {
      const micStream =
        session.peer?.id === session.state.singerId
          ? null
          : this.cloneMicStream();
      call.answer(micStream || undefined);
      this.attachMicCall(call.peer, call, micStream);
    } else {
      const micStream = this.cloneMicStream();
      call.answer(micStream || undefined);
      this.attachLoungeCall(call.peer, call, micStream);
    }
  }

  /**
   * Closes a tracked media call on purpose, releasing its cloned track.
   * @param {Object|null} call - PeerJS media connection.
   */
  shutdownMediaCall(call) {
    if (!call) return;

    call._encoreIntentionalClose = true;
    this.releaseCallStream(call);
    try {
      call.close();
    } catch (error) {
      console.warn("[SESSIONS] Could not close media call:", error);
    }
  }

  /**
   * Stops the track this transport cloned for a media call, if any.
   * @param {Object|null} call - PeerJS media connection.
   */
  releaseCallStream(call) {
    if (!call) return;

    clearTimeout(call._encoreStreamTimer);

    const stream = call._encoreOwnedStream;
    if (!stream) return;

    call._encoreOwnedStream = null;
    this.stopStream(stream);
  }

  /**
   * Returns whether a media call can no longer carry audio.
   * @param {Object|null} call - PeerJS media connection.
   * @returns {boolean}
   */
  isMediaCallDead(call) {
    if (!call) return true;

    const pc = call.peerConnection;
    if (!pc) return false;

    const createdAt = Number(call._encoreCreatedAt) || 0;
    const age = createdAt > 0 ? Date.now() - createdAt : 0;
    const connection = pc.connectionState;

    if (connection === "connected") {
      return call._encoreGotStream === false && age > 10000;
    }
    if (connection === "failed" || connection === "closed") return true;

    const ice = pc.iceConnectionState;
    if (ice === "failed" || ice === "closed") return true;

    return age > 12000;
  }

  /**
   * Forgets and closes a tracked outgoing media call.
   * @param {string} peerId - Participant peer id.
   */
  dropMediaCall(peerId) {
    const call = this.mediaCalls.get(peerId);
    if (!call) return;

    this.mediaCalls.delete(peerId);
    this.shutdownMediaCall(call);
  }

  /**
   * Removes a performance call from the routing map when it closes so a later
   * routing pass can recreate it.
   * @param {string} peerId - Participant peer id.
   * @param {Object} call - PeerJS media connection.
   */
  trackCallClose(peerId, call) {
    if (!call) return;

    call._encoreCreatedAt = call._encoreCreatedAt || Date.now();

    const cleanup = () => {
      if (this.mediaCalls.get(peerId) !== call) return;
      this.mediaCalls.delete(peerId);
    };

    call.on("close", cleanup);
    call.on("error", cleanup);
  }

  /**
   * Tracks a Lounge (or fallback) voice call and re-routes when it fails.
   * @param {string} peerId - Unique ID of the peer on the call.
   * @param {Object} call - PeerJS media connection.
   * @param {MediaStream|null} [ownedStream] - Stream cloned for this call.
   */
  attachLoungeCall(peerId, call, ownedStream = null) {
    if (!call) return;

    call._encoreOwnedStream = ownedStream || null;
    call._encoreCreatedAt = call._encoreCreatedAt || Date.now();
    call._encoreGotStream = false;
    this.mediaCalls.set(peerId, call);

    const markConnected = () => {
      this._loungeRetryCounts.delete(peerId);
    };

    call.on("stream", (remoteStream) => {
      call._encoreGotStream = true;
      markConnected();
      this.dispatch("Encore.Sessions.LoungeStream", {
        id: peerId,
        stream: remoteStream,
      });
    });

    call._encoreStreamTimer = setTimeout(() => {
      if (this.mediaCalls.get(peerId) !== call) return;
      if (call._encoreGotStream) return;

      const attempts = this._loungeRetryCounts.get(peerId) || 0;
      if (attempts >= 5) {
        console.warn(
          `[SESSIONS] Lounge call with ${peerId} stayed silent; giving up reconnecting.`,
        );
        return;
      }

      console.warn(
        `[SESSIONS] Lounge call with ${peerId} never delivered audio; recreating.`,
      );
      this.dropMediaCall(peerId);
      this.scheduleLoungeRetry(peerId);
    }, 10000);

    const cleanup = () => {
      if (this.mediaCalls.get(peerId) !== call) return;
      this.mediaCalls.delete(peerId);
      clearTimeout(call._encoreStreamTimer);
      this.releaseCallStream(call);
      this.dispatch("Encore.Sessions.PeerDisconnected", peerId);
      if (!call._encoreIntentionalClose) this.scheduleLoungeRetry(peerId);
    };

    call.on("close", cleanup);
    call.on("error", cleanup);

    const pc = call.peerConnection;
    if (pc && typeof pc.addEventListener === "function") {
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") {
          markConnected();
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          cleanup();
        }
      });
    }
  }

  /**
   * Rebuilds a dead Lounge call after a short, growing delay.
   * @param {string} peerId - Unique ID of the peer to reconnect to.
   */
  scheduleLoungeRetry(peerId) {
    const session = this.session;
    if (session.isDisconnecting) return;
    if (session.state.mode !== "lounge") return;
    if (!session.state.participants.some((p) => p.id === peerId)) return;
    if (this._loungeRetryTimers.has(peerId)) return;

    const attempt = this._loungeRetryCounts.get(peerId) || 0;
    this._loungeRetryCounts.set(peerId, attempt + 1);
    const delay = Math.min(1500 * Math.pow(2, Math.min(attempt, 4)), 20000);

    const timer = setTimeout(() => {
      this._loungeRetryTimers.delete(peerId);
      if (session.isDisconnecting) return;
      if (session.state.mode !== "lounge") return;
      if (!session.state.participants.some((p) => p.id === peerId)) return;
      session.handleMediaRouting();
    }, delay);

    this._loungeRetryTimers.set(peerId, timer);
  }

  /**
   * Cancels any pending Lounge reconnect for a peer.
   * @param {string} peerId - Unique ID of the peer.
   */
  clearLoungeRetry(peerId) {
    const timer = this._loungeRetryTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this._loungeRetryTimers.delete(peerId);
    this._loungeRetryCounts.delete(peerId);
  }

  /**
   * Tracks an audience microphone call and routes its remote stream to the
   * local audio output.
   * @param {string} peerId - Unique ID of the peer sending the microphone.
   * @param {Object} call - PeerJS media connection.
   * @param {MediaStream|null} [ownedStream] - Stream cloned for this call.
   */
  attachMicCall(peerId, call, ownedStream = null) {
    if (!call) return;

    call._encoreOwnedStream = ownedStream || null;
    call._encoreCreatedAt = call._encoreCreatedAt || Date.now();
    this.micCalls.set(peerId, call);

    call.on("stream", (remoteStream) => {
      this.dispatch("Encore.Sessions.LoungeStream", {
        id: peerId,
        stream: remoteStream,
      });
    });

    const cleanup = () => {
      if (this.micCalls.get(peerId) !== call) return;
      this.micCalls.delete(peerId);
      this.releaseCallStream(call);
      this.dispatch("Encore.Sessions.PeerDisconnected", peerId);
    };

    call.on("close", cleanup);
    call.on("error", cleanup);
  }

  /**
   * Builds the map key for one participant camera source.
   * @param {"local"|"remote"} source
   * @param {string} peerId
   * @returns {string}
   */
  cameraCallKey(source, peerId) {
    return `${source}:${peerId}`;
  }

  /**
   * Splits a camera call key back into its source and peer id.
   * @param {string} key
   * @returns {{source: "local"|"remote", peerId: string}}
   */
  parseCameraCallKey(key) {
    const separator = key.indexOf(":");
    return {
      source: key.slice(0, separator) === "remote" ? "remote" : "local",
      peerId: key.slice(separator + 1),
    };
  }

  /**
   * Tracks an incoming participant camera call.
   * @param {string} peerId - Unique ID of the peer sending their camera.
   * @param {Object} call - PeerJS media connection.
   */
  attachCameraCall(peerId, call) {
    const source =
      call.metadata?.cameraSource === "remote" ? "remote" : "local";
    const key = this.cameraCallKey(source, peerId);

    const existing = this.incomingCameraCalls.get(key);
    if (existing && existing !== call) {
      try {
        existing.close();
      } catch (error) {
        console.warn("[SESSIONS] Could not replace camera call:", error);
      }
    }

    this.incomingCameraCalls.set(key, call);

    const publishStream = (stream) => {
      this.dispatch("Encore.Sessions.CameraStream", {
        id: peerId,
        source,
        stream,
      });
    };

    call.on("stream", publishStream);

    const cleanup = () => {
      if (this.incomingCameraCalls.get(key) !== call) return;
      this.incomingCameraCalls.delete(key);
      this.dispatch("Encore.Sessions.CameraStreamEnded", {
        id: peerId,
        source,
      });
    };

    call.on("close", cleanup);
    call.on("error", cleanup);
  }

  /**
   * Creates outgoing camera calls for every other room participant and every
   * published camera.
   */
  handleCameraRouting() {
    const session = this.session;
    if (!session.peer) return;

    const sources = session.cameraEnabled
      ? session.getLocalCameraSources()
      : [];
    if (sources.length === 0) {
      this.closeOutgoingCameraCalls();
      return;
    }

    const validPeers = new Set(
      session.state.participants
        .map((participant) => participant.id)
        .filter((id) => id !== session.peer.id),
    );

    for (const key of [...this.cameraCalls.keys()]) {
      const { source, peerId } = this.parseCameraCallKey(key);
      if (!validPeers.has(peerId) || !sources.includes(source)) {
        this.closeOutgoingCameraCall(key);
      }
    }

    for (const peerId of validPeers) {
      for (const source of sources) {
        const key = this.cameraCallKey(source, peerId);
        if (this.cameraCalls.has(key)) continue;

        const call = session.peer.call(peerId, session.cameraStreams[source], {
          metadata: { kind: "camera", cameraSource: source },
        });

        if (!call) continue;

        this.cameraCalls.set(key, call);

        const cleanup = () => {
          if (this.cameraCalls.get(key) !== call) return;
          this.cameraCalls.delete(key);
        };

        call.on("close", cleanup);
        call.on("error", cleanup);
      }
    }
  }

  /**
   * Closes one outgoing camera call.
   * @param {string} key - Camera call key.
   */
  closeOutgoingCameraCall(key) {
    const call = this.cameraCalls.get(key);
    if (!call) return;

    this.cameraCalls.delete(key);
    try {
      call.close();
    } catch (error) {
      console.warn("[SESSIONS] Could not close camera call:", error);
    }
  }

  /**
   * Closes outgoing camera calls for one camera source.
   * @param {"local"|"remote"} source
   */
  closeOutgoingCameraCallsForSource(source) {
    for (const key of [...this.cameraCalls.keys()]) {
      if (this.parseCameraCallKey(key).source === source) {
        this.closeOutgoingCameraCall(key);
      }
    }
  }

  /**
   * Closes outgoing camera calls for one participant.
   * @param {string} peerId
   */
  closeOutgoingCameraCallsForPeer(peerId) {
    for (const key of [...this.cameraCalls.keys()]) {
      if (this.parseCameraCallKey(key).peerId === peerId) {
        this.closeOutgoingCameraCall(key);
      }
    }
  }

  /** Closes every outgoing camera call. */
  closeOutgoingCameraCalls() {
    for (const key of [...this.cameraCalls.keys()]) {
      this.closeOutgoingCameraCall(key);
    }
  }

  /**
   * Rebuilds outgoing camera calls when a camera stream is replaced or
   * removed.
   * @param {"local"|"remote"} source
   */
  handleCameraSourceChanged(source) {
    this.closeOutgoingCameraCallsForSource(source);
  }

  /**
   * Reconciles every media call with the current Session state.
   * @param {{modeChanged?: boolean, playTriggerChanged?: boolean, audibleChanged?: boolean}} [changes]
   */
  reconcile(changes = {}) {
    const session = this.session;
    if (!session.peer) return;

    if (changes.modeChanged || changes.playTriggerChanged) {
      for (const call of this.mediaCalls.values()) {
        this.shutdownMediaCall(call);
      }
      this.mediaCalls.clear();
      for (const call of this.micCalls.values()) {
        this.shutdownMediaCall(call);
      }
      this.micCalls.clear();
    } else if (changes.audibleChanged) {
      for (const [peerId, call] of this.micCalls) {
        this.shutdownMediaCall(call);
        this.dispatch("Encore.Sessions.PeerDisconnected", peerId);
      }
      this.micCalls.clear();
    }

    if (session.state.mode === "lounge") {
      if (session.getSessionMicStream()) {
        for (const participant of session.state.participants) {
          if (participant.id === session.peer.id) continue;

          const existing = this.mediaCalls.get(participant.id);
          if (existing && !this.isMediaCallDead(existing)) continue;
          if (existing) this.dropMediaCall(participant.id);

          if (!(session.peer.id > participant.id)) continue;

          const callStream = this.cloneMicStream();
          if (!callStream) continue;

          const call = session.peer.call(participant.id, callStream);
          if (!call) {
            this.stopStream(callStream);
            continue;
          }
          this.attachLoungeCall(participant.id, call, callStream);
        }
      }
    } else if (session.state.mode === "performance") {
      if (this.isSinger() && session.currentPerformanceStream) {
        for (const participant of session.state.participants) {
          if (participant.id === session.peer.id) continue;

          const existing = this.mediaCalls.get(participant.id);
          if (existing && !this.isMediaCallDead(existing)) continue;
          if (existing) this.dropMediaCall(participant.id);

          const call = session.peer.call(
            participant.id,
            session.currentPerformanceStream,
            {
              sdpTransform: (sdp) => this.enhanceSDP(sdp),
              metadata: { kind: "performance" },
            },
          );
          if (!call) continue;

          this.mediaCalls.set(participant.id, call);
          this.trackCallClose(participant.id, call);
        }
      }

      if (session.state.everyoneAudible) {
        this.routeAudienceMicStreams();
      }
    }

    for (const peerId of this.mediaCalls.keys()) {
      if (!session.state.participants.find((p) => p.id === peerId)) {
        this.dropMediaCall(peerId);
      }
    }

    for (const peerId of this.micCalls.keys()) {
      if (!session.state.participants.find((p) => p.id === peerId)) {
        const call = this.micCalls.get(peerId);
        this.micCalls.delete(peerId);
        this.shutdownMediaCall(call);
      }
    }

    this.handleCameraRouting();
  }

  /**
   * Routes audience microphones during a performance when the host enables
   * the "everyone audible" option.
   */
  routeAudienceMicStreams() {
    const session = this.session;
    if (
      session.state.mode !== "performance" ||
      !session.state.everyoneAudible
    ) {
      return;
    }
    if (!session.peer || session.peer.id === session.state.singerId) return;
    if (!session.getSessionMicStream()) return;

    for (const participant of session.state.participants) {
      if (participant.id === session.peer.id) continue;

      const shouldInitiate =
        participant.id === session.state.singerId ||
        session.peer.id > participant.id;
      if (!shouldInitiate) continue;

      const existing = this.micCalls.get(participant.id);
      if (existing && !this.isMediaCallDead(existing)) continue;
      if (existing) {
        this.micCalls.delete(participant.id);
        this.shutdownMediaCall(existing);
      }

      const callStream = this.cloneMicStream();
      if (!callStream) continue;

      const call = session.peer.call(participant.id, callStream, {
        metadata: { kind: "mic" },
      });
      if (!call) {
        this.stopStream(callStream);
        continue;
      }
      this.attachMicCall(participant.id, call, callStream);
    }
  }

  /**
   * Cleans up every call involving a participant that left the room.
   * @param {string} peerId
   */
  handlePeerLeft(peerId) {
    if (this.mediaCalls.has(peerId)) {
      const call = this.mediaCalls.get(peerId);
      this.mediaCalls.delete(peerId);
      this.shutdownMediaCall(call);
    }

    if (this.micCalls.has(peerId)) {
      const call = this.micCalls.get(peerId);
      this.micCalls.delete(peerId);
      this.shutdownMediaCall(call);
    }

    this.clearLoungeRetry(peerId);
    this.closeOutgoingCameraCallsForPeer(peerId);

    for (const key of [...this.incomingCameraCalls.keys()]) {
      if (this.parseCameraCallKey(key).peerId !== peerId) continue;

      const incomingCameraCall = this.incomingCameraCalls.get(key);
      this.incomingCameraCalls.delete(key);
      try {
        incomingCameraCall.close();
      } catch (error) {
        console.warn("[SESSIONS] Could not close camera call:", error);
      }

      this.dispatch("Encore.Sessions.CameraStreamEnded", {
        id: peerId,
        source: this.parseCameraCallKey(key).source,
      });
    }
  }
}
