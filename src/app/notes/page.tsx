"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, onSnapshot, query, Timestamp, where } from "firebase/firestore";

import { fetchCabinetOptions, type CabinetOption } from "@/lib/cabinet-options";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import {
  buildItemListFromSummaries,
  describeCabinet,
  loadItemSummaries,
  normalizeNoteRelations,
  type ItemSummary,
} from "@/lib/note-relations";
import { buttonClass } from "@/lib/ui";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

type Note = {
  id: string;
  title: string;
  summary: string | null;
  isFavorite: boolean;
  createdMs: number;
  updatedMs: number;
  cabinetId: string | null;
  itemId: string | null;
  relatedItemIds: string[];
};

type SortOption = "recentUpdated" | "created" | "title";
type SortDirection = "asc" | "desc";

type Feedback = {
  type: "error" | "success";
  message: string;
};

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(ms: number): string {
  if (!ms) {
    return "—";
  }
  try {
    return dateFormatter.format(new Date(ms));
  } catch {
    return "—";
  }
}

export default function NotesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("recentUpdated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [itemSummaryMap, setItemSummaryMap] = useState<Map<string, ItemSummary | null>>(new Map());
  const [itemSummaryError, setItemSummaryError] = useState<string | null>(null);

  const directionButtonClass = (direction: SortDirection) =>
    `${buttonClass({
      variant: sortDirection === direction ? "primary" : "secondary",
      size: "sm",
    })} whitespace-nowrap px-3`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return undefined;
    }

    const unsub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setCabinetOptions([]);
      setCabinetError(null);
      return;
    }
    let active = true;
    setCabinetError(null);
    fetchCabinetOptions(user.uid)
      .then((options) => {
        if (!active) {
          return;
        }
        setCabinetOptions(options);
      })
      .catch((err) => {
        console.error("載入櫃子資料時發生錯誤", err);
        if (!active) {
          return;
        }
        setCabinetError("載入櫃子資料時發生錯誤");
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }

    const q = query(collection(db, "note"), where("uid", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const rows: Note[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const createdAt = data?.createdAt;
            const updatedAt = data?.updatedAt;
            const createdMs = createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
            const updatedMs = updatedAt instanceof Timestamp ? updatedAt.toMillis() : createdMs;
            const summary =
              typeof data?.description === "string" && data.description.trim().length > 0
                ? data.description.trim()
                : null;
            const relations = normalizeNoteRelations(data as Record<string, unknown>);
            return {
              id: docSnap.id,
              title: (data?.title as string) || "",
              summary,
              isFavorite: Boolean(data?.isFavorite),
              createdMs,
              updatedMs,
              cabinetId: relations.cabinetId,
              itemId: relations.itemId,
              relatedItemIds: relations.relatedItemIds,
            } satisfies Note;
          })
          .sort((a, b) => b.updatedMs - a.updatedMs);
        setNotes(rows);
        setFeedback(null);
      },
      () => {
        setFeedback({ type: "error", message: "載入筆記時發生錯誤" });
      }
    );
    return () => unsub();
  }, [user]);

  const itemIdsForSummary = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((note) => {
      note.relatedItemIds.forEach((id) => {
        if (typeof id === "string" && id.trim().length > 0) {
          set.add(id);
        }
      });
    });
    return Array.from(set);
  }, [notes]);

  useEffect(() => {
    if (!user) {
      setItemSummaryMap(new Map());
      setItemSummaryError(null);
      return;
    }
    if (itemIdsForSummary.length === 0) {
      setItemSummaryMap(new Map());
      setItemSummaryError(null);
      return;
    }
    let active = true;
    loadItemSummaries(user.uid, itemIdsForSummary)
      .then((map) => {
        if (!active) {
          return;
        }
        setItemSummaryMap(map);
        setItemSummaryError(null);
      })
      .catch((err) => {
        console.error("載入關聯作品時發生錯誤", err);
        if (!active) {
          return;
        }
        setItemSummaryError("載入關聯作品時發生錯誤");
        const placeholder = new Map<string, ItemSummary | null>();
        itemIdsForSummary.forEach((id) => {
          placeholder.set(id, null);
        });
        setItemSummaryMap(placeholder);
      });
    return () => {
      active = false;
    };
  }, [itemIdsForSummary, user]);

  const filteredNotes = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return notes.filter((note) => {
      if (showFavoritesOnly && !note.isFavorite) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const titleMatch = note.title.toLowerCase().includes(keyword);
      const summaryMatch = (note.summary ?? "").toLowerCase().includes(keyword);
      return titleMatch || summaryMatch;
    });
  }, [notes, searchTerm, showFavoritesOnly]);

  const sortedNotes = useMemo(() => {
    const base = [...filteredNotes];
    const directionFactor = sortDirection === "asc" ? 1 : -1;
    switch (sortOption) {
      case "created":
        base.sort((a, b) => (a.createdMs - b.createdMs) * directionFactor);
        break;
      case "title":
        base.sort((a, b) =>
          a.title.localeCompare(b.title, "zh-Hant", { sensitivity: "base" }) * directionFactor
        );
        break;
      case "recentUpdated":
      default:
        base.sort((a, b) => (a.updatedMs - b.updatedMs) * directionFactor);
        break;
    }
    return base;
  }, [filteredNotes, sortDirection, sortOption]);

  const totalNotes = sortedNotes.length;
  const totalPages = Math.max(1, Math.ceil(totalNotes / pageSize));
  const pageStartIndex = (currentPage - 1) * pageSize;
  const paginatedNotes = sortedNotes.slice(pageStartIndex, pageStartIndex + pageSize);
  const hasNotes = notes.length > 0;
  const hasFilteredNotes = totalNotes > 0;

  const cabinetMap = useMemo(() => {
    const map = new Map<string, CabinetOption>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [cabinetOptions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortOption, sortDirection, pageSize, showFavoritesOnly]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const content = useMemo(() => {
    if (!hasNotes) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-10 text-center text-gray-500">
          尚未建立任何筆記。
        </div>
      );
    }

    if (!hasFilteredNotes) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-10 text-center text-gray-500">
          找不到符合搜尋或篩選條件的筆記。
        </div>
      );
    }

    return (
      <ul className="space-y-4">
        {paginatedNotes.map((note) => {
          const cabinetInfo = describeCabinet(note.cabinetId, cabinetMap);
          const relatedList = buildItemListFromSummaries(note.relatedItemIds, itemSummaryMap);
          return (
            <li key={note.id} className="rounded-2xl border border-gray-200 bg-white/70 shadow-sm">
              <article className="space-y-3 px-6 py-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    {note.isFavorite ? (
                      <span className="mt-1 text-base text-amber-500" aria-hidden="true">
                        ★
                      </span>
                    ) : null}
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/notes/${note.id}`}
                        className="block min-w-0 text-lg font-semibold text-gray-900 transition hover:text-amber-600"
                      >
                        <span className="break-anywhere">{note.title || "(未命名筆記)"}</span>
                      </Link>
                      {note.summary ? (
                        <p className="line-clamp-2 break-anywhere text-sm text-gray-600">{note.summary}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-xs text-gray-500 sm:flex-none">
                    <div className="flex gap-1">
                      <span className="font-medium">建立：</span>
                      <span>{formatDateTime(note.createdMs)}</span>
                    </div>
                    <div className="flex gap-1">
                      <span className="font-medium">更新：</span>
                      <span>{formatDateTime(note.updatedMs)}</span>
                    </div>
                    <Link href={`/notes/${note.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                      查看筆記
                    </Link>
                  </div>
                </div>
                <div className="space-y-3 text-xs text-gray-600 sm:text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-500">關聯櫃子：</span>
                    {note.cabinetId ? (
                      cabinetInfo.missing ? (
                        <span className="text-red-600">{cabinetInfo.name}</span>
                      ) : cabinetInfo.isLocked ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <span aria-hidden="true">🔒</span>
                          {cabinetInfo.name}
                        </span>
                      ) : (
                        <Link
                          href={`/cabinet/${encodeURIComponent(note.cabinetId)}`}
                          className="text-blue-600 underline-offset-4 hover:underline"
                        >
                          {cabinetInfo.name}
                        </Link>
                      )
                    ) : (
                      <span>未指定</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <span className="font-medium text-gray-500">關聯作品：</span>
                    {itemSummaryError && note.relatedItemIds.length > 0 ? (
                      <span className="text-xs text-red-600">{itemSummaryError}</span>
                    ) : relatedList.length === 0 ? (
                      <span className="text-sm text-gray-500">尚未關聯作品。</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {relatedList.map((item) => {
                          const itemCabinet = item.cabinetId ? cabinetMap.get(item.cabinetId) ?? null : null;
                          const itemLocked = Boolean(itemCabinet?.isLocked);
                          const isPrimary = note.itemId === item.id;
                          if (item.isMissing) {
                            return (
                              <span
                                key={item.id}
                                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-red-600"
                              >
                                {item.title}
                              </span>
                            );
                          }
                          if (itemLocked) {
                            return (
                              <span
                                key={item.id}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-700"
                              >
                                <span aria-hidden="true">🔒</span>
                                {item.title}
                                {isPrimary ? (
                                  <span className="ml-1 rounded-full bg-white/70 px-1 text-[10px] font-semibold text-amber-700">
                                    主
                                  </span>
                                ) : null}
                              </span>
                            );
                          }
                          return (
                            <Link
                              key={item.id}
                              href={`/item/${encodeURIComponent(item.id)}`}
                              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100"
                            >
                              {item.title}
                              {isPrimary ? (
                                <span className="ml-1 rounded-full bg-white/70 px-1 text-[10px] font-semibold text-blue-700">
                                  主
                                </span>
                              ) : null}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    );
  }, [cabinetMap, hasFilteredNotes, hasNotes, itemSummaryError, itemSummaryMap, paginatedNotes]);

  if (!authChecked) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-4xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">筆記本</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理筆記，或回到
            <Link href="/" className="ml-1 underline">
              首頁
            </Link>
            了解更多功能。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">筆記本</h1>
            <p className="text-sm text-gray-500">管理與檢視所有筆記紀錄。</p>
          </div>
          <Link href="/notes/new" className={buttonClass({ variant: "primary" })}>
            新增筆記
          </Link>
        </header>
        {feedback && feedback.type === "error" ? (
          <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {feedback.message}
          </div>
        ) : null}
        {cabinetError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
            {cabinetError}
          </div>
        ) : null}
        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">搜尋與篩選</h2>
              <p className="text-sm text-gray-500">找到目標筆記並調整列表顯示。</p>
            </div>
            <button
              type="button"
              onClick={() => setFiltersExpanded((prev) => !prev)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
              aria-expanded={filtersExpanded}
            >
              {filtersExpanded ? "收合" : "展開"}
            </button>
          </div>
          {filtersExpanded ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <label className="flex flex-1 flex-col space-y-1">
                  <span className="text-sm text-gray-600">搜尋筆記</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="輸入標題或備註關鍵字"
                    className="h-12 w-full rounded-xl border px-4 text-base"
                  />
                </label>
                <label className="flex flex-1 flex-col space-y-1">
                  <span className="text-sm text-gray-600">排序方式</span>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={sortOption}
                      onChange={(event) => setSortOption(event.target.value as SortOption)}
                      className="h-12 w-full flex-1 rounded-xl border bg-white px-4 text-base"
                    >
                      <option value="recentUpdated">最近更新</option>
                      <option value="created">建立時間</option>
                      <option value="title">標題</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSortDirection("asc")}
                        className={directionButtonClass("asc")}
                        aria-pressed={sortDirection === "asc"}
                      >
                        正序
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortDirection("desc")}
                        className={directionButtonClass("desc")}
                        aria-pressed={sortDirection === "desc"}
                      >
                        反序
                      </button>
                    </div>
                  </div>
                </label>
                <label className="flex flex-col space-y-1">
                  <span className="text-sm text-gray-600">每頁顯示數量</span>
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="h-12 rounded-xl border bg-white px-4 text-base"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={showFavoritesOnly}
                    onChange={(event) => setShowFavoritesOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  只顯示最愛
                </label>
              </div>
            </div>
          ) : null}
        </section>
        {content}
        {hasNotes && hasFilteredNotes ? (
          <footer className="flex flex-col gap-3 rounded-2xl border bg-white/70 p-4 text-sm text-gray-600 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              顯示第 {totalNotes === 0 ? 0 : pageStartIndex + 1} -
              {Math.min(pageStartIndex + paginatedNotes.length, totalNotes)} 筆，共 {totalNotes} 筆筆記
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                className={buttonClass({ variant: "secondary", size: "sm" })}
                disabled={currentPage === 1}
              >
                上一頁
              </button>
              <span className="font-medium text-gray-700">
                第 {currentPage} / {totalPages} 頁
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                className={buttonClass({ variant: "secondary", size: "sm" })}
                disabled={currentPage >= totalPages}
              >
                下一頁
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </main>
  );
}
