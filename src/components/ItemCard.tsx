"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import type { Timestamp } from "firebase/firestore";

import FavoriteToggleButton from "@/components/FavoriteToggleButton";
import { useFavoriteToggle } from "@/hooks/useFavoriteToggle";
import { usePrimaryProgress } from "@/hooks/usePrimaryProgress";
import { DEFAULT_THUMB_TRANSFORM, isOptimizedImageUrl } from "@/lib/image-utils";
import {
  ITEM_STATUS_OPTIONS,
  UPDATE_FREQUENCY_OPTIONS,
  type ItemRecord,
} from "@/lib/types";
import { buttonClass } from "@/lib/ui";
import { highlightMatches } from "@/lib/highlight";

const statusLabelMap = new Map(
  ITEM_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const updateFrequencyLabelMap = new Map(
  UPDATE_FREQUENCY_OPTIONS.map((option) => [option.value, option.label])
);

type ItemCardProps = {
  item: ItemRecord;
  searchTerm?: string;
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

export default function ItemCard({ item, searchTerm = "" }: ItemCardProps) {
  const { primary, summary, updating, loading, error, success, increment } =
    usePrimaryProgress(item);
  const {
    toggleFavorite,
    pending: favoritePending,
    error: favoriteError,
  } = useFavoriteToggle(item);
  const statusLabel = statusLabelMap.get(item.status) ?? item.status;
  const thumbTransform = item.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
  const thumbStyle = useMemo(
    () => ({
      transform: `translate(${thumbTransform.offsetX}%, ${thumbTransform.offsetY}%) scale(${thumbTransform.scale})`,
      transformOrigin: "center",
    }),
    [thumbTransform.offsetX, thumbTransform.offsetY, thumbTransform.scale]
  );

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
  const detailHref = `/item/${item.id}`;

  return (
    <article className="space-y-6 rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3
            className="line-clamp-2 break-anywhere text-2xl font-semibold leading-tight text-gray-900"
            title={item.titleZh}
          >
            {highlightMatches(item.titleZh, searchTerm)}
          </h3>
          {item.titleAlt && (
            <p className="line-clamp-2 break-anywhere text-sm text-gray-500" title={item.titleAlt}>
              {highlightMatches(item.titleAlt, searchTerm)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FavoriteToggleButton
            isFavorite={item.isFavorite}
            onToggle={toggleFavorite}
            disabled={favoritePending}
            ariaLabel={
              item.isFavorite
                ? `取消 ${item.titleZh} 最愛`
                : `將 ${item.titleZh} 設為最愛`
            }
          />
          <button
            type="button"
            onClick={increment}
            disabled={updating || loading}
            className={buttonClass({ variant: "primary" })}
          >
            {updating ? "+1…" : "+1"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Link
          href={detailHref}
          className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner"
        >
          {item.thumbUrl ? (
            canUseOptimizedThumb ? (
              <Image
                src={item.thumbUrl}
                alt={`${item.titleZh} 縮圖`}
                fill
                sizes="80px"
                className="object-cover"
                style={thumbStyle}
                draggable={false}
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={item.thumbUrl}
                alt={`${item.titleZh} 縮圖`}
                className="h-full w-full select-none object-cover"
                style={thumbStyle}
                loading="lazy"
                draggable={false}
              />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-400">
              無封面
            </div>
          )}
        </Link>

        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:items-end">
          <Link
            href={detailHref}
            className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
          >
            查看詳細頁面
          </Link>
          {primaryLink ? (
            <a
              href={primaryLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            >
              點我觀看
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`${buttonClass({ variant: "secondary" })} w-full border-dashed text-gray-400 sm:w-auto`}
            >
              尚未提供連結
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <div className="space-y-3 text-sm text-gray-900">
          <div className="grid grid-cols-2 gap-x-6 text-xs text-gray-500">
            <span>狀態</span>
            <span>更新頻率</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 font-medium text-gray-900">
            <span className="line-clamp-2 break-anywhere" title={statusLabel}>
              {statusLabel}
            </span>
            <span className="line-clamp-2 break-anywhere" title={updateFrequencyLabel}>
              {updateFrequencyLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 text-xs text-gray-500">
            <span>下次更新</span>
            <span>評分</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 font-medium text-gray-900">
            <span className="line-clamp-2 break-anywhere" title={nextUpdateText}>
              {nextUpdateText}
            </span>
            <span className="line-clamp-2 break-anywhere" title={ratingDisplay}>
              {ratingDisplay}
            </span>
          </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">作者 / 製作</div>
          <div className="line-clamp-2 break-anywhere font-medium text-gray-900" title={authorDisplay}>
            {highlightMatches(authorDisplay, searchTerm)}
          </div>
        </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white/80 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="text-xs text-gray-500">標籤</span>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                if (!item.cabinetId) {
                  return (
                    <span
                      key={tag}
                      className="break-anywhere rounded-full border border-gray-200 bg-gray-100 px-3 py-1"
                    >
                      #{tag}
                    </span>
                  );
                }
                const tagHref = `/cabinet/${encodeURIComponent(
                  item.cabinetId
                )}?tag=${encodeURIComponent(tag)}`;
                return (
                  <Link
                    key={tag}
                    href={tagHref}
                    className="break-anywhere rounded-full border border-gray-200 bg-white px-3 py-1 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                  >
                    #{tag}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
        <div className="text-sm font-medium text-gray-900">主進度</div>
        <div className="line-clamp-2 break-anywhere text-sm text-gray-700" title={summary}>
          {summary}
        </div>
        {primary?.updatedAt && (
          <div className="text-xs text-gray-500">
            主進度更新於：{formatTimestamp(primary.updatedAt)}
          </div>
        )}
      </div>

      {item.progressNote && (
        <div
          className="line-clamp-2 break-anywhere rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800"
          title={item.progressNote}
        >
          進度備註：{item.progressNote}
        </div>
      )}
      {item.note && (
        <div
          className="line-clamp-2 break-anywhere rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-700"
          title={item.note}
        >
          備註：{item.note}
        </div>
      )}

      {(favoriteError || error || success) && (
        <div
          className={`break-anywhere rounded-2xl px-4 py-3 text-sm ${
            favoriteError || error
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {favoriteError ?? error ?? success}
        </div>
      )}
    </article>
  );
}
