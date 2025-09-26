import { FirebaseError } from "firebase/app";
import {
  Timestamp,
  deleteField,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";

import { normalizeNoteTags } from "@/lib/note";

export const NOTE_TITLE_LIMIT = 100;
export const NOTE_DESCRIPTION_LIMIT = 300;
export const NOTE_CONTENT_LIMIT = 60000;
export const NOTE_MARKDOWN_LIMIT = 60000;
export const NOTE_MAX_TAGS = 500;
export const NOTE_MAX_TAG_LENGTH = 100;
export const NOTE_MAX_LINKED_TARGETS = 50;
export const NOTE_MAX_ID_LENGTH = 100;

function sanitizeIdList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is string => value.length > 0)
    )
  );
}

export type NoteFormInput = {
  title: string;
  description: string;
  contentHtml: string;
  markdownContent: string;
  plainTextContent: string;
  tags: string[];
  linkedCabinetIds: string[];
  linkedItemIds: string[];
};

export type SanitizedNoteSubmission = {
  title: string;
  description: string | null;
  contentHtml: string | null;
  markdownContent: string | null;
  tags: string[];
  linkedCabinetIds: string[];
  linkedItemIds: string[];
};

export type ValidationResult =
  | { ok: true; sanitized: SanitizedNoteSubmission }
  | { ok: false; error: string };

export function validateNoteSubmission(input: NoteFormInput): ValidationResult {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle) {
    return { ok: false, error: "請填寫筆記標題" };
  }
  if (trimmedTitle.length > NOTE_TITLE_LIMIT) {
    return { ok: false, error: `標題長度不可超過 ${NOTE_TITLE_LIMIT} 字` };
  }

  const trimmedDescription = input.description.trim();
  if (trimmedDescription.length > NOTE_DESCRIPTION_LIMIT) {
    return { ok: false, error: `備註長度不可超過 ${NOTE_DESCRIPTION_LIMIT} 字` };
  }

  const trimmedContentHtml = input.contentHtml.trim();
  const trimmedPlainText = input.plainTextContent.trim();
  const trimmedMarkdown = input.markdownContent.trim();

  if (!trimmedPlainText && !trimmedMarkdown) {
    return { ok: false, error: "請填寫筆記內容或 Markdown" };
  }

  if (trimmedContentHtml.length > NOTE_CONTENT_LIMIT) {
    return {
      ok: false,
      error: `筆記內容長度不可超過 ${NOTE_CONTENT_LIMIT} 字`,
    };
  }

  if (trimmedMarkdown.length > NOTE_MARKDOWN_LIMIT) {
    return {
      ok: false,
      error: `Markdown 內容長度不可超過 ${NOTE_MARKDOWN_LIMIT} 字`,
    };
  }

  const sanitizedTags = normalizeNoteTags(input.tags);
  if (sanitizedTags.length > NOTE_MAX_TAGS) {
    return { ok: false, error: `標籤數量不可超過 ${NOTE_MAX_TAGS} 個` };
  }
  if (sanitizedTags.some((tag) => tag.length > NOTE_MAX_TAG_LENGTH)) {
    return {
      ok: false,
      error: `標籤長度不可超過 ${NOTE_MAX_TAG_LENGTH} 字`,
    };
  }

  const sanitizedCabinetIds = sanitizeIdList(input.linkedCabinetIds);
  if (sanitizedCabinetIds.length > NOTE_MAX_LINKED_TARGETS) {
    return {
      ok: false,
      error: `連結的櫃子數量不可超過 ${NOTE_MAX_LINKED_TARGETS} 個`,
    };
  }
  if (sanitizedCabinetIds.some((id) => id.length > NOTE_MAX_ID_LENGTH)) {
    return { ok: false, error: "櫃子識別碼長度異常，請重新選擇" };
  }

  const sanitizedItemIds = sanitizeIdList(input.linkedItemIds);
  if (sanitizedItemIds.length > NOTE_MAX_LINKED_TARGETS) {
    return {
      ok: false,
      error: `連結的作品數量不可超過 ${NOTE_MAX_LINKED_TARGETS} 個`,
    };
  }
  if (sanitizedItemIds.some((id) => id.length > NOTE_MAX_ID_LENGTH)) {
    return { ok: false, error: "作品識別碼長度異常，請重新選擇" };
  }

  return {
    ok: true,
    sanitized: {
      title: trimmedTitle,
      description: trimmedDescription ? trimmedDescription : null,
      contentHtml: trimmedContentHtml ? trimmedContentHtml : null,
      markdownContent: trimmedMarkdown ? trimmedMarkdown : null,
      tags: sanitizedTags,
      linkedCabinetIds: sanitizedCabinetIds,
      linkedItemIds: sanitizedItemIds,
    },
  };
}

export function buildNoteCreatePayload(
  uid: string,
  sanitized: SanitizedNoteSubmission,
  isFavorite: boolean
): DocumentData {
  const payload: DocumentData = {
    uid,
    title: sanitized.title,
    tags: sanitized.tags,
    linkedCabinetIds: sanitized.linkedCabinetIds,
    linkedItemIds: sanitized.linkedItemIds,
    isFavorite,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (sanitized.description !== null) {
    payload.description = sanitized.description;
  }
  if (sanitized.contentHtml) {
    payload.content = sanitized.contentHtml;
  }
  if (sanitized.markdownContent) {
    payload.contentMarkdown = sanitized.markdownContent;
  }
  return payload;
}

export function buildNoteUpdatePayload(
  uid: string,
  sanitized: SanitizedNoteSubmission,
  isFavorite: boolean,
  options?: { existingCreatedAt?: Timestamp | null }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uid,
    title: sanitized.title,
    tags: sanitized.tags,
    linkedCabinetIds: sanitized.linkedCabinetIds,
    linkedItemIds: sanitized.linkedItemIds,
    isFavorite,
    updatedAt: serverTimestamp(),
  };

  if (sanitized.description !== null) {
    payload.description = sanitized.description;
  } else {
    payload.description = deleteField();
  }

  if (sanitized.contentHtml) {
    payload.content = sanitized.contentHtml;
  } else {
    payload.content = deleteField();
  }

  if (sanitized.markdownContent) {
    payload.contentMarkdown = sanitized.markdownContent;
  } else {
    payload.contentMarkdown = deleteField();
  }

  if (options?.existingCreatedAt instanceof Timestamp) {
    payload.createdAt = options.existingCreatedAt;
  }

  return payload;
}

export function buildFavoriteTogglePayload(
  uid: string,
  isFavorite: boolean,
  existingCreatedAt?: Timestamp | null
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uid,
    isFavorite,
    updatedAt: serverTimestamp(),
  };
  if (existingCreatedAt instanceof Timestamp) {
    payload.createdAt = existingCreatedAt;
  }
  return payload;
}

export function extractFirestoreErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof FirebaseError && err.code === "permission-denied") {
    return "沒有權限存取筆記，請確認登入狀態或 Firestore 規則設定。";
  }
  return fallback;
}
