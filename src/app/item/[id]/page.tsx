"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { normalizeAppearanceRecords } from "@/lib/appearances";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";
import {
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_VALUES,
  PROGRESS_TYPE_OPTIONS,
  type ItemRecord,
  type ItemStatus,
  type ProgressType,
  type UpdateFrequency,
  UPDATE_FREQUENCY_OPTIONS,
  UPDATE_FREQUENCY_VALUES,
} from "@/lib/types";
import { DEFAULT_THUMB_TRANSFORM, normalizeThumbTransform } from "@/lib/image-utils";

const statusLabelMap = new Map(
  ITEM_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const updateFrequencyLabelMap = new Map(
  UPDATE_FREQUENCY_OPTIONS.map((option) => [option.value, option.label])
);

const progressTypeLabelMap = new Map(
  PROGRESS_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

function isOptimizedImageUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "i.imgur.com";
  } catch {
    return false;
  }
}

function formatDateTime(timestamp?: Timestamp | null): string {
  if (!timestamp) return "—";
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDateOnly(timestamp?: Timestamp | null): string {
  if (!timestamp) return "未設定";
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatProgressValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type ItemPageProps = {
  params: Promise<{ id: string }>;
};

type PrimaryProgressState = {
  id: string;
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | null;
  updatedAt?: Timestamp | null;
};

type NoteFeedback = {
  type: "success" | "error";
  message: string;
};

export default function ItemDetailPage({ params }: ItemPageProps) {
  const { id: itemId } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [item, setItem] = useState<ItemRecord | null>(null);
  const [itemLoading, setItemLoading] = useState(true);
  const [itemError, setItemError] = useState<string | null>(null);
  const [cabinetName, setCabinetName] = useState<string | null>(null);
  const [cabinetMissing, setCabinetMissing] = useState(false);
  const [primary, setPrimary] = useState<PrimaryProgressState | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteFeedback, setNoteFeedback] = useState<NoteFeedback | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const derivedThumbTransform = item?.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
  const thumbStyle = useMemo(
    () => ({
      transform: `translate(${derivedThumbTransform.offsetX}%, ${derivedThumbTransform.offsetY}%) scale(${derivedThumbTransform.scale})`,
      transformOrigin: "center",
    }),
    [
      derivedThumbTransform.offsetX,
      derivedThumbTransform.offsetY,
      derivedThumbTransform.scale,
    ]
  );
  const canUseOptimizedThumb = isOptimizedImageUrl(item?.thumbUrl);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setItemLoading(false);
      setProgressLoading(false);
      setItemError("Firebase 尚未設定");
      setProgressError("Firebase 尚未設定");
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
      setItem(null);
      setCabinetName(null);
      setCabinetMissing(false);
      setItemError(null);
      setItemLoading(false);
      return;
    }
    let active = true;
    setItemLoading(true);
    setItemError(null);
    (async () => {
      try {
        const db = getFirebaseDb();
        if (!db) {
          setItemError("Firebase 尚未設定");
          setItemLoading(false);
          return;
        }
        const itemRef = doc(db, "item", itemId);
        const snap = await getDoc(itemRef);
        if (!active) return;
        if (!snap.exists()) {
          setItemError("找不到物件資料");
          setItemLoading(false);
          return;
        }
        const data = snap.data();
        if (!data || data.uid !== user.uid) {
          setItemError("您沒有存取此物件的權限");
          setItemLoading(false);
          return;
        }
        const statusValue =
          typeof data.status === "string" &&
          ITEM_STATUS_VALUES.includes(data.status as ItemStatus)
            ? (data.status as ItemStatus)
            : "planning";
        const updateFrequencyValue =
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
          ? (() => {
              const mapped = data.links
                .map((link) => {
                  const record = link as {
                    label?: unknown;
                    url?: unknown;
                    isPrimary?: unknown;
                  };
                  const label = typeof record.label === "string" ? record.label : "";
                  const url = typeof record.url === "string" ? record.url : "";
                  return { label, url, isPrimary: Boolean(record.isPrimary) };
                })
                .filter((link) => link.label && link.url);
              if (mapped.length === 0) {
                return [];
              }
              let hasPrimary = false;
              const normalized = mapped.map((link) => {
                if (link.isPrimary && !hasPrimary) {
                  hasPrimary = true;
                  return { ...link, isPrimary: true };
                }
                return { ...link, isPrimary: false };
              });
              if (!hasPrimary) {
                normalized[0] = { ...normalized[0], isPrimary: true };
              }
              return normalized;
            })()
          : [];
        const appearances = normalizeAppearanceRecords(data.appearances);
        const record: ItemRecord = {
          id: snap.id,
          uid: typeof data.uid === "string" ? data.uid : user.uid,
          cabinetId: typeof data.cabinetId === "string" ? data.cabinetId : "",
          titleZh:
            typeof data.titleZh === "string" && data.titleZh ? data.titleZh : "(未命名物件)",
          titleAlt: typeof data.titleAlt === "string" ? data.titleAlt : null,
          author: typeof data.author === "string" ? data.author : null,
          tags,
          links,
          thumbUrl: typeof data.thumbUrl === "string" ? data.thumbUrl : null,
          thumbTransform: data.thumbTransform
            ? normalizeThumbTransform(data.thumbTransform)
            : null,
          progressNote: typeof data.progressNote === "string" ? data.progressNote : null,
          insightNote: typeof data.insightNote === "string" ? data.insightNote : null,
          note: typeof data.note === "string" ? data.note : null,
          appearances,
          rating: ratingValue,
          status: statusValue,
          updateFrequency: updateFrequencyValue,
          nextUpdateAt:
            data.nextUpdateAt instanceof Timestamp ? (data.nextUpdateAt as Timestamp) : null,
          createdAt:
            data.createdAt instanceof Timestamp ? (data.createdAt as Timestamp) : null,
          updatedAt:
            data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
        } satisfies ItemRecord;
        let resolvedCabinetName: string | null = null;
        let resolvedCabinetMissing = false;
        if (record.cabinetId) {
          try {
            const cabinetSnap = await getDoc(doc(db, "cabinet", record.cabinetId));
            if (!active) return;
            if (cabinetSnap.exists()) {
              const cabinetData = cabinetSnap.data();
              const name =
                typeof cabinetData?.name === "string" && cabinetData.name.trim()
                  ? cabinetData.name
                  : "未命名櫃子";
              resolvedCabinetName = name;
            } else {
              resolvedCabinetMissing = true;
            }
          } catch (err) {
            console.error("載入櫃子名稱時發生錯誤", err);
            resolvedCabinetMissing = true;
          }
        }
        if (!active) return;
        setItem(record);
        setCabinetName(resolvedCabinetName);
        setCabinetMissing(resolvedCabinetMissing);
        setItemLoading(false);
      } catch (err) {
        console.error("載入物件資料時發生錯誤", err);
        if (!active) return;
        setItemError("載入物件資料時發生錯誤");
        setItemLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, itemId]);

  useEffect(() => {
    if (!user) {
      setPrimary(null);
      setProgressLoading(false);
      return;
    }
    setProgressLoading(true);
    setProgressError(null);
    const db = getFirebaseDb();
    if (!db) {
      setProgressError("Firebase 尚未設定");
      setProgressLoading(false);
      return;
    }
    const progressQuery = query(
      collection(db, "item", itemId, "progress"),
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
        setProgressError("載入主進度失敗");
        setProgressLoading(false);
      }
    );
    return () => unsub();
  }, [user, itemId]);

  useEffect(() => {
    if (!noteFeedback) return;
    const timer = setTimeout(() => setNoteFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [noteFeedback]);

  useEffect(() => {
    if (!noteEditorOpen) return;
    const timer = setTimeout(() => {
      noteTextareaRef.current?.focus();
      const textarea = noteTextareaRef.current;
      if (textarea) {
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [noteEditorOpen]);

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
    const platform = primary.platform || "未命名平台";
    return `${platform}｜${typeLabel} ${valueText}${unitText}`;
  }, [primary, progressLoading]);

  const primaryLink = useMemo(() => {
    if (!item || !Array.isArray(item.links)) {
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
  }, [item]);

  function openNoteEditor() {
    if (!item) {
      setNoteFeedback({
        type: "error",
        message: "目前無法編輯心得 / 筆記",
      });
      return;
    }
    setNoteDraft(item.insightNote ?? "");
    setNoteError(null);
    setNoteEditorOpen(true);
  }

  function closeNoteEditor() {
    if (noteSaving) {
      return;
    }
    setNoteEditorOpen(false);
    setNoteError(null);
  }

  async function handleNoteSave() {
    if (!item) {
      setNoteError("找不到物件資料");
      return;
    }
    if (!user) {
      setNoteError("請先登入");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setNoteError("Firebase 尚未設定");
      return;
    }
    const trimmed = noteDraft.trim();
    setNoteSaving(true);
    setNoteError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        insightNote: trimmed.length > 0 ? trimmed : null,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              insightNote: trimmed.length > 0 ? trimmed : null,
            }
          : prev
      );
      setNoteEditorOpen(false);
      setNoteFeedback({ type: "success", message: "已更新心得 / 筆記" });
    } catch (err) {
      console.error("更新心得 / 筆記時發生錯誤", err);
      setNoteError("更新心得 / 筆記時發生錯誤");
    } finally {
      setNoteSaving(false);
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
          <h1 className="text-2xl font-semibold text-gray-900">物件內容</h1>
          <p className="text-base text-gray-600">
            未登入。請先前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            後再查看物件，或返回
            <Link href="/" className="ml-1 underline">
              首頁
            </Link>
            選擇其他功能。
          </p>
        </div>
      </main>
    );
  }

  if (itemLoading) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在載入物件資料…
        </div>
      </main>
    );
  }

  if (itemError || !item) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">物件內容</h1>
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {itemError ?? "找不到物件資料"}
          </div>
          {item?.cabinetId && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Link
                href={`/cabinet/${encodeURIComponent(item.cabinetId)}`}
                className={buttonClass({ variant: "secondary" })}
              >
                檢視櫃子
              </Link>
            </div>
          )}
        </div>
      </main>
    );
  }

  const statusLabel = statusLabelMap.get(item.status) ?? item.status;
  const ratingText =
    typeof item.rating === "number" && Number.isFinite(item.rating)
      ? item.rating.toFixed(item.rating % 1 === 0 ? 0 : 1)
      : "未設定";
  const updateFrequencyLabel = item.updateFrequency
    ? updateFrequencyLabelMap.get(item.updateFrequency) ?? item.updateFrequency
    : "未設定";
  const nextUpdateText = item.nextUpdateAt ? formatDateOnly(item.nextUpdateAt) : "未設定";
  const createdAtText = formatDateTime(item.createdAt);
  const updatedAtText = formatDateTime(item.updatedAt);
  const tags = item.tags ?? [];
  const links = item.links ?? [];
  const appearances = item.appearances ?? [];
  const insightNote = item.insightNote ?? "";
  const hasInsightNote = insightNote.trim().length > 0;
  const hasAppearances = appearances.length > 0;
  const tagLinkBase = item.cabinetId
    ? `/cabinet/${encodeURIComponent(item.cabinetId)}`
    : null;

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-6 rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-sm sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold text-gray-900">{item.titleZh}</h1>
            {item.titleAlt && <p className="text-base text-gray-500">{item.titleAlt}</p>}
            <div className="flex flex-wrap gap-3 text-sm text-gray-600">
              <span>物件 ID：{item.id}</span>
              {item.cabinetId ? (
                cabinetMissing ? (
                  <span className="text-red-600">所屬櫃子：資料不存在或無法存取</span>
                ) : (
                  <span>
                    所屬櫃子：
                    <Link
                      href={`/cabinet/${encodeURIComponent(item.cabinetId)}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {cabinetName ?? "未命名櫃子"}
                    </Link>
                  </span>
                )
              ) : (
                <span>未指定櫃子</span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            {primaryLink && (
              <a
                href={primaryLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              >
                點我觀看
              </a>
            )}
            {item.cabinetId && !cabinetMissing && (
              <Link
                href={`/cabinet/${encodeURIComponent(item.cabinetId)}`}
                className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              >
                檢視櫃子
              </Link>
            )}
            <Link
              href={`/item/${encodeURIComponent(item.id)}/edit`}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            >
              編輯物件
            </Link>
          </div>
        </header>

        <section className="rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-start">
            {item.thumbUrl && (
              <div className="relative mx-auto aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-xl border bg-white/80 sm:w-48 md:mx-0 md:w-56">
                {canUseOptimizedThumb ? (
                  <Image
                    src={item.thumbUrl}
                    alt={`${item.titleZh} 封面`}
                    fill
                    sizes="(min-width: 768px) 14rem, 100vw"
                    className="object-cover"
                    style={thumbStyle}
                    draggable={false}
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.thumbUrl}
                    alt={`${item.titleZh} 封面`}
                    className="h-full w-full select-none object-cover"
                    style={thumbStyle}
                    loading="lazy"
                    draggable={false}
                  />
                )}
              </div>
            )}
            <div className="flex-1 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">狀態</div>
                  <div className="text-base text-gray-900">{statusLabel}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">評分</div>
                  <div className="text-base text-gray-900">{ratingText}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">作者 / 製作</div>
                  <div className="text-base text-gray-900">
                    {item.author && item.author.trim().length > 0 ? item.author : "未設定"}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">更新頻率</div>
                  <div className="text-base text-gray-900">{updateFrequencyLabel}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">下次更新</div>
                  <div className="text-base text-gray-900">{nextUpdateText}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">最後更新時間</div>
                  <div className="text-base text-gray-900">{updatedAtText}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-gray-500">建立時間</div>
                  <div className="text-base text-gray-900">{createdAtText}</div>
                </div>
              </div>

              {tags.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-gray-500">標籤</div>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      if (!tagLinkBase) {
                        return (
                          <span
                            key={tag}
                            className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                          >
                            #{tag}
                          </span>
                        );
                      }
                      const href = `${tagLinkBase}?tag=${encodeURIComponent(tag)}`;
                      return (
                        <Link
                          key={tag}
                          href={href}
                          className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-blue-50 hover:text-blue-700"
                        >
                          #{tag}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

          {links.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-gray-500">來源連結</div>
              <ul className="space-y-2 text-sm">
                {links.map((link) => (
                      <li
                        key={`${link.label}-${link.url}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline-offset-4 hover:underline"
                        >
                          {link.label}
                        </a>
                        {link.isPrimary && (
                          <span className="text-xs text-emerald-600">{`（此為"點我觀看"觸發連結）`}</span>
                        )}
                      </li>
                    ))}
              </ul>
            </div>
          )}

          {item.progressNote && (
            <div className="space-y-1">
              <div className="text-sm text-gray-500">進度備註</div>
              <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {item.progressNote}
              </div>
            </div>
          )}

          {item.note && (
            <div className="space-y-1">
              <div className="text-sm text-gray-500">一般備註</div>
              <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700">
                {item.note}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-gray-900">進度概覽</h2>
          </div>

          <div className="rounded-xl bg-gray-50 px-4 py-3">
            <div className="text-sm font-medium text-gray-900">主進度</div>
            <div className="text-sm text-gray-700">{progressSummary}</div>
          </div>
          {primary?.updatedAt && (
            <div className="text-xs text-gray-500">
              主進度更新於：{formatDateTime(primary.updatedAt)}
            </div>
          )}
          {progressError && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {progressError}
            </div>
          )}
        </section>

        {hasAppearances && (
          <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">登場列表</h2>
              <p className="text-sm text-gray-500">依編輯順序列出重要角色、地點或其他物件。</p>
            </div>
            <div className="space-y-4">
              {appearances.map((entry, index) => {
                const appearanceTransform =
                  entry.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
                const appearanceStyle = {
                  transform: `translate(${appearanceTransform.offsetX}%, ${appearanceTransform.offsetY}%) scale(${appearanceTransform.scale})`,
                  transformOrigin: "center" as const,
                };
                return (
                  <div
                    key={`${entry.name}-${index}`}
                    className="flex gap-4 rounded-2xl border bg-white/80 p-4 shadow-sm"
                  >
                    {entry.thumbUrl ? (
                      <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-lg border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={entry.thumbUrl}
                          alt={`${entry.name} 縮圖`}
                          className="h-full w-full select-none object-cover"
                          style={appearanceStyle}
                          loading="lazy"
                          draggable={false}
                        />
                      </div>
                    ) : null}
                    <div className="flex-1 space-y-2">
                      <div className="text-base font-medium text-gray-900">{entry.name}</div>
                      {entry.note && (
                        <div className="whitespace-pre-wrap break-words text-sm text-gray-700">
                          {entry.note}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-gray-900">心得 / 筆記</h2>
            <p className="text-xs text-gray-500">雙擊內容可快速編輯。</p>
          </div>
          {hasInsightNote ? (
            <div
              className="whitespace-pre-wrap break-words rounded-xl bg-white px-4 py-3 text-sm text-gray-800 shadow-inner transition hover:bg-blue-50 cursor-text"
              onDoubleClick={openNoteEditor}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  openNoteEditor();
                }
              }}
              role="button"
              tabIndex={0}
              title="雙擊以快速編輯心得 / 筆記"
            >
              {insightNote}
            </div>
          ) : (
            <p
              className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-400 transition hover:bg-blue-50 cursor-pointer"
              onDoubleClick={openNoteEditor}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  openNoteEditor();
                }
              }}
              role="button"
              tabIndex={0}
              title="雙擊以新增心得 / 筆記"
            >
              目前尚未填寫心得 / 筆記。
            </p>
          )}
          {noteFeedback && (
            <div
              className={`rounded-xl px-3 py-2 text-sm ${
                noteFeedback.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {noteFeedback.message}
            </div>
          )}
        </section>
      </div>

      {noteEditorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeNoteEditor}
        >
          <div
            className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h2 id="note-editor-title" className="text-xl font-semibold text-gray-900">
                編輯心得 / 筆記
              </h2>
              <p className="text-sm text-gray-500">
                編輯後會立即儲存至雲端，並同步更新最後編輯時間。
              </p>
            </div>
            <textarea
              ref={noteTextareaRef}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              className="h-48 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-inner focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="輸入你的心得或筆記…"
            />
            {noteError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{noteError}</div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeNoteEditor}
                disabled={noteSaving}
                className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleNoteSave}
                disabled={noteSaving}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
              >
                {noteSaving ? "儲存中…" : "儲存內容"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
