import Html from "../../../libs/html.js";

export default class StreamManager {
  /**
   * @param {Object} context - The shared Encore context
   */
  constructor(context) {
    this.ctx = context;
    this.isStreaming = false;
    this.streamRecorder = null;
    window.desktopIntegration?.ipc?.on?.(
      "stream-status-changed",
      (_e, isStreaming) => {
        if (!isStreaming && this.isStreaming) {
          this.stopStream();
        }
      },
    );
  }

  /**
   * Starts broadcasting by hooking the live canvas & mixed audio to FFmpeg.
   */
  async startStream() {
    if (this.isStreaming) return;

    const stream = this.ctx.modules.recorder.getBroadcastStream();
    if (!stream) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "No active audio/video stream found.",
        3000,
      );
      return;
    }

    const res = await window.desktopIntegration.ipc.invoke("stream-start");
    if (!res.success) {
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        `Stream error: ${res.reason || res.error}`,
        4000,
      );
      return;
    }

    const videoMimes = [
      "video/webm; codecs=h264,opus",
      "video/webm; codecs=h264",
      "video/webm; codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType =
      videoMimes.find((m) => MediaRecorder.isTypeSupported(m)) || "";

    try {
      this.streamRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 3500000,
      });

      let chunkQueue = Promise.resolve();

      this.streamRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunkQueue = chunkQueue
            .then(async () => {
              const buffer = await e.data.arrayBuffer();
              window.desktopIntegration.ipc.send("stream-chunk", buffer);
            })
            .catch((err) => console.error("[STREAM] Queue error:", err));
        }
      };

      // 150ms slices keep data flowing smoothly without large chunk delays
      this.streamRecorder.start(150);
      this.isStreaming = true;

      this.ctx.modules.dialog(
        new Html("div").classOn("temp-dialog-text").text("STREAM STARTED"),
        2000,
      );
      this.ctx.modules.infoBar.showTemp(
        "STREAM",
        "Broadcasting live to local pipe...",
        3000,
      );
    } catch (err) {
      console.error("[STREAM] Failed to start stream recorder:", err);
      await window.desktopIntegration.ipc.invoke("stream-stop");
      this.isStreaming = false;
    }
  }

  /**
   * Stops the stream and tears down FFmpeg.
   */
  async stopStream() {
    if (!this.isStreaming) return;

    if (this.streamRecorder && this.streamRecorder.state !== "inactive") {
      this.streamRecorder.stop();
      this.streamRecorder = null;
    }

    this.isStreaming = false;

    // Release the broadcast stream if we aren't also locally recording
    if (this.ctx.modules.recorder) {
      this.ctx.modules.recorder.stopBroadcastStream();
    }

    await window.desktopIntegration.ipc.invoke("stream-stop");

    this.ctx.modules.dialog(
      new Html("div").classOn("temp-dialog-text").text("STREAM STOPPED"),
      2000,
    );
    this.ctx.modules.infoBar.showTemp("STREAM", "Stream closed.", 3000);
  }

  /**
   * Toggles streaming state.
   */
  toggleStream() {
    this.isStreaming ? this.stopStream() : this.startStream();
  }

  destroy() {
    if (this.isStreaming) {
      this.stopStream();
    }
  }
}
