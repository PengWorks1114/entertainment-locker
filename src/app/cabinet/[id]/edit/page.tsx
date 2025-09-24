"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, use, useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

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
import type {
  ItemLanguage,
  ItemStatus,
  ThumbTransform,
  UpdateFrequency,
} from "@/lib/types";
import {
  ITEM_LANGUAGE_VALUES,
  ITEM_STATUS_VALUES,
  UPDATE_FREQUENCY_VALUES,
} from "@/lib/types";
import { invalidateCabinetOptions } from "@/lib/cabinet-options";

type CabinetEditPageProps = {
  params: Promise<{ id: string }>;
};

const MASTER_UNLOCK_CODE = "6472";
const CSV_HEADERS = [
  "titleZh",
  "titleAlt",
  "author",
  "language",
  "status",
  "rating",
  "tags",
  "isFavorite",
  "progressNote",
  "insightNote",
  "note",
  "updateFrequency",
] as const;

type CsvHeader = (typeof CSV_HEADERS)[number];

function escapeCsvField(value: string | number | boolean | null | undefined) {
  const stringValue =
    value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildCsvContent(rows: Array<Record<CsvHeader, string>>) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    const line = CSV_HEADERS.map((header) =>
      escapeCsvField(row[header] ?? "")
    ).join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < content.length) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      current.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n") {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  current.push(field);
  rows.push(current);
  return rows;
}

function normalizeCabinetTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const tagSet = new Set<string>();
  input.forEach((value) => {
    const tag = String(value ?? "").trim();
    if (tag) {
      tagSet.add(tag);
    }
  });
  return Array.from(tagSet).sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function buildSafeFileName(raw: string) {
  return raw.replace(/[\\/:*?"<>|]/g, "_");
}

export default function CabinetEditPage({ params }: CabinetEditPageProps) {
  const { id: cabinetId } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lockSaving, setLockSaving] = useState(false);
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
  const [storedLockCode, setStoredLockCode] = useState<number | null>(null);
  const [lockCode, setLockCode] = useState("");
  const [lockCodeConfirm, setLockCodeConfirm] = useState("");
  const [unlockCode, setUnlockCode] = useState("");
  const [lockMode, setLockMode] = useState<"idle" | "locking" | "unlocking">(
    "idle"
  );
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);

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
      setStoredLockCode(null);
      setLockCode("");
      setLockCodeConfirm("");
      setUnlockCode("");
      setLockMode("idle");
      setCsvText("");
      setCsvError(null);
      setCsvExporting(false);
      setCsvImporting(false);
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
          setStoredLockCode(null);
          setLockCode("");
          setLockCodeConfirm("");
          setUnlockCode("");
          setLockMode("idle");
          setCsvText("");
          setCsvError(null);
          setCsvExporting(false);
          setCsvImporting(false);
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
          setStoredLockCode(null);
          setLockCode("");
          setLockCodeConfirm("");
          setUnlockCode("");
          setLockMode("idle");
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
        setStoredLockCode(() => {
          const rawCode = data?.lockCode;
          if (typeof rawCode === "number" && Number.isSafeInteger(rawCode)) {
            return rawCode;
          }
          if (typeof rawCode === "string") {
            const trimmed = rawCode.trim();
            if (/^[0-9]+$/.test(trimmed)) {
              const parsed = Number(trimmed);
              if (Number.isSafeInteger(parsed)) {
                return parsed;
              }
            }
          }
          return null;
        });
        setLockCode("");
        setLockCodeConfirm("");
        setUnlockCode("");
        setLockMode("idle");
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
        setStoredLockCode(null);
        setLockCode("");
        setLockCodeConfirm("");
        setUnlockCode("");
        setCsvError(null);
        setCsvExporting(false);
        setCsvImporting(false);
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
      if (storedLockCode === null) {
        setMessage("鎖定密碼已遺失，請重新設定鎖定密碼");
        setSaving(false);
        return;
      }
      if (!Number.isSafeInteger(storedLockCode)) {
        setMessage("鎖定密碼已損毀，請重新設定鎖定密碼");
        setSaving(false);
        return;
      }
      lockCodeToPersist = storedLockCode;
    } else {
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
      setStoredLockCode(lockCodeToPersist);
      setLockCode("");
      setLockCodeConfirm("");
      setUnlockCode("");
      setLockMode("idle");
      setMessage("已更新櫃子資料");
    } catch (err) {
      console.error("更新櫃子名稱失敗", err);
      setMessage("儲存櫃子資料時發生錯誤");
    } finally {
      setSaving(false);
    }
  }

  async function handleExportCsv() {
    if (!user || !canEdit || csvExporting || csvImporting) {
      return;
    }
    setCsvError(null);
    setCsvExporting(true);
    try {
      const db = getFirebaseDb();
      if (!db) {
        setError("Firebase 尚未設定");
        return;
      }
      const q = query(
        collection(db, "item"),
        where("uid", "==", user.uid),
        where("cabinetId", "==", cabinetId)
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        const titleZh =
          typeof data.titleZh === "string" && data.titleZh
            ? data.titleZh
            : "";
        const titleAlt =
          typeof data.titleAlt === "string" ? data.titleAlt.trim() : "";
        const author =
          typeof data.author === "string" ? data.author.trim() : "";
        const language =
          typeof data.language === "string" &&
          ITEM_LANGUAGE_VALUES.includes(data.language as ItemLanguage)
            ? (data.language as ItemLanguage)
            : "";
        const status =
          typeof data.status === "string" &&
          ITEM_STATUS_VALUES.includes(data.status as ItemStatus)
            ? (data.status as ItemStatus)
            : "planning";
        const rating =
          typeof data.rating === "number" && Number.isFinite(data.rating)
            ? String(data.rating)
            : "";
        const tags = normalizeCabinetTags(data?.tags).join("|");
        const isFavorite = Boolean(data.isFavorite) ? "true" : "false";
        const progressNote =
          typeof data.progressNote === "string" ? data.progressNote : "";
        const insightNote =
          typeof data.insightNote === "string" ? data.insightNote : "";
        const note = typeof data.note === "string" ? data.note : "";
        const updateFrequency =
          typeof data.updateFrequency === "string" &&
          UPDATE_FREQUENCY_VALUES.includes(
            data.updateFrequency as UpdateFrequency
          )
            ? (data.updateFrequency as UpdateFrequency)
            : "";
        return {
          titleZh,
          titleAlt,
          author,
          language,
          status,
          rating,
          tags,
          isFavorite,
          progressNote,
          insightNote,
          note,
          updateFrequency,
        } satisfies Record<CsvHeader, string>;
      });
      const csv = buildCsvContent(rows);
      const blob = new Blob([`\ufeff${csv}`], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const trimmedName = name.trim();
      const fileLabel = trimmedName
        ? buildSafeFileName(trimmedName)
        : `cabinet-${cabinetId}`;
      link.href = url;
      link.download = `${fileLabel || "cabinet"}-items.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage("已匯出 CSV 資料");
    } catch (err) {
      console.error("匯出 CSV 失敗", err);
      setCsvError("匯出 CSV 時發生錯誤");
    } finally {
      setCsvExporting(false);
    }
  }

  async function handleImportCsv() {
    if (!user || !canEdit || csvImporting || csvExporting) {
      return;
    }
    const raw = csvText.trim();
    if (!raw) {
      setCsvError("請先貼上要匯入的 CSV 內容");
      return;
    }
    let rows: string[][];
    try {
      rows = parseCsv(raw).filter((row) =>
        row.some((cell) => cell.trim().length > 0)
      );
    } catch (err) {
      console.error("解析 CSV 失敗", err);
      setCsvError("CSV 格式有誤，請確認內容後再試一次");
      return;
    }
    if (rows.length === 0) {
      setCsvError("找不到可匯入的資料列");
      return;
    }
    const headerRow = rows[0].map((value) => value.trim());
    const headerIndex = new Map<CsvHeader, number>();
    headerRow.forEach((cell, index) => {
      if (CSV_HEADERS.includes(cell as CsvHeader)) {
        headerIndex.set(cell as CsvHeader, index);
      }
    });
    if (headerIndex.size !== CSV_HEADERS.length) {
      setCsvError("CSV 欄位名稱不符合匯入格式");
      return;
    }

    const db = getFirebaseDb();
    if (!db) {
      setError("Firebase 尚未設定");
      return;
    }

    setCsvError(null);
    setCsvImporting(true);
    try {
      let imported = 0;
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const record: Record<CsvHeader, string> = {
          titleZh: "",
          titleAlt: "",
          author: "",
          language: "",
          status: "",
          rating: "",
          tags: "",
          isFavorite: "",
          progressNote: "",
          insightNote: "",
          note: "",
          updateFrequency: "",
        };
        CSV_HEADERS.forEach((header) => {
          const index = headerIndex.get(header);
          const value = index !== undefined ? row[index] ?? "" : "";
          record[header] = value ?? "";
        });
        if (Object.values(record).every((value) => value.trim().length === 0)) {
          continue;
        }
        const titleZh = record.titleZh.trim();
        if (!titleZh) {
          throw new Error(`第 ${rowIndex + 1} 行缺少標題，已停止匯入`);
        }
        const titleAlt = record.titleAlt.trim();
        const author = record.author.trim();
        const languageRaw = record.language.trim();
        const language = ITEM_LANGUAGE_VALUES.includes(
          languageRaw as ItemLanguage
        )
          ? languageRaw
          : null;
        const statusRaw = record.status.trim();
        const status = ITEM_STATUS_VALUES.includes(
          statusRaw as ItemStatus
        )
          ? statusRaw
          : "planning";
        const ratingRaw = record.rating.trim();
        let rating: number | null = null;
        if (ratingRaw) {
          const parsed = Number.parseFloat(ratingRaw);
          if (!Number.isFinite(parsed)) {
            throw new Error(`第 ${rowIndex + 1} 行的評分格式不正確`);
          }
          rating = parsed;
        }
        const tags = record.tags
          .split("|")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
        const isFavoriteRaw = record.isFavorite.trim().toLowerCase();
        const isFavorite =
          isFavoriteRaw === "true" ||
          isFavoriteRaw === "1" ||
          isFavoriteRaw === "yes" ||
          isFavoriteRaw === "y" ||
          isFavoriteRaw === "是";
        const progressNote = record.progressNote.trim();
        const insightNote = record.insightNote.trim();
        const note = record.note.trim();
        const updateFrequencyRaw = record.updateFrequency.trim();
        const updateFrequency = UPDATE_FREQUENCY_VALUES.includes(
          updateFrequencyRaw as UpdateFrequency
        )
          ? updateFrequencyRaw
          : null;

        await addDoc(collection(db, "item"), {
          uid: user.uid,
          cabinetId,
          titleZh,
          titleAlt: titleAlt || null,
          author: author || null,
          language,
          status,
          rating,
          tags,
          links: [],
          thumbUrl: null,
          thumbTransform: null,
          isFavorite,
          progressNote: progressNote || null,
          insightNote: insightNote || null,
          insightNotes: [],
          note: note || null,
          appearances: [],
          updateFrequency,
          nextUpdateAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        imported += 1;
      }
      if (imported === 0) {
        setCsvError("沒有符合條件的資料可匯入");
        return;
      }
      setCsvText("");
      setMessage(`已匯入 ${imported} 筆資料`);
    } catch (err) {
      console.error("匯入 CSV 失敗", err);
      if (err instanceof Error && err.message) {
        setCsvError(err.message);
      } else {
        setCsvError("匯入 CSV 時發生錯誤");
      }
    } finally {
      setCsvImporting(false);
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

  async function handleLockSave(action: "lock" | "unlock") {
    if (!user || !canEdit || lockSaving) {
      return;
    }

    if (action === "lock") {
      const nextLockCodeRaw = lockCode.trim();
      const nextLockCodeConfirmRaw = lockCodeConfirm.trim();

      if (!nextLockCodeRaw || !nextLockCodeConfirmRaw) {
        setMessage("請輸入並確認鎖定密碼");
        return;
      }
      if (nextLockCodeRaw !== nextLockCodeConfirmRaw) {
        setMessage("鎖定密碼與確認密碼不一致");
        return;
      }
      if (!/^[0-9]+$/.test(nextLockCodeRaw)) {
        setMessage("鎖定密碼僅能輸入數字");
        return;
      }
      const parsedLockCode = Number(nextLockCodeRaw);
      if (!Number.isSafeInteger(parsedLockCode)) {
        setMessage("鎖定密碼過長，請輸入較短的數字");
        return;
      }

      try {
        setLockSaving(true);
        const db = getFirebaseDb();
        if (!db) {
          setError("Firebase 尚未設定");
          setLockSaving(false);
          return;
        }
        const cabinetRef = doc(db, "cabinet", cabinetId);
        await updateDoc(cabinetRef, {
          isLocked: true,
          lockCode: parsedLockCode,
          updatedAt: serverTimestamp(),
        });
        invalidateCabinetOptions(user.uid);
        setLocked(true);
        setStoredLockCode(parsedLockCode);
        setLockCode("");
        setLockCodeConfirm("");
        setUnlockCode("");
        setLockMode("idle");
        setMessage("已更新鎖定設定");
      } catch (err) {
        console.error("更新鎖定設定失敗", err);
        setMessage("儲存鎖定設定時發生錯誤");
      } finally {
        setLockSaving(false);
      }
      return;
    }

    const unlockCodeRaw = unlockCode.trim();
    if (!unlockCodeRaw) {
      setMessage("請輸入鎖定密碼以解除鎖定");
      return;
    }
    if (!/^[0-9]+$/.test(unlockCodeRaw)) {
      setMessage("鎖定密碼僅能輸入數字");
      return;
    }
    const unlockCodeValue = Number(unlockCodeRaw);
    if (!Number.isSafeInteger(unlockCodeValue)) {
      setMessage("鎖定密碼過長，請重新輸入");
      return;
    }
    const masterUnlocked = unlockCodeRaw === MASTER_UNLOCK_CODE;
    const matchesStored =
      storedLockCode !== null && unlockCodeValue === storedLockCode;
    if (!masterUnlocked && !matchesStored) {
      setMessage("鎖定密碼不正確，無法解除鎖定");
      return;
    }

    try {
      setLockSaving(true);
      const db = getFirebaseDb();
      if (!db) {
        setError("Firebase 尚未設定");
        setLockSaving(false);
        return;
      }
      const cabinetRef = doc(db, "cabinet", cabinetId);
      await updateDoc(cabinetRef, {
        isLocked: false,
        lockCode: null,
        updatedAt: serverTimestamp(),
      });
      invalidateCabinetOptions(user.uid);
      setLocked(false);
      setStoredLockCode(null);
      setLockCode("");
      setLockCodeConfirm("");
      setUnlockCode("");
      setLockMode("idle");
      setMessage("已解除鎖定");
    } catch (err) {
      console.error("解除鎖定失敗", err);
      setMessage("解除鎖定時發生錯誤");
    } finally {
      setLockSaving(false);
    }
  }

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
          <>
            <section className="space-y-4 rounded-2xl border bg-white/70 p-6 shadow-sm">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-gray-900">CSV 匯入與匯出</h2>
                <p className="text-sm text-gray-500">
                  快速備份或大量匯入此櫃子的物件資料。
                </p>
              </div>
              {csvError && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {csvError}
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={csvExporting || csvImporting}
                  className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-32"
                >
                  {csvExporting ? "匯出中…" : "CSV 匯出"}
                </button>
                <button
                  type="button"
                  onClick={handleImportCsv}
                  disabled={csvExporting || csvImporting}
                  className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-70 sm:w-32"
                >
                  {csvImporting ? "匯入中…" : "CSV 匯入"}
                </button>
              </div>
              <textarea
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                placeholder="貼上或編輯要匯入的 CSV 內容，每列對應一個物件。"
                className="min-h-[160px] w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-gray-300 focus:outline-none"
                disabled={csvImporting}
              />
              <p className="text-xs text-gray-400">
                欄位順序需為：{CSV_HEADERS.join("、")}。
              </p>
            </section>
            <section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-gray-900">鎖定此櫃子</h2>
                  <p className="text-sm text-gray-500">
                    需要時可透過鎖定保護櫃子內容，解除鎖定請前往此處輸入密碼。
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    locked
                      ? "bg-red-100 text-red-600"
                      : "bg-emerald-100 text-emerald-600"
                  }`}
                >
                  {locked ? "已鎖定" : "未鎖定"}
                </span>
              </div>
              {locked ? (
                lockMode === "unlocking" ? (
                  <div className="space-y-6">
                    <label className="space-y-1">
                      <span className="text-xs text-gray-600">解除鎖定密碼</span>
                      <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        value={unlockCode}
                        onChange={(event) => setUnlockCode(event.target.value)}
                        className={smallInputClass}
                        disabled={lockSaving}
                      />
                    </label>
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          setLockMode("idle");
                          setUnlockCode("");
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900 sm:w-32"
                        disabled={lockSaving}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLockSave("unlock")}
                        className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-40"
                        disabled={lockSaving}
                      >
                        確認解除鎖定
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <p className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-600">
                      此櫃子已鎖定，如需瀏覽請先解除鎖定。
                    </p>
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          setLockMode("unlocking");
                          setUnlockCode("");
                        }}
                        className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-40"
                        disabled={lockSaving}
                      >
                        解除鎖定
                      </button>
                    </div>
                  </div>
                )
              ) : lockMode === "locking" ? (
                <div className="space-y-6">
                  <label className="space-y-1">
                    <span className="text-xs text-gray-600">鎖定密碼</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={lockCode}
                      onChange={(event) => setLockCode(event.target.value)}
                      className={smallInputClass}
                      disabled={lockSaving}
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
                      disabled={lockSaving}
                    />
                  </label>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        setLockMode("idle");
                        setLockCode("");
                        setLockCodeConfirm("");
                      }}
                      className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-900 sm:w-32"
                      disabled={lockSaving}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLockSave("lock")}
                      className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-40"
                      disabled={lockSaving}
                    >
                      確認鎖定
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-600">
                    櫃子目前未鎖定，可設定密碼避免他人瀏覽內容。
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        setLockMode("locking");
                        setLockCode("");
                        setLockCodeConfirm("");
                      }}
                      className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-40"
                      disabled={lockSaving}
                    >
                      設定鎖定
                    </button>
                  </div>
                </div>
              )}
            </section>

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
          </>
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
