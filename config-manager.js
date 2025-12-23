const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG = {
  setupComplete: false,
};

class ConfigManager {
  constructor() {
    this.configPath = null;
    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.isLoaded = false;
  }

  init(userDataPath) {
    this.configPath = path.join(userDataPath, "karaoke-config.json");
    this.load();
  }

  // --- Private Helpers for Dot Notation ---

  _getValueByPath(obj, path) {
    const keys = path.split(".");
    return keys.reduce(
      (acc, key) => (acc && acc[key] !== "undefined" ? acc[key] : undefined),
      obj,
    );
  }

  _setValueByPath(obj, path, value) {
    const keys = path.split(".");
    const lastKey = keys.pop();
    const parent = keys.reduce((acc, key) => {
      if (typeof acc[key] === "undefined" || acc[key] === null) {
        acc[key] = {};
      }
      return acc[key];
    }, obj);
    parent[lastKey] = value;
  }

  // --- Core Methods ---

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileData = fs.readFileSync(this.configPath, "utf8");
        const parsedData = JSON.parse(fileData);
        // We use Object.assign to merge the loaded data onto our default structure.
        // This ensures `setupComplete` is always present even if the file is empty.
        this.data = Object.assign(
          JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
          parsedData,
        );
        this.isLoaded = true;
      }
    } catch (error) {
      this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      throw new Error(
        `Failed to load or parse config, using defaults: ${error.message}`,
      );
    }
  }

  save() {
    if (!this.configPath) return;
    try {
      // Write the entire, potentially modified, data object to the file.
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  // --- Public API (localStorage-like) ---

  /**
   * Retrieves a value from the configuration using a dot notation path.
   * @param {string} key - The dot notation key (e.g., 'audioConfig.mix.volume').
   * @returns {any} The value found at the specified key, or undefined.
   */
  getItem(key) {
    return this._getValueByPath(this.data, key);
  }

  /**
   * Sets a value in the configuration using a dot notation path and saves to file.
   * @param {string} key - The dot notation key (e.g., 'audioConfig.mix.volume').
   * @param {any} value - The new value to set.
   */
  setItem(key, value) {
    this._setValueByPath(this.data, key, value);
    this.save();
  }

  /**
   * Merges an object into the configuration and saves to file.
   * Useful for the initial setup wizard to apply all settings at once.
   * @param {object} dataObject - The object to merge into the current config.
   */
  merge(dataObject) {
    // A simple deep merge utility
    const deepMerge = (target, source) => {
      for (const key in source) {
        if (source[key] instanceof Object && key in target) {
          Object.assign(source[key], deepMerge(target[key], source[key]));
        }
      }
      Object.assign(target || {}, source);
      return target;
    };

    this.data = deepMerge(this.data, dataObject);
    this.save();
  }

  /**
   * Returns the entire configuration object.
   * @returns {object} The complete configuration object.
   */
  getAll() {
    return this.data;
  }
}

module.exports = new ConfigManager();
