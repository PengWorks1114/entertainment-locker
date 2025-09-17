import {
  ITEM_STATUS_VALUES,
  PROGRESS_TYPE_VALUES,
  UPDATE_FREQUENCY_VALUES,
  type ItemLink,
  type ItemStatus,
  type ProgressType,
  type UpdateFrequency,
} from "./types";

export type AppearanceFormInput = {
  name?: string | undefined;
  thumbUrl?: string | undefined;
  note?: string | undefined;
};

export type AppearanceFormData = {
  name: string;
  thumbUrl?: string;
  note?: string;
};

export type ItemFormInput = {
  cabinetId: string;
  titleZh: string;
  titleAlt?: string | undefined;
  author?: string | undefined;
  tags?: string[] | undefined;
  links?: ItemLink[] | undefined;
  thumbUrl?: string | undefined;
  progressNote?: string | undefined;
  insightNote?: string | undefined;
  note?: string | undefined;
  appearances?: AppearanceFormInput[] | undefined;
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
  insightNote?: string;
  note?: string;
  appearances: AppearanceFormData[];
  rating?: number;
  status: ItemStatus;
  updateFrequency: UpdateFrequency | null;
  nextUpdateAt?: Date;
};

export type ProgressFormInput = {
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | undefined;
  note?: string | undefined;
  link?: string | undefined;
  isPrimary?: boolean | undefined;
};

export type ProgressFormData = {
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string;
  note?: string;
  link?: string;
  isPrimary: boolean;
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
    appearances: [],
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
    data.tags = Array.from(new Set(tags));
  }

  if (input.links) {
    if (!Array.isArray(input.links)) {
      throw new ValidationError("連結格式錯誤");
    }
    let hasPrimary = false;
    const links: ItemLink[] = input.links.map((link) => {
      const label = assertString(link.label, "連結標籤需為文字").trim();
      const url = assertString(link.url, "連結網址需為文字").trim();
      if (!label || !url) {
        throw new ValidationError("連結需同時填寫標籤與網址");
      }
      validateUrl(url, "請輸入有效的連結網址");
      const requestedPrimary = Boolean(link.isPrimary);
      const isPrimary = requestedPrimary && !hasPrimary;
      if (isPrimary) {
        hasPrimary = true;
      }
      return { label, url, isPrimary };
    });
    if (!hasPrimary && links.length > 0) {
      links[0] = { ...links[0], isPrimary: true };
    }
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

  if (input.insightNote) {
    const insightNote = assertString(input.insightNote, "心得/筆記格式錯誤").trim();
    if (insightNote) {
      data.insightNote = insightNote;
    }
  }

  if (input.note) {
    const note = assertString(input.note, "備註格式錯誤").trim();
    if (note) {
      data.note = note;
    }
  }

  if (input.appearances) {
    if (!Array.isArray(input.appearances)) {
      throw new ValidationError("登場列表格式錯誤");
    }
    const appearances: AppearanceFormData[] = [];
    input.appearances.forEach((entry, index) => {
      if (!entry) {
        return;
      }
      const record = entry as AppearanceFormInput;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const thumbUrl =
        typeof record.thumbUrl === "string" ? record.thumbUrl.trim() : "";
      const note = typeof record.note === "string" ? record.note.trim() : "";

      if (!name) {
        if (thumbUrl || note) {
          throw new ValidationError("登場物件需填寫名稱", {
            path: ["appearances", index, "name"],
            message: "登場物件需填寫名稱",
          });
        }
        return;
      }

      if (thumbUrl) {
        validateUrl(thumbUrl, "請輸入有效的登場物件縮圖網址");
      }

      appearances.push({
        name,
        thumbUrl: thumbUrl || undefined,
        note: note || undefined,
      });
    });
    data.appearances = appearances;
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

export function parseProgressForm(input: ProgressFormInput): ProgressFormData {
  const platform = assertString(input.platform, "平台必填").trim();
  if (!platform) {
    throw new ValidationError("平台必填");
  }

  const type = input.type;
  if (!PROGRESS_TYPE_VALUES.includes(type)) {
    throw new ValidationError("進度類型不在允許範圍");
  }

  if (!Number.isFinite(input.value)) {
    throw new ValidationError("進度數值需為數字");
  }
  const value = Number(input.value);
  if (value < 0) {
    throw new ValidationError("進度數值不可為負數");
  }

  const data: ProgressFormData = {
    platform,
    type,
    value,
    isPrimary: Boolean(input.isPrimary),
  };

  if (input.unit) {
    const unit = assertString(input.unit, "單位需為文字").trim();
    if (unit) {
      data.unit = unit;
    }
  }

  if (input.note) {
    const note = assertString(input.note, "備註需為文字").trim();
    if (note) {
      data.note = note;
    }
  }

  if (input.link) {
    const link = assertString(input.link, "連結需為文字").trim();
    if (link) {
      validateUrl(link, "請輸入有效的進度連結網址");
      data.link = link;
    }
  }

  return data;
}
