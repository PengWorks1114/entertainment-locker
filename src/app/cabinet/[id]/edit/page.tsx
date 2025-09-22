"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { deleteCabinetWithItems } from "@/lib/firestore-utils";
import ThumbLinkField from "@/components/ThumbLinkField";
import ThumbEditorDialog from "@/components/ThumbEditorDialog";
import {
  clampThumbTransform,
  DEFAULT_THUMB_TRANSFORM,
  normalizeThumbTransform,
  prepareThumbTransform,
} from "@/lib/image-utils";
import type { ThumbTransform } from "@/lib/types";
import { invalidateCabinetOptions } from "@/lib/cabinet-options";

type CabinetEditPageProps = {
  params: Promise<{ id: string }>;
};

export default function CabinetEditPage({ params }: CabinetEditPageProps) {
  const { id: cabinetId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [thumbUrl, setThumbUrl] = useState("");
  const [thumbTransform, setThumbTransform] = useState<ThumbTransform>(
    () => ({ ...DEFAULT_THUMB_TRANSFORM })
  );
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [thumbEditorOpen, setThumbEditorOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [initialLocked, setInitialLocked] = useState(false);
  const [storedLockCode, setStoredLockCode] = useState<string | null>(null);
  const [lockCode, setLockCode] = useState("");
  const [lockCodeConfirm, setLockCodeConfirm] = useState("");
  const [unlockCode, setUnlockCode] = useState("");

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
      setName("");
      setNote("");
      setThumbUrl("");
      setThumbTransform({ ...DEFAULT_THUMB_TRANSFORM });
      setThumbEditorOpen(false);
      setMessage(null);
      setDeleteError(null);
      setLocked(false);
      setInitialLocked(false);
      setStoredLockCode(null);
      setLockCode("");
      setLockCodeConfirm("");
      setUnlockCode("");
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setDeleteError(null);
    setMessage(null);
    const db = getFirebaseDb();
    if (!db) {
      setError("Firebase 尚未設定");
      setCanEdit(false);
      setLoading(false);
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
          setNote("");
          setThumbUrl("");
          setThumbTransform({ ...DEFAULT_THUMB_TRANSFORM });
          setThumbEditorOpen(false);
          setLocked(false);
          setInitialLocked(false);
          setStoredLockCode(null);
          setLockCode("");
          setLockCodeConfirm("");
          setUnlockCode("");
          return;
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          setError("您沒有存取此櫃子的權限");
          setCanEdit(false);
          setLoading(false);
          setNote("");
          setThumbUrl("");
          setThumbTransform({ ...DEFAULT_THUMB_TRANSFORM });
          setThumbEditorOpen(false);
          setLocked(false);
          setInitialLocked(false);
          setStoredLockCode(null);
          setLockCode("");
          setLockCodeConfirm("");
          setUnlockCode("");
          return;
        }
        const nameValue =
          typeof data?.name === "string" && data.name.trim().length > 0
            ? data.name
            : "";
        setName(nameValue);
        const noteValue =
          typeof data?.note === "string" && data.note.trim().length > 0
            ? data.note.trim()
            : "";
        setNote(noteValue);
        const thumbUrlValue =
          typeof data?.thumbUrl === "string" && data.thumbUrl.trim().length > 0
            ? data.thumbUrl.trim()
            : "";
        setThumbUrl(thumbUrlValue);
        setThumbTransform(
          thumbUrlValue && data?.thumbTransform
            ? normalizeThumbTransform(data.thumbTransform)
            : { ...DEFAULT_THUMB_TRANSFORM }
        );
        setThumbEditorOpen(false);
        const isCabinetLocked = Boolean(data?.isLocked);
        setLocked(isCabinetLocked);
        setInitialLocked(isCabinetLocked);
        setStoredLockCode(() => {
          const rawCode = data?.lockCode;
          if (typeof rawCode === "number" && Number.isSafeInteger(rawCode)) {
            return String(rawCode);
          }
          if (typeof rawCode === "string") {
            const trimmed = rawCode.trim();
            if (/^[0-9]+$/.test(trimmed)) {
              const parsed = Number(trimmed);
              if (Number.isSafeInteger(parsed)) {
                return String(parsed);
              }
            }
          }
          return null;
        });
        setLockCode("");
        setLockCodeConfirm("");
        setUnlockCode("");
        setCanEdit(true);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError("載入櫃子資料時發生錯誤");
        setCanEdit(false);
        setLoading(false);
        setNote("");
        setThumbUrl("");
        setThumbTransform({ ...DEFAULT_THUMB_TRANSFORM });
        setThumbEditorOpen(false);
        setLocked(false);
        setInitialLocked(false);
        setStoredLockCode(null);
        setLockCode("");
        setLockCodeConfirm("");
        setUnlockCode("");
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
    const trimmedNote = note.trim();
    const trimmedThumbUrl = thumbUrl.trim();
    if (trimmedThumbUrl) {
      try {
        const parsed = new URL(trimmedThumbUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("invalid");
        }
      } catch {
        setMessage("請輸入有效的縮圖連結");
        return;
      }
    }
    setSaving(true);
    setError(null);
    let lockCodeToPersist: number | null = null;

    if (locked) {
      const nextLockCodeRaw = lockCode.trim();
      const nextLockCodeConfirmRaw = lockCodeConfirm.trim();
      const needsNewCode = !initialLocked || storedLockCode === null;

      if (needsNewCode || nextLockCodeRaw || nextLockCodeConfirmRaw) {
        if (!nextLockCodeRaw || !nextLockCodeConfirmRaw) {
          setMessage("請輸入並確認鎖定密碼");
          setSaving(false);
          return;
        }
        if (nextLockCodeRaw !== nextLockCodeConfirmRaw) {
          setMessage("鎖定密碼與確認密碼不一致");
          setSaving(false);
          return;
        }
        if (!/^[0-9]+$/.test(nextLockCodeRaw)) {
          setMessage("鎖定密碼僅能輸入數字");
          setSaving(false);
          return;
        }
        const parsedLockCode = Number(nextLockCodeRaw);
        if (!Number.isSafeInteger(parsedLockCode)) {
          setMessage("鎖定密碼過長，請輸入較短的數字");
          setSaving(false);
          return;
        }
        lockCodeToPersist = parsedLockCode;
      } else if (storedLockCode !== null) {
        const storedNumber = Number(storedLockCode);
        if (!Number.isSafeInteger(storedNumber)) {
          setMessage("鎖定密碼已損毀，請輸入新的鎖定密碼");
          setSaving(false);
          return;
        }
        lockCodeToPersist = storedNumber;
      } else {
        setMessage("請輸入鎖定密碼");
        setSaving(false);
        return;
      }
    } else {
      if (initialLocked && storedLockCode !== null) {
        const unlockCodeRaw = unlockCode.trim();
        if (!unlockCodeRaw) {
          setMessage("請輸入鎖定密碼以解除鎖定");
          setSaving(false);
          return;
        }
        if (unlockCodeRaw !== storedLockCode) {
          setMessage("鎖定密碼不正確，無法解除鎖定");
          setSaving(false);
          return;
        }
      }
      lockCodeToPersist = null;
    }

    try {
      const db = getFirebaseDb();
      if (!db) {
        setError("Firebase 尚未設定");
        setSaving(false);
        return;
      }
      const cabinetRef = doc(db, "cabinet", cabinetId);
      const preparedThumbTransform = trimmedThumbUrl
        ? prepareThumbTransform(thumbTransform)
        : null;
      await updateDoc(cabinetRef, {
        name: trimmed,
        note: trimmedNote ? trimmedNote : null,
        thumbUrl: trimmedThumbUrl || null,
        thumbTransform: trimmedThumbUrl ? preparedThumbTransform : null,
        isLocked: locked,
        lockCode: lockCodeToPersist,
        updatedAt: serverTimestamp(),
      });
      invalidateCabinetOptions(user.uid);
      setName(trimmed);
      setNote(trimmedNote);
      setThumbUrl(trimmedThumbUrl);
      setThumbTransform(
        trimmedThumbUrl
          ? clampThumbTransform(
              preparedThumbTransform ?? { ...DEFAULT_THUMB_TRANSFORM }
            )
          : { ...DEFAULT_THUMB_TRANSFORM }
      );
      setThumbEditorOpen(false);
      setLocked(locked);
      setInitialLocked(locked);
      setStoredLockCode(
        lockCodeToPersist !== null ? String(lockCodeToPersist) : null
      );
      setLockCode("");
      setLockCodeConfirm("");
      setUnlockCode("");
      setMessage("已更新櫃子資料");
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

  const inputClass =
    "h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-base text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";
  const smallInputClass =
    "h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none";
  const primaryButtonClass =
    "h-12 w-full rounded-xl bg-black px-6 text-base text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300";
  const secondaryButtonClass =
    "inline-flex w-full items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 sm:w-auto";
  const dangerButtonClass =
    "inline-flex w-full items-center justify-center rounded-full border border-red-200 bg-white px-4 py-2 text-sm text-red-600 shadow-sm transition hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-70";
  const lockButtonClass =
    "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black/30";
  const lockButtonPrimaryClass =
    "bg-black text-white shadow-sm hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300";
  const lockButtonSecondaryClass =
    "border border-gray-200 bg-white text-gray-700 shadow-sm hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-70";

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
      invalidateCabinetOptions(user.uid);
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
            <ThumbLinkField
              value={thumbUrl}
              onChange={(value) => {
                setThumbUrl(value);
                if (!value.trim()) {
                  setThumbTransform({ ...DEFAULT_THUMB_TRANSFORM });
                }
              }}
              disabled={saving}
              onEdit={() => setThumbEditorOpen(true)}
            />
            <ThumbEditorDialog
              open={thumbEditorOpen}
              imageUrl={thumbUrl.trim()}
              value={thumbTransform}
              onClose={() => setThumbEditorOpen(false)}
              shape="portrait"
              onApply={(next) => {
                setThumbTransform(clampThumbTransform(next));
                setThumbEditorOpen(false);
              }}
            />
            <section className="space-y-3 rounded-2xl border border-gray-200 bg-white/80 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">鎖定此櫃子</p>
                  <p className="text-xs text-gray-500">
                    {locked
                      ? "目前為鎖定狀態，訪客將無法瀏覽櫃子內容。"
                      : "尚未鎖定，可以瀏覽櫃子內容。"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {locked ? (
                    <button
                      type="button"
                      className={`${lockButtonClass} ${lockButtonSecondaryClass}`}
                      onClick={() => {
                        setLocked(false);
                        setLockCode("");
                        setLockCodeConfirm("");
                        setUnlockCode("");
                      }}
                      disabled={saving}
                    >
                      解除鎖定
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${lockButtonClass} ${lockButtonPrimaryClass}`}
                      onClick={() => {
                        setLocked(true);
                        setLockCode("");
                        setLockCodeConfirm("");
                        setUnlockCode("");
                      }}
                      disabled={saving}
                    >
                      設定鎖定
                    </button>
                  )}
                  {initialLocked && storedLockCode !== null && !locked && (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                      需要輸入密碼後儲存才會解除
                    </span>
                  )}
                </div>
              </div>
              {locked ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-gray-50/80 px-4 py-3 text-xs text-gray-500">
                    {initialLocked && storedLockCode !== null
                      ? "如需更換鎖定密碼，請輸入新的數字密碼並再次確認；若留空則沿用原密碼。"
                      : "請設定僅包含數字的鎖定密碼，並再次輸入以確認。"}
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs text-gray-600">鎖定密碼</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={lockCode}
                      onChange={(event) => setLockCode(event.target.value)}
                      className={smallInputClass}
                      disabled={saving}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-gray-600">確認鎖定密碼</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={lockCodeConfirm}
                      onChange={(event) => setLockCodeConfirm(event.target.value)}
                      className={smallInputClass}
                      disabled={saving}
                    />
                  </label>
                </div>
              ) : initialLocked ? (
                <div className="space-y-3">
                  <div className="rounded-xl bg-gray-50/80 px-4 py-3 text-xs text-gray-500">
                    為了保護資料安全，解除鎖定前請輸入目前的鎖定密碼並儲存變更。
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs text-gray-600">解除鎖定密碼</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={unlockCode}
                      onChange={(event) => setUnlockCode(event.target.value)}
                      className={smallInputClass}
                      disabled={saving}
                    />
                  </label>
                </div>
              ) : null}
            </section>
            <label className="space-y-2">
              <span className="text-sm text-gray-600">櫃子備註</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="補充說明、整理方式或其他提醒"
                className="min-h-[100px] w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none"
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
