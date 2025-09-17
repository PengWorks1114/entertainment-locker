"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
  type ItemFormData,
} from "@/lib/validators";

type CabinetOption = { id: string; name: string };
type LinkState = { label: string; url: string };

type ItemFormState = {
  cabinetId: string;
  titleZh: string;
  titleAlt: string;
  author: string;
  tagsText: string;
  progressNote: string;
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
    tagsText: "",
    progressNote: "",
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(itemId));
  const [saving, setSaving] = useState(false);

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
        setForm({
          cabinetId: (data.cabinetId as string) ?? "",
          titleZh: (data.titleZh as string) ?? "",
          titleAlt: (data.titleAlt as string) ?? "",
          author: (data.author as string) ?? "",
          tagsText: Array.isArray(data.tags)
            ? data.tags.map((tag: unknown) => String(tag ?? "")).join("\n")
            : "",
          progressNote: (data.progressNote as string) ?? "",
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
            ? data.links.map((link: unknown) => {
                const record = link as { label?: unknown; url?: unknown };
                return {
                  label: typeof record?.label === "string" ? record.label : "",
                  url: typeof record?.url === "string" ? record.url : "",
                };
              })
            : []
        );
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

  const cabinetOptions = useMemo(() => cabinets, [cabinets]);

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

    const tags = form.tagsText
      .split(/[\n,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);

    const normalizedLinks = links.map((link) => ({
      label: link.label.trim(),
      url: link.url.trim(),
    }));

    const hasHalfFilled = normalizedLinks.some(
      (link) => (link.label && !link.url) || (!link.label && link.url)
    );
    if (hasHalfFilled) {
      setSaving(false);
      setError("連結需同時填寫標籤與網址");
      return;
    }

    const filteredLinks = normalizedLinks.filter(
      (link) => link.label && link.url
    );

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
        note: form.note,
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
        note: parsedData.note ?? null,
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
        tagsText: parsedData.tags.join("\n"),
        progressNote: parsedData.progressNote ?? "",
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
      setLinks(parsedData.links.map((link) => ({ ...link })));
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

  const inputClass = "h-12 w-full rounded-xl border px-4 text-base";
  const textAreaClass = "min-h-[100px] w-full rounded-xl border px-4 py-3 text-base";
  const sectionClass = "space-y-6 rounded-2xl border bg-white/70 p-6 shadow-sm";

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
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
              <Link
                href="/cabinets"
                className="rounded-full border border-gray-200 bg-white px-4 py-2 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900"
              >
                返回櫃子列表
              </Link>
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
            <section className={sectionClass}>
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
                <label className="space-y-1 block">
                  <span className="text-base">標籤</span>
                  <textarea
                    value={form.tagsText}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, tagsText: e.target.value }))
                    }
                    className="min-h-[120px] w-full rounded-xl border px-4 py-3 text-base"
                    placeholder="以逗號或換行分隔，例如：漫畫
少年漫畫"
                  />
                </label>
                <p className="text-xs text-gray-500">
                  後續會提供快速標籤，現階段可先以逗號或換行分隔。
                </p>
              </div>
            </section>

            <section className={sectionClass}>
              <div className="flex items-center justify-between">
                <span className="text-base">相關連結</span>
                <button
                  type="button"
                  onClick={() => setLinks((prev) => [...prev, { label: "", url: "" }])}
                  className="h-10 rounded-lg border px-3 text-sm text-gray-700 transition hover:border-gray-300"
                >
                  新增連結
                </button>
              </div>
              {links.length === 0 && (
                <p className="text-sm text-gray-500">目前尚未新增連結。</p>
              )}
              <div className="space-y-3">
                {links.map((link, index) => (
                  <div key={index} className="space-y-2 rounded-xl border bg-white/80 p-4">
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
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setLinks((prev) => prev.filter((_, idx) => idx !== index))
                        }
                        className="h-10 rounded-lg border px-3 text-sm text-red-600 transition hover:border-red-200"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className={sectionClass}>
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
            </section>

            <section className={sectionClass}>
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
            </section>

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
          <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">進度管理</h2>
            <p className="text-sm text-gray-500">
              可於此管理多平台進度，並設定主進度供列表顯示與一鍵 +1。
            </p>
            <ProgressEditor itemId={itemId} />
          </section>
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
