const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

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

const osEntryPoints = ["src/core.js", ...getEntryPoints("src/pkgs")];
const buildOS = esbuild.build({
  entryPoints: osEntryPoints,
  bundle: true,
  outdir: "resources/static",
  format: "esm",
  splitting: true,
  minify: !isDev,
  sourcemap: isDev,
  target: ["es2022"],
  logLevel: "info",
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
    outdir: "resources",
    format: "iife",
    minify: !isDev,
    sourcemap: isDev,
    target: ["es2022"],
    logLevel: "info",
  });
}

Promise.all([buildOS, buildWindows])
  .then(() => {
    console.log("Copying static assets...");
    copyRecursiveSync("src/libs", "resources/static/libs");
    copyRecursiveSync("src/assets", "resources/static/assets");
    copyRecursiveSync("src/remote", "resources/static/remote");

    if (fs.existsSync("src/index.html"))
      fs.copyFileSync("src/index.html", "resources/static/index.html");
    if (fs.existsSync("src/style.css"))
      fs.copyFileSync("src/style.css", "resources/static/style.css");

    const windowsDir = "src/windows";
    if (fs.existsSync(windowsDir)) {
      fs.readdirSync(windowsDir).forEach((file) => {
        if (file.endsWith(".html") || file.endsWith(".css")) {
          fs.copyFileSync(
            path.join(windowsDir, file),
            path.join("resources", file),
          );
        }
      });
    }

    const iconsDir = "src/icons";
    if (fs.existsSync(iconsDir)) {
      fs.readdirSync(iconsDir).forEach((file) => {
        if (file.endsWith(".ico") || file.endsWith(".png")) {
          fs.copyFileSync(
            path.join(iconsDir, file),
            path.join("resources", file),
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
