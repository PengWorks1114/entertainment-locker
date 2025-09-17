"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
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
import { auth, db } from "@/lib/firebase";
import {
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_VALUES,
  UPDATE_FREQUENCY_VALUES,
  type ItemRecord,
  type ItemStatus,
  type UpdateFrequency,
} from "@/lib/types";
import { deleteCabinetWithItems } from "@/lib/firestore-utils";

type CabinetPageProps = {
  params: Promise<{ id: string }>;
};

type SortOption = "updated" | "title" | "rating" | "nextUpdate";
type HasNextUpdateFilter = "all" | "yes" | "no";

type FilterState = {
  search: string;
  status: ItemStatus | "all";
  ratingMin: string;
  ratingMax: string;
  hasNextUpdate: HasNextUpdateFilter;
  sort: SortOption;
};

const PAGE_SIZE = 12;

const defaultFilters: FilterState = {
  search: "",
  status: "all",
  ratingMin: "",
  ratingMax: "",
  hasNextUpdate: "all",
  sort: "updated",
};

export default function CabinetDetailPage({ params }: CabinetPageProps) {
  const { id: cabinetId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cabinetName, setCabinetName] = useState<string>("");
  const [cabinetLoading, setCabinetLoading] = useState(true);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [canView, setCanView] = useState(false);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [deletingCabinet, setDeletingCabinet] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
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
      setCabinetLoading(false);
      return;
    }
    let active = true;
    setCabinetLoading(true);
    setCabinetError(null);
    setCanView(false);
    const cabinetRef = doc(db, "cabinet", cabinetId);
    getDoc(cabinetRef)
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setCabinetError("找不到櫃子");
          setCabinetLoading(false);
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setCabinetError("您沒有存取此櫃子的權限");
          setCabinetLoading(false);
          return;
        }
        const name = typeof data?.name === "string" && data.name ? data.name : "未命名櫃子";
        setCabinetName(name);
        setCanView(true);
        setCabinetLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setCabinetError("載入櫃子資訊時發生錯誤");
        setCabinetLoading(false);
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
          return {
            id: docSnap.id,
            uid: typeof data.uid === "string" ? data.uid : user.uid,
            cabinetId: typeof data.cabinetId === "string" ? data.cabinetId : cabinetId,
            titleZh:
              typeof data.titleZh === "string" && data.titleZh ? data.titleZh : "(未命名物件)",
            titleAlt: typeof data.titleAlt === "string" ? data.titleAlt : null,
            author: typeof data.author === "string" ? data.author : null,
            tags,
            links,
            thumbUrl: typeof data.thumbUrl === "string" ? data.thumbUrl : null,
            progressNote:
              typeof data.progressNote === "string" ? data.progressNote : null,
            note: typeof data.note === "string" ? data.note : null,
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
    setVisibleCount(PAGE_SIZE);
  }, [filters.search, filters.status, filters.ratingMin, filters.ratingMax, filters.hasNextUpdate, filters.sort]);

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
      return true;
    });

    const sorted = [...matches].sort((a, b) => {
      switch (filters.sort) {
        case "title":
          return a.titleZh.localeCompare(b.titleZh, "zh-Hant");
        case "rating": {
          const ratingA =
            typeof a.rating === "number" && Number.isFinite(a.rating)
              ? a.rating
              : -Infinity;
          const ratingB =
            typeof b.rating === "number" && Number.isFinite(b.rating)
              ? b.rating
              : -Infinity;
          return ratingB - ratingA;
        }
        case "nextUpdate": {
          const timeA = a.nextUpdateAt ? a.nextUpdateAt.toMillis() : Number.POSITIVE_INFINITY;
          const timeB = b.nextUpdateAt ? b.nextUpdateAt.toMillis() : Number.POSITIVE_INFINITY;
          return timeA - timeB;
        }
        case "updated":
        default: {
          const timeA = a.updatedAt ? a.updatedAt.toMillis() : 0;
          const timeB = b.updatedAt ? b.updatedAt.toMillis() : 0;
          return timeB - timeA;
        }
      }
    });

    return sorted;
  }, [items, filters]);

  const visibleItems = filteredItems.slice(0, visibleCount);
  const hasMore = filteredItems.length > visibleCount;
  const hasActiveFilters =
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.ratingMin.trim().length > 0 ||
    filters.ratingMax.trim().length > 0 ||
    filters.hasNextUpdate !== "all" ||
    filters.sort !== "updated";

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function resetFilters() {
    setFilters(defaultFilters);
  }

  const inputClass = "h-12 w-full rounded-xl border px-4 text-base";
  const selectClass = "h-12 w-full rounded-xl border px-4 text-base";
  const smallInputClass = "h-10 w-full rounded-lg border px-3 text-sm";
  const secondaryButtonClass =
    "inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900";
  const subtleButtonClass =
    "rounded-lg border px-3 py-2 text-sm text-gray-600 transition hover:border-gray-300 hover:text-gray-900";
  const dangerButtonClass =
    "inline-flex items-center justify-center rounded-full border border-red-200 bg-white px-4 py-2 text-sm text-red-600 shadow-sm transition hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-70";

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
          <h1 className="text-2xl font-semibold text-gray-900">櫃子內容</h1>
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
          <h1 className="text-2xl font-semibold text-gray-900">櫃子內容</h1>
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {cabinetError}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/cabinets" className={`${secondaryButtonClass} w-full sm:w-auto`}>
              返回櫃子列表
            </Link>
          </div>
        </div>
      </main>
    );
  }

  async function handleDeleteCabinet() {
    if (!user || !canView || deletingCabinet) {
      return;
    }
    if (
      !window.confirm(
        "確定要刪除此櫃子？將同步刪除櫃內所有作品與進度資料。"
      )
    ) {
      return;
    }
    setDeletingCabinet(true);
    setDeleteError(null);
    try {
      await deleteCabinetWithItems(cabinetId, user.uid);
      router.push("/cabinets");
    } catch (err) {
      console.error("刪除櫃子失敗", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "刪除櫃子時發生錯誤";
      setDeleteError(message);
    } finally {
      setDeletingCabinet(false);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">{cabinetName}</h1>
            <p className="text-sm text-gray-500">櫃子 ID：{cabinetId}</p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            <Link href="/cabinets" className={`${secondaryButtonClass} w-full sm:w-auto`}>
              返回櫃子列表
            </Link>
            <Link
              href={`/item/new?cabinetId=${encodeURIComponent(cabinetId)}`}
              className={`${secondaryButtonClass} w-full sm:w-auto`}
            >
              在此櫃子新增物件
            </Link>
            <Link
              href={`/cabinet/${encodeURIComponent(cabinetId)}/edit`}
              className={`${secondaryButtonClass} w-full sm:w-auto`}
            >
              編輯櫃子
            </Link>
            <button
              type="button"
              onClick={handleDeleteCabinet}
              disabled={deletingCabinet}
              className={`${dangerButtonClass} w-full sm:w-auto`}
            >
              {deletingCabinet ? "刪除中…" : "刪除此櫃子"}
            </button>
          </div>
        </header>

        {deleteError && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteError}
          </div>
        )}

        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-4">
            <label className="space-y-1">
              <span className="text-sm text-gray-600">搜尋作品</span>
              <input
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="中文 / 原文 / 作者"
                className={inputClass}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-gray-600">狀態</span>
              <select
                value={filters.status}
                onChange={(event) =>
                  updateFilter("status", event.target.value as ItemStatus | "all")
                }
                className={selectClass}
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
                className={selectClass}
              >
                <option value="all">全部</option>
                <option value="yes">僅顯示有下一次提醒</option>
                <option value="no">僅顯示未設定提醒</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm text-gray-600">排序方式</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  updateFilter("sort", event.target.value as SortOption)
                }
                className={selectClass}
              >
                <option value="updated">最近更新</option>
                <option value="rating">評分最高</option>
                <option value="title">名稱 A → Z</option>
                <option value="nextUpdate">下次更新時間（最早）</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
            <span>共 {filteredItems.length} 件物件</span>
            {hasActiveFilters && (
              <button type="button" onClick={resetFilters} className={subtleButtonClass}>
                重設篩選
              </button>
            )}
          </div>
        </section>

        {listError && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
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
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {visibleItems.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {hasMore && !itemsLoading && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="h-12 rounded-xl border px-6 text-sm text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
              >
                載入更多
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
