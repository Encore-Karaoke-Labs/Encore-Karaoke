export interface LibraryInformation {
  title: string;
  description?: string;
  [key: string]: unknown;
}

export interface UpdateServerInfo {
  serverName: string;
  libraryInformation: LibraryInformation;
}

export interface DiscoveredUpdateServer {
  id: string;
  ip: string;
  host: string;
  port: number;
  name: string;
  info: LibraryInformation;
}

export interface SongEntry {
  code: string;
  title: string;
  artist?: string;
  videoPath?: string;
  chorusPath?: string;
  type?: "multiplexed" | "mid" | "kar" | "midi" | string;
  [key: string]: unknown;
}

export interface SongbookExportPayload {
  folderPath: string;
  libraryTitle: string;
  filePath?: string;
}

export interface SongbookReceivePayload {
  songs: SongEntry[];
  filePath: string;
  libraryTitle: string;
}

export interface SongbookProgressPayload {
  phase?: string;
  current: number;
  total: number;
  percentage: number;
}

export interface RemoteSyncFile {
  name: string;
  crc32: number;
}

export interface HashCacheEntry {
  mtime: number;
  crc32: number;
}

export type HashCache = Record<string, HashCacheEntry>;

export interface AlbumArtResult {
  found: boolean;
  imageUrl: string | null;
  source: "cover-art-archive";
  reason?: string;
}

export interface LibraryFlags {
  flipArtistTitle?: boolean;
  enableMtvCategory?: boolean;
  enableDefaultCategories?: boolean;
  isSongHub?: boolean;
  skipToFirstNoteOn?: boolean;
  [key: string]: unknown;
}

export interface LibraryManifest {
  title: string;
  description?: string;
  flags?: LibraryFlags;
  additionalContents?: {
    bgvCategories?: string[];
    bumperImages?: string[];
    soundFont?: string;
    bootVideo?: string;
  };
  [key: string]: unknown;
}

export interface KnownLibraryItem {
  path: string;
  manifest: LibraryManifest;
}

export interface RPCSetPayload {
  state: string;
  details?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  partyId?: string;
  partySize?: number;
  partyMax?: number;
  joinSecret?: string;
  button1?: {
    label: string;
    url: string;
  };
}

export interface RemoteInfo {
  connectedAt: string;
  type: "cloud" | "local";
}

export interface SaveRecordingPayload {
  videoBuffer?: ArrayBuffer | Uint8Array;
  micBuffer?: ArrayBuffer | Uint8Array;
  musicBuffer?: ArrayBuffer | Uint8Array;
  songTitle?: string;
}

export interface SaveCachePayload {
  libraryPath: string;
  songList: unknown[];
  newSongs: unknown[];
  signature: string;
}

export interface ProcessOptions {
  timeout?: number;
  maxBuffer?: number;
  cwd?: string;
  shell?: boolean | string;
  env?: NodeJS.ProcessEnv;
}

export interface ExecCommandPayload {
  command?: string;
  options?: ProcessOptions;
}

export interface SpawnCommandPayload {
  taskId?: string;
  command?: string;
  args?: string[];
  options?: ProcessOptions;
}

export interface InteractiveShellPayload {
  taskId?: string;
}

export interface ProcessCommandResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error: string | null;
  pid?: number;
}

export interface OBSConfig {
  host?: string;
  port?: number;
  password?: string;
  enabled?: boolean;
  autoReconnect?: boolean;
  scenes?: {
    idle?: string;
    singing?: string;
    score?: string;
  };
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
}

export interface TwitchConfig {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  user?: TwitchUser;
  channel?: string;
  autoConnect?: boolean;
  showChatAsDanmaku?: boolean;
}
