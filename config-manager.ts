import fs from "node:fs";
import path from "node:path";

export interface AudioMixDeviceConfig {
  volume?: number;
  outputDevice?: string;
  inputDevice?: string;
}

export interface AudioConfig {
  mix: {
    instrumental: AudioMixDeviceConfig;
    scoring: AudioMixDeviceConfig;
  };
}

export interface VideoConfig {
  syncOffset: number;
}

export interface AppConfig {
  setupComplete: boolean;
  audioConfig: AudioConfig;
  videoConfig: VideoConfig;
}

const DEFAULT_CONFIG: AppConfig = {
  setupComplete: false,
  audioConfig: {
    mix: {
      instrumental: { volume: 1, outputDevice: "default" },
      scoring: { inputDevice: "default" },
    },
  },
  videoConfig: {
    syncOffset: 0,
  },
};

export class ConfigManager {
  private configPath: string | null;
  private data: Record<string, unknown>;
  public isLoaded: boolean;

  public constructor() {
    this.configPath = null;
    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<
      string,
      unknown
    >;
    this.isLoaded = false;
  }

  /**
   * Initializes the config manager with the application's user data path.
   * @param userDataPath - The path provided by Electron's app.getPath("userData").
   */
  public init(userDataPath: string): void {
    this.configPath = path.join(userDataPath, "encore-settings.json");
    this.load();
  }

  private _getValueByPath(
    obj: Record<string, unknown>,
    pathStr: string,
  ): unknown {
    const keys = pathStr.split(".");
    return keys.reduce(
      (acc: unknown, key: string) =>
        acc !== undefined &&
        acc !== null &&
        typeof acc === "object" &&
        key in (acc as Record<string, unknown>)
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
  }

  private _setValueByPath(
    obj: Record<string, unknown>,
    pathStr: string,
    value: unknown,
  ): void {
    const keys = pathStr.split(".");
    const lastKey = keys.pop();

    if (!lastKey) {
      return;
    }

    const parent = keys.reduce((acc: Record<string, unknown>, key: string) => {
      if (typeof acc[key] === "undefined" || acc[key] === null) {
        acc[key] = {};
      }
      return acc[key] as Record<string, unknown>;
    }, obj);

    parent[lastKey] = value;
  }

  /**
   * Loads the configuration from the file system. This method is designed to be
   * resilient and will never fail, falling back to safe defaults if the file
   * is missing or corrupted.
   */
  public load(): void {
    if (!this.configPath) {
      return;
    }

    if (!fs.existsSync(this.configPath)) {
      console.log(
        `[CONFIG] No settings file found at "${this.configPath}". Using default configuration.`,
      );
      this.isLoaded = true;
      return;
    }

    try {
      const fileData = fs.readFileSync(this.configPath, "utf8");

      if (!fileData.trim()) {
        console.warn(
          `[CONFIG] Settings file is empty. Using default configuration.`,
        );
        this.isLoaded = true;
        return;
      }

      const parsedData = JSON.parse(fileData) as Record<string, unknown>;

      this.data = Object.assign(
        JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>,
        parsedData,
      );
      console.log("[CONFIG] Successfully loaded settings from file.");
    } catch (error) {
      console.error(
        `[CONFIG] Error reading or parsing "${this.configPath}". Backing up corrupted file and using defaults.`,
        error,
      );

      fs.renameSync(
        this.configPath,
        `${this.configPath}.corrupted-${Date.now().toString()}`,
      );

      this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<
        string,
        unknown
      >;
    }

    this.isLoaded = true;
  }

  /**
   * Saves the current in-memory configuration to the file system.
   */
  public save(): void {
    if (!this.configPath) {
      return;
    }

    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error(
        `[CONFIG] Failed to save settings to "${this.configPath}".`,
        error,
      );
    }
  }

  public getItem<T = unknown>(key: string): T {
    return this._getValueByPath(this.data, key) as T;
  }

  public setItem(key: string, value: unknown): void {
    this._setValueByPath(this.data, key, value);
    this.save();
  }

  public merge(dataObject: Record<string, unknown>): void {
    const deepMerge = (
      target: Record<string, unknown>,
      source: Record<string, unknown>,
    ): Record<string, unknown> => {
      for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          const sourceValue = source[key];

          if (sourceValue instanceof Object && key in target) {
            const targetValue = (target[key] || {}) as Record<string, unknown>;
            Object.assign(
              sourceValue,
              deepMerge(targetValue, sourceValue as Record<string, unknown>),
            );
          }
        }
      }
      Object.assign(target || {}, source);
      return target;
    };

    this.data = deepMerge(this.data, dataObject);
    this.save();
  }

  public getAll(): Record<string, unknown> {
    return this.data;
  }
}

export default new ConfigManager();
