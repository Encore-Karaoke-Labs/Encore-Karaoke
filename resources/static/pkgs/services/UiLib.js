import "../../chunk-FX4GTR7E.js";
import "../../chunk-7D4SUZUM.js";

// src/pkgs/services/UiLib.js
var r;
var UiInfo = {};
var Sfx = { playSfx() {
} };
var uis = [];
window.snapScroll = false;
var controls = [
  "left",
  "right",
  "up",
  "down",
  "confirm",
  "back",
  "act",
  "alt",
  "menu"
];
function dispatchPlayerSwapEvent(plr) {
  document.dispatchEvent(
    new CustomEvent("CherryTree.Ui.ControllerChange", {
      detail: plr
    })
  );
}
function updatePlayer(plr) {
  document.body.style.setProperty(
    "--current-player",
    `var(--controller-color-${plr})`
  );
  if (window.p !== void 0) {
    if (window.p !== plr) {
      window.p = plr;
      dispatchPlayerSwapEvent(plr);
    }
  } else {
    window.p = plr;
    dispatchPlayerSwapEvent(plr);
  }
}
document.addEventListener("mousemove", () => {
  updatePlayer(4);
});
document.addEventListener("keydown", () => {
  updatePlayer(4);
});
var pkg = {
  name: "UI Lib",
  svcName: "UiLib",
  type: "app",
  privs: 1,
  async start(Root) {
    console.log("[UiLib] Loading success.", Root);
    r = Root;
    let uiScale = await window.localforage.getItem("settings__uiScale");
    if (uiScale !== void 0) {
      document.documentElement.style.fontSize = uiScale;
    }
    let loop = setInterval((_) => {
      if (r.Processes.getService("SfxLib") !== void 0) {
        clearInterval(loop);
        Sfx = r.Processes.getService("SfxLib").data;
      }
    }, 1e3);
  },
  data: {
    scaling: {
      getScaleValue(percent) {
        return Math.ceil(percent / 100 * 16) + "px";
      }
    },
    focus: {
      unfocusCurrent(pid) {
        if (UiInfo[pid] === void 0) return;
        let child = UiInfo[pid].lists[UiInfo[pid].cursor.y][UiInfo[pid].cursor.x];
        if (child === void 0) return;
        child.classList.remove("over");
      },
      unfocusAll(pid) {
        UiInfo[pid].lists.forEach((l) => {
          l.forEach((x) => x.classList.remove("over"));
        });
      },
      focusCurrent(pid) {
        if (UiInfo[pid] === void 0) return;
        let child = UiInfo[pid].lists[UiInfo[pid].cursor.y][UiInfo[pid].cursor.x];
        if (child === void 0) return;
        child.classList.add("over");
        const parent = child.closest(".ui-box,.ui,.game-list");
        const rootFontSize = parseInt(
          getComputedStyle(document.documentElement).fontSize
        );
        if (parent) {
          pkg.data.customScrollIntoView(child, parent);
        }
      },
      pressCurrent(pid) {
        let child = UiInfo[pid].lists[UiInfo[pid].cursor.y][UiInfo[pid].cursor.x];
        if (child === void 0) return;
        child.click();
      },
      setupElmLists(pid, elmLists) {
        elmLists.forEach((elmList, y) => {
          elmList.forEach((e, x) => {
            if (e.tagName.toLowerCase() !== "button" && e.tagName.toLowerCase() !== "a")
              return;
            e.classList.add("hv");
            e.setAttribute("tabindex", "-1");
            e.onmouseenter = (ev) => {
              if (UiInfo[pid] === void 0) return;
              ev.clientY > 0 && updatePlayer(4);
              pkg.data.focus.unfocusCurrent(pid);
              UiInfo[pid].cursor.x = x;
              UiInfo[pid].cursor.y = y;
              if (e.classList.contains("over") === false)
                Sfx.playSfx(
                  UiInfo[pid] !== void 0 ? UiInfo[pid].customSfx.hover : "deck_ui_misc_10.wav"
                );
              pkg.data.focus.focusCurrent(pid);
              UiInfo[pid].parentCallback(UiInfo[pid].cursor);
            };
            e.onmouseleave = () => {
              pkg.data.focus.unfocusCurrent(pid);
            };
            e.onclick = (e2) => {
              e2.preventDefault();
              e2.target.blur();
              e2.clientY > 0 && updatePlayer(4);
            };
          });
        });
      }
    },
    customScrollIntoView(element, container, extraSpace = 50) {
      const eBCR = element.getBoundingClientRect();
      if (eBCR.left > window.innerWidth || eBCR.right < 0 || eBCR.top > window.innerHeight || eBCR.bottom < 0 || window.snapScroll !== void 0 && window.snapScroll !== false) {
        element.scrollIntoView();
      } else {
        element.scrollIntoView({
          behavior: "smooth"
          // block: "center",
          // inline: "start",
        });
      }
    },
    getTopUi() {
      return r.Input.focusedApp;
    },
    // Had to remake this part due to stupid vscode not saving my files...
    async becomeTopUi(pid, elm) {
      r.Input.focusedApp = pid;
      let item = uis.findIndex((u) => u.pid === pid);
      if (item === -1) {
        uis.push({ active: true, pid, ref: elm });
        return;
      } else uis[item].active = true;
    },
    // async giveUpUi(pid, override = false) {
    //   console.log("LOOKING for", pid);
    //   let item = uis.findIndex((u) => u.pid === pid);
    //   if (item !== -1) {
    //     uis[item].active = false;
    //     console.log("Set ui active false on", pid);
    //     if (pid < 0) {
    //       // negative PIDs are ephemeral
    //       uis.splice(item, 1);
    //     }
    //   }
    //   let maxPid = -Infinity;
    //   let topUi = null;
    //   for (let i = 0; i < uis.length; i++) {
    //     const ui = uis[i];
    //     if (ui.pid !== pid && ui.pid !== 0 && ui.active && ui.pid > maxPid) {
    //       maxPid = ui.pid;
    //       topUi = ui;
    //     }
    //     ui.active = false;
    //   }
    //   if (topUi !== null) {
    //     topUi.active = true;
    //     if (override === false) {
    //       this.becomeTopUi(topUi.pid, topUi.ref);
    //       if (pid > 0) return await this.transition("popIn", topUi.ref);
    //     }
    //   }
    // },
    async giveUpUi(pid, override = false) {
      let item = uis.findIndex((u) => u.pid === pid);
      if (item !== -1) {
        uis[item].active = false;
        if (override === false) uis.splice(item, 1);
      }
      let y = uis.filter((x2) => x2.pid !== pid).sort((a, b) => b.pid < a.pid);
      let x = y[y.length - 1];
      if (x === void 0) return;
      x.active = true;
      if (override === false) {
        this.becomeTopUi(x.pid, x.ref);
        if (pid > 0) return await this.transition("popIn", x.ref);
      }
    },
    // async becomeTopUi(pid, elm) {
    //   r.Input.focusedApp = pid;
    //   const index = this.uis.findIndex((ui) => ui.pid === pid);
    //   if (index !== -1) {
    //     this.uis[index].active = true;
    //     if (elm !== undefined) this.uis[index].ref = elm;
    //     // console.log("Re-setting", pid, "top UI:", this.uis[index]);
    //   } else {
    //     const ui = { active: true, pid: pid, ref: elm };
    //     const i = this.uis.push(ui);
    //     // console.log("New top UI:", this.uis[i - 1]);
    //   }
    // },
    // async giveUpUi(pid, animate = true) {
    //   console.group("Attempting to give up tui for", pid);
    //   const index = this.uis.findIndex((ui) => ui.pid === pid);
    //   console.log("Pid Index:", index);
    //   if (index !== -1 && this.uis[index].active) {
    //     console.log("Pid Data:", this.uis[index]);
    //     this.uis[index].active = false;
    //     const nextUi = this.uis
    //       .filter((ui) => ui.pid !== pid)
    //       .sort((a, b) => b.pid < a.pid)[this.uis.length - 1];
    //     console.log("Next Ui got.");
    //     if (nextUi) {
    //       console.log("Next Ui:", nextUi);
    //       const nextIndex = this.uis.findIndex((ui) => ui.pid === nextUi.pid);
    //       console.log("Next Index:", nextIndex);
    //       if (nextIndex !== -1) {
    //         this.becomeTopUi(this.uis[nextIndex].pid, this.uis[nextIndex].ref);
    //         console.log("Next Index Set Top UI");
    //         if (animate === true)
    //           await this.transition("popIn", this.uis[nextIndex].ref);
    //         console.log("Top UI Transition");
    //         // this.uis[nextIndex].active = true;
    //         console.log("Next Index Active set to True");
    //         // await this.transition("popIn", nextUi.ref);
    //         console.log("Transition Complete");
    //       }
    //     }
    //   }
    //   console.groupEnd();
    // },
    // async becomeTopUi(pid, elm) {
    //   r.Input.focusedApp = pid;
    //   if (!this.uis[pid]) this.uis[pid] = { active: true, pid: pid, ref: elm };
    //   else this.uis[pid].active = true;
    // },
    // async giveUpUi(pid) {
    //   this.uis[pid].active = false;
    //   let x = this.uis
    //     .filter((x) => x.active == true)
    //     .sort((a, b) => b.pid < a.pid)
    //     .pop();
    //   if (x === undefined) return;
    //   this.becomeTopUi(x.pid, x.ref);
    //   await this.transition("popIn", x.ref);
    // },
    addUiEffects(e) {
      e.classList.add("hv");
    },
    listenAll(pid, callback) {
      controls.forEach((action) => {
        r.Input.listen(
          action,
          function x(plr) {
            if (r.Input.focusedApp === pid) callback(action, plr);
          },
          pid
        );
      });
    },
    unListenAll(pid) {
      controls.forEach((action) => {
        r.Input.unListen(action, pid);
      });
    },
    init(pid, type, elementLists, parentCallback = () => {
    }, customSfx = {
      hover: "deck_ui_misc_10.wav",
      activate: "deck_ui_default_activation.wav"
    }) {
      if (type === "horizontal") {
        let elmLists = elementLists.map((l) => Array.from(l)).map((e) => {
          return e.filter((elm) => {
            if (elm.tagName.toLowerCase() !== "button" && elm.tagName.toLowerCase() !== "a")
              return false;
            return true;
          });
        });
        UiInfo[pid] = {
          cursor: { x: 0, y: 0, button: "" },
          type: "horizontal",
          lists: elmLists,
          parentCallback,
          customSfx
        };
        pkg.data.focus.setupElmLists(pid, elmLists);
        if (window.p === 4 && window.mouseDisabled === false) {
          pkg.data.focus.unfocusCurrent(pid);
        } else {
          pkg.data.focus.focusCurrent(pid);
        }
        this.listenAll(pid, async function callback(e, plr) {
          try {
            updatePlayer(plr);
            let returnCallbackValue;
            switch (e) {
              case "left":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.x--;
                if (UiInfo[pid].cursor.x < 0) {
                  UiInfo[pid].cursor.x = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
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
                if (UiInfo[pid].cursor.x >= UiInfo[pid].lists[UiInfo[pid].cursor.y].length) {
                  UiInfo[pid].cursor.x = UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
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
                if (UiInfo[pid].cursor.y < 0) {
                  UiInfo[pid].cursor.y = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                if (UiInfo[pid].cursor.x >= UiInfo[pid].lists[UiInfo[pid].cursor.y].length) {
                  UiInfo[pid].cursor.x = UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                }
                UiInfo[pid].cursor.button = "up";
                UiInfo[pid].parentCallback(UiInfo[pid].cursor);
                pkg.data.focus.focusCurrent(pid);
                break;
              case "down":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.y++;
                if (UiInfo[pid].cursor.y >= UiInfo[pid].lists.length) {
                  UiInfo[pid].cursor.y = UiInfo[pid].lists.length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                if (UiInfo[pid].cursor.x >= UiInfo[pid].lists[UiInfo[pid].cursor.y].length) {
                  UiInfo[pid].cursor.x = UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
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
          } catch (e2) {
            if (UiInfo[pid] === void 0) return pkg.data.unListenAll(pid);
            console.log("Error in cursor.");
            console.error(e2);
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
          lists: elmLists
        };
        elmLists.forEach((elmList, y) => {
          elmList.forEach((e, x) => {
            e.classList.add("hv");
            e.addEventListener("mouseenter", (_) => {
              updatePlayer(4);
              pkg.data.focus.unfocusCurrent(pid);
              UiInfo[pid].cursor.x = 0;
              UiInfo[pid].cursor.y = x;
              Sfx.playSfx(UiInfo[pid].customSfx.hover);
              pkg.data.focus.focusCurrent(pid);
            });
            e.addEventListener("mouseleave", (_) => {
              pkg.data.focus.unfocusCurrent(pid);
            });
            e.addEventListener("click", (e2) => {
              updatePlayer(4);
            });
          });
        });
        pkg.data.focus.focusCurrent(pid);
        let returnCallbackValue;
        this.listenAll(pid, async function callback(e) {
          try {
            switch (e) {
              case "left":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.x--;
                if (UiInfo[pid].cursor.x < 0) {
                  UiInfo[pid].cursor.x = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
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
                if (UiInfo[pid].cursor.x >= UiInfo[pid].lists[UiInfo[pid].cursor.y].length) {
                  UiInfo[pid].cursor.x = UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
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
                if (UiInfo[pid].cursor.y < 0) {
                  UiInfo[pid].cursor.y = UiInfo[pid].lists.length - 1;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                if (UiInfo[pid].cursor.x >= UiInfo[pid].lists[UiInfo[pid].cursor.y].length) {
                  UiInfo[pid].cursor.x = UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
                }
                UiInfo[pid].cursor.button = "up";
                pkg.data.focus.focusCurrent(pid);
                break;
              case "down":
                pkg.data.focus.unfocusCurrent(pid);
                UiInfo[pid].cursor.y++;
                if (UiInfo[pid].cursor.y >= UiInfo[pid].lists.length) {
                  UiInfo[pid].cursor.y = 0;
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx("deck_ui_bumper_end_02.wav");
                  }
                } else {
                  returnCallbackValue = await UiInfo[pid].parentCallback(
                    UiInfo[pid].cursor
                  );
                  if (returnCallbackValue !== false) {
                    Sfx.playSfx(UiInfo[pid].customSfx.hover);
                  }
                }
                if (UiInfo[pid].cursor.x >= UiInfo[pid].lists[UiInfo[pid].cursor.y].length) {
                  UiInfo[pid].cursor.x = UiInfo[pid].lists[UiInfo[pid].cursor.y].length - 1;
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
          } catch (e2) {
            if (UiInfo[pid] === void 0) return pkg.data.unListenAll(pid);
            console.log("Error in cursor.");
            console.error(e2);
            UiInfo[pid].cursor.x = 0;
            UiInfo[pid].cursor.y = 0;
            pkg.data.focus.focusCurrent(pid);
          }
        });
      }
    },
    update(pid, elementLists) {
      let elmLists = elementLists.map((l) => Array.from(l)).map((e) => {
        return e.filter((elm) => {
          if (elm.tagName.toLowerCase() !== "button" && elm.tagName.toLowerCase() !== "a")
            return false;
          return true;
        });
      });
      if (UiInfo[pid] === void 0) {
        return false;
      }
      UiInfo[pid].lists = elmLists;
      pkg.data.focus.setupElmLists(pid, elmLists);
    },
    updatePos(pid, cursor) {
      UiInfo[pid].cursor = cursor;
      pkg.data.focus.unfocusAll(pid);
      pkg.data.focus.focusCurrent(pid);
    },
    updateParentCallback(pid, newCallback) {
      if (UiInfo[pid] === void 0) return;
      UiInfo[pid].parentCallback = newCallback;
    },
    get(pid) {
      return UiInfo[pid];
    },
    async transition(type, elm, duration = 500, keep = false) {
      elm.classOff("popIn", "popOut", "fadeIn", "fadeOut").classOn(type);
      let p = performance.now();
      return new Promise((res, _rej) => {
        setTimeout(() => {
          res();
          if (keep === false) elm.classOff(type);
        }, 500);
      });
    },
    cleanup(pid) {
      UiInfo[pid] = void 0;
    }
  },
  async end() {
    r = void 0;
  }
};
var UiLib_default = pkg;
window.ui = pkg;
window.uiInfo = UiInfo;
window.uis = uis;
export {
  UiLib_default as default
};
//# sourceMappingURL=UiLib.js.map
