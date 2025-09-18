import { normalizeThumbTransform } from "./image-utils";
import type { AppearanceRecord } from "./types";

function normalizeAppearanceLabelString(value: string): string {
  const tokens = value
    .split(/[,，]/)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  return tokens.join(", ");
}

export function splitAppearanceLabels(
  value: string | null | undefined
): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[,，]/)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

export function normalizeAppearanceRecords(value: unknown): AppearanceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: AppearanceRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as {
      name?: unknown;
      nameZh?: unknown;
      nameOriginal?: unknown;
      labels?: unknown;
      thumbUrl?: unknown;
      thumbTransform?: unknown;
      note?: unknown;
    };
    const rawNameZh =
      typeof record.nameZh === "string"
        ? record.nameZh.trim()
        : typeof record.name === "string"
          ? record.name.trim()
          : "";
    if (!rawNameZh) {
      continue;
    }
    const thumbUrl =
      typeof record.thumbUrl === "string" ? record.thumbUrl.trim() : "";
    const note =
      typeof record.note === "string" ? record.note.trim() : "";
    const nameOriginal =
      typeof record.nameOriginal === "string"
        ? record.nameOriginal.trim()
        : "";
    const labels =
      typeof record.labels === "string"
        ? normalizeAppearanceLabelString(record.labels)
        : "";
    const thumbTransform = normalizeThumbTransform(record.thumbTransform);

    result.push({
      nameZh: rawNameZh,
      nameOriginal: nameOriginal || null,
      labels: labels || null,
      thumbUrl: thumbUrl || null,
      thumbTransform,
      note: note || null,
    });
  }

  return result;
}

export function formatAppearanceLabels(value: string): string {
  if (!value.trim()) {
    return "";
  }
  return normalizeAppearanceLabelString(value);
}
