"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";

import { RichTextEditor, extractPlainTextFromHtml } from "@/components/RichTextEditor";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { markdownPreviewHtml, simpleMarkdownToHtml, splitTags } from "@/lib/markdown";
import { NOTE_CATEGORY_OPTIONS, NOTE_TAG_LIMIT, type NoteCategory } from "@/lib/note";
import { buttonClass } from "@/lib/ui";

const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 300;

type Feedback = {
  type: "error" | "success";
  message: string;
};

type PageProps = {
  params: Promise<{ id: string }>;
};

type CabinetOption = {
  id: string;
  name: string;
};

type ItemOption = {
  id: string;
  title: string;
  cabinetId: string | null;
};

export default function EditNotePage({ params }: PageProps) {
  const { id: noteId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [contentText, setContentText] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [markdownContent, setMarkdownContent] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<NoteCategory>("general");
  const [cabinetOptions, setCabinetOptions] = useState<CabinetOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [cabinetSearchTerm, setCabinetSearchTerm] = useState("");
  const [itemSearchTerm, setItemSearchTerm] = useState("");
  const [selectedCabinetIds, setSelectedCabinetIds] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthChecked(true);
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      setLoading(false);
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
      setItemOptions([]);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }
    const cabinetQuery = query(collection(db, "cabinet"), where("uid", "==", user.uid));
    const itemQuery = query(collection(db, "item"), where("uid", "==", user.uid));

    const unsubscribeCabinet = onSnapshot(
      cabinetQuery,
      (snapshot) => {
        setCabinetOptions(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                name: typeof data?.name === "string" ? data.name : "未命名櫃子",
              } satisfies CabinetOption;
            })
            .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
        );
      },
      () => {
        setFeedback({ type: "error", message: "載入櫃子清單時發生錯誤" });
      }
    );

    const unsubscribeItem = onSnapshot(
      itemQuery,
      (snapshot) => {
        setItemOptions(
          snapshot.docs
            .map((docSnap) => {
              const data = docSnap.data();
              return {
                id: docSnap.id,
                title:
                  typeof data?.titleZh === "string" && data.titleZh.trim()
                    ? (data.titleZh as string)
                    : "未命名作品",
                cabinetId:
                  typeof data?.cabinetId === "string" && data.cabinetId.trim().length > 0
                    ? (data.cabinetId as string)
                    : null,
              } satisfies ItemOption;
            })
            .sort((a, b) => a.title.localeCompare(b.title, "zh-Hant"))
        );
      },
      () => {
        setFeedback({ type: "error", message: "載入作品清單時發生錯誤" });
      }
    );

    return () => {
      unsubscribeCabinet();
      unsubscribeItem();
    };
  }, [user]);

  useEffect(() => {
    setSelectedCabinetIds((prev) =>
      prev.filter((id) => cabinetOptions.some((option) => option.id === id))
    );
  }, [cabinetOptions]);

  useEffect(() => {
    setSelectedItemIds((prev) => prev.filter((id) => itemOptions.some((option) => option.id === id)));
  }, [itemOptions]);

  const filteredCabinetOptions = useMemo(() => {
    const keyword = cabinetSearchTerm.trim().toLowerCase();
    if (!keyword) {
      return cabinetOptions;
    }
    return cabinetOptions.filter((option) => option.name.toLowerCase().includes(keyword));
  }, [cabinetOptions, cabinetSearchTerm]);

  const filteredItemOptions = useMemo(() => {
    const keyword = itemSearchTerm.trim().toLowerCase();
    if (!keyword) {
      return itemOptions;
    }
    return itemOptions.filter((option) => option.title.toLowerCase().includes(keyword));
  }, [itemOptions, itemSearchTerm]);

  const markdownPreview = useMemo(() => markdownPreviewHtml(markdownContent), [markdownContent]);

  function toggleCabinetSelection(id: string) {
    setSelectedCabinetIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }

  function toggleItemSelection(id: string) {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );
  }

  function handleAddTags() {
    const newTags = splitTags(tagInput);
    if (newTags.length === 0) {
      setTagInput("");
      return;
    }
    setTags((prev) => {
      const merged = [...prev];
      for (const tag of newTags) {
        if (!merged.includes(tag) && merged.length < NOTE_TAG_LIMIT) {
          merged.push(tag);
        }
      }
      return merged;
    });
    setTagInput("");
  }

  function handleRemoveTag(tag: string) {
    setTags((prev) => prev.filter((item) => item !== tag));
  }

  function handleSyncMarkdownToEditor() {
    const html = simpleMarkdownToHtml(markdownContent);
    setContentHtml(html);
    setContentText(extractPlainTextFromHtml(html));
  }

  useEffect(() => {
    if (!authChecked) {
      return;
    }
    if (!user) {
      setLoading(false);
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      setLoading(false);
      return;
    }
    async function loadNote(firestore: Firestore, currentUser: User) {
      setLoading(true);
      setNotFound(false);
      try {
        if (!noteId) {
          setFeedback({ type: "error", message: "找不到對應的筆記" });
          setNotFound(true);
          setIsFavorite(false);
          setLoading(false);
          return;
        }
        const noteRef = doc(firestore, "note", noteId);
        const snap = await getDoc(noteRef);
        if (!snap.exists()) {
          setFeedback({ type: "error", message: "找不到對應的筆記" });
          setNotFound(true);
          setTitle("");
          setDescription("");
          setContentHtml("");
          setContentText("");
          setIsFavorite(false);
          setMarkdownContent("");
          setSelectedCategory("general");
          setSelectedCabinetIds([]);
          setSelectedItemIds([]);
          setTags([]);
          setLoading(false);
          return;
        }
        const data = snap.data();
        if (!data || data.uid !== currentUser.uid) {
          setFeedback({ type: "error", message: "無法存取此筆記" });
          setNotFound(true);
          setTitle("");
          setDescription("");
          setContentHtml("");
          setContentText("");
          setIsFavorite(false);
          setMarkdownContent("");
          setSelectedCategory("general");
          setSelectedCabinetIds([]);
          setSelectedItemIds([]);
          setTags([]);
          setLoading(false);
          return;
        }
        setTitle((data.title as string) ?? "");
        setDescription(typeof data.description === "string" ? data.description : "");
        const noteContent = (data.content as string) ?? "";
        setContentHtml(noteContent);
        setContentText(extractPlainTextFromHtml(noteContent));
        setIsFavorite(Boolean(data.isFavorite));
        setMarkdownContent(typeof data.contentMarkdown === "string" ? data.contentMarkdown : "");
        setSelectedCategory(
          typeof data.category === "string" &&
            NOTE_CATEGORY_OPTIONS.some((item) => item.value === data.category)
            ? (data.category as NoteCategory)
            : "general"
        );
        setSelectedCabinetIds(
          Array.isArray(data.linkedCabinetIds)
            ? data.linkedCabinetIds.filter((value): value is string => typeof value === "string")
            : []
        );
        setSelectedItemIds(
          Array.isArray(data.linkedItemIds)
            ? data.linkedItemIds.filter((value): value is string => typeof value === "string")
            : []
        );
        setTags(
          Array.isArray(data.tags)
            ? data.tags
                .filter((value): value is string => typeof value === "string")
                .slice(0, NOTE_TAG_LIMIT)
            : []
        );
        setFeedback(null);
        setNotFound(false);
      } catch (err) {
        console.error("載入筆記時發生錯誤", err);
        setFeedback({ type: "error", message: "載入筆記時發生錯誤" });
        setNotFound(true);
        setTitle("");
        setDescription("");
        setContentHtml("");
        setContentText("");
        setIsFavorite(false);
        setMarkdownContent("");
        setSelectedCategory("general");
        setSelectedCabinetIds([]);
        setSelectedItemIds([]);
        setTags([]);
      } finally {
        setLoading(false);
      }
    }
    loadNote(db, user);
  }, [authChecked, noteId, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || notFound) {
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
    const markdownValue = markdownContent.trim();
    if (!trimmedContentText && !markdownValue) {
      setFeedback({ type: "error", message: "請填寫筆記內容或 Markdown" });
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setFeedback({ type: "error", message: "Firebase 尚未設定" });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      if (!noteId) {
        setFeedback({ type: "error", message: "找不到對應的筆記" });
        return;
      }
      const noteRef = doc(db, "note", noteId);
      await updateDoc(noteRef, {
        title: trimmedTitle,
        description: trimmedDescription ? trimmedDescription : null,
        content: sanitizedContentHtml,
        contentMarkdown: markdownValue ? markdownValue : null,
        category: selectedCategory || null,
        tags,
        linkedCabinetIds: selectedCabinetIds,
        linkedItemIds: selectedItemIds,
        isFavorite,
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: "success", message: "已更新筆記" });
      router.replace(`/notes/${noteId}`);
    } catch (err) {
      console.error("更新筆記時發生錯誤", err);
      setFeedback({ type: "error", message: "更新筆記時發生錯誤" });
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
          <h1 className="text-2xl font-semibold text-gray-900">編輯筆記</h1>
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

  if (loading) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          正在載入筆記…
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl space-y-4 rounded-2xl border bg-white/70 p-6 text-base shadow-sm">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold text-gray-900">編輯筆記</h1>
          </header>
          <div className="break-anywhere rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {feedback?.message ?? "找不到筆記，無法進行編輯。"}
          </div>
          <Link href="/notes" className={buttonClass({ variant: "secondary" })}>
            返回筆記本
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-gray-50 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-2">
          <Link
            href={noteId ? `/notes/${noteId}` : "/notes"}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
          >
            ← 返回筆記詳情
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">編輯筆記</h1>
          <p className="text-sm text-gray-500">調整筆記內容並保存最新版本。</p>
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
            <label className="block space-y-2">
              <span className="text-sm font-medium text-gray-700">筆記類別</span>
              <select
                value={selectedCategory}
                onChange={(event) =>
                  setSelectedCategory(event.target.value as NoteCategory)
                }
                className="h-12 w-full rounded-xl border bg-white px-4 text-base"
              >
                {NOTE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-gray-700">標籤</span>
                <span className="text-xs text-gray-400">最多 {NOTE_TAG_LIMIT} 個，使用逗號或空白分隔</span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="輸入標籤後按新增"
                  className="h-11 flex-1 rounded-xl border px-4 text-base"
                />
                <button
                  type="button"
                  onClick={handleAddTags}
                  className={`${buttonClass({ variant: "secondary", size: "sm" })} w-full sm:w-auto`}
                >
                  新增標籤
                </button>
              </div>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="group inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-200"
                    >
                      <span>#{tag}</span>
                      <span className="text-xs text-gray-400 group-hover:text-gray-600">刪除</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">尚未新增標籤，可用來分類或搜尋。</p>
              )}
            </div>
            <section className="space-y-4 rounded-xl border border-gray-200 bg-white/50 p-4">
              <header className="space-y-1">
                <h2 className="text-sm font-medium text-gray-700">連結目標</h2>
                <p className="text-xs text-gray-500">調整筆記與櫃子、作品的關聯，方便在各頁面互相串連。</p>
              </header>
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium text-gray-700">櫃子</span>
                    <input
                      value={cabinetSearchTerm}
                      onChange={(event) => setCabinetSearchTerm(event.target.value)}
                      placeholder="搜尋櫃子"
                      className="h-10 w-full max-w-xs rounded-xl border px-3 text-sm"
                    />
                  </div>
                  <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-gray-200 bg-white/60 p-2 text-sm">
                    {filteredCabinetOptions.length > 0 ? (
                      filteredCabinetOptions.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1 transition hover:bg-gray-100"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCabinetIds.includes(option.id)}
                            onChange={() => toggleCabinetSelection(option.id)}
                            className="h-4 w-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-400"
                          />
                          <span className="flex-1 break-anywhere">{option.name}</span>
                        </label>
                      ))
                    ) : (
                      <p className="px-2 py-1 text-xs text-gray-500">尚無櫃子或無符合條件的結果。</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium text-gray-700">作品</span>
                    <input
                      value={itemSearchTerm}
                      onChange={(event) => setItemSearchTerm(event.target.value)}
                      placeholder="搜尋作品名稱"
                      className="h-10 w-full max-w-xs rounded-xl border px-3 text-sm"
                    />
                  </div>
                  <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-gray-200 bg-white/60 p-2 text-sm">
                    {filteredItemOptions.length > 0 ? (
                      filteredItemOptions.map((option) => {
                        const cabinetLabel = option.cabinetId
                          ? cabinetOptions.find((cabinet) => cabinet.id === option.cabinetId)?.name
                          : null;
                        return (
                          <label
                            key={option.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1 transition hover:bg-gray-100"
                          >
                            <input
                              type="checkbox"
                              checked={selectedItemIds.includes(option.id)}
                              onChange={() => toggleItemSelection(option.id)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-400"
                            />
                            <span className="flex-1 break-anywhere">
                              {option.title}
                              {cabinetLabel ? (
                                <span className="ml-1 text-xs text-gray-500">（{cabinetLabel}）</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })
                    ) : (
                      <p className="px-2 py-1 text-xs text-gray-500">尚無作品或無符合條件的結果。</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-gray-700">Markdown 內容（選填）</span>
                <button
                  type="button"
                  onClick={handleSyncMarkdownToEditor}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  以 Markdown 更新富文本
                </button>
              </div>
              <textarea
                value={markdownContent}
                onChange={(event) => setMarkdownContent(event.target.value)}
                placeholder="輸入 Markdown 文字，將在下方顯示即時預覽"
                className="min-h-[140px] w-full resize-y rounded-xl border px-4 py-3 text-base"
              />
              <div className="space-y-2 rounded-xl border border-gray-200 bg-white/70 p-4">
                <div className="flex items-center justify-between text-sm text-gray-600">
                  <span>Markdown 預覽</span>
                  <span>{markdownContent.trim().length} 字</span>
                </div>
                <div
                  className="markdown-preview text-sm leading-relaxed text-gray-700"
                  dangerouslySetInnerHTML={{ __html: markdownPreview }}
                />
              </div>
            </div>
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
              <Link
                href={noteId ? `/notes/${noteId}` : "/notes"}
                className={`${buttonClass({ variant: "secondary" })} w-full sm:w-auto`}
              >
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
  );
}
