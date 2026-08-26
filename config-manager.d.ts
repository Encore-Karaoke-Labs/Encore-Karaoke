export interface ConfigManager {
  init(userDataPath: string): void;
  getItem<T = unknown>(key: string): T;
  setItem(key: string, value: unknown): void;
  getAll(): Record<string, unknown>;
  merge(data: Record<string, unknown>): void;
}

declare const Config: ConfigManager;
export default Config;