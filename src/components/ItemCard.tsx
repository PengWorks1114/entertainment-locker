"use client";

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
  type ItemRecord,
  type ProgressType,
} from "@/lib/types";
import { deleteItemWithProgress } from "@/lib/firestore-utils";

const statusLabelMap = new Map(
  ITEM_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const progressTypeLabelMap = new Map(
  PROGRESS_TYPE_OPTIONS.map((option) => [option.value, option.label])
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
  const [deleting, setDeleting] = useState(false);
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
    return (
      item.links.find((link) => link.url && link.url.trim().length > 0) ?? null
    );
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

  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm("確認刪除此物件？會一併刪除相關進度資料。")) {
      return;
    }
    setError(null);
    setSuccess(null);
    setDeleting(true);
    try {
      await deleteItemWithProgress(item.id, item.uid);
      setSuccess("已刪除物件");
    } catch (err) {
      console.error("刪除物件失敗", err);
      const message =
        err instanceof Error && err.message ? err.message : "刪除物件時發生錯誤";
      setError(message);
    } finally {
      setDeleting(false);
    }
  }

  const tags = item.tags ?? [];
  const ratingText =
    typeof item.rating === "number" && Number.isFinite(item.rating)
      ? item.rating.toFixed(item.rating % 1 === 0 ? 0 : 1)
      : null;

  return (
    <article className="space-y-4 rounded-2xl border bg-white/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Link
            href={`/item/${item.id}`}
            className="text-lg font-semibold text-gray-900 underline-offset-4 hover:underline"
          >
            {item.titleZh}
          </Link>
          {item.titleAlt && (
            <p className="text-sm text-gray-500">{item.titleAlt}</p>
          )}
          <div className="flex flex-wrap gap-2 text-xs text-gray-600">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
              狀態：{statusLabel}
            </span>
            {ratingText && (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                評分：{ratingText}
              </span>
            )}
            {item.author && (
              <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                作者：{item.author}
              </span>
            )}
            {item.nextUpdateAt && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                下次更新：{formatDateOnly(item.nextUpdateAt)}
              </span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-200 px-3 py-1 text-gray-600"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {primaryLink && (
            <a
              href={primaryLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-sm text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-900"
            >
              點我觀看
            </a>
          )}
          <button
            type="button"
            onClick={handleIncrement}
            disabled={updating || progressLoading || deleting}
            className="h-12 w-24 rounded-xl bg-black text-sm text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {updating ? "+1…" : "+1"}
          </button>
          <Link
            href={`/item/${item.id}/edit`}
            className="text-xs text-gray-500 underline-offset-4 hover:underline"
          >
            編輯物件
          </Link>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-600 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-red-400"
          >
            {deleting ? "刪除中…" : "刪除物件"}
          </button>
        </div>
      </div>

      <div className="space-y-2 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <div>主進度：{progressSummary}</div>
        {primary?.updatedAt && (
          <div className="text-xs text-gray-500">
            主進度更新於：{formatTimestamp(primary.updatedAt)}
          </div>
        )}
      </div>

      {item.progressNote && (
        <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
          進度備註：{item.progressNote}
        </div>
      )}
      {item.note && (
        <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
          備註：{item.note}
        </div>
      )}

      {(error || success) && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
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
