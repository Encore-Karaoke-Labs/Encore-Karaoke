import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const isDev = process.argv.includes("--dev");

function getEntryPoints(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getEntryPoints(filePath, fileList);
    } else if (filePath.endsWith(".js")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;

  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

const buildBackend = esbuild.build({
  entryPoints: ["main.js", "preload.js"],
  bundle: true,
  outdir: "dist",
  platform: "node",
  target: "node24",
  format: "esm",
  banner: {
    js: `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
  external: [
    "electron",
    "loudness",
    "systeminformation",
    "kuroshiro-analyzer-kuromoji",
    "electron-squirrel-startup",
  ],
  minify: !isDev,
  sourcemap: isDev,
});

const osEntryPoints = ["src/core.js", ...getEntryPoints("src/pkgs")];
const buildOS = esbuild.build({
  entryPoints: osEntryPoints,
  bundle: true,
  outdir: "dist/resources/static",
  format: "esm",
  splitting: true,
  minify: !isDev,
  sourcemap: isDev,
  target: ["es2022"],
  logLevel: "debug",
});

const windowEntryPoints = [];
if (fs.existsSync("src/windows/titlebar.js"))
  windowEntryPoints.push("src/windows/titlebar.js");
if (fs.existsSync("src/windows/library-manager.js"))
  windowEntryPoints.push("src/windows/library-manager.js");

let buildWindows = Promise.resolve();
if (windowEntryPoints.length > 0) {
  buildWindows = esbuild.build({
    entryPoints: windowEntryPoints,
    bundle: true,
    outdir: "dist/resources",
    format: "iife",
    minify: !isDev,
    sourcemap: isDev,
    target: ["es2022"],
    logLevel: "info",
  });
}

Promise.all([buildBackend, buildOS, buildWindows])
  .then(() => {
    console.log("Copying static assets...");
    copyRecursiveSync("src/libs", "dist/resources/static/libs");
    copyRecursiveSync("src/assets", "dist/resources/static/assets");
    copyRecursiveSync("src/remote", "dist/resources/static/remote");
    copyRecursiveSync("src/games", "dist/resources/static/games");

    if (fs.existsSync("src/index.html"))
      fs.copyFileSync("src/index.html", "dist/resources/static/index.html");
    if (fs.existsSync("src/style.css"))
      fs.copyFileSync("src/style.css", "dist/resources/static/style.css");

    const windowsDir = "src/windows";
    if (fs.existsSync(windowsDir)) {
      fs.readdirSync(windowsDir).forEach((file) => {
        if (file.endsWith(".html") || file.endsWith(".css")) {
          fs.copyFileSync(
            path.join(windowsDir, file),
            path.join("dist/resources", file),
          );
        }
      });
    }

    const iconsDir = "src/icons";
    if (fs.existsSync(iconsDir)) {
      fs.readdirSync(iconsDir).forEach((file) => {
        if (
          file.endsWith(".ico") ||
          file.endsWith(".png") ||
          file.endsWith(".icns")
        ) {
          fs.copyFileSync(
            path.join(iconsDir, file),
            path.join("dist/resources", file),
          );
        }
      });
    }

    console.log("Build complete!");
  })
  .catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
  });
