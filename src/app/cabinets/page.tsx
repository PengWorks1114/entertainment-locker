"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  clearIndexedDbPersistence,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  terminate,
  Timestamp,
  where,
  writeBatch,
  updateDoc,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import {
  DEFAULT_THUMB_TRANSFORM,
  isOptimizedImageUrl,
  normalizeThumbTransform,
} from "@/lib/image-utils";
import type { ThumbTransform } from "@/lib/types";
import { buttonClass } from "@/lib/ui";
import {
  invalidateCabinetOptions,
  primeCabinetOptionsCache,
} from "@/lib/cabinet-options";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

type Cabinet = {
  id: string;
  name: string;
  order: number;
  createdMs: number;
  updatedMs: number;
  note: string | null;
  thumbUrl: string | null;
  thumbTransform: ThumbTransform | null;
  isLocked: boolean;
  isFavorite: boolean;
};

type Feedback = {
  type: "error" | "success";
  message: string;
};

type SortOption = "custom" | "recentUpdated" | "created" | "name";
type SortDirection = "asc" | "desc";
type DisplayMode = "detailed" | "compact" | "list";

const DISPLAY_MODE_OPTIONS: { value: DisplayMode; label: string }[] = [
  { value: "detailed", label: "詳細" },
  { value: "compact", label: "簡略" },
  { value: "list", label: "列表" },
];

export default function CabinetsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [list, setList] = useState<Cabinet[]>([]);
  const [cabinetItemCounts, setCabinetItemCounts] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showReorder, setShowReorder] = useState(false);
  const [reorderList, setReorderList] = useState<Cabinet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderPage, setReorderPage] = useState(1);
  const manualReorderNavigationRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("custom");
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[1]);
  const [currentPage, setCurrentPage] = useState(1);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("detailed");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const canChangeSortDirection = sortOption !== "custom";
  const directionButtonClass = (direction: SortDirection) =>
    `${buttonClass({
      variant: sortDirection === direction ? "primary" : "secondary",
      size: "sm",
    })} whitespace-nowrap px-3`;

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      return undefined;
    }

    const unAuth = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthChecked(true);
    });
    return () => unAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setList([]);
      setCabinetItemCounts({});
      invalidateCabinetOptions();
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const q = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    const unSub = onSnapshot(
      q,
      (snap) => {
        const rows: Cabinet[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const createdAt = data?.createdAt;
            const createdMs =
              createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
            const updatedAt = data?.updatedAt;
            const updatedMs =
              updatedAt instanceof Timestamp ? updatedAt.toMillis() : createdMs;
            const orderValue =
              typeof data?.order === "number" ? data.order : createdMs;
            const noteValue =
              typeof data?.note === "string" && data.note.trim().length > 0
                ? data.note.trim()
                : null;
            return {
              id: docSnap.id,
              name: (data?.name as string) || "",
              createdMs,
              updatedMs,
              order: orderValue,
              note: noteValue,
              thumbUrl:
                typeof data?.thumbUrl === "string" && data.thumbUrl.trim().length > 0
                  ? data.thumbUrl.trim()
                  : null,
              thumbTransform: data?.thumbTransform
                ? normalizeThumbTransform(data.thumbTransform)
                : null,
              isLocked: Boolean(data?.isLocked),
              isFavorite: Boolean(data?.isFavorite),
            } satisfies Cabinet;
          })
          .sort((a, b) => {
            if (a.order === b.order) {
              return b.createdMs - a.createdMs;
            }
            return b.order - a.order;
          });
        setList(rows);
        primeCabinetOptionsCache(
          user.uid,
          rows.map((item) => ({ id: item.id, name: item.name, isLocked: item.isLocked }))
        );
        setFeedback((prev) => (prev?.type === "error" ? null : prev));
      },
      () => {
        setFeedback({ type: "error", message: "載入櫃子清單時發生錯誤" });
        invalidateCabinetOptions(user.uid);
      }
    );
    return () => unSub();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCabinetItemCounts({});
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setCabinetItemCounts({});
      return;
    }
    const q = query(collection(db, "item"), where("uid", "==", user.uid));
    const unSub = onSnapshot(
      q,
      (snap) => {
        const counts: Record<string, number> = {};
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const rawCabinetId =
            typeof data?.cabinetId === "string" ? data.cabinetId.trim() : "";
          if (!rawCabinetId) {
            return;
          }
          counts[rawCabinetId] = (counts[rawCabinetId] ?? 0) + 1;
        });
        setCabinetItemCounts(counts);
      },
      () => {
        setCabinetItemCounts({});
      }
    );
    return () => unSub();
  }, [user]);

  const hasCabinet = list.length > 0;

  const filteredList = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return list.filter((item) => {
      if (favoritesOnly && !item.isFavorite) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const nameMatch = item.name.toLowerCase().includes(keyword);
      const noteMatch = (item.note ?? "").toLowerCase().includes(keyword);
      return nameMatch || noteMatch;
    });
  }, [favoritesOnly, list, searchTerm]);

  const sortedList = useMemo(() => {
    if (sortOption === "custom") {
      return filteredList;
    }
    const base = [...filteredList];
    const directionFactor = sortDirection === "asc" ? 1 : -1;
    switch (sortOption) {
      case "recentUpdated":
        base.sort((a, b) => (a.updatedMs - b.updatedMs) * directionFactor);
        break;
      case "created":
        base.sort((a, b) => (a.createdMs - b.createdMs) * directionFactor);
        break;
      case "name": {
        const fallback = "未命名櫃子";
        base.sort(
          (a, b) =>
            (a.name || fallback).localeCompare(b.name || fallback, "zh-Hant") *
            directionFactor
        );
        break;
      }
      default:
        break;
    }
    return base;
  }, [filteredList, sortDirection, sortOption]);

  const totalPages = Math.max(1, Math.ceil(sortedList.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pageNumbers = useMemo(
    () => Array.from({ length: totalPages }, (_, index) => index + 1),
    [totalPages]
  );
  const pageStartIndex = (currentPageSafe - 1) * pageSize;
  const pageItems = sortedList.slice(pageStartIndex, pageStartIndex + pageSize);
  const reorderPageSize = pageSize;
  const reorderTotalPages = Math.max(
    1,
    Math.ceil(reorderList.length / reorderPageSize)
  );
  const reorderCurrentPageSafe = Math.min(reorderPage, reorderTotalPages);
  const reorderPageStartIndex = (reorderCurrentPageSafe - 1) * reorderPageSize;
  const reorderPageItems = reorderList.slice(
    reorderPageStartIndex,
    reorderPageStartIndex + reorderPageSize
  );
  const reorderPageNumbers = useMemo(
    () => Array.from({ length: reorderTotalPages }, (_, index) => index + 1),
    [reorderTotalPages]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [favoritesOnly, list.length, pageSize, searchTerm, sortDirection, sortOption]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPageSafe]);

  useEffect(() => {
    setReorderPage((prev) => Math.min(prev, reorderTotalPages));
  }, [reorderTotalPages]);

  useEffect(() => {
    if (!selectedId) {
      manualReorderNavigationRef.current = false;
      return;
    }
    const targetIndex = reorderList.findIndex((item) => item.id === selectedId);
    if (targetIndex === -1) {
      manualReorderNavigationRef.current = false;
      return;
    }
    const targetPage = Math.floor(targetIndex / reorderPageSize) + 1;
    if (targetPage !== reorderCurrentPageSafe) {
      if (manualReorderNavigationRef.current) {
        manualReorderNavigationRef.current = false;
        return;
      }
      setReorderPage(targetPage);
    } else {
      manualReorderNavigationRef.current = false;
    }
  }, [reorderCurrentPageSafe, reorderList, reorderPageSize, selectedId]);

  function setReorderPageManually(
    next: number | ((prev: number) => number)
  ) {
    manualReorderNavigationRef.current = true;
    if (typeof next === "function") {
      setReorderPage((prev) => next(prev));
    } else {
      setReorderPage(next);
    }
  }

  const feedbackNode = useMemo(() => {
    if (!feedback) return null;
    const baseClass =
      feedback.type === "error"
        ? "break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        : "break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700";
    return <div className={baseClass}>{feedback.message}</div>;
  }, [feedback]);

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return reorderList.findIndex((item) => item.id === selectedId);
  }, [reorderList, selectedId]);

  function openReorderDialog() {
    setReorderList(list.map((item) => ({ ...item })));
    setSelectedId(list[0]?.id ?? null);
    setReorderError(null);
    setReorderPage(currentPageSafe);
    setShowReorder(true);
  }

  function closeReorderDialog() {
    if (reorderSaving) return;
    setShowReorder(false);
    setReorderList([]);
    setSelectedId(null);
    setReorderError(null);
    setReorderPage(1);
  }

  function moveSelected(offset: -1 | 1) {
    if (selectedIndex < 0) {
      return;
    }
    const targetIndex = selectedIndex + offset;
    if (targetIndex < 0 || targetIndex >= reorderList.length) {
      return;
    }
    setReorderList((prev) => {
      const next = [...prev];
      const [item] = next.splice(selectedIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  function moveSelectedToEdge(position: "start" | "end") {
    if (selectedIndex < 0 || reorderList.length === 0) {
      return;
    }
    const targetIndex = position === "start" ? 0 : reorderList.length - 1;
    if (selectedIndex === targetIndex) {
      return;
    }
    setReorderList((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(selectedIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  async function saveReorder() {
    if (!user) {
      setReorderError("請先登入");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setReorderError("Firebase 尚未設定");
      return;
    }
    if (reorderList.length === 0) {
      setShowReorder(false);
      return;
    }
    setReorderSaving(true);
    setReorderError(null);
    try {
      const batch = writeBatch(db);
      const total = reorderList.length;
      reorderList.forEach((item, index) => {
        const cabinetRef = doc(db, "cabinet", item.id);
        const orderValue = total - index;
        batch.update(cabinetRef, {
          order: orderValue,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setFeedback({ type: "success", message: "已更新櫃子順序" });
      setShowReorder(false);
      setReorderList([]);
      setSelectedId(null);
      setReorderPage(1);
    } catch (err) {
      console.error("更新櫃子順序失敗", err);
      setReorderError("更新櫃子順序時發生錯誤");
    } finally {
      setReorderSaving(false);
    }
  }

  async function clearCache() {
    try {
      const db = getFirebaseDb();
      if (db) {
        await terminate(db);
      }
    } catch {}
    try {
      const db = getFirebaseDb();
      if (db) {
        await clearIndexedDbPersistence(db);
      }
    } catch {}
    location.reload();
  }

  async function toggleFavorite(cabinet: Cabinet) {
    if (!user) {
      setFeedback({ type: "error", message: "請先登入" });
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const nextValue = !cabinet.isFavorite;
    setList((prev) =>
      prev.map((item) =>
        item.id === cabinet.id ? { ...item, isFavorite: nextValue } : item
      )
    );
    try {
      const cabinetRef = doc(db, "cabinet", cabinet.id);
      await updateDoc(cabinetRef, {
        isFavorite: nextValue,
        updatedAt: serverTimestamp(),
      });
      setFeedback({
        type: "success",
        message: nextValue ? "已加入收藏" : "已從收藏移除",
      });
    } catch (err) {
      console.error("更新收藏狀態失敗", err);
      setList((prev) =>
        prev.map((item) =>
          item.id === cabinet.id ? { ...item, isFavorite: cabinet.isFavorite } : item
        )
      );
      setFeedback({ type: "error", message: "更新收藏狀態時發生錯誤" });
    }
  }

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
          <h1 className="text-2xl font-semibold text-gray-900">櫃子</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理櫃子，或回到
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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">櫃子</h1>
            <p className="text-sm text-gray-500">
              建立不同作品分類，方便在物件列表間切換與整理。
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            <button
              onClick={clearCache}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              title="清除本機 Firestore 快取並重新載入"
            >
              清除快取
            </button>
            <Link
              href="/cabinets/new"
              className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
            >
              新增櫃子
            </Link>
            <button
              onClick={openReorderDialog}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              disabled={!hasCabinet}
            >
              編輯順序
            </button>
          </div>
        </header>

        {feedbackNode}

        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">搜尋與篩選</h2>
              <p className="text-sm text-gray-500">
                找到目標櫃子、調整顯示方式與排序。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFiltersExpanded((prev) => !prev)}
              className={buttonClass({ variant: "secondary" })}
            >
              {filtersExpanded ? "收合" : "展開"}
            </button>
          </div>
          {filtersExpanded && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row">
                <label className="flex-1 space-y-1">
                  <span className="text-sm text-gray-600">搜尋櫃子</span>
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="輸入名稱或備註關鍵字"
                    className="h-12 w-full rounded-xl border px-4 text-base"
                  />
                </label>
                <label className="flex-1 space-y-1">
                  <span className="text-sm text-gray-600">排序方式</span>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={sortOption}
                      onChange={(event) => {
                        const nextOption = event.target.value as SortOption;
                        setSortOption(nextOption);
                        if (nextOption === "custom") {
                          setSortDirection("desc");
                        }
                      }}
                      className="h-12 w-full flex-1 rounded-xl border bg-white px-4 text-base"
                    >
                      <option value="custom">自訂</option>
                      <option value="recentUpdated">最近更新</option>
                      <option value="created">建立時間</option>
                      <option value="name">名稱</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSortDirection("asc")}
                        className={directionButtonClass("asc")}
                        disabled={!canChangeSortDirection}
                        aria-pressed={sortDirection === "asc"}
                      >
                        正序
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortDirection("desc")}
                        className={directionButtonClass("desc")}
                        disabled={!canChangeSortDirection}
                        aria-pressed={sortDirection === "desc"}
                      >
                        反序
                      </button>
                    </div>
                  </div>
                </label>
              </div>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <label className="flex flex-1 flex-col space-y-1">
                  <span className="text-sm text-gray-600">每頁顯示數量</span>
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-base"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={favoritesOnly}
                    onChange={(event) => setFavoritesOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  收藏
                </label>
                <div className="flex flex-1 flex-col space-y-1">
                  <span className="text-sm text-gray-600">顯示方式</span>
                  <div className="flex overflow-hidden rounded-full border border-gray-200 bg-white">
                    {DISPLAY_MODE_OPTIONS.map((option) => {
                      const isActive = displayMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDisplayMode(option.value)}
                          className={`flex-1 px-4 py-2 text-sm font-medium transition ${
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
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">我的櫃子</h2>
          {hasCabinet ? (
            pageItems.length > 0 ? (
              <div className="space-y-4">
                {displayMode === "detailed" && (
                  <ul className="space-y-4">
                    {pageItems.map((row) => {
                      const displayName = row.name || "未命名櫃子";
                      const encodedId = encodeURIComponent(row.id);
                      const thumbTransform =
                        row.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
                      const thumbStyle = {
                        transform: `translate(${thumbTransform.offsetX}%, ${thumbTransform.offsetY}%) scale(${thumbTransform.scale})`,
                        transformOrigin: "center",
                      } as const;
                      const canUseOptimizedThumb = isOptimizedImageUrl(row.thumbUrl);
                      const isLocked = row.isLocked;
                      const coverClassName =
                        "relative h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner";
                      const coverContent = row.thumbUrl ? (
                        canUseOptimizedThumb ? (
                          <Image
                            src={row.thumbUrl}
                            alt={`${displayName} 縮圖`}
                            fill
                            sizes="80px"
                            className="object-cover"
                            style={thumbStyle}
                            draggable={false}
                          />
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={row.thumbUrl}
                            alt={`${displayName} 縮圖`}
                            className="h-full w-full select-none object-cover"
                            style={thumbStyle}
                            loading="lazy"
                            draggable={false}
                          />
                        )
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-400">
                          無縮圖
                        </div>
                      );
                      const itemCount = cabinetItemCounts[row.id] ?? 0;
                      const itemCountLabel = `${itemCount} 個物件`;
                      return (
                        <li
                          key={row.id}
                          className="space-y-3 rounded-2xl border bg-white/70 p-5 shadow-sm"
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                            <div className="flex gap-4 sm:flex-1">
                              {isLocked ? (
                                <div
                                  className={`${coverClassName} cursor-not-allowed`}
                                  aria-disabled="true"
                                >
                                  {coverContent}
                                </div>
                              ) : (
                                <Link
                                  href={`/cabinet/${encodedId}`}
                                  className={`${coverClassName} transition hover:shadow-md`}
                                >
                                  {coverContent}
                                </Link>
                              )}
                              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  {isLocked ? (
                                    <span className="break-anywhere text-lg font-semibold text-gray-900">
                                      {displayName}
                                    </span>
                                  ) : (
                                    <Link
                                      href={`/cabinet/${encodedId}`}
                                      className="break-anywhere text-lg font-semibold text-gray-900 underline-offset-4 hover:underline"
                                    >
                                      {displayName}
                                    </Link>
                                  )}
                                  {isLocked && (
                                    <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                                      已鎖定
                                    </span>
                                  )}
                                  {row.isFavorite && (
                                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                                      收藏
                                    </span>
                                  )}
                                </div>
                                {row.note && (
                                  <p className="break-anywhere text-sm text-gray-600">{row.note}</p>
                                )}
                                <p className="text-xs text-gray-500">{itemCountLabel}</p>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 text-sm sm:flex-none sm:flex-row sm:flex-wrap sm:justify-end">
                              <button
                                type="button"
                                onClick={() => toggleFavorite(row)}
                                className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                              >
                                {row.isFavorite ? "取消收藏" : "加入收藏"}
                              </button>
                              {isLocked ? (
                                <span
                                  className={`${buttonClass({ variant: "secondary" })} w-full cursor-not-allowed whitespace-nowrap opacity-60 sm:w-auto`}
                                  aria-disabled="true"
                                >
                                  已鎖定
                                </span>
                              ) : (
                                <Link
                                  href={`/cabinet/${encodedId}`}
                                  className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                                >
                                  查看物件
                                </Link>
                              )}
                              <Link
                                href={`/cabinet/${encodedId}/edit`}
                                className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                              >
                                編輯櫃子
                              </Link>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {displayMode === "compact" && (
                  <ul className="space-y-3">
                    {pageItems.map((row) => {
                      const displayName = row.name || "未命名櫃子";
                      const encodedId = encodeURIComponent(row.id);
                      const itemCount = cabinetItemCounts[row.id] ?? 0;
                      const itemCountLabel = `${itemCount} 個物件`;
                      return (
                        <li
                          key={row.id}
                          className="rounded-2xl border bg-white/70 p-4 shadow-sm"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1 sm:flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/cabinet/${encodedId}`}
                                  className="block line-clamp-2 break-anywhere text-base font-semibold text-gray-900 underline-offset-4 hover:underline"
                                  title={displayName}
                                >
                                  {displayName}
                                </Link>
                                {row.isLocked && (
                                  <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                                    已鎖定
                                  </span>
                                )}
                                {row.isFavorite && (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                                    收藏
                                  </span>
                                )}
                              </div>
                              {row.note && (
                                <p
                                  className="line-clamp-2 break-anywhere text-sm text-gray-600"
                                  title={row.note}
                                >
                                  {row.note}
                                </p>
                              )}
                              <p className="text-xs text-gray-500">{itemCountLabel}</p>
                            </div>
                            <div className="flex flex-col gap-2 text-sm sm:flex-none sm:flex-row sm:flex-wrap sm:justify-end">
                              <button
                                type="button"
                                onClick={() => toggleFavorite(row)}
                                className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                              >
                                {row.isFavorite ? "取消收藏" : "加入收藏"}
                              </button>
                              <Link
                                href={`/cabinet/${encodedId}`}
                                className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                              >
                                查看物件
                              </Link>
                              <Link
                                href={`/cabinet/${encodedId}/edit`}
                                className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                              >
                                編輯櫃子
                              </Link>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {displayMode === "list" && (
                  <div className="overflow-x-auto rounded-2xl border bg-white/70 shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">名稱</th>
                          <th className="px-4 py-3">物件數量</th>
                          <th className="px-4 py-3">備註</th>
                          <th className="px-4 py-3">收藏</th>
                          <th className="px-4 py-3">狀態</th>
                          <th className="px-4 py-3">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {pageItems.map((row) => {
                          const encodedId = encodeURIComponent(row.id);
                          const itemCount = cabinetItemCounts[row.id] ?? 0;
                          const itemCountLabel = `${itemCount} 個物件`;
                          return (
                            <tr key={row.id} className="align-top">
                              <td className="max-w-[240px] px-4 py-3">
                                <Link
                                  href={`/cabinet/${encodedId}`}
                                  className="block line-clamp-2 break-anywhere font-medium text-gray-900 underline-offset-4 hover:underline"
                                  title={row.name || "未命名櫃子"}
                                >
                                  {row.name || "未命名櫃子"}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-gray-600">{itemCountLabel}</td>
                              <td className="max-w-[320px] px-4 py-3 text-gray-600">
                                {row.note ? (
                                  <span
                                    className="line-clamp-2 break-anywhere"
                                    title={row.note}
                                  >
                                    {row.note}
                                  </span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {row.isFavorite ? (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                                    收藏
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">未收藏</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {row.isLocked ? (
                                  <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                                    已鎖定
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                                    可使用
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleFavorite(row)}
                                    className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                                  >
                                    {row.isFavorite ? "取消收藏" : "加入收藏"}
                                  </button>
                                  <Link
                                    href={`/cabinet/${encodedId}`}
                                    className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                                  >
                                    查看物件
                                  </Link>
                                  <Link
                                    href={`/cabinet/${encodedId}/edit`}
                                    className={`${buttonClass({ variant: "secondary" })} w-full whitespace-nowrap sm:w-auto`}
                                  >
                                    編輯櫃子
                                  </Link>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {totalPages > 1 && (
                  <div className="flex flex-col gap-3 rounded-2xl border bg-white/70 p-4 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-gray-600">
                      第 {currentPageSafe} / {totalPages} 頁，共 {sortedList.length} 筆
                    </span>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-gray-700">
                        <span>頁面</span>
                        <select
                          value={currentPageSafe}
                          onChange={(event) => setCurrentPage(Number(event.target.value))}
                          className="h-10 rounded-xl border bg-white px-3"
                        >
                          {pageNumbers.map((pageNumber) => (
                            <option key={pageNumber} value={pageNumber}>
                              {pageNumber}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                          disabled={currentPageSafe <= 1}
                          className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          上一頁
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setCurrentPage((prev) =>
                              prev >= totalPages ? totalPages : prev + 1
                            )
                          }
                          disabled={currentPageSafe >= totalPages}
                          className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          下一頁
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed bg-white/60 p-6 text-center text-sm text-gray-500">
                沒有符合條件的櫃子，試試調整搜尋或篩選條件。
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-dashed bg-white/60 p-6 text-center text-sm text-gray-500">
              尚未建立櫃子，先新增一個分類吧！
            </div>
          )}
        </section>
      </div>

      {showReorder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="w-full max-w-xl space-y-6 rounded-2xl bg-white p-6 shadow-xl">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-gray-900">調整櫃子順序</h2>
              <p className="text-sm text-gray-500">
                點選要調整的櫃子，再使用下方的上下按鈕調整顯示順序。
              </p>
            </div>
            {reorderError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {reorderError}
              </div>
            )}

            <div className="max-h-[320px] space-y-3 overflow-y-auto rounded-2xl border bg-gray-50 p-3">
              {reorderList.length === 0 ? (
                <p className="text-sm text-gray-500">目前沒有櫃子可調整。</p>
              ) : (
                <div className="space-y-3">
                  <ul className="space-y-2">
                    {reorderPageItems.map((cabinet) => {
                      const isSelected = cabinet.id === selectedId;
                      return (
                        <li key={cabinet.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(cabinet.id)}
                            className={`w-full overflow-hidden rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition${
                              isSelected
                                ? "border-blue-400 bg-white"
                                : "border-gray-200 bg-white/80 hover:border-blue-200"
                            }`}
                          >
                            <span
                              className="line-clamp-2 break-anywhere font-medium text-gray-900"
                              title={cabinet.name || "未命名櫃子"}
                            >
                              {cabinet.name || "未命名櫃子"}
                            </span>
                            {cabinet.note && (
                              <span
                                className="line-clamp-2 break-anywhere mt-1 block text-xs text-gray-500"
                                title={cabinet.note}
                              >
                                {cabinet.note}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {reorderTotalPages > 1 && (
                    <div className="flex flex-col gap-2 text-xs text-gray-600 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        第 {reorderCurrentPageSafe} / {reorderTotalPages} 頁，共 {reorderList.length} 筆
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-gray-700">
                          <span>頁面</span>
                          <select
                            value={reorderCurrentPageSafe}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (Number.isFinite(value)) {
                                setReorderPageManually(value);
                              }
                            }}
                            className="h-9 rounded-lg border bg-white px-2 text-sm"
                          >
                            {reorderPageNumbers.map((pageNumber) => (
                              <option key={pageNumber} value={pageNumber}>
                                {pageNumber}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setReorderPageManually((prev) => Math.max(1, prev - 1))
                            }
                            disabled={reorderCurrentPageSafe <= 1}
                            className={`${buttonClass({ variant: "secondary", size: "sm" })} disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            上一頁
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setReorderPageManually((prev) =>
                                prev >= reorderTotalPages ? reorderTotalPages : prev + 1
                              )
                            }
                            disabled={reorderCurrentPageSafe >= reorderTotalPages}
                            className={`${buttonClass({ variant: "secondary", size: "sm" })} disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            下一頁
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moveSelected(-1)}
                  disabled={selectedIndex <= 0}
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  上移
                </button>
                <button
                  type="button"
                  onClick={() => moveSelected(1)}
                  disabled={
                    selectedIndex === -1 || selectedIndex === reorderList.length - 1
                  }
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  下移
                </button>
                <button
                  type="button"
                  onClick={() => moveSelectedToEdge("start")}
                  disabled={selectedIndex <= 0}
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  移到最上
                </button>
                <button
                  type="button"
                  onClick={() => moveSelectedToEdge("end")}
                  disabled={
                    selectedIndex === -1 || selectedIndex === reorderList.length - 1
                  }
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  移到最下
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={closeReorderDialog}
                  disabled={reorderSaving}
                  className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveReorder}
                  disabled={reorderSaving || reorderList.length === 0}
                  className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                >
                  {reorderSaving ? "儲存中…" : "儲存順序"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
