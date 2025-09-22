"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase";

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

const inputClass =
  "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";

const actionButtonClass =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm transition";

export type CabinetTagQuickEditorProps = {
  open: boolean;
  onClose: () => void;
  cabinetId: string;
  cabinetName: string;
  userId: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  onTagRenamed?: (previousTag: string, nextTag: string) => void;
  onTagDeleted?: (tag: string) => void;
  onStatus?: (status: { message?: string | null; error?: string | null }) => void;
};

export default function CabinetTagQuickEditor({
  open,
  onClose,
  cabinetId,
  cabinetName,
  userId,
  tags,
  onTagsChange,
  onTagRenamed,
  onTagDeleted,
  onStatus,
}: CabinetTagQuickEditorProps) {
  const [localTags, setLocalTags] = useState<string[]>(tags);
  const [tagInput, setTagInput] = useState("");
  const [filter, setFilter] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLocalTags(tags);
  }, [open, tags]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTagInput("");
    setFilter("");
    setEditingTag(null);
    setEditingValue("");
    setSaving(false);
    setError(null);
    setMessage(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const filteredTags = useMemo(() => {
    const queryText = filter.trim().toLowerCase();
    if (!queryText) {
      return localTags;
    }
    return localTags.filter((tag) => tag.toLowerCase().includes(queryText));
  }, [localTags, filter]);

  if (!open) {
    return null;
  }

  async function handleAddTag() {
    const value = tagInput.trim();
    if (!value) {
      setError("請輸入標籤名稱");
      setMessage(null);
      return;
    }
    if (!cabinetId || !userId) {
      setError("請先選擇可管理的櫃子");
      setMessage(null);
      return;
    }
    if (localTags.includes(value)) {
      setError("已有相同標籤");
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }
      const nextTags = normalizeCabinetTags([...localTags, value]);
      await updateDoc(doc(db, "cabinet", cabinetId), {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      setLocalTags(nextTags);
      onTagsChange(nextTags);
      setTagInput("");
      const successMessage = `已新增 #${value}`;
      setMessage(successMessage);
      onStatus?.({ message: successMessage, error: null });
    } catch (err) {
      console.error("新增標籤失敗", err);
      const failureMessage = "新增標籤時發生錯誤";
      setError(failureMessage);
      onStatus?.({ message: null, error: failureMessage });
    } finally {
      setSaving(false);
    }
  }

  async function handleRenameConfirm(target: string) {
    if (!editingTag) {
      return;
    }
    const nextValue = editingValue.trim();
    if (!nextValue) {
      setError("標籤不可為空");
      setMessage(null);
      return;
    }
    if (!cabinetId || !userId) {
      setError("請先選擇可管理的櫃子");
      setMessage(null);
      return;
    }
    if (nextValue !== target && localTags.includes(nextValue)) {
      setError("已有相同標籤");
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }
      const nextTags = normalizeCabinetTags([
        ...localTags.filter((tag) => tag !== target),
        nextValue,
      ]);
      await updateDoc(doc(db, "cabinet", cabinetId), {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      if (nextValue !== target) {
        const itemQuery = query(
          collection(db, "item"),
          where("uid", "==", userId),
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
              new Set(sourceTags.map((tag) => (tag === target ? nextValue : tag)))
            );
            batch.update(doc(db, "item", docSnap.id), { tags: updatedTags });
          });
          await batch.commit();
        }
      }
      setLocalTags(nextTags);
      onTagsChange(nextTags);
      if (nextValue !== target) {
        onTagRenamed?.(target, nextValue);
      }
      setEditingTag(null);
      setEditingValue("");
      const successMessage = "已更新標籤";
      setMessage(successMessage);
      onStatus?.({ message: successMessage, error: null });
    } catch (err) {
      console.error("更新標籤失敗", err);
      const failureMessage = "更新標籤時發生錯誤";
      setError(failureMessage);
      onStatus?.({ message: null, error: failureMessage });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTag(target: string) {
    if (!cabinetId || !userId) {
      setError("請先選擇可管理的櫃子");
      setMessage(null);
      return;
    }
    if (!window.confirm(`確認刪除標籤「${target}」？`)) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }
      const nextTags = localTags.filter((tag) => tag !== target);
      await updateDoc(doc(db, "cabinet", cabinetId), {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      const itemQuery = query(
        collection(db, "item"),
        where("uid", "==", userId),
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
      setLocalTags(nextTags);
      onTagsChange(nextTags);
      onTagDeleted?.(target);
      const successMessage = "已刪除標籤";
      setMessage(successMessage);
      onStatus?.({ message: successMessage, error: null });
    } catch (err) {
      console.error("刪除標籤失敗", err);
      const failureMessage = "刪除標籤時發生錯誤";
      setError(failureMessage);
      onStatus?.({ message: null, error: failureMessage });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">管理標籤</h2>
              <p className="text-xs text-gray-500">{cabinetName || "未命名櫃子"}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100"
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="flex h-full flex-col gap-4 px-6 py-5">
              <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
                <label className="space-y-2">
                  <span className="text-sm text-gray-600">新增標籤</span>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  className={inputClass}
                  placeholder="輸入標籤名稱"
                  disabled={saving}
                />
                <button
                  type="button"
                  onClick={() => void handleAddTag()}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-black px-4 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                  disabled={saving}
                >
                  新增
                </button>
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-gray-600">搜尋標籤</span>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className={inputClass}
                placeholder="輸入關鍵字"
                disabled={saving && !editingTag}
              />
            </label>
          </div>
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                  {error}
                </div>
              ) : null}
              {message ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                  {message}
                </div>
              ) : null}
              <div className="flex-1 min-h-0">
                <div className="h-full overflow-y-auto rounded-2xl border border-gray-100 bg-white/80 pr-1">
                  {filteredTags.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-gray-500">
                      目前沒有符合條件的標籤。
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {filteredTags.map((tag) => (
                        <li
                          key={tag}
                          className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          {editingTag === tag ? (
                            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                              <input
                                value={editingValue}
                                onChange={(event) => setEditingValue(event.target.value)}
                                className={inputClass}
                                disabled={saving}
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleRenameConfirm(tag)}
                                  className="inline-flex h-10 items-center justify-center rounded-lg bg-black px-4 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300"
                                  disabled={saving}
                                >
                                  儲存
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTag(null);
                                    setEditingValue("");
                                  }}
                                  className={`${actionButtonClass} border-gray-200 text-gray-600 hover:border-gray-300`}
                                  disabled={saving}
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-sm text-gray-700">#{tag}</div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTag(tag);
                                    setEditingValue(tag);
                                    setError(null);
                                    setMessage(null);
                                  }}
                                  className={`${actionButtonClass} border-gray-200 text-gray-600 hover:border-gray-300`}
                                  disabled={saving}
                                >
                                  重新命名
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteTag(tag)}
                                  className={`${actionButtonClass} border-red-200 text-red-600 hover:border-red-300`}
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
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm text-gray-700 transition hover:border-gray-300"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
