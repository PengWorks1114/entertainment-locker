export const NOTE_CATEGORY_OPTIONS = [
  { value: "general", label: "一般筆記" },
  { value: "progress", label: "進度心得" },
  { value: "insight", label: "觀後感" },
  { value: "reference", label: "資料整理" },
] as const;

export type NoteCategory = (typeof NOTE_CATEGORY_OPTIONS)[number]["value"];

export const NOTE_TAG_LIMIT = 20;
