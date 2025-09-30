"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchCabinetOptions, type CabinetOption } from "@/lib/cabinet-options";
import {
  NOTE_RELATED_ITEM_LIMIT,
  fetchCabinetItemSummaries,
  type ItemSummary,
} from "@/lib/note-relations";
import { buttonClass } from "@/lib/ui";

type NoteRelationDialogProps = {
  open: boolean;
  userId: string;
  initialCabinetId: string | null;
  initialItems: ItemSummary[];
  initialPrimaryItemId: string | null;
  onClose: () => void;
  onSave: (value: {
    cabinetId: string | null;
    items: ItemSummary[];
    primaryItemId: string | null;
  }) => void;
};

const INITIAL_MAP = () => new Map<string, ItemSummary>();

export default function NoteRelationDialog({
  open,
  userId,
  initialCabinetId,
  initialItems,
  initialPrimaryItemId,
  onClose,
  onSave,
}: NoteRelationDialogProps) {
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [cabinetSearch, setCabinetSearch] = useState("");
  const [activeCabinetId, setActiveCabinetId] = useState<string | null>(initialCabinetId);
  const [linkedCabinetId, setLinkedCabinetId] = useState<string | null>(initialCabinetId);
  const [itemsCache, setItemsCache] = useState(() => new Map<string, ItemSummary[]>());
  const [itemSearch, setItemSearch] = useState("");
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Map<string, ItemSummary>>(INITIAL_MAP);
  const [primaryItemId, setPrimaryItemId] = useState<string | null>(
    initialPrimaryItemId ?? (initialItems[0]?.id ?? null)
  );
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCabinetLoading(true);
    setCabinetError(null);
    let active = true;
    fetchCabinetOptions(userId)
      .then((options) => {
        if (!active) {
          return;
        }
        setCabinetOptions(options);
      })
      .catch((err) => {
        console.error("載入櫃子列表時發生錯誤", err);
        if (!active) {
          return;
        }
        setCabinetError("載入櫃子列表時發生錯誤");
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setCabinetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, userId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const initialMap = new Map<string, ItemSummary>();
    initialItems.forEach((item) => {
      initialMap.set(item.id, item);
    });
    setSelectedItems(initialMap);
    setPrimaryItemId((prev) => {
      if (prev && initialMap.has(prev)) {
        return prev;
      }
      if (initialPrimaryItemId && initialMap.has(initialPrimaryItemId)) {
        return initialPrimaryItemId;
      }
      const first = initialMap.values().next().value as ItemSummary | undefined;
      return first ? first.id : null;
    });
    setLinkedCabinetId(initialCabinetId ?? null);
    setActiveCabinetId(initialCabinetId ?? null);
    setSelectionError(null);
  }, [initialCabinetId, initialItems, initialPrimaryItemId, open]);

  useEffect(() => {
    if (!open || !activeCabinetId) {
      return;
    }
    if (itemsCache.has(activeCabinetId)) {
      return;
    }
    let cancelled = false;
    setItemsLoading(true);
    setItemsError(null);
    fetchCabinetItemSummaries(userId, activeCabinetId)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setItemsCache((prev) => {
          const next = new Map(prev);
          next.set(activeCabinetId, items);
          return next;
        });
      })
      .catch((err) => {
        console.error("載入作品列表時發生錯誤", err);
        if (cancelled) {
          return;
        }
        setItemsError("載入作品列表時發生錯誤");
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCabinetId, itemsCache, open, userId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const cabinetMap = useMemo(() => {
    const map = new Map<string, CabinetOption>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [cabinetOptions]);

  const filteredCabinets = useMemo(() => {
    const keyword = cabinetSearch.trim().toLowerCase();
    if (!keyword) {
      return cabinetOptions;
    }
    return cabinetOptions.filter((option) =>
      option.name.toLowerCase().includes(keyword)
    );
  }, [cabinetOptions, cabinetSearch]);

  const activeItems = useMemo(() => {
    if (!activeCabinetId) {
      return [] as ItemSummary[];
    }
    const source = itemsCache.get(activeCabinetId) ?? [];
    const keyword = itemSearch.trim().toLowerCase();
    if (!keyword) {
      return source;
    }
    return source.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [activeCabinetId, itemSearch, itemsCache]);

  const selectedList = useMemo(() => Array.from(selectedItems.values()), [selectedItems]);

  const activeCabinet = activeCabinetId ? cabinetMap.get(activeCabinetId) ?? null : null;
  const linkedCabinet = linkedCabinetId ? cabinetMap.get(linkedCabinetId) ?? null : null;

  if (!open) {
    return null;
  }

  function toggleItem(item: ItemSummary) {
    setSelectionError(null);
    setSelectedItems((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        if (next.size >= NOTE_RELATED_ITEM_LIMIT) {
          setSelectionError(`最多僅能連結 ${NOTE_RELATED_ITEM_LIMIT} 件作品`);
          return prev;
        }
        next.set(item.id, { ...item, isMissing: item.isMissing });
      }
      setPrimaryItemId((prevPrimary) => {
        if (next.size === 0) {
          return null;
        }
        if (prevPrimary && next.has(prevPrimary)) {
          return prevPrimary;
        }
        const first = next.values().next().value as ItemSummary | undefined;
        return first ? first.id : null;
      });
      return next;
    });
  }

  function removeItem(itemId: string) {
    setSelectedItems((prev) => {
      if (!prev.has(itemId)) {
        return prev;
      }
      const next = new Map(prev);
      next.delete(itemId);
      setPrimaryItemId((prevPrimary) => {
        if (next.size === 0) {
          return null;
        }
        if (prevPrimary && next.has(prevPrimary)) {
          return prevPrimary;
        }
        const first = next.values().next().value as ItemSummary | undefined;
        return first ? first.id : null;
      });
      return next;
    });
  }

  function handleApply() {
    const list = Array.from(selectedItems.values());
    const normalizedPrimary = (() => {
      if (!primaryItemId) {
        return list[0]?.id ?? null;
      }
      return selectedItems.has(primaryItemId) ? primaryItemId : list[0]?.id ?? null;
    })();
    onSave({
      cabinetId: linkedCabinetId ?? null,
      items: list,
      primaryItemId: normalizedPrimary,
    });
  }

  const linkedCabinetLabel = linkedCabinetId
    ? linkedCabinet
      ? `${linkedCabinet.name || "未命名櫃子"}${linkedCabinet.isLocked ? "（已鎖定）" : ""}`
      : "(找不到櫃子)"
    : "未指定";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-5xl flex-col gap-6 overflow-hidden rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">管理關聯作品 / 櫃子</h2>
            <p className="mt-1 text-sm text-gray-500">
              選擇櫃子後即可挑選作品加入筆記關聯，可多選並指定主要作品。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-gray-200 text-xl text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
            aria-label="關閉關聯設定視窗"
          >
            ×
          </button>
        </header>

        <div className="grid flex-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <section className="flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-800">選擇櫃子</h3>
              <p className="text-sm text-gray-500">瀏覽櫃子以載入其包含的作品，並可指定作為筆記關聯櫃子。</p>
            </div>
            <input
              value={cabinetSearch}
              onChange={(event) => setCabinetSearch(event.target.value)}
              placeholder="搜尋櫃子"
              className="h-11 rounded-xl border border-gray-200 px-4 text-sm focus:border-gray-400 focus:outline-none"
            />
            <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="absolute inset-0 overflow-y-auto p-2">
                {cabinetLoading ? (
                  <div className="p-4 text-center text-sm text-gray-500">正在載入櫃子…</div>
                ) : cabinetError ? (
                  <div className="p-4 text-center text-sm text-red-600">{cabinetError}</div>
                ) : filteredCabinets.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">找不到符合的櫃子。</div>
                ) : (
                  <ul className="space-y-2">
                    {filteredCabinets.map((cabinet) => {
                      const isActive = cabinet.id === activeCabinetId;
                      const isLinked = cabinet.id === linkedCabinetId;
                      return (
                        <li key={cabinet.id}>
                          <button
                            type="button"
                            onClick={() => setActiveCabinetId(cabinet.id)}
                            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                              isActive
                                ? "border-amber-400 bg-amber-50 text-amber-800"
                                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {cabinet.name || "未命名櫃子"}
                              </div>
                              {cabinet.isLocked ? (
                                <div className="text-xs text-amber-600">已鎖定</div>
                              ) : null}
                            </div>
                            {isLinked ? (
                              <span className="text-xs text-amber-600">已關聯</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-gray-700">目前瀏覽櫃子</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                    onClick={() => {
                      if (activeCabinetId) {
                        setLinkedCabinetId(activeCabinetId);
                      }
                    }}
                    disabled={!activeCabinetId}
                  >
                    關聯此櫃子
                  </button>
                  <button
                    type="button"
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                    onClick={() => setLinkedCabinetId(null)}
                    disabled={!linkedCabinetId}
                  >
                    取消關聯
                  </button>
                </div>
              </div>
              <div className="mt-2 text-gray-700">
                {activeCabinet
                  ? `${activeCabinet.name || "未命名櫃子"}${activeCabinet.isLocked ? "（已鎖定）" : ""}`
                  : "尚未選擇櫃子"}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
              <div className="font-medium text-gray-700">已關聯櫃子</div>
              <div className="mt-2 break-anywhere text-gray-700">{linkedCabinetLabel}</div>
            </div>
          </section>

          <section className="flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-gray-200 bg-white p-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-800">選擇作品</h3>
              <p className="text-sm text-gray-500">
                點擊作品即可加入或移除，已選的作品可在下方設定主要作品與移除。
              </p>
            </div>
            {activeCabinetId ? (
              <>
                <input
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                  placeholder="搜尋作品"
                  className="h-11 rounded-xl border border-gray-200 px-4 text-sm focus:border-gray-400 focus:outline-none"
                />
                <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-200">
                  <div className="absolute inset-0 overflow-y-auto p-2">
                    {itemsLoading ? (
                      <div className="p-4 text-center text-sm text-gray-500">正在載入作品…</div>
                    ) : itemsError ? (
                      <div className="p-4 text-center text-sm text-red-600">{itemsError}</div>
                    ) : activeItems.length === 0 ? (
                      <div className="p-4 text-center text-sm text-gray-500">此櫃子目前沒有作品或搜尋無結果。</div>
                    ) : (
                      <ul className="space-y-2">
                        {activeItems.map((item) => {
                          const isSelected = selectedItems.has(item.id);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => toggleItem(item)}
                                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                                  isSelected
                                    ? "border-amber-400 bg-amber-50 text-amber-800"
                                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{item.title}</div>
                                  {item.isMissing ? (
                                    <div className="text-xs text-red-600">找不到作品資料</div>
                                  ) : null}
                                </div>
                                <span className="text-base">{isSelected ? "✓" : "+"}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                請先於左側選擇櫃子。
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-base font-semibold text-gray-800">已選作品</h4>
                {selectionError ? (
                  <span className="text-sm text-red-600">{selectionError}</span>
                ) : null}
              </div>
              {selectedList.length === 0 ? (
                <p className="text-sm text-gray-500">尚未選擇任何作品。</p>
              ) : (
                <ul className="space-y-3">
                  {selectedList.map((item) => {
                    const cabinet = item.cabinetId ? cabinetMap.get(item.cabinetId) ?? null : null;
                    const cabinetText = item.cabinetId
                      ? cabinet
                        ? `${cabinet.name || "未命名櫃子"}${cabinet.isLocked ? "（已鎖定）" : ""}`
                        : "(找不到櫃子)"
                      : "未指定櫃子";
                    const isPrimary = primaryItemId === item.id;
                    return (
                      <li key={item.id} className="rounded-xl border border-gray-200 bg-white px-3 py-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-gray-800">
                                {item.title}
                              </span>
                              {item.isMissing ? (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                                  已遺失
                                </span>
                              ) : null}
                              {isPrimary ? (
                                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                                  主作品
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-500">{cabinetText}</div>
                          </div>
                          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                            <label className="flex items-center gap-2 text-xs text-gray-600">
                              <input
                                type="radio"
                                name="primaryItem"
                                checked={isPrimary}
                                onChange={() => setPrimaryItemId(item.id)}
                              />
                              設為主作品
                            </label>
                            <button
                              type="button"
                              className="text-xs text-red-600 transition hover:text-red-700"
                              onClick={() => removeItem(item.id)}
                            >
                              移除
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>

        <footer className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
            onClick={handleApply}
          >
            儲存關聯
          </button>
        </footer>
      </div>
    </div>
  );
}

