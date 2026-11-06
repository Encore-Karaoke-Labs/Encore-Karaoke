export interface Logger {
  info(tag: string, msg: unknown): void;
  warn(tag: string, msg: unknown): void;
  error(tag: string, msg: unknown): void;
  debug(tag: string, msg: unknown): void;
}

export const logger: Logger = {
  info: (tag, msg) =>
    console.log(`[${new Date().toLocaleTimeString()}] [INFO] [${tag}]`, msg),
  warn: (tag, msg) =>
    console.warn(`[${new Date().toLocaleTimeString()}] [WARN] [${tag}]`, msg),
  error: (tag, msg) =>
    console.error(`[${new Date().toLocaleTimeString()}] [ERR ] [${tag}]`, msg),
  debug: (tag, msg) =>
    console.log(`[${new Date().toLocaleTimeString()}] [DBUG] [${tag}]`, msg),
};
