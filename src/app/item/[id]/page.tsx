"use client";

import Image from "next/image";
import Link from "next/link";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import FavoriteToggleButton from "@/components/FavoriteToggleButton";
import ThumbEditorDialog from "@/components/ThumbEditorDialog";
import ThumbLinkField from "@/components/ThumbLinkField";
import {
  normalizeAppearanceRecords,
  splitAppearanceLabels,
  formatAppearanceLabels,
} from "@/lib/appearances";
import {
  buildInsightStorageList,
  normalizeInsightEntries,
  type InsightEntry,
} from "@/lib/insights";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { calculateNextUpdateDate } from "@/lib/item-utils";
import { buttonClass } from "@/lib/ui";
import {
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_VALUES,
  PROGRESS_TYPE_OPTIONS,
  type AppearanceRecord,
  type ItemRecord,
  type ItemStatus,
  type ProgressType,
  type UpdateFrequency,
  UPDATE_FREQUENCY_OPTIONS,
  UPDATE_FREQUENCY_VALUES,
  type ThumbTransform,
} from "@/lib/types";
import {
  clampThumbTransform,
  DEFAULT_THUMB_TRANSFORM,
  normalizeThumbTransform,
  prepareThumbTransform,
} from "@/lib/image-utils";

const statusLabelMap = new Map(
  ITEM_STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const updateFrequencyLabelMap = new Map(
  UPDATE_FREQUENCY_OPTIONS.map((option) => [option.value, option.label])
);

const progressTypeLabelMap = new Map(
  PROGRESS_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

const backButtonClass =
  "detail-back-button inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-white";

type QuickEditField = "titleZh" | "titleAlt" | "progressNote" | "note";

const quickEditConfig: Record<
  QuickEditField,
  {
    label: string;
    placeholder: string;
    multiline?: boolean;
    required?: boolean;
    successMessage: string;
  }
> = {
  titleZh: {
    label: "中文標題 *",
    placeholder: "請輸入中文標題",
    required: true,
    successMessage: "已更新中文標題",
  },
  titleAlt: {
    label: "原文 / 其他標題",
    placeholder: "可補充原文或別名",
    successMessage: "已更新原文 / 其他標題",
  },
  progressNote: {
    label: "進度備註",
    placeholder: "記錄追進度的備註內容",
    multiline: true,
    successMessage: "已更新進度備註",
  },
  note: {
    label: "一般備註",
    placeholder: "補充想記錄的其他資訊",
    multiline: true,
    successMessage: "已更新一般備註",
  },
};

function isOptimizedImageUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "i.imgur.com";
  } catch {
    return false;
  }
}

function formatDateTime(timestamp?: Timestamp | null): string {
  if (!timestamp) return "—";
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDateOnly(timestamp?: Timestamp | null): string {
  if (!timestamp) return "未設定";
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function formatTimestampToInput(timestamp?: Timestamp | null): string {
  if (!timestamp) {
    return "";
  }
  return formatDateToInput(timestamp.toDate());
}

function formatDateToInput(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatProgressValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

type AppearanceStorageRecord = {
  name: string;
  nameZh: string;
  nameOriginal: string | null;
  labels: string | null;
  thumbUrl: string | null;
  thumbTransform: ThumbTransform | null;
  note: string | null;
};

function buildAppearanceStorageList(
  list: AppearanceRecord[]
): AppearanceStorageRecord[] {
  return list.map((entry) => {
    const nameZh = entry.nameZh.trim();
    const nameOriginal =
      typeof entry.nameOriginal === "string" ? entry.nameOriginal.trim() : "";
    const labels =
      typeof entry.labels === "string" ? formatAppearanceLabels(entry.labels) : "";
    const thumbUrl =
      typeof entry.thumbUrl === "string" ? entry.thumbUrl.trim() : "";
    const note = typeof entry.note === "string" ? entry.note.trim() : "";
    const preparedTransform = prepareThumbTransform(entry.thumbTransform);

    return {
      name: nameZh,
      nameZh,
      nameOriginal: nameOriginal || null,
      labels: labels || null,
      thumbUrl: thumbUrl || null,
      thumbTransform: preparedTransform,
      note: note ? note : null,
    };
  });
}

type ItemPageProps = {
  params: Promise<{ id: string }>;
};

type PrimaryProgressState = {
  id: string;
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | null;
  updatedAt?: Timestamp | null;
};

type NoteFeedback = {
  type: "success" | "error";
  message: string;
};

type ProgressDraftState = {
  platform: string;
  type: ProgressType;
  value: string;
  unit: string;
};

type AttributeDraftState = {
  status: ItemStatus;
  rating: string;
  author: string;
  updateFrequency: UpdateFrequency | "";
  nextUpdateAt: string;
};

type SectionKey = "progress" | "appearances" | "notes";

const defaultProgressType =
  (PROGRESS_TYPE_OPTIONS[0]?.value as ProgressType | undefined) ?? "chapter";

export default function ItemDetailPage({ params }: ItemPageProps) {
  const { id: itemId } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [item, setItem] = useState<ItemRecord | null>(null);
  const [itemLoading, setItemLoading] = useState(true);
  const [itemError, setItemError] = useState<string | null>(null);
  const [cabinetName, setCabinetName] = useState<string | null>(null);
  const [cabinetMissing, setCabinetMissing] = useState(false);
  const [primary, setPrimary] = useState<PrimaryProgressState | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [progressFeedback, setProgressFeedback] =
    useState<NoteFeedback | null>(null);
  const [progressEditorOpen, setProgressEditorOpen] = useState(false);
  const [progressDraft, setProgressDraft] = useState<ProgressDraftState>({
    platform: "",
    type: defaultProgressType,
    value: "",
    unit: "",
  });
  const [progressEditorSaving, setProgressEditorSaving] = useState(false);
  const [progressEditorError, setProgressEditorError] = useState<string | null>(
    null
  );
  const [noteEditor, setNoteEditor] = useState<{
    index: number;
    title: string;
    content: string;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteDeleting, setNoteDeleting] = useState(false);
  const [noteFeedback, setNoteFeedback] = useState<NoteFeedback | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [noteAddPending, setNoteAddPending] = useState(false);
  const [noteReorderOpen, setNoteReorderOpen] = useState(false);
  const [noteReorderList, setNoteReorderList] = useState<InsightEntry[]>([]);
  const [noteReorderSelectedIndex, setNoteReorderSelectedIndex] = useState(-1);
  const [noteReorderSaving, setNoteReorderSaving] = useState(false);
  const [noteReorderError, setNoteReorderError] = useState<string | null>(null);
  const [appearanceEditor, setAppearanceEditor] = useState<{
    index: number;
    nameZh: string;
    nameOriginal: string;
    labels: string;
    thumbUrl: string;
    thumbTransform: ThumbTransform;
    note: string;
  } | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceSaving, setAppearanceSaving] = useState(false);
  const [appearanceDeleting, setAppearanceDeleting] = useState(false);
  const [appearanceThumbEditorOpen, setAppearanceThumbEditorOpen] =
    useState(false);
  const appearanceNameZhInputRef = useRef<HTMLInputElement | null>(null);
  const [appearanceFeedback, setAppearanceFeedback] =
    useState<NoteFeedback | null>(null);
  const [appearanceAddPending, setAppearanceAddPending] = useState(false);
  const [appearanceReorderOpen, setAppearanceReorderOpen] = useState(false);
  const [appearanceReorderList, setAppearanceReorderList] = useState<
    AppearanceRecord[]
  >([]);
  const [appearanceReorderSelectedIndex, setAppearanceReorderSelectedIndex] =
    useState(-1);
  const [appearanceReorderSaving, setAppearanceReorderSaving] = useState(false);
  const [appearanceReorderError, setAppearanceReorderError] =
    useState<string | null>(null);
  const [attributeEditorOpen, setAttributeEditorOpen] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [attributeError, setAttributeError] = useState<string | null>(null);
  const [attributeDraft, setAttributeDraft] = useState<AttributeDraftState>({
    status: ITEM_STATUS_OPTIONS[0]?.value ?? "planning",
    rating: "",
    author: "",
    updateFrequency: "",
    nextUpdateAt: "",
  });
  const [attributeFeedback, setAttributeFeedback] =
    useState<NoteFeedback | null>(null);
  const [favoritePending, setFavoritePending] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>({
    progress: true,
    appearances: true,
    notes: true,
  });
  const [infoFeedback, setInfoFeedback] = useState<NoteFeedback | null>(null);
  const [quickEditor, setQuickEditor] = useState<{
    field: QuickEditField;
    value: string;
  } | null>(null);
  const [quickEditorSaving, setQuickEditorSaving] = useState(false);
  const [quickEditorError, setQuickEditorError] = useState<string | null>(null);
  const quickEditorInputRef =
    useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const toggleSection = useCallback((key: SectionKey) => {
    setSectionOpen((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  function resolveQuickEditorValue(field: QuickEditField, record: ItemRecord): string {
    switch (field) {
      case "titleZh":
        return typeof record.titleZh === "string" ? record.titleZh : "";
      case "titleAlt":
        return typeof record.titleAlt === "string" ? record.titleAlt : "";
      case "progressNote":
        return typeof record.progressNote === "string" ? record.progressNote : "";
      case "note":
        return typeof record.note === "string" ? record.note : "";
      default:
        return "";
    }
  }

  function openQuickEditor(field: QuickEditField) {
    if (!item) {
      setInfoFeedback({ type: "error", message: "目前無法編輯" });
      return;
    }
    if (!user) {
      setInfoFeedback({ type: "error", message: "請先登入後再編輯" });
      return;
    }
    setQuickEditor({ field, value: resolveQuickEditorValue(field, item) });
    setQuickEditorError(null);
  }

  const closeQuickEditor = () => {
    if (quickEditorSaving) {
      return;
    }
    setQuickEditor(null);
    setQuickEditorError(null);
  };

  const handleQuickEditorChange = (value: string) => {
    setQuickEditor((prev) => (prev ? { ...prev, value } : prev));
  };

  const handleQuickEditorSave = async () => {
    if (!quickEditor) {
      return;
    }
    if (!item) {
      setQuickEditorError("找不到物件資料");
      return;
    }
    if (!user) {
      setQuickEditorError("請先登入");
      return;
    }
    const config = quickEditConfig[quickEditor.field];
    const trimmedValue = quickEditor.value.trim();
    if (config.required && !trimmedValue) {
      setQuickEditorError(`${config.label}為必填`);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setQuickEditorError("Firebase 尚未設定");
      return;
    }
    const updateData: Record<string, unknown> = { updatedAt: serverTimestamp() };
    const finalValue = trimmedValue;
    switch (quickEditor.field) {
      case "titleZh":
        updateData.titleZh = finalValue;
        break;
      case "titleAlt":
        updateData.titleAlt = finalValue ? finalValue : null;
        break;
      case "progressNote":
        updateData.progressNote = finalValue ? finalValue : null;
        break;
      case "note":
        updateData.note = finalValue ? finalValue : null;
        break;
      default:
        break;
    }
    setQuickEditorSaving(true);
    setQuickEditorError(null);
    try {
      await updateDoc(doc(db, "item", item.id), updateData);
      setItem((prev) => {
        if (!prev) {
          return prev;
        }
        let nextRecord: ItemRecord = { ...prev, updatedAt: Timestamp.now() };
        switch (quickEditor.field) {
          case "titleZh":
            nextRecord = { ...nextRecord, titleZh: finalValue };
            break;
          case "titleAlt":
            nextRecord = { ...nextRecord, titleAlt: finalValue ? finalValue : null };
            break;
          case "progressNote":
            nextRecord = {
              ...nextRecord,
              progressNote: finalValue ? finalValue : null,
            };
            break;
          case "note":
            nextRecord = { ...nextRecord, note: finalValue ? finalValue : null };
            break;
          default:
            break;
        }
        return nextRecord;
      });
      setQuickEditor(null);
      setInfoFeedback({ type: "success", message: config.successMessage });
    } catch (err) {
      console.error("更新快速欄位時發生錯誤", err);
      setQuickEditorError("更新時發生錯誤，請稍後再試");
    } finally {
      setQuickEditorSaving(false);
    }
  };

  const derivedThumbTransform = item?.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
  const thumbStyle = useMemo(
    () => ({
      transform: `translate(${derivedThumbTransform.offsetX}%, ${derivedThumbTransform.offsetY}%) scale(${derivedThumbTransform.scale})`,
      transformOrigin: "center",
    }),
    [
      derivedThumbTransform.offsetX,
      derivedThumbTransform.offsetY,
      derivedThumbTransform.scale,
    ]
  );
  const canUseOptimizedThumb = isOptimizedImageUrl(item?.thumbUrl);

  useEffect(() => {
    if (!favoriteError) return;
    const timer = setTimeout(() => setFavoriteError(null), 3000);
    return () => clearTimeout(timer);
  }, [favoriteError]);

  useEffect(() => {
    if (!infoFeedback) return;
    const timer = setTimeout(() => setInfoFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [infoFeedback]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setItemLoading(false);
      setProgressLoading(false);
      setItemError("Firebase 尚未設定");
      setProgressError("Firebase 尚未設定");
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
      setItem(null);
      setCabinetName(null);
      setCabinetMissing(false);
      setItemError(null);
      setItemLoading(false);
      return;
    }
    let active = true;
    setItemLoading(true);
    setItemError(null);
    (async () => {
      try {
        const db = getFirebaseDb();
        if (!db) {
          setItemError("Firebase 尚未設定");
          setItemLoading(false);
          return;
        }
        const itemRef = doc(db, "item", itemId);
        const snap = await getDoc(itemRef);
        if (!active) return;
        if (!snap.exists()) {
          setItemError("找不到物件資料");
          setItemLoading(false);
          return;
        }
        const data = snap.data();
        if (!data || data.uid !== user.uid) {
          setItemError("您沒有存取此物件的權限");
          setItemLoading(false);
          return;
        }
        const statusValue =
          typeof data.status === "string" &&
          ITEM_STATUS_VALUES.includes(data.status as ItemStatus)
            ? (data.status as ItemStatus)
            : "planning";
        const updateFrequencyValue =
          typeof data.updateFrequency === "string" &&
          UPDATE_FREQUENCY_VALUES.includes(data.updateFrequency as UpdateFrequency)
            ? (data.updateFrequency as UpdateFrequency)
            : null;
        const ratingValue =
          typeof data.rating === "number" && Number.isFinite(data.rating)
            ? data.rating
            : null;
        const tags = Array.isArray(data.tags)
          ? data.tags
              .map((tag: unknown) => String(tag ?? ""))
              .filter((tag) => tag.length > 0)
          : [];
        const links = Array.isArray(data.links)
          ? (() => {
              const mapped = data.links
                .map((link) => {
                  const record = link as {
                    label?: unknown;
                    url?: unknown;
                    isPrimary?: unknown;
                  };
                  const label = typeof record.label === "string" ? record.label : "";
                  const url = typeof record.url === "string" ? record.url : "";
                  return { label, url, isPrimary: Boolean(record.isPrimary) };
                })
                .filter((link) => link.label && link.url);
              if (mapped.length === 0) {
                return [];
              }
              let hasPrimary = false;
              const normalized = mapped.map((link) => {
                if (link.isPrimary && !hasPrimary) {
                  hasPrimary = true;
                  return { ...link, isPrimary: true };
                }
                return { ...link, isPrimary: false };
              });
              if (!hasPrimary) {
                normalized[0] = { ...normalized[0], isPrimary: true };
              }
              return normalized;
            })()
          : [];
        const appearances = normalizeAppearanceRecords(data.appearances);
        const rawInsightNotes =
          Array.isArray(data.insightNotes) && data.insightNotes.length > 0
            ? data.insightNotes
            : typeof data.insightNote === "string"
              ? data.insightNote
              : [];
        const insightNotes = buildInsightStorageList(
          normalizeInsightEntries(rawInsightNotes)
        );
        const record: ItemRecord = {
          id: snap.id,
          uid: typeof data.uid === "string" ? data.uid : user.uid,
          cabinetId: typeof data.cabinetId === "string" ? data.cabinetId : "",
          titleZh:
            typeof data.titleZh === "string" && data.titleZh ? data.titleZh : "(未命名物件)",
          titleAlt: typeof data.titleAlt === "string" ? data.titleAlt : null,
          author: typeof data.author === "string" ? data.author : null,
          tags,
          links,
          thumbUrl: typeof data.thumbUrl === "string" ? data.thumbUrl : null,
          thumbTransform: data.thumbTransform
            ? normalizeThumbTransform(data.thumbTransform)
            : null,
          isFavorite: Boolean(data.isFavorite),
          progressNote: typeof data.progressNote === "string" ? data.progressNote : null,
          insightNote: typeof data.insightNote === "string" ? data.insightNote : null,
          insightNotes,
          note: typeof data.note === "string" ? data.note : null,
          appearances,
          rating: ratingValue,
          status: statusValue,
          updateFrequency: updateFrequencyValue,
          nextUpdateAt:
            data.nextUpdateAt instanceof Timestamp ? (data.nextUpdateAt as Timestamp) : null,
          createdAt:
            data.createdAt instanceof Timestamp ? (data.createdAt as Timestamp) : null,
          updatedAt:
            data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
        } satisfies ItemRecord;
        let resolvedCabinetName: string | null = null;
        let resolvedCabinetMissing = false;
        if (record.cabinetId) {
          try {
            const cabinetSnap = await getDoc(doc(db, "cabinet", record.cabinetId));
            if (!active) return;
            if (cabinetSnap.exists()) {
              const cabinetData = cabinetSnap.data();
              const name =
                typeof cabinetData?.name === "string" && cabinetData.name.trim()
                  ? cabinetData.name
                  : "未命名櫃子";
              resolvedCabinetName = name;
            } else {
              resolvedCabinetMissing = true;
            }
          } catch (err) {
            console.error("載入櫃子名稱時發生錯誤", err);
            resolvedCabinetMissing = true;
          }
        }
        if (!active) return;
        setItem(record);
        setCabinetName(resolvedCabinetName);
        setCabinetMissing(resolvedCabinetMissing);
        setItemLoading(false);
      } catch (err) {
        console.error("載入物件資料時發生錯誤", err);
        if (!active) return;
        setItemError("載入物件資料時發生錯誤");
        setItemLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, itemId]);

  useEffect(() => {
    if (!user) {
      setPrimary(null);
      setProgressLoading(false);
      return;
    }
    setProgressLoading(true);
    setProgressError(null);
    const db = getFirebaseDb();
    if (!db) {
      setProgressError("Firebase 尚未設定");
      setProgressLoading(false);
      return;
    }
    const progressQuery = query(
      collection(db, "item", itemId, "progress"),
      where("isPrimary", "==", true),
      limit(1)
    );
    const unsub = onSnapshot(
      progressQuery,
      (snap) => {
        if (snap.empty) {
          setPrimary(null);
        } else {
          const docSnap = snap.docs[0];
          const data = docSnap.data();
          const typeValue =
            typeof data.type === "string" &&
            progressTypeLabelMap.has(data.type as ProgressType)
              ? (data.type as ProgressType)
              : "chapter";
          setPrimary({
            id: docSnap.id,
            platform: typeof data.platform === "string" ? data.platform : "",
            type: typeValue,
            value:
              typeof data.value === "number" && Number.isFinite(data.value)
                ? data.value
                : 0,
            unit: typeof data.unit === "string" ? data.unit : null,
            updatedAt:
              data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
          });
        }
        setProgressLoading(false);
      },
      (err) => {
        console.error("載入主進度失敗", err);
        setProgressError("載入主進度失敗");
        setProgressLoading(false);
      }
    );
    return () => unsub();
  }, [user, itemId]);

  useEffect(() => {
    if (!noteFeedback) return;
    const timer = setTimeout(() => setNoteFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [noteFeedback]);

  useEffect(() => {
    if (!appearanceFeedback) return;
    const timer = setTimeout(() => setAppearanceFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [appearanceFeedback]);

  useEffect(() => {
    if (!attributeFeedback) return;
    const timer = setTimeout(() => setAttributeFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [attributeFeedback]);

  useEffect(() => {
    if (!progressFeedback) return;
    const timer = setTimeout(() => setProgressFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [progressFeedback]);

  const openProgressEditor = () => {
    if (!primary) {
      setProgressFeedback({
        type: "error",
        message: "尚未設定主進度，請先於進度管理中新增。",
      });
      return;
    }
    setProgressDraft({
      platform: primary.platform,
      type: primary.type,
      value: Number.isFinite(primary.value) ? String(primary.value) : "",
      unit: primary.unit ?? "",
    });
    setProgressEditorError(null);
    setProgressEditorOpen(true);
  };

  const closeProgressEditor = () => {
    if (progressEditorSaving) {
      return;
    }
    setProgressEditorOpen(false);
    setProgressEditorError(null);
  };

  const handleProgressEditorSubmit = async () => {
    if (!primary) {
      setProgressEditorError("尚未設定主進度");
      return;
    }
    const trimmedPlatform = progressDraft.platform.trim();
    if (!trimmedPlatform) {
      setProgressEditorError("請輸入平台 / 來源");
      return;
    }
    const selectedType = progressTypeLabelMap.has(progressDraft.type)
      ? progressDraft.type
      : defaultProgressType;
    const valueInput = progressDraft.value.trim();
    if (!valueInput) {
      setProgressEditorError("請輸入進度數值");
      return;
    }
    const parsedValue = Number(valueInput);
    if (!Number.isFinite(parsedValue)) {
      setProgressEditorError("請輸入有效的進度數值");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setProgressEditorError("Firebase 尚未設定");
      return;
    }
    setProgressEditorSaving(true);
    setProgressEditorError(null);
    try {
      const progressRef = doc(db, "item", itemId, "progress", primary.id);
      const trimmedUnit = progressDraft.unit.trim();
      await updateDoc(progressRef, {
        platform: trimmedPlatform,
        type: selectedType,
        value: parsedValue,
        unit: trimmedUnit ? trimmedUnit : null,
        updatedAt: serverTimestamp(),
      });
      const nextDate = calculateNextUpdateDate(item?.updateFrequency ?? null);
      await updateDoc(doc(db, "item", itemId), {
        updatedAt: serverTimestamp(),
        nextUpdateAt: nextDate ? Timestamp.fromDate(nextDate) : null,
      });
      setProgressEditorOpen(false);
      setProgressFeedback({
        type: "success",
        message: "已更新主進度",
      });
    } catch (err) {
      console.error("更新主進度時發生錯誤", err);
      setProgressEditorError("更新主進度時發生錯誤");
    } finally {
      setProgressEditorSaving(false);
    }
  };

  useEffect(() => {
    if (!noteEditor) return;
    const timer = setTimeout(() => {
      const textarea = noteTextareaRef.current;
      if (textarea) {
        textarea.focus();
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [noteEditor]);

  const appearanceEditorIndex = appearanceEditor?.index ?? null;

  useEffect(() => {
    if (appearanceEditorIndex === null) return;
    const timer = setTimeout(() => {
      const input = appearanceNameZhInputRef.current;
      if (input) {
        input.focus();
        const length = input.value.length;
        input.setSelectionRange(length, length);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [appearanceEditorIndex]);

  useEffect(() => {
    if (!quickEditor) return;
    const timer = setTimeout(() => {
      const input = quickEditorInputRef.current;
      if (input && typeof input.focus === "function") {
        input.focus();
        if ("setSelectionRange" in input) {
          const length = input.value.length;
          try {
            input.setSelectionRange(length, length);
          } catch {
            // ignore selection errors
          }
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [quickEditor]);

  const progressSummary = useMemo(() => {
    if (progressLoading) {
      return "主進度載入中…";
    }
    if (!primary) {
      return "尚未設定主進度";
    }
    const typeLabel = progressTypeLabelMap.get(primary.type) ?? primary.type;
    const valueText = formatProgressValue(primary.value);
    const unitText = primary.unit ? ` ${primary.unit}` : "";
    const platform = primary.platform || "未命名平台";
    return `${platform}｜${typeLabel} ${valueText}${unitText}`;
  }, [primary, progressLoading]);

  const primaryLink = useMemo(() => {
    if (!item || !Array.isArray(item.links)) {
      return null;
    }
    const validLinks = item.links.filter(
      (link) => typeof link.url === "string" && link.url.trim().length > 0
    );
    if (validLinks.length === 0) {
      return null;
    }
    const flagged = validLinks.find((link) => link.isPrimary);
    return flagged ?? validLinks[0];
  }, [item]);

  function openAttributeEditor() {
    if (!item) {
      setAttributeFeedback({
        type: "error",
        message: "目前無法編輯屬性",
      });
      return;
    }
    if (!user) {
      setAttributeFeedback({
        type: "error",
        message: "請先登入後再編輯屬性",
      });
      return;
    }
    const statusValue = ITEM_STATUS_VALUES.includes(item.status)
      ? item.status
      : ITEM_STATUS_OPTIONS[0]?.value ?? "planning";
    const ratingValue =
      typeof item.rating === "number" && Number.isFinite(item.rating)
        ? String(item.rating)
        : "";
    const authorValue =
      typeof item.author === "string" ? item.author : "";
    const updateFrequencyValue =
      item.updateFrequency &&
      UPDATE_FREQUENCY_VALUES.includes(item.updateFrequency)
        ? item.updateFrequency
        : "";
    setAttributeDraft({
      status: statusValue,
      rating: ratingValue,
      author: authorValue,
      updateFrequency: updateFrequencyValue,
      nextUpdateAt: formatTimestampToInput(item.nextUpdateAt),
    });
    setAttributeError(null);
    setAttributeEditorOpen(true);
  }

  const closeAttributeEditor = () => {
    if (attributeSaving) {
      return;
    }
    setAttributeEditorOpen(false);
    setAttributeError(null);
  };

  const handleAttributeSave = async () => {
    if (!item) {
      setAttributeError("找不到物件資料");
      return;
    }
    if (!user) {
      setAttributeError("請先登入");
      return;
    }
    const statusValue = attributeDraft.status;
    if (!ITEM_STATUS_VALUES.includes(statusValue)) {
      setAttributeError("狀態值不在允許範圍");
      return;
    }
    const updateFrequencyValue = attributeDraft.updateFrequency;
    if (
      updateFrequencyValue &&
      !UPDATE_FREQUENCY_VALUES.includes(updateFrequencyValue)
    ) {
      setAttributeError("更新頻率值不在允許範圍");
      return;
    }
    const ratingInput = attributeDraft.rating.trim();
    let ratingValue: number | null = null;
    if (ratingInput) {
      const parsedRating = Number(ratingInput);
      if (Number.isNaN(parsedRating)) {
        setAttributeError("評分需為數字");
        return;
      }
      if (parsedRating < 0 || parsedRating > 10) {
        setAttributeError("評分需介於 0 至 10 之間");
        return;
      }
      ratingValue = parsedRating;
    }
    const trimmedAuthor = attributeDraft.author.trim();
    const nextUpdateInput = attributeDraft.nextUpdateAt.trim();
    let nextUpdateTimestamp: Timestamp | null = null;
    if (nextUpdateInput) {
      const parsedDate = new Date(nextUpdateInput);
      if (Number.isNaN(parsedDate.getTime())) {
        setAttributeError("下次更新時間格式錯誤");
        return;
      }
      nextUpdateTimestamp = Timestamp.fromDate(parsedDate);
    }
    const db = getFirebaseDb();
    if (!db) {
      setAttributeError("Firebase 尚未設定");
      return;
    }
    setAttributeSaving(true);
    setAttributeError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      const resolvedUpdateFrequency = updateFrequencyValue || null;
      await updateDoc(itemRef, {
        status: statusValue,
        rating: ratingValue !== null ? ratingValue : null,
        author: trimmedAuthor ? trimmedAuthor : null,
        updateFrequency: resolvedUpdateFrequency,
        nextUpdateAt: nextUpdateTimestamp,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              status: statusValue,
              rating: ratingValue !== null ? ratingValue : null,
              author: trimmedAuthor ? trimmedAuthor : null,
              updateFrequency: resolvedUpdateFrequency,
              nextUpdateAt: nextUpdateTimestamp,
              updatedAt: Timestamp.now(),
            }
          : prev
      );
      setAttributeEditorOpen(false);
      setAttributeFeedback({ type: "success", message: "已更新屬性" });
    } catch (err) {
      console.error("更新屬性時發生錯誤", err);
      setAttributeError("更新屬性時發生錯誤");
    } finally {
      setAttributeSaving(false);
    }
  };

  function openNoteEditor(index: number) {
    if (!item) {
      setNoteFeedback({
        type: "error",
        message: "目前無法編輯心得 / 筆記",
      });
      return;
    }
    setSectionOpen((prev) => ({ ...prev, notes: true }));
    const entries = normalizeInsightEntries(
      item.insightNotes ?? item.insightNote
    );
    const target = entries[index];
    if (!target) {
      setNoteFeedback({
        type: "error",
        message: "找不到要編輯的心得 / 筆記",
      });
      return;
    }
    setNoteEditor({ index, title: target.title, content: target.content });
    setNoteError(null);
  }

  function closeNoteEditor() {
    if (noteSaving || noteDeleting) {
      return;
    }
    setNoteEditor(null);
    setNoteError(null);
  }

  const handleFavoriteToggle = useCallback(async () => {
    if (!item) {
      setFavoriteError("目前無法更新最愛狀態");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFavoriteError("Firebase 尚未設定");
      return;
    }
    const nextValue = !item.isFavorite;
    setFavoritePending(true);
    setFavoriteError(null);
    try {
      await updateDoc(doc(db, "item", item.id), {
        isFavorite: nextValue,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              isFavorite: nextValue,
              updatedAt: Timestamp.now(),
            }
          : prev
      );
    } catch (err) {
      console.error("更新最愛狀態時發生錯誤", err);
      setFavoriteError("更新最愛狀態時發生錯誤");
    } finally {
      setFavoritePending(false);
    }
  }, [item]);

  async function handleAppearanceAdd() {
    if (!item) {
      setAppearanceFeedback({
        type: "error",
        message: "找不到物件資料",
      });
      return;
    }
    if (!user) {
      setAppearanceFeedback({
        type: "error",
        message: "請先登入後再新增登場物件",
      });
      return;
    }
    if (appearanceAddPending) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setAppearanceFeedback({
        type: "error",
        message: "Firebase 尚未設定",
      });
      return;
    }
    const currentRecords = normalizeAppearanceRecords(item.appearances);
    const updatedRecords = [
      ...currentRecords,
      {
        nameZh: "未填寫",
        nameOriginal: null,
        labels: null,
        thumbUrl: null,
        thumbTransform: null,
        note: null,
      } satisfies AppearanceRecord,
    ];
    const storageList = buildAppearanceStorageList(updatedRecords);
    setAppearanceAddPending(true);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        appearances: storageList,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              appearances: storageList,
            }
          : prev
      );
      setSectionOpen((prev) => ({ ...prev, appearances: true }));
      setAppearanceFeedback({
        type: "success",
        message: "已新增登場項目",
      });
    } catch (err) {
      console.error("新增登場項目時發生錯誤", err);
      setAppearanceFeedback({
        type: "error",
        message: "新增登場項目時發生錯誤",
      });
    } finally {
      setAppearanceAddPending(false);
    }
  }

  async function handleNoteAdd() {
    if (!item) {
      setNoteFeedback({ type: "error", message: "找不到物件資料" });
      return;
    }
    if (!user) {
      setNoteFeedback({
        type: "error",
        message: "請先登入後再新增心得 / 筆記",
      });
      return;
    }
    if (noteAddPending) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setNoteFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const currentEntries = normalizeInsightEntries(
      item.insightNotes ?? item.insightNote
    );
    const updatedEntries = [
      ...currentEntries,
      { title: "", content: "未填寫" },
    ];
    const storageList = buildInsightStorageList(updatedEntries);
    setNoteAddPending(true);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        insightNotes: storageList,
        insightNote: null,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              insightNotes: storageList,
              insightNote: null,
            }
          : prev
      );
      setSectionOpen((prev) => ({ ...prev, notes: true }));
      setNoteFeedback({ type: "success", message: "已新增心得 / 筆記" });
    } catch (err) {
      console.error("新增心得 / 筆記時發生錯誤", err);
      setNoteFeedback({
        type: "error",
        message: "新增心得 / 筆記時發生錯誤",
      });
    } finally {
      setNoteAddPending(false);
    }
  }

  function openNoteReorder() {
    if (!item) {
      setNoteFeedback({ type: "error", message: "找不到物件資料" });
      return;
    }
    if (!user) {
      setNoteFeedback({
        type: "error",
        message: "請先登入後再調整心得 / 筆記順序",
      });
      return;
    }
    const records = normalizeInsightEntries(
      item.insightNotes ?? item.insightNote
    );
    setNoteReorderList(records);
    setNoteReorderSelectedIndex(-1);
    setNoteReorderError(null);
    setNoteReorderOpen(true);
  }

  function closeNoteReorder() {
    if (noteReorderSaving) {
      return;
    }
    setNoteReorderOpen(false);
    setNoteReorderError(null);
    setNoteReorderSelectedIndex(-1);
    setNoteReorderList([]);
  }

  const moveNoteReorderSelection = useCallback(
    (offset: number) => {
      if (noteReorderSaving || noteReorderSelectedIndex === -1) {
        return;
      }
      setNoteReorderList((prev) => {
        const newIndex = noteReorderSelectedIndex + offset;
        if (newIndex < 0 || newIndex >= prev.length) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(noteReorderSelectedIndex, 1);
        next.splice(newIndex, 0, moved);
        setNoteReorderSelectedIndex(newIndex);
        return next;
      });
    },
    [noteReorderSaving, noteReorderSelectedIndex]
  );

  async function handleNoteReorderSave() {
    if (!item) {
      setNoteReorderError("找不到物件資料");
      return;
    }
    if (!user) {
      setNoteReorderError("請先登入");
      return;
    }
    if (noteReorderSaving) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setNoteReorderError("Firebase 尚未設定");
      return;
    }
    const storageList = buildInsightStorageList(noteReorderList);
    setNoteReorderSaving(true);
    setNoteReorderError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        insightNotes: storageList,
        insightNote: null,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              insightNotes: storageList,
              insightNote: null,
            }
          : prev
      );
      setNoteReorderOpen(false);
      setNoteReorderSelectedIndex(-1);
      setNoteReorderList([]);
      setNoteFeedback({ type: "success", message: "已更新心得 / 筆記順序" });
    } catch (err) {
      console.error("更新心得 / 筆記順序時發生錯誤", err);
      setNoteReorderError("更新心得 / 筆記順序時發生錯誤");
    } finally {
      setNoteReorderSaving(false);
    }
  }

  function openAppearanceReorder() {
    if (!item) {
      setAppearanceFeedback({
        type: "error",
        message: "找不到物件資料",
      });
      return;
    }
    if (!user) {
      setAppearanceFeedback({
        type: "error",
        message: "請先登入後再調整登場順序",
      });
      return;
    }
    const records = normalizeAppearanceRecords(item.appearances);
    setAppearanceReorderList(records);
    setAppearanceReorderSelectedIndex(-1);
    setAppearanceReorderError(null);
    setAppearanceReorderOpen(true);
  }

  function closeAppearanceReorder() {
    if (appearanceReorderSaving) {
      return;
    }
    setAppearanceReorderOpen(false);
    setAppearanceReorderError(null);
    setAppearanceReorderSelectedIndex(-1);
    setAppearanceReorderList([]);
  }

  const moveAppearanceReorderSelection = useCallback(
    (offset: number) => {
      if (appearanceReorderSaving || appearanceReorderSelectedIndex === -1) {
        return;
      }
      setAppearanceReorderList((prev) => {
        const newIndex = appearanceReorderSelectedIndex + offset;
        if (newIndex < 0 || newIndex >= prev.length) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(appearanceReorderSelectedIndex, 1);
        next.splice(newIndex, 0, moved);
        setAppearanceReorderSelectedIndex(newIndex);
        return next;
      });
    },
    [appearanceReorderSaving, appearanceReorderSelectedIndex]
  );

  async function handleAppearanceReorderSave() {
    if (!item) {
      setAppearanceReorderError("找不到物件資料");
      return;
    }
    if (!user) {
      setAppearanceReorderError("請先登入");
      return;
    }
    if (appearanceReorderSaving) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setAppearanceReorderError("Firebase 尚未設定");
      return;
    }
    const storageList = buildAppearanceStorageList(appearanceReorderList);
    setAppearanceReorderSaving(true);
    setAppearanceReorderError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        appearances: storageList,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              appearances: storageList,
            }
          : prev
      );
      setAppearanceReorderOpen(false);
      setAppearanceReorderSelectedIndex(-1);
      setAppearanceReorderList([]);
      setAppearanceFeedback({
        type: "success",
        message: "已更新登場順序",
      });
    } catch (err) {
      console.error("更新登場順序時發生錯誤", err);
      setAppearanceReorderError("更新登場順序時發生錯誤");
    } finally {
      setAppearanceReorderSaving(false);
    }
  }

  function openAppearanceEditor(index: number) {
    if (!user) {
      setAppearanceFeedback({
        type: "error",
        message: "請先登入後再編輯登場物件",
      });
      return;
    }
    if (!item) {
      setAppearanceFeedback({
        type: "error",
        message: "目前無法編輯登場物件",
      });
      return;
    }
    setSectionOpen((prev) => ({ ...prev, appearances: true }));
    const target = item.appearances?.[index];
    if (!target) {
      setAppearanceFeedback({
        type: "error",
        message: "找不到登場資料",
      });
      return;
    }
    setAppearanceEditor({
      index,
      nameZh: target.nameZh,
      nameOriginal: target.nameOriginal ?? "",
      labels: target.labels ?? "",
      thumbUrl: target.thumbUrl ?? "",
      thumbTransform: target.thumbTransform
        ? clampThumbTransform(target.thumbTransform)
        : { ...DEFAULT_THUMB_TRANSFORM },
      note: target.note ?? "",
    });
    setAppearanceError(null);
    setAppearanceThumbEditorOpen(false);
  }

  function closeAppearanceEditor() {
    if (appearanceSaving || appearanceDeleting) {
      return;
    }
    setAppearanceEditor(null);
    setAppearanceError(null);
    setAppearanceThumbEditorOpen(false);
  }

  async function handleNoteSave() {
    if (!noteEditor) {
      setNoteError("找不到要編輯的心得 / 筆記");
      return;
    }
    if (!item) {
      setNoteError("找不到物件資料");
      return;
    }
    if (!user) {
      setNoteError("請先登入");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setNoteError("Firebase 尚未設定");
      return;
    }
    const currentEntries = normalizeInsightEntries(
      item.insightNotes ?? item.insightNote
    );
    if (!currentEntries[noteEditor.index]) {
      setNoteError("找不到要編輯的心得 / 筆記");
      return;
    }
    const title = noteEditor.title.trim();
    const content = noteEditor.content.trim();
    if (!title && !content) {
      setNoteError("請至少輸入標題或內容");
      return;
    }
    const updatedEntries = currentEntries.map((entry, idx) =>
      idx === noteEditor.index ? { title, content } : entry
    );
    const storageList = buildInsightStorageList(updatedEntries);
    setNoteSaving(true);
    setNoteError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        insightNotes: storageList,
        insightNote: null,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              insightNotes: storageList,
              insightNote: null,
            }
          : prev
      );
      setNoteEditor(null);
      setNoteFeedback({ type: "success", message: "已更新心得 / 筆記" });
    } catch (err) {
      console.error("更新心得 / 筆記時發生錯誤", err);
      setNoteError("更新心得 / 筆記時發生錯誤");
    } finally {
      setNoteSaving(false);
    }
  }

  async function handleNoteDelete(index?: number) {
    if (noteDeleting) {
      return;
    }
    if (!noteEditor) {
      setNoteError("找不到心得 / 筆記資料");
      return;
    }
    const targetIndex = typeof index === "number" ? index : noteEditor.index;
    if (!item) {
      setNoteError("找不到物件資料");
      return;
    }
    if (!user) {
      setNoteError("請先登入");
      return;
    }
    if (!window.confirm("確認移除此心得 / 筆記？")) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setNoteError("Firebase 尚未設定");
      return;
    }
    const currentEntries = normalizeInsightEntries(
      item.insightNotes ?? item.insightNote
    );
    if (!currentEntries[targetIndex]) {
      setNoteError("找不到心得 / 筆記資料");
      return;
    }
    const updatedEntries = currentEntries.filter((_, idx) => idx !== targetIndex);
    const storageList = buildInsightStorageList(updatedEntries);
    setNoteDeleting(true);
    setNoteError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        insightNotes: storageList,
        insightNote: null,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              insightNotes: storageList,
              insightNote: null,
            }
          : prev
      );
      setNoteEditor(null);
      setNoteFeedback({
        type: "success",
        message: "已移除心得 / 筆記",
      });
    } catch (err) {
      console.error("移除心得 / 筆記時發生錯誤", err);
      setNoteError("移除心得 / 筆記時發生錯誤");
    } finally {
      setNoteDeleting(false);
    }
  }

  async function handleAppearanceSave() {
    if (!appearanceEditor) {
      setAppearanceError("找不到登場資料");
      return;
    }
    if (!item) {
      setAppearanceError("找不到物件資料");
      return;
    }
    if (!user) {
      setAppearanceError("請先登入");
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setAppearanceError("Firebase 尚未設定");
      return;
    }
    const currentRecords = normalizeAppearanceRecords(item.appearances);
    if (!currentRecords[appearanceEditor.index]) {
      setAppearanceError("找不到登場資料");
      return;
    }
    const nameZh = appearanceEditor.nameZh.trim();
    if (!nameZh) {
      setAppearanceError("請輸入中文名稱");
      return;
    }
    const noteText = appearanceEditor.note.trim();
    const thumbUrl = appearanceEditor.thumbUrl.trim();
    const nameOriginal = appearanceEditor.nameOriginal.trim();
    const labels = formatAppearanceLabels(appearanceEditor.labels);
    const nextTransform = clampThumbTransform(appearanceEditor.thumbTransform);
    const updatedRecords = currentRecords.map((entry, idx) => {
      if (idx === appearanceEditor.index) {
        return {
          nameZh,
          nameOriginal: nameOriginal ? nameOriginal : null,
          labels: labels ? labels : null,
          thumbUrl: thumbUrl || null,
          thumbTransform: nextTransform,
          note: noteText ? noteText : null,
        } satisfies AppearanceRecord;
      }
      return entry;
    });
    const updatedList = buildAppearanceStorageList(updatedRecords);
    setAppearanceSaving(true);
    setAppearanceError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        appearances: updatedList,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              appearances: updatedList,
            }
          : prev
      );
      setAppearanceEditor(null);
      setAppearanceThumbEditorOpen(false);
      setAppearanceFeedback({
        type: "success",
        message: "已更新登場物件",
      });
    } catch (err) {
      console.error("更新登場物件時發生錯誤", err);
      setAppearanceError("更新登場物件時發生錯誤");
    } finally {
      setAppearanceSaving(false);
    }
  }

  async function handleAppearanceDelete(index?: number) {
    if (appearanceDeleting) {
      return;
    }
    if (!appearanceEditor) {
      setAppearanceError("找不到登場資料");
      return;
    }
    const targetIndex =
      typeof index === "number" ? index : appearanceEditor.index;
    if (targetIndex < 0) {
      setAppearanceError("找不到登場資料");
      return;
    }
    if (!item) {
      setAppearanceError("找不到物件資料");
      return;
    }
    if (!user) {
      setAppearanceError("請先登入");
      return;
    }
    if (!window.confirm("確認移除此登場項目？")) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setAppearanceError("Firebase 尚未設定");
      return;
    }
    const currentRecords = normalizeAppearanceRecords(item.appearances);
    if (!currentRecords[targetIndex]) {
      setAppearanceError("找不到登場資料");
      return;
    }
    const updatedRecords = currentRecords.filter((_, idx) => idx !== targetIndex);
    const updatedList = buildAppearanceStorageList(updatedRecords);
    setAppearanceDeleting(true);
    setAppearanceError(null);
    try {
      const itemRef = doc(db, "item", item.id);
      await updateDoc(itemRef, {
        appearances: updatedList,
        updatedAt: serverTimestamp(),
      });
      setItem((prev) =>
        prev
          ? {
              ...prev,
              appearances: updatedList,
            }
          : prev
      );
      setAppearanceEditor(null);
      setAppearanceThumbEditorOpen(false);
      setAppearanceFeedback({
        type: "success",
        message: "已移除登場項目",
      });
    } catch (err) {
      console.error("移除登場項目時發生錯誤", err);
      setAppearanceError("移除登場項目時發生錯誤");
    } finally {
      setAppearanceDeleting(false);
    }
  }

  if (!authChecked) {
    return (
      <main className="min-h-[100dvh] bg-zinc-950 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-base text-slate-200 shadow-2xl shadow-black/40">
          正在確認登入狀態…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] bg-zinc-950 px-4 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-200 shadow-2xl shadow-black/40">
          <h1 className="text-2xl font-semibold text-white">物件內容</h1>
          <p className="text-base text-slate-400">
            未登入。請先前往
            <Link href="/login" className="ml-1 text-indigo-300 underline-offset-4 transition hover:text-indigo-200 hover:underline">
              /login
            </Link>
            後再查看物件，或返回
            <Link href="/" className="ml-1 text-indigo-300 underline-offset-4 transition hover:text-indigo-200 hover:underline">
              首頁
            </Link>
            選擇其他功能。
          </p>
        </div>
      </main>
    );
  }

  if (itemLoading) {
    return (
      <main className="min-h-[100dvh] bg-zinc-950 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-base text-slate-200 shadow-2xl shadow-black/40">
          正在載入物件資料…
        </div>
      </main>
    );
  }

  if (itemError || !item) {
    return (
      <main className="min-h-[100dvh] bg-zinc-950 px-4 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-100 shadow-2xl shadow-black/40">
          <h1 className="break-anywhere text-2xl font-semibold text-white">物件內容</h1>
          <div className="break-anywhere rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {itemError ?? "找不到物件資料"}
          </div>
          {item?.cabinetId && (
            <div className="flex flex-wrap gap-2 text-sm text-slate-300">
              <Link
                href={`/cabinet/${encodeURIComponent(item.cabinetId)}`}
                className={backButtonClass}
              >
                上一頁
              </Link>
            </div>
          )}
        </div>
      </main>
    );
  }

  const statusLabel = statusLabelMap.get(item.status) ?? item.status;
  const ratingText =
    typeof item.rating === "number" && Number.isFinite(item.rating)
      ? item.rating.toFixed(item.rating % 1 === 0 ? 0 : 1)
      : "未設定";
  const updateFrequencyLabel = item.updateFrequency
    ? updateFrequencyLabelMap.get(item.updateFrequency) ?? item.updateFrequency
    : "未設定";
  const nextUpdateText = item.nextUpdateAt ? formatDateOnly(item.nextUpdateAt) : "未設定";
  const createdAtText = formatDateTime(item.createdAt);
  const updatedAtText = formatDateTime(item.updatedAt);
  const tags = item.tags ?? [];
  const links = item.links ?? [];
  const appearances = item.appearances ?? [];
  const insightEntries = normalizeInsightEntries(
    item.insightNotes ?? item.insightNote
  );
  const progressNoteText =
    typeof item.progressNote === "string" ? item.progressNote.trim() : "";
  const generalNoteText = typeof item.note === "string" ? item.note.trim() : "";
  const hasInsightEntries = insightEntries.length > 0;
  const hasAppearances = appearances.length > 0;
  const tagLinkBase = item.cabinetId
    ? `/cabinet/${encodeURIComponent(item.cabinetId)}`
    : null;
  const favoriteLabel = item.isFavorite
    ? `取消 ${item.titleZh} 最愛`
    : `將 ${item.titleZh} 設為最愛`;

  return (
    <main className="min-h-[100dvh] bg-zinc-950 px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 sm:gap-8">
        {item.cabinetId && !cabinetMissing ? (
          <div className="flex justify-end">
            <Link
              href={`/cabinet/${encodeURIComponent(item.cabinetId)}`}
              className={backButtonClass}
            >
              上一頁
            </Link>
          </div>
        ) : null}
        <header className="relative grid gap-6 rounded-3xl border border-slate-800 bg-slate-900/80 px-6 pb-6 pt-16 shadow-2xl shadow-black/40 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,auto)]">
          <FavoriteToggleButton
            isFavorite={item.isFavorite}
            onToggle={handleFavoriteToggle}
            disabled={favoritePending}
            ariaLabel={favoriteLabel}
            className="absolute right-6 top-6"
          />
          <div className="space-y-4 pr-2 sm:pr-10">
            <div
              className="group cursor-text rounded-2xl border border-transparent px-4 py-3 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              onDoubleClick={() => openQuickEditor("titleZh")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openQuickEditor("titleZh");
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="快速編輯中文標題"
              title="雙擊以快速編輯中文標題"
            >
              <div className="text-xs uppercase tracking-wide text-slate-500">中文標題 *</div>
              <h1 className="break-anywhere text-3xl font-semibold text-white">{item.titleZh}</h1>
            </div>
            <div
              className="group cursor-text rounded-2xl border border-transparent px-4 py-3 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              onDoubleClick={() => openQuickEditor("titleAlt")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openQuickEditor("titleAlt");
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="快速編輯原文或其他標題"
              title="雙擊以快速編輯原文或其他標題"
            >
              <div className="text-xs uppercase tracking-wide text-slate-500">原文 / 其他標題</div>
              {item.titleAlt ? (
                <p className="break-anywhere text-base text-slate-300">{item.titleAlt}</p>
              ) : (
                <p className="text-sm text-slate-500">尚未設定</p>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-slate-400">
              <span>物件 ID：{item.id}</span>
              {item.cabinetId ? (
                cabinetMissing ? (
                  <span className="text-rose-300">所屬櫃子：資料不存在或無法存取</span>
                ) : (
                  <span>
                    所屬櫃子：
                    <Link
                      href={`/cabinet/${encodeURIComponent(item.cabinetId)}`}
                      className="text-indigo-300 underline-offset-4 transition hover:text-indigo-200 hover:underline"
                    >
                      {cabinetName ?? "未命名櫃子"}
                    </Link>
                  </span>
                )
              ) : (
                <span>未指定櫃子</span>
              )}
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 text-sm text-slate-300 sm:w-full sm:max-w-xs sm:items-end sm:justify-self-end sm:self-end">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              {primaryLink && (
                <a
                  href={primaryLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${buttonClass({ variant: "secondary" })} detail-action-button w-full sm:w-auto`}
                >
                  點我觀看
                </a>
              )}
              <Link
                href={`/item/${encodeURIComponent(item.id)}/edit`}
                className={`${buttonClass({ variant: "secondary" })} detail-action-button w-full sm:w-auto`}
              >
                編輯物件
              </Link>
            </div>
          </div>
        </header>

        {infoFeedback && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              infoFeedback.type === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            {infoFeedback.message}
          </div>
        )}

        {favoriteError && (
          <div className="rounded-3xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {favoriteError}
          </div>
        )}

        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-start">
            {item.thumbUrl && (
              <div className="relative mx-auto aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 sm:w-48 md:mx-0 md:w-56">
                {canUseOptimizedThumb ? (
                  <Image
                    src={item.thumbUrl}
                    alt={`${item.titleZh} 封面`}
                    fill
                    sizes="(min-width: 768px) 14rem, 100vw"
                    className="object-cover"
                    style={thumbStyle}
                    draggable={false}
                  />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.thumbUrl}
                    alt={`${item.titleZh} 封面`}
                    className="h-full w-full select-none object-cover"
                    style={thumbStyle}
                    loading="lazy"
                    draggable={false}
                  />
                )}
              </div>
            )}
            <div className="flex-1 space-y-6">
              <div className="space-y-2">
                <p className="text-xs text-slate-500">雙擊屬性可快速編輯。</p>
                <div
                  className="cursor-text rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-4 text-slate-200 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                  onDoubleClick={openAttributeEditor}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openAttributeEditor();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  title="雙擊以快速編輯屬性"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">狀態</div>
                      <div className="break-anywhere text-base text-white">{statusLabel}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">評分</div>
                      <div className="break-anywhere text-base text-white">{ratingText}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">作者 / 製作</div>
                      <div className="break-anywhere text-base text-white">
                        {item.author && item.author.trim().length > 0 ? item.author : "未設定"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">更新頻率</div>
                      <div className="break-anywhere text-base text-white">{updateFrequencyLabel}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">下次更新</div>
                      <div className="break-anywhere text-base text-white">{nextUpdateText}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">最後更新時間</div>
                      <div className="break-anywhere text-base text-white">{updatedAtText}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm text-slate-500">建立時間</div>
                      <div className="break-anywhere text-base text-white">{createdAtText}</div>
                    </div>
                  </div>
                </div>
              </div>

              {attributeFeedback && (
                <div
                  className={`break-anywhere rounded-xl px-3 py-2 text-sm ${
                    attributeFeedback.type === "success"
                      ? "bg-emerald-500/10 text-emerald-200"
                      : "bg-rose-500/10 text-rose-200"
                  }`}
                >
                  {attributeFeedback.message}
                </div>
              )}

              {tags.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-slate-500">標籤</div>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      if (!tagLinkBase) {
                        return (
                          <span
                            key={tag}
                            className="break-anywhere rounded-full bg-slate-800/70 px-3 py-1 text-sm text-slate-200"
                          >
                            #{tag}
                          </span>
                        );
                      }
                      const href = `${tagLinkBase}?tag=${encodeURIComponent(tag)}`;
                      return (
                        <Link
                          key={tag}
                          href={href}
                          className="break-anywhere rounded-full bg-slate-800/70 px-3 py-1 text-sm text-slate-200 transition hover:bg-indigo-500/20 hover:text-white"
                        >
                          #{tag}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {links.length > 0 && (
            <div className="mt-8 space-y-2">
              <div className="text-sm text-slate-500">來源連結</div>
              <ul className="space-y-2 text-sm text-indigo-300">
                {links.map((link) => (
                  <li
                    key={`${link.label}-${link.url}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-anywhere underline-offset-4 transition hover:text-indigo-200 hover:underline"
                    >
                      {link.label}
                    </a>
                    {link.isPrimary && (
                      <span className="text-xs text-emerald-200">{`（此為"點我觀看"觸發連結）`}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 space-y-2">
            <div className="text-sm text-slate-500">進度備註</div>
            <div
              className="cursor-text rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              onDoubleClick={() => openQuickEditor("progressNote")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openQuickEditor("progressNote");
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="快速編輯進度備註"
              title="雙擊以快速編輯進度備註"
            >
              {progressNoteText ? (
                <div className="break-anywhere whitespace-pre-wrap">{progressNoteText}</div>
              ) : (
                <span className="text-slate-500">尚未新增進度備註</span>
              )}
            </div>
          </div>

          <div className="mt-8 space-y-2">
            <div className="text-sm text-slate-500">一般備註</div>
            <div
              className="cursor-text rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              onDoubleClick={() => openQuickEditor("note")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openQuickEditor("note");
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="快速編輯一般備註"
              title="雙擊以快速編輯一般備註"
            >
              {generalNoteText ? (
                <div className="break-anywhere whitespace-pre-wrap">{generalNoteText}</div>
              ) : (
                <span className="text-slate-500">尚未新增一般備註</span>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">進度概覽</h2>
              <p className="text-xs text-slate-500">雙擊主進度可快速編輯。</p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => toggleSection("progress")}
                className="h-9 rounded-lg border border-slate-700 px-3 text-sm text-slate-400 transition hover:border-slate-500 hover:text-white"
                aria-expanded={sectionOpen.progress}
              >
                {sectionOpen.progress ? "收合" : "展開"}
              </button>
            </div>
          </div>

          {sectionOpen.progress ? (
            <>
              <div
                className="cursor-text rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 transition hover:border-indigo-500/40 hover:bg-indigo-500/10"
                onDoubleClick={openProgressEditor}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openProgressEditor();
                  }
                }}
                role="button"
                tabIndex={0}
                title="雙擊以快速編輯主進度"
              >
                <div className="text-sm font-medium text-white">主進度</div>
                <div className="break-anywhere text-sm text-slate-200">
                  {progressSummary}
                </div>
              </div>
              {primary?.updatedAt && (
                <div className="text-xs text-slate-500">
                  主進度更新於：{formatDateTime(primary.updatedAt)}
                </div>
              )}
            </>
          ) : null}
          {progressFeedback && (
            <div
              className={`break-anywhere rounded-xl px-3 py-2 text-sm ${
                progressFeedback.type === "success"
                  ? "bg-emerald-500/10 text-emerald-200"
                  : "bg-rose-500/10 text-rose-200"
              }`}
            >
              {progressFeedback.message}
            </div>
          )}
          {progressError && (
            <div className="break-anywhere rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {progressError}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">登場列表</h2>
              <p className="text-sm text-slate-500">依編輯順序列出重要角色、地點或其他物件。</p>
              <p className="text-xs text-slate-500">雙擊項目可快速編輯。</p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => toggleSection("appearances")}
                className="h-9 rounded-lg border border-slate-700 px-3 text-sm text-slate-400 transition hover:border-slate-500 hover:text-white"
                aria-expanded={sectionOpen.appearances}
              >
                {sectionOpen.appearances ? "收合" : "展開"}
              </button>
              <button
                type="button"
                onClick={openAppearanceReorder}
                className={`${buttonClass({ variant: "secondary", size: "sm" })} whitespace-nowrap`}
                disabled={appearanceReorderSaving}
              >
                編輯順序
              </button>
              <button
                type="button"
                onClick={handleAppearanceAdd}
                disabled={appearanceAddPending}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-700 text-xl font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-indigo-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="新增登場項目"
              >
                <span aria-hidden="true">＋</span>
              </button>
            </div>
          </div>
          {appearanceFeedback && (
            <div
              className={`break-anywhere rounded-xl px-3 py-2 text-sm ${
                appearanceFeedback.type === "success"
                  ? "bg-emerald-500/10 text-emerald-200"
                  : "bg-rose-500/10 text-rose-200"
              }`}
            >
              {appearanceFeedback.message}
            </div>
          )}
          {sectionOpen.appearances ? (
            hasAppearances ? (
              <div className="space-y-4">
                {appearances.map((entry, index) => {
                  const appearanceTransform =
                    entry.thumbTransform ?? DEFAULT_THUMB_TRANSFORM;
                  const appearanceStyle = {
                    transform: `translate(${appearanceTransform.offsetX}%, ${appearanceTransform.offsetY}%) scale(${appearanceTransform.scale})`,
                    transformOrigin: "center" as const,
                  };
                  const labels = splitAppearanceLabels(entry.labels ?? "");
                  return (
                    <div
                      key={`${entry.nameZh}-${index}`}
                      className="flex items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 cursor-pointer"
                      onDoubleClick={() => openAppearanceEditor(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openAppearanceEditor(index);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title="雙擊以編輯此登場物件"
                    >
                      {entry.thumbUrl ? (
                        <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-950/60">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={entry.thumbUrl}
                            alt={`${entry.nameZh} 縮圖`}
                            className="h-full w-full select-none object-cover"
                            style={appearanceStyle}
                            loading="lazy"
                            draggable={false}
                          />
                        </div>
                      ) : null}
                      <div className="flex-1 space-y-2">
                        <div className="break-anywhere text-base font-medium text-white">
                          {entry.nameZh}
                        </div>
                        {entry.nameOriginal && (
                          <div className="break-anywhere text-sm text-slate-400">
                            {entry.nameOriginal}
                          </div>
                        )}
                        {labels.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {labels.map((label, labelIndex) => (
                              <span
                                key={`${label}-${labelIndex}`}
                                className="inline-flex items-center rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium text-indigo-200"
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        )}
                        {entry.note && (
                          <div className="break-anywhere whitespace-pre-wrap text-sm text-slate-200">
                            {entry.note}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
                尚未新增登場項目，按右上角加號建立第一筆資料。
              </div>
            )
          ) : null}
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900">心得 / 筆記</h2>
              <p className="text-sm text-slate-500">整理觀後感或紀錄重點，僅於詳細頁面顯示。</p>
              <p className="text-xs text-slate-500">雙擊項目可快速編輯內容。</p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => toggleSection("notes")}
                className="h-9 rounded-lg border border-slate-700 px-3 text-sm text-slate-400 transition hover:border-slate-500 hover:text-white"
                aria-expanded={sectionOpen.notes}
              >
                {sectionOpen.notes ? "收合" : "展開"}
              </button>
              <button
                type="button"
                onClick={openNoteReorder}
                className={`${buttonClass({ variant: "secondary", size: "sm" })} whitespace-nowrap`}
                disabled={noteReorderSaving}
              >
                編輯順序
              </button>
              <button
                type="button"
                onClick={handleNoteAdd}
                disabled={noteAddPending}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-slate-700 text-xl font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-indigo-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="新增心得 / 筆記"
              >
                <span aria-hidden="true">＋</span>
              </button>
            </div>
          </div>
          {noteFeedback && (
            <div
              className={`rounded-xl px-3 py-2 text-sm ${
                noteFeedback.type === "success"
                  ? "bg-emerald-500/10 text-emerald-200"
                  : "bg-rose-500/10 text-rose-200"
              }`}
            >
              {noteFeedback.message}
            </div>
          )}
          {sectionOpen.notes ? (
            hasInsightEntries ? (
              <div className="space-y-3">
                {insightEntries.map((entry, index) => {
                  const title = entry.title.trim();
                  const content = entry.content.trim();
                  const heading = title || `心得 / 筆記 ${index + 1}`;
                  return (
                    <div
                      key={`${heading}-${index}`}
                      className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg transition hover:border-indigo-500/40 hover:bg-indigo-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 cursor-pointer"
                      onDoubleClick={() => openNoteEditor(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openNoteEditor(index);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title="雙擊以編輯此心得 / 筆記"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-slate-500">項目 {index + 1}</div>
                        <div className="break-anywhere text-base font-medium text-white">{heading}</div>
                        {content ? (
                          <div className="whitespace-pre-wrap break-words text-sm text-slate-200">
                            {content}
                          </div>
                        ) : (
                          <div className="text-sm text-slate-500">目前尚未填寫內容。</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-center text-sm text-slate-500">
                尚未新增心得 / 筆記，按右上角加號建立第一筆內容。
              </div>
            )
          ) : null}
        </section>
      </div>

      {attributeEditorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeAttributeEditor}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="attribute-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h2 id="attribute-editor-title" className="text-xl font-semibold text-gray-900">
                編輯屬性
              </h2>
              <p className="text-sm text-gray-500">
                更新後會立即儲存至雲端，並同步更新最後編輯時間。
              </p>
            </div>
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-base">狀態 *</span>
                <select
                  value={attributeDraft.status}
                  onChange={(event) =>
                    setAttributeDraft((prev) => ({
                      ...prev,
                      status: event.target.value as ItemStatus,
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={attributeSaving}
                >
                  {ITEM_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-base">評分 (0-10)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={10}
                  step={0.1}
                  value={attributeDraft.rating}
                  onChange={(event) =>
                    setAttributeDraft((prev) => ({
                      ...prev,
                      rating: event.target.value,
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="選填"
                  disabled={attributeSaving}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-base">作者 / 製作</span>
                <input
                  value={attributeDraft.author}
                  onChange={(event) =>
                    setAttributeDraft((prev) => ({
                      ...prev,
                      author: event.target.value,
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="選填"
                  disabled={attributeSaving}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-base">更新頻率</span>
                <select
                  value={attributeDraft.updateFrequency}
                  onChange={(event) =>
                    setAttributeDraft((prev) => ({
                      ...prev,
                      updateFrequency: event.target.value as UpdateFrequency | "",
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={attributeSaving}
                >
                  <option value="">未設定</option>
                  {UPDATE_FREQUENCY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-base">下次預計更新時間</span>
                <input
                  type="datetime-local"
                  value={attributeDraft.nextUpdateAt}
                  onChange={(event) =>
                    setAttributeDraft((prev) => ({
                      ...prev,
                      nextUpdateAt: event.target.value,
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={attributeSaving}
                />
              </label>
            </div>
            {attributeError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {attributeError}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeAttributeEditor}
                disabled={attributeSaving}
                className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAttributeSave}
                disabled={attributeSaving}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
              >
                {attributeSaving ? "儲存中…" : "儲存變更"}
              </button>
            </div>
          </div>
        </div>
      )}

      {progressEditorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeProgressEditor}
        >
          <div
            className="w-full max-w-lg max-h-[90vh] space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="progress-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h2
                id="progress-editor-title"
                className="text-xl font-semibold text-gray-900"
              >
                編輯主進度
              </h2>
              <p className="text-sm text-gray-500">
                更新後會立即儲存至雲端，並同步更新最後編輯時間。
              </p>
            </div>

            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-base">平台 / 來源 *</span>
                <input
                  value={progressDraft.platform}
                  onChange={(event) =>
                    setProgressDraft((prev) => ({
                      ...prev,
                      platform: event.target.value,
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="例如：漫畫瘋"
                  disabled={progressEditorSaving}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-base">類型 *</span>
                <select
                  value={progressDraft.type}
                  onChange={(event) =>
                    setProgressDraft((prev) => ({
                      ...prev,
                      type: event.target.value as ProgressType,
                    }))
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  disabled={progressEditorSaving}
                >
                  {PROGRESS_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-base">數值 *</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={progressDraft.value}
                    onChange={(event) =>
                      setProgressDraft((prev) => ({
                        ...prev,
                        value: event.target.value,
                      }))
                    }
                    className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="例如：12"
                    disabled={progressEditorSaving}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-base">單位</span>
                  <input
                    value={progressDraft.unit}
                    onChange={(event) =>
                      setProgressDraft((prev) => ({
                        ...prev,
                        unit: event.target.value,
                      }))
                    }
                    className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="話 / 集 / % / 頁"
                    disabled={progressEditorSaving}
                  />
                </label>
              </div>
            </div>

            {progressEditorError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {progressEditorError}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeProgressEditor}
                disabled={progressEditorSaving}
                className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleProgressEditorSubmit}
                disabled={progressEditorSaving}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
              >
                {progressEditorSaving ? "儲存中…" : "儲存變更"}
              </button>
            </div>
          </div>
        </div>
      )}

      {appearanceReorderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeAppearanceReorder}
        >
          <div
            className="w-full max-w-xl space-y-6 rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="appearance-reorder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 id="appearance-reorder-title" className="text-xl font-semibold text-gray-900">
                調整登場順序
              </h2>
              <p className="text-sm text-gray-500">
                點選要調整的項目，再使用下方的上下按鈕調整顯示順序。
              </p>
            </div>
            {appearanceReorderError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {appearanceReorderError}
              </div>
            )}
            <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-2xl border bg-gray-50 p-3">
              {appearanceReorderList.length === 0 ? (
                <p className="text-sm text-gray-500">目前沒有登場項目可調整。</p>
              ) : (
                <ul className="space-y-2">
                  {appearanceReorderList.map((entry, index) => {
                    const isSelected = index === appearanceReorderSelectedIndex;
                    return (
                      <li key={`${entry.nameZh}-${index}`}>
                        <button
                          type="button"
                          onClick={() => setAppearanceReorderSelectedIndex(index)}
                          disabled={appearanceReorderSaving}
                          className={`w-full overflow-hidden rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition ${
                            isSelected
                              ? "border-blue-400 bg-white"
                              : "border-gray-200 bg-white/80 hover:border-blue-200"
                          }`}
                        >
                          <span className="break-anywhere font-medium text-gray-900">
                            {entry.nameZh}
                          </span>
                          {entry.nameOriginal && (
                            <span className="break-anywhere mt-1 block text-xs text-gray-500">
                              {entry.nameOriginal}
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
                  onClick={() => moveAppearanceReorderSelection(-1)}
                  disabled={
                    appearanceReorderSaving || appearanceReorderSelectedIndex <= 0
                  }
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  上移
                </button>
                <button
                  type="button"
                  onClick={() => moveAppearanceReorderSelection(1)}
                  disabled={
                    appearanceReorderSaving ||
                    appearanceReorderSelectedIndex === -1 ||
                    appearanceReorderSelectedIndex === appearanceReorderList.length - 1
                  }
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  下移
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={closeAppearanceReorder}
                  disabled={appearanceReorderSaving}
                  className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAppearanceReorderSave}
                  disabled={
                    appearanceReorderSaving || appearanceReorderList.length === 0
                  }
                  className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                >
                  {appearanceReorderSaving ? "儲存中…" : "儲存順序"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {noteReorderOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeNoteReorder}
        >
          <div
            className="w-full max-w-xl space-y-6 rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-reorder-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 id="note-reorder-title" className="text-xl font-semibold text-gray-900">
                調整心得 / 筆記順序
              </h2>
              <p className="text-sm text-gray-500">點選要調整的項目，再使用下方按鈕調整顯示順序。</p>
            </div>
            {noteReorderError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {noteReorderError}
              </div>
            )}
            <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-2xl border bg-gray-50 p-3">
              {noteReorderList.length === 0 ? (
                <p className="text-sm text-gray-500">目前沒有心得 / 筆記可調整。</p>
              ) : (
                <ul className="space-y-2">
                  {noteReorderList.map((entry, index) => {
                    const isSelected = index === noteReorderSelectedIndex;
                    const title = entry.title.trim();
                    const content = entry.content.trim();
                    const heading = title || content || `心得 / 筆記 ${index + 1}`;
                    return (
                      <li key={`${heading}-${index}`}>
                        <button
                          type="button"
                          onClick={() => setNoteReorderSelectedIndex(index)}
                          disabled={noteReorderSaving}
                          className={`w-full overflow-hidden rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition ${
                            isSelected
                              ? "border-blue-400 bg-white"
                              : "border-gray-200 bg-white/80 hover:border-blue-200"
                          }`}
                        >
                          <span className="break-anywhere font-medium text-gray-900">{heading}</span>
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
                  onClick={() => moveNoteReorderSelection(-1)}
                  disabled={noteReorderSaving || noteReorderSelectedIndex <= 0}
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  上移
                </button>
                <button
                  type="button"
                  onClick={() => moveNoteReorderSelection(1)}
                  disabled={
                    noteReorderSaving ||
                    noteReorderSelectedIndex === -1 ||
                    noteReorderSelectedIndex === noteReorderList.length - 1
                  }
                  className={`${buttonClass({ variant: "secondary" })} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  下移
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={closeNoteReorder}
                  disabled={noteReorderSaving}
                  className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleNoteReorderSave}
                  disabled={noteReorderSaving || noteReorderList.length === 0}
                  className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                >
                  {noteReorderSaving ? "儲存中…" : "儲存順序"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {appearanceEditor && (
        <>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
            onClick={closeAppearanceEditor}
          >
            <div
              className="w-full max-w-xl max-h-[90vh] space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="appearance-editor-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="space-y-2">
                <h2 id="appearance-editor-title" className="text-xl font-semibold text-gray-900">
                  編輯登場物件
                </h2>
                <p className="text-sm text-gray-500">僅更新此列表項目的資訊。</p>
              </div>
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-base">中文名稱</span>
                  <input
                    ref={appearanceNameZhInputRef}
                    value={appearanceEditor.nameZh}
                    onChange={(event) =>
                      setAppearanceEditor((prev) =>
                        prev ? { ...prev, nameZh: event.target.value } : prev
                      )
                    }
                    className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="輸入中文名稱"
                    disabled={appearanceSaving || appearanceDeleting}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-base">原文名稱</span>
                  <input
                    value={appearanceEditor.nameOriginal}
                    onChange={(event) =>
                      setAppearanceEditor((prev) =>
                        prev
                          ? { ...prev, nameOriginal: event.target.value }
                          : prev
                      )
                    }
                    className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="輸入原文名稱"
                    disabled={appearanceSaving || appearanceDeleting}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-base">標籤（以逗號分隔）</span>
                  <input
                    value={appearanceEditor.labels}
                    onChange={(event) =>
                      setAppearanceEditor((prev) =>
                        prev
                          ? { ...prev, labels: event.target.value }
                          : prev
                      )
                    }
                    className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="例如：夥伴, 導師"
                    disabled={appearanceSaving || appearanceDeleting}
                  />
                </label>
                <ThumbLinkField
                  value={appearanceEditor.thumbUrl}
                  onChange={(value) =>
                    setAppearanceEditor((prev) =>
                      prev ? { ...prev, thumbUrl: value } : prev
                    )
                  }
                  disabled={appearanceSaving || appearanceDeleting}
                  onEdit={() => setAppearanceThumbEditorOpen(true)}
                />
                <label className="block space-y-1">
                  <span className="text-base">備註</span>
                  <textarea
                    value={appearanceEditor.note}
                    onChange={(event) =>
                      setAppearanceEditor((prev) =>
                        prev ? { ...prev, note: event.target.value } : prev
                      )
                    }
                    className="h-36 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 shadow-inner focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="補充說明或紀錄"
                    disabled={appearanceSaving || appearanceDeleting}
                  />
                </label>
              </div>
              {appearanceError && (
                <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {appearanceError}
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => handleAppearanceDelete(appearanceEditor.index)}
                  disabled={appearanceSaving || appearanceDeleting}
                  className={`${buttonClass({ variant: "outlineDanger" })} w-full sm:w-auto`}
                >
                  {appearanceDeleting ? "移除中…" : "移除"}
                </button>
                <button
                  type="button"
                  onClick={closeAppearanceEditor}
                  disabled={appearanceSaving || appearanceDeleting}
                  className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAppearanceSave}
                  disabled={appearanceSaving || appearanceDeleting}
                  className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                >
                  {appearanceSaving ? "儲存中…" : "儲存變更"}
                </button>
              </div>
            </div>
          </div>
          <ThumbEditorDialog
            open={
              appearanceThumbEditorOpen &&
              appearanceEditor.thumbUrl.trim().length > 0
            }
            imageUrl={appearanceEditor.thumbUrl.trim()}
            value={appearanceEditor.thumbTransform}
            onClose={() => setAppearanceThumbEditorOpen(false)}
            onApply={(next) => {
              setAppearanceEditor((prev) =>
                prev ? { ...prev, thumbTransform: clampThumbTransform(next) } : prev
              );
              setAppearanceThumbEditorOpen(false);
            }}
          />
        </>
      )}

      {noteEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeNoteEditor}
        >
          <div
            className="w-full max-w-xl max-h-[90vh] space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h2 id="note-editor-title" className="text-xl font-semibold text-gray-900">
                編輯心得 / 筆記
              </h2>
              <p className="text-sm text-gray-500">更新後會立即儲存至雲端。</p>
            </div>
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="text-base">標題</span>
                <input
                  value={noteEditor.title}
                  onChange={(event) =>
                    setNoteEditor((prev) =>
                      prev ? { ...prev, title: event.target.value } : prev
                    )
                  }
                  className="h-12 w-full rounded-xl border border-gray-200 px-4 text-base text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="為此心得取一個標題（選填）"
                  disabled={noteSaving || noteDeleting}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-base">內容 *</span>
                <textarea
                  ref={noteTextareaRef}
                  value={noteEditor.content}
                  onChange={(event) =>
                    setNoteEditor((prev) =>
                      prev ? { ...prev, content: event.target.value } : prev
                    )
                  }
                  className="h-48 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-900 shadow-inner focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="輸入你的心得或筆記…"
                  disabled={noteSaving || noteDeleting}
                />
              </label>
            </div>
            {noteError && (
              <div className="break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{noteError}</div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => handleNoteDelete(noteEditor.index)}
                disabled={noteSaving || noteDeleting}
                className={`${buttonClass({ variant: "outlineDanger" })} w-full sm:w-auto`}
              >
                {noteDeleting ? "移除中…" : "移除"}
              </button>
              <button
                type="button"
                onClick={closeNoteEditor}
                disabled={noteSaving || noteDeleting}
                className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleNoteSave}
                disabled={noteSaving || noteDeleting}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
              >
                {noteSaving ? "儲存中…" : "儲存內容"}
              </button>
            </div>
          </div>
        </div>
      )}

      {quickEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
          onClick={closeQuickEditor}
        >
          <div
            className="w-full max-w-lg space-y-5 rounded-2xl border border-slate-700 bg-slate-950 p-6 text-slate-200 shadow-2xl shadow-black/60"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-editor-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-2">
              <h2 id="quick-editor-title" className="text-xl font-semibold text-white">
                快速編輯 {quickEditConfig[quickEditor.field].label}
              </h2>
              <p className="text-sm text-slate-500">
                更新後會立即儲存至雲端，並同步更新最後編輯時間。
              </p>
            </div>
            <div>
              {quickEditConfig[quickEditor.field].multiline ? (
                <textarea
                  ref={quickEditorInputRef as RefObject<HTMLTextAreaElement>}
                  value={quickEditor.value}
                  onChange={(event) => handleQuickEditorChange(event.target.value)}
                  rows={6}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  placeholder={quickEditConfig[quickEditor.field].placeholder}
                  disabled={quickEditorSaving}
                />
              ) : (
                <input
                  ref={quickEditorInputRef as RefObject<HTMLInputElement>}
                  value={quickEditor.value}
                  onChange={(event) => handleQuickEditorChange(event.target.value)}
                  className="h-12 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 text-base text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  placeholder={quickEditConfig[quickEditor.field].placeholder}
                  disabled={quickEditorSaving}
                />
              )}
            </div>

            {quickEditorError && (
              <div className="break-anywhere rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {quickEditorError}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeQuickEditor}
                disabled={quickEditorSaving}
                className={`${buttonClass({ variant: "subtle" })} w-full sm:w-auto`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleQuickEditorSave}
                disabled={quickEditorSaving}
                className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
              >
                {quickEditorSaving ? "儲存中…" : "儲存變更"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
