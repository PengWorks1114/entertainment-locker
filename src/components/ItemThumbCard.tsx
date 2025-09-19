"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";

import { usePrimaryProgress } from "@/hooks/usePrimaryProgress";
import { DEFAULT_THUMB_TRANSFORM, isOptimizedImageUrl } from "@/lib/image-utils";
import type { ItemRecord } from "@/lib/types";
import { highlightMatches } from "@/lib/highlight";

type ItemThumbCardProps = {
  item: ItemRecord;
  searchTerm?: string;
};

function getPrimaryLink(item: ItemRecord) {
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
}

function formatProgressValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function ItemThumbCard({
  item,
  searchTerm = "",
}: ItemThumbCardProps) {
  const { primary, loading } = usePrimaryProgress(item);
  const primaryLink = getPrimaryLink(item);
  const thumbTransform = item.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
  const thumbStyle = useMemo(
    () => ({
      transform: `translate(${thumbTransform.offsetX}%, ${thumbTransform.offsetY}%) scale(${thumbTransform.scale})`,
      transformOrigin: "center",
    }),
    [thumbTransform.offsetX, thumbTransform.offsetY, thumbTransform.scale]
  );
  const canUseOptimizedThumb = isOptimizedImageUrl(item.thumbUrl);
  const detailHref = `/item/${item.id}`;

  const trimmedTitle = (item.titleZh ?? "").trim();
  const displayTitle = trimmedTitle.length > 0 ? trimmedTitle : "未命名物件";
  const limitedTitle = displayTitle.slice(0, 10);
  const firstLine = limitedTitle.slice(0, 5);
  const secondLine = limitedTitle.slice(5);

  const progressDisplay = (() => {
    if (loading) {
      return "—";
    }
    if (!primary) {
      return "—";
    }
    const valueText = formatProgressValue(primary.value);
    const unitText = primary.unit?.trim() ?? "";
    return unitText ? `${valueText}${unitText}` : valueText;
  })();

  const imageNode = item.thumbUrl ? (
    canUseOptimizedThumb ? (
      <Image
        src={item.thumbUrl}
        alt={`${displayTitle} 縮圖`}
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
        alt={`${displayTitle} 縮圖`}
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
  );

  const titleContent = (
    <span className="block text-sm font-semibold leading-snug text-gray-900">
      {firstLine && (
        <span className="block break-anywhere">
          {highlightMatches(firstLine, searchTerm)}
        </span>
      )}
      {secondLine && (
        <span className="block break-anywhere">
          {highlightMatches(secondLine, searchTerm)}
        </span>
      )}
      {!firstLine && !secondLine && (
        <span className="block break-anywhere">
          {highlightMatches(displayTitle, searchTerm)}
        </span>
      )}
    </span>
  );

  const imageWrapperClass =
    "relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner";

  const imageElement = primaryLink ? (
    <a
      href={primaryLink.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${imageWrapperClass} transition hover:shadow-md`}
      aria-label={item.titleZh ? `${item.titleZh} 來源連結` : "來源連結"}
    >
      {imageNode}
    </a>
  ) : (
    <Link
      href={detailHref}
      className={`${imageWrapperClass} transition hover:shadow-md`}
      aria-label={item.titleZh ? `${item.titleZh} 詳細頁面` : "詳細頁面"}
    >
      {imageNode}
    </Link>
  );

  const titleElement = primaryLink ? (
    <a
      href={primaryLink.url}
      target="_blank"
      rel="noopener noreferrer"
      className="transition hover:text-blue-600"
    >
      {titleContent}
    </a>
  ) : (
    <Link href={detailHref} className="transition hover:text-blue-600">
      {titleContent}
    </Link>
  );

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white/85 p-3 shadow-sm">
      {imageElement}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        {titleElement}
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] text-gray-500">主進度</span>
          <span className="text-sm font-medium text-gray-800">{progressDisplay}</span>
        </div>
      </div>
    </article>
  );
}

