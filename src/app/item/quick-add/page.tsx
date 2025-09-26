"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { fetchOpenGraphMetadata } from "@/lib/opengraph";
import { buttonClass } from "@/lib/ui";
import type { ProgressType, ItemLanguage } from "@/lib/types";
import { ITEM_LANGUAGE_OPTIONS, ITEM_LANGUAGE_VALUES } from "@/lib/types";
import {
  fetchCabinetOptions,
  type CabinetOption,
} from "@/lib/cabinet-options";
import CabinetTagQuickEditor from "@/components/CabinetTagQuickEditor";
import { hasCabinetItemWithSourceUrl } from "@/lib/firestore-utils";

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

const CJK_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;

type ResolvedLinkMetadata = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
};

function containsCjk(text: string): boolean {
  return CJK_REGEX.test(text);
}

function extractAutoTagsFromTitles(
  titles: string[],
  availableTags: string[],
  shouldSkip: boolean
): string[] {
  if (shouldSkip) {
    return [];
  }
  const normalizedTitles = titles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => title.toLowerCase());
  if (normalizedTitles.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  for (const tag of availableTags) {
    const normalizedTag = tag.trim();
    if (!normalizedTag) {
      continue;
    }
    const lowerTag = normalizedTag.toLowerCase();
    if (normalizedTitles.some((title) => title.includes(lowerTag))) {
      seen.add(normalizedTag);
    }
  }
  return Array.from(seen);
}

type FormState = {
  cabinetId: string;
  titleZh: string;
  titleAlt: string;
  author: string;
  language: ItemLanguage | "";
  selectedTags: string[];
  sourceUrl: string;
  thumbUrl: string;
  progressValue: string;
};

const QUICK_ADD_PROGRESS_PLATFORM = "未設定";
const QUICK_ADD_PROGRESS_UNIT: string | null = null;
const QUICK_ADD_PROGRESS_TYPE: ProgressType = "chapter";
const QUICK_ADD_DEFAULT_TITLE = "未命名";
const QUICK_ADD_LAST_CABINET_STORAGE_KEY = "quick-add:last-cabinet-id";

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
    titleAlt: "",
    author: "",
    language: "zh",
    selectedTags: [],
    sourceUrl: "",
    thumbUrl: "",
    progressValue: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clipboardCheckedRef = useRef(false);
  const gestureRetryHandlerRef = useRef<(() => void) | null>(null);
  const pathname = usePathname();
  const [cabinetTags, setCabinetTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [tagStatus, setTagStatus] = useState<{
    message: string | null;
    error: string | null;
    saving: boolean;
  }>({
    message: null,
    error: null,
    saving: false,
  });
  const [isFetchingTags, setIsFetchingTags] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const tagsCacheRef = useRef<Record<string, string[]>>({});
  const previousCabinetIdRef = useRef<string | null>(null);

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
    setLoadingCabinets(true);
    fetchCabinetOptions(user.uid)
      .then((rows) => {
        if (!active) return;
        setCabinets(rows);
        setLoadingCabinets(false);
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入櫃子清單時發生錯誤", err);
        const message =
          err instanceof Error && err.message
            ? err.message
            : "載入櫃子清單時發生錯誤";
        setError(message);
        setCabinets([]);
        setLoadingCabinets(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (form.cabinetId || cabinets.length === 0) {
      return;
    }
    let storedId: string | null = null;
    if (typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(
          QUICK_ADD_LAST_CABINET_STORAGE_KEY
        );
        if (saved) {
          const exists = cabinets.some((cabinet) => cabinet.id === saved);
          if (exists) {
            storedId = saved;
          }
        }
      } catch (err) {
        console.debug("讀取先前選擇的櫃子失敗", err);
      }
    }
    const fallback = cabinets.find((item) => !item.isLocked) ?? cabinets[0];
    const nextId = storedId ?? fallback.id;
    setForm((prev) => ({ ...prev, cabinetId: nextId }));
  }, [cabinets, form.cabinetId]);

  useEffect(() => {
    if (!form.cabinetId) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const exists = cabinets.some((cabinet) => cabinet.id === form.cabinetId);
    if (!exists) {
      return;
    }
    try {
      window.localStorage.setItem(
        QUICK_ADD_LAST_CABINET_STORAGE_KEY,
        form.cabinetId
      );
    } catch (err) {
      console.debug("儲存先前選擇的櫃子失敗", err);
    }
  }, [cabinets, form.cabinetId]);

  const selectedCabinet = useMemo(
    () => cabinets.find((entry) => entry.id === form.cabinetId) ?? null,
    [cabinets, form.cabinetId]
  );

  const fetchCabinetTags = useCallback(
    async (cabinetId: string, force = false): Promise<string[]> => {
      if (!cabinetId || !user) {
        return [];
      }
      if (!force) {
        const cached = tagsCacheRef.current[cabinetId];
        if (cached) {
          return cached;
        }
      }
      try {
        const db = getFirebaseDb();
        if (!db) {
          return [];
        }
        const snap = await getDoc(doc(db, "cabinet", cabinetId));
        if (!snap.exists()) {
          return [];
        }
        const data = snap.data();
        if (data?.uid !== user.uid) {
          return [];
        }
        return normalizeCabinetTags(data?.tags);
      } catch (err) {
        console.error("載入櫃子標籤失敗", err);
        return [];
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) {
      setCabinetTags([]);
      tagsCacheRef.current = {};
      return;
    }
    if (!form.cabinetId) {
      setCabinetTags([]);
      return;
    }
    let active = true;
    setIsFetchingTags(true);
    fetchCabinetTags(form.cabinetId)
      .then((tags) => {
        if (!active) return;
        tagsCacheRef.current[form.cabinetId] = tags;
        setCabinetTags(tags);
      })
      .catch(() => {
        if (!active) return;
        setCabinetTags([]);
      })
      .finally(() => {
        if (!active) return;
        setIsFetchingTags(false);
      });
    return () => {
      active = false;
    };
  }, [form.cabinetId, user, fetchCabinetTags]);

  useEffect(() => {
    const previousCabinetId = previousCabinetIdRef.current;
    if (previousCabinetId && previousCabinetId !== form.cabinetId) {
      setForm((prev) => ({ ...prev, selectedTags: [] }));
      setTagQuery("");
      setTagStatus({ message: null, error: null, saving: false });
    }
    previousCabinetIdRef.current = form.cabinetId;
  }, [form.cabinetId]);

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
    const hasTitle = form.titleZh.trim().length > 0;
    const hasSourceUrl = form.sourceUrl.trim().length > 0;
    return !hasTitle && !hasSourceUrl;
  }, [form.sourceUrl, form.titleZh, hasCabinet, saving]);

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
    let parsedProgressValue = 1;
    if (progressValueInput) {
      const parsedValue = Number(progressValueInput);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        setError("請輸入有效的進度數值");
        return;
      }
      parsedProgressValue = parsedValue;
    }

    let titleZh = form.titleZh.trim();
    let titleAlt = form.titleAlt.trim();
    const author = form.author.trim();
    const languageValue = form.language;
    if (languageValue && !ITEM_LANGUAGE_VALUES.includes(languageValue)) {
      setError("請選擇有效的語言");
      return;
    }

    const allowedTags = new Set(cabinetTags);
    const uniqueTags = Array.from(
      new Set(
        form.selectedTags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .filter((tag) => allowedTags.size === 0 || allowedTags.has(tag))
      )
    );

    setSaving(true);
    setError(null);
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }

      let metadataSnapshot: ResolvedLinkMetadata | null = null;
      if (sourceUrl) {
        const metadata = await fetchOpenGraphMetadata(sourceUrl);
        metadataSnapshot = {
          title: metadata?.title?.trim() || null,
          description: metadata?.description?.trim() || null,
          siteName: metadata?.siteName?.trim() || null,
          image: metadata?.image?.trim() || null,
        };
      }

      if (!titleZh) {
        const fetchedTitle = metadataSnapshot?.title ?? null;
        const resolvedTitle = fetchedTitle || QUICK_ADD_DEFAULT_TITLE;
        titleZh = resolvedTitle;
        setForm((prev) => ({ ...prev, titleZh: resolvedTitle }));
        if (fetchedTitle && !containsCjk(fetchedTitle) && !titleAlt) {
          titleAlt = fetchedTitle;
          setForm((prev) => ({ ...prev, titleAlt: fetchedTitle }));
        }
      } else if (
        metadataSnapshot?.title &&
        !containsCjk(metadataSnapshot.title) &&
        !titleAlt
      ) {
        const foreignTitle = metadataSnapshot.title;
        titleAlt = foreignTitle;
        setForm((prev) => ({ ...prev, titleAlt: foreignTitle }));
      }

      let resolvedThumbUrl = thumbUrlInput;
      if (!resolvedThumbUrl && metadataSnapshot?.image) {
        resolvedThumbUrl = metadataSnapshot.image;
      }

      if (sourceUrl) {
        const hasDuplicate = await hasCabinetItemWithSourceUrl(
          db,
          user.uid,
          cabinetId,
          sourceUrl
        );
        if (hasDuplicate) {
          const confirmed = window.confirm("已有相同連結物件,是否創建?");
          if (!confirmed) {
            return;
          }
        }
      }

      const links = sourceUrl
        ? [
            {
              label: metadataSnapshot?.siteName ?? "來源",
              url: sourceUrl,
              isPrimary: true,
              title: metadataSnapshot?.title ?? null,
              description: metadataSnapshot?.description ?? null,
              siteName: metadataSnapshot?.siteName ?? null,
            },
          ]
        : [];

      const autoTags = extractAutoTagsFromTitles(
        [titleZh, titleAlt],
        cabinetTags,
        form.selectedTags.length > 0
      );
      const resolvedTags = Array.from(
        new Set([...uniqueTags, ...autoTags])
      );

      const docRef = await addDoc(collection(db, "item"), {
        uid: user.uid,
        cabinetId,
        titleZh,
        titleAlt: titleAlt || null,
        author: author || null,
        language: languageValue || null,
        tags: resolvedTags,
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

  async function handleCommitTag(rawTag: string) {
    const value = rawTag.trim();
    if (!value) {
      setTagStatus({ message: null, error: "請輸入標籤名稱", saving: false });
      return;
    }
    if (!form.cabinetId) {
      setTagStatus({ message: null, error: "請先選擇櫃子", saving: false });
      return;
    }
    if (tagStatus.saving) {
      return;
    }
    setTagStatus({ message: null, error: null, saving: false });
    let alreadySelected = false;
    setForm((prev) => {
      if (prev.selectedTags.includes(value)) {
        alreadySelected = true;
        return prev;
      }
      return { ...prev, selectedTags: [...prev.selectedTags, value] };
    });
    setTagQuery("");
    if (alreadySelected) {
      setTagStatus({ message: `已選取 #${value}`, error: null, saving: false });
      return;
    }
    if (cabinetTags.includes(value)) {
      setTagStatus({ message: `已加入 #${value}`, error: null, saving: false });
      return;
    }
    const previousTags = cabinetTags;
    const nextTags = normalizeCabinetTags([...previousTags, value]);
    setTagStatus({ message: null, error: null, saving: true });
    setCabinetTags(nextTags);
    tagsCacheRef.current[form.cabinetId] = nextTags;
    try {
      const db = getFirebaseDb();
      if (!db) {
        throw new Error("Firebase 尚未設定");
      }
      await updateDoc(doc(db, "cabinet", form.cabinetId), {
        tags: nextTags,
        updatedAt: serverTimestamp(),
      });
      setTagStatus({ message: `已新增 #${value}`, error: null, saving: false });
    } catch (err) {
      console.error("新增標籤失敗", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "新增標籤時發生錯誤，請稍後再試";
      setTagStatus({ message: null, error: message, saving: false });
      setCabinetTags(previousTags);
      tagsCacheRef.current[form.cabinetId] = previousTags;
      setForm((prev) => ({
        ...prev,
        selectedTags: prev.selectedTags.filter((tag) => tag !== value),
      }));
    }
  }

  function handleRemoveSelectedTag(tag: string) {
    setForm((prev) => ({
      ...prev,
      selectedTags: prev.selectedTags.filter((item) => item !== tag),
    }));
    setTagStatus({ message: null, error: null, saving: false });
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleCommitTag(tagQuery);
    }
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-base shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

  const selectedTagSet = useMemo(
    () => new Set(form.selectedTags),
    [form.selectedTags]
  );

  const availableTagSuggestions = useMemo(
    () => cabinetTags.filter((tag) => !selectedTagSet.has(tag)),
    [cabinetTags, selectedTagSet]
  );

  const filteredTagSuggestions = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    if (!query) {
      return availableTagSuggestions;
    }
    return availableTagSuggestions.filter((tag) =>
      tag.toLowerCase().includes(query)
    );
  }, [availableTagSuggestions, tagQuery]);

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
                  cabinets.map((cabinet) => {
                    const label = cabinet.name || "未命名櫃子";
                    const display = cabinet.isLocked
                      ? `${label}（已鎖定）`
                      : label;
                    return (
                      <option key={cabinet.id} value={cabinet.id}>
                        {display}
                      </option>
                    );
                  })
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
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="titleAlt" className="text-sm font-medium text-gray-700">
                原文/其他標題（可不填）
              </label>
              <input
                id="titleAlt"
                type="text"
                className={inputClass}
                value={form.titleAlt}
                onChange={(event) => handleInputChange("titleAlt", event.target.value)}
                placeholder="選填"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="author" className="text-sm font-medium text-gray-700">
                作者 / 製作（可不填）
              </label>
              <input
                id="author"
                type="text"
                className={inputClass}
                value={form.author}
                onChange={(event) => handleInputChange("author", event.target.value)}
                placeholder="選填"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="language" className="text-sm font-medium text-gray-700">
                語言
              </label>
              <select
                id="language"
                className={inputClass}
                value={form.language}
                onChange={(event) => handleInputChange("language", event.target.value)}
              >
                <option value="">未選擇</option>
                {ITEM_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">
                  標籤
                  <span className="ml-1 text-xs font-normal text-gray-500">
                    （可不填）
                  </span>
                </label>
                {form.cabinetId && (
                  <button
                    type="button"
                    onClick={() => setTagManagerOpen(true)}
                    className="text-xs text-blue-600 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
                    disabled={selectedCabinet?.isLocked || !user}
                    title={
                      selectedCabinet?.isLocked
                        ? "此櫃子已鎖定，請先解除鎖定"
                        : undefined
                    }
                  >
                    管理標籤
                  </button>
                )}
              </div>

              {form.selectedTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {form.selectedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700"
                    >
                      #{tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveSelectedTag(tag)}
                        className="rounded-full p-1 text-blue-500 transition hover:bg-blue-100"
                        aria-label={`移除標籤 ${tag}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-gray-200 bg-white/70 px-4 py-4 text-sm text-gray-500">
                  尚未選擇標籤，可直接輸入新增或從下方列表挑選。
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-center gap-2">
                  <input
                    value={tagQuery}
                    onChange={(event) => {
                      setTagQuery(event.target.value);
                      setTagStatus({ message: null, error: null, saving: false });
                    }}
                    onKeyDown={handleTagKeyDown}
                    placeholder={
                      form.cabinetId ? "輸入或搜尋標籤" : "請先選擇櫃子"
                    }
                    className={inputClass}
                    disabled={!form.cabinetId}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCommitTag(tagQuery)}
                  className="h-11 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm text-blue-700 transition hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!form.cabinetId || tagStatus.saving || !tagQuery.trim()}
                >
                  {tagStatus.saving ? "處理中…" : "加入標籤"}
                </button>
              </div>

              {tagStatus.error ? (
                <div className="break-anywhere rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
                  {tagStatus.error}
                </div>
              ) : null}
              {tagStatus.message ? (
                <div className="break-anywhere rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                  {tagStatus.message}
                </div>
              ) : null}

              {form.selectedTags.some((tag) => !cabinetTags.includes(tag)) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                  有部分標籤已於此櫃的標籤管理中移除，儲存時將自動忽略。
                </div>
              )}

              <div className="rounded-2xl border border-gray-100 bg-white/80 px-4 py-4">
                {!form.cabinetId ? (
                  <p className="text-sm text-gray-500">請先選擇櫃子以載入標籤。</p>
                ) : isFetchingTags ? (
                  <p className="text-sm text-gray-500">載入標籤中…</p>
                ) : cabinetTags.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    此櫃尚未建立標籤，可直接輸入上方欄位新增。
                  </p>
                ) : filteredTagSuggestions.length > 0 ? (
                  <div className="space-y-1">
                    <span className="text-xs text-gray-500">現有標籤</span>
                    <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                      {filteredTagSuggestions.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => void handleCommitTag(tag)}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 transition hover:border-blue-200 hover:text-blue-600"
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    找不到符合的標籤，可直接輸入新增。
                  </p>
                )}
              </div>
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
        {form.cabinetId && user ? (
          <CabinetTagQuickEditor
            open={tagManagerOpen}
            onClose={() => setTagManagerOpen(false)}
            cabinetId={form.cabinetId}
            cabinetName={selectedCabinet?.name ?? ""}
            userId={user.uid}
            tags={cabinetTags}
            onTagsChange={(nextTags) => {
              setCabinetTags(nextTags);
              if (form.cabinetId) {
                tagsCacheRef.current[form.cabinetId] = nextTags;
              }
            }}
            onTagRenamed={(previousTag, nextTag) => {
              setForm((prev) => ({
                ...prev,
                selectedTags: prev.selectedTags.map((tag) =>
                  tag === previousTag ? nextTag : tag
                ),
              }));
            }}
            onTagDeleted={(target) => {
              setForm((prev) => ({
                ...prev,
                selectedTags: prev.selectedTags.filter((tag) => tag !== target),
              }));
            }}
            onStatus={(status) => {
              setTagStatus({
                message: status.message ?? null,
                error: status.error ?? null,
                saving: false,
              });
            }}
          />
        ) : null}
      </div>
    </main>
  );
}

