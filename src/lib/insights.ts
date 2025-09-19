import type { InsightRecord } from "./types";

export type InsightEntry = {
  title: string;
  content: string;
};

export function normalizeInsightEntries(value: unknown): InsightEntry[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [{ title: "", content: trimmed }] : [];
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
    if (!title && !content) {
      continue;
    }
    entries.push({ title, content });
  }

  return entries;
}

export function buildInsightStorageList(
  entries: InsightEntry[]
): InsightRecord[] {
  return entries
    .map((entry) => ({
      title: entry.title.trim() || null,
      content: entry.content.trim() || null,
    }))
    .filter((entry) => entry.title !== null || entry.content !== null);
}
