import Modal from "./modal.js";
import Notify from "./notify.js";

export default {
  setUiScaling: async (scale) => {
    document.documentElement.style.fontSize = scale;
    await window.localforage.setItem("settings__uiScale", scale);
  },
  uiScaling: async (pid, wrapper, Ui) => {
    let getScaleValue = Ui.scaling.getScaleValue;

    let values = [
      {
        label: "60%",
        scale: getScaleValue(60),
      },
      {
        label: "70%",
        scale: getScaleValue(70),
      },
      {
        label: "85%",
        scale: getScaleValue(85),
      },
      {
        label: "100%",
        scale: "16px",
      },
      {
        label: "125%",
        scale: getScaleValue(125),
      },
      {
        label: "150%",
        scale: getScaleValue(150),
      },
      {
        label: "175%",
        scale: getScaleValue(175),
      },
      {
        label: "200%",
        scale: getScaleValue(200),
      },
    ];

    const result = await Modal.Show({
      parent: wrapper,
      pid: pid,
      title: "Configure UI scaling",
      description: "Select the zoom level",
      buttons: values.map((m) => {
        return {
          type: "primary",
          text: m.label,
        };
      }),
    });

    if (result.canceled === true) return;
    await this.setUiScaling(values[result.id].scale);
  },
  audioInputSelection: async (pid, wrapper) => {
    let audioInputs = [];
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      audioInputs = devices.filter((d) => d.kind === "audioinput");
    }

    let audioResult = await Modal.Show({
      parent: wrapper,
      pid: pid,
      title: "Select Audio Input",
      description: "Choose your preferred audio input device.",
      buttons:
        audioInputs.length > 0
          ? audioInputs.map((d) => ({
              type: "primary",
              text: d.label || `Audio Input ${d.deviceId.slice(-4)}`,
            }))
          : [{ type: "primary", text: "No audio input found", disabled: true }],
    });
    if (audioResult.canceled === true || audioInputs.length === 0) return;

    await window.localforage.setItem(
      "settings__audioInput",
      audioInputs[audioResult.id].deviceId,
    );

    document.dispatchEvent(
      new CustomEvent("CherryTree.Comms.Audio.Update", {
        detail: audioInputs[audioResult.id].deviceId,
      }),
    );

    Notify.show("Audio Input Selection", "Audio input device has been set.");
  },
  videoInputSelection: async (pid, wrapper) => {
    let videoInputs = [];
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoInputs = devices.filter((d) => d.kind === "videoinput");
    }

    let videoResult = await Modal.Show({
      parent: wrapper,
      pid: pid,
      title: "Select Video Input",
      description: "Choose your preferred video input device.",
      buttons:
        videoInputs.length > 0
          ? videoInputs.map((d) => ({
              type: "primary",
              text: d.label || `Video Input ${d.deviceId.slice(-4)}`,
            }))
          : [{ type: "primary", text: "No video input found", disabled: true }],
    });
    if (videoResult.canceled === true || videoInputs.length === 0) return;

    await window.localforage.setItem(
      "settings__videoInput",
      videoInputs[videoResult.id].deviceId,
    );

    document.dispatchEvent(
      new CustomEvent("CherryTree.Comms.Video.Update", {
        detail: videoInputs[videoResult.id].deviceId,
      }),
    );

    Notify.show("Video Input Selection", "Video input device has been set.");
  },
};
