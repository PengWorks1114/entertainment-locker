"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";

import ItemCard from "@/components/ItemCard";
import ItemListRow from "@/components/ItemListRow";
import ItemThumbCard from "@/components/ItemThumbCard";
import ItemImageCard from "@/components/ItemImageCard";
import { normalizeAppearanceRecords } from "@/lib/appearances";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";
import {
  ITEM_LANGUAGE_OPTIONS,
  ITEM_LANGUAGE_VALUES,
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_VALUES,
  UPDATE_FREQUENCY_VALUES,
  type ItemLanguage,
  type ItemRecord,
  type ItemStatus,
  type UpdateFrequency,
} from "@/lib/types";
import { normalizeThumbTransform } from "@/lib/image-utils";
import {
  buildInsightStorageList,
  normalizeInsightEntries,
} from "@/lib/insights";

type CabinetPageProps = {
  params: Promise<{ id: string }>;
};

type SortOption = "updated" | "title" | "rating" | "nextUpdate" | "created";
type SortDirection = "asc" | "desc";
type HasNextUpdateFilter = "all" | "yes" | "no";
type ViewMode = "grid" | "thumb" | "image" | "list";

type FilterState = {
  search: string;
  status: ItemStatus | "all";
  language: ItemLanguage | "";
  ratingMin: string;
  ratingMax: string;
  hasNextUpdate: HasNextUpdateFilter;
  favoritesOnly: boolean;
  sort: SortOption;
  sortDirection: SortDirection;
  tags: string[];
  pageSize: number;
};

const PAGE_SIZE_OPTIONS = [10, 15, 20, 30, 40, 50, 100] as const;
const VIEW_MODE_STORAGE_PREFIX = "cabinet-view-mode";
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "grid", label: "詳細" },
  { value: "thumb", label: "簡略" },
  { value: "image", label: "圖片" },
  { value: "list", label: "列表" },
];

function getPaginationRange(totalPages: number, currentPage: number): (number | "ellipsis")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    pages.push("ellipsis");
  }

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (end < totalPages - 1) {
    pages.push("ellipsis");
  }

  pages.push(totalPages);
  return pages;
}

const defaultFilters: FilterState = {
  search: "",
  status: "all",
  language: "",
  ratingMin: "",
  ratingMax: "",
  hasNextUpdate: "all",
  favoritesOnly: false,
  sort: "updated",
  sortDirection: "desc",
  tags: [],
  pageSize: PAGE_SIZE_OPTIONS[0],
};

function parseTagsFromParams(params: ReturnType<typeof useSearchParams>): string[] {
  const list: string[] = [];
  params.getAll("tag").forEach((tag) => {
    const trimmed = tag.trim();
    if (trimmed) {
      list.push(trimmed);
    }
  });
  const combined = params.get("tags");
  if (combined) {
    combined.split(",").forEach((entry) => {
      const trimmed = entry.trim();
      if (trimmed) {
        list.push(trimmed);
      }
    });
  }
  return Array.from(new Set(list));
}

function parseLanguageFromParams(
  params: ReturnType<typeof useSearchParams>
): ItemLanguage | "" {
  const value = params.get("language");
  if (value && ITEM_LANGUAGE_VALUES.includes(value as ItemLanguage)) {
    return value as ItemLanguage;
  }
  return "";
}

function normalizeCabinetTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(
      input
        .map((tag) => String(tag ?? "").trim())
        .filter((tag): tag is string => tag.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export default function CabinetDetailPage({ params }: CabinetPageProps) {
  const { id: cabinetId } = use(params);
  const searchParams = useSearchParams();
  const storageKey = `${VIEW_MODE_STORAGE_PREFIX}:${cabinetId}`;
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cabinetName, setCabinetName] = useState<string>("");
  const [cabinetLoading, setCabinetLoading] = useState(true);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [canView, setCanView] = useState(false);
  const [cabinetNote, setCabinetNote] = useState<string | null>(null);
  const [cabinetLocked, setCabinetLocked] = useState(false);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...defaultFilters,
    language: parseLanguageFromParams(searchParams),
    tags: parseTagsFromParams(searchParams),
  }));
  const [currentPage, setCurrentPage] = useState(1);
  const hasInitializedPage = useRef(false);
  const [tagQuery, setTagQuery] = useState("");
  const [cabinetTags, setCabinetTags] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") {
      return "grid";
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "grid" || stored === "thumb" || stored === "list" || stored === "image") {
      return stored;
    }
    return "grid";
  });
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const filtersContentId = "cabinet-filter-panel";

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setCabinetLoading(false);
      setItemsLoading(false);
      setCabinetError("Firebase 尚未設定");
      setListError("Firebase 尚未設定");
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
      setCabinetName("");
      setCabinetError(null);
      setCanView(false);
      setCabinetNote(null);
      setCabinetLoading(false);
      setCabinetTags([]);
      setCabinetLocked(false);
      return;
    }
    let active = true;
    setCabinetLoading(true);
    setCabinetError(null);
    setCanView(false);
    setCabinetNote(null);
    setCabinetLocked(false);
    const db = getFirebaseDb();
    if (!db) {
      setCabinetError("Firebase 尚未設定");
      setCabinetLoading(false);
      setCabinetNote(null);
      setCabinetTags([]);
      return;
    }
    const cabinetRef = doc(db, "cabinet", cabinetId);
    getDoc(cabinetRef)
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setCabinetError("找不到櫃子");
          setCabinetNote(null);
          setCabinetLoading(false);
          setCabinetTags([]);
          setCabinetLocked(false);
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setCabinetError("您沒有存取此櫃子的權限");
          setCabinetNote(null);
          setCabinetLoading(false);
          setCabinetTags([]);
          setCabinetLocked(false);
          return;
        }
        if (data?.isLocked) {
          setCabinetError("此櫃子已鎖定，無法瀏覽內容。請於編輯頁面解除鎖定後再試一次。");
          setCabinetNote(null);
          setCabinetLoading(false);
          setCabinetTags([]);
          setCabinetLocked(true);
          return;
        }
        const name = typeof data?.name === "string" && data.name ? data.name : "未命名櫃子";
        const note =
          typeof data?.note === "string" && data.note.trim().length > 0
            ? data.note.trim()
            : null;
        setCabinetName(name);
        setCanView(true);
        setCabinetNote(note);
        setCabinetTags(normalizeCabinetTags(data?.tags));
        setCabinetLocked(false);
        setCabinetLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setCabinetError("載入櫃子資訊時發生錯誤");
        setCabinetNote(null);
        setCabinetLoading(false);
        setCabinetTags([]);
        setCabinetLocked(false);
      });
    return () => {
      active = false;
    };
  }, [user, cabinetId]);

  useEffect(() => {
    if (!user || !canView) {
      setItems([]);
      setItemsLoading(false);
      return;
    }
    setItemsLoading(true);
    const db = getFirebaseDb();
    if (!db) {
      setListError("Firebase 尚未設定");
      setItems([]);
      setItemsLoading(false);
      return;
    }
    const q = query(
      collection(db, "item"),
      where("uid", "==", user.uid),
      where("cabinetId", "==", cabinetId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: ItemRecord[] = snap.docs.map((docSnap) => {
          const data = docSnap.data();
          const statusValue =
            typeof data.status === "string" &&
            ITEM_STATUS_VALUES.includes(data.status as ItemStatus)
              ? (data.status as ItemStatus)
              : "planning";
          const updateFrequency =
            typeof data.updateFrequency === "string" &&
            UPDATE_FREQUENCY_VALUES.includes(data.updateFrequency as UpdateFrequency)
              ? (data.updateFrequency as UpdateFrequency)
              : null;
          const ratingValue =
            typeof data.rating === "number" && Number.isFinite(data.rating)
              ? data.rating
              : null;
          const tags = Array.isArray(data.tags)
            ? data.tags
                .map((tag: unknown) => String(tag ?? ""))
                .filter((tag) => tag.length > 0)
            : [];
          const links = Array.isArray(data.links)
            ? data.links
                .map((link) => {
                  const record = link as { label?: unknown; url?: unknown };
                  const label = typeof record.label === "string" ? record.label : "";
                  const url = typeof record.url === "string" ? record.url : "";
                  return { label, url };
                })
                .filter((link) => link.label && link.url)
            : [];
          const appearances = normalizeAppearanceRecords(data.appearances);
          const rawInsightNotes =
            Array.isArray(data.insightNotes) && data.insightNotes.length > 0
              ? data.insightNotes
              : typeof data.insightNote === "string"
                ? data.insightNote
                : [];
          const insightNotes = buildInsightStorageList(
            normalizeInsightEntries(rawInsightNotes)
          );
          return {
            id: docSnap.id,
            uid: typeof data.uid === "string" ? data.uid : user.uid,
            cabinetId: typeof data.cabinetId === "string" ? data.cabinetId : cabinetId,
            titleZh:
              typeof data.titleZh === "string" && data.titleZh ? data.titleZh : "(未命名物件)",
            titleAlt: typeof data.titleAlt === "string" ? data.titleAlt : null,
            author: typeof data.author === "string" ? data.author : null,
            language:
              typeof data.language === "string" &&
              ITEM_LANGUAGE_VALUES.includes(data.language as ItemLanguage)
                ? (data.language as ItemLanguage)
                : null,
            tags,
            links,
            thumbUrl: typeof data.thumbUrl === "string" ? data.thumbUrl : null,
            thumbTransform: data.thumbTransform
              ? normalizeThumbTransform(data.thumbTransform)
              : null,
            isFavorite: Boolean(data.isFavorite),
            progressNote:
              typeof data.progressNote === "string" ? data.progressNote : null,
            insightNote:
              typeof data.insightNote === "string" ? data.insightNote : null,
            insightNotes,
            note: typeof data.note === "string" ? data.note : null,
            appearances,
            rating: ratingValue,
            status: statusValue,
            updateFrequency,
            nextUpdateAt:
              data.nextUpdateAt instanceof Timestamp
                ? (data.nextUpdateAt as Timestamp)
                : null,
            createdAt:
              data.createdAt instanceof Timestamp ? (data.createdAt as Timestamp) : null,
            updatedAt:
              data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
          } satisfies ItemRecord;
        });
        setItems(rows);
        setItemsLoading(false);
        setListError(null);
      },
      (err) => {
        console.error("載入物件列表失敗", err);
        setListError("載入物件列表失敗");
        setItemsLoading(false);
      }
    );
    return () => unsub();
  }, [user, canView, cabinetId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    filters.search,
    filters.status,
    filters.language,
    filters.ratingMin,
    filters.ratingMax,
    filters.hasNextUpdate,
    filters.favoritesOnly,
    filters.sort,
    filters.tags,
    filters.pageSize,
  ]);

  useEffect(() => {
    const tagsFromParams = parseTagsFromParams(searchParams);
    const languageFromParams = parseLanguageFromParams(searchParams);
    setFilters((prev) => {
      const prevSet = new Set(prev.tags);
      const nextList = tagsFromParams;
      const nextSet = new Set(nextList);
      const sameSize = prevSet.size === nextSet.size;
      const sameTags =
        sameSize && Array.from(prevSet).every((tag) => nextSet.has(tag));
      const sameLanguage = prev.language === languageFromParams;
      if (sameTags && sameLanguage) {
        return prev;
      }
      return {
        ...prev,
        tags: sameTags ? prev.tags : nextList,
        language: languageFromParams,
      };
    });
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "grid" || stored === "list" || stored === "thumb" || stored === "image") {
      setViewMode(stored);
    }
  }, [cabinetId, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey, viewMode);
  }, [viewMode, storageKey]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>(cabinetTags);
    items.forEach((item) => {
      item.tags.forEach((tag) => {
        if (tag.trim().length > 0) {
          tagSet.add(tag);
        }
      });
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }, [items, cabinetTags]);

  const filteredAvailableTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    return availableTags.filter((tag) => {
      if (filters.tags.includes(tag)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return tag.toLowerCase().includes(query);
    });
  }, [availableTags, filters.tags, tagQuery]);

  const filteredItems = useMemo(() => {
    const searchTerm = filters.search.trim().toLowerCase();
    const ratingMinValue = Number.parseFloat(filters.ratingMin);
    const ratingMaxValue = Number.parseFloat(filters.ratingMax);
    const hasMin = Number.isFinite(ratingMinValue);
    const hasMax = Number.isFinite(ratingMaxValue);

    const matches = items.filter((item) => {
      if (searchTerm) {
        const haystack = [item.titleZh, item.titleAlt ?? "", item.author ?? ""]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchTerm)) {
          return false;
        }
      }
      if (filters.status !== "all" && item.status !== filters.status) {
        return false;
      }
      if (filters.language && item.language !== filters.language) {
        return false;
      }
      const rating =
        typeof item.rating === "number" && Number.isFinite(item.rating)
          ? item.rating
          : null;
      if (hasMin && (rating ?? -Infinity) < ratingMinValue) {
        return false;
      }
      if (hasMax && (rating ?? Infinity) > ratingMaxValue) {
        return false;
      }
      if (filters.hasNextUpdate === "yes" && !item.nextUpdateAt) {
        return false;
      }
      if (filters.hasNextUpdate === "no" && item.nextUpdateAt) {
        return false;
      }
      if (filters.favoritesOnly && !item.isFavorite) {
        return false;
      }
      if (
        filters.tags.length > 0 &&
        !filters.tags.every((tag) => item.tags.includes(tag))
      ) {
        return false;
      }
      return true;
    });

    const sorted = [...matches].sort((a, b) => {
      const direction = filters.sortDirection === "asc" ? 1 : -1;
      switch (filters.sort) {
        case "title":
          return direction * a.titleZh.localeCompare(b.titleZh, "zh-Hant");
        case "rating": {
          const fallback = filters.sortDirection === "asc" ? Infinity : -Infinity;
          const ratingA =
            typeof a.rating === "number" && Number.isFinite(a.rating)
              ? a.rating
              : fallback;
          const ratingB =
            typeof b.rating === "number" && Number.isFinite(b.rating)
              ? b.rating
              : fallback;
          return direction * (ratingA - ratingB);
        }
        case "nextUpdate": {
          const fallback = filters.sortDirection === "asc" ? Infinity : -Infinity;
          const timeA = a.nextUpdateAt ? a.nextUpdateAt.toMillis() : fallback;
          const timeB = b.nextUpdateAt ? b.nextUpdateAt.toMillis() : fallback;
          return direction * (timeA - timeB);
        }
        case "created": {
          const fallback = filters.sortDirection === "asc" ? Infinity : -Infinity;
          const timeA = a.createdAt ? a.createdAt.toMillis() : fallback;
          const timeB = b.createdAt ? b.createdAt.toMillis() : fallback;
          return direction * (timeA - timeB);
        }
        case "updated":
        default: {
          const fallback = filters.sortDirection === "asc" ? Infinity : -Infinity;
          const timeA = a.updatedAt ? a.updatedAt.toMillis() : fallback;
          const timeB = b.updatedAt ? b.updatedAt.toMillis() : fallback;
          return direction * (timeA - timeB);
        }
      }
    });

    return sorted;
  }, [items, filters]);

  const highlightQuery = filters.search.trim();
  const pageSize = filters.pageSize || PAGE_SIZE_OPTIONS[0];
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const visibleItems = filteredItems.slice(startIndex, startIndex + pageSize);
  const pageRange = getPaginationRange(totalPages, currentPage);
  const rangeStart = filteredItems.length === 0 ? 0 : startIndex + 1;
  const rangeEnd = Math.min(filteredItems.length, startIndex + visibleItems.length);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!hasInitializedPage.current) {
      hasInitializedPage.current = true;
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage]);
  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.language !== defaultFilters.language ||
    filters.ratingMin.trim().length > 0 ||
    filters.ratingMax.trim().length > 0 ||
    filters.hasNextUpdate !== "all" ||
    filters.favoritesOnly ||
    filters.sort !== defaultFilters.sort ||
    filters.sortDirection !== defaultFilters.sortDirection ||
    filters.tags.length > 0 ||
    filters.pageSize !== defaultFilters.pageSize;

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function addTagFilter(tag: string) {
    const normalized = tag.trim();
    if (!normalized) return;
    setFilters((prev) => {
      if (prev.tags.includes(normalized)) {
        return prev;
      }
      return { ...prev, tags: [...prev.tags, normalized] };
    });
  }

  function removeTagFilter(tag: string) {
    setFilters((prev) => ({
      ...prev,
      tags: prev.tags.filter((itemTag) => itemTag !== tag),
    }));
  }

  function toggleTagFilter(tag: string) {
    setFilters((prev) => {
      if (prev.tags.includes(tag)) {
        return {
          ...prev,
          tags: prev.tags.filter((itemTag) => itemTag !== tag),
        };
      }
      return { ...prev, tags: [...prev.tags, tag] };
    });
  }

  function handleTagSubmit() {
    const trimmed = tagQuery.trim();
    if (!trimmed) return;
    addTagFilter(trimmed);
    setTagQuery("");
  }

  function resetFilters() {
    setFilters({ ...defaultFilters });
    setTagQuery("");
  }

  function toggleFiltersCollapsed() {
    setFiltersCollapsed((prev) => !prev);
  }

  const inputClass = "h-12 rounded-xl border px-4 text-base";
  const selectClass = "h-12 rounded-xl border px-4 text-base";
  const smallInputClass = "h-10 w-full rounded-lg border px-3 text-sm";

  if (!authChecked) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="break-anywhere text-2xl font-semibold text-gray-900">櫃子內容</h1>
          <p className="text-base text-gray-600">
            未登入。請先前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            後再查看櫃子，或前往
            <Link href="/" className="ml-1 underline">
              首頁
            </Link>
            選擇其他操作。
          </p>
        </div>
      </main>
    );
  }

  if (cabinetLoading) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在載入櫃子資訊…
        </div>
      </main>
    );
  }

  if (cabinetError) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="break-anywhere text-2xl font-semibold text-gray-900">櫃子內容</h1>
          <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {cabinetError}
          </div>
          {cabinetLocked && (
            <Link
              href={`/cabinet/${encodeURIComponent(cabinetId)}/edit`}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            >
              前往編輯櫃子
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="break-anywhere text-2xl font-semibold text-gray-900">{cabinetName}</h1>
            {cabinetNote && (
              <p className="break-anywhere text-sm text-gray-600">{cabinetNote}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            <Link
              href={`/item/new?cabinetId=${encodeURIComponent(cabinetId)}`}
              className={`${buttonClass({ variant: "accent" })} w-full sm:w-auto`}
            >
              在此櫃子新增物件
            </Link>
            <Link
              href={`/cabinet/${encodeURIComponent(cabinetId)}/tags`}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            >
              標籤管理
            </Link>
            <Link
              href={`/cabinet/${encodeURIComponent(cabinetId)}/trash`}
              className={`${buttonClass({ variant: "danger" })} w-full sm:w-auto`}
            >
              垃圾桶
            </Link>
            <Link
              href={`/cabinet/${encodeURIComponent(cabinetId)}/edit`}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            >
              編輯櫃子
            </Link>
          </div>
        </header>

        <section className="rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">搜尋與篩選</h2>
              <p className="text-xs text-gray-500">調整條件以快速找到作品。</p>
            </div>
            <button
              type="button"
              onClick={toggleFiltersCollapsed}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 transition hover:bg-gray-100"
              aria-expanded={!filtersCollapsed}
              aria-controls={filtersContentId}
            >
              {filtersCollapsed ? "展開" : "收合"}
            </button>
          </div>

          <div
            id={filtersContentId}
            className="mt-4 space-y-4"
            hidden={filtersCollapsed}
            aria-hidden={filtersCollapsed}
          >
            <div className="grid gap-4 lg:grid-cols-5">
              <label className="space-y-1">
                <span className="text-sm text-gray-600">搜尋作品</span>
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="中文 / 原文 / 作者"
                  className={`${inputClass} w-full`}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-600">狀態</span>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    updateFilter("status", event.target.value as ItemStatus | "all")
                  }
                  className={`${selectClass} w-full`}
                >
                  <option value="all">全部狀態</option>
                  {ITEM_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-600">語言</span>
                <select
                  value={filters.language}
                  onChange={(event) =>
                    updateFilter(
                      "language",
                      event.target.value as ItemLanguage | ""
                    )
                  }
                  className={`${selectClass} w-full`}
                >
                  <option value="">全部語言</option>
                  {ITEM_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-600">評分下限</span>
                <input
                  value={filters.ratingMin}
                  onChange={(event) => updateFilter("ratingMin", event.target.value)}
                  placeholder="例如：7"
                  className={smallInputClass}
                  inputMode="decimal"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-600">評分上限</span>
                <input
                  value={filters.ratingMax}
                  onChange={(event) => updateFilter("ratingMax", event.target.value)}
                  placeholder="例如：9.5"
                  className={smallInputClass}
                  inputMode="decimal"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm text-gray-600">下次更新</span>
                <select
                  value={filters.hasNextUpdate}
                  onChange={(event) =>
                    updateFilter("hasNextUpdate", event.target.value as HasNextUpdateFilter)
                  }
                  className={`${selectClass} w-full`}
                >
                  <option value="all">全部</option>
                  <option value="yes">僅顯示有下一次提醒</option>
                  <option value="no">僅顯示未設定提醒</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-600">排序方式</span>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={filters.sort}
                    onChange={(event) =>
                      updateFilter("sort", event.target.value as SortOption)
                    }
                    className={`${selectClass} flex-1 min-w-[10rem]`}
                  >
                    <option value="updated">最近更新</option>
                    <option value="created">建立時間</option>
                    <option value="rating">評分最高</option>
                    <option value="title">名稱 A → Z</option>
                    <option value="nextUpdate">下次更新時間</option>
                  </select>
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        name="sortDirection"
                        value="asc"
                        checked={filters.sortDirection === "asc"}
                        onChange={(event) =>
                          event.target.checked && updateFilter("sortDirection", "asc")
                        }
                        className="h-4 w-4"
                      />
                      正序
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="radio"
                        name="sortDirection"
                        value="desc"
                        checked={filters.sortDirection === "desc"}
                        onChange={(event) =>
                          event.target.checked && updateFilter("sortDirection", "desc")
                        }
                        className="h-4 w-4"
                      />
                      反序
                    </label>
                  </div>
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-sm text-gray-600">每頁顯示數量</span>
                <select
                  value={filters.pageSize}
                  onChange={(event) =>
                    updateFilter("pageSize", Number(event.target.value))
                  }
                  className={`${selectClass} w-full`}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      每頁 {size} 筆
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filters.favoritesOnly}
                  onChange={(event) =>
                    updateFilter("favoritesOnly", event.target.checked)
                  }
                  className="h-4 w-4 accent-red-500"
                />
                只顯示最愛
              </label>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-sm text-gray-600">標籤篩選</span>
                <p className="text-xs text-gray-500">
                  可加入多個標籤，僅顯示同時符合所有標籤的作品。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {filters.tags.length === 0 ? (
                  <span className="text-xs text-gray-400">目前未選擇標籤</span>
                ) : (
                  filters.tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => removeTagFilter(tag)}
                        className="rounded-full bg-blue-100 px-1 text-[10px] text-blue-600 transition hover:bg-blue-200"
                        aria-label={`移除標籤 ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:flex-nowrap">
                <input
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleTagSubmit();
                    }
                  }}
                  placeholder="輸入或搜尋標籤"
                  className={`${inputClass} flex-1 min-w-[8rem]`}
                />
                <button
                  type="button"
                  onClick={handleTagSubmit}
                  className={`${buttonClass({ variant: "secondary" })} h-auto min-h-[2.5rem] flex-none whitespace-pre-line px-4 text-center leading-tight`}
                >
                  {"加入\n標籤"}
                </button>
              </div>
              {availableTags.length > 0 && (
                filteredAvailableTags.length > 0 ? (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-500">快速加入：</span>
                    <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                      {filteredAvailableTags.map((tag) => {
                        const isSelected = filters.tags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTagFilter(tag)}
                            className={`rounded-full border px-3 py-1 text-xs transition ${
                              isSelected
                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                            }`}
                          >
                            #{tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">找不到符合的標籤，可直接輸入新增。</p>
                )
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
            <span>共 {filteredItems.length} 件物件</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex overflow-hidden rounded-full border border-gray-200 bg-white">
                {VIEW_OPTIONS.map((option) => {
                  const isActive = viewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setViewMode(option.value)}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-gray-900 text-white shadow-sm"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      }`}
                      aria-pressed={isActive}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className={buttonClass({ variant: "subtle", size: "sm" })}
                >
                  重設篩選
                </button>
              )}
            </div>
          </div>
        </section>

        {listError && (
          <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {listError}
          </div>
        )}

        <section className="space-y-4">
          {itemsLoading ? (
            <div className="rounded-2xl border bg-white/70 p-6 text-center text-sm text-gray-600">
              物件載入中…
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-white/60 p-6 text-center text-sm text-gray-500">
              查無符合條件的物件。
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleItems.map((item) => (
                <ItemCard key={item.id} item={item} searchTerm={highlightQuery} />
              ))}
            </div>
          ) : viewMode === "thumb" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleItems.map((item) => (
                <ItemThumbCard key={item.id} item={item} searchTerm={highlightQuery} />
              ))}
            </div>
          ) : viewMode === "image" ? (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleItems.map((item) => (
                <ItemImageCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => (
                <ItemListRow key={item.id} item={item} searchTerm={highlightQuery} />
              ))}
            </div>
          )}
          {!itemsLoading && visibleItems.length > 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border bg-white/70 p-4 text-sm text-gray-600 sm:flex-row sm:justify-between">
              <div>
                顯示第 {rangeStart} - {rangeEnd} 筆，共 {filteredItems.length} 件
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className={buttonClass({ variant: "subtle", size: "sm" })}
                >
                  最前頁
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className={buttonClass({ variant: "subtle", size: "sm" })}
                >
                  前頁
                </button>
                {pageRange.map((entry, index) =>
                  entry === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} className="px-1 text-gray-400">
                      …
                    </span>
                  ) : (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setCurrentPage(entry)}
                      className={
                        entry === currentPage
                          ? buttonClass({ variant: "primary", size: "sm" })
                          : buttonClass({ variant: "secondary", size: "sm" })
                      }
                    >
                      {entry}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className={buttonClass({ variant: "subtle", size: "sm" })}
                >
                  次頁
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className={buttonClass({ variant: "subtle", size: "sm" })}
                >
                  最後頁
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
