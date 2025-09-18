import type { Timestamp } from "firebase/firestore";

export const ITEM_STATUS_VALUES = [
  "planning",
  "in-progress",
  "completed",
  "on-hold",
  "dropped",
] as const;

export type ItemStatus = (typeof ITEM_STATUS_VALUES)[number];

export const ITEM_STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: "planning", label: "尚未發布" },
  { value: "in-progress", label: "連載中" },
  { value: "completed", label: "已完結" },
  { value: "on-hold", label: "停更" },
  { value: "dropped", label: "棄追" },
];

export const UPDATE_FREQUENCY_VALUES = [
  "weekly",
  "biweekly",
  "monthly",
  "irregular",
] as const;

export type UpdateFrequency = (typeof UPDATE_FREQUENCY_VALUES)[number];

export const UPDATE_FREQUENCY_OPTIONS: { value: UpdateFrequency; label: string }[] = [
  { value: "weekly", label: "每週" },
  { value: "biweekly", label: "雙週" },
  { value: "monthly", label: "每月" },
  { value: "irregular", label: "不定期" },
];

export const PROGRESS_TYPE_VALUES = [
  "chapter",
  "episode",
  "story",
  "percent",
  "page",
  "level",
] as const;

export type ProgressType = (typeof PROGRESS_TYPE_VALUES)[number];

export const PROGRESS_TYPE_OPTIONS: { value: ProgressType; label: string }[] = [
  { value: "chapter", label: "章節" },
  { value: "episode", label: "集數" },
  { value: "story", label: "話" },
  { value: "percent", label: "百分比" },
  { value: "page", label: "頁數" },
  { value: "level", label: "等級" },
];

export type ThumbTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type ItemLink = {
  label: string;
  url: string;
  isPrimary?: boolean;
};

export type AppearanceRecord = {
  nameZh: string;
  nameOriginal?: string | null;
  labels?: string | null;
  thumbUrl?: string | null;
  thumbTransform?: ThumbTransform | null;
  note?: string | null;
};

export type ItemRecord = {
  id: string;
  uid: string;
  cabinetId: string;
  titleZh: string;
  titleAlt?: string | null;
  author?: string | null;
  tags: string[];
  links: ItemLink[];
  thumbUrl?: string | null;
  thumbTransform?: ThumbTransform | null;
  isFavorite: boolean;
  progressNote?: string | null;
  insightNote?: string | null;
  note?: string | null;
  appearances: AppearanceRecord[];
  rating?: number | null;
  status: ItemStatus;
  updateFrequency?: UpdateFrequency | null;
  nextUpdateAt?: Timestamp | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

export type ProgressRecord = {
  id: string;
  itemId: string;
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | null;
  note?: string | null;
  link?: string | null;
  isPrimary: boolean;
  updatedAt?: Timestamp | null;
};
