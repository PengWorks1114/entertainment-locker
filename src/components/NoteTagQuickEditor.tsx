"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { getFirebaseDb } from "@/lib/firebase";
import { normalizeNoteTags } from "@/lib/note";

const inputClass =
  "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";

const actionButtonClass =
  "inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm transition";

const TAG_MAX_LENGTH = 50;

type StatusState = { message?: string | null; error?: string | null };

type NoteTagQuickEditorProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  onTagRenamed?: (previousTag: string, nextTag: string) => void;
  onTagDeleted?: (tag: string) => void;
  onStatus?: (status: StatusState) => void;
};

export default function NoteTagQuickEditor({
  open,
  onClose,
  userId,
  tags,
  onTagsChange,
  onTagRenamed,
  onTagDeleted,
  onStatus,
}: NoteTagQuickEditorProps) {
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
    const keyword = filter.trim().toLowerCase();
    if (!keyword) {
      return localTags;
    }
    return localTags.filter((tag) => tag.toLowerCase().includes(keyword));
  }, [localTags, filter]);

  if (!open) {
    return null;
  }

  async function persistNoteTags(nextTags: string[]) {
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    const userRef = doc(db, "user", userId);
    await setDoc(
      userRef,
      {
        noteTags: nextTags,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async function syncNotesAfterRename(target: string, nextValue: string) {
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    const noteQuery = query(
      collection(db, "note"),
      where("uid", "==", userId),
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
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    const noteQuery = query(
      collection(db, "note"),
      where("uid", "==", userId),
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
      setError("請輸入標籤名稱");
      setMessage(null);
      onStatus?.({ message: null, error: "請輸入標籤名稱" });
      return;
    }
    if (value.length > TAG_MAX_LENGTH) {
      const errorMessage = `標籤長度不可超過 ${TAG_MAX_LENGTH} 字`;
      setError(errorMessage);
      setMessage(null);
      onStatus?.({ message: null, error: errorMessage });
      return;
    }
    const normalizedValue = value.toLowerCase();
    if (localTags.some((tag) => tag.toLowerCase() === normalizedValue)) {
      const messageText = `已選取 #${value}`;
      setError(null);
      setMessage(messageText);
      onStatus?.({ message: messageText, error: null });
      setTagInput("");
      return;
    }
    if (!userId) {
      setError("請先登入");
      setMessage(null);
      onStatus?.({ message: null, error: "請先登入" });
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextTags = normalizeNoteTags([...localTags, value]);
      await persistNoteTags(nextTags);
      setLocalTags(nextTags);
      onTagsChange(nextTags);
      setTagInput("");
      const successMessage = `已新增 #${value}`;
      setMessage(successMessage);
      onStatus?.({ message: successMessage, error: null });
    } catch (err) {
      console.error("新增筆記標籤時發生錯誤", err);
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
      onStatus?.({ message: null, error: "標籤不可為空" });
      return;
    }
    if (nextValue.length > TAG_MAX_LENGTH) {
      const errorMessage = `標籤長度不可超過 ${TAG_MAX_LENGTH} 字`;
      setError(errorMessage);
      setMessage(null);
      onStatus?.({ message: null, error: errorMessage });
      return;
    }
    if (!userId) {
      setError("請先登入");
      setMessage(null);
      onStatus?.({ message: null, error: "請先登入" });
      return;
    }
    const normalizedTarget = target.toLowerCase();
    const normalizedNext = nextValue.toLowerCase();
    if (normalizedNext !== normalizedTarget && localTags.some((tag) => tag.toLowerCase() === normalizedNext)) {
      setError("已有相同標籤");
      setMessage(null);
      onStatus?.({ message: null, error: "已有相同標籤" });
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextTags = normalizeNoteTags([
        ...localTags.filter((tag) => tag !== target),
        nextValue,
      ]);
      await persistNoteTags(nextTags);
      await syncNotesAfterRename(target, nextValue);
      setLocalTags(nextTags);
      onTagsChange(nextTags);
      onTagRenamed?.(target, nextValue);
      setEditingTag(null);
      setEditingValue("");
      const successMessage = `已將 #${target} 更名為 #${nextValue}`;
      setMessage(successMessage);
      onStatus?.({ message: successMessage, error: null });
    } catch (err) {
      console.error("重新命名筆記標籤時發生錯誤", err);
      const failureMessage = "重新命名標籤時發生錯誤";
      setError(failureMessage);
      onStatus?.({ message: null, error: failureMessage });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTag(target: string) {
    if (!userId) {
      setError("請先登入");
      setMessage(null);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextTags = localTags.filter((tag) => tag !== target);
      await persistNoteTags(nextTags);
      await syncNotesAfterDelete(target);
      setLocalTags(nextTags);
      onTagsChange(nextTags);
      onTagDeleted?.(target);
      const successMessage = `已刪除 #${target}`;
      setMessage(successMessage);
      onStatus?.({ message: successMessage, error: null });
    } catch (err) {
      console.error("刪除筆記標籤時發生錯誤", err);
      const failureMessage = "刪除標籤時發生錯誤";
      setError(failureMessage);
      onStatus?.({ message: null, error: failureMessage });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-gray-900">筆記標籤管理</h2>
          <p className="text-sm text-gray-500">新增、重新命名或刪除筆記共用標籤。</p>
        </header>
        <div className="space-y-3">
          <label className="space-y-1">
            <span className="text-sm text-gray-600">搜尋既有標籤</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="輸入關鍵字"
              className={inputClass}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm text-gray-600">新增標籤</span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                placeholder="輸入標籤後按新增"
                className={inputClass}
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
                className={`${actionButtonClass} border-gray-200 bg-gray-900 text-white hover:bg-gray-800`}
                disabled={saving}
              >
                新增標籤
              </button>
            </div>
          </label>
        </div>
        <div className="flex-1 overflow-auto rounded-xl border border-gray-200">
          {filteredTags.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">尚未建立任何標籤。</div>
          ) : (
            <ul className="divide-y text-sm text-gray-700">
              {filteredTags.map((tag) => (
                <li key={tag} className="flex items-center justify-between gap-3 px-4 py-3">
                  {editingTag === tag ? (
                    <div className="flex flex-1 items-center gap-2">
                      <input
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                        className={inputClass}
                        placeholder="輸入新標籤名稱"
                      />
                      <button
                        type="button"
                        className={`${actionButtonClass} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                        onClick={() => void handleRenameConfirm(tag)}
                        disabled={saving}
                      >
                        儲存
                      </button>
                      <button
                        type="button"
                        className={`${actionButtonClass} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}
                        onClick={() => {
                          setEditingTag(null);
                          setEditingValue("");
                        }}
                        disabled={saving}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-between gap-3">
                      <span className="break-anywhere text-sm font-medium text-gray-800">#{tag}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className={`${actionButtonClass} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}
                          onClick={() => {
                            setEditingTag(tag);
                            setEditingValue(tag);
                            setError(null);
                            setMessage(null);
                          }}
                          disabled={saving}
                        >
                          重新命名
                        </button>
                        <button
                          type="button"
                          className={`${actionButtonClass} border-red-200 bg-red-50 text-red-600 hover:bg-red-100`}
                          onClick={() => void handleDeleteTag(tag)}
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
        {error ? (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={`${actionButtonClass} border-gray-200 bg-white text-gray-600 hover:bg-gray-50`}
            onClick={() => {
              setError(null);
              setMessage(null);
              onStatus?.({ message: null, error: null });
              onClose();
            }}
            disabled={saving}
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
