import { state, logVerbose } from "./core/State.js";
import { ForteAudioCore } from "./core/AudioCore.js";
import { FortePianoRoll } from "./modules/PianoRoll.js";
import { ForteSynthesizer } from "./modules/Synthesizer.js";
import { ForteMicrophone } from "./modules/Microphone.js";
import { ForteScoring } from "./modules/Scoring.js";
import { FortePlayback } from "./modules/Playback.js";
import { ForteSFX } from "./modules/SFX.js";

let root;

// DI Container instances
let audioCore;
let pianoRoll;
let synthesizer;
let microphone;
let scoring;
let playback;
let sfx;

/**
 * Dispatches an event notifying the frontend of a change in playback status.
 */
function dispatchPlaybackUpdate() {
  document.dispatchEvent(
    new CustomEvent("CherryTree.Forte.Playback.Update", {
      detail: pkg.data.getPlaybackState(),
    }),
  );
  logVerbose("Dispatching playback update", pkg.data.getPlaybackState());
}

const pkg = {
  name: "Forte Sound Engine Service",
  svcName: "ForteSvc",
  type: "svc",
  privs: 0,

  /**
   * Instantiates global audio contexts and pipeline nodes.
   *
   * @param {Object} Root - Global Application object.
   */
  start: async function (Root) {
    logVerbose("Starting Forte Sound Engine Service for Encore.");
    root = Root;

    const config = await window.config.getAll();

    audioCore = new ForteAudioCore(state, config);
    await audioCore.initialize();

    pianoRoll = new FortePianoRoll(state);
    pianoRoll.initialize();

    synthesizer = new ForteSynthesizer(
      state,
      audioCore,
      dispatchPlaybackUpdate,
    );
    await synthesizer.initialize();

    microphone = new ForteMicrophone(state, audioCore);
    scoring = new ForteScoring(state, audioCore, pianoRoll);

    playback = new FortePlayback(
      state,
      audioCore,
      synthesizer,
      scoring,
      pianoRoll,
      dispatchPlaybackUpdate,
      pkg.data,
    );

    sfx = new ForteSFX(state, audioCore, synthesizer);

    await pkg.data.initializeScoringEngine();
  },

  data: {
    getRecordingAudioStream: () => state.recording.audioStream,
    getMicAudioStream: () => state.recording.micAudioStream,
    getMusicAudioStream: () => state.recording.musicAudioStream,

    loadSfx: (url) => sfx.loadSfx(url),
    playSfx: (url, volume) => sfx.playSfx(url, volume),
    stopSfx: () => sfx.stopSfx(),

    playRemoteStream: (peerId, stream) => sfx.playRemoteStream(peerId, stream),
    stopRemoteStream: (peerId) => sfx.stopRemoteStream(peerId),
    clearRemoteStreams: () => sfx.clearRemoteStreams(),

    getPlaybackDevices: () => audioCore.getPlaybackDevices(),
    setPlaybackDevice: (deviceId) =>
      audioCore.setPlaybackDevice(deviceId, dispatchPlaybackUpdate),

    setPianoRollContainer: (containerSelector) =>
      pianoRoll.setContainer(containerSelector),
    togglePianoRollVisibility: (bool) => pianoRoll.toggleVisibility(bool),

    loadSoundFont: (url) => synthesizer.loadSoundFont(url, playback),
    loadTrack: (url) => playback.loadTrack(url),
    playTrack: () => playback.playTrack(),
    pauseTrack: () => playback.pauseTrack(),
    stopTrack: () => playback.stopTrack(),

    setTrackVolume: (level) => audioCore.setTrackVolume(level),
    setSfxVolume: (level) => audioCore.setSfxVolume(level),

    setVerbose: (enabled) => {
      state.verbose = Boolean(enabled);
      if (state.verbose) logVerbose("Verbose logging enabled");
    },

    setMultiplexPan: (panValue) => playback.setMultiplexPan(panValue),
    setTranspose: (semitones) => playback.setTranspose(semitones),
    setGuideTrackVolume: (volume) => playback.setGuideTrackVolume(volume),

    setChannelVolume: (channelNumber, volume) =>
      synthesizer.setChannelVolume(channelNumber, volume),
    setChannelExpression: (channelNumber, expression) =>
      synthesizer.setChannelExpression(channelNumber, expression),
    switchDrumPreset: (channelNumber, drumPreset) =>
      synthesizer.switchDrumPreset(channelNumber, drumPreset),
    getAvailableDrumPresets: () => synthesizer.getAvailableDrumPresets(),
    getCurrentDrumPreset: (channelNumber) =>
      synthesizer.getCurrentDrumPreset(channelNumber),

    getScoringState: () => scoring.getScoringState(),
    getPlaybackState: () => playback.getPlaybackState(),

    initializeScoringEngine: async () => {
      if (!audioCore.context) return;
      await microphone.getMicDevices();
      await microphone.startMicInput(state.scoring.currentMicDeviceId, scoring);
    },

    runLatencyTest: () => scoring.runLatencyTest(),
    setLatency: (latencySeconds) => scoring.setLatency(latencySeconds),

    getMicDevices: () => microphone.getMicDevices(),
    setMicDevice: (deviceId) => microphone.setMicDevice(deviceId, scoring),
    setMicInputEnabled: (enabled) =>
      microphone.setMicInputEnabled(enabled, scoring),
    stopMicInput: () => microphone.stopMicInput(),
    startMicInput: (deviceId) => microphone.startMicInput(deviceId, scoring),

    loadVocalChain: (chainConfig) => microphone.loadVocalChain(chainConfig),
    rebuildVocalChain: () => microphone.rebuildVocalChain(),
    setPluginParameter: (pluginIndex, paramName, value) =>
      microphone.setPluginParameter(pluginIndex, paramName, value),
    setMicMonitorEnabled: (enabled) => microphone.setMicMonitorEnabled(enabled),
    setMicMonitorVolume: (level) => microphone.setMicMonitorVolume(level),
    setMicRecordingVolume: (level) => microphone.setMicRecordingVolume(level),
    setMusicRecordingVolume: (level) =>
      microphone.setMusicRecordingVolume(level),
    getVocalChainState: () => microphone.getVocalChainState(),
  },

  end: async function () {
    logVerbose("Shutting down.");
    if (pianoRoll) pianoRoll.cleanup();
    if (microphone) microphone.cleanup();
    if (audioCore) audioCore.cleanup();
    if (sfx) sfx.cleanup();
    if (playback) playback.cleanup();
    if (synthesizer) synthesizer.cleanup();
  },
};

export default pkg;
