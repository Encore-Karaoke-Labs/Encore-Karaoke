import { Peer } from "peerjs";

const pkg = {
  name: "Encore Camera Service",
  svcName: "CameraSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;
    console.log("[CAMERA] Camera Service started.");
  },
  end: async function () {
    if (this.data && this.data.peer) {
      this.data.peer.destroy();
    }
  },
  data: {
    peer: null,
    peerId: null,
    currentCall: null,

    initPeer: function () {
      return new Promise((resolve, reject) => {
        if (this.peer) {
          return resolve(this.peerId);
        }

        this.peer = new Peer({ debug: 1 });

        this.peer.on("open", (id) => {
          this.peerId = id;
          resolve(id);
        });

        this.peer.on("error", (err) => reject(err));

        this.peer.on("call", (call) => {
          this.currentCall = call;
          call.answer();

          call.on("stream", (remoteStream) => {
            document.dispatchEvent(
              new CustomEvent("CherryTree.Camera.StreamReceived", {
                detail: remoteStream,
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
      document.dispatchEvent(new CustomEvent("CherryTree.Camera.StreamEnded"));
    },
  },
};
export default pkg;
