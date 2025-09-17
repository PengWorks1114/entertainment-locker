"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";
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

import { auth, db } from "@/lib/firebase";
import { deleteCabinetWithItems } from "@/lib/firestore-utils";

type CabinetEditPageProps = {
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

export default function CabinetEditPage({ params }: CabinetEditPageProps) {
  const { id: cabinetId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [tagSaving, setTagSaving] = useState(false);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

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
      setDeleteError(null);
      setTags([]);
      setTagInput("");
      setTagMessage(null);
      setTagError(null);
      setEditingTag(null);
      setEditingValue("");
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setDeleteError(null);
    setMessage(null);
    const cabinetRef = doc(db, "cabinet", cabinetId);
    getDoc(cabinetRef)
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setError("找不到櫃子");
          setCanEdit(false);
          setLoading(false);
          setTags([]);
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setError("您沒有存取此櫃子的權限");
          setCanEdit(false);
          setLoading(false);
          setTags([]);
          return;
        }
        const nameValue =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name
            : "";
        setName(nameValue);
        setCanEdit(true);
        setTags(normalizeCabinetTags(data?.tags));
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("載入櫃子資料時發生錯誤");
        setCanEdit(false);
        setLoading(false);
        setTags([]);
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
      setMessage("名稱不可為空");
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
      setName(trimmed);
      setMessage("已更新櫃子名稱");
    } catch (err) {
      console.error("更新櫃子名稱失敗", err);
      setMessage("儲存櫃子資料時發生錯誤");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!message) {
      return;
    }
    if (typeof window !== "undefined") {
      window.alert(message);
    }
    setMessage(null);
  }, [message]);

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
    "h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-base text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";
  const primaryButtonClass =
    "h-12 w-full rounded-xl bg-black px-6 text-base text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300";
  const secondaryButtonClass =
    "inline-flex w-full items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 sm:w-auto";
  const dangerButtonClass =
    "inline-flex w-full items-center justify-center rounded-full border border-red-200 bg-white px-4 py-2 text-sm text-red-600 shadow-sm transition hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-70";

  async function handleDeleteCabinet() {
    if (!user || !canEdit || deleting) {
      return;
    }
    if (
      !window.confirm(
        "確定要刪除此櫃子？將同步刪除櫃內所有作品與進度資料。"
      )
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCabinetWithItems(cabinetId, user.uid);
      router.push("/cabinets");
    } catch (err) {
      console.error("刪除櫃子失敗", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "刪除櫃子時發生錯誤";
      setDeleteError(message);
    } finally {
      setDeleting(false);
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

        {deleteError && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {deleteError}
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

        {!loading && canEdit && (
          <section
            id="tag-manager"
            className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">標籤管理</h2>
              <p className="text-sm text-gray-500">
                建立共享標籤後，物件編輯頁面即可直接勾選使用，也可在此重新命名或刪除。
              </p>
            </div>
            {tagError && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">
                {tagError}
              </div>
            )}
            {tagMessage && (
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
                {tagMessage}
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder="輸入新標籤，例如：漫畫、輕小說"
                className="h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none"
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
                      className="rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm"
                    >
                      {isEditing ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <input
                            value={editingValue}
                            onChange={(event) => setEditingValue(event.target.value)}
                            className="h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none"
                          />
                          <div className="flex gap-2">
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
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-sm font-medium text-gray-900">#{tag}</span>
                          <div className="flex gap-2">
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
          </section>
        )}

        {!loading && canEdit && (
          <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50/70 p-6 shadow-sm">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-red-700">刪除此櫃子</h2>
              <p className="text-sm text-red-600">
                刪除後將移除櫃子內所有作品與進度資料，無法復原，請再次確認。
              </p>
            </div>
            <button
              type="button"
              onClick={handleDeleteCabinet}
              disabled={deleting}
              className={dangerButtonClass}
            >
              {deleting ? "刪除中…" : "刪除此櫃子"}
            </button>
          </section>
        )}

        {!loading && !canEdit && !error && (
          <div className="rounded-2xl border bg-white/70 p-6 text-sm text-gray-600">
            無法編輯此櫃子。
          </div>
        )}
      </div>
    </main>
  );
}
