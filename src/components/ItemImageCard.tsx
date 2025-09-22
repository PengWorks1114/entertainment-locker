"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";

import { DEFAULT_THUMB_TRANSFORM, isOptimizedImageUrl } from "@/lib/image-utils";
import type { ItemRecord } from "@/lib/types";

type ItemImageCardProps = {
  item: ItemRecord;
};

export default function ItemImageCard({ item }: ItemImageCardProps) {
  const thumbTransform = item.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
  const thumbStyle = useMemo(
    () => ({
      transform: `translate(${thumbTransform.offsetX}%, ${thumbTransform.offsetY}%) scale(${thumbTransform.scale})`,
      transformOrigin: "center",
    }),
    [thumbTransform.offsetX, thumbTransform.offsetY, thumbTransform.scale]
  );
  const canUseOptimizedThumb = isOptimizedImageUrl(item.thumbUrl);
  const trimmedTitle = (item.titleZh ?? "").trim();
  const displayTitle = trimmedTitle.length > 0 ? trimmedTitle : "未命名物件";
  const detailHref = `/item/${item.id}`;

  const imageNode = item.thumbUrl ? (
    canUseOptimizedThumb ? (
      <Image
        src={item.thumbUrl}
        alt={`${displayTitle} 縮圖`}
        fill
        sizes="160px"
        className="object-cover"
        style={thumbStyle}
        draggable={false}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
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

  return (
    <article className="rounded-2xl border border-gray-100 bg-white/80 p-2 shadow-sm">
      <Link
        href={detailHref}
        className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner transition hover:shadow-md"
        aria-label={`${displayTitle} 詳細頁面`}
      >
        {imageNode}
      </Link>
    </article>
  );
}
