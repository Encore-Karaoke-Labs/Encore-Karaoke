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

    isBusy: function () {
      return this.currentCall !== null || this.remoteStream !== null;
    },

    isLocalActive: function () {
      return this.localStream !== null;
    },

    isRemoteActive: function () {
      return this.remoteStream !== null;
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
     * Returns every live camera.
     * @returns {Array<{stream: MediaStream, source: "local"|"remote"}>}
     */
    getActiveCameras: function () {
      const cameras = [];
      if (this.localStream) {
        cameras.push({ stream: this.localStream, source: "local" });
      }
      if (this.remoteStream) {
        cameras.push({ stream: this.remoteStream, source: "remote" });
      }
      return cameras;
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

      const videoConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      };
      if (deviceId) videoConstraints.deviceId = { exact: deviceId };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (error) {
        if (previousStream) {
          document.dispatchEvent(
            new CustomEvent("Encore.Camera.StreamEnded", {
              detail: { source: "local" },
            }),
          );
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
        document.dispatchEvent(
          new CustomEvent("Encore.Camera.StreamEnded", {
            detail: { source: "local" },
          }),
        );
      }
    },

    handleLocalStreamEnd: function () {
      if (!this.localStream) return;

      this.stopLocal(false);

      document.dispatchEvent(
        new CustomEvent("Encore.Camera.StreamEnded", {
          detail: { source: "local" },
        }),
      );
    },

    applySavedConfig: async function () {
      try {
        const deviceId =
          (await window.config.getItem("videoConfig.cameraDeviceId")) || "";
        const source =
          (await window.config.getItem("videoConfig.cameraSource")) || "";

        if (deviceId || source === "local") {
          await this.startLocal(deviceId || undefined);
        }
      } catch (error) {
        console.warn("[CAMERA] Could not start the configured camera:", error);
      }
    },

    /**
     * Stops the physical camera and any active EnMoku phone stream.
     */
    stopAll: function () {
      const hadLocal = Boolean(this.localStream);
      const hadRemote = Boolean(this.currentCall || this.remoteStream);

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

      if (hadLocal) {
        document.dispatchEvent(
          new CustomEvent("Encore.Camera.StreamEnded", {
            detail: { source: "local" },
          }),
        );
      }

      if (hadRemote) {
        document.dispatchEvent(
          new CustomEvent("Encore.Camera.StreamEnded", {
            detail: { source: "remote" },
          }),
        );
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
          if (this.currentCall) {
            try {
              this.currentCall.close();
            } catch (error) {
              console.warn("[CAMERA] Could not replace remote stream:", error);
            }
          }

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

      document.dispatchEvent(
        new CustomEvent("Encore.Camera.StreamEnded", {
          detail: { source: "remote" },
        }),
      );
    },
  },
};

export default pkg;
