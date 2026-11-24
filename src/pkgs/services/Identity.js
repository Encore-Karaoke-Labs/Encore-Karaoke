const GUEST_PROFILE_DEFAULTS = {
  nickname: "",
  avatar: null,
  userId: null,
  source: "guest",
  nicknameCustomized: false,
  avatarCustomized: false,
};

function normalizeProfile(value) {
  const nickname =
    typeof value?.nickname === "string" ? value.nickname.trim() : "";

  return {
    nickname,
    avatar:
      typeof value?.avatar === "string" && value.avatar ? value.avatar : null,
    userId: typeof value?.userId === "string" ? value.userId : null,
    source: value?.source === "clerk" ? "clerk" : "guest",
    nicknameCustomized: Boolean(value?.nicknameCustomized),
    avatarCustomized: Boolean(value?.avatarCustomized),
  };
}

function describeClerkError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "");
}

function deriveNickname(user) {
  const candidates = [
    user?.fullName,
    [user?.firstName, user?.lastName].filter(Boolean).join(" "),
    user?.username,
    user?.primaryEmail ? user.primaryEmail.split("@")[0] : null,
  ];

  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed) return trimmed.slice(0, 15);
  }

  return "Singer";
}

const pkg = {
  name: "Encore Identity Service",
  svcName: "IdentitySvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;

    const config = await window.config.getAll();
    const stored = config.identityConfig || {};

    const isLegacyProfile =
      !stored.profile && Boolean(stored.nickname || stored.avatar);
    const storedProfile =
      stored.profile ||
      (isLegacyProfile
        ? { nickname: stored.nickname, avatar: stored.avatar }
        : GUEST_PROFILE_DEFAULTS);

    this.data.profile = normalizeProfile(storedProfile);
    this.data.guestProfile = normalizeProfile(
      stored.guestProfile || storedProfile,
    );

    if (isLegacyProfile) {
      this.data.profile.nicknameCustomized = Boolean(stored.nickname);
      this.data.profile.avatarCustomized = Boolean(stored.avatar);
      this.data.guestProfile.nicknameCustomized = Boolean(stored.nickname);
      this.data.guestProfile.avatarCustomized = Boolean(stored.avatar);
    }

    this.data.account = {
      status: stored.clerk?.userId ? "offline" : "guest",
      signedIn: false,
      userId: stored.clerk?.userId || null,
      email: stored.clerk?.email || null,
      name: stored.clerk?.name || null,
      imageUrl: stored.clerk?.imageUrl || null,
      sessionId: null,
      lastSyncedAt: stored.clerk?.lastSyncedAt || null,
      error: null,
    };

    console.log("[IDENTITY] Identity Service started.");

    this.data._refreshPromise = this.data.refreshAccount();
  },
  end: async function () {
    console.log("[IDENTITY] Identity Service shutting down.");
  },
  data: {
    profile: normalizeProfile(GUEST_PROFILE_DEFAULTS),
    guestProfile: normalizeProfile(GUEST_PROFILE_DEFAULTS),
    account: {
      status: "guest",
      signedIn: false,
      userId: null,
      email: null,
      name: null,
      imageUrl: null,
      sessionId: null,
      lastSyncedAt: null,
      error: null,
    },
    _listeners: new Set(),
    _refreshPromise: null,

    /**
     * Registers a listener that fires whenever the account or profile changes.
     * @param {(account: Object) => void} listener
     * @returns {() => void} Unsubscribe function
     */
    onChange: function (listener) {
      if (typeof listener !== "function") return () => {};
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    },

    _emitChange: function () {
      for (const listener of this._listeners) {
        try {
          listener(this.getAccount());
        } catch (error) {
          console.warn("[IDENTITY] Account listener failed:", error);
        }
      }
    },

    _persist: async function () {
      if (!window.config || typeof window.config.setItem !== "function") {
        return;
      }

      const linkedAccount =
        this.account.userId || this.account.signedIn
          ? {
              userId: this.account.userId,
              email: this.account.email,
              name: this.account.name,
              imageUrl: this.account.imageUrl,
              lastSyncedAt: this.account.lastSyncedAt,
            }
          : null;

      await window.config.setItem("identityConfig", {
        profile: this.profile,
        guestProfile: this.guestProfile,
        clerk: linkedAccount,
      });
    },

    /**
     * Waits for the initial Clerk session restore to settle.
     */
    whenReady: function () {
      return this._refreshPromise || Promise.resolve(this.getAccount());
    },

    /**
     * Retrieves the current user profile.
     */
    getProfile: function () {
      return this.profile;
    },

    /**
     * Retrieves the linked account state, including the stable Clerk user id
     * that Sessions will use to identify hosts.
     */
    getAccount: function () {
      return this.account;
    },

    isSignedIn: function () {
      return Boolean(this.account.signedIn);
    },

    /**
     * Whether the user has enough identity information to host or join.
     */
    hasProfile: function () {
      return Boolean(this.profile.nickname || this.account.signedIn);
    },

    /**
     * Applies a Clerk user to the local profile.
     * @param {Object} user
     * @param {string|null} [sessionId]
     * @param {{adoptRemoteAvatar?: boolean}} [options]
     */
    applyClerkUser: async function (
      user,
      sessionId = null,
      { adoptRemoteAvatar = false } = {},
    ) {
      if (!user || !user.id) return this.account;

      const derivedName = deriveNickname(user);

      this.account = {
        status: "signed-in",
        signedIn: true,
        userId: user.id,
        email: user.primaryEmail || null,
        name: user.fullName || derivedName,
        imageUrl: user.imageUrl || null,
        sessionId: sessionId || null,
        lastSyncedAt: Date.now(),
        error: null,
      };

      this.profile.userId = user.id;
      this.profile.source = "clerk";

      if (!this.profile.nicknameCustomized || !this.profile.nickname) {
        this.profile.nickname = derivedName;
      }

      if (adoptRemoteAvatar && user.imageUrl) {
        this.profile.avatar = user.imageUrl;
        this.profile.avatarCustomized = false;
      } else if (!this.profile.avatarCustomized) {
        this.profile.avatar = user.imageUrl || null;
      }

      await this._persist();
      this._emitChange();
      return this.account;
    },

    _restoreGuestProfile: async function () {
      const guest = normalizeProfile(this.guestProfile);

      if (!guest.nickname) {
        guest.nickname = this.profile.nickname || "";
        guest.avatar = this.profile.avatarCustomized
          ? this.profile.avatar
          : null;
      }

      this.guestProfile = guest;
      this.profile = normalizeProfile(guest);
      await this._persist();
    },

    /**
     * Checks Clerk for an existing session.
     */
    refreshAccount: async function () {
      const previous = this.account;
      this.account = { ...previous, status: "checking", error: null };
      this._emitChange();

      if (!window.clerk || typeof window.clerk.getState !== "function") {
        this.account = {
          status: "guest",
          signedIn: false,
          userId: null,
          email: null,
          name: null,
          imageUrl: null,
          sessionId: null,
          lastSyncedAt: previous.lastSyncedAt,
          error: null,
        };
        await this._restoreGuestProfile();
        this._emitChange();
        return this.account;
      }

      try {
        const state = await window.clerk.getState();

        if (state?.signedIn && state.user) {
          await this.applyClerkUser(state.user, state.sessionId);
        } else if (state?.error) {
          this.account = {
            ...previous,
            status: previous.userId ? "offline" : "guest",
            signedIn: false,
            error: state.error,
          };
          this._emitChange();
        } else {
          this.account = {
            status: "guest",
            signedIn: false,
            userId: null,
            email: null,
            name: null,
            imageUrl: null,
            sessionId: null,
            lastSyncedAt: previous.lastSyncedAt,
            error: null,
          };
          await this._restoreGuestProfile();
          this._emitChange();
        }
      } catch (error) {
        this.account = {
          ...previous,
          status: previous.userId ? "offline" : "guest",
          signedIn: false,
          error: error instanceof Error ? error.message : String(error),
        };
        this._emitChange();
      }

      return this.account;
    },

    /**
     * Opens Clerk's hosted sign-in flow.
     */
    signIn: async function () {
      return this._authenticate("signIn");
    },

    /**
     * Opens Clerk's hosted sign-up flow.
     */
    signUp: async function () {
      return this._authenticate("signUp");
    },

    _authenticate: async function (method) {
      if (!window.clerk || typeof window.clerk[method] !== "function") {
        throw new Error("Clerk is not available in this build.");
      }

      const previous = { ...this.account };
      this.account = { ...previous, status: "authorizing", error: null };
      this._emitChange();

      try {
        const result = await window.clerk[method]();

        if (result?.signedIn && result.user) {
          if (!previous.userId) {
            this.guestProfile = normalizeProfile({
              ...this.profile,
              source: "guest",
              userId: null,
            });
          }

          await this.applyClerkUser(result.user, result.sessionId, {
            adoptRemoteAvatar: true,
          });
          return this.account;
        }

        this.account = {
          ...previous,
          status: previous.userId ? "offline" : "guest",
          error: result?.error || null,
        };
        this._emitChange();
        return this.account;
      } catch (error) {
        this.account = {
          ...previous,
          status: previous.userId ? "offline" : "guest",
          error: error instanceof Error ? error.message : String(error),
        };
        this._emitChange();
        throw error;
      }
    },

    /**
     * Signs out of Clerk and restores the local guest profile.
     */
    signOut: async function () {
      if (window.clerk && typeof window.clerk.signOut === "function") {
        try {
          await window.clerk.signOut();
        } catch (error) {
          console.warn("[IDENTITY] Clerk sign-out failed:", error);
        }
      }

      this.account = {
        status: "guest",
        signedIn: false,
        userId: null,
        email: null,
        name: null,
        imageUrl: null,
        sessionId: null,
        lastSyncedAt: this.account.lastSyncedAt,
        error: null,
      };

      this.profile = normalizeProfile(this.guestProfile);
      await this._persist();
      this._emitChange();
      return this.account;
    },

    /**
     * Returns a fresh Clerk session token for host verification in Sessions.
     * @returns {Promise<{token: string, sessionId: string, userId: string|null, expiresAt: number|null}|null>}
     */
    getSessionToken: async function () {
      if (!window.clerk || typeof window.clerk.getSessionToken !== "function") {
        return null;
      }

      try {
        return await window.clerk.getSessionToken();
      } catch (error) {
        console.warn("[IDENTITY] Could not get Clerk session token:", error);
        return null;
      }
    },

    getHostIdentity: async function () {
      const token = await this.getSessionToken();
      return {
        userId: this.profile.userId || this.account.userId || null,
        sessionId: token?.sessionId || null,
        token: token?.token || null,
        expiresAt: token?.expiresAt || null,
        accountType: this.profile.source,
        verified: Boolean(this.account.signedIn && token?.token),
      };
    },

    /**
     * Updates the singer profile.
     * @param {string} nickname
     * @param {string|null} [base64Avatar] Omit to leave the avatar untouched.
     */
    updateProfile: async function (nickname, base64Avatar) {
      const trimmed = typeof nickname === "string" ? nickname.trim() : "";
      const displayName = (trimmed || this.profile.nickname || "Singer").slice(
        0,
        15,
      );

      const canSync =
        this.account.signedIn &&
        window.clerk &&
        typeof window.clerk.updateProfile === "function";

      let synced = false;
      let syncError = null;

      if (canSync) {
        try {
          const state = await window.clerk.updateProfile({
            nickname: displayName,
            avatar: base64Avatar === undefined ? undefined : base64Avatar,
          });

          if (state?.signedIn && state.user) {
            this.profile.nicknameCustomized = false;
            if (base64Avatar !== undefined) {
              this.profile.avatarCustomized = false;
            }
            await this.applyClerkUser(state.user, state.sessionId);
            synced = true;
          }
        } catch (error) {
          syncError = error;
        }
      }

      this.profile.nickname = displayName;

      if (!synced) {
        this.profile.nicknameCustomized = true;

        if (base64Avatar !== undefined) {
          this.profile.avatar = base64Avatar;
          this.profile.avatarCustomized = true;
        }

        if (this.account.signedIn || this.account.userId) {
          this.profile.source = "clerk";
          this.profile.userId = this.account.userId;
        } else {
          this.profile.source = "guest";
          this.profile.userId = null;
          this.guestProfile = normalizeProfile(this.profile);
        }
      }

      await this._persist();
      this._emitChange();

      if (syncError) {
        throw new Error(
          `Saved locally, but your Clerk account was not updated: ${describeClerkError(syncError)}`,
        );
      }

      return this.profile;
    },

    /**
     * Takes an image file, paints it to a hidden canvas, and scales it down.
     * This keeps the WebRTC metadata payload tiny (vital for fast connections).
     * @param {File} file
     * @returns {Promise<string>} Base64 JPEG data URL
     */
    processAvatarFile: function (file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            const SIZE = 256;
            canvas.width = SIZE;
            canvas.height = SIZE;

            const scale = Math.max(SIZE / img.width, SIZE / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (SIZE - w) / 2;
            const y = (SIZE - h) / 2;

            ctx.fillStyle = "#333";
            ctx.fillRect(0, 0, SIZE, SIZE);
            ctx.drawImage(img, x, y, w, h);

            resolve(canvas.toDataURL("image/jpeg", 0.6));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    /**
     * Resolves a name collision. If "Singer" exists, returns "Singer 1", etc.
     * @param {string} desiredName
     * @param {string[]} existingNames
     * @returns {string} A guaranteed unique name
     */
    resolveCollision: function (desiredName, existingNames) {
      let baseName = desiredName.trim().substring(0, 15) || "Singer";
      let finalName = baseName;
      let counter = 1;

      const lowerExisting = existingNames.map((n) => n.toLowerCase());

      while (lowerExisting.includes(finalName.toLowerCase())) {
        finalName = `${baseName}#${counter}`;
        counter++;
      }
      return finalName;
    },
  },
};
export default pkg;
