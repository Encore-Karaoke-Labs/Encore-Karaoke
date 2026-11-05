import { logVerbose } from "../core/State.js";

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
    const config = Array.isArray(chainConfig) ? chainConfig : [];

    this.state.effects.musicChainConfig = JSON.parse(JSON.stringify(config));
    this.state.effects.musicChain.forEach((plugin) => plugin.disconnect());
    this.state.effects.musicChain = [];

    for (let i = 0; i < config.length; i++) {
      const pluginConfig = config[i];
      try {
        logVerbose("Loading instrumental plugin configuration", pluginConfig);
        const pluginModule = await import(pluginConfig.path);
        const PluginClass = pluginModule.default;
        let pluginInstance;

        if (typeof PluginClass.create === "function") {
          pluginInstance = await PluginClass.create(this.audioCore.context);
        } else {
          pluginInstance = new PluginClass(this.audioCore.context);
        }

        if (pluginConfig.params) {
          for (const [key, value] of Object.entries(pluginConfig.params)) {
            pluginInstance.setParameter(key, value);
          }
        }

        const originalSetParameter = pluginInstance.setParameter;
        const self = this;

        if (typeof originalSetParameter === "function") {
          pluginInstance.setParameter = function (paramName, value) {
            originalSetParameter.call(this, paramName, value);

            if (self.state.effects.musicChainConfig[i]) {
              if (!self.state.effects.musicChainConfig[i].params) {
                self.state.effects.musicChainConfig[i].params = {};
              }
              self.state.effects.musicChainConfig[i].params[paramName] = value;

              if (self.saveMusicChainTimeout)
                clearTimeout(self.saveMusicChainTimeout);
              self.saveMusicChainTimeout = setTimeout(() => {
                if (
                  window.config &&
                  typeof window.config.setItem === "function"
                ) {
                  window.config.setItem(
                    "audioConfig.musicChain",
                    self.state.effects.musicChainConfig,
                  );
                  logVerbose(
                    "Saved updated instrumental chain config to disk.",
                  );
                }
              }, 300);
            }
          };
        }

        this.state.effects.musicChain.push(pluginInstance);
      } catch (e) {
        console.error(`[FORTE SVC] Failed to load instrumental plugin.`, e);
      }
    }

    this.rebuildMusicChain();
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
