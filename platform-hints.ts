/**
 * Platform hints let a single desktop build adapt to multiple platforms.
 *
 * Usage:
 *   encore-karaoke --platform-hints=embedded
 *   encore-karaoke --platform-hints embedded,kiosk
 *   encore-karaoke --platform-hints embedded --platform-hints low-latency
 * Individual hints can also be supplied on their own for finer control.
 */

export interface PlatformHintState {
  readonly hints: ReadonlySet<string>;
  readonly embedded: boolean;
  readonly kiosk: boolean;
  readonly kioskMode: boolean;
  readonly lowLatency: boolean;
  has(hint: string): boolean;
  toJSON(): {
    hints: string[];
    embedded: boolean;
    kiosk: boolean;
    kioskMode: boolean;
    lowLatency: boolean;
  };
}

const EMBEDDED_PROFILE: readonly string[] = [
  "kiosk",
  "no-protocols",
  "no-discord",
  "no-deep-links",
  "no-library-manager",
  "no-popout",
];

const HINT_ALIASES: Readonly<Record<string, string>> = {
  appliance: "embedded",
  lowlatency: "low-latency",
};

function normalizeHint(rawHint: string): string | null {
  const normalized = rawHint.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) return null;
  return HINT_ALIASES[normalized] ?? normalized;
}

function addHints(hints: Set<string>, rawValue: string): void {
  for (const rawHint of rawValue.split(/[\s,;]+/)) {
    const hint = normalizeHint(rawHint);
    if (hint) hints.add(hint);
  }
}

export function parsePlatformHints(argv: readonly string[]): PlatformHintState {
  const hints = new Set<string>();

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--platform-hints" || arg === "--platform-hint") {
      const value = argv[index + 1];
      if (value && !value.startsWith("-")) {
        addHints(hints, value);
        index++;
      }
      continue;
    }

    const equalsForm = /^--platform-hints?=(.*)$/.exec(arg);
    if (equalsForm) {
      addHints(hints, equalsForm[1]);
      continue;
    }

    if (arg === "--embedded") hints.add("embedded");
    if (arg === "--kiosk") hints.add("kiosk");
    if (arg === "--low-latency") hints.add("low-latency");
  }

  const kioskMode = hints.has("kiosk");
  const embedded = hints.has("embedded");
  if (embedded) {
    for (const hint of EMBEDDED_PROFILE) hints.add(hint);
  }

  return {
    hints,
    embedded,
    kiosk: hints.has("kiosk"),
    kioskMode,
    lowLatency: hints.has("low-latency"),
    has: (hint: string) => hints.has(hint),
    toJSON: () => ({
      hints: [...hints].sort(),
      embedded,
      kiosk: hints.has("kiosk"),
      kioskMode,
      lowLatency: hints.has("low-latency"),
    }),
  };
}
