const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");
const fs = require("fs");

const APP_NAME = "Encore Karaoke";

// Sign only when the environment supplies an identity, so `npm run package`
// still produces a working unsigned build on a dev machine with no certs.
const signing = process.env.APPLE_SIGNING_IDENTITY
  ? {
      osxSign: {
        identity: process.env.APPLE_SIGNING_IDENTITY,
        // packager defaults this to true, which downgrades a signing failure
        // to a warning -- you ship an unsigned app believing it succeeded.
        continueOnError: false,
        optionsForFile: () => ({
          entitlements: "build/entitlements.mac.plist",
          hardenedRuntime: true,
        }),
      },
      // Notarization requires Apple credentials/network. Prefer a notarytool
      // keychain profile (stored via xcrun notarytool) so credentials aren't
      // exposed; CI can fall back to explicit APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD.
      ...(process.env.APPLE_KEYCHAIN_PROFILE
        ? {
            osxNotarize: {
              keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
            },
          }
        : process.env.APPLE_ID && {
            osxNotarize: {
              appleId: process.env.APPLE_ID,
              appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
              teamId: process.env.APPLE_TEAM_ID,
            },
          }),
    }
  : {};

module.exports = {
  packagerConfig: {
    asar: true,
    name: APP_NAME,

    // Extensionless: packager appends .icns on darwin and .ico on win32.
    icon: "dist/resources/icon",

    appBundleId: "org.encorekaraoke.desktop",
    appCategoryType: "public.app-category.music",
    appCopyright: "Copyright © 2026 Encore Karaoke Labs",

    protocols: [
      {
        name: "Encore Karaoke Protocol",
        schemes: ["encore"],
      },
      {
        name: "Encore Karaoke Discord Integration",
        schemes: ["discord-1408795513397973052"],
      },
    ],

    // Makes features like getUserMedia work in Mac
    usageDescription: {
      Microphone:
        "Encore Karaoke uses your microphone to score your singing and record your performances.",
      Camera:
        "Encore Karaoke shows a camera feed from paired phones during a session.",
      AudioCapture:
        "Encore Karaoke captures audio so it can mix and record your performance.",
      BluetoothAlways:
        "Encore Karaoke connects to Bluetooth microphones and speakers.",
    },

    // Do not add CFBundleIdentifier or LSApplicationCategoryType; packager derives them from appBundleId/appCategoryType.
    extendInfo: {
      NSLocalNetworkUsageDescription:
        "Encore Karaoke uses your local network so phones on the same Wi-Fi can act as remote controls, and to find Encore song-update servers.",
      // Bonjour-service uses raw 5353 multicast
      NSBonjourServices: ["_enmoku._tcp", "_encore-server._tcp"],
      NSRemovableVolumesUsageDescription:
        "Encore Karaoke reads your karaoke library from external drives.",
      NSNetworkVolumesUsageDescription:
        "Encore Karaoke reads your karaoke library from network shares.",
    },

    ...signing,

    extraResource: ["dist/resources/static", "dist/resources/icon.png"],
    linux: {
      target: "deb",
    },
    ignore: (file) => {
      if (!file || file === "/" || file === "") return false;

      let normalizedPath = file.replace(/\\/g, "/");
      if (normalizedPath.endsWith("/")) {
        normalizedPath = normalizedPath.slice(0, -1);
      }

      if (
        normalizedPath === "/dist/resources/static" ||
        normalizedPath === "/dist/resources/static/assets" ||
        normalizedPath.startsWith("/dist/resources/static/assets/fonts")
      ) {
        return false;
      }

      if (normalizedPath.startsWith("/dist/resources/static")) return true;

      if (normalizedPath === "/dist/resources/icon.png") return true;

      if (normalizedPath === "/package.json") return false;
      if (normalizedPath.startsWith("/dist")) return false;
      if (normalizedPath.startsWith("/node_modules")) return false;

      return true;
    },
    ...(process.platform === "darwin"
      ? {}
      : { executableName: "encore-karaoke" }),
  },
  hooks: {
    // Notarize and staple signed DMG after packaging.
    postMake: async (_forgeConfig, makeResults) => {
      const profile = process.env.APPLE_KEYCHAIN_PROFILE;
      if (process.platform !== "darwin" || !profile) return makeResults;

      const { promisify } = require("node:util");
      const execFile = promisify(require("node:child_process").execFile);

      const dmgs = makeResults
        .flatMap((r) => r.artifacts)
        .filter((a) => a.endsWith(".dmg"));

      const identity = process.env.APPLE_SIGNING_IDENTITY;

      for (const dmg of dmgs) {
        const name = path.basename(dmg);

        // Must sign before notarizing, then staple; otherwise notarization or stapling fails.
        if (identity) {
          console.log(`\n[dmg] signing ${name}`);
          await execFile("codesign", [
            "--sign",
            identity,
            "--timestamp",
            "--force",
            dmg,
          ]);
        }

        console.log(`[dmg] notarizing ${name} (this takes a few minutes)`);
        await execFile("xcrun", [
          "notarytool",
          "submit",
          dmg,
          "--keychain-profile",
          profile,
          "--wait",
        ]);

        await execFile("xcrun", ["stapler", "staple", dmg]);
        console.log(`[dmg] signed, notarized and stapled ${name}`);
      }
      return makeResults;
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        authors: "Encore Karaoke Labs",
        description: "Encore Karaoke app",
      },
    },
    {
      // Kept alongside the DMG: Squirrel.Mac consumes zips for auto-update.
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        name: APP_NAME,
        icon: "dist/resources/icon.icns",
        format: "ULFO",
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        authors: "Encore Karaoke Labs",
        description: "Encore Karaoke for Linux",
        name: "Encore",
        category: "Games",
        mimeType: [
          "x-scheme-handler/encore",
          "x-scheme-handler/discord-1408795513397973052",
        ],
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
