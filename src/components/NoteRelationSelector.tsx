"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { type User } from "firebase/auth";

import { fetchCabinetOptions, type CabinetOption } from "@/lib/cabinet-options";
import { buttonClass } from "@/lib/ui";
import {
  NOTE_RELATED_CABINET_LIMIT,
  NOTE_RELATED_ITEM_LIMIT,
  fetchItemSummariesByCabinet,
  fetchItemSummariesByIds,
  limitRelationIds,
  normalizeRelationIds,
  type NoteItemSummary,
} from "@/lib/note-relations";

type NoteRelationSelectorProps = {
  user: User | null;
  cabinetIds: string[];
  onCabinetIdsChange: (ids: string[]) => void;
  itemIds: string[];
  onItemIdsChange: (ids: string[]) => void;
  disabled?: boolean;
};

type SelectionDialogState = {
  cabinetIds: string[];
  itemIds: string[];
};

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function sortCabinetOptions(options: CabinetOption[]): CabinetOption[] {
  return [...options].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { sensitivity: "base" }));
}

export default function NoteRelationSelector({
  user,
  cabinetIds,
  onCabinetIdsChange,
  itemIds,
  onItemIdsChange,
  disabled = false,
}: NoteRelationSelectorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [cabinetSearch, setCabinetSearch] = useState("");
  const [itemsByCabinet, setItemsByCabinet] = useState<Map<string, NoteItemSummary[]>>(new Map());
  const [itemSummaryMap, setItemSummaryMap] = useState<Map<string, NoteItemSummary>>(new Map());
  const [itemDialogCabinetId, setItemDialogCabinetId] = useState<string>("");
  const [itemDialogSearch, setItemDialogSearch] = useState("");
  const [itemDialogError, setItemDialogError] = useState<string | null>(null);
  const [itemDialogLoading, setItemDialogLoading] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<SelectionDialogState>({
    cabinetIds,
    itemIds,
  });

  const cabinetMap = useMemo(() => {
    const map = new Map<string, CabinetOption>();
    for (const option of cabinetOptions) {
      map.set(option.id, option);
    }
    return map;
  }, [cabinetOptions]);

  useEffect(() => {
    setPendingSelection({ cabinetIds, itemIds });
  }, [cabinetIds, itemIds, dialogOpen]);

  useEffect(() => {
    if (!user) {
      setCabinetOptions([]);
      return;
    }
    let active = true;
    setCabinetLoading(true);
    setCabinetError(null);
    fetchCabinetOptions(user.uid)
      .then((rows) => {
        if (!active) return;
        setCabinetOptions(sortCabinetOptions(rows));
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入櫃子清單時發生錯誤", err);
        setCabinetError("載入櫃子清單時發生錯誤");
        setCabinetOptions([]);
      })
      .finally(() => {
        if (!active) return;
        setCabinetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || itemIds.length === 0) {
      return;
    }
    let active = true;
    const idsToFetch = itemIds.filter((id) => !itemSummaryMap.has(id));
    if (idsToFetch.length === 0) {
      return;
    }
    fetchItemSummariesByIds(user.uid, idsToFetch)
      .then((rows) => {
        if (!active) return;
        setItemSummaryMap((prev) => {
          const next = new Map(prev);
          for (const row of rows) {
            next.set(row.id, row);
          }
          return next;
        });
        setItemsByCabinet((prev) => {
          const next = new Map(prev);
          for (const row of rows) {
            if (!row.cabinetId) {
              continue;
            }
            const list = next.get(row.cabinetId) ?? [];
            if (!list.some((item) => item.id === row.id)) {
              next.set(
                row.cabinetId,
                [...list, row].sort((a, b) => a.title.localeCompare(b.title, "zh-Hant", { sensitivity: "base" }))
              );
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入作品資料時發生錯誤", err);
        setItemDialogError("載入作品資料時發生錯誤");
      });
    return () => {
      active = false;
    };
  }, [user, itemIds, itemSummaryMap]);

  function handleOpenDialog() {
    if (disabled || !user) {
      return;
    }
    setPendingSelection({
      cabinetIds,
      itemIds,
    });
    setItemDialogError(null);
    setDialogOpen(true);
  }

  function handleCloseDialog() {
    if (itemDialogLoading) {
      return;
    }
    setDialogOpen(false);
    setItemDialogError(null);
  }

  function handleConfirmDialog() {
    if (!dialogOpen || itemDialogLoading) {
      return;
    }
    const normalizedCabinets = limitRelationIds(
      uniqueIds(normalizeRelationIds(pendingSelection.cabinetIds)),
      NOTE_RELATED_CABINET_LIMIT
    );
    const normalizedItems = limitRelationIds(
      uniqueIds(normalizeRelationIds(pendingSelection.itemIds)),
      NOTE_RELATED_ITEM_LIMIT
    );
    onCabinetIdsChange(normalizedCabinets);
    onItemIdsChange(normalizedItems);
    setDialogOpen(false);
  }

  function togglePendingCabinet(id: string) {
    setPendingSelection((prev) => {
      const exists = prev.cabinetIds.includes(id);
      if (exists) {
        return {
          ...prev,
          cabinetIds: prev.cabinetIds.filter((item) => item !== id),
        };
      }
      if (prev.cabinetIds.length >= NOTE_RELATED_CABINET_LIMIT) {
        return prev;
      }
      return {
        ...prev,
        cabinetIds: [...prev.cabinetIds, id],
      };
    });
  }

  function togglePendingItem(id: string) {
    setPendingSelection((prev) => {
      const exists = prev.itemIds.includes(id);
      if (exists) {
        return {
          ...prev,
          itemIds: prev.itemIds.filter((item) => item !== id),
        };
      }
      if (prev.itemIds.length >= NOTE_RELATED_ITEM_LIMIT) {
        return prev;
      }
      return {
        ...prev,
        itemIds: [...prev.itemIds, id],
      };
    });
  }

  function removeCabinet(id: string) {
    if (disabled) {
      return;
    }
    const next = cabinetIds.filter((value) => value !== id);
    onCabinetIdsChange(next);
  }

  function removeItem(id: string) {
    if (disabled) {
      return;
    }
    const next = itemIds.filter((value) => value !== id);
    onItemIdsChange(next);
  }

  function handleSelectItemCabinet(event: ChangeEvent<HTMLSelectElement>) {
    const nextCabinetId = event.target.value;
    setItemDialogCabinetId(nextCabinetId);
    setItemDialogSearch("");
    if (!user || !nextCabinetId) {
      return;
    }
    setItemDialogLoading(true);
    setItemDialogError(null);
    fetchItemSummariesByCabinet(user.uid, nextCabinetId)
      .then((rows) => {
        setItemsByCabinet((prev) => {
          const next = new Map(prev);
          next.set(nextCabinetId, rows);
          return next;
        });
        setItemSummaryMap((prev) => {
          const next = new Map(prev);
          for (const row of rows) {
            next.set(row.id, row);
          }
          return next;
        });
      })
      .catch((err) => {
        console.error("載入作品清單時發生錯誤", err);
        setItemDialogError("載入作品清單時發生錯誤");
      })
      .finally(() => {
        setItemDialogLoading(false);
      });
  }

  const pendingItemSummaries = useMemo(() => {
    if (!pendingSelection.itemIds.length) {
      return [];
    }
    return pendingSelection.itemIds
      .map((id) => itemSummaryMap.get(id))
      .filter((item): item is NoteItemSummary => Boolean(item));
  }, [pendingSelection.itemIds, itemSummaryMap]);

  const filteredCabinetOptions = useMemo(() => {
    const keyword = cabinetSearch.trim().toLowerCase();
    if (!keyword) {
      return cabinetOptions;
    }
    return cabinetOptions.filter((option) => option.name.toLowerCase().includes(keyword));
  }, [cabinetOptions, cabinetSearch]);

  const filteredItemOptions = useMemo(() => {
    if (!itemDialogCabinetId) {
      return [];
    }
    const list = itemsByCabinet.get(itemDialogCabinetId) ?? [];
    const keyword = itemDialogSearch.trim().toLowerCase();
    if (!keyword) {
      return list;
    }
    return list.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [itemDialogCabinetId, itemDialogSearch, itemsByCabinet]);

  const cabinetLimitReached = pendingSelection.cabinetIds.length >= NOTE_RELATED_CABINET_LIMIT;
  const itemLimitReached = pendingSelection.itemIds.length >= NOTE_RELATED_ITEM_LIMIT;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">關聯作品 / 櫃子</h2>
          <p className="text-sm text-gray-500">為筆記建立對應的作品或收藏櫃連結。</p>
        </div>
        <button
          type="button"
          onClick={handleOpenDialog}
          disabled={disabled || !user}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          管理連結
        </button>
      </div>
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-medium text-gray-700">已選擇櫃子</h3>
          {cabinetIds.length === 0 ? (
            <p className="text-sm text-gray-500">尚未選擇櫃子。</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {cabinetIds.map((id) => {
                const cabinet = cabinetMap.get(id);
                const label = cabinet?.name ?? "未知櫃子";
                return (
                  <li key={id} className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                    <span>{label}</span>
                    {!disabled ? (
                      <button
                        type="button"
                        onClick={() => removeCabinet(id)}
                        className="ml-1 text-xs text-gray-500 hover:text-gray-700"
                        aria-label={`移除 ${label}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-700">已選擇作品</h3>
          {itemIds.length === 0 ? (
            <p className="text-sm text-gray-500">尚未選擇作品。</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {itemIds.map((id) => {
                const item = itemSummaryMap.get(id);
                const label = item?.title ?? "未知作品";
                return (
                  <li key={id} className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                    <span>{label}</span>
                    {!disabled ? (
                      <button
                        type="button"
                        onClick={() => removeItem(id)}
                        className="ml-1 text-xs text-gray-500 hover:text-gray-700"
                        aria-label={`移除 ${label}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {dialogOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">管理關聯項目</h2>
                <p className="text-sm text-gray-500">搜尋並選擇要連結的櫃子或作品。</p>
              </div>
              <button
                type="button"
                onClick={handleCloseDialog}
                className="text-sm text-gray-500 hover:text-gray-700"
                aria-label="關閉"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-6">
              <section className="space-y-3">
                <header className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">櫃子</h3>
                    <p className="text-sm text-gray-500">可多選，最多 {NOTE_RELATED_CABINET_LIMIT} 個。</p>
                  </div>
                  {cabinetLoading ? (
                    <span className="text-sm text-gray-500">載入中…</span>
                  ) : null}
                </header>
                {cabinetError ? (
                  <p className="text-sm text-red-600">{cabinetError}</p>
                ) : null}
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">搜尋櫃子</span>
                  <input
                    value={cabinetSearch}
                    onChange={(event) => setCabinetSearch(event.target.value)}
                    placeholder="輸入櫃子名稱關鍵字"
                    className="h-12 w-full rounded-xl border px-4 text-base"
                  />
                </label>
                <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                  {filteredCabinetOptions.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                      找不到符合條件的櫃子。
                    </li>
                  ) : (
                    filteredCabinetOptions.map((option) => {
                      const checked = pendingSelection.cabinetIds.includes(option.id);
                      const disabledOption = !checked && cabinetLimitReached;
                      return (
                        <li key={option.id} className="flex items-center justify-between rounded-xl border px-3 py-2">
                          <label className="flex flex-1 cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabledOption}
                              onChange={() => togglePendingCabinet(option.id)}
                              className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                            />
                            <div>
                              <div className="text-sm font-medium text-gray-900">{option.name}</div>
                              {option.isLocked ? (
                                <div className="text-xs text-gray-500">已鎖定</div>
                              ) : null}
                            </div>
                          </label>
                          {checked ? <span className="text-xs text-gray-500">已選</span> : null}
                        </li>
                      );
                    })
                  )}
                </ul>
              </section>
              <section className="space-y-3">
                <header>
                  <h3 className="text-lg font-semibold text-gray-900">作品</h3>
                  <p className="text-sm text-gray-500">先選擇櫃子，再挑選要連結的作品，最多 {NOTE_RELATED_ITEM_LIMIT} 件。</p>
                </header>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex flex-1 flex-col gap-1">
                    <span className="text-sm text-gray-600">選擇櫃子</span>
                    <select
                      value={itemDialogCabinetId}
                      onChange={handleSelectItemCabinet}
                      className="h-12 w-full rounded-xl border bg-white px-4 text-base"
                    >
                      <option value="">選擇要瀏覽的櫃子</option>
                      {cabinetOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                          {option.isLocked ? "（已鎖定）" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-1 flex-col gap-1">
                    <span className="text-sm text-gray-600">搜尋作品</span>
                    <input
                      value={itemDialogSearch}
                      onChange={(event) => setItemDialogSearch(event.target.value)}
                      placeholder="輸入作品名稱關鍵字"
                      className="h-12 w-full rounded-xl border px-4 text-base"
                      disabled={!itemDialogCabinetId}
                    />
                  </label>
                </div>
                {itemDialogError ? (
                  <p className="text-sm text-red-600">{itemDialogError}</p>
                ) : null}
                {itemDialogCabinetId ? (
                  <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl border p-2">
                    {itemDialogLoading ? (
                      <li className="py-6 text-center text-sm text-gray-500">載入中…</li>
                    ) : filteredItemOptions.length === 0 ? (
                      <li className="py-6 text-center text-sm text-gray-500">找不到符合條件的作品。</li>
                    ) : (
                      filteredItemOptions.map((item) => {
                        const checked = pendingSelection.itemIds.includes(item.id);
                        const disabledItem = !checked && itemLimitReached;
                        return (
                          <li key={item.id} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-gray-50">
                            <label className="flex flex-1 cursor-pointer items-center gap-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabledItem}
                                onChange={() => togglePendingItem(item.id)}
                                className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                              />
                              <div>
                                <div className="text-sm font-medium text-gray-900">{item.title}</div>
                                {item.cabinetId ? (
                                  <div className="text-xs text-gray-500">
                                    所屬櫃子：{cabinetMap.get(item.cabinetId)?.name ?? "未知櫃子"}
                                  </div>
                                ) : null}
                              </div>
                            </label>
                            {checked ? <span className="text-xs text-gray-500">已選</span> : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                    請先選擇要瀏覽的櫃子。
                  </p>
                )}
                <div>
                  <h4 className="text-sm font-medium text-gray-700">已勾選的作品</h4>
                  {pendingItemSummaries.length === 0 ? (
                    <p className="text-sm text-gray-500">尚未選擇作品。</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {pendingItemSummaries.map((item) => (
                        <li key={item.id} className="flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">
                          <span>{item.title}</span>
                          <button
                            type="button"
                            onClick={() => togglePendingItem(item.id)}
                            className="ml-1 text-xs text-amber-500 hover:text-amber-700"
                            aria-label={`移除 ${item.title}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
            <footer className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCloseDialog}
                className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
                disabled={itemDialogLoading}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmDialog}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                disabled={itemDialogLoading}
              >
                確認
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
