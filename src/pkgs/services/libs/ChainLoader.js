import { logVerbose } from "../core/State.js";

/**
 * Loads a chain of audio plugins into an effects chain, mirroring each plugin's
 * runtime parameter changes back into the persistent chain config with a
 * debounced save to window.config.
 *
 * @param {Object} opts
 * @param {Object} opts.self - The owning module instance (provides timeout field).
 * @param {Object} opts.audioCore - Sound engine core exposing audioCore.context.
 * @param {Array} opts.chainConfig - Raw plugin config entries.
 * @param {Object} opts.effects - The state.effects object to mutate.
 * @param {string} opts.chainKey - State field holding the live plugin array.
 * @param {string} opts.chainConfigKey - State field holding the persisted config.
 * @param {string} opts.saveTimeoutField - Instance field holding the save timeout id.
 * @param {string} opts.saveKey - window.config key for persisted chain config.
 * @param {string} opts.loadLog - Log message emitted while loading each plugin.
 * @param {string} opts.saveLog - Log message emitted after saving config.
 * @param {string} opts.errorLog - Log message emitted when a plugin fails to load.
 * @param {Function} opts.rebuild - Callback to rebuild the audio graph after load.
 */
export async function loadPluginChain({
  self,
  audioCore,
  chainConfig,
  effects,
  chainKey,
  chainConfigKey,
  saveTimeoutField,
  saveKey,
  loadLog,
  saveLog,
  errorLog,
  rebuild,
}) {
  const config = Array.isArray(chainConfig) ? chainConfig : [];

  effects[chainConfigKey] = JSON.parse(JSON.stringify(config));
  effects[chainKey].forEach((plugin) => plugin.disconnect());
  effects[chainKey] = [];

  for (let i = 0; i < config.length; i++) {
    const pluginConfig = config[i];
    try {
      logVerbose(loadLog, pluginConfig);

      const pluginModule = await import(pluginConfig.path);
      const PluginClass = pluginModule.default;
      let pluginInstance;

      if (typeof PluginClass.create === "function") {
        pluginInstance = await PluginClass.create(audioCore.context);
      } else {
        pluginInstance = new PluginClass(audioCore.context);
      }

      if (pluginConfig.params) {
        for (const [key, value] of Object.entries(pluginConfig.params)) {
          pluginInstance.setParameter(key, value);
        }
      }

      const originalSetParameter = pluginInstance.setParameter;

      if (typeof originalSetParameter === "function") {
        pluginInstance.setParameter = function (paramName, value) {
          originalSetParameter.call(this, paramName, value);

          const entry = effects[chainConfigKey]?.[i];
          if (entry) {
            if (!entry.params) entry.params = {};
            entry.params[paramName] = value;

            if (self[saveTimeoutField]) clearTimeout(self[saveTimeoutField]);
            self[saveTimeoutField] = setTimeout(() => {
              if (window.config && typeof window.config.setItem === "function") {
                window.config.setItem(saveKey, effects[chainConfigKey]);
                logVerbose(saveLog);
              }
            }, 300);
          }
        };
      }

      effects[chainKey].push(pluginInstance);
    } catch (e) {
      console.error(`[FORTE SVC] ${errorLog}`, e);
    }
  }

  rebuild();
}
