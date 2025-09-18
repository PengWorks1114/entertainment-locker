import { normalizeThumbTransform } from "./image-utils";
import type { AppearanceRecord } from "./types";

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
      thumbUrl?: unknown;
      thumbTransform?: unknown;
      note?: unknown;
    };
    const name =
      typeof record.name === "string" ? record.name.trim() : "";
    if (!name) {
      continue;
    }
    const thumbUrl =
      typeof record.thumbUrl === "string" ? record.thumbUrl.trim() : "";
    const note =
      typeof record.note === "string" ? record.note.trim() : "";
    const thumbTransform = normalizeThumbTransform(record.thumbTransform);

    result.push({
      name,
      thumbUrl: thumbUrl || null,
      thumbTransform,
      note: note || null,
    });
  }

  return result;
}
