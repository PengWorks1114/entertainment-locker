"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { invalidateCabinetOptions } from "@/lib/cabinet-options";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";

type Feedback = {
  type: "error" | "success";
  message: string;
};

export default function NewCabinetPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      return undefined;
    }
    const unAuth = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthChecked(true);
    });
    return () => unAuth();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      setFeedback({ type: "error", message: "請先登入" });
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFeedback({ type: "error", message: "名稱不可為空" });
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
      const cabinetsRef = collection(db, "cabinet");
      const orderSnap = await getDocs(
        query(
          cabinetsRef,
          where("uid", "==", user.uid),
          orderBy("order", "desc"),
          limit(1)
        )
      );
      let highestOrder = 0;
      orderSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (typeof data?.order === "number" && data.order > highestOrder) {
          highestOrder = data.order;
        }
      });
      const trimmedNote = note.trim();
      await addDoc(cabinetsRef, {
        uid: user.uid,
        name: trimmedName,
        note: trimmedNote ? trimmedNote : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        tags: [],
        order: highestOrder + 1,
        thumbUrl: null,
        thumbTransform: null,
        isLocked: false,
        isFavorite: false,
      });
      invalidateCabinetOptions(user.uid);
      setFeedback({ type: "success", message: "已新增櫃子" });
      setName("");
      setNote("");
      router.replace("/cabinets");
    } catch (err) {
      console.error("新增櫃子時發生錯誤", err);
      setFeedback({ type: "error", message: "新增櫃子時發生錯誤" });
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
          <h1 className="text-2xl font-semibold text-gray-900">新增櫃子</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理櫃子，或回到
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
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">新增櫃子</h1>
          <p className="text-sm text-gray-500">
            建立新的作品分類，並補充備註方便日後整理。
          </p>
        </header>
        <section className="rounded-2xl border bg-white/70 p-6 shadow-sm">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">標題</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：漫畫、小說、遊戲"
                className="h-12 w-full rounded-xl border px-4 text-base"
                autoFocus
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">備註</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="補充這個櫃子的用途或整理方式"
                className="min-h-[140px] w-full resize-y rounded-xl border px-4 py-3 text-base"
              />
            </label>
            {feedback && (
              <div
                className={
                  feedback.type === "error"
                    ? "break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
                    : "break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                }
              >
                {feedback.message}
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Link
                href="/cabinets"
                className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              >
                取消
              </Link>
              <button
                type="submit"
                disabled={saving}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {saving ? "建立中…" : "建立櫃子"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
