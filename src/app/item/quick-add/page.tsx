"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { fetchOpenGraphImage } from "@/lib/opengraph";
import { buttonClass } from "@/lib/ui";
import type { ProgressType } from "@/lib/types";

type CabinetOption = { id: string; name: string };

type FormState = {
  cabinetId: string;
  titleZh: string;
  sourceUrl: string;
  thumbUrl: string;
  progressValue: string;
};

const QUICK_ADD_PROGRESS_PLATFORM = "未設定";
const QUICK_ADD_PROGRESS_UNIT = "集數";
const QUICK_ADD_PROGRESS_TYPE: ProgressType = "story";

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function QuickAddItemPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cabinets, setCabinets] = useState<CabinetOption[]>([]);
  const [loadingCabinets, setLoadingCabinets] = useState(true);
  const [form, setForm] = useState<FormState>({
    cabinetId: "",
    titleZh: "",
    sourceUrl: "",
    thumbUrl: "",
    progressValue: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clipboardCheckedRef = useRef(false);
  const gestureRetryHandlerRef = useRef<(() => void) | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
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
      setCabinets([]);
      setLoadingCabinets(false);
      return;
    }
    let active = true;
    const db = getFirebaseDb();
    if (!db) {
      setError("Firebase 尚未設定");
      setLoadingCabinets(false);
      setCabinets([]);
      return;
    }
    setLoadingCabinets(true);
    const q = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    getDocs(q)
      .then((snap) => {
        if (!active) return;
        const rows: CabinetOption[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const createdAt = data?.createdAt;
            const createdMs =
              createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
            const orderValue =
              typeof data?.order === "number" ? data.order : createdMs;
            return {
              id: docSnap.id,
              name: (data?.name as string) ?? "",
              createdMs,
              order: orderValue,
            };
          })
          .sort((a, b) => {
            if (a.order === b.order) {
              return b.createdMs - a.createdMs;
            }
            return b.order - a.order;
          })
          .map((item) => ({ id: item.id, name: item.name }));
        setCabinets(rows);
        setLoadingCabinets(false);
      })
      .catch(() => {
        if (!active) return;
        setError("載入櫃子清單時發生錯誤");
        setCabinets([]);
        setLoadingCabinets(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!form.cabinetId && cabinets.length > 0) {
      setForm((prev) => ({ ...prev, cabinetId: cabinets[0].id }));
    }
  }, [cabinets, form.cabinetId]);

  useEffect(() => {
    clipboardCheckedRef.current = false;
  }, [pathname, user]);

  useEffect(() => {
    if (!user) {
      clipboardCheckedRef.current = false;
      return;
    }

    if (clipboardCheckedRef.current) {
      return;
    }

    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.readText !== "function") {
      return;
    }

    let canceled = false;
    const gestureEvents: Array<keyof DocumentEventMap> = ["pointerup", "touchend"];

    function clearGestureRetry() {
      if (!gestureRetryHandlerRef.current) {
        return;
      }
      const handler = gestureRetryHandlerRef.current;
      gestureEvents.forEach((eventName) => {
        document.removeEventListener(eventName, handler as EventListener);
      });
      gestureRetryHandlerRef.current = null;
    }

    async function detectClipboard() {
      try {
        const text = await clipboard.readText();
        if (canceled) {
          return;
        }
        const trimmed = text.trim();
        if (!trimmed) {
          return;
        }
        if (isValidHttpUrl(trimmed)) {
          const confirmed = window.confirm("是否將剪貼簿網址填入來源連結 ?");
          if (!confirmed) {
            return;
          }
          setForm((prev) => {
            if (prev.sourceUrl.trim().length > 0) {
              return prev;
            }
            return { ...prev, sourceUrl: trimmed };
          });
        } else {
          const confirmed = window.confirm("是否將剪貼簿文字填入主要標題 ?");
          if (!confirmed) {
            return;
          }
          setForm((prev) => {
            if (prev.titleZh.trim().length > 0) {
              return prev;
            }
            return { ...prev, titleZh: trimmed };
          });
        }
      } catch (err) {
        if (!canceled) {
          const needsGesture =
            err instanceof DOMException
              ? err.name === "NotAllowedError" || err.name === "SecurityError"
              : typeof err === "object" && err !== null && "message" in err
                ? String((err as { message?: unknown }).message).toLowerCase().includes("gesture")
                : false;
          if (needsGesture) {
            clipboardCheckedRef.current = false;
            if (!gestureRetryHandlerRef.current) {
              const handler = () => {
                if (canceled) {
                  return;
                }
                clearGestureRetry();
                triggerDetection();
              };
              gestureRetryHandlerRef.current = handler;
              gestureEvents.forEach((eventName) => {
                document.addEventListener(eventName, handler as EventListener, {
                  once: true,
                });
              });
            }
            return;
          }
        }
        console.debug("讀取剪貼簿失敗", err);
      }
    }

    function triggerDetection() {
      if (clipboardCheckedRef.current || canceled) {
        return;
      }
      clipboardCheckedRef.current = true;
      void detectClipboard();
    }

    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      const handleVisibility = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", handleVisibility);
          triggerDetection();
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);
      return () => {
        canceled = true;
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    }

    triggerDetection();

    return () => {
      canceled = true;
      clearGestureRetry();
    };
  }, [pathname, user]);

  const hasCabinet = cabinets.length > 0;

  const submitDisabled = useMemo(() => {
    if (!hasCabinet) return true;
    if (saving) return true;
    return !form.titleZh.trim();
  }, [form.titleZh, hasCabinet, saving]);

  function handleInputChange<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || submitDisabled) {
      return;
    }

    const cabinetId = form.cabinetId.trim();
    if (!cabinetId) {
      setError("請選擇櫃子");
      return;
    }

    const titleZh = form.titleZh.trim();
    if (!titleZh) {
      setError("主要標題必填");
      return;
    }

    const sourceUrl = form.sourceUrl.trim();
    if (sourceUrl && !isValidHttpUrl(sourceUrl)) {
      setError("請輸入有效的來源連結");
      return;
    }

    const thumbUrlInput = form.thumbUrl.trim();
    if (thumbUrlInput && !isValidHttpUrl(thumbUrlInput)) {
      setError("請輸入有效的縮圖連結");
      return;
    }

    const progressValueInput = form.progressValue.trim();
    let parsedProgressValue: number | null = null;
    if (progressValueInput) {
      const parsedValue = Number(progressValueInput);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        setError("請輸入有效的進度數值");
        return;
      }
      parsedProgressValue = parsedValue;
    }

    setSaving(true);
    setError(null);
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }

      const links = sourceUrl
        ? [
            {
              label: "來源",
              url: sourceUrl,
              isPrimary: true,
            },
          ]
        : [];

      let resolvedThumbUrl = thumbUrlInput;
      if (!resolvedThumbUrl && sourceUrl) {
        const autoThumb = await fetchOpenGraphImage(sourceUrl);
        if (autoThumb) {
          resolvedThumbUrl = autoThumb;
        }
      }

      const docRef = await addDoc(collection(db, "item"), {
        uid: user.uid,
        cabinetId,
        titleZh,
        titleAlt: null,
        author: null,
        tags: [],
        links,
        thumbUrl: resolvedThumbUrl || null,
        thumbTransform: null,
        progressNote: null,
        insightNotes: [],
        insightNote: null,
        note: null,
        appearances: [],
        rating: null,
        status: "in-progress",
        updateFrequency: null,
        nextUpdateAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (parsedProgressValue !== null) {
        await addDoc(collection(db, "item", docRef.id, "progress"), {
          platform: QUICK_ADD_PROGRESS_PLATFORM,
          type: QUICK_ADD_PROGRESS_TYPE,
          value: parsedProgressValue,
          unit: QUICK_ADD_PROGRESS_UNIT,
          note: null,
          link: null,
          isPrimary: true,
          updatedAt: serverTimestamp(),
        });
      }

      router.replace(`/item/${docRef.id}`);
    } catch (err) {
      console.error("快速新增物件失敗", err);
      if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError("建立物件時發生錯誤");
      }
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-base shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

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
          <h1 className="text-2xl font-semibold text-gray-900">快速新增物件</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理物件，或回到
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
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">快速新增物件</h1>
          <p className="text-sm text-gray-500">
            輸入必要資訊即可建立物件。稍後仍可於完整編輯頁面補充詳細資料。
          </p>
        </header>

        <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
          {error && (
            <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {loadingCabinets ? (
            <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-600">
              正在載入櫃子清單…
            </div>
          ) : null}

          {!loadingCabinets && !hasCabinet ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              尚未建立任何櫃子，無法新增物件。請先前往
              <Link href="/cabinets" className="ml-1 underline">
                我的櫃子
              </Link>
              建立櫃子。
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="cabinet" className="text-sm font-medium text-gray-700">
                所屬櫃子
              </label>
              <select
                id="cabinet"
                className={inputClass}
                value={form.cabinetId}
                onChange={(event) => handleInputChange("cabinetId", event.target.value)}
                disabled={!hasCabinet || saving}
                required
              >
                {hasCabinet ? (
                  cabinets.map((cabinet) => (
                    <option key={cabinet.id} value={cabinet.id}>
                      {cabinet.name || "未命名櫃子"}
                    </option>
                  ))
                ) : (
                  <option value="">請先建立櫃子</option>
                )}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="titleZh" className="text-sm font-medium text-gray-700">
                主要標題
              </label>
              <input
                id="titleZh"
                type="text"
                className={inputClass}
                value={form.titleZh}
                onChange={(event) => handleInputChange("titleZh", event.target.value)}
                placeholder="請輸入主要標題"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="sourceUrl" className="text-sm font-medium text-gray-700">
                來源連結
              </label>
              <input
                id="sourceUrl"
                type="url"
                className={inputClass}
                value={form.sourceUrl}
                onChange={(event) => handleInputChange("sourceUrl", event.target.value)}
                placeholder="https://example.com"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="thumbUrl" className="text-sm font-medium text-gray-700">
                縮圖連結（可不填）
              </label>
              <input
                id="thumbUrl"
                type="url"
                className={inputClass}
                value={form.thumbUrl}
                onChange={(event) => handleInputChange("thumbUrl", event.target.value)}
                placeholder="https://i.imgur.com/..."
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="progressValue" className="text-sm font-medium text-gray-700">
                新增進度（可不填）
              </label>
              <input
                id="progressValue"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className={inputClass}
                value={form.progressValue}
                onChange={(event) => handleInputChange("progressValue", event.target.value)}
                placeholder="例如：12"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className={buttonClass({ variant: "primary", size: "lg" })}
                disabled={submitDisabled}
              >
                {saving ? "建立中…" : "建立物件"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

