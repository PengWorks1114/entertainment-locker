import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase";
import { calculateNextUpdateDate } from "@/lib/item-utils";
import {
  PROGRESS_TYPE_OPTIONS,
  type ItemRecord,
  type ProgressType,
} from "@/lib/types";

export type PrimaryProgressState = {
  id: string;
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | null;
  updatedAt?: Timestamp | null;
};

const progressTypeLabelMap = new Map(
  PROGRESS_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

function formatProgressValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shouldUseOrdinal(unit: string | null | undefined, type: ProgressType): boolean {
  if (!unit || unit.trim().length === 0) {
    return type === "chapter" || type === "episode";
  }
  const normalized = unit.replace(/\s+/g, "");
  return /^(話|集|頁|卷|冊|章|回|節|篇)$/u.test(normalized);
}

function formatListDisplay(primary: PrimaryProgressState | null, loading: boolean): string {
  if (loading) {
    return "主進度載入中…";
  }
  if (!primary) {
    return "尚未設定";
  }
  const valueText = formatProgressValue(primary.value);
  const unitText = primary.unit?.trim() ?? "";
  if (shouldUseOrdinal(primary.unit, primary.type)) {
    return unitText ? `第${valueText}${unitText}` : `第${valueText}`;
  }
  return unitText ? `${valueText}${unitText}` : valueText;
}

function formatSummary(primary: PrimaryProgressState | null, loading: boolean): string {
  if (loading) {
    return "主進度載入中…";
  }
  if (!primary) {
    return "尚未設定主進度";
  }
  const typeLabel = progressTypeLabelMap.get(primary.type) ?? primary.type;
  const valueText = formatProgressValue(primary.value);
  const unitText = primary.unit ? ` ${primary.unit}` : "";
  return `${primary.platform || "未命名平台"}｜${typeLabel} ${valueText}${unitText}`;
}

type StoreListener = (state: {
  primary: PrimaryProgressState | null;
  loading: boolean;
  error: string | null;
}) => void;

type StoreEntry = {
  primary: PrimaryProgressState | null;
  loading: boolean;
  error: string | null;
  listeners: Set<StoreListener>;
  unsubscribe?: () => void;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const STORE_CLEANUP_DELAY = 10000;

const primaryProgressStore = new Map<string, StoreEntry>();

function notifyStore(entry: StoreEntry) {
  const snapshot = {
    primary: entry.primary,
    loading: entry.loading,
    error: entry.error,
  } as const;
  entry.listeners.forEach((listener) => listener(snapshot));
}

function startSubscription(itemId: string, entry: StoreEntry) {
  if (entry.unsubscribe) {
    return;
  }
  entry.loading = true;
  notifyStore(entry);
  const db = getFirebaseDb();
  if (!db) {
    entry.error = "Firebase 尚未設定";
    entry.loading = false;
    notifyStore(entry);
    return;
  }
  const progressQuery = query(
    collection(db, "item", itemId, "progress"),
    where("isPrimary", "==", true),
    limit(1)
  );
  entry.unsubscribe = onSnapshot(
    progressQuery,
    (snap) => {
      if (snap.empty) {
        entry.primary = null;
      } else {
        const docSnap = snap.docs[0];
        const data = docSnap.data();
        const typeValue =
          typeof data.type === "string" && progressTypeLabelMap.has(data.type as ProgressType)
            ? (data.type as ProgressType)
            : "chapter";
        entry.primary = {
          id: docSnap.id,
          platform: typeof data.platform === "string" ? data.platform : "",
          type: typeValue,
          value:
            typeof data.value === "number" && Number.isFinite(data.value) ? data.value : 0,
          unit: typeof data.unit === "string" ? data.unit : null,
          updatedAt: data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
        } satisfies PrimaryProgressState;
      }
      entry.loading = false;
      entry.error = null;
      notifyStore(entry);
    },
    (err) => {
      console.error("載入主進度失敗", err);
      entry.error = "載入主進度失敗";
      entry.loading = false;
      notifyStore(entry);
    }
  );
}

function subscribeToPrimaryProgress(itemId: string, listener: StoreListener) {
  let entry = primaryProgressStore.get(itemId);
  if (!entry) {
    entry = {
      primary: null,
      loading: true,
      error: null,
      listeners: new Set(),
      unsubscribe: undefined,
      cleanupTimer: null,
    } satisfies StoreEntry;
    primaryProgressStore.set(itemId, entry);
  }
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
    entry.cleanupTimer = null;
  }
  entry.listeners.add(listener);
  listener({ primary: entry.primary, loading: entry.loading, error: entry.error });
  startSubscription(itemId, entry);
  return () => {
    const currentEntry = primaryProgressStore.get(itemId);
    if (!currentEntry) {
      return;
    }
    currentEntry.listeners.delete(listener);
    if (currentEntry.listeners.size === 0) {
      currentEntry.cleanupTimer = setTimeout(() => {
        const latest = primaryProgressStore.get(itemId);
        if (!latest || latest.listeners.size > 0) {
          return;
        }
        latest.unsubscribe?.();
        primaryProgressStore.delete(itemId);
      }, STORE_CLEANUP_DELAY);
    }
  };
}

export function usePrimaryProgress(item: ItemRecord) {
  const [primary, setPrimary] = useState<PrimaryProgressState | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToPrimaryProgress(item.id, ({ primary: next, loading: isLoading, error }) => {
      setPrimary(next);
      setLoading(isLoading);
      setLoadError(error);
    });
  }, [item.id]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 2500);
    return () => clearTimeout(timer);
  }, [success]);

  const summary = useMemo(() => formatSummary(primary, loading), [primary, loading]);
  const listDisplay = useMemo(() => formatListDisplay(primary, loading), [primary, loading]);

  const handleIncrement = useCallback(async () => {
    if (!primary) {
      setManualError("尚未設定主進度，請先在物件頁面新增並設定主進度。");
      return;
    }
    setManualError(null);
    setSuccess(null);
    setUpdating(true);
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }
      const batch = writeBatch(db);
      const progressRef = doc(db, "item", item.id, "progress", primary.id);
      batch.update(progressRef, {
        value: increment(1),
        updatedAt: serverTimestamp(),
      });
      const nextDate = calculateNextUpdateDate(item.updateFrequency ?? null);
      const itemRef = doc(db, "item", item.id);
      batch.update(itemRef, {
        updatedAt: serverTimestamp(),
        nextUpdateAt: nextDate ? Timestamp.fromDate(nextDate) : null,
      });
      await batch.commit();
      setSuccess("已更新主進度");
    } catch (err) {
      console.error("更新主進度時發生錯誤", err);
      setManualError("更新主進度時發生錯誤");
    } finally {
      setUpdating(false);
    }
  }, [primary, item.id, item.updateFrequency]);

  const combinedError = manualError ?? loadError;

  const handleSetError = useCallback((value: string | null) => {
    setManualError(value);
  }, []);

  return {
    primary,
    loading,
    summary,
    listDisplay,
    updating,
    error: combinedError,
    success,
    increment: handleIncrement,
    setError: handleSetError,
    setSuccess,
  };
}
