"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, onSnapshot, query, Timestamp, where } from "firebase/firestore";

import { fetchCabinetOptions, type CabinetOption } from "@/lib/cabinet-options";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import {
  NOTE_RELATED_CABINET_LIMIT,
  NOTE_RELATED_ITEM_LIMIT,
  fetchItemSummariesByIds,
  limitRelationIds,
  mergeLegacyRelationId,
  normalizeRelationIds,
  type NoteItemSummary,
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
  cabinetIds: string[];
  itemIds: string[];
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
  const [itemSummaries, setItemSummaries] = useState<Record<string, NoteItemSummary>>({});

  const directionButtonClass = (direction: SortDirection) =>
    `${buttonClass({
      variant: sortDirection === direction ? "primary" : "secondary",
      size: "sm",
    })} whitespace-nowrap px-3`;

  const cabinetMap = useMemo(() => {
    const map = new Map<string, CabinetOption>();
    for (const option of cabinetOptions) {
      map.set(option.id, option);
    }
    return map;
  }, [cabinetOptions]);

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
      return;
    }
    let active = true;
    fetchCabinetOptions(user.uid)
      .then((rows) => {
        if (!active) return;
        setCabinetOptions(rows);
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入櫃子資料時發生錯誤", err);
        setCabinetOptions([]);
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
            const cabinetIds = limitRelationIds(
              mergeLegacyRelationId(data?.cabinetId, normalizeRelationIds(data?.relatedCabinetIds)),
              NOTE_RELATED_CABINET_LIMIT
            );
            const itemIds = limitRelationIds(
              mergeLegacyRelationId(data?.itemId, normalizeRelationIds(data?.relatedItemIds)),
              NOTE_RELATED_ITEM_LIMIT
            );
            return {
              id: docSnap.id,
              title: (data?.title as string) || "",
              summary,
              isFavorite: Boolean(data?.isFavorite),
              createdMs,
              updatedMs,
              cabinetIds,
              itemIds,
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

  useEffect(() => {
    if (!user) {
      setItemSummaries({});
      return;
    }
    if (notes.length === 0) {
      return;
    }
    const allItemIds = new Set<string>();
    for (const note of notes) {
      for (const id of note.itemIds) {
        if (id) {
          allItemIds.add(id);
        }
      }
    }
    const existingIds = new Set(Object.keys(itemSummaries));
    const missing = Array.from(allItemIds).filter((id) => !existingIds.has(id));
    if (missing.length === 0) {
      return;
    }
    let active = true;
    fetchItemSummariesByIds(user.uid, missing)
      .then((rows) => {
        if (!active) return;
        setItemSummaries((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            next[row.id] = row;
          }
          return next;
        });
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入作品資料時發生錯誤", err);
      });
    return () => {
      active = false;
    };
  }, [user, notes, itemSummaries]);

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
      <ul className="divide-y rounded-2xl border border-gray-200 bg-white/70 shadow-sm">
        {paginatedNotes.map((note) => (
          <li key={note.id}>
            <Link
              href={`/notes/${note.id}`}
              className="notes-list-item flex flex-col gap-2 px-6 py-5 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                  {note.isFavorite ? (
                    <span className="mt-1 text-base text-amber-500" aria-hidden="true">
                      ★
                    </span>
                  ) : null}
                  <h2 className="line-clamp-2 flex-1 break-anywhere text-lg font-semibold text-gray-900">
                    {note.title || "(未命名筆記)"}
                  </h2>
                  {note.isFavorite ? <span className="sr-only">最愛筆記</span> : null}
                </div>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                  <div className="flex gap-1">
                    <dt className="font-medium">建立：</dt>
                    <dd>{formatDateTime(note.createdMs)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="font-medium">更新：</dt>
                    <dd>{formatDateTime(note.updatedMs)}</dd>
                  </div>
                </dl>
              </div>
              {note.summary ? (
                <p className="line-clamp-2 break-anywhere text-sm text-gray-600">{note.summary}</p>
              ) : null}
              {note.cabinetIds.length > 0 || note.itemIds.length > 0 ? (
                <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                  {note.cabinetIds.map((cabinetId) => {
                    const cabinet = cabinetMap.get(cabinetId);
                    if (!cabinet) {
                      return (
                        <span
                          key={`cab-${cabinetId}`}
                          className="rounded-full bg-gray-100 px-2 py-1 text-gray-500"
                        >
                          未知櫃子
                        </span>
                      );
                    }
                    const label = cabinet.name || "未命名櫃子";
                    if (cabinet.isLocked) {
                      return (
                        <span
                          key={`cab-${cabinetId}`}
                          className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-gray-400"
                        >
                          🔒 {label}
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={`cab-${cabinetId}`}
                        href={`/cabinet/${cabinetId}`}
                        className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-gray-700 hover:bg-gray-200"
                        onClick={(event) => event.stopPropagation()}
                      >
                        📁 {label}
                      </Link>
                    );
                  })}
                  {note.itemIds.map((itemId) => {
                    const item = itemSummaries[itemId];
                    if (!item) {
                      return (
                        <span
                          key={`item-${itemId}`}
                          className="rounded-full bg-amber-50 px-2 py-1 text-amber-600"
                        >
                          載入作品中…
                        </span>
                      );
                    }
                    const relatedCabinet = item.cabinetId ? cabinetMap.get(item.cabinetId) : null;
                    const locked = relatedCabinet ? relatedCabinet.isLocked : false;
                    const label = item.title || "未命名作品";
                    if (locked) {
                      return (
                        <span
                          key={`item-${itemId}`}
                          className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-500"
                        >
                          🔒 {label}
                        </span>
                      );
                    }
                    return (
                      <Link
                        key={`item-${itemId}`}
                        href={`/item/${itemId}`}
                        className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 hover:bg-amber-100"
                        onClick={(event) => event.stopPropagation()}
                      >
                        📚 {label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    );
  }, [cabinetMap, hasFilteredNotes, hasNotes, itemSummaries, paginatedNotes]);

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
