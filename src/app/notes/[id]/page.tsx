"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

import { RichTextEditor, extractPlainTextFromHtml } from "@/components/RichTextEditor";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";

type PageProps = {
  params: Promise<{ id: string }>;
};

type Note = {
  id: string;
  title: string;
  description: string | null;
  content: string;
  isFavorite: boolean;
  createdMs: number;
  updatedMs: number;
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
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const [quickEditHtml, setQuickEditHtml] = useState("");
  const [quickEditText, setQuickEditText] = useState("");
  const [quickEditSaving, setQuickEditSaving] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);

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
        const createdMs = createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
        const updatedMs = updatedAt instanceof Timestamp ? updatedAt.toMillis() : createdMs;
        setNote({
          id: snap.id,
          title: (data.title as string) || "",
          description:
            typeof data.description === "string" && data.description.trim().length > 0
              ? data.description.trim()
              : null,
          content: (data.content as string) || "",
          isFavorite: Boolean(data.isFavorite),
          createdMs,
          updatedMs,
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
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    try {
      setFavoriting(true);
      setFeedback(null);
      await updateDoc(doc(db, "note", note.id), {
        isFavorite: !note.isFavorite,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("更新最愛狀態時發生錯誤", err);
      setFeedback({ type: "error", message: "更新最愛狀態時發生錯誤" });
    } finally {
      setFavoriting(false);
    }
  }

  function handleOpenQuickEdit() {
    if (!note) {
      return;
    }
    setQuickEditHtml(note.content || "");
    setQuickEditText(extractPlainTextFromHtml(note.content || ""));
    setQuickEditError(null);
    setQuickEditOpen(true);
  }

  const handleCloseQuickEdit = useCallback(() => {
    if (quickEditSaving) {
      return;
    }
    setQuickEditOpen(false);
    setQuickEditError(null);
  }, [quickEditSaving]);

  async function handleQuickEditSave() {
    if (!note || quickEditSaving) {
      return;
    }
    const trimmedText = quickEditText.trim();
    const sanitizedHtml = quickEditHtml.trim();
    if (!trimmedText) {
      setQuickEditError("請填寫筆記內容");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setQuickEditError("Firebase 尚未設定");
      return;
    }
    try {
      setQuickEditSaving(true);
      setQuickEditError(null);
      await updateDoc(doc(db, "note", note.id), {
        content: sanitizedHtml,
        updatedAt: serverTimestamp(),
      });
      setQuickEditOpen(false);
    } catch (err) {
      console.error("快速更新筆記內容時發生錯誤", err);
      setQuickEditError("更新筆記內容時發生錯誤");
    } finally {
      setQuickEditSaving(false);
    }
  }

  useEffect(() => {
    if (!quickEditOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseQuickEdit();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseQuickEdit, quickEditOpen]);

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
    <>
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
          <section className="rounded-2xl border border-gray-200 bg-white/70 p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900">筆記內容</h2>
              <span className="text-xs text-gray-400">雙擊內容以快速編輯</span>
            </div>
            <div
              className="rich-text-content cursor-text text-base leading-relaxed text-gray-700"
              onDoubleClick={handleOpenQuickEdit}
              title="雙擊以快速編輯筆記內容"
              dangerouslySetInnerHTML={{ __html: note.content }}
            />
          </section>
          {feedback && feedback.type === "error" ? (
            <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {feedback.message}
            </div>
          ) : null}
        </div>
      </main>
      {quickEditOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          role="dialog"
          aria-modal="true"
          onClick={handleCloseQuickEdit}
        >
          <div className="w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-[80vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">快速編輯筆記內容</h2>
                <button
                  type="button"
                  onClick={handleCloseQuickEdit}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100"
                  aria-label="關閉"
                  disabled={quickEditSaving}
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-4 px-6 py-5">
                <div className="flex-1 overflow-hidden rounded-xl border border-gray-200">
                  <div className="h-full overflow-y-auto px-4 py-3">
                    <RichTextEditor
                      value={quickEditHtml}
                      onChange={({ html, text }) => {
                        setQuickEditHtml(html);
                        setQuickEditText(text);
                      }}
                      autoFocus
                      disabled={quickEditSaving}
                    />
                  </div>
                </div>
                {quickEditError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {quickEditError}
                  </div>
                ) : null}
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCloseQuickEdit}
                    disabled={quickEditSaving}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleQuickEditSave()}
                    disabled={quickEditSaving}
                    className={buttonClass({ variant: "primary" })}
                  >
                    {quickEditSaving ? "儲存中…" : "儲存"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
