import localforage from "localforage";

let r;

const UiInfo = {};
let Sfx = { playSfx() {} };

window.snapScroll = false;

let controls = [
  "left",
  "right",
  "up",
  "down",
  "confirm",
  "back",
  "act",
  "alt",
  "menu",
];

function dispatchPlayerSwapEvent(plr) {
  document.dispatchEvent(
    new CustomEvent("Encore.Ui.ControllerChange", {
      detail: plr,
    }),
  );
}

function updatePlayer(plr) {
  document.body.style.setProperty(
    "--current-player",
    `var(--controller-color-${plr})`,
  );

  if (window.p !== undefined) {
    if (window.p !== plr) {
      window.p = plr;
      dispatchPlayerSwapEvent(plr);
    }
  } else {
    window.p = plr;
    dispatchPlayerSwapEvent(plr);
  }
}

// Mouse/kb player swap handler
document.addEventListener("mousemove", () => {
  updatePlayer(4);
});
document.addEventListener("keydown", () => {
  updatePlayer(4);
});

const pkg = {
  name: "UI Lib",
  svcName: "UiLib",
  type: "app",
  privs: 1,
  async start(Root) {
    // Testing
    console.log("[UiLib] Loading success.", Root);
    r = Root;

    let uiScale = await localforage.getItem("settings__uiScale");

    if (uiScale !== undefined) {
      document.documentElement.style.fontSize = uiScale;
    }

    // Keep trying until SfxLib is available.
    let loop = setInterval((_) => {
      if (r.Processes.getService("SfxLib") !== undefined) {
        clearInterval(loop);
        Sfx = r.Processes.getService("SfxLib").data;
        // console.log("sfx:", Sfx);
      }
    }, 1000);
  },
  data: {
    focus: {
      unfocusCurrent(pid) {
        if (UiInfo[pid] === undefined) return;
        let child =
          UiInfo[pid].lists[UiInfo[pid].cursor.y][UiInfo[pid].cursor.x];
        if (child === undefined) return;
        child.classList.remove("over");
      },
      focusCurrent(pid) {
        if (UiInfo[pid] === undefined) return;
        let child =
          UiInfo[pid].lists[UiInfo[pid].cursor.y][UiInfo[pid].cursor.x];
        if (child === undefined) return;
        child.classList.add("over");

        const parent = child.closest(".ui-box,.ui,.game-list");

        if (parent) {
          pkg.data.customScrollIntoView(child, parent);
        }
      },
      pressCurrent(pid) {
        let child =
          UiInfo[pid].lists[UiInfo[pid].cursor.y][UiInfo[pid].cursor.x];
        if (child === undefined) return;
        child.click();
      },
      setupElmLists(pid, elmLists) {
        elmLists.forEach((elmList, y) => {
          elmList.forEach((e, x) => {
            if (
              e.tagName.toLowerCase() !== "button" &&
              e.tagName.toLowerCase() !== "a"
            )
              return;
            e.classList.add("hv");
            e.setAttribute("tabindex", "-1");
            e.onmouseenter = (ev) => {
              if (UiInfo[pid] === undefined) return;
              ev.clientY > 0 && updatePlayer(4);
              pkg.data.focus.unfocusCurrent(pid);
              UiInfo[pid].cursor.x = x;
              UiInfo[pid].cursor.y = y;
              if (e.classList.contains("over") === false)
                Sfx.playSfx(
                  UiInfo[pid] !== undefined
                    ? UiInfo[pid].customSfx.hover
                    : "deck_ui_misc_10.wav",
                );
              pkg.data.focus.focusCurrent(pid);
              UiInfo[pid].parentCallback(UiInfo[pid].cursor);
            };
            e.onmouseleave = () => {
              pkg.data.focus.unfocusCurrent(pid);
            };
            e.onclick = (e) => {
              // Weird hacky way to prevent accidental space/enter clicks
              e.preventDefault();
              e.target.blur();

              e.clientY > 0 && updatePlayer(4);
            };
          });
        });
      },
    },
    customScrollIntoView(element, container, extraSpace = 50) {
      const eBCR = element.getBoundingClientRect();
      // force snap scroll off-screen elements
      if (
        eBCR.left > window.innerWidth ||
        eBCR.right < 0 ||
        eBCR.top > window.innerHeight ||
        eBCR.bottom < 0 ||
        (window.snapScroll !== undefined && window.snapScroll !== false)
      ) {
        element.scrollIntoView();
      } else {
        element.scrollIntoView({
          behavior: "smooth",
          // block: "center",
          // inline: "start",
        });
      }
    },
    listenAll(pid, callback) {
      controls.forEach((action) => {
        r.Input.listen(
          action,
          function x(plr) {
            if (r.Input.focusedApp === pid) callback(action, plr);
          },
          pid,
        );
      });
    },
    unListenAll(pid) {
      controls.forEach((action) => {
        r.Input.unListen(action, pid);
      });
    },
    init(
      pid,
      type,
      elementLists,
      parentCallback = () => {},
      customSfx = {
        hover: "deck_ui_misc_10.wav",
        activate: "deck_ui_default_activation.wav",
      },
    ) {
      if (type === "horizontal") {
        let elmLists = elementLists
          .map((l) => Array.from(l))
          .map((e) => {
            return e.filter((elm) => {
              if (
                elm.tagName.toLowerCase() !== "button" &&
                elm.tagName.toLowerCase() !== "a"
              )
                return false;
              return true;
            });
          });
        UiInfo[pid] = {
          cursor: { x: 0, y: 0, button: "" },
          type: "horizontal",
          lists: elmLists,
          parentCallback,
          customSfx,
        };
        pkg.data.focus.setupElmLists(pid, elmLists);

        // On mouse, we don't want to auto-highlight a selection
        if (window.p === 4 && window.mouseDisabled === false) {
          // Don't highlight the current
          pkg.data.focus.unfocusCurrent(pid);
        } else {
          // Focus the current item for controller/keyboard users
          pkg.data.focus.focusCurrent(pid);
        }

        this.listenAll(pid, async function callback(e, plr) {
          try {
            // Handle player
            updatePlayer(plr);
            let returnCallbackValue;

            // Handle navigation
            switch (e) {
              case "left":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.x--;
                if (UiInfo[pid].cursor.x < 0) {
                  UiInfo[pid].cursor.x = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                UiInfo[pid].cursor.button = "left";
                pkg.data.focus.focusCurrent(pid);
                break;
              case "right":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.x++;
                // Looks slightly complicated,
                // but it just checks if the cursor is
                // too far to the right of the screen
                if (
                  UiInfo[pid].cursor.x >=
                  UiInfo[pid].lists[UiInfo[pid].cursor.y].length
                ) {
                  UiInfo[pid].cursor.x =
                    UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                UiInfo[pid].cursor.button = "right";
                UiInfo[pid].parentCallback(UiInfo[pid].cursor);
                pkg.data.focus.focusCurrent(pid);
                break;
              case "up":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.y--;

                // Set cursor Y to the lowest available
                if (UiInfo[pid].cursor.y < 0) {
                  UiInfo[pid].cursor.y = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }

                // Set cursor X to the highest available
                if (
                  UiInfo[pid].cursor.x >=
                  UiInfo[pid].lists[UiInfo[pid].cursor.y].length
                ) {
                  UiInfo[pid].cursor.x =
                    UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                }
                UiInfo[pid].cursor.button = "up";
                UiInfo[pid].parentCallback(UiInfo[pid].cursor);
                pkg.data.focus.focusCurrent(pid);
                break;
              case "down":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.y++;

                // Set cursor Y to the highest available
                if (UiInfo[pid].cursor.y >= UiInfo[pid].lists.length) {
                  // UiInfo[pid].cursor.y = 0;
                  UiInfo[pid].cursor.y = UiInfo[pid].lists.length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }

                // Set cursor X to the highest available
                if (
                  UiInfo[pid].cursor.x >=
                  UiInfo[pid].lists[UiInfo[pid].cursor.y].length
                ) {
                  UiInfo[pid].cursor.x =
                    UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                }
                UiInfo[pid].cursor.button = "down";
                UiInfo[pid].parentCallback(UiInfo[pid].cursor);
                pkg.data.focus.focusCurrent(pid);
                break;
              case "confirm":
                pkg.data.focus.pressCurrent(pid);
                break;
              case "back":
                UiInfo[pid].parentCallback("back");
                break;
              case "menu":
                parentCallback("menu");
                break;
              case "act":
                parentCallback("act");
                break;
              case "alt":
                parentCallback("alt");
                break;
            }
          } catch (e) {
            // Safely ignore and dismiss any future events.
            if (UiInfo[pid] === undefined) return pkg.data.unListenAll(pid);

            console.log("Error in cursor.");
            console.error(e);
            UiInfo[pid].cursor.x = 0;
            UiInfo[pid].cursor.y = 0;
            pkg.data.focus.focusCurrent(pid);
          }
        });
      } else if (type === "vertical") {
        let elmLists = elementLists.map((l) => Array.from(l));
        UiInfo[pid] = {
          cursor: { x: 0, y: 0, button: "" },
          type: "vertical",
          lists: elmLists,
        };
        elmLists.forEach((elmList, y) => {
          elmList.forEach((e, x) => {
            e.classList.add("hv");
            e.addEventListener("mouseenter", (_) => {
              updatePlayer(4);
              pkg.data.focus.unfocusCurrent(pid);
              UiInfo[pid].cursor.x = 0; // always set x to 0 for vertical layout
              UiInfo[pid].cursor.y = x; // map x to y for vertical layout
              Sfx.playSfx(UiInfo[pid].customSfx.hover);
              pkg.data.focus.focusCurrent(pid);
            });
            e.addEventListener("mouseleave", (_) => {
              pkg.data.focus.unfocusCurrent(pid);
            });
            e.addEventListener("click", (e) => {
              // Sfx.playSfx("deck_ui_default_activation.wav");
              // console.log(e);
              updatePlayer(4);
            });
          });
        });

        // Focus the current item
        pkg.data.focus.focusCurrent(pid);

        let returnCallbackValue;

        this.listenAll(pid, async function callback(e) {
          try {
            // Handle navigation
            switch (e) {
              case "left":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.x--;
                if (UiInfo[pid].cursor.x < 0) {
                  UiInfo[pid].cursor.x = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                UiInfo[pid].cursor.button = "left";
                pkg.data.focus.focusCurrent(pid);
                break;
              case "right":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.x++;
                // Looks slightly complicated,
                // but it just checks if the cursor is
                // too far to the right of the screen
                if (
                  UiInfo[pid].cursor.x >=
                  UiInfo[pid].lists[UiInfo[pid].cursor.y].length
                ) {
                  UiInfo[pid].cursor.x =
                    UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                UiInfo[pid].cursor.button = "right";
                pkg.data.focus.focusCurrent(pid);
                break;
              case "up":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.y--;

                // Set cursor Y to the highest available
                if (UiInfo[pid].cursor.y < 0) {
                  UiInfo[pid].cursor.y = UiInfo[pid].lists.length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }

                // Set cursor X to the highest available
                if (
                  UiInfo[pid].cursor.x >=
                  UiInfo[pid].lists[UiInfo[pid].cursor.y].length
                ) {
                  UiInfo[pid].cursor.x =
                    UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                }
                UiInfo[pid].cursor.button = "up";
                pkg.data.focus.focusCurrent(pid);
                break;
              case "down":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.y++;

                // Set cursor Y to the lowest available
                if (UiInfo[pid].cursor.y >= UiInfo[pid].lists.length) {
                  UiInfo[pid].cursor.y = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor,
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }

                // Set cursor X to the highest available
                if (
                  UiInfo[pid].cursor.x >=
                  UiInfo[pid].lists[UiInfo[pid].cursor.y].length
                ) {
                  UiInfo[pid].cursor.x =
                    UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                }
                pkg.data.focus.focusCurrent(pid);
                UiInfo[pid].cursor.button = "down";
                break;
              case "confirm":
                pkg.data.focus.pressCurrent(pid);
                break;
              case "back":
                parentCallback("back");
                break;
              case "menu":
                parentCallback("menu");
                break;
            }
          } catch (e) {
            // Safely ignore and dismiss any future events.
            if (UiInfo[pid] === undefined) return pkg.data.unListenAll(pid);

            console.log("Error in cursor.");
            console.error(e);
            UiInfo[pid].cursor.x = 0;
            UiInfo[pid].cursor.y = 0;
            pkg.data.focus.focusCurrent(pid);
          }
        });
      }
    },
    update(pid, elementLists) {
      let elmLists = elementLists
        .map((l) => Array.from(l))
        .map((e) => {
          return e.filter((elm) => {
            if (
              elm.tagName.toLowerCase() !== "button" &&
              elm.tagName.toLowerCase() !== "a"
            )
              return false;
            return true;
          });
        });
      if (UiInfo[pid] === undefined) {
        return false;
      }
      UiInfo[pid].lists = elmLists;
      pkg.data.focus.setupElmLists(pid, elmLists);
    },
    get(pid) {
      return UiInfo[pid];
    },
    async transition(type, elm, duration = 500, keep = false) {
      elm.classOff("popIn", "popOut", "fadeIn", "fadeOut").classOn(type);
      return new Promise((res, _rej) => {
        setTimeout(() => {
          res();
          if (keep === false) elm.classOff(type);
        }, 500);
      });
    },
    cleanup(pid) {
      UiInfo[pid] = undefined;
    },
  },
  async end() {
    // shouldn't really be exited...
    r = undefined;
  },
};

export default pkg;

