"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase";

const UNCATEGORIZED_KEY = "__uncategorized__";

export type LinkTargetSelectorProps = {
  userId: string | null;
  selectedCabinetIds: string[];
  onCabinetIdsChange: (ids: string[]) => void;
  selectedItemIds: string[];
  onItemIdsChange: (ids: string[]) => void;
  onError?: (message: string) => void;
};

type CabinetOption = {
  id: string;
  name: string;
};

type ItemOption = {
  id: string;
  title: string;
  cabinetId: string | null;
};

type ItemCache = Record<string, ItemOption[]>;

type ItemLookup = Record<string, ItemOption>;

type StatusMessage = {
  type: "idle" | "loading" | "error";
  message: string | null;
};

function normalizeCabinetName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || "未命名櫃子";
}

function normalizeItemTitle(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || "未命名作品";
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export default function LinkTargetSelector({
  userId,
  selectedCabinetIds,
  onCabinetIdsChange,
  selectedItemIds,
  onItemIdsChange,
  onError,
}: LinkTargetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [cabinetSearch, setCabinetSearch] = useState("");
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [cabinetStatus, setCabinetStatus] = useState<StatusMessage>({
    type: "idle",
    message: null,
  });
  const [activeCabinetForItems, setActiveCabinetForItems] = useState<string | null>(
    null
  );
  const [itemSearch, setItemSearch] = useState("");
  const [itemStatus, setItemStatus] = useState<StatusMessage>({
    type: "idle",
    message: null,
  });
  const [itemCache, setItemCache] = useState<ItemCache>({});
  const [itemLookup, setItemLookup] = useState<ItemLookup>({});

  const cabinetMap = useMemo(() => {
    const entries = cabinetOptions.map((option) => [option.id, option] as const);
    return new Map(entries);
  }, [cabinetOptions]);

  useEffect(() => {
    setCabinetSearch("");
    setItemSearch("");
    setActiveCabinetForItems(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!userId) {
      setCabinetOptions([]);
      setCabinetStatus({
        type: "error",
        message: "請先登入後再選擇連結目標",
      });
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setCabinetOptions([]);
      setCabinetStatus({
        type: "error",
        message: "Firebase 尚未設定",
      });
      return;
    }
    setCabinetStatus({ type: "loading", message: null });
    const cabinetQuery = query(
      collection(db, "cabinet"),
      where("uid", "==", userId)
    );
    const unsubscribe = onSnapshot(
      cabinetQuery,
      (snapshot) => {
        const next = snapshot.docs
          .map((docSnap) => ({
            id: docSnap.id,
            name: normalizeCabinetName(docSnap.data()?.name),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
        setCabinetOptions(next);
        setCabinetStatus({ type: "idle", message: null });
      },
      (error) => {
        console.error("載入櫃子清單時發生錯誤", error);
        const message = "載入櫃子清單時發生錯誤";
        setCabinetStatus({ type: "error", message });
        onError?.(message);
      }
    );
    return () => unsubscribe();
  }, [onError, open, userId]);

  useEffect(() => {
    if (cabinetOptions.length === 0) {
      return;
    }
    const filteredIds = selectedCabinetIds.filter((id) => cabinetMap.has(id));
    if (filteredIds.length !== selectedCabinetIds.length) {
      onCabinetIdsChange(filteredIds);
    }
  }, [cabinetMap, cabinetOptions.length, onCabinetIdsChange, selectedCabinetIds]);

  const visibleCabinets = useMemo(() => {
    const keyword = cabinetSearch.trim().toLowerCase();
    if (!keyword) {
      return cabinetOptions;
    }
    return cabinetOptions.filter((option) =>
      option.name.toLowerCase().includes(keyword)
    );
  }, [cabinetOptions, cabinetSearch]);

  const activeCabinetLabel = useMemo(() => {
    if (!activeCabinetForItems) {
      return "";
    }
    if (activeCabinetForItems === UNCATEGORIZED_KEY) {
      return "未分類作品";
    }
    return cabinetMap.get(activeCabinetForItems)?.name ?? "";
  }, [activeCabinetForItems, cabinetMap]);

  const selectedCabinets = useMemo(() => {
    return selectedCabinetIds
      .map((id) => cabinetMap.get(id))
      .filter((option): option is CabinetOption => Boolean(option));
  }, [cabinetMap, selectedCabinetIds]);

  const selectedItems = useMemo(() => {
    return selectedItemIds
      .map((id) => itemLookup[id])
      .filter((option): option is ItemOption => Boolean(option));
  }, [itemLookup, selectedItemIds]);

  const filteredItemsForActiveCabinet = useMemo(() => {
    if (!activeCabinetForItems) {
      return [] as ItemOption[];
    }
    const bucketKey = activeCabinetForItems;
    const base = itemCache[bucketKey] ?? [];
    const keyword = itemSearch.trim().toLowerCase();
    if (!keyword) {
      return base;
    }
    return base.filter((option) =>
      option.title.toLowerCase().includes(keyword)
    );
  }, [activeCabinetForItems, itemCache, itemSearch]);

  const ensureItemLookup = useCallback(
    async (itemId: string) => {
      if (!userId) {
        return;
      }
      if (itemLookup[itemId]) {
        return;
      }
      const db = getFirebaseDb();
      if (!db) {
        return;
      }
      try {
        const snap = await getDoc(doc(db, "item", itemId));
        if (!snap.exists()) {
          onItemIdsChange(selectedItemIds.filter((id) => id !== itemId));
          return;
        }
        const data = snap.data();
        if (data?.uid !== userId) {
          onItemIdsChange(selectedItemIds.filter((id) => id !== itemId));
          return;
        }
        const option: ItemOption = {
          id: snap.id,
          title: normalizeItemTitle(data?.titleZh),
          cabinetId:
            typeof data?.cabinetId === "string" && data.cabinetId.trim().length > 0
              ? data.cabinetId
              : null,
        };
        setItemLookup((prev) => ({ ...prev, [option.id]: option }));
        const cacheKey = option.cabinetId ?? UNCATEGORIZED_KEY;
        setItemCache((prev) => {
          const existing = prev[cacheKey] ?? [];
          if (existing.some((item) => item.id === option.id)) {
            return prev;
          }
          const next = [...existing, option].sort((a, b) =>
            a.title.localeCompare(b.title, "zh-Hant")
          );
          return { ...prev, [cacheKey]: next };
        });
      } catch (error) {
        console.error("載入作品資訊時發生錯誤", error);
      }
    },
    [onItemIdsChange, selectedItemIds, itemLookup, userId]
  );

  useEffect(() => {
    selectedItemIds.forEach((id) => {
      void ensureItemLookup(id);
    });
  }, [ensureItemLookup, selectedItemIds]);

  const loadItemsForCabinet = useCallback(
    async (cabinetId: string) => {
      if (!userId) {
        setItemStatus({
          type: "error",
          message: "請先登入後再載入作品",
        });
        return;
      }
      if (itemCache[cabinetId]) {
        setItemStatus({ type: "idle", message: null });
        return;
      }
      const db = getFirebaseDb();
      if (!db) {
        setItemStatus({
          type: "error",
          message: "Firebase 尚未設定",
        });
        return;
      }
      setItemStatus({ type: "loading", message: null });
      try {
        const constraints = [where("uid", "==", userId)];
        if (cabinetId === UNCATEGORIZED_KEY) {
          constraints.push(where("cabinetId", "==", null));
        } else {
          constraints.push(where("cabinetId", "==", cabinetId));
        }
        const itemQuery = query(collection(db, "item"), ...constraints);
        const snapshot = await getDocs(itemQuery);
        const items = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              title: normalizeItemTitle(data?.titleZh),
              cabinetId:
                typeof data?.cabinetId === "string" &&
                data.cabinetId.trim().length > 0
                  ? data.cabinetId
                  : null,
            } satisfies ItemOption;
          })
          .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"));
        setItemCache((prev) => ({ ...prev, [cabinetId]: items }));
        setItemLookup((prev) => {
          if (items.length === 0) {
            return prev;
          }
          const next: ItemLookup = { ...prev };
          items.forEach((item) => {
            next[item.id] = item;
          });
          return next;
        });
        setItemStatus({ type: "idle", message: null });
      } catch (error) {
        console.error("載入作品清單時發生錯誤", error);
        const message = "載入作品清單時發生錯誤";
        setItemStatus({ type: "error", message });
        onError?.(message);
      }
    },
    [itemCache, onError, userId]
  );

  useEffect(() => {
    if (!activeCabinetForItems) {
      return;
    }
    void loadItemsForCabinet(activeCabinetForItems);
  }, [activeCabinetForItems, loadItemsForCabinet]);

  const combinedCabinetOptions = useMemo(() => {
    const base = cabinetOptions;
    return base;
  }, [cabinetOptions]);

  function toggleCabinet(id: string) {
    const next = selectedCabinetIds.includes(id)
      ? selectedCabinetIds.filter((value) => value !== id)
      : [...selectedCabinetIds, id];
    onCabinetIdsChange(uniqueSorted(next));
  }

  function toggleItem(id: string) {
    const next = selectedItemIds.includes(id)
      ? selectedItemIds.filter((value) => value !== id)
      : [...selectedItemIds, id];
    onItemIdsChange(uniqueSorted(next));
  }

  function removeCabinet(id: string) {
    onCabinetIdsChange(selectedCabinetIds.filter((value) => value !== id));
  }

  function removeItem(id: string) {
    onItemIdsChange(selectedItemIds.filter((value) => value !== id));
  }

  const hasSelections = selectedCabinetIds.length > 0 || selectedItemIds.length > 0;

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white/50 p-4">
      <header className="space-y-1">
        <h2 className="text-sm font-medium text-gray-700">連結目標</h2>
        <p className="text-xs text-gray-500">
          選擇此筆記要關聯的櫃子或作品，採分步載入避免一次讀取所有作品。
        </p>
      </header>
      <div className="space-y-3">
        {hasSelections ? (
          <div className="space-y-2 text-sm">
            {selectedCabinets.length > 0 ? (
              <div className="space-y-1">
                <span className="text-xs font-medium text-gray-500">櫃子</span>
                <div className="flex flex-wrap gap-2">
                  {selectedCabinets.map((cabinet) => (
                    <button
                      key={cabinet.id}
                      type="button"
                      onClick={() => removeCabinet(cabinet.id)}
                      className="group inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-600 transition hover:bg-indigo-100"
                    >
                      <span>{cabinet.name}</span>
                      <span className="text-[10px] text-indigo-400 group-hover:text-indigo-600">移除</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedItems.length > 0 ? (
              <div className="space-y-1">
                <span className="text-xs font-medium text-gray-500">作品</span>
                <div className="flex flex-wrap gap-2">
                  {selectedItems.map((item) => {
                    const cabinetLabel = item.cabinetId
                      ? cabinetMap.get(item.cabinetId)?.name ?? ""
                      : "未分類";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="group inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-600 transition hover:bg-sky-200"
                      >
                        <span>{item.title}</span>
                        <span className="text-[10px] text-sky-400 group-hover:text-sky-600">{cabinetLabel}</span>
                        <span className="text-[10px] text-sky-400 group-hover:text-sky-600">移除</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500">尚未選取任何連結目標。</p>
        )}
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:bg-gray-50"
          >
            編輯連結目標
          </button>
        </div>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4">
          <div className="flex w-full max-w-5xl flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">選擇連結目標</h3>
                <p className="text-sm text-gray-500">
                  先挑選要連結的櫃子，再指定該櫃底下的作品，避免一次載入所有作品資料。
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm transition hover:border-gray-400 hover:bg-gray-50"
                >
                  關閉
                </button>
              </div>
            </header>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-gray-700">櫃子</span>
                  <input
                    value={cabinetSearch}
                    onChange={(event) => setCabinetSearch(event.target.value)}
                    placeholder="搜尋櫃子"
                    className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                  />
                </div>
                <div className="max-h-72 space-y-1 overflow-auto rounded-xl border border-gray-200 bg-white/80 p-2 text-sm">
                  {cabinetStatus.type === "loading" ? (
                    <p className="px-2 py-1 text-xs text-gray-500">載入中…</p>
                  ) : visibleCabinets.length > 0 ? (
                    visibleCabinets.map((option) => (
                      <label
                        key={option.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCabinetIds.includes(option.id)}
                          onChange={() => toggleCabinet(option.id)}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-400"
                        />
                        <span className="flex-1 break-anywhere">{option.name}</span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-1 text-xs text-gray-500">
                      {cabinetStatus.type === "error"
                        ? cabinetStatus.message
                        : "尚無櫃子或無符合條件的結果。"}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-700">
                    指定作品（請先選擇櫃子）
                  </label>
                  <select
                    value={activeCabinetForItems ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setItemSearch("");
                      setActiveCabinetForItems(value ? value : null);
                    }}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  >
                    <option value="">選擇要瀏覽的櫃子</option>
                    {combinedCabinetOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                    <option value={UNCATEGORIZED_KEY}>未分類作品</option>
                  </select>
                </div>
                {activeCabinetForItems ? (
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        {activeCabinetLabel || "作品清單"}
                      </span>
                      <input
                        value={itemSearch}
                        onChange={(event) => setItemSearch(event.target.value)}
                        placeholder="搜尋作品名稱"
                        className="h-10 w-full max-w-xs rounded-lg border border-gray-200 px-3 text-sm"
                      />
                    </div>
                    <div className="max-h-72 space-y-1 overflow-auto rounded-xl border border-gray-200 bg-white/80 p-2 text-sm">
                      {itemStatus.type === "loading" && !itemCache[activeCabinetForItems] ? (
                        <p className="px-2 py-1 text-xs text-gray-500">載入中…</p>
                      ) : filteredItemsForActiveCabinet.length > 0 ? (
                        filteredItemsForActiveCabinet.map((option) => (
                          <label
                            key={option.id}
                            className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-gray-100"
                          >
                            <input
                              type="checkbox"
                              checked={selectedItemIds.includes(option.id)}
                              onChange={() => toggleItem(option.id)}
                              className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-400"
                            />
                            <span className="flex-1 break-anywhere">{option.title}</span>
                          </label>
                        ))
                      ) : (
                        <p className="px-2 py-1 text-xs text-gray-500">
                          {itemStatus.type === "error"
                            ? itemStatus.message
                            : "尚無作品或無符合條件的結果。"}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    請先選擇要瀏覽的櫃子，再載入該櫃底下的作品。
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
