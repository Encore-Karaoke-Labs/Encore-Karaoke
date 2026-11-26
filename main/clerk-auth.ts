import { BrowserWindow, ipcMain, session, shell, type Session } from "electron";
import { logger } from "./logger";
import { appState } from "./state";
import {
  type ClerkAccountState,
  type ClerkAuthPayload,
  type ClerkClientResource,
  type ClerkClientResponse,
  type ClerkErrorResponse,
  type ClerkProfileUpdate,
  type ClerkSessionResource,
  type ClerkSessionToken,
  type ClerkSignInChallenge,
  type ClerkSignInAttempt,
  type ClerkSignInResponse,
  type ClerkTokenResponse,
  type ClerkUserResource,
  type ClerkUserSummary,
  type ClerkVerificationResult,
} from "./types";

const CLERK_FRONTEND_API = "https://clerk.encorekaraoke.org";
const CLERK_ORIGIN = CLERK_FRONTEND_API;
const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsuZW5jb3Jla2FyYW9rZS5vcmck";
const CLERK_API_VERSION = "2025-11-10";
const CLERK_JS_VERSION = "6";
const CLERK_PARTITION = "persist:encore-clerk";
const CLERK_CLIENT_COOKIE = "__client";

const ACCOUNT_PORTAL_URL = "https://accounts.encorekaraoke.org";
const ACCOUNT_SIGN_IN_URL = `${ACCOUNT_PORTAL_URL}/sign-in`;
const ACCOUNT_SIGN_UP_URL = `${ACCOUNT_PORTAL_URL}/sign-up`;
const ACCOUNT_PROFILE_URL = `${ACCOUNT_PORTAL_URL}/user`;

const PORTAL_POLL_INTERVAL_MS = 1500;
const PORTAL_TIMEOUT_MS = 10 * 60 * 1000;
const CLERK_REQUEST_TIMEOUT_MS = 20_000;

function getClerkSession(): Session {
  return session.fromPartition(CLERK_PARTITION);
}

function buildBaseHeaders(): Record<string, string> {
  return {
    Origin: CLERK_ORIGIN,
    Referer: `${CLERK_ORIGIN}/`,
  };
}

function buildClerkHeaders(cookie: string): Record<string, string> {
  return {
    ...buildBaseHeaders(),
    Cookie: `${CLERK_CLIENT_COOKIE}=${cookie}`,
  };
}

function clerkApiUrl(
  path: string,
  options: { sessionId?: string | null; method?: string } = {},
): string {
  const url = new URL(`${CLERK_FRONTEND_API}${path}`);
  url.searchParams.set("__clerk_api_version", CLERK_API_VERSION);
  url.searchParams.set("_clerk_js_version", CLERK_JS_VERSION);
  if (options.sessionId) {
    url.searchParams.set("_clerk_session_id", options.sessionId);
  }
  if (options.method && options.method !== "GET" && options.method !== "POST") {
    url.searchParams.set("_method", options.method);
  }
  return url.toString();
}

async function readClerkError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ClerkErrorResponse;
    const first = payload.errors?.[0];
    return (
      first?.long_message ||
      first?.message ||
      `Clerk request failed (${response.status}).`
    );
  } catch {
    return `Clerk request failed (${response.status}).`;
  }
}

async function readClientCookie(ses: Session): Promise<string | null> {
  const cookies = await ses.cookies.get({ name: CLERK_CLIENT_COOKIE });
  const match =
    cookies.find((cookie) => cookie.domain === "clerk.encorekaraoke.org") ??
    cookies.find((cookie) =>
      cookie.domain?.includes("clerk.encorekaraoke.org"),
    ) ??
    cookies[0];
  return match?.value || null;
}

async function persistRotatedClientCookie(
  ses: Session,
  setCookies: string[],
): Promise<void> {
  const raw = setCookies.find((value) =>
    value.startsWith(`${CLERK_CLIENT_COOKIE}=`),
  );
  if (!raw) return;

  const value = raw
    .slice(CLERK_CLIENT_COOKIE.length + 1)
    .split(";")[0]
    .trim();
  if (!value) return;

  try {
    const existing = await ses.cookies.get({ name: CLERK_CLIENT_COOKIE });
    if (existing.some((cookie) => cookie.value === value)) return;

    await ses.cookies.set({
      url: `${CLERK_FRONTEND_API}/`,
      name: CLERK_CLIENT_COOKIE,
      value,
      domain: "clerk.encorekaraoke.org",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
  } catch (error) {
    logger.warn(
      "CLERK",
      `Could not persist rotated client cookie: ${String(error)}`,
    );
  }
}

async function requestClient(
  ses: Session,
  cookie: string,
): Promise<ClerkClientResource | null> {
  const response = await fetch(
    `${CLERK_FRONTEND_API}/v1/client?__clerk_api_version=${CLERK_API_VERSION}&_clerk_js_version=${CLERK_JS_VERSION}`,
    { headers: buildClerkHeaders(cookie) },
  );

  await persistRotatedClientCookie(ses, response.headers.getSetCookie());

  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Clerk client request failed (${response.status}).`);
  }

  const payload = (await response.json()) as ClerkClientResponse;
  return payload.response ?? null;
}

function getPrimaryEmail(user: ClerkUserResource): string | null {
  const addresses = user.email_addresses ?? [];
  const primary = addresses.find(
    (address) => address.id === user.primary_email_address_id,
  );
  return (primary ?? addresses[0])?.email_address ?? null;
}

function summarizeUser(
  user: ClerkUserResource | undefined,
  session: ClerkSessionResource,
): ClerkUserSummary | null {
  const userId = user?.id ?? session.public_user_data?.user_id;
  if (!userId) return null;

  const firstName = user?.first_name ?? null;
  const lastName = user?.last_name ?? null;
  const username = user?.username ?? null;
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ").trim() || username || null;

  return {
    id: userId,
    firstName,
    lastName,
    username,
    fullName,
    imageUrl: user?.image_url ?? null,
    primaryEmail: user ? getPrimaryEmail(user) : null,
  };
}

function pickActiveSession(
  client: ClerkClientResource,
): ClerkSessionResource | null {
  const sessions = client.sessions ?? [];
  if (sessions.length === 0) return null;

  return (
    sessions.find((entry) => entry.id === client.last_active_session_id) ??
    sessions.find((entry) => entry.status === "active") ??
    sessions[0]
  );
}

function stateFromClient(
  client: ClerkClientResource | null,
): ClerkAccountState {
  const activeSession = client ? pickActiveSession(client) : null;
  if (!client || !activeSession) {
    return { signedIn: false, user: null, sessionId: null };
  }

  return {
    signedIn: true,
    user: summarizeUser(activeSession.user, activeSession),
    sessionId: activeSession.id,
  };
}

async function fetchAccountState(): Promise<ClerkAccountState> {
  const ses = getClerkSession();
  const cookie = await readClientCookie(ses);
  if (!cookie) {
    return { signedIn: false, user: null, sessionId: null };
  }

  try {
    const client = await requestClient(ses, cookie);
    const state = stateFromClient(client);

    if (!state.signedIn) {
      cachedToken = null;
    } else if (
      cachedToken &&
      (cachedToken.userId !== state.user?.id ||
        cachedToken.sessionId !== state.sessionId)
    ) {
      cachedToken = null;
    }

    return state;
  } catch (error) {
    return {
      signedIn: false,
      user: null,
      sessionId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureClientCookie(ses: Session): Promise<string> {
  const existing = await readClientCookie(ses);
  if (existing) return existing;

  const response = await fetch(fapiUrl("/v1/client"), {
    headers: buildBaseHeaders(),
    signal: AbortSignal.timeout(CLERK_REQUEST_TIMEOUT_MS),
  });
  await persistRotatedClientCookie(ses, response.headers.getSetCookie());

  const cookie = await readClientCookie(ses);
  if (!cookie) {
    throw new Error(
      "Could not start a secure sign-in. Check your connection and try again.",
    );
  }
  return cookie;
}

function fapiUrl(path: string): string {
  const url = new URL(`${CLERK_FRONTEND_API}${path}`);
  url.searchParams.set("__clerk_api_version", CLERK_API_VERSION);
  url.searchParams.set("_clerk_js_version", CLERK_JS_VERSION);
  return url.toString();
}

function describePayloadError(
  payload: ClerkErrorResponse,
  status: number,
): string {
  const first = payload.errors?.[0];
  return (
    first?.long_message ||
    first?.message ||
    `Encore sign-in failed (${status}).`
  );
}

async function clerkFormRequest(
  ses: Session,
  cookie: string,
  path: string,
  body: Record<string, string> = {},
): Promise<ClerkSignInResponse> {
  const response = await fetch(fapiUrl(path), {
    method: "POST",
    headers: {
      ...buildClerkHeaders(cookie),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(CLERK_REQUEST_TIMEOUT_MS),
  });
  await persistRotatedClientCookie(ses, response.headers.getSetCookie());

  let payload: ClerkSignInResponse = {};
  try {
    payload = (await response.json()) as ClerkSignInResponse;
  } catch {
    // A non-JSON body still carries the status code below.
  }

  if (!response.ok) {
    throw new Error(describePayloadError(payload, response.status));
  }
  return payload;
}

function getSignInAttempt(
  payload: ClerkSignInResponse,
): ClerkSignInAttempt | null {
  return payload.response ?? payload.meta?.client?.sign_in ?? null;
}

function requireEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function requirePassword(value: unknown, label: string): string {
  const password = typeof value === "string" ? value : "";
  if (!password) throw new Error(label);
  return password;
}

function requireCode(value: unknown): string {
  const code = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) {
    throw new Error("Enter the 6-digit code from your email.");
  }
  return code;
}

async function activateSession(
  ses: Session,
  attempt: ClerkSignInAttempt,
): Promise<ClerkAccountState> {
  const sessionId = attempt.created_session_id;
  if (!sessionId) {
    throw new Error("Clerk did not finish the sign-in. Try again.");
  }

  const cookie = await readClientCookie(ses);
  if (cookie) {
    const response = await fetch(
      fapiUrl(`/v1/client/sessions/${sessionId}/touch`),
      {
        method: "POST",
        headers: {
          ...buildClerkHeaders(cookie),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "intent=select_session",
        signal: AbortSignal.timeout(CLERK_REQUEST_TIMEOUT_MS),
      },
    );
    await persistRotatedClientCookie(ses, response.headers.getSetCookie());
  }

  cachedToken = null;
  const state = await fetchAccountState();
  if (state.signedIn) return state;

  const freshCookie = await readClientCookie(ses);
  if (freshCookie) {
    const client = await requestClient(ses, freshCookie);
    const fallback = stateFromClient(client);
    if (fallback.signedIn) {
      cachedToken = null;
      return fallback;
    }
  }

  throw new Error(
    state.error ||
      "Sign-in completed, but Encore could not load your account. Try again.",
  );
}

interface PendingSignIn {
  id: string;
  email: string;
  mode: "code" | "reset" | "second-factor";
  emailAddressId?: string;
}

let pendingSignIn: PendingSignIn | null = null;

/**
 * Emails a second-factor code (MFA or Clerk Client Trust) and tells the
 * renderer to open the code screen instead of failing the sign-in.
 */
async function prepareEmailSecondFactor(
  ses: Session,
  cookie: string,
  attempt: ClerkSignInAttempt,
  email: string,
): Promise<ClerkAccountState> {
  if (!attempt.id) {
    throw new Error("Clerk did not return a sign-in attempt. Try again.");
  }

  const secondFactors = attempt.supported_second_factors ?? [];
  const emailFactor = secondFactors.find(
    (entry) => entry.strategy === "email_code",
  );

  if (!emailFactor) {
    const hasPhoneCode = secondFactors.some(
      (entry) => entry.strategy === "phone_code",
    );
    const hasAuthenticator = secondFactors.some(
      (entry) => entry.strategy === "totp" || entry.strategy === "backup_code",
    );
    throw new Error(
      hasAuthenticator
        ? "This account uses an authenticator app for extra verification. Finish signing in from the account portal."
        : hasPhoneCode
          ? "This account needs a text-message code for extra verification. Finish signing in from the account portal."
          : "This account needs an extra verification step Encore can't complete. Finish signing in from the account portal.",
    );
  }

  const body: Record<string, string> = { strategy: "email_code" };
  if (emailFactor.email_address_id) {
    body.email_address_id = emailFactor.email_address_id;
  }

  await clerkFormRequest(
    ses,
    cookie,
    `/v1/client/sign_ins/${attempt.id}/prepare_second_factor`,
    body,
  );

  pendingSignIn = {
    id: attempt.id,
    email,
    mode: "second-factor",
    emailAddressId: emailFactor.email_address_id,
  };

  const challenge: ClerkSignInChallenge = {
    type: "email_code",
    email,
    message: `We emailed a 6-digit code to ${email}. Enter it to finish signing in.`,
  };

  return {
    signedIn: false,
    user: null,
    sessionId: null,
    challenge,
  };
}

async function finishSignInAttempt(
  ses: Session,
  cookie: string,
  attempt: ClerkSignInAttempt | null,
  email: string,
): Promise<ClerkAccountState> {
  if (!attempt) {
    throw new Error("Clerk did not return a sign-in attempt. Try again.");
  }

  if (attempt.status === "complete") {
    return activateSession(ses, attempt);
  }

  if (
    attempt.status === "needs_second_factor" ||
    attempt.status === "needs_client_trust"
  ) {
    return prepareEmailSecondFactor(ses, cookie, attempt, email);
  }

  if (attempt.status === "needs_new_password") {
    throw new Error("Reset your password and try again.");
  }

  throw new Error("Clerk could not complete the sign-in. Try again.");
}

async function createEmailSignIn(
  ses: Session,
  cookie: string,
  email: string,
  mode: "code" | "reset",
): Promise<ClerkSignInAttempt> {
  const created = await clerkFormRequest(ses, cookie, "/v1/client/sign_ins", {
    identifier: email,
  });
  const attempt = getSignInAttempt(created);
  if (!attempt?.id) {
    throw new Error("Clerk could not start the sign-in. Try again.");
  }

  const strategy =
    mode === "reset" ? "reset_password_email_code" : "email_code";
  const factor = attempt.supported_first_factors?.find(
    (entry) => entry.strategy === strategy,
  );
  if (!factor?.email_address_id) {
    throw new Error("This account has no email address available for a code.");
  }

  await clerkFormRequest(
    ses,
    cookie,
    `/v1/client/sign_ins/${attempt.id}/prepare_first_factor`,
    { strategy, email_address_id: factor.email_address_id },
  );

  pendingSignIn = { id: attempt.id, email, mode };
  return attempt;
}

async function signInWithPassword(
  payload: ClerkAuthPayload | undefined,
): Promise<ClerkAccountState> {
  const email = requireEmail(payload?.email);
  const password = requirePassword(
    payload?.password,
    "Enter your password to sign in.",
  );

  const ses = getClerkSession();
  const cookie = await ensureClientCookie(ses);
  const result = await clerkFormRequest(ses, cookie, "/v1/client/sign_ins", {
    identifier: email,
    password,
  });
  return finishSignInAttempt(ses, cookie, getSignInAttempt(result), email);
}

async function requestEmailCode(
  payload: ClerkAuthPayload | undefined,
): Promise<ClerkVerificationResult> {
  const email = requireEmail(payload?.email);
  const ses = getClerkSession();
  const cookie = await ensureClientCookie(ses);

  // A pending second-factor (MFA / client trust) challenge has to be re-sent
  // on the same sign-in attempt, not restarted as a new sign-in.
  if (
    pendingSignIn?.mode === "second-factor" &&
    pendingSignIn.email === email
  ) {
    const body: Record<string, string> = { strategy: "email_code" };
    if (pendingSignIn.emailAddressId) {
      body.email_address_id = pendingSignIn.emailAddressId;
    }
    await clerkFormRequest(
      ses,
      cookie,
      `/v1/client/sign_ins/${pendingSignIn.id}/prepare_second_factor`,
      body,
    );
    return { sent: true, email };
  }

  await createEmailSignIn(ses, cookie, email, "code");
  return { sent: true, email };
}

async function verifyEmailCode(
  payload: ClerkAuthPayload | undefined,
): Promise<ClerkAccountState> {
  const code = requireCode(payload?.code);
  if (
    !pendingSignIn ||
    (pendingSignIn.mode !== "code" && pendingSignIn.mode !== "second-factor")
  ) {
    throw new Error("Request a new sign-in code to continue.");
  }

  const ses = getClerkSession();
  const cookie = await ensureClientCookie(ses);
  const action =
    pendingSignIn.mode === "code"
      ? "attempt_first_factor"
      : "attempt_second_factor";
  const { id, email } = pendingSignIn;
  const result = await clerkFormRequest(
    ses,
    cookie,
    `/v1/client/sign_ins/${id}/${action}`,
    { strategy: "email_code", code },
  );
  pendingSignIn = null;
  return finishSignInAttempt(ses, cookie, getSignInAttempt(result), email);
}

async function requestPasswordReset(
  payload: ClerkAuthPayload | undefined,
): Promise<ClerkVerificationResult> {
  const email = requireEmail(payload?.email);
  const ses = getClerkSession();
  const cookie = await ensureClientCookie(ses);
  await createEmailSignIn(ses, cookie, email, "reset");
  return { sent: true, email };
}

async function submitPasswordReset(
  payload: ClerkAuthPayload | undefined,
): Promise<ClerkAccountState> {
  const code = requireCode(payload?.code);
  const password = requirePassword(
    payload?.password,
    "Enter a new password.",
  );
  if (password.length < 8) {
    throw new Error("Use at least 8 characters for your new password.");
  }
  if (!pendingSignIn || pendingSignIn.mode !== "reset") {
    throw new Error("Request a new reset code to continue.");
  }

  const ses = getClerkSession();
  const cookie = await ensureClientCookie(ses);
  const email = pendingSignIn.email;
  const verified = await clerkFormRequest(
    ses,
    cookie,
    `/v1/client/sign_ins/${pendingSignIn.id}/attempt_first_factor`,
    { strategy: "reset_password_email_code", code },
  );

  let attempt = getSignInAttempt(verified);
  if (attempt?.status !== "complete") {
    const reset = await clerkFormRequest(
      ses,
      cookie,
      `/v1/client/sign_ins/${pendingSignIn.id}/reset_password`,
      { password },
    );
    attempt = getSignInAttempt(reset);
  }

  pendingSignIn = null;
  return finishSignInAttempt(ses, cookie, attempt, email);
}

function decodeTokenExpiry(token: string): number | null {
  const payloadPart = token.split(".")[1];
  if (!payloadPart) return null;

  try {
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let cachedToken: ClerkSessionToken | null = null;
let cachedTokenAt = 0;

async function fetchSessionToken(): Promise<ClerkSessionToken | null> {
  if (cachedToken) {
    const now = Date.now();
    const stillValid =
      cachedToken.expiresAt === null
        ? now - cachedTokenAt < 30_000
        : cachedToken.expiresAt - now > 15_000;
    if (stillValid) return cachedToken;
  }

  const ses = getClerkSession();
  const cookie = await readClientCookie(ses);
  if (!cookie) return null;

  const client = await requestClient(ses, cookie);
  const activeSession = client ? pickActiveSession(client) : null;
  if (!client || !activeSession) return null;

  const response = await fetch(
    `${CLERK_FRONTEND_API}/v1/client/sessions/${activeSession.id}/tokens?__clerk_api_version=${CLERK_API_VERSION}&_clerk_js_version=${CLERK_JS_VERSION}`,
    { method: "POST", headers: buildClerkHeaders(cookie) },
  );

  if (!response.ok) {
    throw new Error(`Clerk token request failed (${response.status}).`);
  }

  const payload = (await response.json()) as ClerkTokenResponse;
  const rawToken = payload.jwt;
  const token =
    typeof rawToken === "string"
      ? rawToken
      : (rawToken?.raw ?? rawToken?.getRawString?.() ?? null);

  if (!token) return null;

  cachedToken = {
    token,
    sessionId: activeSession.id,
    userId: activeSession.user?.id ?? null,
    expiresAt: decodeTokenExpiry(token),
  };
  cachedTokenAt = Date.now();
  return cachedToken;
}

let portalWindow: BrowserWindow | null = null;

function getPortalParent(): BrowserWindow | null {
  const parent = appState.mainWindow;
  if (parent && !parent.isDestroyed()) return parent;
  return BrowserWindow.getFocusedWindow();
}

interface OpenPortalOptions {
  url: string;
  awaitSignIn: boolean;
}

async function openPortalWindow(
  options: OpenPortalOptions,
): Promise<ClerkAccountState> {
  if (portalWindow && !portalWindow.isDestroyed()) {
    portalWindow.focus();
    return { signedIn: false, user: null, sessionId: null, cancelled: true };
  }

  const parent = getPortalParent();
  const win = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 420,
    minHeight: 620,
    parent: parent ?? undefined,
    modal: Boolean(parent),
    show: false,
    autoHideMenuBar: true,
    title: "Encore Karaoke Account",
    backgroundColor: "#0a0a14",
    webPreferences: {
      partition: CLERK_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  portalWindow = win;
  win.once("ready-to-show", () => win.show());

  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 1500);

  win.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      parent: win,
      autoHideMenuBar: true,
      backgroundColor: "#0a0a14",
      webPreferences: {
        partition: CLERK_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    },
  }));

  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("https://")) return;

    event.preventDefault();
    if (url.startsWith("http://") || url.startsWith("mailto:")) {
      void shell.openExternal(url);
    }
  });

  void win.loadURL(options.url).catch((error: unknown) => {
    logger.warn("CLERK", `Account portal failed to load: ${String(error)}`);
  });

  if (!options.awaitSignIn) {
    return new Promise<ClerkAccountState>((resolve) => {
      win.once("closed", () => {
        portalWindow = null;
        void fetchAccountState().then(resolve);
      });
    });
  }

  return new Promise<ClerkAccountState>((resolve) => {
    let settled = false;

    const finish = (state: ClerkAccountState): void => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      if (state.signedIn) cachedToken = null;
      portalWindow = null;
      if (!win.isDestroyed()) win.close();
      resolve(state);
    };

    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        logger.warn(
          "CLERK",
          `Account portal failed to load: ${errorDescription} (${errorCode})`,
        );
        finish({
          signedIn: false,
          user: null,
          sessionId: null,
          cancelled: true,
          error: "Could not reach Clerk. Check your connection and try again.",
        });
      },
    );

    const poll = async (): Promise<void> => {
      if (settled) return;

      try {
        const state = await fetchAccountState();
        if (state.signedIn) finish(state);
      } catch (error) {
        logger.debug("CLERK", `Portal poll failed: ${String(error)}`);
      }
    };

    const pollTimer = setInterval(() => void poll(), PORTAL_POLL_INTERVAL_MS);
    const timeoutTimer = setTimeout(() => {
      finish({
        signedIn: false,
        user: null,
        sessionId: null,
        cancelled: true,
        error: "Timed out waiting for sign-in.",
      });
    }, PORTAL_TIMEOUT_MS);

    win.once("closed", () => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      portalWindow = null;
      void fetchAccountState().then(resolve);
    });

    void poll();
  });
}

function decodeAvatarDataUrl(dataUrl: string): {
  blob: Blob;
  filename: string;
} {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(
    dataUrl.trim(),
  );
  if (!match) {
    throw new Error("Unsupported profile image format.");
  }

  const mime = match[1].toLowerCase();
  const extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "png";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength === 0) {
    throw new Error("The profile image could not be read.");
  }

  return {
    blob: new Blob([bytes], { type: mime }),
    filename: `avatar.${extension}`,
  };
}

async function updateAccountProfile(
  update: ClerkProfileUpdate,
): Promise<ClerkAccountState> {
  const ses = getClerkSession();
  const cookie = await readClientCookie(ses);
  if (!cookie) {
    throw new Error("Sign in to your Clerk account to update your profile.");
  }

  const client = await requestClient(ses, cookie);
  const activeSession = client ? pickActiveSession(client) : null;
  if (!activeSession) {
    throw new Error("Sign in to your Clerk account to update your profile.");
  }

  const sessionId = activeSession.id;

  if (typeof update.nickname === "string") {
    const parts = update.nickname.trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() ?? "";
    const lastName = parts.join(" ");
    if (!firstName) {
      throw new Error("Enter a display name.");
    }

    const body = new URLSearchParams({
      first_name: firstName,
      last_name: lastName,
    });
    const response = await fetch(
      clerkApiUrl("/v1/me", { sessionId, method: "PATCH" }),
      {
        method: "POST",
        headers: {
          ...buildClerkHeaders(cookie),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );
    await persistRotatedClientCookie(ses, response.headers.getSetCookie());
    if (!response.ok) {
      throw new Error(await readClerkError(response));
    }
  }

  if (update.avatar === null) {
    const response = await fetch(
      clerkApiUrl("/v1/me/profile_image", { sessionId, method: "DELETE" }),
      {
        method: "POST",
        headers: buildClerkHeaders(cookie),
      },
    );
    await persistRotatedClientCookie(ses, response.headers.getSetCookie());
    if (!response.ok && response.status !== 404) {
      throw new Error(await readClerkError(response));
    }
  } else if (typeof update.avatar === "string") {
    const { blob, filename } = decodeAvatarDataUrl(update.avatar);
    const formData = new FormData();
    formData.append("file", blob, filename);

    const response = await fetch(
      clerkApiUrl("/v1/me/profile_image", { sessionId }),
      {
        method: "POST",
        headers: buildClerkHeaders(cookie),
        body: formData,
      },
    );
    await persistRotatedClientCookie(ses, response.headers.getSetCookie());
    if (!response.ok) {
      throw new Error(await readClerkError(response));
    }
  }

  cachedToken = null;
  return fetchAccountState();
}

async function signOut(): Promise<ClerkAccountState> {
  cachedToken = null;
  const ses = getClerkSession();
  const cookie = await readClientCookie(ses);

  if (cookie) {
    try {
      const client = await requestClient(ses, cookie);
      for (const entry of client?.sessions ?? []) {
        await fetch(
          `${CLERK_FRONTEND_API}/v1/client/sessions/${entry.id}?__clerk_api_version=${CLERK_API_VERSION}&_clerk_js_version=${CLERK_JS_VERSION}`,
          { method: "DELETE", headers: buildClerkHeaders(cookie) },
        ).catch(() => undefined);
      }
    } catch (error) {
      logger.warn("CLERK", `Sign-out request failed: ${String(error)}`);
    }
  }

  await ses.clearStorageData({ storages: ["cookies"] });
  return { signedIn: false, user: null, sessionId: null };
}

export function registerClerkIpc(): void {
  ipcMain.handle("clerk:get-state", () => fetchAccountState());

  ipcMain.handle("clerk:sign-in", () =>
    openPortalWindow({ url: ACCOUNT_SIGN_IN_URL, awaitSignIn: true }),
  );

  ipcMain.handle("clerk:sign-up", () =>
    openPortalWindow({ url: ACCOUNT_SIGN_UP_URL, awaitSignIn: true }),
  );

  ipcMain.handle(
    "clerk:sign-in-password",
    (_event, payload: ClerkAuthPayload | undefined) =>
      signInWithPassword(payload),
  );

  ipcMain.handle(
    "clerk:sign-in-request-code",
    (_event, payload: ClerkAuthPayload | undefined) => requestEmailCode(payload),
  );

  ipcMain.handle(
    "clerk:sign-in-verify-code",
    (_event, payload: ClerkAuthPayload | undefined) => verifyEmailCode(payload),
  );

  ipcMain.handle(
    "clerk:reset-request-code",
    (_event, payload: ClerkAuthPayload | undefined) =>
      requestPasswordReset(payload),
  );

  ipcMain.handle(
    "clerk:reset-submit",
    (_event, payload: ClerkAuthPayload | undefined) =>
      submitPasswordReset(payload),
  );

  ipcMain.handle("clerk:sign-out", () => signOut());

  ipcMain.handle("clerk:get-token", () => fetchSessionToken());

  ipcMain.handle(
    "clerk:update-profile",
    (_event, update: ClerkProfileUpdate | undefined) =>
      updateAccountProfile(update ?? {}),
  );

  ipcMain.handle("clerk:open-account", () =>
    openPortalWindow({ url: ACCOUNT_PROFILE_URL, awaitSignIn: false }),
  );

  logger.info(
    "CLERK",
    `Clerk account bridge ready (${CLERK_PUBLISHABLE_KEY.slice(0, 12)}…).`,
  );
}
