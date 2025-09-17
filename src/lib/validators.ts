import {
  ITEM_STATUS_VALUES,
  UPDATE_FREQUENCY_VALUES,
  type ItemLink,
  type ItemStatus,
  type UpdateFrequency,
} from "./types";

export type ItemFormInput = {
  cabinetId: string;
  titleZh: string;
  titleAlt?: string | undefined;
  author?: string | undefined;
  tags?: string[] | undefined;
  links?: ItemLink[] | undefined;
  thumbUrl?: string | undefined;
  progressNote?: string | undefined;
  note?: string | undefined;
  rating?: number | null | undefined;
  status: ItemStatus;
  updateFrequency: UpdateFrequency | null;
  nextUpdateAt?: Date | null | undefined;
};

export type ItemFormData = {
  cabinetId: string;
  titleZh: string;
  titleAlt?: string;
  author?: string;
  tags: string[];
  links: ItemLink[];
  thumbUrl?: string;
  progressNote?: string;
  note?: string;
  rating?: number;
  status: ItemStatus;
  updateFrequency: UpdateFrequency | null;
  nextUpdateAt?: Date;
};

export type ValidationIssue = {
  path?: (string | number)[];
  message: string;
};

export class ValidationError extends Error {
  issues: ValidationIssue[];

  constructor(message: string, issue: ValidationIssue = { message }) {
    super(message);
    this.name = "ValidationError";
    this.issues = [issue];
  }
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(message);
  }
  return value;
}

function validateUrl(value: string, message: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ValidationError(message);
    }
    return value;
  } catch {
    throw new ValidationError(message);
  }
}

export function parseItemForm(input: ItemFormInput): ItemFormData {
  const titleZh = assertString(input.titleZh, "中文標題必填").trim();
  if (!titleZh) {
    throw new ValidationError("中文標題必填");
  }

  const cabinetId = assertString(input.cabinetId, "請選擇櫃子").trim();
  if (!cabinetId) {
    throw new ValidationError("請選擇櫃子");
  }

  const status = input.status;
  if (!ITEM_STATUS_VALUES.includes(status)) {
    throw new ValidationError("狀態值不在允許範圍");
  }

  const updateFrequency = input.updateFrequency;
  if (
    updateFrequency !== null &&
    !UPDATE_FREQUENCY_VALUES.includes(updateFrequency)
  ) {
    throw new ValidationError("更新頻率值不在允許範圍");
  }

  const data: ItemFormData = {
    cabinetId,
    titleZh,
    status,
    updateFrequency,
    tags: [],
    links: [],
  };

  if (input.titleAlt) {
    const titleAlt = assertString(input.titleAlt, "標題格式錯誤").trim();
    if (titleAlt) {
      data.titleAlt = titleAlt;
    }
  }

  if (input.author) {
    const author = assertString(input.author, "作者格式錯誤").trim();
    if (author) {
      data.author = author;
    }
  }

  if (input.tags) {
    if (!Array.isArray(input.tags)) {
      throw new ValidationError("標籤格式錯誤");
    }
    const tags = input.tags
      .map((tag) => assertString(tag, "標籤需為文字").trim())
      .filter(Boolean);
    data.tags = tags;
  }

  if (input.links) {
    if (!Array.isArray(input.links)) {
      throw new ValidationError("連結格式錯誤");
    }
    const links: ItemLink[] = input.links.map((link) => {
      const label = assertString(link.label, "連結標籤需為文字").trim();
      const url = assertString(link.url, "連結網址需為文字").trim();
      if (!label || !url) {
        throw new ValidationError("連結需同時填寫標籤與網址");
      }
      validateUrl(url, "請輸入有效的連結網址");
      return { label, url };
    });
    data.links = links;
  }

  if (input.thumbUrl) {
    const thumbUrl = assertString(input.thumbUrl, "縮圖網址格式錯誤").trim();
    if (thumbUrl) {
      validateUrl(thumbUrl, "請輸入有效的縮圖網址");
      data.thumbUrl = thumbUrl;
    }
  }

  if (input.progressNote) {
    const progressNote = assertString(input.progressNote, "進度備註格式錯誤").trim();
    if (progressNote) {
      data.progressNote = progressNote;
    }
  }

  if (input.note) {
    const note = assertString(input.note, "備註格式錯誤").trim();
    if (note) {
      data.note = note;
    }
  }

  if (input.rating !== undefined && input.rating !== null) {
    const rating = Number(input.rating);
    if (Number.isNaN(rating)) {
      throw new ValidationError("評分需為數字");
    }
    if (rating < 0 || rating > 10) {
      throw new ValidationError("評分需介於 0 至 10 之間");
    }
    data.rating = rating;
  }

  if (input.nextUpdateAt) {
    if (!(input.nextUpdateAt instanceof Date) || Number.isNaN(input.nextUpdateAt.getTime())) {
      throw new ValidationError("下次更新時間格式錯誤");
    }
    data.nextUpdateAt = input.nextUpdateAt;
  }

  return data;
}
