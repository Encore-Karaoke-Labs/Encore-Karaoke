import Config from "../config-manager";
import { appState } from "./state";

let zoomFactor = 0.85;

export function initZoom(): void {
  const storedZoomLevel = Config.getItem("zoomLevel") as number | null;
  const storedZoomFactor = Config.getItem("zoomFactor") as number | null;
  zoomFactor = storedZoomLevel ?? storedZoomFactor ?? 0.85;
}

export function getZoomFactor(): number {
  return zoomFactor;
}

export function applyZoomFactor(nextZoomFactor: unknown): number {
  zoomFactor = Math.max(0.26, Math.min(2, Number(nextZoomFactor) || 0.85));
  Config.setItem("zoomLevel", zoomFactor);
  if (
    appState.appViewWebContents &&
    !appState.appViewWebContents.isDestroyed()
  ) {
    appState.appViewWebContents.setZoomFactor(zoomFactor);
    appState.appViewWebContents.send("zoom-level-changed", zoomFactor);
  }
  return zoomFactor;
}

export function resetZoom(): number {
  return applyZoomFactor(0.85);
}

export function addZoom(): number {
  return applyZoomFactor(zoomFactor + 0.15);
}

export function reduceZoom(): number {
  if (zoomFactor > 0.26) {
    return applyZoomFactor(zoomFactor - 0.15);
  }
  return zoomFactor;
}
