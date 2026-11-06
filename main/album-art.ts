import { app } from "electron";
import type { AlbumArtResult } from "./types";
import { logger } from "./logger";

interface MusicBrainzArtistCredit {
  name?: string;
  artist?: {
    name?: string;
  };
}

interface MusicBrainzRelease {
  id?: string;
  title?: string;
  status?: string;
  date?: string;
  "release-group"?: {
    id?: string;
    "primary-type"?: string;
    "secondary-types"?: string[];
  };
}

interface MusicBrainzRecording {
  id?: string;
  title?: string;
  score?: number;
  disambiguation?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
  releases?: MusicBrainzRelease[];
}

interface MusicBrainzSearchResponse {
  recordings?: MusicBrainzRecording[];
}

const ALBUM_ART_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ALBUM_ART_MISS_TTL_MS = 30 * 60 * 1000;
const ALBUM_ART_CACHE_LIMIT = 250;
const ALBUM_ART_REQUEST_TIMEOUT_MS = 7000;
const ALBUM_ART_MAX_COVER_CANDIDATES = 4;
const albumArtCache = new Map<
  string,
  { result: AlbumArtResult; expiresAt: number }
>();

const MUSICBRAINZ_USER_AGENT = `EncoreKaraoke/${app.getVersion()} (https://github.com/Encore-Karaoke-Labs/Encore-Karaoke)`;

function normalizeMusicText(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/\((?:[^)]*)\)|\[[^\]]*\]/g, " ")
    .replaceAll(
      /\b(?:feat|featuring|ft)\.?\s+.*$|\b(?:karaoke|instrumental|backing track|originally performed by|in the style of|made famous by)\b/g,
      " ",
    )
    .replaceAll(/&/g, " and ")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .replaceAll(/\bthe\b/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function musicBrainzQueryValue(value: string, maxLength: number): string {
  return value
    .replaceAll(/["\\]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function titleMatchesRecording(
  recordingTitle: string | undefined,
  title: string,
): boolean {
  const target = normalizeMusicText(title);
  if (!target) return false;
  return normalizeMusicText(recordingTitle ?? "") === target;
}

function artistMatchesRecording(
  recording: MusicBrainzRecording,
  artist: string,
): boolean {
  const target = normalizeMusicText(artist);
  if (!target) return true;

  const candidate = normalizeMusicText(
    (recording["artist-credit"] ?? [])
      .map((credit) => credit.name || credit.artist?.name || "")
      .filter(Boolean)
      .join(" and "),
  );

  if (!candidate) return false;
  return (
    candidate === target ||
    candidate.includes(target) ||
    target.includes(candidate)
  );
}

function isUsableRelease(release: MusicBrainzRelease): boolean {
  const status = (release.status ?? "").toLowerCase();
  const secondaryTypes = release["release-group"]?.["secondary-types"] ?? [];

  if (status === "bootleg") return false;
  if (!release.id && !release["release-group"]?.id) return false;

  return !secondaryTypes.some((type) =>
    /live|compilation|soundtrack|demo|remix|dj-mix|mixtape|spokenword|interview|audiobook/i.test(
      type,
    ),
  );
}

function releaseRank(release: MusicBrainzRelease): number {
  const status = (release.status ?? "").toLowerCase();
  const primaryType = (
    release["release-group"]?.["primary-type"] ?? ""
  ).toLowerCase();

  let score = 0;
  if (status === "official") score += 0;
  else if (status === "promotion") score += 10;
  else if (status === "pseudo-release") score += 20;
  else score += 30;

  if (primaryType === "album") score += 0;
  else if (primaryType === "ep") score += 1;
  else if (primaryType === "single") score += 2;
  else score += 3;

  return score;
}

function collectCoverCandidates(recordings: MusicBrainzRecording[]): string[] {
  const ranked: Array<{ rank: number; urls: string[] }> = [];

  for (const recording of recordings) {
    for (const release of recording.releases ?? []) {
      if (!isUsableRelease(release)) continue;

      const releaseGroupId = release["release-group"]?.id;
      const releaseId = release.id;
      const urls: string[] = [];

      if (releaseGroupId) {
        urls.push(
          `https://coverartarchive.org/release-group/${releaseGroupId}/front-250`,
        );
      }
      if (releaseId) {
        urls.push(`https://coverartarchive.org/release/${releaseId}/front-250`);
      }
      if (urls.length === 0) continue;

      ranked.push({ rank: releaseRank(release), urls });
    }
  }

  ranked.sort((left, right) => left.rank - right.rank);

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    for (const url of candidate.urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= ALBUM_ART_MAX_COVER_CANDIDATES) return urls;
    }
  }
  return urls;
}

async function coverArtExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": MUSICBRAINZ_USER_AGENT,
      },
      signal: AbortSignal.timeout(ALBUM_ART_REQUEST_TIMEOUT_MS),
    });
    return (
      response.ok &&
      (response.headers.get("content-type") ?? "").startsWith("image/")
    );
  } catch {
    return false;
  }
}

function cacheAlbumArt(
  key: string,
  result: AlbumArtResult,
  ttlMs: number,
): void {
  if (albumArtCache.size >= ALBUM_ART_CACHE_LIMIT) {
    const oldest = albumArtCache.keys().next().value;
    if (oldest) albumArtCache.delete(oldest);
  }
  albumArtCache.set(key, { result, expiresAt: Date.now() + ttlMs });
}

export function missingAlbumArt(reason: string): AlbumArtResult {
  return {
    found: false,
    imageUrl: null,
    source: "cover-art-archive",
    reason,
  };
}

export async function lookupAlbumArt(
  title: string,
  artist: string,
): Promise<AlbumArtResult> {
  const cacheKey = `${title}|${artist}`.toLowerCase();
  const cached = albumArtCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  if (!normalizeMusicText(title)) return missingAlbumArt("missing-title");

  const queryParts = [
    `recording:"${musicBrainzQueryValue(title, 120)}"`,
    "NOT secondarytype:live",
    "NOT secondarytype:compilation",
    "NOT secondarytype:soundtrack",
    "NOT secondarytype:demo",
    "NOT secondarytype:remix",
    "NOT secondarytype:dj-mix",
    "NOT secondarytype:mixtape",
  ];
  if (normalizeMusicText(artist)) {
    queryParts.splice(1, 0, `artist:"${musicBrainzQueryValue(artist, 100)}"`);
  }

  const params = new URLSearchParams({
    query: queryParts.join(" AND "),
    fmt: "json",
    limit: "25",
  });

  try {
    const response = await fetch(
      `https://musicbrainz.org/ws/2/recording/?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": MUSICBRAINZ_USER_AGENT,
        },
        signal: AbortSignal.timeout(ALBUM_ART_REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as MusicBrainzSearchResponse;
    const matches = (data.recordings ?? [])
      .filter(
        (recording) =>
          titleMatchesRecording(recording.title, title) &&
          artistMatchesRecording(recording, artist) &&
          !/live/i.test(recording.disambiguation ?? ""),
      )
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

    const candidates = collectCoverCandidates(matches);
    for (const imageUrl of candidates) {
      if (!(await coverArtExists(imageUrl))) continue;

      const result: AlbumArtResult = {
        found: true,
        imageUrl,
        source: "cover-art-archive",
      };
      cacheAlbumArt(cacheKey, result, ALBUM_ART_CACHE_TTL_MS);
      return result;
    }

    const miss = missingAlbumArt(
      matches.length === 0 ? "no-match" : "no-cover",
    );
    cacheAlbumArt(cacheKey, miss, ALBUM_ART_MISS_TTL_MS);
    return miss;
  } catch (error) {
    logger.debug(
      "ARTWORK",
      `Cover Art Archive lookup failed for "${title}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return missingAlbumArt("unavailable");
  }
}
