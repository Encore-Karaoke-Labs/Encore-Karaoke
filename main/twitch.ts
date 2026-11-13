import { ipcMain } from "electron";
import Config from "../config-manager";
import { logger } from "./logger";
import { appState } from "./state";
import type {
  TwitchChannelInfo,
  TwitchConfig,
  TwitchContentClassificationLabel,
  TwitchLiveInfo,
  TwitchUser,
} from "./types";

const TWITCH_DEVICE_URL = "https://id.twitch.tv/oauth2/device";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_HELIX_BASE_URL = "https://api.twitch.tv/helix";
const TWITCH_HELIX_USERS_URL = `${TWITCH_HELIX_BASE_URL}/users`;
const TWITCH_EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const TWITCH_EVENTSUB_SUBSCRIPTIONS_URL =
  "https://api.twitch.tv/helix/eventsub/subscriptions";

const TWITCH_INGEST_URL = "rtmp://live.twitch.tv/app/";
const CCL_CACHE_TTL = 30 * 60 * 1000;

const OFFICIAL_CLIENT_ID = "o2qq87u7gsa2o2f3te95jw2al496rx";
const FALLBACK_CLIENT_ID = (process.env.ENCORE_TWITCH_CLIENT_ID ?? "").trim();

const REQUIRED_SCOPES = [
  "user:read:chat",
  "channel:manage:broadcast",
  "channel:read:stream_key",
];
const TWITCH_SCOPES = [...REQUIRED_SCOPES];

const FALLBACK_CONTENT_CLASSIFICATION_LABELS: TwitchContentClassificationLabel[] =
  [
    {
      id: "DebatedSocialIssuesAndPolitics",
      name: "Politics and Sensitive Social Issues",
      description:
        "Discussions or debates about politics or sensitive social issues such as elections, civic integrity, military conflict, and civil rights in a polarizing manner.",
    },
    {
      id: "DrugsIntoxication",
      name: "Drugs, Intoxication, or Excessive Tobacco Use",
      description:
        "Excessive tobacco glorification or promotion, any marijuana consumption/use, legal drug and alcohol induced intoxication, discussions of illegal drugs.",
    },
    {
      id: "Gambling",
      name: "Gambling",
      description:
        "Participating in online or in-person gambling, poker or fantasy sports, that involve the exchange of real money.",
    },
    {
      id: "MatureGame",
      name: "Mature-rated game",
      description:
        "Games that are rated Mature or less suitable for a younger audience.",
    },
    {
      id: "ProfanityVulgarity",
      name: "Significant Profanity or Vulgarity",
      description:
        "Prolonged, and repeated use of obscenities, profanities, and vulgarities, especially as a regular part of speech.",
    },
    {
      id: "SexualThemes",
      name: "Sexual Themes",
      description:
        "Content that focuses on sexualized physical attributes and activities, sexual topics, or experiences.",
    },
    {
      id: "ViolentGraphic",
      name: "Violent and Graphic Depictions",
      description:
        "Simulations and/or depictions of realistic violence, gore, extreme injury, or death.",
    },
  ];

const WELCOME_TIMEOUT = 15000;
const RECONNECT_BASE_DELAY = 5000;
const RECONNECT_MAX_DELAY = 60000;
const RECENT_MESSAGE_LIMIT = 500;

interface DeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  clientId: string;
  generation: number;
}

interface TokenResult {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string[] | string;
  message?: string;
  error?: string;
  status?: number;
}

interface TokenValidation {
  login: string;
  userId: string;
  scopes: string[];
  expiresIn?: number;
}

interface TwitchChatMessage {
  id: string;
  userId: string;
  login: string;
  displayName: string;
  color?: string;
  text: string;
  bits: number;
  isModerator: boolean;
  isSubscriber: boolean;
  isBroadcaster: boolean;
  timestamp: number;
}

interface EventSubBadge {
  set_id?: unknown;
  id?: unknown;
  info?: unknown;
}

interface EventSubChatEvent {
  broadcaster_user_id?: unknown;
  broadcaster_user_login?: unknown;
  broadcaster_user_name?: unknown;
  chatter_user_id?: unknown;
  chatter_user_login?: unknown;
  chatter_user_name?: unknown;
  message_id?: unknown;
  message?: { text?: unknown };
  color?: unknown;
  badges?: EventSubBadge[];
  cheer?: { bits?: unknown } | null;
}

interface EventSubMessage {
  metadata?: {
    message_type?: unknown;
    subscription_type?: unknown;
    message_timestamp?: unknown;
  };
  payload?: {
    session?: {
      id?: unknown;
      reconnect_url?: unknown;
    };
    event?: EventSubChatEvent;
  };
}

interface SubscribeParams {
  ws: WebSocket;
  generation: number;
  clientId: string;
  token: string;
  userId: string;
  broadcasterId: string;
  channel: string;
  sessionId: string;
}

type ConnectResult = { success: boolean; error?: string };

interface TwitchApiContext {
  clientId: string;
  token: string;
  userId: string;
}

interface HelixResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

interface TwitchCategory {
  id: string;
  name: string;
  boxArtUrl?: string;
}

interface TwitchBroadcastResult {
  success: boolean;
  channel?: TwitchChannelInfo;
  live?: TwitchLiveInfo;
  contentClassificationLabels?: TwitchContentClassificationLabel[];
  error?: string;
  reloginRequired?: boolean;
}

interface TwitchCategoriesResult {
  success: boolean;
  categories?: TwitchCategory[];
  error?: string;
  reloginRequired?: boolean;
}

interface TwitchStreamKeyResult {
  success: boolean;
  streamKey?: string;
  ingestUrl?: string;
  error?: string;
  reloginRequired?: boolean;
}

class TwitchService {
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private shouldReconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_DELAY;
  private lastError: string | null = null;
  private reloginRequired = false;
  private recentMessageIds = new Set<string>();
  private deviceLogin: DeviceLogin | null = null;
  private devicePollTimer: ReturnType<typeof setTimeout> | null = null;
  private loginGeneration = 0;
  private connectPromise: Promise<ConnectResult> | null = null;
  private connectionGeneration = 0;
  private cclCache: {
    labels: TwitchContentClassificationLabel[];
    fetchedAt: number;
  } | null = null;

  public registerIpc(): void {
    ipcMain.handle("twitch-get-status", () => this.getStatus());

    ipcMain.handle("twitch-start-login", async () => {
      return await this.startLogin();
    });

    ipcMain.handle("twitch-cancel-login", () => {
      this.cancelLogin();
      return { success: true };
    });

    ipcMain.handle("twitch-logout", async () => {
      await this.logout();
      return { success: true };
    });

    ipcMain.handle("twitch-connect", async () => {
      return await this.connect();
    });

    ipcMain.handle("twitch-disconnect", async () => {
      await this.disconnect();
      return { success: true };
    });

    ipcMain.handle("twitch-set-preferences", (_event, preferences: unknown) => {
      return this.setPreferences(preferences);
    });

    ipcMain.handle("twitch-get-broadcast-info", async () => {
      return await this.getBroadcastInfo();
    });

    ipcMain.handle(
      "twitch-update-broadcast-info",
      async (_event, update: unknown) => {
        return await this.updateBroadcastInfo(update);
      },
    );

    ipcMain.handle(
      "twitch-search-categories",
      async (_event, query: unknown) => {
        return await this.searchCategories(query);
      },
    );

    ipcMain.handle("twitch-get-stream-key", async () => {
      return await this.getStreamKey();
    });
  }

  public initialize(): void {
    const config = this.getConfig();
    if (config.autoConnect !== false && config.accessToken) {
      void this.connect().then((result) => {
        if (!result.success) {
          logger.warn(
            "TWITCH",
            `Automatic connection failed: ${result.error ?? "Unknown error"}`,
          );
        }
      });
    }
  }

  public dispose(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearDeviceLogin();
    this.closeSocket();
    this.connected = false;
    this.connecting = false;
  }

  public getStatus(): {
    authenticated: boolean;
    user: TwitchUser | null;
    channel: string;
    connected: boolean;
    connecting: boolean;
    error: string | null;
    reloginRequired: boolean;
    login: {
      userCode: string;
      verificationUri: string;
      expiresAt: number;
    } | null;
    autoConnect: boolean;
    showChatAsDanmaku: boolean;
  } {
    const config = this.getConfig();

    return {
      authenticated: Boolean(config.accessToken),
      user: config.user ?? null,
      channel: config.channel || config.user?.login || "",
      connected: this.connected,
      connecting: this.connecting,
      error: this.lastError,
      reloginRequired: this.reloginRequired,
      login: this.deviceLogin
        ? {
            userCode: this.deviceLogin.userCode,
            verificationUri: this.deviceLogin.verificationUri,
            expiresAt: this.deviceLogin.expiresAt,
          }
        : null,
      autoConnect: config.autoConnect !== false,
      showChatAsDanmaku: config.showChatAsDanmaku !== false,
    };
  }

  private async startLogin(): Promise<{
    success: boolean;
    userCode?: string;
    verificationUri?: string;
    expiresIn?: number;
    error?: string;
  }> {
    const clientId = this.resolveClientId();

    this.clearDeviceLogin();
    const generation = this.loginGeneration;
    this.lastError = null;
    this.reloginRequired = false;

    try {
      const response = await fetch(TWITCH_DEVICE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          scopes: TWITCH_SCOPES.join(" "),
        }),
      });

      if (this.loginGeneration !== generation) {
        return { success: false, error: "Login was cancelled." };
      }

      const data = (await response.json().catch(() => ({}))) as {
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        expires_in?: number;
        interval?: number;
        message?: string;
        error?: string;
      };

      if (
        !response.ok ||
        typeof data.device_code !== "string" ||
        typeof data.user_code !== "string" ||
        typeof data.verification_uri !== "string"
      ) {
        const message =
          data.message ||
          data.error ||
          `Twitch rejected the login request (HTTP ${response.status}).`;
        logger.error("TWITCH", `Device login failed: ${message}`);
        return { success: false, error: message };
      }

      const expiresIn =
        typeof data.expires_in === "number" && data.expires_in > 0
          ? data.expires_in
          : 1800;
      const interval =
        typeof data.interval === "number" && data.interval > 0
          ? data.interval
          : 5;

      this.deviceLogin = {
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresAt: Date.now() + expiresIn * 1000,
        intervalMs: interval * 1000,
        clientId,
        generation,
      };

      logger.info(
        "TWITCH",
        `Device login started. Waiting for authorization code ${data.user_code}.`,
      );
      this.broadcastStatus();
      this.scheduleDevicePoll(generation);

      return {
        success: true,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        expiresIn,
      };
    } catch (error) {
      const message = (error as Error).message;
      logger.error("TWITCH", `Could not start device login: ${message}`);
      this.lastError = "Could not reach Twitch. Check your connection.";
      this.broadcastStatus();
      return { success: false, error: this.lastError };
    }
  }

  private cancelLogin(): void {
    this.clearDeviceLogin();
    this.lastError = null;
    this.broadcastStatus();
  }

  private clearDeviceLogin(): void {
    if (this.devicePollTimer) {
      clearTimeout(this.devicePollTimer);
      this.devicePollTimer = null;
    }
    this.deviceLogin = null;
    this.loginGeneration++;
  }

  private scheduleDevicePoll(generation: number): void {
    const login = this.deviceLogin;
    if (!login || login.generation !== generation) return;

    if (Date.now() >= login.expiresAt) {
      this.lastError = "The Twitch login code expired. Please try again.";
      this.clearDeviceLogin();
      this.broadcastStatus();
      return;
    }

    this.devicePollTimer = setTimeout(() => {
      this.devicePollTimer = null;
      void this.pollDeviceLogin(generation);
    }, login.intervalMs);
  }

  private async pollDeviceLogin(generation: number): Promise<void> {
    const login = this.deviceLogin;
    if (!login || login.generation !== generation) return;

    if (Date.now() >= login.expiresAt) {
      this.lastError = "The Twitch login code expired. Please try again.";
      this.clearDeviceLogin();
      this.broadcastStatus();
      return;
    }

    try {
      const response = await fetch(TWITCH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: login.clientId,
          scopes: TWITCH_SCOPES.join(" "),
          device_code: login.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      if (this.deviceLogin?.generation !== generation) return;

      const data = (await response.json().catch(() => ({}))) as TokenResult;

      if (response.ok && data.access_token) {
        await this.completeLogin(data, login.clientId, data.scope, generation);
        return;
      }

      const errorCode = (data.message || data.error || "").toLowerCase();

      if (errorCode === "authorization_pending") {
        this.scheduleDevicePoll(generation);
        return;
      }

      if (errorCode === "slow_down") {
        if (this.deviceLogin) {
          this.deviceLogin.intervalMs += 5000;
        }
        this.scheduleDevicePoll(generation);
        return;
      }

      if (errorCode === "expired_token") {
        this.lastError = "The Twitch login code expired. Please try again.";
      } else {
        this.lastError =
          data.message ||
          data.error ||
          "Twitch could not complete the login. Please try again.";
      }

      logger.error("TWITCH", `Device login poll failed: ${this.lastError}`);
      this.clearDeviceLogin();
      this.broadcastStatus();
    } catch (error) {
      logger.error(
        "TWITCH",
        `Device login poll error: ${(error as Error).message}`,
      );
      this.lastError = "Could not reach Twitch. Retrying...";
      this.broadcastStatus();
      this.scheduleDevicePoll(generation);
    }
  }

  private async completeLogin(
    data: TokenResult,
    clientId: string,
    scope: unknown,
    generation: number,
  ): Promise<void> {
    if (!data.access_token || this.deviceLogin?.generation !== generation) {
      return;
    }

    const config = this.getConfig();
    const expiresIn =
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : 3600;

    const grantedScopes = normalizeScopes(scope);

    config.accessToken = data.access_token;
    config.refreshToken = data.refresh_token ?? config.refreshToken;
    config.tokenExpiresAt = Date.now() + expiresIn * 1000;
    if (grantedScopes.length > 0) config.scopes = grantedScopes;
    this.reloginRequired = false;

    this.saveConfig(config);
    this.clearDeviceLogin();

    logger.info(
      "TWITCH",
      `Authorized with scopes: ${grantedScopes.length > 0 ? grantedScopes.join(", ") : "unknown"}`,
    );

    try {
      const user = await this.fetchHelixUser(clientId, data.access_token);
      const updated = this.getConfig();
      updated.user = user;
      if (!updated.channel) updated.channel = user.login;
      this.saveConfig(updated);

      logger.info("TWITCH", `Logged in as ${user.displayName} (${user.login})`);
      this.lastError = null;
      this.broadcastStatus();

      if (updated.autoConnect !== false) {
        await this.connect();
      }
    } catch (error) {
      const message = (error as Error).message;
      logger.error("TWITCH", `Could not load Twitch profile: ${message}`);
      this.lastError = "Logged in, but the Twitch profile could not be loaded.";
      this.broadcastStatus();
    }
  }

  private async logout(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    await this.disconnect();
    const config = this.getConfig();
    this.clearAuthInConfig(config);
    this.saveConfig(config);
    this.lastError = null;
    this.reloginRequired = false;
    this.broadcastStatus();
    logger.info("TWITCH", "Logged out of Twitch.");
  }

  private clearAuthInConfig(config: TwitchConfig): void {
    delete config.accessToken;
    delete config.refreshToken;
    delete config.tokenExpiresAt;
    delete config.scopes;
    delete config.user;
  }

  private connect(): Promise<ConnectResult> {
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async connectInternal(): Promise<ConnectResult> {
    const generation = ++this.connectionGeneration;
    this.shouldReconnect = true;
    this.clearReconnectTimer();

    const initialConfig = this.getConfig();
    const clientId = this.resolveClientId();

    if (!initialConfig.accessToken) {
      return this.failConnect("Log in with Twitch before connecting.");
    }

    this.connecting = true;
    this.lastError = null;
    this.broadcastStatus();

    let token = await this.ensureAccessToken();

    if (!token) {
      return this.failConnect(
        "Your Twitch session expired. Please log in again.",
      );
    }

    let validation = await this.validateToken(token);

    if (!validation) {
      const config = this.getConfig();
      if (
        config.refreshToken &&
        (await this.refreshAccessToken(clientId, config.refreshToken))
      ) {
        token = this.getConfig().accessToken ?? null;
        validation = token ? await this.validateToken(token) : null;
      }
    }

    if (!token || !validation) {
      const config = this.getConfig();
      this.clearAuthInConfig(config);
      this.saveConfig(config);
      this.reloginRequired = true;
      return this.failConnect(
        "Your Twitch session is no longer valid. Please log in again.",
      );
    }

    const missingScopes = REQUIRED_SCOPES.filter(
      (scope) => !validation.scopes.includes(scope),
    );

    if (missingScopes.length > 0) {
      const config = this.getConfig();
      this.clearAuthInConfig(config);
      this.saveConfig(config);
      this.reloginRequired = true;
      return this.failConnect(
        "Twitch permissions have changed. Please log in again to renew access to your channel.",
      );
    }

    const config = this.getConfig();
    let user =
      config.user && config.user.id === validation.userId
        ? config.user
        : undefined;

    if (!user) {
      try {
        user = await this.fetchHelixUser(clientId, token);
      } catch (error) {
        const message = (error as Error).message;
        logger.error("TWITCH", `Could not load Twitch profile: ${message}`);
        return this.failConnect(
          "Could not load your Twitch profile. Please try again.",
        );
      }
    }

    const channel = normalizeChannel(user.login);

    if (!channel) {
      return this.failConnect(
        "Could not determine your Twitch channel. Please log in again.",
      );
    }

    if (generation !== this.connectionGeneration) {
      return { success: false, error: "Connection cancelled." };
    }

    config.user = user;
    config.channel = channel;
    config.scopes = validation.scopes;
    if (typeof validation.expiresIn === "number") {
      config.tokenExpiresAt = Date.now() + validation.expiresIn * 1000;
    }
    this.saveConfig(config);

    if (generation !== this.connectionGeneration) {
      return { success: false, error: "Connection cancelled." };
    }

    this.openSocket({
      token,
      clientId,
      userId: validation.userId,
      broadcasterId: user.id,
      channel,
    });

    return { success: true };
  }

  private failConnect(message: string): ConnectResult {
    this.connected = false;
    this.connecting = false;
    this.lastError = message;
    this.broadcastStatus();
    return { success: false, error: message };
  }

  private async disconnect(): Promise<void> {
    this.connectionGeneration++;
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.closeSocket();
    this.connected = false;
    this.connecting = false;
    this.lastError = null;
    this.broadcastStatus();
  }

  private openSocket(options: {
    token: string;
    clientId: string;
    userId: string;
    broadcasterId: string;
    channel: string;
    url?: string;
    skipSubscribe?: boolean;
  }): void {
    this.closeSocket();
    this.connecting = true;
    this.connected = false;

    const { token, clientId, userId, broadcasterId, channel } = options;
    const skipSubscribe = options.skipSubscribe === true;
    const ws = new WebSocket(options.url ?? TWITCH_EVENTSUB_URL);
    this.ws = ws;
    const generation = this.connectionGeneration;
    let welcomeTimer: ReturnType<typeof setTimeout> | null = null;

    const clearWelcomeTimer = () => {
      if (!welcomeTimer) return;
      clearTimeout(welcomeTimer);
      welcomeTimer = null;
    };

    welcomeTimer = setTimeout(() => {
      if (this.ws !== ws) return;
      logger.warn(
        "TWITCH",
        "Timed out waiting for the Twitch EventSub session.",
      );
      try {
        ws.close();
      } catch {
        // The socket is already closed.
      }
    }, WELCOME_TIMEOUT);

    ws.onopen = () => {
      if (this.ws !== ws) return;
      logger.info(
        "TWITCH",
        "EventSub socket connected. Waiting for session...",
      );
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;

      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;

      let message: EventSubMessage;
      try {
        message = JSON.parse(raw) as EventSubMessage;
      } catch {
        return;
      }

      const messageType = message.metadata?.message_type;

      if (messageType === "session_welcome") {
        clearWelcomeTimer();

        if (skipSubscribe) {
          this.markConnected(channel);
          return;
        }

        const sessionId = message.payload?.session?.id;
        if (typeof sessionId !== "string" || !sessionId) {
          logger.warn(
            "TWITCH",
            "EventSub welcome did not include a session ID.",
          );
          try {
            ws.close();
          } catch {
            // The socket is already closed.
          }
          return;
        }

        void this.subscribeToChat({
          ws,
          generation,
          clientId,
          token,
          userId,
          broadcasterId,
          channel,
          sessionId,
        });
        return;
      }

      if (messageType === "notification") {
        this.handleNotification(message);
        return;
      }

      if (messageType === "session_reconnect") {
        const reconnectUrl = message.payload?.session?.reconnect_url;
        if (typeof reconnectUrl === "string" && reconnectUrl) {
          logger.info("TWITCH", "Twitch asked EventSub to reconnect.");
          this.openSocket({
            token,
            clientId,
            userId,
            broadcasterId,
            channel,
            url: reconnectUrl,
            skipSubscribe: true,
          });
        }
        return;
      }

      if (messageType === "revocation") {
        logger.warn("TWITCH", "Twitch revoked the EventSub subscription.");
        this.shouldReconnect = false;
        this.reloginRequired = true;
        this.lastError =
          "Twitch revoked access to your channel. Please log in again.";
        this.connected = false;
        this.connecting = false;
        this.broadcastStatus();
        try {
          ws.close();
        } catch {
          // The socket is already closed.
        }
      }
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      logger.warn("TWITCH", "Twitch EventSub socket reported an error.");
    };

    ws.onclose = () => {
      clearWelcomeTimer();
      if (this.ws !== ws) return;
      this.ws = null;

      const wasConnected = this.connected;
      this.connected = false;
      this.connecting = false;

      if (this.shouldReconnect && !appState.isAppQuitting) {
        if (wasConnected) {
          this.lastError = "Disconnected from Twitch. Reconnecting...";
        }
        this.broadcastStatus();
        this.scheduleReconnect();
        return;
      }

      this.broadcastStatus();
    };
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;

    try {
      ws.close();
    } catch {
      // The socket is already closed.
    }
  }

  private async subscribeToChat(params: SubscribeParams): Promise<void> {
    const {
      ws,
      generation,
      clientId,
      token,
      userId,
      broadcasterId,
      channel,
      sessionId,
    } = params;

    try {
      const response = await fetch(TWITCH_EVENTSUB_SUBSCRIPTIONS_URL, {
        method: "POST",
        headers: {
          "Client-Id": clientId,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: broadcasterId,
            user_id: userId,
          },
          transport: {
            method: "websocket",
            session_id: sessionId,
          },
        }),
      });

      if (this.ws !== ws || generation !== this.connectionGeneration) return;

      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.shouldReconnect = false;
          this.connected = false;
          this.connecting = false;
          this.lastError =
            "Twitch denied access to this channel. Check the channel name and that you have permission to read its chat.";
          logger.error(
            "TWITCH",
            `EventSub subscription was rejected (HTTP ${response.status}): ${
              data.message || data.error || "unknown error"
            }`,
          );
          this.broadcastStatus();
          try {
            ws.close();
          } catch {
            // The socket is already closed.
          }
          return;
        }

        this.lastError =
          data.message ||
          data.error ||
          `Twitch rejected the connection (HTTP ${response.status}).`;
        logger.warn(
          "TWITCH",
          `EventSub subscription failed: ${this.lastError}`,
        );
        this.broadcastStatus();
        try {
          ws.close();
        } catch {
          // The socket is already closed.
        }
        return;
      }

      this.markConnected(channel);
    } catch (error) {
      if (this.ws !== ws || generation !== this.connectionGeneration) return;
      this.lastError = "Could not reach Twitch to start listening.";
      logger.warn(
        "TWITCH",
        `EventSub subscription error: ${(error as Error).message}`,
      );
      this.broadcastStatus();
      try {
        ws.close();
      } catch {
        // The socket is already closed.
      }
    }
  }

  private markConnected(channel: string): void {
    if (!this.connected) {
      logger.info("TWITCH", `Connected to Twitch (#${channel}).`);
    }
    this.connected = true;
    this.connecting = false;
    this.lastError = null;
    this.reloginRequired = false;
    this.reconnectDelay = RECONNECT_BASE_DELAY;
    this.broadcastStatus();
  }

  private handleNotification(message: EventSubMessage): void {
    if (message.metadata?.subscription_type !== "channel.chat.message") return;

    const event = message.payload?.event;
    if (!event) return;

    const rawText = event.message?.text;
    const text = sanitizeChatText(typeof rawText === "string" ? rawText : "");
    if (!text) return;

    const messageId =
      typeof event.message_id === "string"
        ? event.message_id
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (!this.rememberMessage(messageId)) return;

    const badges = Array.isArray(event.badges) ? event.badges : [];
    const hasBadge = (setId: string) =>
      badges.some((badge) => badge.set_id === setId);

    const login =
      typeof event.chatter_user_login === "string"
        ? event.chatter_user_login
        : "";
    const displayName =
      typeof event.chatter_user_name === "string" && event.chatter_user_name
        ? event.chatter_user_name
        : login || "Twitch";
    const color =
      typeof event.color === "string" && /^#[0-9a-f]{6}$/i.test(event.color)
        ? event.color
        : undefined;
    const bits =
      event.cheer && typeof event.cheer.bits === "number"
        ? event.cheer.bits
        : 0;
    const timestamp =
      typeof message.metadata?.message_timestamp === "string"
        ? Date.parse(message.metadata.message_timestamp) || Date.now()
        : Date.now();

    const chatMessage: TwitchChatMessage = {
      id: messageId,
      userId:
        typeof event.chatter_user_id === "string" ? event.chatter_user_id : "",
      login,
      displayName,
      color,
      text,
      bits,
      isModerator: hasBadge("moderator"),
      isSubscriber: hasBadge("subscriber") || hasBadge("founder"),
      isBroadcaster: hasBadge("broadcaster"),
      timestamp,
    };

    if (
      appState.appViewWebContents &&
      !appState.appViewWebContents.isDestroyed()
    ) {
      appState.appViewWebContents.send("twitch-chat-message", chatMessage);
    }
  }

  private rememberMessage(messageId: string): boolean {
    if (this.recentMessageIds.has(messageId)) return false;
    this.recentMessageIds.add(messageId);
    if (this.recentMessageIds.size > RECENT_MESSAGE_LIMIT) {
      const oldest = this.recentMessageIds.values().next().value;
      if (oldest) this.recentMessageIds.delete(oldest);
    }
    return true;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect) return;

    const delay = this.reconnectDelay;
    logger.info("TWITCH", `Reconnecting to Twitch in ${delay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);

    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_DELAY);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setPreferences(preferences: unknown): {
    success: boolean;
    error?: string;
  } {
    if (!preferences || typeof preferences !== "object") {
      return { success: false, error: "Invalid preferences." };
    }

    const values = preferences as {
      autoConnect?: unknown;
      showChatAsDanmaku?: unknown;
    };
    const config = this.getConfig();

    if (typeof values.autoConnect === "boolean") {
      config.autoConnect = values.autoConnect;
    }

    if (typeof values.showChatAsDanmaku === "boolean") {
      config.showChatAsDanmaku = values.showChatAsDanmaku;
    }

    this.saveConfig(config);
    this.broadcastStatus();
    return { success: true };
  }

  private async getApiContext(): Promise<TwitchApiContext | null> {
    const config = this.getConfig();
    if (!config.accessToken || !config.user?.id) {
      this.lastError = "Log in with Twitch to manage your channel.";
      return null;
    }

    const token = await this.ensureAccessToken();
    if (!token) {
      this.reloginRequired = true;
      if (!this.lastError) {
        this.lastError = "Your Twitch session expired. Please log in again.";
      }
      return null;
    }

    const current = this.getConfig();
    const scopes = current.scopes;
    if (Array.isArray(scopes) && scopes.length > 0) {
      const missingScopes = REQUIRED_SCOPES.filter(
        (scope) => !scopes.includes(scope),
      );
      if (missingScopes.length > 0) {
        this.reloginRequired = true;
        this.lastError =
          "Twitch permissions need to be renewed. Log in again to manage and start your broadcast.";
        this.broadcastStatus();
        return null;
      }
    }

    const user = current.user;
    if (!user) {
      this.lastError = "Log in with Twitch to manage your channel.";
      return null;
    }

    return { clientId: this.resolveClientId(), token, userId: user.id };
  }

  private async helixRequest<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      context?: TwitchApiContext;
      retry?: boolean;
    } = {},
  ): Promise<HelixResult<T>> {
    const context = options.context ?? (await this.getApiContext());
    if (!context) {
      return {
        ok: false,
        status: 0,
        error: this.lastError ?? "Twitch is not available right now.",
      };
    }

    try {
      const response = await fetch(`${TWITCH_HELIX_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers: {
          "Client-Id": context.clientId,
          Authorization: `Bearer ${context.token}`,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      if (response.status === 401 && options.retry !== false) {
        const config = this.getConfig();
        if (
          config.refreshToken &&
          (await this.refreshAccessToken(context.clientId, config.refreshToken))
        ) {
          const refreshedToken = this.getConfig().accessToken;
          if (refreshedToken) {
            return await this.helixRequest<T>(path, {
              ...options,
              context: { ...context, token: refreshedToken },
              retry: false,
            });
          }
        }
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: unknown;
          error?: unknown;
        };
        const message = getTwitchErrorMessage(data, response.status);

        if (response.status === 401 || /scope/i.test(message)) {
          this.reloginRequired = true;
          this.lastError =
            "Twitch permissions need to be renewed. Log in again to manage and start your broadcast.";
          this.broadcastStatus();
        }

        return { ok: false, status: response.status, error: message };
      }

      if (response.status === 204) {
        return { ok: true, status: 204 };
      }

      const data = (await response.json().catch(() => ({}))) as T;
      return { ok: true, status: response.status, data };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: `Could not reach Twitch: ${(error as Error).message}`,
      };
    }
  }

  private async fetchContentClassificationLabels(
    context: TwitchApiContext,
    force = false,
  ): Promise<TwitchContentClassificationLabel[]> {
    if (
      !force &&
      this.cclCache &&
      Date.now() - this.cclCache.fetchedAt < CCL_CACHE_TTL
    ) {
      return this.cclCache.labels;
    }

    const result = await this.helixRequest<{ data?: unknown }>(
      "/content_classification_labels",
      { context },
    );
    const rawLabels = getDataItems(result.data);

    const labels: TwitchContentClassificationLabel[] = [];
    for (const rawLabel of rawLabels) {
      if (!rawLabel || typeof rawLabel !== "object") continue;
      const values = rawLabel as Record<string, unknown>;
      if (typeof values.id !== "string" || !values.id) continue;
      labels.push({
        id: values.id,
        name:
          typeof values.name === "string" && values.name
            ? values.name
            : values.id,
        description:
          typeof values.description === "string" ? values.description : "",
      });
    }

    if (labels.length > 0) {
      this.cclCache = { labels, fetchedAt: Date.now() };
      return labels;
    }

    return (
      this.cclCache?.labels ?? FALLBACK_CONTENT_CLASSIFICATION_LABELS
    );
  }

  private async getBroadcastInfo(): Promise<TwitchBroadcastResult> {
    const context = await this.getApiContext();
    if (!context) {
      return {
        success: false,
        error:
          this.lastError ?? "Log in with Twitch to manage your channel.",
        reloginRequired: this.reloginRequired,
      };
    }

    const [channelResult, streamResult, labels] = await Promise.all([
      this.helixRequest<{ data?: unknown }>(
        `/channels?broadcaster_id=${encodeURIComponent(context.userId)}`,
        { context },
      ),
      this.helixRequest<{ data?: unknown }>(
        `/streams?user_id=${encodeURIComponent(context.userId)}`,
        { context },
      ),
      this.fetchContentClassificationLabels(context),
    ]);

    if (!channelResult.ok) {
      return {
        success: false,
        error:
          channelResult.error ??
          "Twitch did not return your channel information.",
        reloginRequired: this.reloginRequired,
      };
    }

    const channel = parseChannelInfo(getFirstDataItem(channelResult.data));
    if (!channel) {
      return {
        success: false,
        error: "Twitch did not return your channel information.",
      };
    }

    if (channel.gameId) {
      const gamesResult = await this.helixRequest<{ data?: unknown }>(
        `/games?id=${encodeURIComponent(channel.gameId)}`,
        { context },
      );
      if (gamesResult.ok) {
        const game = getFirstDataItem(gamesResult.data);
        if (game && typeof game === "object") {
          channel.gameBoxArtUrl = resolveBoxArtUrl(
            (game as Record<string, unknown>).box_art_url,
            144,
            192,
          );
        }
      }
    }

    const live = parseLiveInfo(
      streamResult.ok ? getFirstDataItem(streamResult.data) : undefined,
    );

    return {
      success: true,
      channel,
      live,
      contentClassificationLabels: labels,
    };
  }

  private async updateBroadcastInfo(update: unknown): Promise<TwitchBroadcastResult> {
    if (!update || typeof update !== "object") {
      return { success: false, error: "Invalid channel update." };
    }

    const context = await this.getApiContext();
    if (!context) {
      return {
        success: false,
        error:
          this.lastError ?? "Log in with Twitch to manage your channel.",
        reloginRequired: this.reloginRequired,
      };
    }

    const values = update as {
      title?: unknown;
      gameId?: unknown;
      language?: unknown;
      tags?: unknown;
      contentClassificationLabels?: unknown;
      isBrandedContent?: unknown;
    };

    const body: Record<string, unknown> = {};

    if (typeof values.title === "string") {
      const title = values.title.trim();
      if (!title) {
        return {
          success: false,
          error: "Add a stream title before going live.",
        };
      }
      if (title.length > 140) {
        return {
          success: false,
          error: "Twitch stream titles are limited to 140 characters.",
        };
      }
      body.title = title;
    }

    if (typeof values.gameId === "string" && values.gameId.trim()) {
      body.game_id = values.gameId.trim();
    }

    if (typeof values.language === "string") {
      const language = values.language.trim().toLowerCase();
      if (!/^(?:[a-z]{2}|other)$/.test(language)) {
        return { success: false, error: "Choose a valid Twitch language." };
      }
      body.broadcaster_language = language;
    }

    if (Array.isArray(values.tags)) {
      const tags = values.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean);

      if (tags.length > 10) {
        return {
          success: false,
          error: "Twitch allows a maximum of 10 tags.",
        };
      }

      const invalidTag = tags.find(
        (tag) => tag.length > 25 || !/^[\p{L}\p{N}]+$/u.test(tag),
      );
      if (invalidTag) {
        return {
          success: false,
          error: `"${invalidTag}" is not a valid Twitch tag. Use letters and numbers only.`,
        };
      }

      body.tags = tags;
    }

    if (Array.isArray(values.contentClassificationLabels)) {
      const selected = new Set(
        values.contentClassificationLabels.filter(
          (label): label is string => typeof label === "string",
        ),
      );
      const labels = await this.fetchContentClassificationLabels(context);

      body.content_classification_labels = labels
        .filter((label) => label.id !== "MatureGame")
        .map((label) => ({
          id: label.id,
          is_enabled: selected.has(label.id),
        }));
    }

    if (typeof values.isBrandedContent === "boolean") {
      body.is_branded_content = values.isBrandedContent;
    }

    if (Object.keys(body).length === 0) {
      return { success: false, error: "There are no changes to save." };
    }

    const result = await this.helixRequest(
      `/channels?broadcaster_id=${encodeURIComponent(context.userId)}`,
      { method: "PATCH", body, context },
    );

    if (!result.ok) {
      return {
        success: false,
        error: result.error ?? "Twitch could not update your channel.",
        reloginRequired: this.reloginRequired,
      };
    }

    return await this.getBroadcastInfo();
  }

  private async searchCategories(
    query: unknown,
  ): Promise<TwitchCategoriesResult> {
    if (typeof query !== "string") {
      return { success: false, error: "Enter a category to search." };
    }

    const term = query.trim();
    if (term.length < 2) {
      return { success: true, categories: [] };
    }

    const context = await this.getApiContext();
    if (!context) {
      return {
        success: false,
        error:
          this.lastError ?? "Log in with Twitch to search categories.",
        reloginRequired: this.reloginRequired,
      };
    }

    const result = await this.helixRequest<{ data?: unknown }>(
      `/search/categories?query=${encodeURIComponent(term)}&first=10`,
      { context },
    );

    if (!result.ok) {
      return {
        success: false,
        error: result.error ?? "Could not search Twitch categories.",
      };
    }

    const categories: TwitchCategory[] = [];
    for (const rawCategory of getDataItems(result.data)) {
      if (!rawCategory || typeof rawCategory !== "object") continue;
      const values = rawCategory as Record<string, unknown>;
      if (typeof values.id !== "string" || typeof values.name !== "string") {
        continue;
      }
      categories.push({
        id: values.id,
        name: values.name,
        boxArtUrl: resolveBoxArtUrl(values.box_art_url, 52, 72),
      });
    }

    return { success: true, categories };
  }

  private async getStreamKey(): Promise<TwitchStreamKeyResult> {
    const context = await this.getApiContext();
    if (!context) {
      return {
        success: false,
        error:
          this.lastError ?? "Log in with Twitch to start your broadcast.",
        reloginRequired: this.reloginRequired,
      };
    }

    const result = await this.helixRequest<{ data?: unknown }>(
      `/streams/key?broadcaster_id=${encodeURIComponent(context.userId)}`,
      { context },
    );

    if (!result.ok) {
      const error =
        result.error ?? "Twitch could not provide your stream key.";
      logger.warn("TWITCH", `Could not get the channel stream key: ${error}`);
      return {
        success: false,
        error,
        reloginRequired: this.reloginRequired,
      };
    }

    const rawKey = getFirstDataItem(result.data);
    const streamKey =
      rawKey && typeof rawKey === "object"
        ? (rawKey as Record<string, unknown>).stream_key
        : undefined;

    if (typeof streamKey !== "string" || !streamKey) {
      return {
        success: false,
        error: "Twitch did not return a stream key for this channel.",
      };
    }

    logger.info("TWITCH", "Retrieved the channel stream key for a broadcast.");
    return { success: true, streamKey, ingestUrl: TWITCH_INGEST_URL };
  }

  private async ensureAccessToken(): Promise<string | null> {
    const config = this.getConfig();
    if (!config.accessToken) return null;

    const stillValid =
      typeof config.tokenExpiresAt === "number" &&
      config.tokenExpiresAt - Date.now() > 60_000;

    if (stillValid) return config.accessToken;

    if (!config.refreshToken) {
      this.clearAuthInConfig(config);
      this.saveConfig(config);
      return null;
    }

    const clientId = this.resolveClientId();
    const refreshed = await this.refreshAccessToken(
      clientId,
      config.refreshToken,
    );

    return refreshed ? (this.getConfig().accessToken ?? null) : null;
  }

  private async refreshAccessToken(
    clientId: string,
    refreshToken: string,
  ): Promise<boolean> {
    try {
      const response = await fetch(TWITCH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as TokenResult;

      if (!response.ok || !data.access_token) {
        if (response.status === 400 || response.status === 401) {
          const config = this.getConfig();
          this.clearAuthInConfig(config);
          this.saveConfig(config);
          this.reloginRequired = true;
          this.lastError = "Your Twitch session expired. Please log in again.";
        } else {
          this.lastError = "Could not refresh the Twitch session.";
        }
        logger.warn("TWITCH", this.lastError);
        return false;
      }

      const config = this.getConfig();
      const expiresIn =
        typeof data.expires_in === "number" && data.expires_in > 0
          ? data.expires_in
          : 3600;

      const grantedScopes = normalizeScopes(data.scope);

      config.accessToken = data.access_token;
      config.refreshToken = data.refresh_token ?? config.refreshToken;
      config.tokenExpiresAt = Date.now() + expiresIn * 1000;
      if (grantedScopes.length > 0) config.scopes = grantedScopes;
      this.saveConfig(config);

      logger.info("TWITCH", "Refreshed Twitch access token.");
      return true;
    } catch (error) {
      this.lastError = "Could not reach Twitch to refresh the session.";
      logger.warn(
        "TWITCH",
        `Token refresh failed: ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async validateToken(token: string): Promise<TokenValidation | null> {
    try {
      const response = await fetch(TWITCH_VALIDATE_URL, {
        headers: { Authorization: `OAuth ${token}` },
      });

      if (!response.ok) return null;

      const data = (await response.json().catch(() => ({}))) as {
        login?: unknown;
        user_id?: unknown;
        scopes?: unknown;
        expires_in?: unknown;
      };

      if (typeof data.login !== "string" || typeof data.user_id !== "string") {
        return null;
      }

      return {
        login: data.login,
        userId: data.user_id,
        scopes: Array.isArray(data.scopes)
          ? data.scopes.filter(
              (scope): scope is string => typeof scope === "string",
            )
          : [],
        expiresIn:
          typeof data.expires_in === "number" ? data.expires_in : undefined,
      };
    } catch (error) {
      logger.warn(
        "TWITCH",
        `Token validation failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async fetchHelixUser(
    clientId: string,
    token: string,
    login?: string,
  ): Promise<TwitchUser> {
    const url = login
      ? `${TWITCH_HELIX_USERS_URL}?login=${encodeURIComponent(login)}`
      : TWITCH_HELIX_USERS_URL;

    const response = await fetch(url, {
      headers: {
        "Client-Id": clientId,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Helix returned HTTP ${response.status}.`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      data?: Array<{
        id?: unknown;
        login?: unknown;
        display_name?: unknown;
        profile_image_url?: unknown;
      }>;
    };

    const user = data.data?.[0];

    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.login !== "string"
    ) {
      throw new Error("Twitch did not return a user profile.");
    }

    return {
      id: user.id,
      login: user.login,
      displayName:
        typeof user.display_name === "string" ? user.display_name : user.login,
      profileImageUrl:
        typeof user.profile_image_url === "string"
          ? user.profile_image_url
          : undefined,
    };
  }

  private resolveClientId(): string {
    return FALLBACK_CLIENT_ID || OFFICIAL_CLIENT_ID;
  }

  private getConfig(): TwitchConfig {
    return Config.getItem<TwitchConfig>("twitchConfig") ?? {};
  }

  private saveConfig(config: TwitchConfig): void {
    Config.setItem("twitchConfig", config);
  }

  private broadcastStatus(): void {
    if (
      appState.appViewWebContents &&
      !appState.appViewWebContents.isDestroyed()
    ) {
      appState.appViewWebContents.send(
        "twitch-status-update",
        this.getStatus(),
      );
    }
  }
}

function normalizeChannel(channel: string): string {
  const cleaned = channel.trim().replace(/^#/, "").toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(cleaned) ? cleaned : "";
}

function normalizeScopes(scope: unknown): string[] {
  if (Array.isArray(scope)) {
    return scope.filter((value): value is string => typeof value === "string");
  }

  if (typeof scope === "string") {
    return scope
      .split(" ")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

function getDataItems(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) ? data : [];
}

function getFirstDataItem(payload: unknown): unknown {
  return getDataItems(payload)[0];
}

function resolveBoxArtUrl(
  raw: unknown,
  width: number,
  height: number,
): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  return raw
    .replace("{width}", String(width))
    .replace("{height}", String(height));
}

function getTwitchErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const values = payload as { message?: unknown; error?: unknown };
    if (typeof values.message === "string" && values.message) {
      return values.message;
    }
    if (typeof values.error === "string" && values.error) {
      return values.error;
    }
  }

  return `Twitch returned HTTP ${status}.`;
}

function parseChannelInfo(raw: unknown): TwitchChannelInfo | null {
  if (!raw || typeof raw !== "object") return null;

  const values = raw as Record<string, unknown>;

  return {
    title: typeof values.title === "string" ? values.title : "",
    gameId: typeof values.game_id === "string" ? values.game_id : "",
    gameName: typeof values.game_name === "string" ? values.game_name : "",
    language:
      typeof values.broadcaster_language === "string"
        ? values.broadcaster_language
        : "en",
    tags: stringArray(values.tags),
    contentClassificationLabels: stringArray(
      values.content_classification_labels,
    ),
    isBrandedContent: values.is_branded_content === true,
    delay: typeof values.delay === "number" ? values.delay : 0,
  };
}

function parseLiveInfo(raw: unknown): TwitchLiveInfo {
  if (!raw || typeof raw !== "object") {
    return { isLive: false, startedAt: null, viewerCount: null };
  }

  const values = raw as Record<string, unknown>;

  return {
    isLive: values.type === "live",
    startedAt:
      typeof values.started_at === "string" && values.started_at
        ? values.started_at
        : null,
    viewerCount:
      typeof values.viewer_count === "number" ? values.viewer_count : null,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizeChatText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 500);
}

export const twitchService = new TwitchService();
