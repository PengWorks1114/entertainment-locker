"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, onSnapshot, query, Timestamp, where } from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";

type Note = {
  id: string;
  title: string;
  summary: string | null;
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

export default function NotesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
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
      setNotes([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }

    const q = query(collection(db, "note"), where("uid", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const rows: Note[] = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const createdAt = data?.createdAt;
            const updatedAt = data?.updatedAt;
            const createdMs = createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
            const updatedMs = updatedAt instanceof Timestamp ? updatedAt.toMillis() : createdMs;
            const summary =
              typeof data?.description === "string" && data.description.trim().length > 0
                ? data.description.trim()
                : null;
            return {
              id: docSnap.id,
              title: (data?.title as string) || "",
              summary,
              createdMs,
              updatedMs,
            } satisfies Note;
          })
          .sort((a, b) => b.updatedMs - a.updatedMs);
        setNotes(rows);
        setFeedback(null);
      },
      () => {
        setFeedback({ type: "error", message: "載入筆記時發生錯誤" });
      }
    );
    return () => unsub();
  }, [user]);

  const hasNotes = notes.length > 0;

  const content = useMemo(() => {
    if (!hasNotes) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-10 text-center text-gray-500">
          尚未建立任何筆記。
        </div>
      );
    }

    return (
      <ul className="divide-y rounded-2xl border border-gray-200 bg-white/70 shadow-sm">
        {notes.map((note) => (
          <li key={note.id}>
            <Link
              href={`/notes/${note.id}`}
              className="flex flex-col gap-2 px-6 py-5 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-gray-900">{note.title || "(未命名筆記)"}</h2>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                  <div className="flex gap-1">
                    <dt className="font-medium">建立：</dt>
                    <dd>{formatDateTime(note.createdMs)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="font-medium">更新：</dt>
                    <dd>{formatDateTime(note.updatedMs)}</dd>
                  </div>
                </dl>
              </div>
              {note.summary ? (
                <p className="line-clamp-2 text-sm text-gray-600">{note.summary}</p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    );
  }, [hasNotes, notes]);

  if (!authChecked) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-4xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">筆記本</h1>
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

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">筆記本</h1>
            <p className="text-sm text-gray-500">管理與檢視所有筆記紀錄。</p>
          </div>
          <Link href="/notes/new" className={buttonClass({ variant: "primary" })}>
            新增筆記
          </Link>
        </header>
        {feedback && feedback.type === "error" ? (
          <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {feedback.message}
          </div>
        ) : null}
        {content}
      </div>
    </main>
  );
}
