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
  const tags = item.tags ?? [];
  const detailHref = `/item/${item.id}`;

  return (
    <article className="w-full rounded-2xl border border-gray-100 bg-white/85 p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 gap-4">
          <Link
            href={detailHref}
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

          <div className="min-w-0 flex-1 space-y-1">
            <Link
              href={detailHref}
              className="block truncate text-base font-semibold text-gray-900 transition hover:text-blue-600"
            >
              {item.titleZh}
            </Link>
            {item.titleAlt && (
              <div className="truncate text-xs text-gray-500">{item.titleAlt}</div>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1 text-xs text-gray-600">
                {tags.map((tag) => {
                  if (!item.cabinetId) {
                    return (
                      <span
                        key={tag}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1"
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
                      className="rounded-full border border-gray-200 bg-white px-3 py-1 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                    >
                      #{tag}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-[160px] sm:flex-none sm:items-end">
          <div className="text-sm font-medium text-gray-700 sm:text-right">
            {listDisplay}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
            {primaryLink ? (
              <a
                href={primaryLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass({ variant: "secondary", size: "sm" })} w-full sm:w-auto`}
              >
                點我觀看
              </a>
            ) : (
              <button
                type="button"
                disabled
                className={`${buttonClass({ variant: "secondary", size: "sm" })} w-full border-dashed text-gray-400 sm:w-auto`}
              >
                尚未提供連結
              </button>
            )}
            <button
              type="button"
              onClick={increment}
              disabled={updating || loading}
              className={`${buttonClass({ variant: "primary", size: "sm" })} w-full sm:w-auto`}
            >
              {updating ? "+1…" : "+1"}
            </button>
          </div>
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
