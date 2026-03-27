const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");
const fs = require("fs");

module.exports = {
  packagerConfig: {
    asar: true,
    name: "Encore Karaoke",
    icon: "icon.png",
    extraResource: ["resources/static"],
    linux: {
      target: 'deb',
    },
    executableName: "encore-karaoke"
  },
  hooks: {
    packageAfterCopy: async (_, appResources) => {
      if (appResources == null)
        throw new Error(`Unknown platform ${options.platform}`);

      const srcNodeModules = path.join(__dirname, "node_modules");
      const destNodeModules = path.join(appResources, "node_modules");
      fs.cpSync(srcNodeModules, destNodeModules, { recursive: true });
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        "authors": 'Encore Karaoke Labs',
        "description": 'Encore Karaoke app',
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ['darwin'],
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        "authors": 'Encore Karaoke Labs',
        "description": 'Encore Karaoke for Linux',
        "name": "Encore",
        "category": "Games"
      },
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {},
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
