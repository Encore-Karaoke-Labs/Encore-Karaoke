const HOST_ID = "HOST";
const HOST_NAME = "Main Player";
const PERSIST_INTERVAL_MS = 15000;
const BROADCAST_INTERVAL_MS = 5000;

/**
 * Owns the retail / cashier feature set: per-device credit balances,
 * HOST kiosk credits, Free Play, and the optional time-based credit model.
 *
 * A "credit" is unitless. How much it is worth is decided by `creditUnit`:
 *  - "songs": one credit buys `creditValue` song plays.
 *  - "time": one credit buys `creditValue` minutes of wall-clock session time.
 */
export default class RetailManager {
  constructor(context) {
    this.ctx = context;

    const stored = context.config?.retailConfig || {};

    this.enabled = stored.enabled === true;
    this.freePlay = stored.freePlay === true;
    this.creditUnit = stored.creditUnit === "time" ? "time" : "songs";
    this.creditValue = this._sanitizeCreditValue(stored.creditValue);

    this.registry = this._normalizeRegistry(stored.deviceRegistry);

    // The network manager owns the shared device registry, but it initializes
    // it to an empty object. Replace it with the persisted retail registry so
    // nicknames and credits survive restarts.
    this.ctx.state.deviceRegistry = this.registry;

    this.tickTimer = null;
    this.lastTickAt = Date.now();
    this.lastPersistAt = 0;
    this.lastBroadcastAt = 0;
    this.embedded = false;

    this.boundTick = () => this.tick();
  }

  async init() {
    this.ctx.state.deviceRegistry = this.registry;
    this.lastTickAt = Date.now();
    this.updateIndicator();

    if (!this.tickTimer) {
      this.tickTimer = window.setInterval(this.boundTick, 1000);
    }

    this.embedded = await window.platformHints.has("embedded");

    if (this.embedded) {
      if (this.enabled) {
        this.enabled = false;
        this._persistConfig();
        this.updateIndicator();
      }
      return;
    }

    if (this.enabled) {
      this.broadcastState();
    }
  }

  destroy() {
    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.persist();
  }

  // --- Configuration -------------------------------------------------------

  setEnabled(enabled) {
    if (this.embedded) return;
    const next = Boolean(enabled);
    if (next === this.enabled) return;

    this.enabled = next;
    this.lastTickAt = Date.now();
    this._persistConfig();
    this.updateIndicator();
    this.broadcastState();
    this._notifyTitlebar();
  }

  setFreePlay(freePlay) {
    const next = Boolean(freePlay);
    if (next === this.freePlay) return;

    this.freePlay = next;
    this.lastTickAt = Date.now();
    this._persistConfig();
    this.updateIndicator();
    this.broadcastState();
  }

  setCreditUnit(unit) {
    const next = unit === "time" ? "time" : "songs";
    if (next === this.creditUnit) return;

    this.creditUnit = next;
    this._reconcileBalances();
    this._persistConfig();
    this.updateIndicator();
    this.broadcastState();
  }

  setCreditValue(value) {
    const next = this._sanitizeCreditValue(value);
    if (next === this.creditValue) return;

    this.creditValue = next;
    this._reconcileBalances();
    this._persistConfig();
    this.updateIndicator();
    this.broadcastState();
  }

  // --- Balances ------------------------------------------------------------

  addCredits(target, amount) {
    const add = Number(amount);
    if (!Number.isFinite(add) || add === 0) return;

    const apply = (entry) => {
      if (!entry) return;
      entry.credits = Math.max(0, (Number(entry.credits) || 0) + add);
      if (this.creditUnit === "songs") {
        entry.songsRemaining = Math.max(
          0,
          (Number(entry.songsRemaining) || 0) + add * this.creditValue,
        );
      } else {
        entry.timeRemainingMs = Math.max(
          0,
          (Number(entry.timeRemainingMs) || 0) + add * this.creditValue * 60000,
        );
      }
    };

    if (!target || target === HOST_ID) {
      apply(this.registry[HOST_ID]);
    } else if (target === "ALL") {
      Object.values(this.registry).forEach(apply);
    } else if (this.registry[target]) {
      apply(this.registry[target]);
    }

    this._afterBalanceChange();
  }

  resetCredits(target) {
    const reset = (entry) => {
      if (!entry) return;
      entry.credits = 0;
      entry.songsRemaining = 0;
      entry.timeRemainingMs = 0;
    };

    if (!target || target === HOST_ID) {
      reset(this.registry[HOST_ID]);
    } else if (target === "ALL") {
      Object.values(this.registry).forEach(reset);
    } else if (this.registry[target]) {
      reset(this.registry[target]);
    }

    this._afterBalanceChange();
  }

  createDeviceEntry(nickname) {
    return {
      nickname: String(nickname || "Singer").substring(0, 24),
      credits: 0,
      songsRemaining: 0,
      timeRemainingMs: 0,
    };
  }

  setDeviceNickname(deviceId, nickname) {
    if (!deviceId) return;
    if (!this.registry[deviceId]) {
      this.registry[deviceId] = this.createDeviceEntry(nickname);
    } else {
      this.registry[deviceId].nickname = String(nickname || "Singer").substring(
        0,
        24,
      );
    }
    this.persist();
  }

  // --- Enforcement ---------------------------------------------------------

  isEnforced() {
    return this.enabled && !this.freePlay && !this.ctx.state.isSessionActive;
  }

  hasCredit(deviceId) {
    const entry = this.registry[deviceId || HOST_ID];
    if (!entry) return false;
    if (this.creditUnit === "songs") {
      return (Number(entry.songsRemaining) || 0) >= 1;
    }
    return (Number(entry.timeRemainingMs) || 0) > 0;
  }

  /**
   * Checks for an available credit and spends it when enforcement is active.
   * Time-based credits are not spent per song; the session clock covers them.
   */
  authorizeRemote(identity) {
    if (!this.isEnforced()) return true;

    const deviceId = this.ctx.state.activeSockets[identity];
    if (!deviceId) return false;

    return this.authorizeAndConsume(deviceId);
  }

  authorizeAndConsume(deviceId) {
    if (!this.isEnforced()) return true;

    const target = deviceId || HOST_ID;
    if (!this.hasCredit(target)) return false;

    if (this.creditUnit === "songs") {
      const entry = this.registry[target];
      entry.songsRemaining = Math.max(
        0,
        (Number(entry.songsRemaining) || 0) - 1,
      );
      entry.credits =
        this.creditValue > 0
          ? Math.ceil(entry.songsRemaining / this.creditValue)
          : 0;
      this._afterBalanceChange();
    }

    return true;
  }

  showInsufficient(action = "play song") {
    this.ctx.modules.infoBar?.showTemp(
      "INSERT COIN",
      `Insufficient Credits to ${action}.`,
      3000,
    );
  }

  // --- Public state --------------------------------------------------------

  getPublicState() {
    return {
      enabled: this.enabled,
      freePlay: this.freePlay,
      creditUnit: this.creditUnit,
      creditValue: this.creditValue,
      users: this.registry,
      totalSongs: this.getTotalRemainingSongs(),
      hostTimeMs: Math.max(
        0,
        Number(this.registry[HOST_ID]?.timeRemainingMs) || 0,
      ),
    };
  }

  getTotalRemainingSongs() {
    if (this.creditUnit !== "songs") {
      return Object.values(this.registry).reduce(
        (total, entry) =>
          total +
          Math.floor(
            (Number(entry.timeRemainingMs) || 0) /
              Math.max(1, this.creditValue * 60000),
          ) *
            this.creditValue,
        0,
      );
    }

    return Object.values(this.registry).reduce(
      (total, entry) => total + Math.max(0, Number(entry.songsRemaining) || 0),
      0,
    );
  }

  updateIndicator() {
    const dom = this.ctx.dom;
    if (!dom.creditsDisplay || !dom.creditsText) return;

    if (!this.enabled) {
      dom.creditsDisplay.classOn("hidden");
      return;
    }

    dom.creditsDisplay.classOff("hidden");

    if (this.freePlay) {
      dom.creditsDisplay.classOn("free-play").classOff("has-credits");
      dom.creditsIcon?.attr({ name: "infinite" });
      dom.creditsText.text("FREE PLAY");
      return;
    }

    dom.creditsDisplay.classOff("free-play");

    if (this.creditUnit === "songs") {
      const total = this.getTotalRemainingSongs();
      dom.creditsIcon?.attr({ name: "ticket" });
      dom.creditsText.text(total);
      dom.creditsDisplay[total > 0 ? "classOn" : "classOff"]("has-credits");
    } else {
      const hostMs = Math.max(
        0,
        Number(this.registry[HOST_ID]?.timeRemainingMs) || 0,
      );
      dom.creditsIcon?.attr({ name: "time" });
      dom.creditsText.text(this.formatTime(hostMs));
      dom.creditsDisplay[hostMs > 0 ? "classOn" : "classOff"]("has-credits");
    }
  }

  broadcastState() {
    this.lastBroadcastAt = Date.now();
    this.ctx.root.network?.broadcastSocialState();
  }

  handleCommand(type, value) {
    switch (type) {
      case "add_credits": {
        const target = value?.target || HOST_ID;
        const amount = Number(value?.value ?? value) || 0;
        this.addCredits(target, amount);
        return true;
      }
      case "reset_credits": {
        const target = value?.target || value || "HOST";
        this.resetCredits(target === "HOST" ? HOST_ID : target);
        return true;
      }
      case "set_freeplay":
        this.setFreePlay(Boolean(value));
        return true;
      case "set_retail_config": {
        if (!value || typeof value !== "object") return true;
        if (value.enabled !== undefined)
          this.setEnabled(Boolean(value.enabled));
        if (value.freePlay !== undefined)
          this.setFreePlay(Boolean(value.freePlay));
        if (value.creditUnit !== undefined)
          this.setCreditUnit(value.creditUnit);
        if (value.creditValue !== undefined) {
          this.setCreditValue(value.creditValue);
        }
        this.updateIndicator();
        this.broadcastState();
        return true;
      }
      case "get_retail_state":
      case "get_social_state":
        this.broadcastState();
        return true;
      default:
        return false;
    }
  }

  // --- Internals -----------------------------------------------------------

  tick() {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;

    if (!this.enabled || this.freePlay || this.creditUnit !== "time") {
      return;
    }

    let changed = false;
    for (const entry of Object.values(this.registry)) {
      const remaining = Number(entry.timeRemainingMs) || 0;
      if (remaining <= 0) continue;

      entry.timeRemainingMs = Math.max(0, remaining - elapsed);
      entry.credits =
        this.creditValue > 0
          ? Math.ceil(entry.timeRemainingMs / (this.creditValue * 60000))
          : 0;
      changed = true;
    }

    if (!changed) return;

    this.updateIndicator();

    if (now - this.lastPersistAt >= PERSIST_INTERVAL_MS) {
      this.lastPersistAt = now;
      this.persist();
    }

    if (now - this.lastBroadcastAt >= BROADCAST_INTERVAL_MS) {
      this.broadcastState();
    }
  }

  persist() {
    if (!window?.config?.setItem) return;
    window.config.setItem("retailConfig.deviceRegistry", this.registry);
    window.config.setItem("retailConfig.freePlay", this.freePlay);
    window.config.setItem("retailConfig.creditUnit", this.creditUnit);
    window.config.setItem("retailConfig.creditValue", this.creditValue);
  }

  formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(
        seconds,
      ).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
      2,
      "0",
    )}`;
  }

  _afterBalanceChange() {
    this.updateIndicator();
    this.persist();
    this.broadcastState();
  }

  _reconcileBalances() {
    for (const entry of Object.values(this.registry)) {
      const credits = Math.max(0, Number(entry.credits) || 0);
      if (this.creditUnit === "songs") {
        entry.songsRemaining = credits * this.creditValue;
        entry.timeRemainingMs = 0;
      } else {
        entry.songsRemaining = 0;
        entry.timeRemainingMs = credits * this.creditValue * 60000;
      }
    }
  }

  _sanitizeCreditValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 1) return 1;
    return Math.max(1, Math.round(numeric));
  }

  _normalizeRegistry(rawRegistry) {
    const registry = {};
    const source =
      rawRegistry && typeof rawRegistry === "object" ? rawRegistry : {};

    for (const [id, rawEntry] of Object.entries(source)) {
      if (!rawEntry || typeof rawEntry !== "object") continue;

      const credits = Math.max(0, Number(rawEntry.credits) || 0);
      const hasSongs =
        rawEntry.songsRemaining !== undefined &&
        rawEntry.songsRemaining !== null;
      const hasTime =
        rawEntry.timeRemainingMs !== undefined &&
        rawEntry.timeRemainingMs !== null;

      let songsRemaining = hasSongs
        ? Math.max(0, Number(rawEntry.songsRemaining) || 0)
        : 0;
      let timeRemainingMs = hasTime
        ? Math.max(0, Number(rawEntry.timeRemainingMs) || 0)
        : 0;

      if (!hasSongs && !hasTime) {
        if (this.creditUnit === "songs") {
          songsRemaining = credits * this.creditValue;
        } else {
          timeRemainingMs = credits * this.creditValue * 60000;
        }
      }

      registry[id] = {
        nickname: String(
          rawEntry.nickname || (id === HOST_ID ? HOST_NAME : "Singer"),
        ).substring(0, 24),
        credits,
        songsRemaining,
        timeRemainingMs,
      };
    }

    if (!registry[HOST_ID]) {
      registry[HOST_ID] = {
        nickname: HOST_NAME,
        credits: 0,
        songsRemaining: 0,
        timeRemainingMs: 0,
      };
    }

    return registry;
  }

  _persistConfig() {
    if (!window?.config?.setItem) return;
    window.config.setItem("retailConfig.enabled", this.enabled);
    this.persist();
  }

  _notifyTitlebar() {
    window.desktopIntegration?.ipc?.send?.("retail-notify-changed", {
      enabled: this.enabled,
    });
  }
}
