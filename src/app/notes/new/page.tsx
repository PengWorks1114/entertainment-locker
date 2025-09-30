"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { RichTextEditor } from "@/components/RichTextEditor";
import NoteRelationDialog from "@/components/NoteRelationDialog";
import { fetchCabinetOptions, type CabinetOption } from "@/lib/cabinet-options";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import {
  describeCabinet,
  NOTE_RELATED_ITEM_LIMIT,
  type ItemSummary,
} from "@/lib/note-relations";
import { buttonClass } from "@/lib/ui";

const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 300;

type Feedback = {
  type: "error" | "success";
  message: string;
};

export default function NewNotePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [contentText, setContentText] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [saving, setSaving] = useState(false);
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [linkedCabinetId, setLinkedCabinetId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<ItemSummary[]>([]);
  const [primaryItemId, setPrimaryItemId] = useState<string | null>(null);
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [cabinetLoading, setCabinetLoading] = useState(false);
  const [cabinetError, setCabinetError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
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
      setCabinetOptions([]);
      setCabinetError(null);
      return;
    }
    let active = true;
    setCabinetLoading(true);
    setCabinetError(null);
    fetchCabinetOptions(user.uid)
      .then((options) => {
        if (!active) {
          return;
        }
        setCabinetOptions(options);
      })
      .catch((err) => {
        console.error("載入櫃子資料時發生錯誤", err);
        if (!active) {
          return;
        }
        setCabinetError("載入櫃子資料時發生錯誤");
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setCabinetLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const cabinetMap = useMemo(() => {
    const map = new Map<string, CabinetOption>();
    cabinetOptions.forEach((option) => {
      map.set(option.id, option);
    });
    return map;
  }, [cabinetOptions]);

  const relationSummary = useMemo(() => {
    const cabinetInfo = describeCabinet(linkedCabinetId, cabinetMap);
    const items = selectedItems;
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-5 text-sm text-gray-500">
          尚未選擇任何作品，可按右上角按鈕管理關聯。
        </div>
      );
    }
    return (
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white px-4 py-5 text-sm text-gray-700">
        <div>
          <div className="text-xs text-gray-500">關聯櫃子</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span>{cabinetInfo.name}</span>
            {cabinetInfo.missing ? (
              <span className="text-xs text-red-600">已找不到或無法存取</span>
            ) : cabinetInfo.isLocked ? (
              <span className="text-xs text-amber-600">已鎖定</span>
            ) : null}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-gray-500">關聯作品</div>
          <ul className="space-y-2">
            {items.map((item) => {
              const cabinet = item.cabinetId ? cabinetMap.get(item.cabinetId) ?? null : null;
              const cabinetLabel = item.cabinetId
                ? cabinet
                  ? `${cabinet.name || "未命名櫃子"}${cabinet.isLocked ? "（已鎖定）" : ""}`
                  : "(找不到櫃子)"
                : "未指定櫃子";
              const isPrimary = primaryItemId === item.id;
              return (
                <li key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800">{item.title}</span>
                    {item.isMissing ? (
                      <span className="text-xs text-red-600">資料遺失</span>
                    ) : null}
                    {isPrimary ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        主作品
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500">{cabinetLabel}</div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }, [cabinetMap, linkedCabinetId, primaryItemId, selectedItems]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    if (!user) {
      setFeedback({ type: "error", message: "請先登入" });
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedContentText = contentText.trim();
    const sanitizedContentHtml = contentHtml.trim();
    if (!trimmedTitle) {
      setFeedback({ type: "error", message: "請填寫筆記標題" });
      return;
    }
    if (trimmedTitle.length > TITLE_LIMIT) {
      setFeedback({ type: "error", message: `標題長度不可超過 ${TITLE_LIMIT} 字` });
      return;
    }
    if (trimmedDescription.length > DESCRIPTION_LIMIT) {
      setFeedback({ type: "error", message: `備註長度不可超過 ${DESCRIPTION_LIMIT} 字` });
      return;
    }
    if (!trimmedContentText) {
      setFeedback({ type: "error", message: "請填寫筆記內容" });
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }

    const relatedIds = selectedItems.map((item) => item.id).slice(0, NOTE_RELATED_ITEM_LIMIT);
    const normalizedPrimary = primaryItemId && relatedIds.includes(primaryItemId)
      ? primaryItemId
      : relatedIds[0] ?? null;
    const normalizedCabinet = linkedCabinetId ?? null;

    setSaving(true);
    setFeedback(null);

    try {
      await addDoc(collection(db, "note"), {
        uid: user.uid,
        title: trimmedTitle,
        description: trimmedDescription ? trimmedDescription : null,
        content: sanitizedContentHtml,
        isFavorite,
        cabinetId: normalizedCabinet,
        itemId: normalizedPrimary,
        relatedItemIds: relatedIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: "success", message: "已新增筆記" });
      setTitle("");
      setDescription("");
      setContentHtml("");
      setContentText("");
      setIsFavorite(false);
      setLinkedCabinetId(null);
      setSelectedItems([]);
      setPrimaryItemId(null);
      router.replace("/notes");
    } catch (err) {
      console.error("新增筆記時發生錯誤", err);
      setFeedback({ type: "error", message: "新增筆記時發生錯誤" });
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-semibold text-gray-900">新增筆記</h1>
          <p className="text-base text-gray-600">
            未登入。請前往
            <Link href="/login" className="ml-1 underline">
              /login
            </Link>
            以管理筆記，或回到
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
    <>
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold text-gray-900">新增筆記</h1>
            <p className="text-sm text-gray-500">建立新的筆記並記錄重要資訊。</p>
          </header>
          <section className="rounded-2xl border bg-white/70 p-6 shadow-sm">
            <form className="space-y-6" onSubmit={handleSubmit}>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-gray-700">筆記標題</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="輸入筆記標題"
                  maxLength={TITLE_LIMIT}
                  required
                  className="h-12 w-full rounded-xl border px-4 text-base"
                  autoFocus
                />
                <span className="block text-right text-xs text-gray-400">
                  {title.trim().length}/{TITLE_LIMIT}
                </span>
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-gray-700">筆記備註</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="補充筆記相關備註（選填）"
                  maxLength={DESCRIPTION_LIMIT}
                  className="min-h-[100px] w-full resize-y rounded-xl border px-4 py-3 text-base"
                />
                <span className="block text-right text-xs text-gray-400">
                  {description.trim().length}/{DESCRIPTION_LIMIT}
                </span>
              </label>
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-700">關聯作品 / 櫃子</span>
                    <p className="text-xs text-gray-500">選擇要關聯的作品或櫃子，建立資料之間的連結。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRelationDialogOpen(true)}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    管理關聯
                  </button>
                </div>
                {cabinetError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600">
                    {cabinetError}
                  </div>
                ) : null}
                {cabinetLoading && cabinetOptions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-4 text-sm text-gray-500">
                    正在載入櫃子資訊…
                  </div>
                ) : (
                  relationSummary
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={isFavorite}
                  onChange={(event) => setIsFavorite(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                />
                設為最愛
              </label>
              <div className="space-y-2">
                <span className="text-sm font-medium text-gray-700">筆記內容</span>
                <RichTextEditor
                  value={contentHtml}
                  onChange={({ html, text }) => {
                    setContentHtml(html);
                    setContentText(text);
                  }}
                  placeholder="輸入筆記內容"
                />
              </div>
              {feedback ? (
                <div
                  className={
                    feedback.type === "error"
                      ? "break-anywhere rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
                      : "break-anywhere rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
                  }
                >
                  {feedback.message}
                </div>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Link href="/notes" className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}>
                  取消
                </Link>
                <button
                  type="submit"
                  disabled={saving}
                  className={`${buttonClass({ variant: "primary" })} w-full sm:w-auto`}
                >
                  {saving ? "儲存中…" : "儲存"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>
      <NoteRelationDialog
        open={relationDialogOpen}
        userId={user.uid}
        initialCabinetId={linkedCabinetId}
        initialItems={selectedItems}
        initialPrimaryItemId={primaryItemId}
        onClose={() => setRelationDialogOpen(false)}
        onSave={({ cabinetId, items, primaryItemId: primary }) => {
          setLinkedCabinetId(cabinetId);
          setSelectedItems(items);
          setPrimaryItemId(primary);
          setRelationDialogOpen(false);
        }}
      />
    </>
  );
}
