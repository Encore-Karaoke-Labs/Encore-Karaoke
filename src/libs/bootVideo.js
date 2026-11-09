import Html from "./html.js";
import NetworkingUtility from "./networkingUtility.js";

/**
 * Plays a boot video as a full-screen overlay.
 *
 * @param {string} videoPath - Absolute local path to the video file.
 * @param {Object} [options]
 * @param {HTMLElement|Html|string} [options.container=document.body] - Element to mount the overlay into.
 * @param {boolean} [options.skippable=true] - Whether the user can skip playback.
 * @param {number} [options.playVolume=1] - Playback volume from 0 to 1.
 * @param {string} [options.fillMode="cover"] - CSS object-fit value for the video.
 * @param {boolean} [options.freezeFrame=true] - Keep the last frame visible after playback ends.
 * @param {boolean} [options.blockInput=false] - Swallow key input while the video is visible.
 * @returns {Promise<void>} Resolves when the video finishes, fails, or is skipped.
 */
export default async function playBootVideo(videoPath, options = {}) {
  const {
    container = document.body,
    skippable = true,
    playVolume = 1,
    fillMode = "cover",
    freezeFrame = true,
    blockInput = false,
  } = options;

  return new Promise((resolve) => {
    let settled = false;
    let stallTimeout = null;

    const videoContainer = new Html("div")
      .styleJs({
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        backgroundColor: "#000",
        zIndex: "2147483000",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        opacity: "0",
        transition: "opacity 0.25s ease",
      })
      .appendTo(container);

    const video = document.createElement("video");
    video.preload = "auto";
    video.autoplay = true;
    video.playsInline = true;
    video.volume = playVolume;

    Object.assign(video.style, {
      width: "100%",
      height: "100%",
      objectFit: fillMode,
      backgroundColor: "#000",
    });

    const finish = (keepFrame = true) => {
      if (settled) return;
      settled = true;

      if (stallTimeout) clearTimeout(stallTimeout);
      document.removeEventListener("keydown", handleKeyDown, blockInput);

      video.pause();

      if (!keepFrame) {
        video.removeAttribute("src");
        video.load();
        videoContainer.cleanup();
      } else {
        videoContainer.styleJs({ opacity: "1" });
      }

      resolve();
    };

    const handleKeyDown = (e) => {
      if (blockInput) e.stopImmediatePropagation();

      if (skippable && ["Enter", " ", "Escape"].includes(e.key)) {
        e.preventDefault();
        finish(freezeFrame);
      }
    };

    const resetStallTimer = () => {
      if (stallTimeout) clearTimeout(stallTimeout);
      stallTimeout = setTimeout(() => {
        console.warn("Boot video stalled or buffering too long. Skipping.");
        finish(false);
      }, 6000);
    };

    video.addEventListener("waiting", resetStallTimer);
    video.addEventListener("stalled", resetStallTimer);

    video.addEventListener("playing", () => {
      if (stallTimeout) clearTimeout(stallTimeout);
      videoContainer.styleJs({ opacity: "1" });
    });

    video.addEventListener("canplay", () => {
      video.play().catch((err) => {
        console.warn("Autoplay was prevented or video decode failed:", err);
        finish(false);
      });
    });

    video.addEventListener("ended", () => finish(freezeFrame));

    video.addEventListener("error", () => {
      console.warn(
        "Boot video encountered an error. Proceeding directly to app.",
      );
      finish(false);
    });

    if (skippable) {
      document.addEventListener("keydown", handleKeyDown, blockInput);
    }

    NetworkingUtility.getFileLink(videoPath)
      .then((link) => {
        video.src = link.href;
        videoContainer.elm.appendChild(video);
      })
      .catch((err) => {
        console.warn("Could not generate stream URL for boot video:", err);
        finish(false);
      });
  });
}
