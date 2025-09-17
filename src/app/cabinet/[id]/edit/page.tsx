"use client";

import Link from "next/link";
import { FormEvent, use, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

type CabinetEditPageProps = {
  params: Promise<{ id: string }>;
};

export default function CabinetEditPage({ params }: CabinetEditPageProps) {
  const { id: cabinetId } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setCanEdit(false);
      setName("");
      setMessage(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    const cabinetRef = doc(db, "cabinet", cabinetId);
    getDoc(cabinetRef)
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setError("找不到櫃子");
          setCanEdit(false);
          setLoading(false);
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setError("您沒有存取此櫃子的權限");
          setCanEdit(false);
          setLoading(false);
          return;
        }
        const nameValue =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name
            : "";
        setName(nameValue);
        setCanEdit(true);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("載入櫃子資料時發生錯誤");
        setCanEdit(false);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, cabinetId]);

  const encodedId = encodeURIComponent(cabinetId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !canEdit || saving) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名稱不可為空");
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cabinetRef = doc(db, "cabinet", cabinetId);
      await updateDoc(cabinetRef, {
        name: trimmed,
        updatedAt: serverTimestamp(),
      });
      setMessage("已更新櫃子名稱");
      setName(trimmed);
    } catch (err) {
      console.error("更新櫃子名稱失敗", err);
      setError("儲存櫃子資料時發生錯誤");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-base text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";
  const primaryButtonClass =
    "h-12 w-full rounded-xl bg-black px-6 text-base text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300";
  const secondaryButtonClass =
    "inline-flex w-full items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 sm:w-auto";

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
          <h1 className="text-2xl font-semibold text-gray-900">編輯櫃子</h1>
          <p className="text-base text-gray-600">
            未登入。請先前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            後再編輯櫃子，或返回
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">編輯櫃子</h1>
            <p className="text-sm text-gray-500">
              更新櫃子名稱，讓作品分類更清楚。
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            <Link href={`/cabinet/${encodedId}`} className={secondaryButtonClass}>
              返回櫃子內容
            </Link>
            <Link href="/cabinets" className={secondaryButtonClass}>
              返回櫃子列表
            </Link>
          </div>
        </header>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border bg-white/70 p-6 text-sm text-gray-600">
            正在載入櫃子資料…
          </div>
        ) : canEdit ? (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
            <label className="space-y-2">
              <span className="text-sm text-gray-600">櫃子名稱</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：漫畫、小說、遊戲"
                className={inputClass}
              />
            </label>
            <p className="text-xs text-gray-500">
              建議使用易懂的分類名稱，方便在物件列表中快速辨識。
            </p>
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? "儲存中…" : "儲存變更"}
            </button>
          </form>
        ) : null}

        {!loading && !canEdit && !error && (
          <div className="rounded-2xl border bg-white/70 p-6 text-sm text-gray-600">
            無法編輯此櫃子。
          </div>
        )}
      </div>
    </main>
  );
}
