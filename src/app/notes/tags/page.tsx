"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import NoteTagQuickEditor from "@/components/NoteTagQuickEditor";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { NOTE_TAG_LIMIT, normalizeNoteTags } from "@/lib/note";
import { buttonClass } from "@/lib/ui";

function formatTotal(count: number): string {
  return count.toLocaleString("zh-TW");
}

export default function NoteTagManagerPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [quickEditorOpen, setQuickEditorOpen] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
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
      setTags([]);
      setLoading(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setTags([]);
      setLoading(false);
      setTagError("Firebase 尚未設定");
      return;
    }
    setLoading(true);
    setTagError(null);
    getDoc(doc(db, "user", user.uid))
      .then((snap) => {
        if (!snap.exists()) {
          setTags([]);
          return;
        }
        const data = snap.data();
        setTags(normalizeNoteTags(data?.noteTags));
      })
      .catch((err) => {
        console.error("載入筆記標籤時發生錯誤", err);
        setTags([]);
        setTagError("載入標籤時發生錯誤");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user]);

  const filteredTags = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) {
      return tags;
    }
    return tags.filter((tag) => tag.toLowerCase().includes(keyword));
  }, [filter, tags]);

  async function persistTags(nextTags: string[]) {
    if (!user) {
      throw new Error("請先登入");
    }
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    await setDoc(
      doc(db, "user", user.uid),
      {
        noteTags: nextTags,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async function syncNotesAfterRename(target: string, nextValue: string) {
    if (!user) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    const noteQuery = query(
      collection(db, "note"),
      where("uid", "==", user.uid),
      where("tags", "array-contains", target)
    );
    const snapshot = await getDocs(noteQuery);
    if (snapshot.empty) {
      return;
    }
    const batch = writeBatch(db);
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const rawTags = Array.isArray(data?.tags) ? data.tags : [];
      const normalized = normalizeNoteTags(
        rawTags.map((tag) => (tag === target ? nextValue : tag))
      );
      batch.update(doc(db, "note", docSnap.id), {
        tags: normalized,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  async function syncNotesAfterDelete(target: string) {
    if (!user) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    const noteQuery = query(
      collection(db, "note"),
      where("uid", "==", user.uid),
      where("tags", "array-contains", target)
    );
    const snapshot = await getDocs(noteQuery);
    if (snapshot.empty) {
      return;
    }
    const batch = writeBatch(db);
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const rawTags = Array.isArray(data?.tags) ? data.tags : [];
      const normalized = normalizeNoteTags(
        rawTags.filter((tag) => tag !== target)
      );
      batch.update(doc(db, "note", docSnap.id), {
        tags: normalized,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  async function handleAddTag() {
    const value = tagInput.trim();
    if (!value) {
      setTagError("標籤不可為空");
      setTagMessage(null);
      return;
    }
    if (tags.includes(value)) {
      setTagError("已有相同標籤");
      setTagMessage(null);
      return;
    }
    if (tags.length >= NOTE_TAG_LIMIT) {
      setTagError(`最多僅能維護 ${NOTE_TAG_LIMIT} 個筆記標籤`);
      setTagMessage(null);
      return;
    }
    setSaving(true);
    setTagError(null);
    setTagMessage(null);
    try {
      const nextTags = normalizeNoteTags([...tags, value]);
      await persistTags(nextTags);
      setTags(nextTags);
      setTagInput("");
      setTagMessage(`已新增 #${value}`);
    } catch (err) {
      console.error("新增筆記標籤時發生錯誤", err);
      setTagError("新增標籤時發生錯誤");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(tag: string) {
    const nextValue = editingValue.trim();
    if (!nextValue) {
      setTagError("標籤不可為空");
      setTagMessage(null);
      return;
    }
    if (nextValue !== tag && tags.includes(nextValue)) {
      setTagError("已有相同標籤");
      setTagMessage(null);
      return;
    }
    setSaving(true);
    setTagError(null);
    setTagMessage(null);
    try {
      const nextTags = normalizeNoteTags([
        ...tags.filter((item) => item !== tag),
        nextValue,
      ]);
      await persistTags(nextTags);
      await syncNotesAfterRename(tag, nextValue);
      setTags(nextTags);
      setEditingTag(null);
      setEditingValue("");
      setTagMessage(`已將 #${tag} 更名為 #${nextValue}`);
    } catch (err) {
      console.error("重新命名筆記標籤時發生錯誤", err);
      setTagError("重新命名標籤時發生錯誤");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tag: string) {
    const confirmed = typeof window !== "undefined"
      ? window.confirm(`確定要刪除 #${tag} 嗎？`)
      : false;
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setTagError(null);
    setTagMessage(null);
    try {
      const nextTags = tags.filter((item) => item !== tag);
      await persistTags(nextTags);
      await syncNotesAfterDelete(tag);
      setTags(nextTags);
      setTagMessage(`已刪除 #${tag}`);
    } catch (err) {
      console.error("刪除筆記標籤時發生錯誤", err);
      setTagError("刪除標籤時發生錯誤");
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-semibold text-gray-900">筆記標籤管理</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理筆記標籤。
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-2">
          <Link href="/notes" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
            ← 返回筆記本
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">筆記標籤管理</h1>
          <p className="text-sm text-gray-500">
            建立、重新命名或刪除筆記共用標籤，並同步更新所有相關筆記。
          </p>
        </header>
        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="flex flex-1 flex-col space-y-2">
              <span className="text-sm font-medium text-gray-700">新增標籤</span>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={tagInput}
                  onChange={(event) => {
                    setTagInput(event.target.value);
                    setTagError(null);
                    setTagMessage(null);
                  }}
                  placeholder="輸入標籤名稱"
                  className="h-11 flex-1 rounded-xl border px-4 text-base"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleAddTag();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleAddTag()}
                  className={`${buttonClass({ variant: "primary", size: "sm" })} w-full sm:w-auto`}
                  disabled={saving}
                >
                  新增
                </button>
              </div>
            </label>
            <label className="flex flex-col space-y-1">
              <span className="text-sm font-medium text-gray-700">搜尋標籤</span>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="輸入關鍵字過濾"
                className="h-11 w-full rounded-xl border px-4 text-base"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>目前共有 {formatTotal(tags.length)} 個標籤。</span>
            <button
              type="button"
              onClick={() => setQuickEditorOpen(true)}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              使用快速編輯器
            </button>
          </div>
          {tagError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{tagError}</div>
          ) : null}
          {tagMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{tagMessage}</div>
          ) : null}
          <div className="rounded-2xl border border-gray-200">
            {loading ? (
              <div className="p-6 text-center text-sm text-gray-500">載入標籤中…</div>
            ) : filteredTags.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">沒有符合條件的標籤。</div>
            ) : (
              <ul className="divide-y text-sm text-gray-700">
                {filteredTags.map((tag) => (
                  <li key={tag} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    {editingTag === tag ? (
                      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          className="h-10 flex-1 rounded-lg border px-3 text-sm"
                          placeholder="輸入新標籤名稱"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRename(tag)}
                            className={buttonClass({ variant: "primary", size: "sm" })}
                            disabled={saving}
                          >
                            儲存
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTag(null);
                              setEditingValue("");
                              setTagError(null);
                              setTagMessage(null);
                            }}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                            disabled={saving}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="break-anywhere text-base font-medium text-gray-900">#{tag}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTag(tag);
                              setEditingValue(tag);
                              setTagError(null);
                              setTagMessage(null);
                            }}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                            disabled={saving}
                          >
                            重新命名
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(tag)}
                            className={buttonClass({ variant: "outlineDanger", size: "sm" })}
                            disabled={saving}
                          >
                            刪除
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      <NoteTagQuickEditor
        open={quickEditorOpen}
        onClose={() => setQuickEditorOpen(false)}
        userId={user.uid}
        tags={tags}
        onTagsChange={(nextTags) => {
          setTags(nextTags);
          setTagMessage("已更新標籤列表");
          setTagError(null);
        }}
        onTagRenamed={(previousTag, nextTag) => {
          setTags((prev) =>
            prev.map((tag) => (tag === previousTag ? nextTag : tag))
          );
        }}
        onTagDeleted={(target) => {
          setTags((prev) => prev.filter((tag) => tag !== target));
        }}
        onStatus={(status) => {
          setTagMessage(status.message ?? null);
          setTagError(status.error ?? null);
        }}
      />
    </main>
  );
}
