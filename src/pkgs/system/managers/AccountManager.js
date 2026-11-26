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
    this._auth = this._blankAuth();
    this._focusSelector = null;

    this.ctx.state.isAccountModalOpen = false;
  }

  _blankAuth() {
    return {
      step: "credentials",
      email: "",
      error: null,
      notice: null,
      submitting: false,
      resendUntil: 0,
      values: {},
    };
  }

  init() {
    const identity = this.ctx.services.Identity;
    if (identity?.onChange) {
      this._unsubscribe = identity.onChange(() => {
        this._syncLiveProfile();
        if (this._screen === "signin" && identity.isSignedIn()) {
          this._screen = "profile";
          this._auth = this._blankAuth();
        }
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
      this._auth = this._blankAuth();
      this._focusSelector = null;
      this.ctx.dom.accountModal.classOff("hidden");
      this.ctx.dom.accountBox.classOff("is-auth");
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
      this._auth = this._blankAuth();
      this._focusSelector = null;
      this.ctx.dom.accountModal.classOn("hidden");
      this.ctx.dom.accountBox.classOff("is-auth");
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
      if (this._screen === "signin" && !this._auth.submitting) {
        this._screen = "profile";
        this._auth = this._blankAuth();
        this.render();
        return;
      }
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
    const selector = this._focusSelector;
    this._focusSelector = null;

    setTimeout(() => {
      if (!this.ctx.state.isAccountModalOpen) return;
      if (selector) {
        const target =
          this.ctx.dom.accountContentArea?.elm?.querySelector(selector);
        if (target) {
          target.focus();
          if (target.setSelectionRange && target.value) {
            const end = target.value.length;
            target.setSelectionRange(end, end);
          }
          return;
        }
      }
      if (descriptor && this._restoreFocus(descriptor)) return;
      const first = this._getFocusables()[0];
      if (first) first.focus();
    }, 60);
  }

  _getViewKey() {
    if (this._busy) return "busy";
    if (this._screen === "signin") return `auth-${this._auth.step}`;
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
    const rank = (view) => {
      if (typeof view === "string" && view.startsWith("auth-")) return 1.5;
      return order[view] ?? 0;
    };
    return rank(toView) >= rank(fromView) ? 1 : -1;
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
    const isAuthScreen = !this._busy && this._screen === "signin";

    dom.accountBox.classOn(isAuthScreen ? "is-auth" : "is-profile");
    dom.accountBox.classOff(isAuthScreen ? "is-profile" : "is-auth");

    if (isAuthScreen) {
      const copy = this._authHeaderCopy();
      new Html("h1").text(copy.title).appendTo(dom.accountHeader);
      new Html("p").text(copy.subtitle).appendTo(dom.accountHeader);
    } else {
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
    }

    const view = new Html("div")
      .classOn("account-view")
      .appendTo(dom.accountContentArea);

    if (this._busy) {
      this._renderBusy(view);
      return;
    }

    if (isAuthScreen) {
      this._renderSignIn(view);
      return;
    }

    if (isAvatarScreen) {
      this._renderAvatarEditor(view);
    } else {
      this._renderProfile(view, account);
    }
  }

  _authHeaderCopy() {
    switch (this._auth.step) {
      case "code-request":
        return {
          title: "SIGN IN WITH A CODE",
          subtitle:
            "No password needed. We'll email a 6-digit code to your Encore address.",
        };
      case "code-verify":
        return {
          title: "CHECK YOUR EMAIL",
          subtitle: "Enter the code we sent to finish signing in.",
        };
      case "reset-request":
        return {
          title: "RESET PASSWORD",
          subtitle: "We'll email you a code so you can choose a new password.",
        };
      case "reset-verify":
        return {
          title: "SET A NEW PASSWORD",
          subtitle: "Enter the reset code, then choose a new password.",
        };
      default:
        return {
          title: "SIGN IN",
          subtitle: "Link this singer profile to your Encore account.",
        };
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

  _openAuth(step, options = {}) {
    const account = this.identity.getAccount();
    this._screen = "signin";
    this._auth = {
      ...this._blankAuth(),
      step,
      email: options.email || this._auth.email || account.email || "",
      notice: options.notice || null,
    };
    this._focusSelector = options.focus || null;
    this.render();
  }

  _authBackToProfile(email) {
    if (this._auth.submitting) return;
    if (this._auth.step !== "credentials") {
      this._openAuth("credentials", {
        email: email || this._auth.email,
        focus: 'input[name="password"]',
      });
      return;
    }
    this._screen = "profile";
    this._auth = this._blankAuth();
    this.render();
  }

  _renderSignIn(container) {
    const wrap = new Html("div").classOn("account-auth").appendTo(container);
    const backLabel =
      this._auth.step === "credentials" ? "BACK TO PROFILE" : "BACK TO SIGN IN";

    new Html("button")
      .classOn("account-auth-back")
      .attr({ type: "button" })
      .html(
        `<ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon><span>${backLabel}</span>`,
      )
      .on("click", () => {
        const emailField = wrap.elm.querySelector('input[name="email"]');
        this._authBackToProfile(emailField?.value.trim());
      })
      .appendTo(wrap);

    const grid = new Html("div").classOn("account-auth-grid").appendTo(wrap);
    const formPane = new Html("div")
      .classOn("account-auth-form")
      .appendTo(grid);

    switch (this._auth.step) {
      case "code-request":
        this._renderRequestStep(formPane, "code");
        break;
      case "code-verify":
        this._renderVerifyStep(formPane, "code");
        break;
      case "reset-request":
        this._renderRequestStep(formPane, "reset");
        break;
      case "reset-verify":
        this._renderVerifyStep(formPane, "reset");
        break;
      default:
        this._renderCredentialStep(formPane);
    }
  }

  _renderCredentialStep(parent) {
    const form = new Html("form")
      .classOn("account-auth-fields")
      .attr({ novalidate: "" })
      .appendTo(parent);
    form.on("submit", (event) => {
      event.preventDefault();
      void this._submitCredentials(form.elm);
    });

    this._authField(form, {
      name: "email",
      label: "Email",
      type: "email",
      icon: "mail-outline",
      autocomplete: "email",
      placeholder: "you@example.com",
      value: this._auth.email,
    });

    this._authField(form, {
      name: "password",
      label: "Password",
      type: "password",
      icon: "lock-closed-outline",
      autocomplete: "current-password",
      placeholder: "Your password",
      decorate: (control, input) => this._addRevealToggle(control, input),
    });

    this._authError(form);
    this._authLinks(form, [
      {
        label: "Forgot password?",
        onClick: () =>
          this._openAuth("reset-request", {
            focus: 'input[name="email"]',
          }),
      },
      {
        label: "Email me a code instead",
        onClick: () =>
          this._openAuth("code-request", {
            focus: 'input[name="email"]',
          }),
      },
    ]);

    this._authSubmit(form, "SIGN IN");

    const alt = new Html("p").classOn("account-auth-alt").appendTo(form);
    new Html("span").text("New to Encore? ").appendTo(alt);
    new Html("button")
      .classOn("account-auth-link")
      .attr({ type: "button" })
      .text("Create an account")
      .on("click", () => void this._runAuth("signUp", "OPENING SIGN-UP…"))
      .appendTo(alt);

    new Html("p")
      .classOn("account-auth-security")
      .html(
        '<ion-icon name="lock-closed-outline" aria-hidden="true"></ion-icon><span>Secured by Clerk. Encore never sees your password.</span>',
      )
      .appendTo(form);
  }

  _renderRequestStep(parent, mode) {
    const isReset = mode === "reset";
    const form = new Html("form")
      .classOn("account-auth-fields")
      .attr({ novalidate: "" })
      .appendTo(parent);
    form.on("submit", (event) => {
      event.preventDefault();
      void this._submitRequest(form.elm, mode);
    });

    new Html("p")
      .classOn("account-auth-lede")
      .text(
        isReset
          ? "Enter the email on your Encore account and we'll send a reset code."
          : "Enter the email on your Encore account and we'll send a sign-in code.",
      )
      .appendTo(form);

    this._authField(form, {
      name: "email",
      label: "Email",
      type: "email",
      icon: "mail-outline",
      autocomplete: "email",
      placeholder: "you@example.com",
      value: this._auth.email,
    });

    this._authError(form);
    this._authSubmit(form, isReset ? "SEND RESET CODE" : "SEND SIGN-IN CODE");
  }

  _renderVerifyStep(parent, mode) {
    const isReset = mode === "reset";
    const form = new Html("form")
      .classOn("account-auth-fields")
      .attr({ novalidate: "" })
      .appendTo(parent);
    form.on("submit", (event) => {
      event.preventDefault();
      void this._submitCode(form.elm, mode);
    });

    this._authNotice(form);

    this._codeField(form, { autoSubmit: !isReset });

    if (isReset) {
      this._authField(form, {
        name: "new-password",
        label: "New password",
        type: "password",
        icon: "lock-closed-outline",
        autocomplete: "new-password",
        placeholder: "At least 8 characters",
        decorate: (control, input) => this._addRevealToggle(control, input),
      });

      this._authField(form, {
        name: "confirm-password",
        label: "Confirm new password",
        type: "password",
        icon: "lock-closed-outline",
        autocomplete: "new-password",
        placeholder: "Repeat your new password",
        decorate: (control, input) => this._addRevealToggle(control, input),
      });
    }

    this._authError(form);
    this._authSubmit(
      form,
      isReset ? "SET PASSWORD & SIGN IN" : "VERIFY & SIGN IN",
    );

    const row = new Html("div").classOn("account-auth-links").appendTo(form);

    const resend = new Html("button")
      .classOn("account-auth-link")
      .attr({ type: "button" })
      .text("Email a new code")
      .appendTo(row);

    resend.on("click", () => void this._resendCode(mode, resend.elm));

    new Html("button")
      .classOn("account-auth-link")
      .attr({ type: "button" })
      .text("Use a different email")
      .on("click", () =>
        this._openAuth(isReset ? "reset-request" : "code-request", {
          focus: 'input[name="email"]',
        }),
      )
      .appendTo(row);
  }

  _codeField(parent, options = {}) {
    const field = new Html("div")
      .classOn("account-auth-field", "account-auth-code-field")
      .appendTo(parent);

    new Html("span")
      .classOn("account-auth-label")
      .text("6-digit code")
      .appendTo(field);

    const group = new Html("div").classOn("account-auth-code").appendTo(field);

    const hidden = new Html("input")
      .attr({ type: "hidden", name: "code" })
      .appendTo(field);

    const boxes = [];
    for (let index = 0; index < 6; index += 1) {
      const box = new Html("input")
        .classOn("account-auth-input", "account-auth-code-box")
        .attr({
          type: "text",
          inputmode: "numeric",
          maxlength: "1",
          autocomplete: index === 0 ? "one-time-code" : "off",
          "aria-label": `Code digit ${index + 1} of 6`,
        })
        .appendTo(group);
      boxes.push(box.elm);
    }

    const sync = () => {
      hidden.elm.value = boxes.map((box) => box.value).join("");
    };

    const focusBox = (index) => {
      const target = boxes[Math.min(Math.max(index, 0), boxes.length - 1)];
      target.focus();
      target.select();
    };

    const spread = (digits, start) => {
      digits
        .slice(0, boxes.length - start)
        .split("")
        .forEach((digit, offset) => {
          boxes[start + offset].value = digit;
        });
    };

    const submitIfComplete = () => {
      if (!options.autoSubmit || this._auth.submitting) return;
      if (boxes.some((box) => !box.value)) return;
      const form = field.elm.closest("form");
      if (form) form.requestSubmit();
    };

    boxes.forEach((box, index) => {
      box.addEventListener("input", () => {
        const digits = box.value.replace(/\D/g, "");

        if (digits.length > 1) {
          spread(digits, index);
          sync();
          focusBox(index + digits.length);
          submitIfComplete();
          return;
        }

        box.value = digits;
        if (box.value && index < boxes.length - 1) focusBox(index + 1);
        sync();
        submitIfComplete();
      });

      box.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !box.value && index > 0) {
          event.preventDefault();
          boxes[index - 1].value = "";
          sync();
          focusBox(index - 1);
        } else if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          focusBox(index - 1);
        } else if (event.key === "ArrowRight" && index < boxes.length - 1) {
          event.preventDefault();
          focusBox(index + 1);
        }
      });

      box.addEventListener("paste", (event) => {
        const digits = (event.clipboardData?.getData("text") || "").replace(
          /\D/g,
          "",
        );
        if (!digits) return;
        event.preventDefault();
        spread(digits, index);
        sync();
        focusBox(index + digits.length);
        submitIfComplete();
      });
    });

    const saved = this._auth.values?.code || "";
    saved.split("").forEach((digit, index) => {
      if (boxes[index]) boxes[index].value = digit;
    });

    sync();
    return field;
  }

  _authField(parent, options) {
    const field = new Html("label")
      .classOn("account-auth-field")
      .appendTo(parent);
    new Html("span")
      .classOn("account-auth-label")
      .text(options.label)
      .appendTo(field);

    const control = new Html("span")
      .classOn("account-auth-control")
      .appendTo(field);
    new Html("ion-icon")
      .attr({ name: options.icon, "aria-hidden": "true" })
      .appendTo(control);

    const input = new Html("input")
      .classOn("account-auth-input")
      .attr({
        type: options.type || "text",
        name: options.name,
        placeholder: options.placeholder || "",
        autocomplete: options.autocomplete || "off",
        "aria-label": options.label,
        inputmode: options.inputmode || null,
        maxlength: options.maxlength || null,
      })
      .appendTo(control);

    const value = options.value || this._auth.values?.[options.name];
    if (value) input.val(value);
    if (options.decorate) options.decorate(control, input);
    return { field, control, input };
  }

  _addRevealToggle(control, input) {
    const reveal = new Html("button")
      .classOn("account-auth-reveal")
      .attr({
        type: "button",
        "aria-label": "Show password",
        "aria-pressed": "false",
      })
      .html('<ion-icon name="eye-outline" aria-hidden="true"></ion-icon>')
      .appendTo(control);

    reveal.on("click", () => {
      const show = input.elm.type === "password";
      input.elm.type = show ? "text" : "password";
      reveal.attr({
        "aria-label": show ? "Hide password" : "Show password",
        "aria-pressed": show ? "true" : "false",
      });
      reveal.html(
        `<ion-icon name="${show ? "eye-off-outline" : "eye-outline"}" aria-hidden="true"></ion-icon>`,
      );
      input.elm.focus();
    });
  }

  _authError(parent) {
    const error = new Html("p")
      .classOn("account-auth-error")
      .attr({ role: "alert", "aria-live": "polite" })
      .appendTo(parent);
    if (this._auth.error) error.text(this._auth.error);
    else error.classOn("hidden");
    return error;
  }

  _authNotice(parent) {
    if (!this._auth.notice) return;
    const notice = new Html("p")
      .classOn("account-auth-notice")
      .html('<ion-icon name="mail-outline" aria-hidden="true"></ion-icon>')
      .appendTo(parent);
    new Html("span").text(this._auth.notice).appendTo(notice);
  }

  _authLinks(parent, links) {
    const row = new Html("div").classOn("account-auth-links").appendTo(parent);
    for (const link of links) {
      new Html("button")
        .classOn("account-auth-link")
        .attr({ type: "button" })
        .text(link.label)
        .on("click", link.onClick)
        .appendTo(row);
    }
    return row;
  }

  _authSubmit(parent, label) {
    const button = new Html("button")
      .classOn("session-btn", "primary", "account-auth-submit")
      .attr({ type: "submit" })
      .appendTo(parent);
    new Html("span")
      .classOn("account-auth-submit-label")
      .attr({ "data-idle": label })
      .text(label)
      .appendTo(button);
    new Html("ion-icon")
      .attr({ name: "arrow-forward-outline", "aria-hidden": "true" })
      .appendTo(button);
    return button;
  }

  _setAuthBusy(formEl, busy, label) {
    this._auth.submitting = busy;
    formEl.classList.toggle("is-busy", busy);
    formEl.setAttribute("aria-busy", busy ? "true" : "false");
    for (const element of formEl.querySelectorAll("input, button")) {
      element.disabled = busy;
    }
    const submitLabel = formEl.querySelector(".account-auth-submit-label");
    if (submitLabel) {
      submitLabel.textContent = busy ? label : submitLabel.dataset.idle;
    }
  }

  _authFail(message, selector) {
    this._auth.error = message;
    this._focusSelector = selector;
    this.render();
  }

  /**
   * Keeps what the user typed (or pasted) across the re-render that shows a
   * validation or server error, so a failed attempt never wipes the form.
   * @param {HTMLFormElement} formEl
   */
  _captureAuthValues(formEl) {
    if (!formEl) return;
    const values = {};
    for (const input of formEl.querySelectorAll("input[name]")) {
      if (input.type === "hidden") continue;
      values[input.name] = input.value;
    }
    const boxes = formEl.querySelectorAll(".account-auth-code-box");
    if (boxes.length) {
      values.code = Array.from(boxes, (box) => box.value).join("");
    }
    this._auth.values = values;
  }

  async _submitCredentials(formEl) {
    this._captureAuthValues(formEl);
    const email = formEl.querySelector('input[name="email"]').value.trim();
    const password = formEl.querySelector('input[name="password"]').value;
    this._auth.email = email;

    if (!email) {
      this._authFail("Enter your email address.", 'input[name="email"]');
      return;
    }
    if (!password) {
      this._authFail("Enter your password.", 'input[name="password"]');
      return;
    }

    this._setAuthBusy(formEl, true, "SIGNING IN…");
    try {
      const result = await this.identity.signInWithPassword(email, password);
      if (result?.challenge) {
        this._showChallenge(result.challenge, email);
        return;
      }
      this._auth = this._blankAuth();
      this._screen = "profile";
      this.ctx.modules.infoBar.showTemp("ACCOUNT", "Signed in.", 2500);
      this.render();
    } catch (error) {
      this._auth.error = error instanceof Error ? error.message : String(error);
      this._auth.submitting = false;
      this._focusSelector = 'input[name="password"]';
      this.render();
    }
  }

  async _submitRequest(formEl, mode) {
    this._captureAuthValues(formEl);
    const email = formEl.querySelector('input[name="email"]').value.trim();
    this._auth.email = email;

    if (!email) {
      this._authFail("Enter your email address.", 'input[name="email"]');
      return;
    }

    this._setAuthBusy(formEl, true, "SENDING CODE…");
    try {
      if (mode === "reset") {
        await this.identity.requestPasswordReset(email);
      } else {
        await this.identity.requestSignInCode(email);
      }

      this._auth.step = mode === "reset" ? "reset-verify" : "code-verify";
      this._auth.values = {};
      this._auth.notice = `We sent a 6-digit code to ${email}.`;
      this._auth.error = null;
      this._auth.submitting = false;
      this._focusSelector = ".account-auth-code-box";
      this.render();
    } catch (error) {
      this._auth.error = error instanceof Error ? error.message : String(error);
      this._auth.submitting = false;
      this._focusSelector = 'input[name="email"]';
      this.render();
    }
  }

  async _submitCode(formEl, mode) {
    this._captureAuthValues(formEl);
    const code = formEl.querySelector('input[name="code"]').value.trim();

    if (!/^\d{6}$/.test(code)) {
      this._authFail(
        "Enter the 6-digit code from your email.",
        ".account-auth-code-box",
      );
      return;
    }

    let password = null;
    if (mode === "reset") {
      password = formEl.querySelector('input[name="new-password"]').value;
      const confirm = formEl.querySelector(
        'input[name="confirm-password"]',
      ).value;

      if (password.length < 8) {
        this._authFail(
          "Use at least 8 characters for your new password.",
          'input[name="new-password"]',
        );
        return;
      }
      if (password !== confirm) {
        this._authFail(
          "The new passwords do not match.",
          'input[name="confirm-password"]',
        );
        return;
      }
    }

    this._setAuthBusy(formEl, true, "VERIFYING…");
    try {
      const result =
        mode === "reset"
          ? await this.identity.submitPasswordReset(code, password)
          : await this.identity.verifySignInCode(code);
      if (result?.challenge) {
        this._showChallenge(result.challenge, this._auth.email);
        return;
      }

      this._auth = this._blankAuth();
      this._screen = "profile";
      this.ctx.modules.infoBar.showTemp("ACCOUNT", "Signed in.", 2500);
      this.render();
    } catch (error) {
      this._auth.error = error instanceof Error ? error.message : String(error);
      this._auth.submitting = false;
      this._focusSelector = ".account-auth-code-box";
      this.render();
    }
  }

  /**
   * Moves the auth screen onto the existing code-verification step when Clerk
   * asks for a second-factor email code (MFA or new-device trust).
   * @param {{email: string, message: string}} challenge
   * @param {string} email
   */
  _showChallenge(challenge, email) {
    this._auth.step = "code-verify";
    this._auth.email = challenge.email || email || this._auth.email;
    this._auth.notice = challenge.message;
    this._auth.error = null;
    this._auth.submitting = false;
    this._auth.values = {};
    this._focusSelector = ".account-auth-code-box";
    this.render();
  }

  async _resendCode(mode, button) {
    if (button.disabled) return;

    this._captureAuthValues(button.closest("form"));
    button.disabled = true;
    button.textContent = "SENDING…";
    try {
      if (mode === "reset") {
        await this.identity.requestPasswordReset(this._auth.email);
      } else {
        await this.identity.requestSignInCode(this._auth.email);
      }
      this._auth.error = null;
      button.textContent = "CODE SENT";
      setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.textContent = "Email a new code";
      }, 20_000);
    } catch (error) {
      this._auth.error = error instanceof Error ? error.message : String(error);
      this._focusSelector = ".account-auth-code-box";
      this.render();
    }
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
      .on("click", () => this._openAuth("credentials"))
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
      if (this.identity.isSignedIn()) {
        this._screen = "profile";
        this._auth = this._blankAuth();
      }
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
