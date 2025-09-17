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

export function usePrimaryProgress(item: ItemRecord) {
  const [primary, setPrimary] = useState<PrimaryProgressState | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const db = getFirebaseDb();
    const progressQuery = query(
      collection(db, "item", item.id, "progress"),
      where("isPrimary", "==", true),
      limit(1)
    );
    const unsub = onSnapshot(
      progressQuery,
      (snap) => {
        if (snap.empty) {
          setPrimary(null);
        } else {
          const docSnap = snap.docs[0];
          const data = docSnap.data();
          const typeValue =
            typeof data.type === "string" && progressTypeLabelMap.has(data.type as ProgressType)
              ? (data.type as ProgressType)
              : "chapter";
          setPrimary({
            id: docSnap.id,
            platform: typeof data.platform === "string" ? data.platform : "",
            type: typeValue,
            value:
              typeof data.value === "number" && Number.isFinite(data.value) ? data.value : 0,
            unit: typeof data.unit === "string" ? data.unit : null,
            updatedAt: data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
          });
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("載入主進度失敗", err);
        setError("載入主進度失敗");
        setLoading(false);
      }
    );
    return () => unsub();
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
      setError("尚未設定主進度，請先在物件頁面新增並設定主進度。");
      return;
    }
    setError(null);
    setSuccess(null);
    setUpdating(true);
    try {
      const db = getFirebaseDb();
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
      setError("更新主進度時發生錯誤");
    } finally {
      setUpdating(false);
    }
  }, [primary, item.id, item.updateFrequency]);

  return {
    primary,
    loading,
    summary,
    listDisplay,
    updating,
    error,
    success,
    increment: handleIncrement,
    setError,
    setSuccess,
  };
}
