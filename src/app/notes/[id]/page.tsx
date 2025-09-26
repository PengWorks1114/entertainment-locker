"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { markdownPreviewHtml } from "@/lib/markdown";
import { buttonClass } from "@/lib/ui";
import {
  buildFavoriteTogglePayload,
  extractFirestoreErrorMessage,
} from "@/lib/noteForm";

type PageProps = {
  params: Promise<{ id: string }>;
};

type Note = {
  id: string;
  title: string;
  description: string | null;
  content: string;
  contentMarkdown: string | null;
  tags: string[];
  linkedCabinetIds: string[];
  linkedItemIds: string[];
  isFavorite: boolean;
  createdMs: number;
  updatedMs: number;
  createdAtTimestamp: Timestamp | null;
};

type CabinetOption = {
  id: string;
  name: string;
  isLocked: boolean;
};

type ItemOption = {
  id: string;
  title: string;
  cabinetId: string | null;
};

type LinkedItemInfo = ItemOption & {
  cabinetLocked: boolean;
};

type Feedback = {
  type: "error" | "success";
  message: string;
};

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(ms: number): string {
  if (!ms) {
    return "—";
  }
  try {
    return dateFormatter.format(new Date(ms));
  } catch {
    return "—";
  }
}

export default function NoteDetailPage({ params }: PageProps) {
  const { id: noteId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [viewMode, setViewMode] = useState<"rich" | "markdown">("rich");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      setLoading(false);
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
      setCabinetOptions([]);
      setItemOptions([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const cabinetQuery = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    const itemQuery = query(collection(db, "item"), where("uid", "==", user.uid));

    const unsubCabinet = onSnapshot(
      cabinetQuery,
      (snapshot) => {
        setCabinetOptions(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                name: typeof data?.name === "string" ? data.name : "未命名櫃子",
                isLocked: Boolean(data?.isLocked),
              } satisfies CabinetOption;
            })
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
        );
      },
      () => {
        setFeedback({ type: "error", message: "載入櫃子資訊時發生錯誤" });
      }
    );

    const unsubItem = onSnapshot(
      itemQuery,
      (snapshot) => {
        setItemOptions(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                title:
                  typeof data?.titleZh === "string" && data.titleZh.trim()
                    ? (data.titleZh as string)
                    : "未命名作品",
                cabinetId:
                  typeof data?.cabinetId === "string" && data.cabinetId.trim().length > 0
                    ? (data.cabinetId as string)
                    : null,
              } satisfies ItemOption;
            })
            .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"))
        );
      },
      () => {
        setFeedback({ type: "error", message: "載入作品資訊時發生錯誤" });
      }
    );

    return () => {
      unsubCabinet();
      unsubItem();
    };
  }, [user]);

  useEffect(() => {
    if (!authChecked) {
      return;
    }
    if (!user) {
      setNote(null);
      setLoading(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      setLoading(false);
      return;
    }
    if (!noteId) {
      return;
    }
    const noteRef = doc(db, "note", noteId);
    const unsub = onSnapshot(
      noteRef,
      (snap) => {
        if (!snap.exists()) {
          setNote(null);
          setFeedback({ type: "error", message: "找不到對應的筆記" });
          setLoading(false);
          return;
        }
        const data = snap.data();
        if (!data || data.uid !== user.uid) {
          setNote(null);
          setFeedback({ type: "error", message: "無法存取此筆記" });
          setLoading(false);
          return;
        }
        const createdAt = data.createdAt;
        const updatedAt = data.updatedAt;
        const createdTimestamp = createdAt instanceof Timestamp ? createdAt : null;
        const createdMs = createdTimestamp ? createdTimestamp.toMillis() : 0;
        const updatedMs = updatedAt instanceof Timestamp ? updatedAt.toMillis() : createdMs;
        const markdownContent =
          typeof data.contentMarkdown === "string" && data.contentMarkdown.trim().length > 0
            ? data.contentMarkdown
            : null;
        const tags = Array.isArray(data.tags)
          ? data.tags.filter((value): value is string => typeof value === "string")
          : [];
        const linkedCabinetIds = Array.isArray(data.linkedCabinetIds)
          ? data.linkedCabinetIds.filter((value): value is string => typeof value === "string")
          : [];
        const linkedItemIds = Array.isArray(data.linkedItemIds)
          ? data.linkedItemIds.filter((value): value is string => typeof value === "string")
          : [];
        setNote({
          id: snap.id,
          title: (data.title as string) || "",
          description:
            typeof data.description === "string" && data.description.trim().length > 0
              ? data.description.trim()
              : null,
          content: (data.content as string) || "",
          contentMarkdown: markdownContent,
          tags,
          linkedCabinetIds,
          linkedItemIds,
          isFavorite: Boolean(data.isFavorite),
          createdMs,
          updatedMs,
          createdAtTimestamp: createdTimestamp,
        });
        setFeedback(null);
        setLoading(false);
      },
      () => {
        setFeedback({ type: "error", message: "載入筆記時發生錯誤" });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [authChecked, noteId, user]);

  const linkedCabinets = useMemo(() => {
    if (!note) {
      return [] as CabinetOption[];
    }
    return note.linkedCabinetIds
      .map((id) => cabinetOptions.find((option) => option.id === id))
      .filter((option): option is CabinetOption => Boolean(option));
  }, [cabinetOptions, note]);

  const cabinetLockMap = useMemo(() => {
    const map = new Map<string, boolean>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option.isLocked);
    });
    return map;
  }, [cabinetOptions]);

  const cabinetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option.name);
    });
    return map;
  }, [cabinetOptions]);

  const linkedItems = useMemo(() => {
    if (!note) {
      return [] as LinkedItemInfo[];
    }
    return note.linkedItemIds
      .map((id) => itemOptions.find((option) => option.id === id))
      .filter((option): option is ItemOption => Boolean(option))
      .map((option) => ({
        ...option,
        cabinetLocked: option.cabinetId ? cabinetLockMap.get(option.cabinetId) ?? false : false,
      }));
  }, [cabinetLockMap, itemOptions, note]);

  const showCabinetLockedAlert = useCallback(() => {
    if (typeof window !== "undefined") {
      window.alert("因該櫃子目前處於鎖定狀態，因此無法訪問該櫃子");
    }
  }, []);

  const showItemLockedAlert = useCallback(() => {
    if (typeof window !== "undefined") {
      window.alert("因該物件所屬櫃子目前處於鎖定狀態，因此無法訪問該物件");
    }
  }, []);

  const markdownPreview = useMemo(
    () => markdownPreviewHtml(note?.contentMarkdown ?? ""),
    [note?.contentMarkdown]
  );

  const metaInfo = useMemo(() => {
    if (!note) {
      return null;
    }
    return (
      <dl className="grid gap-4 rounded-2xl border border-gray-200 bg-white/60 p-4 text-sm text-gray-600 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="font-medium text-gray-700">建立時間</dt>
          <dd>{formatDateTime(note.createdMs)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="font-medium text-gray-700">更新時間</dt>
          <dd>{formatDateTime(note.updatedMs)}</dd>
        </div>
      </dl>
    );
  }, [note]);

  async function handleDelete() {
    if (!note || deleting) {
      return;
    }
    const confirmed = typeof window !== "undefined" ? window.confirm("確定要刪除這筆筆記嗎？") : false;
    if (!confirmed) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    setDeleting(true);
    setFeedback(null);
    try {
      await deleteDoc(doc(db, "note", note.id));
      router.replace("/notes");
    } catch (err) {
      console.error("刪除筆記時發生錯誤", err);
      setFeedback({ type: "error", message: "刪除筆記時發生錯誤" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleFavorite() {
    if (!note || favoriting) {
      return;
    }
    if (!user) {
      setFeedback({ type: "error", message: "請先登入" });
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    try {
      setFavoriting(true);
      setFeedback(null);
      await updateDoc(
        doc(db, "note", note.id),
        buildFavoriteTogglePayload(user.uid, !note.isFavorite, note.createdAtTimestamp)
      );
    } catch (err) {
      console.error("更新最愛狀態時發生錯誤", err);
      setFeedback({
        type: "error",
        message: extractFirestoreErrorMessage(err, "更新最愛狀態時發生錯誤"),
      });
    } finally {
      setFavoriting(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">筆記詳情</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理筆記，或回到
            <Link href="/" className="ml-1 underline">
              首頁
            </Link>
            了解更多功能。
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在載入筆記…
        </div>
      </main>
    );
  }

  if (!note) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-3xl space-y-4 rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold text-gray-900">筆記詳情</h1>
          </header>
          {feedback ? (
            <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {feedback.message}
            </div>
          ) : (
            <p className="text-sm text-gray-600">找不到筆記，可能已被刪除。</p>
          )}
          <Link href="/notes" className={buttonClass({ variant: "secondary" })}>
            返回筆記本
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-3">
          <Link href="/notes" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
            ← 返回筆記本
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2 sm:flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="break-anywhere text-3xl font-semibold text-gray-900">
                  {note.title || "(未命名筆記)"}
                </h1>
                {note.isFavorite ? (
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700">
                    最愛
                  </span>
                ) : null}
              </div>
              {note.description ? (
                <p className="break-anywhere whitespace-pre-line text-sm text-gray-600">{note.description}</p>
              ) : null}
              {note.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3 sm:flex-none">
              <button
                type="button"
                onClick={handleToggleFavorite}
                disabled={favoriting}
                className={buttonClass({ variant: note.isFavorite ? "primary" : "secondary" })}
                aria-pressed={note.isFavorite}
              >
                {favoriting ? "更新中…" : note.isFavorite ? "取消最愛" : "加入最愛"}
              </button>
              <Link
                href={`/notes/${note.id}/edit`}
                className={buttonClass({ variant: "secondary" })}
              >
                編輯筆記
              </Link>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className={buttonClass({ variant: "outlineDanger" })}
              >
                {deleting ? "刪除中…" : "刪除筆記"}
              </button>
            </div>
          </div>
        </header>
        {metaInfo}
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">整理資訊</h2>
          <div className="space-y-4 text-sm text-gray-700">
            <div className="space-y-2">
              <h3 className="font-medium text-gray-800">標籤</h3>
              {note.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">尚未新增標籤。</p>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="font-medium text-gray-800">櫃子</h3>
              {linkedCabinets.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {linkedCabinets.map((cabinet) => (
                    <li key={cabinet.id}>
                      {cabinet.isLocked ? (
                        <button
                          type="button"
                          onClick={showCabinetLockedAlert}
                          className="inline-flex items-center rounded-full border border-dashed border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-500"
                        >
                          🔒 {cabinet.name}
                        </button>
                      ) : (
                        <Link
                          href={`/cabinet/${cabinet.id}`}
                          className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:border-indigo-200 hover:bg-indigo-100"
                        >
                          {cabinet.name}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">尚未連結任何櫃子。</p>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="font-medium text-gray-800">作品</h3>
              {linkedItems.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {linkedItems.map((item) => {
                    const cabinetLabel = item.cabinetId
                      ? cabinetNameMap.get(item.cabinetId) ?? null
                      : null;
                    return (
                      <li key={item.id}>
                        {item.cabinetLocked ? (
                          <button
                            type="button"
                            onClick={showItemLockedAlert}
                            className="inline-flex items-center rounded-full border border-dashed border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-500"
                          >
                            🔒 {item.title}
                            {cabinetLabel ? (
                              <span className="ml-1 text-[11px] text-sky-500">（{cabinetLabel}）</span>
                            ) : null}
                          </button>
                        ) : (
                          <Link
                            href={`/item/${item.id}`}
                            className="inline-flex items-center rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 transition hover:border-sky-200 hover:bg-sky-100"
                          >
                            {item.title}
                            {cabinetLabel ? (
                              <span className="ml-1 text-[11px] text-sky-600">（{cabinetLabel}）</span>
                            ) : null}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">尚未連結任何作品。</p>
              )}
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white/70 p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">筆記內容</h2>
            <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-1 py-1 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("rich")}
                className={
                  viewMode === "rich"
                    ? "rounded-full bg-gray-900 px-3 py-1 font-medium text-white"
                    : "rounded-full px-3 py-1 text-gray-600 hover:text-gray-800"
                }
              >
                富文本
              </button>
              <button
                type="button"
                onClick={() => setViewMode("markdown")}
                className={
                  viewMode === "markdown"
                    ? "rounded-full bg-gray-900 px-3 py-1 font-medium text-white"
                    : "rounded-full px-3 py-1 text-gray-600 hover:text-gray-800"
                }
                disabled={!note.contentMarkdown}
              >
                Markdown
              </button>
            </div>
          </div>
          {viewMode === "markdown" ? (
            note.contentMarkdown ? (
              <div
                className="markdown-preview text-base leading-relaxed text-gray-700"
                dangerouslySetInnerHTML={{ __html: markdownPreview }}
              />
            ) : (
              <p className="text-sm text-gray-500">尚未提供 Markdown 內容，已顯示富文本版本。</p>
            )
          ) : (
            <div
              className="rich-text-content text-base leading-relaxed text-gray-700"
              dangerouslySetInnerHTML={{ __html: note.content }}
            />
          )}
        </section>
        {feedback && feedback.type === "error" ? (
          <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {feedback.message}
          </div>
        ) : null}
      </div>
    </main>
  );
}
