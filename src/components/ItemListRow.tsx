"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";

import { usePrimaryProgress } from "@/hooks/usePrimaryProgress";
import { isOptimizedImageUrl } from "@/lib/image-utils";
import type { ItemRecord } from "@/lib/types";
import { buttonClass } from "@/lib/ui";

type ItemListRowProps = {
  item: ItemRecord;
};

export default function ItemListRow({ item }: ItemListRowProps) {
  const { listDisplay, increment, updating, loading, error, success } =
    usePrimaryProgress(item);

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

  const canUseOptimizedThumb = isOptimizedImageUrl(item.thumbUrl);

  return (
    <article className="rounded-2xl border border-gray-100 bg-white/85 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/item/${item.id}`}
          className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 shadow-inner"
        >
          {item.thumbUrl ? (
            canUseOptimizedThumb ? (
              <Image
                src={item.thumbUrl}
                alt={`${item.titleZh} 縮圖`}
                fill
                sizes="48px"
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
        </Link>

        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-gray-900">
            {item.titleZh}
          </div>
          {item.titleAlt && (
            <div className="truncate text-xs text-gray-500">{item.titleAlt}</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[96px] text-sm font-medium text-gray-700">
            {listDisplay}
          </div>
          {primaryLink ? (
            <a
              href={primaryLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              點我觀看
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`${buttonClass({ variant: "secondary", size: "sm" })} border-dashed text-gray-400`}
            >
              尚未提供連結
            </button>
          )}
          <button
            type="button"
            onClick={increment}
            disabled={updating || loading}
            className={buttonClass({ variant: "primary", size: "sm" })}
          >
            {updating ? "+1…" : "+1"}
          </button>
        </div>
      </div>

      {(error || success) && (
        <div
          className={`mt-3 rounded-xl px-3 py-2 text-xs ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? success}
        </div>
      )}
    </article>
  );
}
