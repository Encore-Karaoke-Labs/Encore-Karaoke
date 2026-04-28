import {
  require_localforage
} from "./chunk-PTBF3O6T.js";
import {
  Html
} from "./chunk-FX4GTR7E.js";
import {
  __toESM
} from "./chunk-7D4SUZUM.js";

// src/libs/vfs.js
var import_localforage = __toESM(require_localforage());
var templateFsLayout = {
  Root: {
    CherryTree: {
      user: {
        ".token": "",
        "apps.json": JSON.stringify({
          last_updated: Date.now(),
          list: [
            {
              id: "movies&tv",
              name: "Movies & TV",
              color: "hsl(0, 65%, 62%)",
              lastPlayed: Date.now() - 100,
              image: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS10diI+PHJlY3Qgd2lkdGg9IjIwIiBoZWlnaHQ9IjE1IiB4PSIyIiB5PSI3IiByeD0iMiIgcnk9IjIiLz48cG9seWxpbmUgcG9pbnRzPSIxNyAyIDEyIDcgNyAyIi8+PC9zdmc+",
              launchPkg: "apps:Movies&TV"
            },
            {
              id: "audioplayer",
              name: "Audio Player (WIP)",
              color: "hsl(15, 65%, 62%)",
              lastPlayed: Date.now() - 1e3,
              image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-speaker'%3E%3Crect width='16' height='20' x='4' y='2' rx='2'/%3E%3Cpath d='M12 6h.01'/%3E%3Ccircle cx='12' cy='14' r='4'/%3E%3Cpath d='M12 14h.01'/%3E%3C/svg%3E",
              launchPkg: "apps:AudioPlayer"
            },
            {
              id: "filemanager",
              name: "File Manager",
              color: "hsl(130, 65%, 62%)",
              lastPlayed: Date.now() - 1e3,
              image: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1mb2xkZXIiPjxwYXRoIGQ9Ik0yMCAyMGEyIDIgMCAwIDAgMi0yVjhhMiAyIDAgMCAwLTItMmgtNy45YTIgMiAwIDAgMS0xLjY5LS45TDkuNiAzLjlBMiAyIDAgMCAwIDcuOTMgM0g0YTIgMiAwIDAgMC0yIDJ2MTNhMiAyIDAgMCAwIDIgMloiLz48L3N2Zz4=",
              launchPkg: "apps:FileManager"
            },
            {
              id: "systemsettings",
              name: "System Settings",
              color: "hsl(200, 65%, 62%)",
              lastPlayed: Date.now() - 1e3,
              image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-settings'%3E%3Cpath d='M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'/%3E%3Ccircle cx='12' cy='12' r='3'/%3E%3C/svg%3E",
              launchPkg: "apps:Settings"
            },
            {
              id: "debug",
              name: "Debug",
              color: "hsl(280, 65%, 62%)",
              lastPlayed: Date.now() - 1e3,
              image: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1oYW1tZXIiPjxwYXRoIGQ9Im0xNSAxMi04LjM3MyA4LjM3M2ExIDEgMCAxIDEtMy0zTDEyIDkiLz48cGF0aCBkPSJtMTggMTUgNC00Ii8+PHBhdGggZD0ibTIxLjUgMTEuNS0xLjkxNC0xLjkxNEEyIDIgMCAwIDEgMTkgOC4xNzJWN2wtMi4yNi0yLjI2YTYgNiAwIDAgMC00LjIwMi0xLjc1Nkw5IDIuOTZsLjkyLjgyQTYuMTggNi4xOCAwIDAgMSAxMiA4LjRWMTBsMiAyaDEuMTcyYTIgMiAwIDAgMSAxLjQxNC41ODZMMTguNSAxNC41Ii8+PC9zdmc+",
              launchPkg: "apps:DebugApp"
            },
            {
              id: "tabbed",
              name: "Tabbed UI (WIP)",
              color: "hsl(280, 65%, 62%)",
              lastPlayed: Date.now() - 1e3,
              image: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS10YWJsZS1wcm9wZXJ0aWVzIj48cGF0aCBkPSJNMTUgM3YxOCIvPjxyZWN0IHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgeD0iMyIgeT0iMyIgcng9IjIiLz48cGF0aCBkPSJNMjEgOUgzIi8+PHBhdGggZD0iTTIxIDE1SDMiLz48L3N2Zz4=",
              launchPkg: "apps:TabbedUI"
            },
            {
              id: "youtube",
              name: "YouTube",
              color: "hsl(0, 65%, 62%)",
              lastPlayed: Date.now() - 1e3,
              image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-tv-minimal-play'%3E%3Cpath d='M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z'/%3E%3Cpath d='M7 21h10'/%3E%3Crect width='20' height='14' x='2' y='3' rx='2'/%3E%3C/svg%3E",
              launchPkg: "apps:YouTube"
            }
          ]
        })
      }
    }
  }
};
var Vfs = {
  // The file system is represented as a nested object, where each key is a folder or file name
  // and the value is either a string (for file contents) or another object (for a subfolder)
  fileSystem: {},
  async save() {
    await window.localforage.setItem("fs", JSON.stringify(this.fileSystem));
    this.fileSystem = JSON.parse(await window.localforage.getItem("fs"));
  },
  async exportFS() {
    return this.fileSystem;
  },
  async importFS(fsObject = templateFsLayout) {
    if (fsObject === true) {
      this.fileSystem = templateFsLayout;
    } else if (!await window.localforage.getItem("fs") && fsObject === templateFsLayout) {
      this.fileSystem = fsObject;
    } else if (fsObject !== templateFsLayout) {
      this.fileSystem = fsObject;
    } else {
      const existingFs = JSON.parse(await window.localforage.getItem("fs"));
      this.fileSystem = existingFs;
    }
    this.save();
    return this.fileSystem;
  },
  // Helper function to get the parent folder of a given path
  async getParentFolder(path) {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  },
  // function to tell you if stored data is a file or a folder
  async whatIs(path, fsObject = this.fileSystem) {
    const parts = path.split("/");
    let current = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof current[part] === "undefined") {
        return null;
      }
      current = current[part];
    }
    if (typeof current !== "string") {
      return "dir";
    } else {
      return "file";
    }
  },
  // Function to get the contents of a file at a given path
  async readFile(path, fsObject = this.fileSystem) {
    const parts = path.split("/");
    let current = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof current[part] === "undefined") {
        return null;
      }
      current = current[part];
    }
    if (typeof current !== "string") {
      return null;
    }
    return current;
  },
  // Function to write to a file at a given path
  async writeFile(path, contents, fsObject = this.fileSystem) {
    const parts = path.split("/");
    const filename = parts.pop();
    let current = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof current[part] === "undefined") {
        current[part] = {};
      }
      current = current[part];
    }
    current[filename] = contents;
    this.save();
  },
  // Function to create a new folder at a given path
  async createFolder(path, fsObject = this.fileSystem) {
    const parts = path.split("/");
    const foldername = parts.pop();
    let current = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof current[part] === "undefined") {
        current[part] = {};
      }
      current = current[part];
    }
    if (!current[foldername]) current[foldername] = {};
    this.save();
  },
  // Function to delete a file or folder at a given path
  async delete(path, fsObject = this.fileSystem) {
    const parts = path.split("/");
    const filename = parts.pop();
    const parentPath = this.getParentFolder(path);
    let parent = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof parent[part] === "undefined") {
        return;
      }
      parent = parent[part];
    }
    delete parent[filename];
    this.save();
  },
  // Function to list all files and folders at a given path
  async list(path, showHidden = false, fsObject = this.fileSystem) {
    const parts = path.split("/");
    let current = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof current[part] === "undefined") {
        return null;
      }
      current = current[part];
    }
    const result = (await Promise.all(
      Object.keys(current).map(async (m) => {
        if (showHidden === false && m.startsWith(".")) {
          return null;
        }
        return { item: m, type: await this.whatIs(path + "/" + m) };
      })
    )).filter((m) => m !== null);
    return result;
  },
  async exists(path, fsObject = this.fileSystem) {
    const parts = path.split("/");
    let current = fsObject;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof current[part] === "undefined") {
        return false;
      }
      current = current[part];
    }
    return true;
  },
  async merge(fsObject = this.fileSystem) {
    var existingFs = fsObject;
    function mergeFileSystem(obj1, obj2) {
      for (var key in obj2) {
        if (obj2.hasOwnProperty(key)) {
          if (typeof obj2[key] === "object" && obj2[key] !== null && !Array.isArray(obj2[key])) {
            if (!(key in obj1) || typeof obj1[key] !== "object" || obj1[key] === null || Array.isArray(obj1[key])) {
              obj1[key] = {};
            }
            mergeFileSystem(obj1[key], obj2[key]);
          } else {
            if (!(key in obj1)) {
              obj1[key] = obj2[key];
            } else {
              console.log(
                `File "${key}" already exists and will not be overwritten.`
              );
            }
          }
        }
      }
    }
    mergeFileSystem(existingFs, templateFsLayout);
    this.importFS(existingFs);
  }
};
var vfs_default = Vfs;

// src/core.js
(async () => {
  let Security = {
    vars: /* @__PURE__ */ new Map(),
    getSecureVariable(key) {
      return this.vars.get(key);
    },
    setSecureVariable(key, value) {
      return this.vars.set(key, value);
    },
    async setToken(token) {
      await vfs_default.importFS();
      await vfs_default.writeFile("Root/CherryTree/user/.token", token);
    },
    async getToken() {
      await vfs_default.importFS();
      return await vfs_default.readFile("Root/CherryTree/user/.token");
    }
  };
  let Libs = {
    Html,
    startPkg(pkgName, args) {
      return Core.pkg.run(pkgName, args, false);
    }
  };
  let Processes = {
    list: [],
    get(id) {
      const i = Processes.list[id];
      if (i) {
        return {
          name: i.name,
          pid: i.pid,
          type: i.type
        };
      }
    },
    getService(name) {
      const p = Processes.list.filter((p2) => p2 !== null).filter((p2) => p2.type === "svc").find((p2) => p2.svcName === name);
      if (p !== void 0) return { data: p.data };
    }
  };
  let Core = {
    process: {
      findEmptyPid: function() {
        let r = Processes.list.findIndex((p) => p === null);
        return r !== -1 ? r : Processes.list.length;
      },
      cleanup: function(pid) {
        if (Processes.list[pid]) Processes.list[pid] = null;
        return;
      }
    },
    pkg: {
      startFromUrl: async function(url, Arguments, RunWithoutSecurity = false) {
        const pkg = await import(url);
        const pkgData = pkg.default;
        let privs = false;
        if (!pkgData || typeof pkgData !== "object") return false;
        if (!pkgData.start || typeof pkgData.start !== "function") return false;
        if (!pkgData.end || typeof pkgData.end !== "function") return false;
        if (!pkgData.name || typeof pkgData.name !== "string") return false;
        if (!pkgData.type || typeof pkgData.type !== "string") return false;
        if (pkgData.svcName !== void 0 && typeof pkgData.svcName !== "string")
          return false;
        if (pkgData.data !== void 0 && typeof pkgData.data !== "object")
          return false;
        if (pkgData.privs === void 0 || typeof pkgData.privs !== "number")
          return false;
        if (RunWithoutSecurity === false) {
          if (pkgData.privs === 1) {
            if (confirm(
              `The app ${pkgData.name} wants to start with privileges. Confirm or deny?`
            ) === true) {
              privs = true;
            }
          }
        } else {
          privs = pkgData.privs === 1 ? true : false;
        }
        const pkgHasData = pkgData.data !== void 0;
        let data = void 0;
        let pkgType = pkgData.type;
        let svcName = pkgData.svcName;
        if (pkgHasData) {
          data = pkgData.data;
          pkgType = "svc";
        }
        const pid = Core.process.findEmptyPid();
        Processes.list[pid] = {
          pid,
          name: pkgData.name,
          type: pkgType,
          privs: pkgData.privs,
          data,
          async end() {
            console.log("Attempting to end pkg:", pkgData.name);
            const result = await pkgData.end();
            if (result !== false) Core.process.cleanup(pid);
            document.dispatchEvent(
              new CustomEvent("CherryTree.Core.ProcessExit", {
                detail: { url, name: pkgData.name, pid }
              })
            );
          }
        };
        if (svcName !== void 0) Processes.list[pid].svcName = svcName;
        const Root = {
          Arguments,
          Libs,
          Security,
          Core: privs === true ? Core : void 0,
          Pid: pid,
          end: Processes.list[pid].end,
          Processes: {
            list: privs === true ? Processes.list : void 0,
            get: Processes.get,
            getService: Processes.getService
          }
        };
        pkg.default.start(Root);
        document.dispatchEvent(
          new CustomEvent("CherryTree.Core.ProcessStart", {
            detail: { url, name: pkgData.name, pid }
          })
        );
        return Processes.list[pid];
      },
      run: async function(url, args, rwp) {
        const appCat = url.split(":");
        const cat = appCat[0];
        const nam = appCat[1];
        const securedCats = ["system", "ui"];
        return await this.startFromUrl(
          `/pkgs/${cat}/${nam}.js`,
          args,
          rwp !== true ? securedCats.includes(cat) : true
        );
      }
    }
  };
  await Core.pkg.run("system:BootManager", {
    time: performance.now()
  });
  document.body.style.opacity = 1;
  setTimeout((_) => {
    document.getElementById("TEMP_STYLE").remove();
  }, 1e3);
})();
//# sourceMappingURL=core.js.map
