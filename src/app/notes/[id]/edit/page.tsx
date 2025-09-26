"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, use, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";

import NoteTagQuickEditor from "@/components/NoteTagQuickEditor";
import { RichTextEditor, extractPlainTextFromHtml } from "@/components/RichTextEditor";
import LinkTargetSelector from "@/components/LinkTargetSelector";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { markdownPreviewHtml, simpleMarkdownToHtml } from "@/lib/markdown";
import { NOTE_TAG_LIMIT, normalizeNoteTags } from "@/lib/note";
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
  const [selectedCabinetIds, setSelectedCabinetIds] = useState<string[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [tagStatus, setTagStatus] = useState<{
    message: string | null;
    error: string | null;
    saving: boolean;
  }>({ message: null, error: null, saving: false });
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
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
      setNoteTags([]);
      return;
    }
    let active = true;
    const db = getFirebaseDb();
    if (!db) {
      setNoteTags([]);
      return;
    }
    getDoc(doc(db, "user", user.uid))
      .then((snap) => {
        if (!active) return;
        if (!snap.exists()) {
          setNoteTags([]);
          return;
        }
        const data = snap.data();
        setNoteTags(normalizeNoteTags(data?.noteTags));
      })
      .catch((err) => {
        if (!active) return;
        console.error("載入筆記標籤時發生錯誤", err);
        setNoteTags([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const selectedTagSet = useMemo(() => new Set(tags), [tags]);

  const availableTagSuggestions = useMemo(
    () => noteTags.filter((tag) => !selectedTagSet.has(tag)),
    [noteTags, selectedTagSet]
  );

  const filteredTagSuggestions = useMemo(() => {
    const keyword = tagQuery.trim().toLowerCase();
    const base = availableTagSuggestions;
    if (!keyword) {
      return base.slice(0, 20);
    }
    return base
      .filter((tag) => tag.toLowerCase().includes(keyword))
      .slice(0, 20);
  }, [availableTagSuggestions, tagQuery]);

  const markdownPreview = useMemo(() => markdownPreviewHtml(markdownContent), [markdownContent]);

  async function persistUserNoteTags(nextTags: string[]) {
    if (!user) {
      return;
    }
    const db = getFirebaseDb();
    if (!db) {
      throw new Error("Firebase 尚未設定");
    }
    await setDoc(
      doc(db, "user", user.uid),
      { noteTags: nextTags, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  async function handleCommitTag(rawTag: string) {
    const value = rawTag.trim();
    if (!value) {
      setTagStatus({ message: null, error: "請輸入標籤名稱", saving: false });
      return;
    }
    if (tags.includes(value)) {
      setTagStatus({ message: `已選取 #${value}`, error: null, saving: false });
      setTagQuery("");
      return;
    }
    if (tags.length >= NOTE_TAG_LIMIT) {
      setTagStatus({
        message: null,
        error: `最多可選擇 ${NOTE_TAG_LIMIT} 個標籤`,
        saving: false,
      });
      return;
    }
    if (!user) {
      setTagStatus({ message: null, error: "請先登入", saving: false });
      return;
    }
    setTagStatus({ message: null, error: null, saving: true });
    setTags((prev) => [...prev, value]);
    setTagQuery("");
    try {
      if (!noteTags.includes(value)) {
        const nextTags = normalizeNoteTags([...noteTags, value]);
        await persistUserNoteTags(nextTags);
        setNoteTags(nextTags);
        setTagStatus({ message: `已新增 #${value}`, error: null, saving: false });
      } else {
        setTagStatus({ message: `已選取 #${value}`, error: null, saving: false });
      }
    } catch (err) {
      console.error("更新筆記標籤時發生錯誤", err);
      setTags((prev) => prev.filter((tag) => tag !== value));
      setTagStatus({ message: null, error: "更新標籤時發生錯誤", saving: false });
    }
  }

  function handleRemoveSelectedTag(tag: string) {
    setTags((prev) => prev.filter((item) => item !== tag));
    setTagStatus({ message: `已移除 #${tag}`, error: null, saving: false });
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      void handleCommitTag(tagQuery);
    }
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
          setSelectedCabinetIds([]);
          setSelectedItemIds([]);
          setTags([]);
          setTagQuery("");
          setTagStatus({ message: null, error: null, saving: false });
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
          setSelectedCabinetIds([]);
          setSelectedItemIds([]);
          setTags([]);
          setTagQuery("");
          setTagStatus({ message: null, error: null, saving: false });
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
            ? normalizeNoteTags(data.tags).slice(0, NOTE_TAG_LIMIT)
            : []
        );
        setTagStatus({ message: null, error: null, saving: false });
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
        setSelectedCabinetIds([]);
        setSelectedItemIds([]);
        setTags([]);
        setTagQuery("");
        setTagStatus({ message: null, error: null, saving: false });
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
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-gray-700">標籤</span>
                  <span className="text-xs text-gray-400">最多 {NOTE_TAG_LIMIT} 個，可使用 Enter 或逗號快速新增。</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setTagManagerOpen(true)}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    筆記標籤管理
                  </button>
                </div>
              </div>
              <div className="space-y-3 rounded-xl border border-gray-200 bg-white/50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={tagQuery}
                    onChange={(event) => {
                      setTagQuery(event.target.value);
                      setTagStatus({ message: null, error: null, saving: false });
                    }}
                    onKeyDown={handleTagKeyDown}
                    placeholder="輸入標籤後按 Enter"
                    className="h-11 flex-1 rounded-xl border px-4 text-base"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCommitTag(tagQuery)}
                    disabled={tagStatus.saving}
                    className={`${buttonClass({ variant: "secondary", size: "sm" })} w-full sm:w-auto`}
                  >
                    新增標籤
                  </button>
                </div>
                {tagStatus.error ? (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{tagStatus.error}</div>
                ) : null}
                {tagStatus.message ? (
                  <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tagStatus.message}</div>
                ) : null}
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleRemoveSelectedTag(tag)}
                        className="group inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-200"
                      >
                        <span>#{tag}</span>
                        <span className="text-xs text-gray-400 group-hover:text-gray-600">移除</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">尚未選取任何標籤。</p>
                )}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-gray-500">快速選取</span>
                  {availableTagSuggestions.length === 0 ? (
                    <p className="text-xs text-gray-400">尚無可用建議。</p>
                  ) : filteredTagSuggestions.length === 0 ? (
                    <p className="text-xs text-gray-400">找不到符合關鍵字的建議標籤。</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {filteredTagSuggestions.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => void handleCommitTag(tag)}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
                          disabled={tagStatus.saving}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <LinkTargetSelector
              userId={user?.uid ?? null}
              selectedCabinetIds={selectedCabinetIds}
              onCabinetIdsChange={setSelectedCabinetIds}
              selectedItemIds={selectedItemIds}
              onItemIdsChange={setSelectedItemIds}
              onError={(message) => setFeedback({ type: "error", message })}
            />
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
        <NoteTagQuickEditor
          open={tagManagerOpen}
          onClose={() => setTagManagerOpen(false)}
          userId={user.uid}
          tags={noteTags}
          onTagsChange={(nextTags) => {
            setNoteTags(nextTags);
            setTagStatus({ message: null, error: null, saving: false });
          }}
          onTagRenamed={(previousTag, nextTag) => {
            setTags((current) =>
              current.map((tag) => (tag === previousTag ? nextTag : tag))
            );
          }}
          onTagDeleted={(target) => {
            setTags((current) => current.filter((tag) => tag !== target));
          }}
          onStatus={(status) => {
            setTagStatus({
              message: status.message ?? null,
              error: status.error ?? null,
              saving: false,
            });
          }}
        />
      </div>
    </main>
  );
}
