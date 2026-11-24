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
    numberSounds?: Record<string, string> | string[];
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

export type RecordingTrack = "video" | "mic" | "music";

export interface StartRecordingPayload {
  songTitle?: string;
}

export interface RecordingChunkPayload {
  id: string;
  track: RecordingTrack;
  chunk: ArrayBuffer | Uint8Array;
}

export interface FinishRecordingPayload {
  id: string;
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
  scopes?: string[];
  user?: TwitchUser;
  channel?: string;
  autoConnect?: boolean;
  showChatAsDanmaku?: boolean;
}

export interface TwitchChannelInfo {
  title: string;
  gameId: string;
  gameName: string;
  gameBoxArtUrl?: string;
  language: string;
  tags: string[];
  contentClassificationLabels: string[];
  isBrandedContent: boolean;
  delay: number;
}

export interface TwitchLiveInfo {
  isLive: boolean;
  startedAt: string | null;
  viewerCount: number | null;
}

export interface TwitchContentClassificationLabel {
  id: string;
  name: string;
  description: string;
}

export interface TwitchBroadcastInfo {
  channel: TwitchChannelInfo;
  live: TwitchLiveInfo;
  contentClassificationLabels: TwitchContentClassificationLabel[];
}

export interface ClerkUserSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  fullName: string | null;
  imageUrl: string | null;
  primaryEmail: string | null;
}

export interface ClerkAccountState {
  signedIn: boolean;
  user: ClerkUserSummary | null;
  sessionId: string | null;
  error?: string;
  cancelled?: boolean;
}

export interface ClerkSessionToken {
  token: string;
  sessionId: string;
  userId: string | null;
  expiresAt: number | null;
}

export interface ClerkProfileUpdate {
  nickname?: string;
  avatar?: string | null;
}

export interface ClerkSessionResource {
  id: string;
  status?: string;
  user?: ClerkUserResource;
  public_user_data?: { user_id?: string };
}

export interface ClerkUserResource {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: Array<{ id: string; email_address: string }>;
}

export interface ClerkClientResource {
  id: string;
  sessions?: ClerkSessionResource[];
  last_active_session_id?: string | null;
}

export interface ClerkClientResponse {
  response?: ClerkClientResource;
}

export interface ClerkTokenResponse {
  jwt?: string | { raw?: string; getRawString?: () => string } | null;
}

export interface ClerkErrorResponse {
  errors?: Array<{ message?: string; long_message?: string }>;
}
