import type { ThumbTransform } from "./types";

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const OFFSET_LIMIT = 100;

export const DEFAULT_THUMB_TRANSFORM: ThumbTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampThumbTransform(transform: ThumbTransform): ThumbTransform {
  return {
    scale: clamp(transform.scale, MIN_SCALE, MAX_SCALE),
    offsetX: clamp(transform.offsetX, -OFFSET_LIMIT, OFFSET_LIMIT),
    offsetY: clamp(transform.offsetY, -OFFSET_LIMIT, OFFSET_LIMIT),
  };
}

export function normalizeThumbTransform(input: unknown): ThumbTransform {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_THUMB_TRANSFORM };
  }
  const record = input as {
    scale?: unknown;
    offsetX?: unknown;
    offsetY?: unknown;
  };
  const base = { ...DEFAULT_THUMB_TRANSFORM };
  const scale =
    typeof record.scale === "number" && Number.isFinite(record.scale)
      ? record.scale
      : base.scale;
  const offsetX =
    typeof record.offsetX === "number" && Number.isFinite(record.offsetX)
      ? record.offsetX
      : base.offsetX;
  const offsetY =
    typeof record.offsetY === "number" && Number.isFinite(record.offsetY)
      ? record.offsetY
      : base.offsetY;
  return clampThumbTransform({
    scale,
    offsetX,
    offsetY,
  });
}

export function isDefaultThumbTransform(transform: ThumbTransform): boolean {
  const normalized = clampThumbTransform(transform);
  return (
    normalized.scale === DEFAULT_THUMB_TRANSFORM.scale &&
    normalized.offsetX === DEFAULT_THUMB_TRANSFORM.offsetX &&
    normalized.offsetY === DEFAULT_THUMB_TRANSFORM.offsetY
  );
}

export function prepareThumbTransform(
  transform: ThumbTransform | null | undefined
): ThumbTransform | null {
  if (!transform) {
    return null;
  }
  const clamped = clampThumbTransform(transform);
  return isDefaultThumbTransform(clamped) ? null : clamped;
}

export function isOptimizedImageUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "i.imgur.com";
  } catch {
    return false;
  }
}
