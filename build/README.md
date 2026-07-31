# Build resources

## `entitlements.mac.plist`

Hardened-runtime entitlements applied by `osxSign` (see `forge.config.js`).

> **Do not add XML comments to this file.** `codesign` parses entitlements with
> AMFI, whose parser rejects comments and fails with
> `AMFIUnserializeXML: syntax error near line N`. `plutil -lint` accepts them,
> so a commented file passes validation and then breaks signing. Keep the
> rationale here instead.

### Granted

| Entitlement | Why |
|---|---|
| `com.apple.security.device.audio-input` | Vocal capture for scoring and recording. |
| `com.apple.security.cs.allow-jit` | V8 requires JIT under the hardened runtime. |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Chromium requires writable-executable pages. |
| `com.apple.security.cs.allow-dyld-environment-variables` | Electron's helper processes rely on `DYLD_*`. |

### Deliberately omitted

- **`com.apple.security.cs.disable-library-validation`** — governs loading
  unsigned dylibs, not `spawn()`. No shipped dependency has a `binding.gyp`;
  `loudness` shells out to `osascript`, and `pdfkit`, `systeminformation` and
  `kuroshiro` are pure JS. `maker-dmg` pulls in `fs-xattr`/`macos-alias`, but
  those are build-time devDependencies that never load in the app process. Add
  this back only if a native `.node` enters the bundle.
- **`com.apple.security.network.server` / `.client`** — App Sandbox keys. This
  app is not sandboxed, so they do nothing here.
- **`com.apple.security.device.camera`** — the Electron process never opens a
  camera; the paired phone captures and streams over PeerJS. Add if the desktop
  ever captures directly.
