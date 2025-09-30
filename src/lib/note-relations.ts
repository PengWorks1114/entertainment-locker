import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from "firebase/firestore";

import { fetchCabinetOptions, type CabinetOption } from "./cabinet-options";
import { getFirebaseDb } from "./firebase";

export const NOTE_RELATED_ITEM_LIMIT = 50;

export type NoteRelations = {
  cabinetId: string | null;
  itemId: string | null;
  relatedItemIds: string[];
};

export type ItemSummary = {
  id: string;
  title: string;
  cabinetId: string | null;
  isMissing?: boolean;
};

type ItemSummaryCacheEntry = {
  data: ItemSummary | null;
  fetchedAt: number;
};

type CabinetItemsCacheEntry = {
  data: ItemSummary[];
  fetchedAt: number;
};

const ITEM_SUMMARY_CACHE_TTL_MS = 60_000;
const CABINET_ITEMS_CACHE_TTL_MS = 60_000;

const itemSummaryCache = new Map<string, ItemSummaryCacheEntry>();
const itemSummaryPending = new Map<string, Promise<ItemSummary | null>>();
const cabinetItemsCache = new Map<string, CabinetItemsCacheEntry>();
const cabinetItemsPending = new Map<string, Promise<ItemSummary[]>>();

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeNoteRelations(
  data: Record<string, unknown> | null | undefined
): NoteRelations {
  const cabinetId = normalizeId(data?.cabinetId);
  const itemId = normalizeId(data?.itemId);
  const relatedSource = Array.isArray(data?.relatedItemIds)
    ? (data!.relatedItemIds as unknown[])
    : [];
  const unique = new Set<string>();
  const relatedItemIds: string[] = [];
  if (itemId) {
    unique.add(itemId);
    relatedItemIds.push(itemId);
  }
  for (const entry of relatedSource) {
    const normalized = normalizeId(entry);
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
    relatedItemIds.push(normalized);
    if (relatedItemIds.length >= NOTE_RELATED_ITEM_LIMIT) {
      break;
    }
  }
  return {
    cabinetId,
    itemId,
    relatedItemIds,
  };
}

function shouldUseCache(entry: ItemSummaryCacheEntry | CabinetItemsCacheEntry, ttl: number): boolean {
  return Date.now() - entry.fetchedAt < ttl;
}

async function ensureDb(): Promise<Firestore> {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase 尚未設定");
  }
  return db;
}

function buildItemSummary(data: Record<string, unknown>, id: string): ItemSummary {
  const titleZh = typeof data.titleZh === "string" ? data.titleZh.trim() : "";
  const titleAlt = typeof data.titleAlt === "string" ? data.titleAlt.trim() : "";
  const title = titleZh || titleAlt || "(未命名物件)";
  const cabinetId = normalizeId(data.cabinetId);
  return { id, title, cabinetId } satisfies ItemSummary;
}

async function loadItemSummary(userId: string, itemId: string): Promise<ItemSummary | null> {
  const cached = itemSummaryCache.get(itemId);
  if (cached && shouldUseCache(cached, ITEM_SUMMARY_CACHE_TTL_MS)) {
    return cached.data;
  }
  const pending = itemSummaryPending.get(itemId);
  if (pending) {
    return pending;
  }
  const request = (async () => {
    try {
      const db = await ensureDb();
      const snap = await getDoc(doc(db, "item", itemId));
      if (!snap.exists()) {
        return null;
      }
      const data = snap.data();
      if (!data || data.uid !== userId) {
        return null;
      }
      const summary = buildItemSummary(data as Record<string, unknown>, itemId);
      return summary;
    } catch (err) {
      console.error("載入作品摘要時發生錯誤", err);
      return null;
    }
  })();
  itemSummaryPending.set(itemId, request);
  try {
    const data = await request;
    itemSummaryCache.set(itemId, { data, fetchedAt: Date.now() });
    return data;
  } finally {
    itemSummaryPending.delete(itemId);
  }
}

export async function loadItemSummaries(
  userId: string,
  itemIds: string[]
): Promise<Map<string, ItemSummary | null>> {
  const uniqueIds = Array.from(new Set(itemIds.map((id) => normalizeId(id)).filter(Boolean))) as string[];
  const results = new Map<string, ItemSummary | null>();
  await Promise.all(
    uniqueIds.map(async (id) => {
      const summary = await loadItemSummary(userId, id);
      results.set(id, summary);
    })
  );
  return results;
}

export function primeItemSummaryCache(items: ItemSummary[]): void {
  const now = Date.now();
  items.forEach((item) => {
    itemSummaryCache.set(item.id, { data: item, fetchedAt: now });
  });
}

export async function fetchCabinetItemSummaries(
  userId: string,
  cabinetId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<ItemSummary[]> {
  const cacheKey = `${userId}__${cabinetId}`;
  const cached = cabinetItemsCache.get(cacheKey);
  if (!options.forceRefresh && cached && shouldUseCache(cached, CABINET_ITEMS_CACHE_TTL_MS)) {
    return cached.data;
  }
  if (!options.forceRefresh) {
    const pending = cabinetItemsPending.get(cacheKey);
    if (pending) {
      return pending;
    }
  }
  const request = (async () => {
    try {
      const db = await ensureDb();
      const q = query(
        collection(db, "item"),
        where("uid", "==", userId),
        where("cabinetId", "==", cabinetId)
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        return buildItemSummary(data, docSnap.id);
      });
      rows.sort((a, b) => a.title.localeCompare(b.title, "zh-Hant", { sensitivity: "base" }));
      primeItemSummaryCache(rows);
      return rows;
    } catch (err) {
      console.error("載入櫃內作品列表時發生錯誤", err);
      throw err;
    }
  })();
  cabinetItemsPending.set(cacheKey, request);
  try {
    const data = await request;
    cabinetItemsCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } finally {
    cabinetItemsPending.delete(cacheKey);
  }
}

export async function resolveCabinetMap(userId: string): Promise<Map<string, CabinetOption>> {
  const options = await fetchCabinetOptions(userId);
  const map = new Map<string, CabinetOption>();
  options.forEach((option) => {
    map.set(option.id, option);
  });
  return map;
}

export function buildItemListFromSummaries(
  ids: string[],
  summaries: Map<string, ItemSummary | null>
): ItemSummary[] {
  const results: ItemSummary[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.trim().length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const summary = summaries.get(id);
    if (summary) {
      results.push(summary);
    } else {
      results.push({ id, title: "(找不到作品)", cabinetId: null, isMissing: true });
    }
  }
  return results;
}

export function describeCabinet(
  cabinetId: string | null,
  cabinetMap: Map<string, CabinetOption>
): { name: string; isLocked: boolean; missing: boolean } {
  if (!cabinetId) {
    return { name: "未指定", isLocked: false, missing: false };
  }
  const record = cabinetMap.get(cabinetId);
  if (!record) {
    return { name: "(找不到櫃子)", isLocked: false, missing: true };
  }
  const name = record.name || "未命名櫃子";
  return { name, isLocked: record.isLocked, missing: false };
}

