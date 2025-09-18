"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase";
import type { ItemRecord } from "@/lib/types";

type UseFavoriteToggleOptions = {
  onSuccess?: (nextValue: boolean) => void;
};

export function useFavoriteToggle(
  item: ItemRecord,
  options?: UseFavoriteToggleOptions
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccess = options?.onSuccess;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  const toggleFavorite = useCallback(async () => {
    if (pending) return;
    const db = getFirebaseDb();
    if (!db) {
      setError("Firebase 尚未設定");
      return;
    }
    const nextValue = !item.isFavorite;
    setPending(true);
    setError(null);
    try {
      await updateDoc(doc(db, "item", item.id), {
        isFavorite: nextValue,
        updatedAt: serverTimestamp(),
      });
      onSuccess?.(nextValue);
    } catch (err) {
      console.error("更新最愛狀態時發生錯誤", err);
      setError("更新最愛狀態時發生錯誤");
    } finally {
      setPending(false);
    }
  }, [item.id, item.isFavorite, onSuccess, pending]);

  return {
    toggleFavorite,
    pending,
    error,
    clearError: () => setError(null),
  };
}

