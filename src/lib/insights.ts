import { formatAppearanceLabels } from "./appearances";
import {
  DEFAULT_THUMB_TRANSFORM,
  normalizeThumbTransform,
  prepareThumbTransform,
} from "./image-utils";
import type { InsightRecord, ThumbTransform } from "./types";

export type InsightEntry = {
  title: string;
  content: string;
  labels: string;
  thumbUrl: string;
  thumbTransform: ThumbTransform;
};

export function normalizeInsightEntries(value: unknown): InsightEntry[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed
      ? [
          {
            title: "",
            content: trimmed,
            labels: "",
            thumbUrl: "",
            thumbTransform: { ...DEFAULT_THUMB_TRANSFORM },
          },
        ]
      : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const entries: InsightEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as InsightRecord;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const content =
      typeof record.content === "string" ? record.content.trim() : "";
    const labels =
      typeof record.labels === "string"
        ? formatAppearanceLabels(record.labels)
        : "";
    const thumbUrl =
      typeof record.thumbUrl === "string" ? record.thumbUrl.trim() : "";
    const thumbTransform = normalizeThumbTransform(record.thumbTransform);
    if (!title && !content && !labels && !thumbUrl) {
      continue;
    }
    entries.push({
      title,
      content,
      labels,
      thumbUrl,
      thumbTransform,
    });
  }

  return entries;
}

export function buildInsightStorageList(
  entries: InsightEntry[]
): InsightRecord[] {
  return entries
    .map((entry) => {
      const title = entry.title.trim();
      const content = entry.content.trim();
      const labels = formatAppearanceLabels(entry.labels);
      const thumbUrl = entry.thumbUrl.trim();
      const thumbTransform = thumbUrl
        ? prepareThumbTransform(entry.thumbTransform)
        : null;
      if (!title && !content && !labels && !thumbUrl) {
        return null;
      }
      return {
        title: title || null,
        content: content || null,
        labels: labels || null,
        thumbUrl: thumbUrl || null,
        thumbTransform,
      } satisfies InsightRecord;
    })
    .filter((entry): entry is InsightRecord => entry !== null);
}
