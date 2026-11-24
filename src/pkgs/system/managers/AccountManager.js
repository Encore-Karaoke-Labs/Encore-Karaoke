import Html from "../../../libs/html.js";
import playNavSfx from "../../../libs/sfx.js";

/**
 * Account & profile manager.
 */
export default class AccountManager {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;
    this._unsubscribe = null;
    this._busy = false;
    this._busyMessage = "";
    this._viewTimer = null;
    this._lastViewKey = null;
    this._focusDescriptor = null;
    this._screen = "profile";
    this._nameEditor = null;

    this.ctx.state.isAccountModalOpen = false;
  }

  init() {
    const identity = this.ctx.services.Identity;
    if (identity?.onChange) {
      this._unsubscribe = identity.onChange(() => {
        this._syncLiveProfile();
        if (this.ctx.state.isAccountModalOpen) this.render();
      });
    }
  }

  /**
   * Pushes the saved singer profile into an active Session
   */
  _syncLiveProfile() {
    const sessions = this.ctx.services.SessionsSvc;
    if (!sessions || typeof sessions.updateLocalProfile !== "function") return;
    sessions.updateLocalProfile(this.identity.getProfile());
  }

  /**
   * Plays a navigation sound effect.
   * @param {string} sfxName - The name of the wav file (without extension)
   */
  playNavSfx(sfxName) {
    return playNavSfx(this.ctx, sfxName);
  }

  get identity() {
    return this.ctx.services.Identity;
  }

  toggleAccountModal(forceState = null) {
    const state = this.ctx.state;
    const isOpening =
      forceState !== null ? forceState : !state.isAccountModalOpen;

    state.isAccountModalOpen = isOpening;

    if (isOpening) {
      this._screen = "profile";
      this._nameEditor = null;
      this.ctx.dom.accountModal.classOff("hidden");
      this.render();
      void this._refreshInBackground();
    } else {
      if (this._viewTimer) {
        clearTimeout(this._viewTimer);
        this._viewTimer = null;
      }
      this._clearViewTransition();
      this._lastViewKey = null;
      this._focusDescriptor = null;
      this._screen = "profile";
      this._nameEditor = null;
      this.ctx.dom.accountModal.classOn("hidden");
      this._busy = false;
      this._busyMessage = "";
      this.ctx.root.sessions?.handleAccountModalClosed?.();
    }
  }

  async _refreshInBackground() {
    const identity = this.identity;
    const account = identity.getAccount();

    if (!account.userId && account.status === "guest") return;
    if (account.status === "checking") return;

    if (
      account.signedIn &&
      account.lastSyncedAt &&
      Date.now() - account.lastSyncedAt < 60_000
    ) {
      return;
    }

    try {
      await identity.refreshAccount();
    } catch {
      // ignore just like how she ignored me
    }
  }

  handleKeyDown(e) {
    if (this._nameEditor) {
      if (e.key === "Escape") {
        e.preventDefault();
        this._nameEditor.cancel();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this._nameEditor.commit();
        return;
      }
    }

    if (e.key === "Escape") {
      e.preventDefault();
      this.toggleAccountModal(false);
      return;
    }

    const focusables = this._getFocusables();
    if (!focusables.length) return;

    const activeEl = document.activeElement;
    const isInput = activeEl && activeEl.tagName === "INPUT";

    if (isInput && ["ArrowLeft", "ArrowRight"].includes(e.key)) return;

    if (e.key === "Tab") {
      e.preventDefault();
      const currentIndex = focusables.indexOf(activeEl);
      let nextIndex = currentIndex + (e.shiftKey ? -1 : 1);
      if (nextIndex >= focusables.length) nextIndex = 0;
      if (nextIndex < 0) nextIndex = focusables.length - 1;
      this.playNavSfx("nav");
      focusables[nextIndex].focus();
      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      return;
    }

    e.preventDefault();
    const target = this._getDirectionalTarget(focusables, activeEl, e.key);
    if (!target) {
      this.playNavSfx("out_of_bounds");
      return;
    }

    this.playNavSfx("nav");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  /**
   * Returns the focusable controls currently visible in the account modal.
   * @returns {HTMLElement[]}
   */
  _getFocusables() {
    const modalEl = this.ctx.dom.accountContentArea?.elm;
    if (!modalEl) return [];

    return Array.from(
      modalEl.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => this._isFocusableVisible(el));
  }

  /**
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  _isFocusableVisible(el) {
    if (!el || !el.isConnected) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Measures the gap between two intervals on the same axis.
   * @param {number} minA - Start of the first interval
   * @param {number} maxA - End of the first interval
   * @param {number} minB - Start of the second interval
   * @param {number} maxB - End of the second interval
   * @returns {number}
   */
  _getIntervalGap(minA, maxA, minB, maxB) {
    if (maxB < minA) return minA - maxB;
    if (maxA < minB) return minB - maxA;
    return 0;
  }

  /**
   * Finds the next focusable element in a direction based on the rendered
   * layout.
   * @param {HTMLElement[]} focusables - Focusable elements in the view
   * @param {HTMLElement} activeEl - Currently focused element
   * @param {string} key - The arrow key that was pressed
   * @returns {HTMLElement|null}
   */
  _getDirectionalTarget(focusables, activeEl, key) {
    const direction = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    }[key];

    if (!direction) return null;
    if (!activeEl || !focusables.includes(activeEl)) {
      return focusables[0] || null;
    }

    const source = activeEl.getBoundingClientRect();
    const sourceCx = source.left + source.width / 2;
    const sourceCy = source.top + source.height / 2;
    let best = null;
    let bestScore = Infinity;

    for (const el of focusables) {
      if (el === activeEl) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const isVertical = direction === "up" || direction === "down";

      if (isVertical) {
        if (direction === "up" ? cy >= sourceCy : cy <= sourceCy) continue;
      } else if (direction === "left" ? cx >= sourceCx : cx <= sourceCx) {
        continue;
      }

      const along = Math.max(
        0,
        isVertical
          ? direction === "up"
            ? source.top - rect.bottom
            : rect.top - source.bottom
          : direction === "left"
            ? source.left - rect.right
            : rect.left - source.right,
      );

      const crossGap = isVertical
        ? this._getIntervalGap(source.left, source.right, rect.left, rect.right)
        : this._getIntervalGap(
            source.top,
            source.bottom,
            rect.top,
            rect.bottom,
          );
      const crossCenterDelta = Math.abs(
        isVertical ? cx - sourceCx : cy - sourceCy,
      );

      const score = along + crossGap * 3 + crossCenterDelta * 0.05;
      if (score < bestScore - 0.001) {
        best = el;
        bestScore = score;
      }
    }

    return best;
  }

  /**
   * Captures where focus currently sits so a re-render can restore it instead
   * of dropping the user back to the top of the modal.
   * @returns {{kind: string, label?: string, placeholder?: string}|null}
   */
  _captureFocus() {
    const modalEl = this.ctx.dom.accountModal?.elm;
    const active = document.activeElement;
    if (!modalEl || !active || !modalEl.contains(active)) return null;

    if (active.tagName === "INPUT") {
      return { kind: "input", placeholder: active.placeholder || "" };
    }

    const button = active.closest("button");
    if (button) return { kind: "button", label: button.textContent.trim() };
    return null;
  }

  /**
   * @param {{kind: string, label?: string, placeholder?: string}} descriptor
   * @returns {boolean} Whether focus was restored
   */
  _restoreFocus(descriptor) {
    const modalEl = this.ctx.dom.accountContentArea?.elm;
    if (!modalEl) return false;

    if (descriptor.kind === "input") {
      const input = Array.from(modalEl.querySelectorAll("input")).find(
        (node) => (node.placeholder || "") === descriptor.placeholder,
      );
      if (!input) return false;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
      return true;
    }

    const button = Array.from(modalEl.querySelectorAll("button")).find(
      (node) => node.textContent.trim() === descriptor.label,
    );
    if (!button) return false;
    button.focus();
    return true;
  }

  /**
   * Keeps D-pad users anchored after the view is rebuilt.
   */
  _scheduleFocus() {
    const descriptor = this._focusDescriptor;
    this._focusDescriptor = null;

    setTimeout(() => {
      if (!this.ctx.state.isAccountModalOpen) return;
      if (descriptor && this._restoreFocus(descriptor)) return;
      const first = this._getFocusables()[0];
      if (first) first.focus();
    }, 60);
  }

  _getViewKey() {
    if (this._busy) return "busy";
    if (this._screen === "avatar") return "avatar";
    const account = this.identity.getAccount();
    if (account.signedIn) return "signed-in";
    if (account.userId) return "offline";
    return "guest";
  }

  /**
   * Returns the navigation direction between two account views: 1 when moving
   * deeper into the account flow, -1 when moving back.
   * @param {string|null} fromView
   * @param {string} toView
   * @returns {number}
   */
  _getViewDirection(fromView, toView) {
    const order = {
      guest: 0,
      offline: 1,
      "signed-in": 2,
      avatar: 3,
      busy: 4,
    };
    return (order[toView] ?? 0) >= (order[fromView] ?? 0) ? 1 : -1;
  }

  _clearViewTransition() {
    const dom = this.ctx.dom;
    dom.accountHeader?.classOff("view-enter", "view-leave");
    dom.accountContentArea?.classOff("view-enter", "view-leave");
  }

  _setBusy(message) {
    this._busy = true;
    this._busyMessage = message;
    this.render();
  }

  _clearBusy() {
    this._busy = false;
    this._busyMessage = "";
    this.render();
  }

  render() {
    const dom = this.ctx.dom;
    if (!dom.accountHeader || !dom.accountContentArea) return;

    // Captured before clearing so a re-render can restore focus to the field
    // or button the user was using.
    this._focusDescriptor = this._captureFocus();

    const previousKey = this._lastViewKey;
    const viewKey = this._getViewKey();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const shouldAnimate =
      previousKey !== null &&
      previousKey !== viewKey &&
      !dom.accountModal.elm.classList.contains("hidden") &&
      !reduceMotion;

    if (this._viewTimer) {
      clearTimeout(this._viewTimer);
      this._viewTimer = null;
      this._clearViewTransition();
    }

    if (!shouldAnimate) {
      this._lastViewKey = viewKey;
      this._clearViewTransition();
      this._buildView();
      this._scheduleFocus();
      return;
    }

    dom.accountBox.style({
      "--session-view-dir": String(
        this._getViewDirection(previousKey, viewKey),
      ),
    });

    this._lastViewKey = viewKey;

    const startHeight = Math.round(
      dom.accountBox.elm.getBoundingClientRect().height,
    );

    dom.accountHeader.classOff("view-enter").classOn("view-leave");
    dom.accountContentArea.classOff("view-enter").classOn("view-leave");

    this._viewTimer = setTimeout(() => {
      this._viewTimer = null;
      dom.accountHeader.classOff("view-leave");
      dom.accountContentArea.classOff("view-leave");
      this._buildView();
      this._animateBoxHeight(startHeight);

      void dom.accountHeader.elm.offsetWidth;
      dom.accountHeader.classOn("view-enter");
      dom.accountContentArea.classOn("view-enter");
      this._scheduleFocus();
    }, 170);
  }

  _animateBoxHeight(fromHeight) {
    const boxEl = this.ctx.dom.accountBox?.elm;
    if (!boxEl || !fromHeight) return;

    if (this._heightTimer) {
      clearTimeout(this._heightTimer);
      this._heightTimer = null;
    }
    this._heightToken = (this._heightToken || 0) + 1;
    const token = this._heightToken;

    boxEl.style.height = "";
    const toHeight = Math.round(boxEl.getBoundingClientRect().height);
    boxEl.style.height = `${fromHeight}px`;

    if (!toHeight || Math.abs(toHeight - fromHeight) < 1) {
      boxEl.style.height = "";
      return;
    }

    void boxEl.offsetHeight;
    requestAnimationFrame(() => {
      if (token !== this._heightToken) return;
      boxEl.style.height = `${toHeight}px`;
    });

    this._heightTimer = setTimeout(() => {
      this._heightTimer = null;
      if (token === this._heightToken) boxEl.style.height = "";
    }, 400);
  }

  _buildView() {
    const dom = this.ctx.dom;
    dom.accountHeader.clear();
    dom.accountContentArea.clear();

    const identity = this.identity;
    const account = identity.getAccount();
    const isAvatarScreen = !this._busy && this._screen === "avatar";

    new Html("h1")
      .text(isAvatarScreen ? "PROFILE PICTURE" : "ACCOUNT")
      .appendTo(dom.accountHeader);

    new Html("p")
      .text(
        isAvatarScreen
          ? "This is how other singers see you in Sessions."
          : account.signedIn
            ? "Your Encore identity follows you into Sessions."
            : "Sign in to sync your identity, or sing as a guest.",
      )
      .appendTo(dom.accountHeader);

    const view = new Html("div")
      .classOn("account-view")
      .appendTo(dom.accountContentArea);

    if (this._busy) {
      this._renderBusy(view);
      return;
    }

    if (isAvatarScreen) {
      this._renderAvatarEditor(view);
    } else {
      this._renderProfile(view, account);
    }
  }

  _renderBusy(container) {
    const card = new Html("div")
      .classOn("account-card", "account-card-centered")
      .appendTo(container);

    new Html("img")
      .classOn("loading")
      .attr({ src: "/assets/img/loading-spinner.svg", alt: "" })
      .appendTo(card);

    new Html("h2")
      .classOn("account-card-title")
      .text(this._busyMessage || "PLEASE WAIT")
      .appendTo(card);

    new Html("p")
      .classOn("account-card-desc")
      .text("This should only take a moment.")
      .appendTo(card);
  }

  _renderProfile(container, account) {
    const profile = this.identity.getProfile();
    const displayName = profile.nickname || account.name || "Singer";

    const card = new Html("div").classOn("account-card").appendTo(container);
    const identity = new Html("div").classOn("account-identity").appendTo(card);

    const avatarButton = new Html("button")
      .classOn("account-avatar-button")
      .attr({ type: "button", "aria-label": "Change your profile picture" })
      .on("click", () => {
        this._screen = "avatar";
        this.render();
      })
      .appendTo(identity);

    const avatarFrame = new Html("div")
      .classOn("session-avatar-wrapper", "account-avatar-wrapper")
      .appendTo(avatarButton);

    if (profile.avatar) {
      new Html("img")
        .classOn("session-avatar-preview")
        .attr({ src: profile.avatar, alt: displayName })
        .appendTo(avatarFrame);
    } else {
      new Html("div")
        .classOn("account-avatar-placeholder")
        .html('<ion-icon name="person-outline"></ion-icon>')
        .appendTo(avatarFrame);
    }

    new Html("span")
      .classOn("account-avatar-badge")
      .html('<ion-icon name="pencil-outline"></ion-icon>')
      .appendTo(avatarButton);

    const main = new Html("div")
      .classOn("account-identity-main")
      .appendTo(identity);

    const heading = new Html("h2")
      .classOn("account-name-heading")
      .appendTo(main);

    const nameButton = new Html("button")
      .classOn("account-name")
      .attr({
        type: "button",
        "aria-label": `Rename your singer profile (currently ${displayName})`,
      })
      .on("click", () => this._startNameEdit(heading.elm, displayName))
      .appendTo(heading);

    new Html("span")
      .classOn("account-name-text")
      .text(displayName)
      .appendTo(nameButton);

    new Html("ion-icon")
      .classOn("account-name-pencil")
      .attr({ name: "pencil-outline" })
      .appendTo(nameButton);

    let statusIcon = "person-outline";
    let statusText = "Local account";
    let statusClass = "is-guest";

    if (account.signedIn) {
      statusIcon = "checkmark-circle";
      statusText = "Encore account";
      statusClass = "is-connected";
    } else if (account.userId) {
      statusIcon = "cloud-offline-outline";
      statusText = "Encore account · offline";
      statusClass = "is-offline";
    }

    const status = new Html("p")
      .classOn("account-status", statusClass)
      .appendTo(main);
    new Html("ion-icon").attr({ name: statusIcon }).appendTo(status);
    new Html("span").text(statusText).appendTo(status);

    let description =
      "Signing in links your profile to an Encore account so your profile syncs across your devices signed into the same account.";

    if (account.signedIn) {
      description =
        "Your're signed in! Your profile is now shared across your devices signed into this account.";
    } else if (account.userId) {
      description =
        "Your Encore account is linked, but it could not be verified right now. Your saved profile still works in Sessions while you are offline.";
    }

    new Html("p").classOn("account-card-desc").text(description).appendTo(card);

    if (account.error) {
      new Html("p").classOn("account-error").text(account.error).appendTo(card);
    }

    const actions = new Html("div")
      .classOn("account-action-row")
      .appendTo(card);

    if (account.signedIn) {
      new Html("button")
        .classOn("session-btn")
        .text("MANAGE ACCOUNT")
        .on("click", () => void this._manageAccount())
        .appendTo(actions);

      new Html("button")
        .classOn("session-btn", "danger")
        .text("SIGN OUT")
        .on("click", () => void this._signOut())
        .appendTo(actions);
      return;
    }

    if (account.userId) {
      new Html("button")
        .classOn("session-btn")
        .text("RECONNECT")
        .on("click", () => {
          this._setBusy("RECONNECTING…");
          void this.identity.refreshAccount().finally(() => this._clearBusy());
        })
        .appendTo(actions);

      new Html("button")
        .classOn("session-btn", "danger")
        .text("SIGN OUT")
        .on("click", () => void this._signOut())
        .appendTo(actions);
      return;
    }

    new Html("button")
      .classOn("session-btn", "primary")
      .text("SIGN IN")
      .on("click", () => void this._runAuth("signIn", "OPENING SIGN-IN…"))
      .appendTo(actions);

    new Html("button")
      .classOn("session-btn")
      .text("CREATE ACCOUNT")
      .on("click", () => void this._runAuth("signUp", "OPENING SIGN-UP…"))
      .appendTo(actions);
  }

  _renderAvatarEditor(container) {
    const profile = this.identity.getProfile();
    const displayName = profile.nickname || "Singer";

    const card = new Html("div")
      .classOn("account-card", "account-avatar-view")
      .appendTo(container);

    const stage = new Html("div")
      .classOn("account-avatar-stage")
      .appendTo(card);

    const frame = new Html("div")
      .classOn("session-avatar-wrapper", "account-avatar-large")
      .appendTo(stage);

    if (profile.avatar) {
      new Html("img")
        .classOn("session-avatar-preview")
        .attr({ src: profile.avatar, alt: displayName })
        .appendTo(frame);
    } else {
      new Html("div")
        .classOn("account-avatar-placeholder")
        .html('<ion-icon name="person-outline"></ion-icon>')
        .appendTo(frame);
    }

    const actions = new Html("div")
      .classOn("account-avatar-actions-row")
      .appendTo(card);

    new Html("button")
      .classOn("session-btn", "account-back-btn")
      .html(
        '<ion-icon name="arrow-back-outline" style="font-size: 1.15rem; vertical-align: middle; margin-right: 0.4rem;"></ion-icon><span>BACK</span>',
      )
      .on("click", () => {
        this._screen = "profile";
        this.render();
      })
      .appendTo(actions);

    new Html("button")
      .classOn("session-btn", "primary")
      .text(profile.avatar ? "CHANGE AVATAR" : "UPLOAD AVATAR")
      .on("click", () => void this._pickAvatar())
      .appendTo(actions);

    if (profile.avatar) {
      new Html("button")
        .classOn("session-btn", "danger")
        .text("REMOVE")
        .on("click", () => void this._removeAvatar())
        .appendTo(actions);
    }
  }

  /**
   * Swaps the singer name for an input in place. Enter saves, Escape cancels,
   * and leaving the field saves as well.
   * @param {HTMLElement} container - The heading that holds the name
   * @param {string} currentName
   */
  _startNameEdit(container, currentName) {
    if (this._nameEditor) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "session-input account-name-input";
    input.maxLength = 15;
    input.value = currentName;
    input.setAttribute("aria-label", "Singer display name");

    container.replaceChildren(input);
    input.focus();
    input.select();

    let settled = false;
    const finish = async (commit) => {
      if (settled) return;
      settled = true;
      this._nameEditor = null;

      const next = input.value.trim();
      if (!commit || !next || next === currentName) {
        this.render();
        return;
      }

      try {
        await this.identity.updateProfile(next);
        this.ctx.modules.infoBar.showTemp("PROFILE", "Name updated.", 2000);
      } catch (error) {
        this.ctx.modules.infoBar.showTemp(
          "PROFILE",
          error instanceof Error ? error.message : "Could not save your name.",
          5000,
        );
      }
      this.render();
    };

    this._nameEditor = {
      commit: () => void finish(true),
      cancel: () => void finish(false),
    };

    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!this._nameEditor) return;
        if (!this.ctx.state.isAccountModalOpen || this._busy) {
          this._nameEditor = null;
          return;
        }
        void finish(true);
      }, 250);
    });
  }

  async _pickAvatar() {
    const identity = this.identity;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png, image/jpeg, image/webp";

    fileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      this._setBusy("UPLOADING AVATAR…");

      try {
        let b64;
        try {
          b64 = await identity.processAvatarFile(file);
        } catch {
          this.ctx.modules.infoBar.showTemp(
            "AVATAR",
            "Failed to process image.",
            3000,
          );
          return;
        }

        try {
          await identity.updateProfile(identity.getProfile().nickname, b64);
          this.ctx.modules.infoBar.showTemp("PROFILE", "Avatar updated.", 2000);
        } catch (error) {
          this.ctx.modules.infoBar.showTemp(
            "AVATAR",
            error instanceof Error ? error.message : "Could not update avatar.",
            5000,
          );
        }
      } finally {
        this._clearBusy();
      }
    };

    fileInput.click();
  }

  async _removeAvatar() {
    try {
      await this.identity.updateProfile(
        this.identity.getProfile().nickname,
        null,
      );
      this.ctx.modules.infoBar.showTemp("PROFILE", "Avatar removed.", 2000);
      this.render();
    } catch (error) {
      this.ctx.modules.infoBar.showTemp(
        "AVATAR",
        error instanceof Error ? error.message : "Could not remove avatar.",
        5000,
      );
    }
  }

  async _runAuth(method, message) {
    this._setBusy(message);

    try {
      await this.identity[method]();
    } catch (error) {
      this.ctx.modules.infoBar.showTemp(
        "ACCOUNT",
        error instanceof Error ? error.message : "Sign-in failed.",
        4000,
      );
    } finally {
      this._clearBusy();
    }
  }

  async _manageAccount() {
    this._setBusy("OPENING ACCOUNT…");

    try {
      if (window.clerk?.openAccount) {
        await window.clerk.openAccount();
      } else {
        window.desktopIntegration?.openExternal?.(
          "https://accounts.encorekaraoke.org/user",
        );
      }
      await this.identity.refreshAccount();
    } finally {
      this._clearBusy();
    }
  }

  async _signOut() {
    this._setBusy("SIGNING OUT…");

    try {
      await this.identity.signOut();
      this.ctx.modules.infoBar.showTemp("ACCOUNT", "Signed out.", 2500);
    } finally {
      this._clearBusy();
    }
  }
}
