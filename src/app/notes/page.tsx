"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, Timestamp, where } from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import NoteTagQuickEditor from "@/components/NoteTagQuickEditor";
import { NOTE_TAG_LIMIT, normalizeNoteTags } from "@/lib/note";
import { buttonClass } from "@/lib/ui";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

type Note = {
  id: string;
  title: string;
  summary: string | null;
  tags: string[];
  linkedCabinetIds: string[];
  linkedItemIds: string[];
  isFavorite: boolean;
  createdMs: number;
  updatedMs: number;
};

type CabinetOption = {
  id: string;
  name: string;
  isLocked: boolean;
};

type ItemOption = {
  id: string;
  title: string;
  cabinetId: string | null;
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
  const searchParams = useSearchParams();
  const initialCabinetId = searchParams.get("cabinetId");
  const initialItemId = searchParams.get("itemId");
  const initialTag = searchParams.get("tag");
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
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [selectedCabinetId, setSelectedCabinetId] = useState<string>(initialCabinetId ?? "");
  const [selectedItemId, setSelectedItemId] = useState<string>(initialItemId ?? "");
  const [tagFilter, setTagFilter] = useState(initialTag ?? "");
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagManagerStatus, setTagManagerStatus] = useState<{
    message: string | null;
    error: string | null;
  }>({ message: null, error: null });

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
      setItemOptions([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const cabinetQuery = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    const itemQuery = query(collection(db, "item"), where("uid", "==", user.uid));

    const unsubCabinet = onSnapshot(
      cabinetQuery,
      (snapshot) => {
        setCabinetOptions(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                name: typeof data?.name === "string" ? data.name : "未命名櫃子",
                isLocked: Boolean(data?.isLocked),
              } satisfies CabinetOption;
            })
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
        );
      },
      () => {
        setFeedback({ type: "error", message: "載入櫃子清單時發生錯誤" });
      }
    );

    const unsubItem = onSnapshot(
      itemQuery,
      (snapshot) => {
        setItemOptions(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                title:
                  typeof data?.titleZh === "string" && data.titleZh.trim()
                    ? (data.titleZh as string)
                    : "未命名作品",
                cabinetId:
                  typeof data?.cabinetId === "string" && data.cabinetId.trim().length > 0
                    ? (data.cabinetId as string)
                    : null,
              } satisfies ItemOption;
            })
            .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"))
        );
      },
      () => {
        setFeedback({ type: "error", message: "載入作品清單時發生錯誤" });
      }
    );

    return () => {
      unsubCabinet();
      unsubItem();
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNoteTags([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setNoteTags([]);
      return;
    }
    let active = true;
    getDoc(doc(db, "user", user.uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setNoteTags([]);
          return;
        }
        const data = snap.data();
        setNoteTags(normalizeNoteTags(data?.noteTags));
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入筆記標籤時發生錯誤", err);
        setNoteTags([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    setSelectedCabinetId((prev) =>
      prev && !cabinetOptions.some((option) => option.id === prev) ? "" : prev
    );
  }, [cabinetOptions]);

  useEffect(() => {
    setSelectedItemId((prev) =>
      prev && !itemOptions.some((option) => option.id === prev) ? "" : prev
    );
  }, [itemOptions]);

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
            const tags = Array.isArray(data?.tags)
              ? data.tags.filter((value: unknown): value is string => typeof value === "string")
              : [];
            const linkedCabinetIds = Array.isArray(data?.linkedCabinetIds)
              ? data.linkedCabinetIds.filter((value: unknown): value is string => typeof value === "string")
              : [];
            const linkedItemIds = Array.isArray(data?.linkedItemIds)
              ? data.linkedItemIds.filter((value: unknown): value is string => typeof value === "string")
              : [];
            return {
              id: docSnap.id,
              title: (data?.title as string) || "",
              summary,
              tags,
              linkedCabinetIds,
              linkedItemIds,
              isFavorite: Boolean(data?.isFavorite),
              createdMs,
              updatedMs,
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

  const filteredNotes = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const tagKeyword = tagFilter.trim().toLowerCase();
    return notes.filter((note) => {
      if (showFavoritesOnly && !note.isFavorite) {
        return false;
      }
      if (selectedCabinetId && !note.linkedCabinetIds.includes(selectedCabinetId)) {
        return false;
      }
      if (selectedItemId && !note.linkedItemIds.includes(selectedItemId)) {
        return false;
      }
      if (tagKeyword) {
        const tagMatched = note.tags.some((tag) => tag.toLowerCase().includes(tagKeyword));
        if (!tagMatched) {
          return false;
        }
      }
      if (!keyword) {
        return true;
      }
      const titleMatch = note.title.toLowerCase().includes(keyword);
      const summaryMatch = (note.summary ?? "").toLowerCase().includes(keyword);
      return titleMatch || summaryMatch;
    });
  }, [
    notes,
    searchTerm,
    showFavoritesOnly,
    selectedCabinetId,
    selectedItemId,
    tagFilter,
  ]);

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

  const cabinetLockMap = useMemo(() => {
    const map = new Map<string, boolean>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option.isLocked);
    });
    return map;
  }, [cabinetOptions]);

  const cabinetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option.name);
    });
    return map;
  }, [cabinetOptions]);

  const filteredTagSuggestions = useMemo(() => {
    const keyword = tagFilter.trim().toLowerCase();
    if (!keyword) {
      return noteTags.slice(0, 20);
    }
    return noteTags
      .filter((tag) => tag.toLowerCase().includes(keyword))
      .slice(0, 20);
  }, [noteTags, tagFilter]);

  const itemOptionMap = useMemo(() => {
    const map = new Map<string, ItemOption>();
    itemOptions.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [itemOptions]);

  const showCabinetLockedAlert = useCallback(() => {
    if (typeof window !== "undefined") {
      window.alert("因該櫃子目前處於鎖定狀態，因此無法訪問該櫃子");
    }
  }, []);

  const showItemLockedAlert = useCallback(() => {
    if (typeof window !== "undefined") {
      window.alert("因該物件所屬櫃子目前處於鎖定狀態，因此無法訪問該物件");
    }
  }, []);

  const totalNotes = sortedNotes.length;
  const totalPages = Math.max(1, Math.ceil(totalNotes / pageSize));
  const pageStartIndex = (currentPage - 1) * pageSize;
  const paginatedNotes = sortedNotes.slice(pageStartIndex, pageStartIndex + pageSize);
  const hasNotes = notes.length > 0;
  const hasFilteredNotes = totalNotes > 0;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    sortOption,
    sortDirection,
    pageSize,
    showFavoritesOnly,
    selectedCabinetId,
    selectedItemId,
    tagFilter,
  ]);

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
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {note.linkedCabinetIds.map((cabinetId) => {
                  const name = cabinetNameMap.get(cabinetId);
                  if (!name) {
                    return null;
                  }
                  const locked = cabinetLockMap.get(cabinetId) ?? false;
                  return (
                    <span key={`cabinet-${cabinetId}`}>
                      {locked ? (
                        <button
                          type="button"
                          onClick={showCabinetLockedAlert}
                          className="inline-flex items-center rounded-full border border-dashed border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-500"
                        >
                          🔒 櫃：{name}
                        </button>
                      ) : (
                        <Link
                          href={`/cabinet/${cabinetId}`}
                          className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-600 transition hover:bg-indigo-100"
                        >
                          櫃：{name}
                        </Link>
                      )}
                    </span>
                  );
                })}
                {note.linkedItemIds.map((itemId) => {
                  const option = itemOptionMap.get(itemId);
                  if (!option) {
                    return null;
                  }
                  const cabinetLabel = option.cabinetId
                    ? cabinetNameMap.get(option.cabinetId) ?? null
                    : null;
                  const locked = option.cabinetId
                    ? cabinetLockMap.get(option.cabinetId) ?? false
                    : false;
                  return (
                    <span key={`item-${option.id}`}>
                      {locked ? (
                        <button
                          type="button"
                          onClick={showItemLockedAlert}
                          className="inline-flex items-center rounded-full border border-dashed border-sky-200 bg-sky-50 px-2 py-1 font-medium text-sky-500"
                        >
                          🔒 作：{option.title}
                          {cabinetLabel ? (
                            <span className="ml-1 text-[11px] text-sky-500">（{cabinetLabel}）</span>
                          ) : null}
                        </button>
                      ) : (
                        <Link
                          href={`/item/${option.id}`}
                          className="inline-flex items-center rounded-full bg-sky-100 px-2 py-1 font-medium text-sky-600 transition hover:bg-sky-100/80"
                        >
                          作：{option.title}
                          {cabinetLabel ? (
                            <span className="ml-1 text-[11px] text-sky-600">（{cabinetLabel}）</span>
                          ) : null}
                        </Link>
                      )}
                    </span>
                  );
                })}
              </div>
              {note.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    );
  }, [cabinetLockMap, cabinetNameMap, hasFilteredNotes, hasNotes, itemOptionMap, paginatedNotes, showCabinetLockedAlert, showItemLockedAlert]);

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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTagManagerOpen(true)}
              className={buttonClass({ variant: "secondary" })}
            >
              筆記標籤管理
            </button>
            <Link href="/notes/new" className={buttonClass({ variant: "primary" })}>
              新增筆記
            </Link>
          </div>
        </header>
        {tagManagerStatus.error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {tagManagerStatus.error}
          </div>
        ) : null}
        {tagManagerStatus.message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {tagManagerStatus.message}
          </div>
        ) : null}
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
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <label className="flex flex-1 flex-col space-y-1">
                  <span className="text-sm text-gray-600">櫃子</span>
                  <select
                    value={selectedCabinetId}
                    onChange={(event) => setSelectedCabinetId(event.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-base"
                  >
                    <option value="">全部櫃子</option>
                    {cabinetOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col space-y-1">
                  <span className="text-sm text-gray-600">作品</span>
                  <select
                    value={selectedItemId}
                    onChange={(event) => setSelectedItemId(event.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-base"
                  >
                    <option value="">全部作品</option>
                    {itemOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
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
                <div className="flex flex-1 min-w-[220px] flex-col space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex flex-1 flex-col space-y-1">
                      <span className="text-sm text-gray-600">標籤</span>
                      <input
                        value={tagFilter}
                        onChange={(event) => setTagFilter(event.target.value)}
                        placeholder="輸入標籤名稱或點選建議"
                        className="h-12 w-full rounded-xl border px-4 text-base"
                      />
                    </div>
                    {tagFilter ? (
                      <button
                        type="button"
                        onClick={() => setTagFilter("")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        清除
                      </button>
                    ) : null}
                  </div>
                  {noteTags.length === 0 ? (
                    <p className="text-xs text-gray-400">尚未建立任何筆記標籤。</p>
                  ) : filteredTagSuggestions.length === 0 ? (
                    <p className="text-xs text-gray-400">找不到符合的標籤建議。</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {filteredTagSuggestions.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setTagFilter(tag)}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-gray-400">可新增至 {NOTE_TAG_LIMIT} 個標籤，使用標籤管理調整列表。</span>
                </div>
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
      <NoteTagQuickEditor
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        userId={user.uid}
        tags={noteTags}
        onTagsChange={(nextTags) => {
          setNoteTags(nextTags);
          setTagManagerStatus({ message: null, error: null });
        }}
        onTagRenamed={(previousTag, nextTag) => {
          if (tagFilter === previousTag) {
            setTagFilter(nextTag);
          }
        }}
        onTagDeleted={(target) => {
          if (tagFilter === target) {
            setTagFilter("");
          }
        }}
        onStatus={(status) => {
          setTagManagerStatus({
            message: status.message ?? null,
            error: status.error ?? null,
          });
        }}
      />
    </main>
  );
}
