import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";

import { getFirebaseDb } from "./firebase";

export type CabinetOption = { id: string; name: string; isLocked: boolean };

type CacheEntry = {
  data: CabinetOption[];
  fetchedAt: number;
};

const CABINET_CACHE_TTL_MS = 60_000;
const dataCache = new Map<string, CacheEntry>();
const pendingCache = new Map<string, Promise<CabinetOption[]>>();

function shouldUseCache(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CABINET_CACHE_TTL_MS;
}

function sortCabinetOptions(
  rows: Array<{ id: string; name: string; order: number; createdMs: number; isLocked: boolean }>
): CabinetOption[] {
  return rows
    .sort((a, b) => {
      if (a.order === b.order) {
        return b.createdMs - a.createdMs;
      }
      return b.order - a.order;
    })
    .map((item) => ({ id: item.id, name: item.name, isLocked: item.isLocked }));
}

async function loadCabinetOptionsFromFirestore(userId: string): Promise<CabinetOption[]> {
  const db = getFirebaseDb();
  if (!db) {
    throw new Error("Firebase 尚未設定");
  }
  const col = collection(db, "cabinet");
  const q = query(col, where("uid", "==", userId));
  const snap = await getDocs(q);
  const rows = snap.docs.map((docSnap) => {
    const data = docSnap.data();
    const createdAt = data?.createdAt;
    const createdMs = createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
    const orderValue = typeof data?.order === "number" ? data.order : createdMs;
    return {
      id: docSnap.id,
      name: (data?.name as string) ?? "",
      createdMs,
      order: orderValue,
      isLocked: Boolean(data?.isLocked),
    };
  });
  return sortCabinetOptions(rows);
}

export async function fetchCabinetOptions(
  userId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<CabinetOption[]> {
  if (!userId) {
    return [];
  }
  const forceRefresh = options.forceRefresh === true;
  const cached = dataCache.get(userId);
  if (!forceRefresh && cached && shouldUseCache(cached)) {
    return cached.data;
  }
  if (!forceRefresh) {
    const pending = pendingCache.get(userId);
    if (pending) {
      return pending;
    }
  }
  const request = loadCabinetOptionsFromFirestore(userId);
  pendingCache.set(userId, request);
  try {
    const data = await request;
    dataCache.set(userId, { data, fetchedAt: Date.now() });
    return data;
  } finally {
    pendingCache.delete(userId);
  }
}

export function primeCabinetOptionsCache(userId: string, options: CabinetOption[]): void {
  if (!userId) {
    return;
  }
  dataCache.set(userId, { data: options, fetchedAt: Date.now() });
}

export function invalidateCabinetOptions(userId?: string): void {
  if (userId) {
    dataCache.delete(userId);
    pendingCache.delete(userId);
    return;
  }
  dataCache.clear();
  pendingCache.clear();
}
