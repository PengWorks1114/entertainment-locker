"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  clearIndexedDbPersistence,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  terminate,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";

type Cabinet = {
  id: string;
  name: string;
  order: number;
  createdMs: number;
  note: string | null;
};

type Feedback = {
  type: "error" | "success";
  message: string;
};

export default function CabinetsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [name, setName] = useState("");
  const [list, setList] = useState<Cabinet[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showReorder, setShowReorder] = useState(false);
  const [reorderList, setReorderList] = useState<Cabinet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user) {
      setList([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const q = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    const unSub = onSnapshot(
      q,
      (snap) => {
        const rows: Cabinet[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const createdAt = data?.createdAt;
            const createdMs =
              createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
            const orderValue =
              typeof data?.order === "number" ? data.order : createdMs;
            const noteValue =
              typeof data?.note === "string" && data.note.trim().length > 0
                ? data.note.trim()
                : null;
            return {
              id: docSnap.id,
              name: (data?.name as string) || "",
              createdMs,
              order: orderValue,
              note: noteValue,
            } satisfies Cabinet;
          })
          .sort((a, b) => {
            if (a.order === b.order) {
              return b.createdMs - a.createdMs;
            }
            return b.order - a.order;
          });
        setList(rows);
        setFeedback((prev) => (prev?.type === "error" ? null : prev));
      },
      () => {
        setFeedback({ type: "error", message: "載入櫃子清單時發生錯誤" });
      }
    );
    return () => unSub();
  }, [user]);

  async function addCabinet() {
    if (!user) {
      setFeedback({ type: "error", message: "請先登入" });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setFeedback({ type: "error", message: "名稱不可為空" });
      return;
    }
    setFeedback(null);
    try {
      const db = getFirebaseDb();
      if (!db) {
        setFeedback({ type: "error", message: "Firebase 尚未設定" });
        return;
      }
      const highestOrder = list.reduce(
        (max, item) => (item.order > max ? item.order : max),
        0
      );
      await addDoc(collection(db, "cabinet"), {
        uid: user.uid,
        name: trimmed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        tags: [],
        order: highestOrder + 1,
        note: null,
      });
      setName("");
      setFeedback({ type: "success", message: "已新增櫃子" });
    } catch (err) {
      console.error("新增櫃子時發生錯誤", err);
      setFeedback({ type: "error", message: "新增櫃子時發生錯誤" });
    }
  }

  async function clearCache() {
    try {
      const db = getFirebaseDb();
      if (db) {
        await terminate(db);
      }
    } catch {}
    try {
      const db = getFirebaseDb();
      if (db) {
        await clearIndexedDbPersistence(db);
      }
    } catch {}
    location.reload();
  }

  const inputClass = "h-12 w-full rounded-xl border px-4 text-base";

  const hasCabinet = list.length > 0;
  const feedbackNode = useMemo(() => {
    if (!feedback) return null;
    const baseClass =
      feedback.type === "error"
        ? "break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        : "break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700";
    return <div className={baseClass}>{feedback.message}</div>;
  }, [feedback]);

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1;
    return reorderList.findIndex((item) => item.id === selectedId);
  }, [reorderList, selectedId]);

  function openReorderDialog() {
    setReorderList(list.map((item) => ({ ...item })));
    setSelectedId(list[0]?.id ?? null);
    setReorderError(null);
    setShowReorder(true);
  }

  function closeReorderDialog() {
    if (reorderSaving) return;
    setShowReorder(false);
    setReorderList([]);
    setSelectedId(null);
    setReorderError(null);
  }

  function moveSelected(offset: -1 | 1) {
    if (selectedIndex < 0) {
      return;
    }
    const targetIndex = selectedIndex + offset;
    if (targetIndex < 0 || targetIndex >= reorderList.length) {
      return;
    }
    setReorderList((prev) => {
      const next = [...prev];
      const [item] = next.splice(selectedIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  async function saveReorder() {
    if (!user) {
      setReorderError("請先登入");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setReorderError("Firebase 尚未設定");
      return;
    }
    if (reorderList.length === 0) {
      setShowReorder(false);
      return;
    }
    setReorderSaving(true);
    setReorderError(null);
    try {
      const batch = writeBatch(db);
      const total = reorderList.length;
      reorderList.forEach((item, index) => {
        const cabinetRef = doc(db, "cabinet", item.id);
        const orderValue = total - index;
        batch.update(cabinetRef, {
          order: orderValue,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setFeedback({ type: "success", message: "已更新櫃子順序" });
      setShowReorder(false);
      setReorderList([]);
      setSelectedId(null);
    } catch (err) {
      console.error("更新櫃子順序失敗", err);
      setReorderError("更新櫃子順序時發生錯誤");
    } finally {
      setReorderSaving(false);
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
          <h1 className="text-2xl font-semibold text-gray-900">櫃子</h1>
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
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">櫃子</h1>
            <p className="text-sm text-gray-500">
              建立不同作品分類，方便在物件列表間切換與整理。
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
            <button
              onClick={clearCache}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              title="清除本機 Firestore 快取並重新載入"
            >
              清除快取
            </button>
            <button
              onClick={openReorderDialog}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              disabled={!hasCabinet}
            >
              編輯順序
            </button>
          </div>
        </header>

        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 space-y-1">
              <span className="text-sm text-gray-600">櫃子名稱</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：漫畫、小說、遊戲"
                className={inputClass}
              />
            </label>
            <button
              onClick={addCabinet}
              className={buttonClass({ variant: "primary", size: "lg" })}
            >
              新增櫃子
            </button>
          </div>
          {feedbackNode}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">我的櫃子</h2>
          {hasCabinet ? (
            <ul className="space-y-4">
              {list.map((row) => {
                const displayName = row.name || "未命名櫃子";
                const encodedId = encodeURIComponent(row.id);
                return (
                  <li
                    key={row.id}
                    className="space-y-3 rounded-2xl border bg-white/70 p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <Link
                          href={`/cabinet/${encodedId}`}
                          className="break-anywhere text-lg font-semibold text-gray-900 underline-offset-4 hover:underline"
                        >
                          {displayName}
                        </Link>
                        {row.note && (
                          <p className="break-anywhere text-sm text-gray-600">{row.note}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap">
                        <Link
                          href={`/cabinet/${encodedId}`}
                          className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
                        >
                          查看物件
                        </Link>
                        <Link
                          href={`/cabinet/${encodedId}/edit`}
                          className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
                        >
                          編輯櫃子
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed bg-white/60 p-6 text-center text-sm text-gray-500">
              尚未建立櫃子，先新增一個分類吧！
            </div>
          )}
        </section>
      </div>

      {showReorder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
          <div className="w-full max-w-xl space-y-6 rounded-2xl bg-white p-6 shadow-xl">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-gray-900">調整櫃子順序</h2>
              <p className="text-sm text-gray-500">
                點選要調整的櫃子，再使用下方的上下按鈕調整顯示順序。
              </p>
            </div>
            {reorderError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {reorderError}
              </div>
            )}
            <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-2xl border bg-gray-50 p-3">
              {reorderList.length === 0 ? (
                <p className="text-sm text-gray-500">目前沒有櫃子可調整。</p>
              ) : (
                <ul className="space-y-2">
                  {reorderList.map((cabinet) => {
                    const isSelected = cabinet.id === selectedId;
                    return (
                      <li key={cabinet.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(cabinet.id)}
                          className={`w-full overflow-hidden rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition ${
                            isSelected
                              ? "border-blue-400 bg-white"
                              : "border-gray-200 bg-white/80 hover:border-blue-200"
                          }`}
                        >
                          <span className="break-anywhere font-medium text-gray-900">
                            {cabinet.name || "未命名櫃子"}
                          </span>
                          {cabinet.note && (
                            <span className="break-anywhere mt-1 block text-xs text-gray-500">
                              {cabinet.note}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moveSelected(-1)}
                  disabled={selectedIndex <= 0}
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  上移
                </button>
                <button
                  type="button"
                  onClick={() => moveSelected(1)}
                  disabled={
                    selectedIndex === -1 || selectedIndex === reorderList.length - 1
                  }
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  下移
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={closeReorderDialog}
                  disabled={reorderSaving}
                  className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveReorder}
                  disabled={reorderSaving || reorderList.length === 0}
                  className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                >
                  {reorderSaving ? "儲存中…" : "儲存順序"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
