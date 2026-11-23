import { logVerbose } from "../core/State.js";
import { loadPluginChain } from "../libs/ChainLoader.js";

/**
 * Manages the instrumental effects chain.
 */
export class ForteMusicChain {
  /**
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   */
  constructor(state, audioCore) {
    this.state = state;
    this.audioCore = audioCore;

    this.saveMusicChainTimeout = null;
  }

  /**
   * Rebuilds the instrumental effect chain from a serializable configuration.
   *
   * @param {Array<Object>} chainConfig - Plugin entries with `path` and `params`.
   */
  async loadMusicChain(chainConfig = []) {
    await loadPluginChain({
      self: this,
      audioCore: this.audioCore,
      chainConfig,
      effects: this.state.effects,
      chainKey: "musicChain",
      chainConfigKey: "musicChainConfig",
      saveTimeoutField: "saveMusicChainTimeout",
      saveKey: "audioConfig.musicChain",
      loadLog: "Loading instrumental plugin configuration",
      saveLog: "Saved updated instrumental chain config to disk.",
      errorLog: "Failed to load instrumental plugin.",
      rebuild: () => this.rebuildMusicChain(),
    });
  }

  /**
   * Rewires the instrumental bus through the loaded plugin instances.
   */
  rebuildMusicChain() {
    const { musicChainInput, musicChainOutput, musicChain } =
      this.state.effects;
    if (!musicChainInput || !musicChainOutput) return;

    logVerbose("Rebuilding instrumental chain", {
      chainLength: musicChain.length,
    });

    musicChainInput.disconnect();

    let lastNode = musicChainInput;
    if (musicChain.length > 0) {
      musicChain.forEach((plugin) => {
        lastNode.connect(plugin.input);
        lastNode = plugin.output;
      });
    }

    lastNode.connect(musicChainOutput);
  }

  /**
   * Updates a parameter on a loaded instrumental plugin.
   *
   * @param {number} pluginIndex - Index within the instrumental chain.
   * @param {string} paramName - Parameter key.
   * @param {number} value - New value.
   */
  setPluginParameter(pluginIndex, paramName, value) {
    const plugin = this.state.effects.musicChain[pluginIndex];
    if (plugin) plugin.setParameter(paramName, value);
  }

  /**
   * Compiles a UI-friendly snapshot of the instrumental chain.
   *
   * @returns {Object} Chain state including the serializable raw config.
   */
  getMusicChainState() {
    const chainState = this.state.effects.musicChain.map((plugin, i) => ({
      name: plugin.name,
      path: this.state.effects.musicChainConfig[i]?.path,
      parameters: plugin.parameters,
      instance: plugin,
    }));

    return {
      chain: chainState,
      rawConfig: this.state.effects.musicChainConfig || [],
    };
  }

  /**
   * Tears down loaded plugins and pending saves.
   */
  cleanup() {
    if (this.saveMusicChainTimeout) clearTimeout(this.saveMusicChainTimeout);
    this.state.effects.musicChain.forEach((plugin) => plugin.disconnect());
    this.state.effects.musicChain = [];
  }
}
