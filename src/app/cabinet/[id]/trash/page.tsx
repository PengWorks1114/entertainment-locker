"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { buttonClass } from "@/lib/ui";
import {
  DEFAULT_THUMB_TRANSFORM,
  isOptimizedImageUrl,
  normalizeThumbTransform,
} from "@/lib/image-utils";
import type { ThumbTransform } from "@/lib/types";

type CabinetTrashPageProps = {
  params: Promise<{ id: string }>;
};

type TrashListItem = {
  id: string;
  title: string;
  thumbUrl: string | null;
  thumbTransform: ThumbTransform;
  deletedAt: Timestamp | null;
};

type PendingAction = { id: string; type: "restore" | "delete" } | null;

type ProgressSnapshot = {
  id: string;
  data: Record<string, unknown>;
};

type TrashDocData = {
  uid?: string;
  cabinetId?: string;
  itemData?: Record<string, unknown>;
  progress?: unknown;
  deletedAt?: Timestamp;
};

function formatTimestamp(timestamp?: Timestamp | null): string {
  if (!timestamp) {
    return "";
  }
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseProgressSnapshots(value: unknown): ProgressSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const { id, data } = entry as {
        id?: unknown;
        data?: unknown;
      };
      if (typeof id !== "string" || !data || typeof data !== "object") {
        return null;
      }
      return { id, data: data as Record<string, unknown> };
    })
    .filter((entry): entry is ProgressSnapshot => Boolean(entry));
}

export default function CabinetTrashPage({ params }: CabinetTrashPageProps) {
  const { id: cabinetId } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cabinetName, setCabinetName] = useState("未命名櫃子");
  const [cabinetLoading, setCabinetLoading] = useState(true);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [canView, setCanView] = useState(false);
  const [cabinetLocked, setCabinetLocked] = useState(false);
  const [items, setItems] = useState<TrashListItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setCabinetLoading(false);
      setItemsLoading(false);
      setCabinetError("Firebase 尚未設定");
      setListError("Firebase 尚未設定");
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
      setCanView(false);
      setCabinetName("未命名櫃子");
      setCabinetError(null);
      setCabinetLoading(false);
      setCabinetLocked(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setCabinetError("Firebase 尚未設定");
      setCabinetLoading(false);
      setCanView(false);
      return;
    }
    setCabinetLoading(true);
    setCabinetError(null);
    setCabinetLocked(false);
    let active = true;
    getDoc(doc(db, "cabinet", cabinetId))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setCabinetError("找不到櫃子");
          setCanView(false);
          setCabinetLoading(false);
          setCabinetLocked(false);
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setCabinetError("您沒有存取此櫃子的權限");
          setCanView(false);
          setCabinetLoading(false);
          setCabinetLocked(false);
          return;
        }
        if (data?.isLocked) {
          setCabinetError("此櫃子已鎖定，無法瀏覽垃圾桶內容。請於編輯頁面解除鎖定後再試一次。");
          setCanView(false);
          setCabinetLoading(false);
          setCabinetLocked(true);
          return;
        }
        const name =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name.trim()
            : "未命名櫃子";
        setCabinetName(name);
        setCanView(true);
        setCabinetLoading(false);
        setCabinetLocked(false);
      })
      .catch((err) => {
        console.error("載入櫃子資訊時發生錯誤", err);
        if (!active) return;
        setCabinetError("載入櫃子資訊時發生錯誤");
        setCanView(false);
        setCabinetLoading(false);
        setCabinetLocked(false);
      });
    return () => {
      active = false;
    };
  }, [user, cabinetId]);

  useEffect(() => {
    if (!user || !canView) {
      setItems([]);
      setItemsLoading(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setListError("Firebase 尚未設定");
      setItems([]);
      setItemsLoading(false);
      return;
    }
    setItemsLoading(true);
    setListError(null);
    const trashQuery = query(
      collection(db, "cabinetTrash"),
      where("uid", "==", user.uid),
      where("cabinetId", "==", cabinetId)
    );
    const unsub = onSnapshot(
      trashQuery,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => {
          const raw = (docSnap.data() ?? {}) as TrashDocData;
          const itemData = raw.itemData ?? {};
          const title =
            typeof itemData?.titleZh === "string" && itemData.titleZh.trim()
              ? itemData.titleZh.trim()
              : "未命名物件";
          const thumbUrl =
            typeof itemData?.thumbUrl === "string" && itemData.thumbUrl.trim()
              ? itemData.thumbUrl.trim()
              : null;
          const thumbTransform =
            itemData && typeof itemData.thumbTransform === "object"
              ? normalizeThumbTransform(itemData.thumbTransform)
              : { ...DEFAULT_THUMB_TRANSFORM };
          const deletedAt =
            raw.deletedAt instanceof Timestamp ? raw.deletedAt : null;
          return {
            id: docSnap.id,
            title,
            thumbUrl,
            thumbTransform,
            deletedAt,
          } satisfies TrashListItem;
        });
        next.sort((a, b) => {
          const left = a.deletedAt ? a.deletedAt.toMillis() : 0;
          const right = b.deletedAt ? b.deletedAt.toMillis() : 0;
          return right - left;
        });
        setItems(next);
        setItemsLoading(false);
        setListError(null);
      },
      (error) => {
        console.error("載入垃圾桶資料時發生錯誤", error);
        setItems([]);
        setItemsLoading(false);
        setListError("載入垃圾桶資料時發生錯誤");
      }
    );
    return () => unsub();
  }, [user, canView, cabinetId]);

  const headerTitle = useMemo(
    () => `${cabinetName} 的垃圾桶`,
    [cabinetName]
  );

  async function handleRestore(itemId: string) {
    if (!user) {
      setActionError("請先登入");
      return;
    }
    if (!canView) {
      setActionError("您沒有還原此物件的權限");
      return;
    }
    if (pendingAction || clearing) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setActionError("Firebase 尚未設定");
      return;
    }
    setPendingAction({ id: itemId, type: "restore" });
    setActionError(null);
    setActionMessage(null);
    try {
      const trashRef = doc(db, "cabinetTrash", itemId);
      const snap = await getDoc(trashRef);
      if (!snap.exists()) {
        throw new Error("找不到垃圾桶資料");
      }
      const raw = snap.data() as TrashDocData;
      if (raw.uid !== user.uid || raw.cabinetId !== cabinetId) {
        throw new Error("您沒有還原此物件的權限");
      }
      const itemData = raw.itemData;
      if (!itemData || typeof itemData !== "object") {
        throw new Error("原始物件資料不完整，無法還原");
      }
      const itemPayload: Record<string, unknown> = {
        ...(itemData as Record<string, unknown>),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "item", itemId), itemPayload);
      const progressEntries = parseProgressSnapshots(raw.progress);
      if (progressEntries.length > 0) {
        await Promise.all(
          progressEntries.map((entry) =>
            setDoc(doc(db, "item", itemId, "progress", entry.id), entry.data)
          )
        );
      }
      await deleteDoc(trashRef);
      setActionMessage("已還原物件");
    } catch (err) {
      console.error("還原垃圾桶物件時發生錯誤", err);
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : "還原垃圾桶物件時發生錯誤"
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handlePermanentDelete(itemId: string) {
    if (!user) {
      setActionError("請先登入");
      return;
    }
    if (!canView) {
      setActionError("您沒有刪除此物件的權限");
      return;
    }
    if (!window.confirm("確認永久刪除此物件？操作無法復原。")) {
      return;
    }
    if (pendingAction || clearing) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setActionError("Firebase 尚未設定");
      return;
    }
    setPendingAction({ id: itemId, type: "delete" });
    setActionError(null);
    setActionMessage(null);
    try {
      const trashRef = doc(db, "cabinetTrash", itemId);
      const snap = await getDoc(trashRef);
      if (!snap.exists()) {
        throw new Error("找不到垃圾桶資料");
      }
      const raw = snap.data() as TrashDocData;
      if (raw.uid !== user.uid || raw.cabinetId !== cabinetId) {
        throw new Error("您沒有刪除此物件的權限");
      }
      await deleteDoc(trashRef);
      setActionMessage("已永久刪除物件");
    } catch (err) {
      console.error("永久刪除垃圾桶物件時發生錯誤", err);
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : "永久刪除垃圾桶物件時發生錯誤"
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handleClearTrash() {
    if (!user) {
      setActionError("請先登入");
      return;
    }
    if (!canView) {
      setActionError("您沒有清空垃圾桶的權限");
      return;
    }
    if (!window.confirm("確認清空垃圾桶？此操作無法復原。")) {
      return;
    }
    if (pendingAction || clearing) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setActionError("Firebase 尚未設定");
      return;
    }
    setClearing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const trashQuery = query(
        collection(db, "cabinetTrash"),
        where("uid", "==", user.uid),
        where("cabinetId", "==", cabinetId)
      );
      const snapshot = await getDocs(trashQuery);
      await Promise.all(snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref)));
      setActionMessage("垃圾桶已清空");
    } catch (err) {
      console.error("清空垃圾桶時發生錯誤", err);
      setActionError(
        err instanceof Error && err.message
          ? err.message
          : "清空垃圾桶時發生錯誤"
      );
    } finally {
      setClearing(false);
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
          <h1 className="text-2xl font-semibold text-gray-900">垃圾桶</h1>
          <p className="text-base text-gray-600">
            未登入。請先前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            後再查看垃圾桶內容。
          </p>
        </div>
      </main>
    );
  }

  if (cabinetLoading) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在載入櫃子資訊…
        </div>
      </main>
    );
  }

  if (cabinetError || !canView) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">垃圾桶</h1>
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {cabinetError ?? "您沒有存取此垃圾桶的權限"}
          </div>
          <div>
            {cabinetLocked ? (
              <Link
                href={`/cabinet/${encodeURIComponent(cabinetId)}/edit`}
                className={`${buttonClass({ variant: "secondary" })}`}
              >
                前往編輯櫃子
              </Link>
            ) : (
              <Link
                href={`/cabinet/${encodeURIComponent(cabinetId)}`}
                className={`${buttonClass({ variant: "secondary" })}`}
              >
                返回櫃子頁面
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="break-anywhere text-2xl font-semibold text-gray-900">
              {headerTitle}
            </h1>
            <p className="text-sm text-gray-600">
              被刪除的物件會暫時保留在此，可在這裡還原或永久刪除。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm sm:flex-row sm:flex-wrap sm:justify-end">
            <Link
              href={`/cabinet/${encodeURIComponent(cabinetId)}`}
              className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
            >
              返回櫃子
            </Link>
            <button
              type="button"
              onClick={handleClearTrash}
              disabled={clearing || pendingAction !== null}
              className={`${buttonClass({ variant: "danger" })} w-full sm:w-auto`}
            >
              {clearing ? "清空中…" : "清空垃圾桶"}
            </button>
          </div>
        </header>

        {actionMessage && (
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {actionMessage}
          </div>
        )}
        {actionError && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}
        {listError && (
          <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {listError}
          </div>
        )}

        <section className="rounded-2xl border bg-white/70 p-6 shadow-sm">
          {itemsLoading ? (
            <p className="text-sm text-gray-600">正在載入垃圾桶內容…</p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white/60 p-6 text-center text-sm text-gray-500">
              垃圾桶目前是空的。
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => {
                const transform = item.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
                const thumbStyle = {
                  transform: `translate(${transform.offsetX}%, ${transform.offsetY}%) scale(${transform.scale})`,
                  transformOrigin: "center",
                } as const;
                const restoring =
                  pendingAction?.id === item.id && pendingAction.type === "restore";
                const deleting =
                  pendingAction?.id === item.id && pendingAction.type === "delete";
                return (
                  <article
                    key={item.id}
                    className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white/90 p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="h-20 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-inner">
                        {item.thumbUrl ? (
                          isOptimizedImageUrl(item.thumbUrl) ? (
                            <Image
                              src={item.thumbUrl}
                              alt={`${item.title} 縮圖`}
                              fill
                              sizes="80px"
                              className="object-cover"
                              style={thumbStyle}
                              draggable={false}
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.thumbUrl}
                              alt={`${item.title} 縮圖`}
                              className="h-full w-full select-none object-cover"
                              style={thumbStyle}
                              loading="lazy"
                              draggable={false}
                            />
                          )
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-400">
                            無縮圖
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <h2 className="line-clamp-2 break-anywhere text-lg font-semibold text-gray-900">
                          {item.title}
                        </h2>
                        {item.deletedAt && (
                          <p className="text-xs text-gray-500">
                            移除於：{formatTimestamp(item.deletedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-none sm:items-center">
                      <button
                        type="button"
                        onClick={() => handleRestore(item.id)}
                        disabled={restoring || deleting || clearing}
                        className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
                      >
                        {restoring ? "還原中…" : "還原"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePermanentDelete(item.id)}
                        disabled={restoring || deleting || clearing}
                        className={`${buttonClass({ variant: "outlineDanger" })} w-full sm:w-auto`}
                      >
                        {deleting ? "刪除中…" : "刪除"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
