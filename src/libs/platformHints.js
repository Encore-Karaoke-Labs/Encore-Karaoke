const IPC_CHANNEL = "get-platform-hints";

let cachedState = null;

async function fetchState() {
  if (cachedState) return cachedState;

  const ipc = window.desktopIntegration?.ipc;
  if (!ipc?.invoke) {
    cachedState = { hints: [], embedded: false };
    return cachedState;
  }

  try {
    const state = await ipc.invoke(IPC_CHANNEL);
    cachedState = {
      hints: Array.isArray(state?.hints) ? state.hints : [],
      embedded: Boolean(state?.embedded),
    };
  } catch {
    cachedState = { hints: [], embedded: false };
  }

  return cachedState;
}

export async function getPlatform() {
  const ipc = window.desktopIntegration?.ipc;
  if (!ipc?.invoke) return "web";
  const state = await fetchState();
  return state.embedded ? "embedded" : "desktop";
}

export async function hasPlatformHint(hint) {
  const state = await fetchState();
  return state.hints.includes(hint);
}

export async function isEmbedded() {
  const state = await fetchState();
  return state.embedded;
}

export async function getPlatformHints() {
  return fetchState();
}
