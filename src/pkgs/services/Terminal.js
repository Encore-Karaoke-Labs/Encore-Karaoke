import Html from "../../libs/html.js";

const pkg = {
  name: "Terminal Service",
  svcName: "TerminalSvc",
  type: "svc",
  privs: 1,
  start: async function (Root) {
    console.log("[TerminalSvc] Started.");

    const state = {
      isVisible: false,
      isStopping: false,
      history: [],
      historyIndex: -1,
      activeTaskId: null,
      container: null,
      outputArea: null,
      inputBox: null,
      globalKeyHandler: null,
    };

    state.container = new Html("div")
      .id("encore-terminal")
      .class("hidden")
      .styleJs({
        position: "fixed",
        inset: "0",
        backgroundColor: "#000000",
        color: "#cccccc",
        fontFamily: "Consolas, 'Courier New', monospace",
        zIndex: "99999999",
        display: "flex",
        flexDirection: "column",
        fontSize: "15px",
        lineHeight: "1.2",
      })
      .appendTo("body");

    ["keydown", "keyup", "keypress"].forEach((ev) => {
      state.container.elm.addEventListener(ev, (e) => {
        if (e.key === "Escape" || (e.ctrlKey && e.key === "`")) {
          e.preventDefault();
          e.stopPropagation();
          if (ev === "keydown") pkg.data.hide();
          return;
        }
        e.stopPropagation();
      });
    });

    new Html("div")
      .styleJs({
        backgroundColor: "#2d2d2d",
        color: "#a0a0a0",
        padding: "0.2rem 0.5rem",
        fontSize: "12px",
        display: "flex",
        justifyContent: "space-between",
        borderBottom: "1px solid #111",
        userSelect: "none",
      })
      .html("<span>Debug terminal</span><span>[ESC] to close</span>")
      .appendTo(state.container);

    state.outputArea = new Html("pre")
      .styleJs({
        flex: "1",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        margin: "0",
        padding: "0.5rem",
        fontFamily: "inherit",
      })
      .appendTo(state.container);

    const inputLine = new Html("div")
      .styleJs({
        display: "flex",
        alignItems: "center",
        padding: "0 0.5rem 0.5rem 0.5rem",
      })
      .appendTo(state.container);

    new Html("span")
      .styleJs({ color: "#4af626", marginRight: "0.5rem" })
      .text(">")
      .appendTo(inputLine);

    state.inputBox = new Html("input")
      .attr({ type: "text", autocomplete: "off", spellcheck: "false" })
      .styleJs({
        flex: "1",
        background: "transparent",
        border: "none",
        color: "#ffffff",
        fontFamily: "inherit",
        fontSize: "inherit",
        outline: "none",
        caretColor: "#ffffff",
      })
      .appendTo(inputLine);

    const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");

    const print = (text, color = "#cccccc", isChunk = false) => {
      const cleanText = stripAnsi(text);
      const span = document.createElement("span");
      span.style.color = color;
      span.textContent = cleanText + (isChunk ? "" : "\n");
      state.outputArea.elm.appendChild(span);
      state.outputArea.elm.scrollTop = state.outputArea.elm.scrollHeight;
    };

    const initShell = async () => {
      if (state.isStopping) return;

      if (!window.systemAPI) {
        print("Error: systemAPI not found. Are you in Electron?", "#ff5555");
        return;
      }

      const taskId = `term-session-${Date.now()}`;
      state.activeTaskId = taskId;
      state.inputBox.elm.disabled = false;

      const res = await window.systemAPI.spawnInteractiveShell({
        taskId,
      });

      if (state.isStopping) {
        window.systemAPI.killProcess(taskId, "SIGKILL");
        return;
      }

      if (!res.success) {
        if (state.activeTaskId === taskId) state.activeTaskId = null;
        state.inputBox.elm.disabled = true;
        print(`Failed to mount interactive shell: ${res.error}`, "#ff5555");
      }
    };

    const sendInput = () => {
      const cmdString = state.inputBox.getValue();

      if (cmdString.trim()) {
        state.history.push(cmdString);
        state.historyIndex = state.history.length;
      }

      state.inputBox.val("");

      if (cmdString.trim() === "clear") {
        state.outputArea.clear();
        window.systemAPI?.writeProcessStdin(state.activeTaskId, "\n");
        return;
      }

      if (cmdString.trim() === "exit") {
        pkg.data.hide();
        return;
      }

      print(`> ${cmdString}`, "#4af626");

      if (state.activeTaskId && window.systemAPI) {
        window.systemAPI.writeProcessStdin(
          state.activeTaskId,
          cmdString + "\n",
        );
      }
    };

    state.inputBox.on("keydown", (e) => {
      if (e.key === "Enter") {
        sendInput();
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (state.historyIndex > 0) {
          state.historyIndex--;
          state.inputBox.val(state.history[state.historyIndex]);
        }
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (state.historyIndex < state.history.length - 1) {
          state.historyIndex++;
          state.inputBox.val(state.history[state.historyIndex]);
        } else {
          state.historyIndex = state.history.length;
          state.inputBox.val("");
        }
      }

      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        state.inputBox.val("");
        print("^C", "#ff5555");

        if (state.activeTaskId && window.systemAPI) {
          window.systemAPI.writeProcessStdin(state.activeTaskId, "\x03");
        }
      }
    });

    state.container.on("click", () => state.inputBox.elm.focus());

    if (window.systemAPI) {
      window.systemAPI.onSpawnStdout(({ taskId, data }) => {
        if (taskId === state.activeTaskId) print(data, "#cccccc", true);
      });

      window.systemAPI.onSpawnStderr(({ taskId, data }) => {
        if (taskId === state.activeTaskId) print(data, "#cccccc", true);
      });

      window.systemAPI.onSpawnError(({ taskId, error }) => {
        if (taskId === state.activeTaskId) print(`Error: ${error}`, "#ff5555");
      });

      window.systemAPI.onSpawnExit(({ taskId, exitCode, signal }) => {
        if (taskId !== state.activeTaskId) return;

        if (state.isStopping) return;

        print(`\n[Shell process terminated. Reinitializing...]`, "#ff5555");
        state.activeTaskId = null;
        state.inputBox.elm.disabled = true;
        setTimeout(initShell, 1000);
      });
    }

    state.globalKeyHandler = (e) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        pkg.data.toggle();
      }

      if (state.isVisible && document.activeElement !== state.inputBox.elm) {
        state.inputBox.elm.focus();
      }
    };

    pkg.data._state = state;

    document.addEventListener("keydown", state.globalKeyHandler);

    initShell().catch((error) => {
      print(`Failed to mount interactive shell: ${error.message}`, "#ff5555");
    });
  },

  data: {
    toggle: () => {
      if (pkg.data._state.isVisible) pkg.data.hide();
      else pkg.data.show();
    },
    show: () => {
      pkg.data._state.isVisible = true;
      pkg.data._state.container.classOff("hidden");
      pkg.data._state.inputBox.elm.focus();
    },
    hide: () => {
      pkg.data._state.isVisible = false;
      pkg.data._state.container.classOn("hidden");
      pkg.data._state.inputBox.elm.blur();
    },
  },

  end: async function () {
    console.log("[TerminalSvc] Stopping...");
    const s = pkg.data._state;

    if (!s) return;

    s.isStopping = true;

    if (s.globalKeyHandler) {
      document.removeEventListener("keydown", s.globalKeyHandler);
    }

    if (s.activeTaskId && window.systemAPI) {
      window.systemAPI.killProcess(s.activeTaskId, "SIGKILL");
    }

    if (s.container) {
      s.container.cleanup();
    }
  },
};

export default pkg;
