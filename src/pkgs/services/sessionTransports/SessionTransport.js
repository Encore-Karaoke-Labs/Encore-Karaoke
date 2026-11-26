/**
 * Base class for Session media transports.
 *
 * A transport is only responsible for moving audio/video between participants.
 * Room state, chat, the song queue and lyrics keep using the PeerJS data
 * channel no matter which media transport is selected.
 *
 * Implementations must provide:
 *  - connect()             Resolve once media can flow.
 *  - disconnect()          Release every resource owned by the transport.
 *  - reconcile()           Bring published/subscribed media in line with the
 *                          current Session state.
 *  - handleIncomingCall()  Optional signalling hook (PeerJS only).
 *  - handlePeerLeft()      Optional cleanup when a participant leaves.
 *
 * New transports only need to extend this class and register themselves in
 * `index.js`.
 */
export default class SessionTransport {
  /**
   * @param {Object} session - The Sessions service data object.
   */
  constructor(session) {
    this.session = session;
    this.name = "base";
    this.label = "Base";
    this.status = "idle";
    this.lastError = null;

    /** Whether the transport can carry Session camera sources. */
    this.supportsCamera = true;

    /** Whether the transport needs a signed-in Encore account. */
    this.requiresAccount = false;
  }

  /** Whether media can currently flow. */
  get isConnected() {
    return this.status === "connected";
  }

  /**
   * Connects the transport to the current Session room.
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error("SessionTransport.connect() is not implemented.");
  }

  /**
   * Disconnects and releases transport resources.
   * @returns {Promise<void>}
   */
  async disconnect() {}

  /**
   * Reconciles outgoing/incoming media with the Session state.
   * @param {{modeChanged?: boolean, playTriggerChanged?: boolean, audibleChanged?: boolean}} [_changes]
   */
  reconcile(_changes = {}) {}

  /**
   * Handles an incoming PeerJS media call.
   * @param {Object} _call - PeerJS MediaConnection.
   */
  handleIncomingCall(_call) {}

  /**
   * Called when a published camera stream is replaced or removed so the
   * transport can refresh whatever it sends to other participants.
   * @param {"local"|"remote"} _source
   */
  handleCameraSourceChanged(_source) {}

  /**
   * Cleans up media associated with a participant that left the room.
   * @param {string} _peerId - Session participant id.
   */
  handlePeerLeft(_peerId) {}

  /**
   * Final teardown used when the Session ends.
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.disconnect();
    this.setStatus("idle");
  }

  /**
   * Updates the transport status and notifies listeners.
   * @param {"idle"|"connecting"|"connected"|"error"} status
   * @param {string|null} [error]
   */
  setStatus(status, error = null) {
    this.status = status;
    this.lastError = error;
    this.dispatch("Encore.Sessions.TransportStatus", {
      transport: this.name,
      label: this.label,
      status,
      error,
    });
  }

  /**
   * Dispatches a Session media event.
   * @param {string} name - Event name.
   * @param {unknown} [detail] - Event payload.
   */
  dispatch(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /** Whether the local participant is currently the performing singer. */
  isSinger() {
    const session = this.session;
    return Boolean(
      session.peer?.id && session.state.singerId === session.peer.id,
    );
  }

  /**
   * Maps a transport-level participant identity onto a Session participant id.
   * @param {string|null} identity
   * @returns {string|null}
   */
  participantIdForIdentity(identity) {
    return this.session.getParticipantIdForTransportIdentity(identity);
  }

  /**
   * Clones the Session microphone bus into a stream owned by the transport.
   * @returns {MediaStream|null}
   */
  cloneMicStream() {
    const source = this.session.getSessionMicStream();
    const sourceTrack = source?.getAudioTracks?.()[0];
    if (!sourceTrack) return null;

    if (sourceTrack.readyState === "ended") {
      console.warn(
        "[SESSIONS] Session microphone track has ended; outgoing voice will be silent.",
      );
      return null;
    }

    const track = sourceTrack.clone();
    if ("contentHint" in track) track.contentHint = "speech";
    return new MediaStream([track]);
  }

  /**
   * Stops every track in a stream owned by the transport.
   * @param {MediaStream|null} stream
   */
  stopStream(stream) {
    if (!stream) return;

    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (error) {
        console.warn("[SESSIONS] Could not stop a transport track:", error);
      }
    }
  }
}
