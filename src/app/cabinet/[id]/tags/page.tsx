"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";

type CabinetTagPageProps = {
  params: Promise<{ id: string }>;
};

function normalizeCabinetTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(
      input
        .map((tag) => String(tag ?? "").trim())
        .filter((tag): tag is string => tag.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

export default function CabinetTagManagerPage({ params }: CabinetTagPageProps) {
  const { id: cabinetId } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [cabinetName, setCabinetName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [tagSaving, setTagSaving] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setLoading(false);
      setError("Firebase 尚未設定");
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
      setLoading(false);
      setCanEdit(false);
      setCabinetName("");
      setTags([]);
      setTagInput("");
      setTagMessage(null);
      setTagError(null);
      setEditingTag(null);
      setEditingValue("");
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setTagError(null);
    setTagMessage(null);
    const db = getFirebaseDb();
    if (!db) {
      setError("Firebase 尚未設定");
      setCanEdit(false);
      setLoading(false);
      setTags([]);
      return;
    }
    const cabinetRef = doc(db, "cabinet", cabinetId);
    getDoc(cabinetRef)
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setError("找不到櫃子");
          setCanEdit(false);
          setLoading(false);
          setCabinetName("");
          setTags([]);
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setError("您沒有存取此櫃子的權限");
          setCanEdit(false);
          setLoading(false);
          setCabinetName("");
          setTags([]);
          return;
        }
        const nameValue =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name.trim()
            : "未命名櫃子";
        setCabinetName(nameValue);
        setTags(normalizeCabinetTags(data?.tags));
        setCanEdit(true);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("載入櫃子資料時發生錯誤");
        setCanEdit(false);
        setLoading(false);
        setCabinetName("");
        setTags([]);
      });
    return () => {
      active = false;
    };
  }, [user, cabinetId]);

  async function handleAddTag() {
    if (!user || !canEdit || tagSaving) {
      return;
    }
    const trimmed = tagInput.trim();
    if (!trimmed) {
      setTagError("標籤不可為空");
      setTagMessage(null);
      return;
    }
    if (tags.includes(trimmed)) {
      setTagError("已有相同標籤");
      setTagMessage(null);
      return;
    }
    setTagSaving(true);
    setTagError(null);
    setTagMessage(null);
    try {
      const nextTags = normalizeCabinetTags([...tags, trimmed]);
      const db = getFirebaseDb();
      if (!db) {
        setTagError("Firebase 尚未設定");
        setTagSaving(false);
        return;
      }
      const cabinetRef = doc(db, "cabinet", cabinetId);
      await updateDoc(cabinetRef, {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      setTags(nextTags);
      setTagInput("");
      setTagMessage("已新增標籤");
    } catch (err) {
      console.error("新增標籤失敗", err);
      setTagError("新增標籤時發生錯誤");
    } finally {
      setTagSaving(false);
    }
  }

  async function handleRenameTag(target: string) {
    if (!user || !canEdit || tagSaving) {
      return;
    }
    const trimmed = editingValue.trim();
    if (!trimmed) {
      setTagError("標籤不可為空");
      setTagMessage(null);
      return;
    }
    if (trimmed !== target && tags.includes(trimmed)) {
      setTagError("已有相同標籤");
      setTagMessage(null);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setTagError("Firebase 尚未設定");
      return;
    }
    setTagSaving(true);
    setTagError(null);
    setTagMessage(null);
    try {
      const nextTags = normalizeCabinetTags([
        ...tags.filter((tag) => tag !== target),
        trimmed,
      ]);
      const cabinetRef = doc(db, "cabinet", cabinetId);
      await updateDoc(cabinetRef, {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      if (trimmed !== target) {
        const itemQuery = query(
          collection(db, "item"),
          where("uid", "==", user.uid),
          where("cabinetId", "==", cabinetId),
          where("tags", "array-contains", target)
        );
        const snap = await getDocs(itemQuery);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.forEach((docSnap) => {
            const data = docSnap.data();
            const sourceTags = Array.isArray(data?.tags)
              ? data.tags
                  .map((tag: unknown) => String(tag ?? "").trim())
                  .filter((tag: string) => tag.length > 0)
              : [];
            const updatedTags = Array.from(
              new Set(
                sourceTags.map((tag) => (tag === target ? trimmed : tag))
              )
            );
            batch.update(doc(db, "item", docSnap.id), { tags: updatedTags });
          });
          await batch.commit();
        }
      }
      setTags(nextTags);
      setEditingTag(null);
      setEditingValue("");
      setTagMessage("已更新標籤");
    } catch (err) {
      console.error("更新標籤失敗", err);
      setTagError("更新標籤時發生錯誤");
    } finally {
      setTagSaving(false);
    }
  }

  async function handleDeleteTag(target: string) {
    if (!user || !canEdit || tagSaving) {
      return;
    }
    if (!window.confirm(`確認刪除標籤「${target}」？`)) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setTagError("Firebase 尚未設定");
      return;
    }
    setTagSaving(true);
    setTagError(null);
    setTagMessage(null);
    try {
      const nextTags = tags.filter((tag) => tag !== target);
      const cabinetRef = doc(db, "cabinet", cabinetId);
      await updateDoc(cabinetRef, {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      const itemQuery = query(
        collection(db, "item"),
        where("uid", "==", user.uid),
        where("cabinetId", "==", cabinetId),
        where("tags", "array-contains", target)
      );
      const snap = await getDocs(itemQuery);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const sourceTags = Array.isArray(data?.tags)
            ? data.tags
                .map((tag: unknown) => String(tag ?? "").trim())
                .filter((tag: string) => tag.length > 0)
            : [];
          const updatedTags = sourceTags.filter((tag) => tag !== target);
          batch.update(doc(db, "item", docSnap.id), { tags: updatedTags });
        });
        await batch.commit();
      }
      setTags(nextTags);
      if (editingTag === target) {
        setEditingTag(null);
        setEditingValue("");
      }
      setTagMessage("已刪除標籤");
    } catch (err) {
      console.error("刪除標籤失敗", err);
      setTagError("刪除標籤時發生錯誤");
    } finally {
      setTagSaving(false);
    }
  }

  const inputClass =
    "h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";

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
          <h1 className="text-2xl font-semibold text-gray-900">櫃子標籤管理</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理標籤，或回到
            <Link href="/" className="ml-1 underline">
              首頁
            </Link>
            了解更多功能。
          </p>
        </div>
      </main>
    );
  }

  const encodedId = encodeURIComponent(cabinetId);

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">櫃子標籤管理</h1>
            <p className="text-sm text-gray-500">管理 {cabinetName} 的共享標籤。</p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            <Link
              href={`/cabinet/${encodedId}`}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-700 shadow-sm transition hover:border-gray-300 sm:w-auto"
            >
              返回櫃子內容
            </Link>
            <Link
              href={`/cabinet/${encodedId}/edit`}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-700 shadow-sm transition hover:border-gray-300 sm:w-auto"
            >
              編輯櫃子
            </Link>
          </div>
        </header>

        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          {loading ? (
            <p className="text-sm text-gray-500">載入標籤中…</p>
          ) : error ? (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : !canEdit ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              您沒有管理此櫃子標籤的權限。
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-gray-900">標籤管理</h2>
                <p className="text-sm text-gray-500">
                  建立共享標籤後，物件編輯頁面即可直接勾選使用，也可在此重新命名或刪除。
                </p>
              </div>

              {tagError && (
                <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">{tagError}</div>
              )}
              {tagMessage && (
                <div className="break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{tagMessage}</div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="輸入新標籤，例如：漫畫、輕小說"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  disabled={tagSaving}
                  className="h-11 rounded-xl bg-blue-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {tagSaving ? "處理中…" : "新增標籤"}
                </button>
              </div>

              {tags.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-200 bg-white/70 px-4 py-6 text-center text-sm text-gray-500">
                  目前尚未建立任何標籤。
                </p>
              ) : (
                <ul className="space-y-3">
                  {tags.map((tag) => {
                    const isEditing = editingTag === tag;
                    return (
                      <li
                        key={tag}
                        className="min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm"
                      >
                        {isEditing ? (
                          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                            <input
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              className={`${inputClass} sm:min-w-0 sm:flex-1`}
                            />
                            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                              <button
                                type="button"
                                onClick={() => handleRenameTag(tag)}
                                disabled={tagSaving}
                                className="rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                              >
                                儲存
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTag(null);
                                  setEditingValue("");
                                }}
                                disabled={tagSaving}
                                className="rounded-full border border-gray-200 px-4 py-2 text-xs text-gray-600 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:min-w-0">
                            <span className="break-anywhere text-sm font-medium text-gray-900 sm:min-w-0 sm:flex-1">#{tag}</span>
                            <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTag(tag);
                                  setEditingValue(tag);
                                  setTagError(null);
                                  setTagMessage(null);
                                }}
                                disabled={tagSaving}
                                className="rounded-full border border-gray-200 px-4 py-2 text-xs text-gray-600 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                重新命名
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTag(tag)}
                                disabled={tagSaving}
                                className="rounded-full border border-red-200 px-4 py-2 text-xs text-red-600 transition hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                刪除
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
