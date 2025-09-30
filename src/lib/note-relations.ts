import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";

import { getFirebaseDb } from "./firebase";

export const NOTE_RELATED_CABINET_LIMIT = 20;
export const NOTE_RELATED_ITEM_LIMIT = 50;
const NOTE_RELATION_ID_MAX_LENGTH = 64;
const CACHE_TTL_MS = 60_000;

export type NoteItemSummary = {
  id: string;
  title: string;
  cabinetId: string | null;
};

type ItemCacheEntry = {
  data: NoteItemSummary[];
  fetchedAt: number;
};

type ItemByIdCacheEntry = {
  data: NoteItemSummary;
  fetchedAt: number;
};

const itemsByCabinetCache = new Map<string, ItemCacheEntry>();
const pendingCabinetCache = new Map<string, Promise<NoteItemSummary[]>>();
const itemsByIdCache = new Map<string, ItemByIdCacheEntry>();
const pendingItemIdsCache = new Map<string, Promise<NoteItemSummary | null>>();

function now(): number {
  return Date.now();
}

function buildCabinetCacheKey(userId: string, cabinetId: string): string {
  return `${userId}::${cabinetId}`;
}

function shouldUseCabinetCache(entry: ItemCacheEntry): boolean {
  return now() - entry.fetchedAt < CACHE_TTL_MS;
}

function shouldUseItemCache(entry: ItemByIdCacheEntry): boolean {
  return now() - entry.fetchedAt < CACHE_TTL_MS;
}

function resolveItemTitle(data: Record<string, unknown>): string {
  const zh = typeof data.titleZh === "string" ? data.titleZh.trim() : "";
  const alt = typeof data.titleAlt === "string" ? data.titleAlt.trim() : "";
  if (zh) return zh;
  if (alt) return alt;
  return "(未命名作品)";
}

function mapItemSummary(docId: string, data: Record<string, unknown>): NoteItemSummary {
  const cabinetId = typeof data.cabinetId === "string" ? data.cabinetId.trim() : "";
  const trimmedCabinetId = cabinetId ? cabinetId : null;
  return {
    id: docId,
    title: resolveItemTitle(data),
    cabinetId: trimmedCabinetId,
  } satisfies NoteItemSummary;
}

async function ensureDb(): Promise<Firestore> {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase 尚未設定");
  }
  return db;
}

export function normalizeRelationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || trimmed.length > NOTE_RELATION_ID_MAX_LENGTH) {
      continue;
    }
    if (!result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

export function mergeLegacyRelationId(
  primary: unknown,
  related: string[]
): string[] {
  if (typeof primary !== "string") {
    return related;
  }
  const trimmed = primary.trim();
  if (!trimmed || trimmed.length > NOTE_RELATION_ID_MAX_LENGTH) {
    return related;
  }
  if (related.includes(trimmed)) {
    return related;
  }
  return [trimmed, ...related];
}

export function limitRelationIds(ids: string[], limit: number): string[] {
  if (ids.length <= limit) {
    return ids;
  }
  return ids.slice(0, limit);
}

async function loadItemsByCabinet(
  userId: string,
  cabinetId: string
): Promise<NoteItemSummary[]> {
  const db = await ensureDb();
  const col = collection(db, "item");
  const q = query(col, where("uid", "==", userId), where("cabinetId", "==", cabinetId));
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((docSnap) => mapItemSummary(docSnap.id, docSnap.data()))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant", { sensitivity: "base" }));
  itemsByCabinetCache.set(buildCabinetCacheKey(userId, cabinetId), {
    data: rows,
    fetchedAt: now(),
  });
  const timestamp = now();
  for (const row of rows) {
    itemsByIdCache.set(row.id, { data: row, fetchedAt: timestamp });
  }
  return rows;
}

export async function fetchItemSummariesByCabinet(
  userId: string,
  cabinetId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<NoteItemSummary[]> {
  if (!userId || !cabinetId) {
    return [];
  }
  const forceRefresh = options.forceRefresh === true;
  const cacheKey = buildCabinetCacheKey(userId, cabinetId);
  const cached = itemsByCabinetCache.get(cacheKey);
  if (!forceRefresh && cached && shouldUseCabinetCache(cached)) {
    return cached.data;
  }
  if (!forceRefresh) {
    const pending = pendingCabinetCache.get(cacheKey);
    if (pending) {
      return pending;
    }
  }
  const request = loadItemsByCabinet(userId, cabinetId);
  pendingCabinetCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    pendingCabinetCache.delete(cacheKey);
  }
}

async function loadItemById(userId: string, itemId: string): Promise<NoteItemSummary | null> {
  const db = await ensureDb();
  const itemRef = doc(db, "item", itemId);
  const snap = await getDoc(itemRef);
  if (!snap.exists()) {
    return null;
  }
  const data = snap.data();
  if (typeof data?.uid !== "string" || data.uid !== userId) {
    return null;
  }
  const summary = mapItemSummary(snap.id, data);
  itemsByIdCache.set(itemId, { data: summary, fetchedAt: now() });
  return summary;
}

export async function fetchItemSummariesByIds(
  userId: string,
  itemIds: string[]
): Promise<NoteItemSummary[]> {
  if (!userId || itemIds.length === 0) {
    return [];
  }
  const uniqueIds = Array.from(new Set(itemIds.filter((id) => typeof id === "string" && id)));
  const results: NoteItemSummary[] = [];
  const missing: string[] = [];
  const currentTimestamp = now();
  for (const id of uniqueIds) {
    const cached = itemsByIdCache.get(id);
    if (cached && shouldUseItemCache(cached)) {
      results.push(cached.data);
    } else {
      missing.push(id);
    }
  }
  for (const id of missing) {
    const pending = pendingItemIdsCache.get(id);
    if (pending) {
      try {
        const summary = await pending;
        if (summary) {
          results.push(summary);
        }
      } catch {
        // 忽略單筆錯誤，改由後續重新嘗試
      }
      continue;
    }
    const request = loadItemById(userId, id);
    pendingItemIdsCache.set(id, request);
    try {
      const summary = await request;
      if (summary) {
        results.push(summary);
      }
    } finally {
      pendingItemIdsCache.delete(id);
    }
  }
  // 更新快取時間避免下次立即刷新
  for (const summary of results) {
    itemsByIdCache.set(summary.id, { data: summary, fetchedAt: currentTimestamp });
  }
  return results;
}

export function primeItemSummaryCache(items: NoteItemSummary[]): void {
  const timestamp = now();
  for (const item of items) {
    itemsByIdCache.set(item.id, { data: item, fetchedAt: timestamp });
  }
}

export function invalidateItemSummaryCache(): void {
  itemsByCabinetCache.clear();
  pendingCabinetCache.clear();
  itemsByIdCache.clear();
  pendingItemIdsCache.clear();
}
