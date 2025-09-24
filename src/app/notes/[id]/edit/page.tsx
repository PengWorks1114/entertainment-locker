"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";

const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 300;

type Feedback = {
  type: "error" | "success";
  message: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function EditNotePage({ params }: PageProps) {
  const { id: noteId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

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
      setLoading(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      setLoading(false);
      return;
    }
    async function loadNote() {
      setLoading(true);
      setNotFound(false);
      try {
        if (!noteId) {
          setFeedback({ type: "error", message: "找不到對應的筆記" });
          setNotFound(true);
          setIsFavorite(false);
          setLoading(false);
          return;
        }
        const noteRef = doc(db, "note", noteId);
        const snap = await getDoc(noteRef);
        if (!snap.exists()) {
          setFeedback({ type: "error", message: "找不到對應的筆記" });
          setNotFound(true);
          setTitle("");
          setDescription("");
          setContent("");
          setIsFavorite(false);
          setLoading(false);
          return;
        }
        const data = snap.data();
        if (!data || data.uid !== user.uid) {
          setFeedback({ type: "error", message: "無法存取此筆記" });
          setNotFound(true);
          setTitle("");
          setDescription("");
          setContent("");
          setIsFavorite(false);
          setLoading(false);
          return;
        }
        setTitle((data.title as string) ?? "");
        setDescription(typeof data.description === "string" ? data.description : "");
        setContent((data.content as string) ?? "");
        setIsFavorite(Boolean(data.isFavorite));
        setFeedback(null);
        setNotFound(false);
      } catch (err) {
        console.error("載入筆記時發生錯誤", err);
        setFeedback({ type: "error", message: "載入筆記時發生錯誤" });
        setNotFound(true);
        setTitle("");
        setDescription("");
        setContent("");
        setIsFavorite(false);
      } finally {
        setLoading(false);
      }
    }
    loadNote();
  }, [authChecked, noteId, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || notFound) {
      return;
    }
    if (!user) {
      setFeedback({ type: "error", message: "請先登入" });
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle) {
      setFeedback({ type: "error", message: "請填寫筆記標題" });
      return;
    }
    if (trimmedTitle.length > TITLE_LIMIT) {
      setFeedback({ type: "error", message: `標題長度不可超過 ${TITLE_LIMIT} 字` });
      return;
    }
    if (trimmedDescription.length > DESCRIPTION_LIMIT) {
      setFeedback({ type: "error", message: `備註長度不可超過 ${DESCRIPTION_LIMIT} 字` });
      return;
    }
    if (!trimmedContent) {
      setFeedback({ type: "error", message: "請填寫筆記內容" });
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      if (!noteId) {
        setFeedback({ type: "error", message: "找不到對應的筆記" });
        return;
      }
      const noteRef = doc(db, "note", noteId);
      await updateDoc(noteRef, {
        title: trimmedTitle,
        description: trimmedDescription ? trimmedDescription : null,
        content: trimmedContent,
        isFavorite,
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: "success", message: "已更新筆記" });
      router.replace(`/notes/${noteId}`);
    } catch (err) {
      console.error("更新筆記時發生錯誤", err);
      setFeedback({ type: "error", message: "更新筆記時發生錯誤" });
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-semibold text-gray-900">編輯筆記</h1>
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
        <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在載入筆記…
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl space-y-4 rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold text-gray-900">編輯筆記</h1>
          </header>
          <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {feedback?.message ?? "找不到筆記，無法進行編輯。"}
          </div>
          <Link href="/notes" className={buttonClass({ variant: "secondary" })}>
            返回筆記本
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-2">
          <Link
            href={noteId ? `/notes/${noteId}` : "/notes"}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            ← 返回筆記詳情
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">編輯筆記</h1>
          <p className="text-sm text-gray-500">調整筆記內容並保存最新版本。</p>
        </header>
        <section className="rounded-2xl border bg-white/70 p-6 shadow-sm">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">筆記標題</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="輸入筆記標題"
                maxLength={TITLE_LIMIT}
                required
                className="h-12 w-full rounded-xl border px-4 text-base"
                autoFocus
              />
              <span className="block text-right text-xs text-gray-400">
                {title.trim().length}/{TITLE_LIMIT}
              </span>
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">筆記備註</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="補充筆記相關備註（選填）"
                maxLength={DESCRIPTION_LIMIT}
                className="min-h-[100px] w-full resize-y rounded-xl border px-4 py-3 text-base"
              />
              <span className="block text-right text-xs text-gray-400">
                {description.trim().length}/{DESCRIPTION_LIMIT}
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={isFavorite}
                onChange={(event) => setIsFavorite(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
              />
              設為最愛
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">筆記內容</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="輸入筆記內容"
                required
                className="min-h-[220px] w-full resize-y rounded-xl border px-4 py-3 text-base"
              />
            </label>
            {feedback ? (
              <div
                className={
                  feedback.type === "error"
                    ? "break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
                    : "break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                }
              >
                {feedback.message}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Link
                href={noteId ? `/notes/${noteId}` : "/notes"}
                className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              >
                取消
              </Link>
              <button
                type="submit"
                disabled={saving}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
              >
                {saving ? "儲存中…" : "儲存"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
