"use client";

import Link from "next/link";
import {
  DragEvent,
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import ThumbLinkField from "./ThumbLinkField";
import ProgressEditor from "./ProgressEditor";
import {
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_VALUES,
  UPDATE_FREQUENCY_OPTIONS,
  UPDATE_FREQUENCY_VALUES,
  type ItemStatus,
  type UpdateFrequency,
} from "@/lib/types";
import {
  parseItemForm,
  ValidationError,
  type AppearanceFormData,
  type ItemFormData,
} from "@/lib/validators";
import { deleteItemWithProgress } from "@/lib/firestore-utils";

type CabinetOption = { id: string; name: string };
type LinkState = { label: string; url: string; isPrimary: boolean };

type AppearanceState = {
  id: string;
  name: string;
  thumbUrl: string;
  note: string;
};

type SectionKey =
  | "basic"
  | "links"
  | "mediaNotes"
  | "appearances"
  | "insight"
  | "status"
  | "progressManager"
  | "dangerZone";

function generateLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

function mapFirestoreAppearances(value: unknown): AppearanceState[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as { name?: unknown; thumbUrl?: unknown; note?: unknown };
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const thumbUrl =
        typeof record.thumbUrl === "string" ? record.thumbUrl.trim() : "";
      const note = typeof record.note === "string" ? record.note.trim() : "";
      if (!name && !thumbUrl && !note) {
        return null;
      }
      return {
        id: generateLocalId(),
        name,
        thumbUrl,
        note,
      } satisfies AppearanceState;
    })
    .filter((entry): entry is AppearanceState => Boolean(entry));
}

function mapFormAppearances(list: AppearanceFormData[]): AppearanceState[] {
  return list.map((entry) => ({
    id: generateLocalId(),
    name: entry.name,
    thumbUrl: entry.thumbUrl ?? "",
    note: entry.note ?? "",
  }));
}

function normalizePrimaryLinks(list: LinkState[]): LinkState[] {
  if (list.length === 0) {
    return list;
  }
  let primaryFound = false;
  const normalized = list.map((link) => {
    if (link.isPrimary && !primaryFound) {
      primaryFound = true;
      return { ...link, isPrimary: true };
    }
    return { ...link, isPrimary: false };
  });
  if (!primaryFound) {
    normalized[0] = { ...normalized[0], isPrimary: true };
  }
  return normalized;
}

type ItemFormState = {
  cabinetId: string;
  titleZh: string;
  titleAlt: string;
  author: string;
  selectedTags: string[];
  progressNote: string;
  insightNote: string;
  note: string;
  rating: string;
  status: ItemStatus;
  updateFrequency: UpdateFrequency | "";
  nextUpdateAt: string;
  thumbUrl: string;
};

type ItemFormProps = {
  itemId?: string;
  initialCabinetId?: string;
};

function createDefaultState(initialCabinetId?: string): ItemFormState {
  return {
    cabinetId: initialCabinetId ?? "",
    titleZh: "",
    titleAlt: "",
    author: "",
    selectedTags: [],
    progressNote: "",
    insightNote: "",
    note: "",
    rating: "",
    status: "planning",
    updateFrequency: "",
    nextUpdateAt: "",
    thumbUrl: "",
  };
}

export default function ItemForm({ itemId, initialCabinetId }: ItemFormProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [cabinets, setCabinets] = useState<CabinetOption[]>([]);
  const [form, setForm] = useState<ItemFormState>(() =>
    createDefaultState(initialCabinetId)
  );
  const [links, setLinks] = useState<LinkState[]>([]);
  const [appearances, setAppearances] = useState<AppearanceState[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(itemId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cabinetTags, setCabinetTags] = useState<string[]>([]);
  const [draggingAppearanceIndex, setDraggingAppearanceIndex] = useState<number | null>(
    null
  );
  const [sectionOpen, setSectionOpen] = useState<Record<SectionKey, boolean>>({
    basic: true,
    links: true,
    mediaNotes: true,
    appearances: true,
    insight: true,
    status: true,
    progressManager: true,
    dangerZone: true,
  });
  const previousCabinetIdRef = useRef<string | null>(null);

  const mode = itemId ? "edit" : "create";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setCabinets([]);
      return;
    }
    const q = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    const unSub = onSnapshot(
      q,
      (snap) => {
        const rows: CabinetOption[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data();
            const createdAt = data?.createdAt;
            const createdMs =
              createdAt instanceof Timestamp ? createdAt.toMillis() : 0;
            return {
              id: docSnap.id,
              name: (data?.name as string) ?? "",
              createdMs,
            };
          })
          .sort((a, b) => b.createdMs - a.createdMs)
          .map((item) => ({ id: item.id, name: item.name }));
        setCabinets(rows);
      },
      () => {
        setError("載入櫃子清單時發生錯誤");
      }
    );
    return () => unSub();
  }, [user]);

  useEffect(() => {
    if (!form.cabinetId && cabinets.length > 0) {
      setForm((prev) => ({ ...prev, cabinetId: cabinets[0].id }));
    }
  }, [cabinets, form.cabinetId]);

  useEffect(() => {
    if (!user || !itemId) return;
    let active = true;
    setLoading(true);
    getDoc(doc(db, "item", itemId))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setError("找不到物件資料");
          return;
        }
        const data = snap.data();
        if (!data) {
          setError("物件資料格式錯誤");
          return;
        }
        if (data.uid !== user.uid) {
          setError("您沒有存取此物件的權限");
          return;
        }
        const status =
          typeof data.status === "string" &&
          ITEM_STATUS_VALUES.includes(data.status as ItemStatus)
            ? (data.status as ItemStatus)
            : "planning";
        const updateFrequency =
          typeof data.updateFrequency === "string" &&
          UPDATE_FREQUENCY_VALUES.includes(
            data.updateFrequency as UpdateFrequency
          )
            ? (data.updateFrequency as UpdateFrequency)
            : "";
        const ratingValue =
          typeof data.rating === "number" && Number.isFinite(data.rating)
            ? String(data.rating)
            : "";
        const loadedTags = Array.isArray(data.tags)
          ? Array.from(
              new Set(
                data.tags
                  .map((tag: unknown) => String(tag ?? "").trim())
                  .filter((tag: string) => tag.length > 0)
              )
            )
          : [];
        const loadedAppearances = mapFirestoreAppearances(data.appearances);

        setForm({
          cabinetId: (data.cabinetId as string) ?? "",
          titleZh: (data.titleZh as string) ?? "",
          titleAlt: (data.titleAlt as string) ?? "",
          author: (data.author as string) ?? "",
          selectedTags: loadedTags,
          progressNote: (data.progressNote as string) ?? "",
          insightNote: (data.insightNote as string) ?? "",
          note: (data.note as string) ?? "",
          rating: ratingValue,
          status,
          updateFrequency,
          nextUpdateAt:
            data.nextUpdateAt instanceof Timestamp
              ? formatTimestampToInput(data.nextUpdateAt)
              : "",
          thumbUrl: (data.thumbUrl as string) ?? "",
        });
        setLinks(
          Array.isArray(data.links)
            ? normalizePrimaryLinks(
                data.links.map((link: unknown) => {
                  const record = link as {
                    label?: unknown;
                    url?: unknown;
                    isPrimary?: unknown;
                  };
                  return {
                    label: typeof record?.label === "string" ? record.label : "",
                    url: typeof record?.url === "string" ? record.url : "",
                    isPrimary: Boolean(record?.isPrimary),
                  };
                })
              )
            : []
        );
        setAppearances(loadedAppearances);
      })
      .catch(() => {
        if (!active) return;
        setError("載入物件資料時發生錯誤");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, itemId]);

  useEffect(() => {
    setDeleteError(null);
    setDeleting(false);
  }, [itemId]);

  useEffect(() => {
    const previousCabinetId = previousCabinetIdRef.current;
    if (previousCabinetId && previousCabinetId !== form.cabinetId) {
      setForm((prev) => ({ ...prev, selectedTags: [] }));
    }
    previousCabinetIdRef.current = form.cabinetId;
  }, [form.cabinetId]);

  useEffect(() => {
    if (!form.cabinetId) {
      setCabinetTags([]);
      return;
    }
    const cabinetRef = doc(db, "cabinet", form.cabinetId);
    const unsub = onSnapshot(
      cabinetRef,
      (snap) => {
        if (!snap.exists()) {
          setCabinetTags([]);
          return;
        }
        const data = snap.data();
        const tags = Array.isArray(data?.tags)
          ? Array.from(
              new Set(
                data.tags
                  .map((tag: unknown) => String(tag ?? "").trim())
                  .filter((tag: string) => tag.length > 0)
              )
            ).sort((a, b) => a.localeCompare(b, "zh-Hant"))
          : [];
        setCabinetTags(tags);
      },
      () => {
        setCabinetTags([]);
      }
    );
    return () => unsub();
  }, [form.cabinetId]);

  const cabinetOptions = useMemo(() => cabinets, [cabinets]);

  const baseSectionClass =
    "rounded-3xl border border-gray-100 bg-white/90 p-6 shadow-sm";

  const toggleSection = (key: SectionKey) => {
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const CollapsibleSection = ({
    sectionKey,
    title,
    children,
    actions,
    containerClass,
    contentClass,
    titleClass,
  }: {
    sectionKey: SectionKey;
    title: string;
    children: ReactNode;
    actions?: ReactNode;
    containerClass?: string;
    contentClass?: string;
    titleClass?: string;
  }) => {
    const isOpen = sectionOpen[sectionKey];
    const contentId = `${sectionKey}-content`;
    return (
      <section
        className={`${baseSectionClass} ${containerClass ?? ""}`.trim()}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => toggleSection(sectionKey)}
            className="flex flex-1 items-center justify-between gap-3 text-left"
            aria-expanded={isOpen}
            aria-controls={contentId}
          >
            <span className={`text-xl font-semibold ${titleClass ?? "text-gray-900"}`}>
              {title}
            </span>
            <span
              aria-hidden
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-transform ${
                isOpen ? "rotate-180" : ""
              }`}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 8l5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        {isOpen ? (
          <div id={contentId} className={`mt-6 ${contentClass ?? "space-y-6"}`}>
            {children}
          </div>
        ) : null}
      </section>
    );
  };

  if (!authChecked) {
    return (
      <main className="min-h-[100dvh] p-6">
        <p className="text-base">載入中…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-[100dvh] p-6 space-y-4">
        <h1 className="text-2xl font-semibold">{mode === "edit" ? "編輯物件" : "新增物件"}</h1>
        <p className="text-base">
          未登入。請前往
          <a href="/login" className="ml-1 underline">
            /login
          </a>
        </p>
      </main>
    );
  }

  if (mode === "edit" && loading) {
    return (
      <main className="min-h-[100dvh] p-6">
        <p className="text-base">正在載入物件資料…</p>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setError("");
    setMessage("");

    const allowedTags = new Set(cabinetTags);
    const tags = Array.from(
      new Set(
        form.selectedTags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .filter((tag) => allowedTags.size === 0 || allowedTags.has(tag))
      )
    );

    const normalizedLinks = links.map((link) => ({
      label: link.label.trim(),
      url: link.url.trim(),
      isPrimary: link.isPrimary,
    }));

    const hasHalfFilled = normalizedLinks.some(
      (link) => (link.label && !link.url) || (!link.label && link.url)
    );
    if (hasHalfFilled) {
      setSaving(false);
      setError("連結需同時填寫標籤與網址");
      return;
    }

    let filteredLinks = normalizedLinks.filter(
      (link) => link.label && link.url
    );

    if (filteredLinks.length > 0) {
      let hasPrimary = false;
      filteredLinks = filteredLinks.map((link) => {
        if (link.isPrimary && !hasPrimary) {
          hasPrimary = true;
          return { ...link, isPrimary: true };
        }
        return { ...link, isPrimary: false };
      });
      if (!hasPrimary) {
        filteredLinks[0] = { ...filteredLinks[0], isPrimary: true };
      }
    }

    let nextUpdateDate: Date | undefined;
    if (form.nextUpdateAt) {
      const parsed = new Date(form.nextUpdateAt);
      if (Number.isNaN(parsed.getTime())) {
        setSaving(false);
        setError("下次更新時間格式錯誤");
        return;
      }
      nextUpdateDate = parsed;
    }

    const appearancePayload = appearances.map((entry) => ({
      name: entry.name,
      thumbUrl: entry.thumbUrl,
      note: entry.note,
    }));

    try {
      const parsedData: ItemFormData = parseItemForm({
        cabinetId: form.cabinetId,
        titleZh: form.titleZh,
        titleAlt: form.titleAlt,
        author: form.author,
        tags,
        links: filteredLinks,
        thumbUrl: form.thumbUrl,
        progressNote: form.progressNote,
        insightNote: form.insightNote,
        note: form.note,
        appearances: appearancePayload,
        rating: form.rating ? Number(form.rating) : undefined,
        status: form.status,
        updateFrequency: form.updateFrequency ? form.updateFrequency : null,
        nextUpdateAt: nextUpdateDate,
      });

      const docData: Record<string, unknown> = {
        uid: user.uid,
        cabinetId: parsedData.cabinetId,
        titleZh: parsedData.titleZh,
        titleAlt: parsedData.titleAlt ?? null,
        author: parsedData.author ?? null,
        tags: parsedData.tags,
        links: parsedData.links,
        thumbUrl: parsedData.thumbUrl ?? null,
        progressNote: parsedData.progressNote ?? null,
        insightNote: parsedData.insightNote ?? null,
        note: parsedData.note ?? null,
        appearances: parsedData.appearances.map((entry) => ({
          name: entry.name,
          thumbUrl: entry.thumbUrl ?? null,
          note: entry.note ?? null,
        })),
        rating:
          parsedData.rating !== undefined ? parsedData.rating : null,
        status: parsedData.status,
        updateFrequency: parsedData.updateFrequency,
        nextUpdateAt: parsedData.nextUpdateAt
          ? Timestamp.fromDate(parsedData.nextUpdateAt)
          : null,
        updatedAt: serverTimestamp(),
      };

      if (mode === "edit" && itemId) {
        await updateDoc(doc(db, "item", itemId), docData);
        setMessage("已儲存");
      } else {
        const docRef = await addDoc(collection(db, "item"), {
          ...docData,
          createdAt: serverTimestamp(),
        });
        setMessage("已建立，已自動切換至編輯頁面");
        router.replace(`/item/${docRef.id}/edit`);
      }

      setForm((prev) => ({
        ...prev,
        cabinetId: parsedData.cabinetId,
        titleZh: parsedData.titleZh,
        titleAlt: parsedData.titleAlt ?? "",
        author: parsedData.author ?? "",
        selectedTags: parsedData.tags,
        progressNote: parsedData.progressNote ?? "",
        insightNote: parsedData.insightNote ?? "",
        note: parsedData.note ?? "",
        rating:
          parsedData.rating !== undefined
            ? String(parsedData.rating)
            : "",
        status: parsedData.status,
        updateFrequency: parsedData.updateFrequency ?? "",
        nextUpdateAt: parsedData.nextUpdateAt
          ? formatDateToInput(parsedData.nextUpdateAt)
          : "",
        thumbUrl: parsedData.thumbUrl ?? "",
      }));
      setLinks(
        normalizePrimaryLinks(
          parsedData.links.map((link) => ({
            label: link.label,
            url: link.url,
            isPrimary: Boolean(link.isPrimary),
          }))
        )
      );
      setAppearances(mapFormAppearances(parsedData.appearances));
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message);
      } else {
        setError("儲存時發生錯誤");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!itemId || !user || deleting) {
      return;
    }
    if (
      !window.confirm("確認刪除此物件？會一併刪除相關進度資料，且無法復原。")
    ) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteItemWithProgress(itemId, user.uid);
      router.replace("/cabinets");
    } catch (err) {
      console.error("刪除物件失敗", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "刪除物件時發生錯誤";
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  }

  function toggleTag(tag: string) {
    setForm((prev) => {
      const exists = prev.selectedTags.includes(tag);
      return {
        ...prev,
        selectedTags: exists
          ? prev.selectedTags.filter((item) => item !== tag)
          : [...prev.selectedTags, tag],
      };
    });
  }

  function handleAddAppearance() {
    setAppearances((prev) => [
      ...prev,
      { id: generateLocalId(), name: "", thumbUrl: "", note: "" },
    ]);
  }

  function handleAppearanceChange(
    index: number,
    field: "name" | "thumbUrl" | "note",
    value: string
  ) {
    setAppearances((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  }

  function handleRemoveAppearance(index: number) {
    setAppearances((prev) => prev.filter((_, idx) => idx !== index));
    setDraggingAppearanceIndex(null);
  }

  function handleAppearanceDrop(
    event: DragEvent<HTMLDivElement>,
    targetIndex: number
  ) {
    event.preventDefault();
    event.stopPropagation();
    const sourceIndex = draggingAppearanceIndex;
    if (sourceIndex === null) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const shouldPlaceAfter =
      event.clientY > bounds.top + bounds.height / 2;

    setAppearances((prev) => {
      if (
        sourceIndex < 0 ||
        sourceIndex >= prev.length ||
        targetIndex < 0 ||
        targetIndex >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      let insertionIndex = shouldPlaceAfter ? targetIndex + 1 : targetIndex;
      if (insertionIndex > next.length) {
        insertionIndex = next.length;
      }
      if (sourceIndex < insertionIndex) {
        insertionIndex -= 1;
      }
      next.splice(insertionIndex, 0, moved);
      return next;
    });
    setDraggingAppearanceIndex(null);
  }

  function handleAppearanceDropToEnd(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (draggingAppearanceIndex === null) {
      return;
    }
    const sourceIndex = draggingAppearanceIndex;
    setAppearances((prev) => {
      if (sourceIndex < 0 || sourceIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.push(moved);
      return next;
    });
    setDraggingAppearanceIndex(null);
  }

  const inputClass = "h-12 w-full rounded-xl border px-4 text-base";
  const textAreaClass = "min-h-[100px] w-full rounded-xl border px-4 py-3 text-base";

  return (
    <main className="min-h-[100dvh] bg-gradient-to-br from-gray-50 via-white to-gray-100 px-4 py-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-gray-900">
                {mode === "edit" ? "編輯物件" : "新增物件"}
              </h1>
              <p className="text-sm text-gray-500">
                可只填寫中文標題後儲存，其他欄位日後再補。
              </p>
              {cabinets.length === 0 && (
                <p className="text-sm text-red-600">
                  尚未建立櫃子，請先於「櫃子」頁面建立後再新增物件。
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              {mode === "edit" && itemId && (
                <Link
                  href={`/item/${itemId}`}
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
                >
                  查看詳細頁面
                </Link>
              )}
              {mode === "edit" && form.cabinetId && (
                <Link
                  href={`/cabinet/${form.cabinetId}`}
                  className="rounded-full border border-gray-200 bg-white px-4 py-2 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
                >
                  檢視櫃子內容
                </Link>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <CollapsibleSection sectionKey="basic" title="基本資訊">
              <div className="space-y-1">
                <label className="text-base">所屬櫃子</label>
                <select
                  value={form.cabinetId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, cabinetId: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">選擇櫃子</option>
                  {cabinetOptions.map((cabinet) => (
                    <option key={cabinet.id} value={cabinet.id}>
                      {cabinet.name || "未命名"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-base">中文標題 *</label>
                <input
                  value={form.titleZh}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, titleZh: e.target.value }))
                  }
                  placeholder="作品中文名稱"
                  className={inputClass}
                  required
                />
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-base">原文/其他標題</span>
                  <input
                    value={form.titleAlt}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, titleAlt: e.target.value }))
                    }
                    placeholder="選填"
                    className={inputClass}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-base">作者 / 製作</span>
                  <input
                    value={form.author}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, author: e.target.value }))
                    }
                    placeholder="選填"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base">標籤</span>
                  {form.cabinetId && (
                    <Link
                      href={`/cabinet/${encodeURIComponent(form.cabinetId)}/edit#tag-manager`}
                      className="text-xs text-blue-600 underline-offset-4 hover:underline"
                    >
                      管理標籤
                    </Link>
                  )}
                </div>
                {cabinetTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {cabinetTags.map((tag) => {
                      const selected = form.selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className={`rounded-full border px-3 py-1 text-sm transition ${
                            selected
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                          }`}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                ) : form.cabinetId ? (
                  <p className="rounded-xl border border-dashed border-gray-200 bg-white/70 px-4 py-4 text-sm text-gray-500">
                    此櫃尚未建立標籤，請先前往標籤管理新增。
                  </p>
                ) : (
                  <p className="rounded-xl border border-dashed border-gray-200 bg-white/70 px-4 py-4 text-sm text-gray-500">
                    請先選擇櫃子以載入標籤。
                  </p>
                )}
                {form.selectedTags.some((tag) => !cabinetTags.includes(tag)) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                    有部分標籤已於此櫃的標籤管理中移除，儲存時將自動忽略。
                  </div>
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              sectionKey="links"
              title="來源連結"
              actions={
                <button
                  type="button"
                  onClick={() =>
                    setLinks((prev) =>
                      normalizePrimaryLinks([
                        ...prev,
                        { label: "", url: "", isPrimary: prev.length === 0 },
                      ])
                    )
                  }
                  className="h-10 rounded-lg border px-3 text-sm text-gray-700 transition hover:border-gray-300"
                >
                  新增連結
                </button>
              }
              contentClass="space-y-4"
            >
              {links.length === 0 && (
                <p className="text-sm text-gray-500">目前尚未新增連結。</p>
              )}
              <div className="space-y-3">
                {links.map((link, index) => (
                  <div
                    key={index}
                    className="space-y-3 rounded-xl border bg-white/80 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <label className="flex-1 space-y-1">
                        <span className="text-sm text-gray-600">標籤</span>
                        <input
                          value={link.label}
                          onChange={(e) => {
                            const value = e.target.value;
                            setLinks((prev) =>
                              prev.map((item, idx) =>
                                idx === index ? { ...item, label: value } : item
                              )
                            );
                          }}
                          className={inputClass}
                          placeholder="例如：官方網站"
                        />
                      </label>
                      <label className="flex-1 space-y-1">
                        <span className="text-sm text-gray-600">網址</span>
                        <input
                          value={link.url}
                          onChange={(e) => {
                            const value = e.target.value;
                            setLinks((prev) =>
                              prev.map((item, idx) =>
                                idx === index ? { ...item, url: value } : item
                              )
                            );
                          }}
                          className={inputClass}
                          placeholder="https://"
                        />
                      </label>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                          type="radio"
                          name="primary-link"
                          checked={link.isPrimary}
                          onChange={() =>
                            setLinks((prev) =>
                              prev.map((item, idx) => ({
                                ...item,
                                isPrimary: idx === index,
                              }))
                            )
                          }
                          className="h-4 w-4"
                        />
                        <span>作為「點我觀看」按鈕</span>
                      </label>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setLinks((prev) => {
                              const next = prev.filter((_, idx) => idx !== index);
                              if (next.length > 0) {
                                return normalizePrimaryLinks(next);
                              }
                              return next;
                            })
                          }
                          className="h-10 rounded-lg border px-3 text-sm text-red-600 transition hover:border-red-200"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            <CollapsibleSection sectionKey="mediaNotes" title="縮圖與備註">
              <ThumbLinkField
                value={form.thumbUrl}
                onChange={(value) => setForm((prev) => ({ ...prev, thumbUrl: value }))}
              />

              <div className="space-y-1">
                <label className="text-base">進度備註</label>
                <textarea
                  value={form.progressNote}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, progressNote: e.target.value }))
                  }
                  className={textAreaClass}
                  placeholder="例如：更新到最新話"
                />
              </div>
              <div className="space-y-1">
                <label className="text-base">一般備註</label>
                <textarea
                  value={form.note}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, note: e.target.value }))
                  }
                  className={textAreaClass}
                  placeholder="自由填寫"
                />
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              sectionKey="appearances"
              title="登場列表"
              actions={
                <button
                  type="button"
                  onClick={handleAddAppearance}
                  className="h-10 rounded-lg border px-3 text-sm text-gray-700 transition hover:border-gray-300"
                >
                  新增登場物件
                </button>
              }
              contentClass="space-y-4"
            >
              <p className="text-sm text-gray-500">
                新增角色、地點或專有名詞資訊，可拖曳左側手把調整顯示順序，新增的項目會放在列表底部。
              </p>
              {appearances.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-200 bg-white/60 px-4 py-4 text-center text-sm text-gray-500">
                  目前尚未新增登場物件。
                </p>
              ) : (
                <div
                  className="space-y-3"
                  onDragOver={(event) => {
                    if (draggingAppearanceIndex !== null) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={handleAppearanceDropToEnd}
                >
                  {appearances.map((appearance, index) => {
                    const isDragging = draggingAppearanceIndex === index;
                    return (
                      <div
                        key={appearance.id}
                        onDragOver={(event) => {
                          if (draggingAppearanceIndex !== null) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                          }
                        }}
                        onDrop={(event) => handleAppearanceDrop(event, index)}
                        className={`space-y-3 rounded-2xl border bg-white/80 p-4 shadow-sm transition ${
                          isDragging
                            ? "border-blue-300 bg-blue-50/60"
                            : "border-gray-200 hover:border-blue-200"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <div
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", String(index));
                                setDraggingAppearanceIndex(index);
                              }}
                              onDragEnd={() => setDraggingAppearanceIndex(null)}
                              className="flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm active:cursor-grabbing"
                              aria-label="拖曳以調整順序"
                              title="拖曳以調整順序"
                            >
                              <span className="text-base leading-none">≡</span>
                            </div>
                            <span>項目 {index + 1}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveAppearance(index)}
                            className="h-9 rounded-lg border px-3 text-sm text-red-600 transition hover:border-red-200"
                          >
                            移除
                          </button>
                        </div>
                        <label className="space-y-1">
                          <span className="text-sm text-gray-600">名稱 *</span>
                          <input
                            value={appearance.name}
                            onChange={(e) =>
                              handleAppearanceChange(index, "name", e.target.value)
                            }
                            className={inputClass}
                            placeholder="例如：主角名稱"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-sm text-gray-600">縮圖連結</span>
                          <input
                            value={appearance.thumbUrl}
                            onChange={(e) =>
                              handleAppearanceChange(index, "thumbUrl", e.target.value)
                            }
                            className={inputClass}
                            placeholder="https://"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-sm text-gray-600">備註</span>
                          <textarea
                            value={appearance.note}
                            onChange={(e) =>
                              handleAppearanceChange(index, "note", e.target.value)
                            }
                            className="min-h-[100px] w-full rounded-xl border px-4 py-3 text-base"
                            placeholder="補充相關背景或描述"
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </CollapsibleSection>

            <CollapsibleSection
              sectionKey="insight"
              title="心得 / 筆記"
              containerClass="border-2 border-amber-200 bg-amber-50/60"
              titleClass="text-amber-800"
              contentClass="space-y-3"
            >
              <p className="text-sm text-amber-700">
                以更自由的篇幅整理觀後感、推薦理由或紀錄重點，僅於詳細頁面顯示。
              </p>
              <textarea
                value={form.insightNote}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, insightNote: e.target.value }))
                }
                className="min-h-[220px] w-full rounded-2xl border border-amber-200 bg-white/90 px-4 py-4 text-base leading-relaxed text-gray-900 shadow-inner focus:border-amber-300 focus:outline-none"
                placeholder="分享一些觀後感、推薦理由等"
                aria-label="心得 / 筆記"
              />
            </CollapsibleSection>

            <CollapsibleSection sectionKey="status" title="狀態與更新">
              <div className="grid gap-6 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-base">評分 (0-10)</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={form.rating}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, rating: e.target.value }))
                    }
                    placeholder="選填"
                    className={inputClass}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-base">狀態</span>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, status: e.target.value as ItemStatus }))
                    }
                    className={inputClass}
                  >
                    {ITEM_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-base">更新頻率</span>
                  <select
                    value={form.updateFrequency}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        updateFrequency: e.target.value as UpdateFrequency | "",
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="">未設定</option>
                    {UPDATE_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-base">下次預計更新時間</span>
                  <input
                    type="datetime-local"
                    value={form.nextUpdateAt}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, nextUpdateAt: e.target.value }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
            </CollapsibleSection>

            <button
              type="submit"
              className="h-12 w-full rounded-xl bg-black text-base text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300"
              disabled={saving || cabinets.length === 0}
            >
              {saving ? "儲存中…" : mode === "edit" ? "儲存變更" : "建立物件"}
            </button>
          </form>
        </section>

        {mode === "edit" && itemId ? (
          <>
            <CollapsibleSection
              sectionKey="progressManager"
              title="進度管理"
              contentClass="space-y-4"
            >
              <p className="text-sm text-gray-500">
                可於此管理多平台進度，並設定主進度供列表顯示與一鍵 +1。
              </p>
              <ProgressEditor itemId={itemId} />
            </CollapsibleSection>
            <CollapsibleSection
              sectionKey="dangerZone"
              title="刪除物件"
              containerClass="border-red-100 bg-red-50/80"
              titleClass="text-red-700"
              contentClass="space-y-4"
            >
              <p className="text-sm text-red-600">
                刪除後將移除此物件及所有進度記錄，操作無法復原。
              </p>
              {deleteError && (
                <div className="rounded-xl bg-red-100 px-4 py-3 text-sm text-red-700">
                  {deleteError}
                </div>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-red-600 px-6 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
              >
                {deleting ? "刪除中…" : "永久刪除此物件"}
              </button>
            </CollapsibleSection>
          </>
        ) : null}
      </div>
    </main>
  );
}

function formatTimestampToInput(timestamp: Timestamp): string {
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
