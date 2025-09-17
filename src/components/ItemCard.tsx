"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  increment,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { calculateNextUpdateDate } from "@/lib/item-utils";
import {
  ITEM_STATUS_OPTIONS,
  PROGRESS_TYPE_OPTIONS,
  UPDATE_FREQUENCY_OPTIONS,
  type ItemRecord,
  type ProgressType,
} from "@/lib/types";
import { buttonClass } from "@/lib/ui";
function isOptimizedImageUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "i.imgur.com";
  } catch {
    return false;
  }
}

const statusLabelMap = new Map(
  ITEM_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const progressTypeLabelMap = new Map(
  PROGRESS_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

const updateFrequencyLabelMap = new Map(
  UPDATE_FREQUENCY_OPTIONS.map((option) => [option.value, option.label])
);

type PrimaryProgressState = {
  id: string;
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | null;
  updatedAt?: Timestamp | null;
};

type ItemCardProps = {
  item: ItemRecord;
};

function formatTimestamp(timestamp?: Timestamp | null): string {
  if (!timestamp) return "—";
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateOnly(timestamp?: Timestamp | null): string {
  if (!timestamp) return "未設定";
  const date = timestamp.toDate();
  return `${date.getFullYear()}/${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}/${date
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

function formatProgressValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function ItemCard({ item }: ItemCardProps) {
  const [primary, setPrimary] = useState<PrimaryProgressState | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const progressQuery = query(
      collection(db, "item", item.id, "progress"),
      where("isPrimary", "==", true),
      limit(1)
    );
    const unsub = onSnapshot(
      progressQuery,
      (snap) => {
        if (snap.empty) {
          setPrimary(null);
        } else {
          const docSnap = snap.docs[0];
          const data = docSnap.data();
          const typeValue =
            typeof data.type === "string" &&
            progressTypeLabelMap.has(data.type as ProgressType)
              ? (data.type as ProgressType)
              : "chapter";
          setPrimary({
            id: docSnap.id,
            platform: typeof data.platform === "string" ? data.platform : "",
            type: typeValue,
            value:
              typeof data.value === "number" && Number.isFinite(data.value)
                ? data.value
                : 0,
            unit: typeof data.unit === "string" ? data.unit : null,
            updatedAt:
              data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
          });
        }
        setProgressLoading(false);
      },
      (err) => {
        console.error("載入主進度失敗", err);
        setError("載入主進度失敗");
        setProgressLoading(false);
      }
    );
    return () => unsub();
  }, [item.id]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 2500);
    return () => clearTimeout(timer);
  }, [success]);

  const statusLabel = statusLabelMap.get(item.status) ?? item.status;

  const progressSummary = useMemo(() => {
    if (progressLoading) {
      return "主進度載入中…";
    }
    if (!primary) {
      return "尚未設定主進度";
    }
    const typeLabel = progressTypeLabelMap.get(primary.type) ?? primary.type;
    const valueText = formatProgressValue(primary.value);
    const unitText = primary.unit ? ` ${primary.unit}` : "";
    return `${primary.platform || "未命名平台"}｜${typeLabel} ${valueText}${unitText}`;
  }, [primary, progressLoading]);

  const primaryLink = useMemo(() => {
    if (!item.links || item.links.length === 0) {
      return null;
    }
    const validLinks = item.links.filter(
      (link) => typeof link.url === "string" && link.url.trim().length > 0
    );
    if (validLinks.length === 0) {
      return null;
    }
    const flagged = validLinks.find((link) => link.isPrimary);
    return flagged ?? validLinks[0];
  }, [item.links]);

  async function handleIncrement() {
    if (!primary) {
      setError("尚未設定主進度，請先在物件頁面新增並設定主進度。");
      return;
    }
    setError(null);
    setSuccess(null);
    setUpdating(true);
    try {
      const batch = writeBatch(db);
      const progressRef = doc(db, "item", item.id, "progress", primary.id);
      batch.update(progressRef, {
        value: increment(1),
        updatedAt: serverTimestamp(),
      });
      const nextDate = calculateNextUpdateDate(item.updateFrequency ?? null);
      const itemRef = doc(db, "item", item.id);
      batch.update(itemRef, {
        updatedAt: serverTimestamp(),
        nextUpdateAt: nextDate ? Timestamp.fromDate(nextDate) : null,
      });
      await batch.commit();
      setSuccess("已更新主進度");
    } catch (err) {
      console.error("更新主進度時發生錯誤", err);
      setError("更新主進度時發生錯誤");
    } finally {
      setUpdating(false);
    }
  }

  const tags = item.tags ?? [];
  const ratingText =
    typeof item.rating === "number" && Number.isFinite(item.rating)
      ? item.rating.toFixed(item.rating % 1 === 0 ? 0 : 1)
      : null;
  const ratingDisplay = ratingText ?? "未設定";
  const nextUpdateText = item.nextUpdateAt
    ? formatDateOnly(item.nextUpdateAt)
    : "未設定";
  const authorDisplay =
    item.author && item.author.trim().length > 0 ? item.author : "未設定";
  const updateFrequencyLabel = item.updateFrequency
    ? updateFrequencyLabelMap.get(item.updateFrequency) ?? item.updateFrequency
    : "未設定";
  const canUseOptimizedThumb = isOptimizedImageUrl(item.thumbUrl);

  return (
    <article className="space-y-6 rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-2xl font-semibold leading-tight text-gray-900">
            {item.titleZh}
          </h3>
          {item.titleAlt && <p className="text-sm text-gray-500">{item.titleAlt}</p>}
        </div>
        <button
          type="button"
          onClick={handleIncrement}
          disabled={updating || progressLoading}
          className={buttonClass({ variant: "primary" })}
        >
          {updating ? "+1…" : "+1"}
        </button>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex flex-1 gap-4">
          <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner">
            {item.thumbUrl ? (
              canUseOptimizedThumb ? (
                <Image
                  src={item.thumbUrl}
                  alt={`${item.titleZh} 縮圖`}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.thumbUrl}
                  alt={`${item.titleZh} 縮圖`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-400">
                無封面
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-3">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs text-gray-500">狀態</span>
                <span className="block font-medium text-gray-900">{statusLabel}</span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">更新頻率</span>
                <span className="block font-medium text-gray-900">{updateFrequencyLabel}</span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">下次更新</span>
                <span className="block font-medium text-gray-900">{nextUpdateText}</span>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-gray-500">評分</span>
                <span className="block font-medium text-gray-900">{ratingDisplay}</span>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <span className="text-xs text-gray-500">作者 / 製作</span>
                <span className="block font-medium text-gray-900">{authorDisplay}</span>
              </div>
            </div>

            {tags.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <span className="text-xs font-medium text-gray-500">標籤</span>
                <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-gray-200 bg-white px-3 py-1"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 md:w-48">
          <Link
            href={`/item/${item.id}`}
            className={buttonClass({ variant: "secondary" })}
          >
            查看詳細頁面
          </Link>
          {primaryLink ? (
            <a
              href={primaryLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "secondary" })}
            >
              點我觀看
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`${buttonClass({ variant: "secondary" })} border-dashed text-gray-400`}
            >
              尚未提供連結
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
        <div className="text-sm font-medium text-gray-900">主進度</div>
        <div className="text-sm text-gray-700">{progressSummary}</div>
        {primary?.updatedAt && (
          <div className="text-xs text-gray-500">
            主進度更新於：{formatTimestamp(primary.updatedAt)}
          </div>
        )}
      </div>

      {item.progressNote && (
        <div className="rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
          進度備註：{item.progressNote}
        </div>
      )}
      {item.note && (
        <div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
          備註：{item.note}
        </div>
      )}

      {(error || success) && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            error
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}
    </article>
  );
}
