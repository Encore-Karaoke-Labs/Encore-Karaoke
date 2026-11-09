import { Peer } from "peerjs";

const pkg = {
  name: "Encore Camera Service",
  svcName: "CameraSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;
    console.log("[CAMERA] Camera Service started.");
    this.data.applySavedConfig();
  },
  end: async function () {
    if (this.data) {
      this.data.stopAll();
    }
    if (this.data && this.data.peer) {
      this.data.peer.destroy();
    }
  },
  data: {
    peer: null,
    peerId: null,
    currentCall: null,
    remoteStream: null,
    localStream: null,
    localDeviceId: null,
    localStartToken: 0,
    source: "remote",

    isBusy: function () {
      return this.currentCall !== null || this.localStream !== null;
    },

    isLocalActive: function () {
      return this.localStream !== null;
    },

    isRemoteAllowed: function () {
      return this.source !== "off";
    },

    getActiveStream: function () {
      return this.localStream || this.remoteStream || null;
    },

    getActiveCamera: function () {
      if (this.localStream) {
        return { stream: this.localStream, source: "local" };
      }
      if (this.remoteStream) {
        return { stream: this.remoteStream, source: "remote" };
      }
      return null;
    },

    /**
     * Lists the cameras available on this machine.
     */
    getVideoDevices: async function (unlockLabels = false) {
      if (!navigator.mediaDevices?.enumerateDevices) return [];

      const listDevices = async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          return devices.filter((device) => device.kind === "videoinput");
        } catch (error) {
          console.warn("[CAMERA] Could not enumerate cameras:", error);
          return [];
        }
      };

      let devices = await listDevices();

      if (unlockLabels && devices.some((device) => !device.label)) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          stream.getTracks().forEach((track) => track.stop());
          devices = await listDevices();
        } catch (error) {
          console.warn("[CAMERA] Could not unlock camera labels:", error);
        }
      }

      return devices;
    },

    /**
     * Starts a physical camera attached to this machine.
     */
    startLocal: async function (deviceId) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera capture is not supported on this device.");
      }

      const token = (this.localStartToken = this.localStartToken + 1);
      const previousStream = this.localStream;

      this.stopLocal(false);

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (error) {
        if (previousStream) {
          document.dispatchEvent(new CustomEvent("Encore.Camera.StreamEnded"));
        }
        throw error;
      }

      // Another camera request started while this one was pending.
      if (token !== this.localStartToken) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }

      this.localStream = stream;

      const track = stream.getVideoTracks()[0];
      this.localDeviceId = track?.getSettings?.().deviceId || deviceId || null;

      if (track) {
        track.onended = () => this.handleLocalStreamEnd();
      }

      if (this.currentCall) {
        try {
          this.currentCall.close();
        } catch (error) {
          console.warn("[CAMERA] Could not close remote stream:", error);
        }
        this.currentCall = null;
        this.remoteStream = null;
      }

      document.dispatchEvent(
        new CustomEvent("Encore.Camera.StreamReceived", {
          detail: { stream, source: "local" },
        }),
      );

      return stream;
    },

    /**
     * Stops the physical camera stream.
     * @param {boolean} notify - Whether to tell listeners the stream ended.
     */
    stopLocal: function (notify = true) {
      if (!this.localStream) return;

      const stream = this.localStream;
      this.localStream = null;
      this.localDeviceId = null;

      stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });

      if (notify) {
        document.dispatchEvent(new CustomEvent("Encore.Camera.StreamEnded"));
      }
    },

    handleLocalStreamEnd: function () {
      if (!this.localStream) return;

      this.stopLocal(false);

      if (!this.currentCall) {
        document.dispatchEvent(new CustomEvent("Encore.Camera.StreamEnded"));
      }
    },

    /**
     * Switches between the remote phone camera, a physical camera, or off.
     * @param {"remote"|"local"|"off"} source
     * @param {string} [deviceId]
     */
    applySource: async function (source, deviceId) {
      this.source = source || "remote";

      if (this.source === "local") {
        await this.startLocal(deviceId || undefined);
      } else if (this.source === "off") {
        this.stopAll();
      } else {
        // Cancel any physical camera request that is still in flight.
        this.localStartToken += 1;
        this.stopLocal();
      }
    },

    applySavedConfig: async function () {
      try {
        const source =
          (await window.config.getItem("videoConfig.cameraSource")) || "remote";
        const deviceId =
          (await window.config.getItem("videoConfig.cameraDeviceId")) || "";

        await this.applySource(source, deviceId);
      } catch (error) {
        console.warn("[CAMERA] Could not start the configured camera:", error);
      }
    },

    /**
     * Stops both the local camera and any active remote phone stream.
     */
    stopAll: function () {
      const hadStream = Boolean(
        this.localStream || this.currentCall || this.remoteStream,
      );

      this.localStartToken += 1;
      this.stopLocal(false);

      if (this.currentCall) {
        try {
          this.currentCall.close();
        } catch (error) {
          console.warn("[CAMERA] Could not close remote stream:", error);
        }
      }

      this.currentCall = null;
      this.remoteStream = null;

      if (hadStream) {
        document.dispatchEvent(new CustomEvent("Encore.Camera.StreamEnded"));
      }
    },

    initPeer: function () {
      return new Promise((resolve, reject) => {
        if (this.peer) return resolve(this.peerId);

        this.peer = new Peer({ debug: 1 });

        this.peer.on("open", (id) => {
          this.peerId = id;
          resolve(id);
        });

        this.peer.on("error", (err) => reject(err));

        this.peer.on("call", (call) => {
          if (this.localStream || !this.isRemoteAllowed()) {
            try {
              call.close();
            } catch (error) {
              console.warn(
                "[CAMERA] Could not reject remote camera call:",
                error,
              );
            }
            return;
          }

          if (this.currentCall) this.currentCall.close();

          this.currentCall = call;
          call.answer();

          call.on("stream", (remoteStream) => {
            this.remoteStream = remoteStream;
            document.dispatchEvent(
              new CustomEvent("Encore.Camera.StreamReceived", {
                detail: { stream: remoteStream, source: "remote" },
              }),
            );
          });

          call.on("close", () => this.handleStreamEnd());
          call.peerConnection.oniceconnectionstatechange = () => {
            const state = call.peerConnection.iceConnectionState;
            if (["disconnected", "failed", "closed"].includes(state)) {
              this.handleStreamEnd();
            }
          };
        });
      });
    },

    handleStreamEnd: function () {
      this.currentCall = null;
      this.remoteStream = null;

      // A physical camera may still be active; don't clear the background.
      if (!this.localStream) {
        document.dispatchEvent(new CustomEvent("Encore.Camera.StreamEnded"));
      }
    },
  },
};

export default pkg;
