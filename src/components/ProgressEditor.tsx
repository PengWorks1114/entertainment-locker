"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import {
  PROGRESS_TYPE_OPTIONS,
  PROGRESS_TYPE_VALUES,
  UPDATE_FREQUENCY_VALUES,
  type ProgressType,
  type UpdateFrequency,
} from "@/lib/types";
import {
  parseProgressForm,
  ValidationError,
  type ProgressFormData,
} from "@/lib/validators";
import { calculateNextUpdateDate } from "@/lib/item-utils";
import { buttonClass, pillBadgeClass } from "@/lib/ui";

const defaultType: ProgressType = "chapter";

type ProgressRecordState = {
  id: string;
  platform: string;
  type: ProgressType;
  value: number;
  unit?: string | null;
  note?: string | null;
  link?: string | null;
  isPrimary: boolean;
  updatedAt?: Timestamp | null;
};

type ProgressFormState = {
  platform: string;
  type: ProgressType;
  value: string;
  unit: string;
  note: string;
  link: string;
};

type NewProgressFormState = ProgressFormState & { isPrimary: boolean };

type ProgressEditorProps = {
  itemId: string;
};

type ProgressFieldsProps = {
  state: ProgressFormState;
  onChange: <K extends keyof ProgressFormState>(key: K, value: ProgressFormState[K]) => void;
  disabled?: boolean;
};

type ProgressRowProps = {
  record: ProgressRecordState;
  onSave: (id: string, state: ProgressFormState) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetPrimary: (id: string) => Promise<void>;
  saving: boolean;
  deleting: boolean;
  primaryUpdatingId: string | null;
};

const emptyFormState: ProgressFormState = {
  platform: "",
  type: defaultType,
  value: "",
  unit: "",
  note: "",
  link: "",
};

function createFormState(record: ProgressRecordState): ProgressFormState {
  return {
    platform: record.platform,
    type: record.type,
    value: String(record.value ?? ""),
    unit: record.unit ?? "",
    note: record.note ?? "",
    link: record.link ?? "",
  };
}

function formatUpdatedAt(timestamp?: Timestamp | null): string {
  if (!timestamp) {
    return "尚未更新";
  }
  const date = timestamp.toDate();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function ProgressFields({ state, onChange, disabled }: ProgressFieldsProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm text-gray-600">平台 / 來源 *</span>
          <input
            value={state.platform}
            onChange={(event) => onChange("platform", event.target.value)}
            className="h-12 w-full rounded-xl border px-4 text-base"
            placeholder="例如：漫畫瘋"
            disabled={disabled}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm text-gray-600">類型 *</span>
          <select
            value={state.type}
            onChange={(event) => onChange("type", event.target.value as ProgressType)}
            className="h-12 w-full rounded-xl border px-4 text-base"
            disabled={disabled}
          >
            {PROGRESS_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm text-gray-600">數值 *</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={state.value}
            onChange={(event) => onChange("value", event.target.value)}
            className="h-12 w-full rounded-xl border px-4 text-base"
            placeholder="例如：12"
            disabled={disabled}
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm text-gray-600">單位</span>
          <input
            value={state.unit}
            onChange={(event) => onChange("unit", event.target.value)}
            className="h-12 w-full rounded-xl border px-4 text-base"
            placeholder="話 / 集 / % / 頁 / LV"
            disabled={disabled}
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-sm text-gray-600">備註</span>
        <textarea
          value={state.note}
          onChange={(event) => onChange("note", event.target.value)}
          className="min-h-[90px] w-full rounded-xl border px-4 py-3 text-base"
          placeholder="補充說明"
          disabled={disabled}
        />
      </label>

      <label className="space-y-1 block">
        <span className="text-sm text-gray-600">連結</span>
        <input
          type="url"
          inputMode="url"
          value={state.link}
          onChange={(event) => onChange("link", event.target.value)}
          className="h-12 w-full rounded-xl border px-4 text-base"
          placeholder="https://"
          disabled={disabled}
        />
      </label>
    </div>
  );
}

function ProgressRow({
  record,
  onSave,
  onDelete,
  onSetPrimary,
  saving,
  deleting,
  primaryUpdatingId,
}: ProgressRowProps) {
  const [form, setForm] = useState<ProgressFormState>(() => createFormState(record));

  useEffect(() => {
    setForm(createFormState(record));
  }, [record]);

  const busy = saving || deleting || Boolean(primaryUpdatingId);
  const primaryBusy = primaryUpdatingId !== null;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <ProgressFields
        state={form}
        onChange={(key, value) =>
          setForm((prev) => ({
            ...prev,
            [key]: value,
          }))
        }
        disabled={busy}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {record.updatedAt ? `更新於 ${formatUpdatedAt(record.updatedAt)}` : "尚未更新"}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSave(record.id, form)}
            disabled={busy}
            className={buttonClass({ variant: "primary", size: "sm" })}
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
          <button
            type="button"
            onClick={() => onDelete(record.id)}
            disabled={busy}
            className={buttonClass({ variant: "outlineDanger", size: "sm" })}
          >
            {deleting ? "刪除中…" : "刪除"}
          </button>
          {record.isPrimary ? (
            <span className={pillBadgeClass}>
              主進度
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onSetPrimary(record.id)}
              disabled={primaryBusy}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {primaryUpdatingId === record.id ? "設定中…" : "設為主進度"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProgressEditor({ itemId }: ProgressEditorProps) {
  const [progress, setProgress] = useState<ProgressRecordState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [primaryUpdatingId, setPrimaryUpdatingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [itemFrequency, setItemFrequency] = useState<UpdateFrequency | null>(null);
  const [newForm, setNewForm] = useState<NewProgressFormState>({
    ...emptyFormState,
    isPrimary: true,
  });
  const initialisedRef = useRef(false);
  const prevCountRef = useRef(0);
  const primaryCheckboxId = useId();

  useEffect(() => {
    const db = getFirebaseDb();
    const colRef = collection(db, "item", itemId, "progress");
    const q = query(colRef, orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const records: ProgressRecordState[] = snap.docs.map((docSnap) => {
          const data = docSnap.data();
          const platform = typeof data.platform === "string" ? data.platform : "";
          const typeValue =
            typeof data.type === "string" &&
            PROGRESS_TYPE_VALUES.includes(data.type as ProgressType)
              ? (data.type as ProgressType)
              : defaultType;
          const value =
            typeof data.value === "number" && Number.isFinite(data.value)
              ? data.value
              : 0;
          return {
            id: docSnap.id,
            platform,
            type: typeValue,
            value,
            unit: typeof data.unit === "string" ? data.unit : null,
            note: typeof data.note === "string" ? data.note : null,
            link: typeof data.link === "string" ? data.link : null,
            isPrimary: Boolean(data.isPrimary),
            updatedAt:
              data.updatedAt instanceof Timestamp ? (data.updatedAt as Timestamp) : null,
          };
        });
        setProgress(records);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("載入進度資料時發生錯誤", err);
        setError("載入進度資料時發生錯誤");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [itemId]);

  useEffect(() => {
    const db = getFirebaseDb();
    const itemRef = doc(db, "item", itemId);
    const unsub = onSnapshot(
      itemRef,
      (snap) => {
        if (!snap.exists()) {
          return;
        }
        const data = snap.data();
        const freq =
          typeof data?.updateFrequency === "string" &&
          UPDATE_FREQUENCY_VALUES.includes(data.updateFrequency as UpdateFrequency)
            ? (data.updateFrequency as UpdateFrequency)
            : null;
        setItemFrequency(freq);
      },
      (err) => {
        console.error("讀取物件更新頻率失敗", err);
      }
    );
    return () => unsub();
  }, [itemId]);

  useEffect(() => {
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      return;
    }
    if (progress.length === 0) {
      setNewForm((prev) => ({ ...prev, isPrimary: true }));
    } else if (prevCountRef.current === 0 && progress.length > 0) {
      setNewForm((prev) => ({ ...prev, isPrimary: false }));
    }
    prevCountRef.current = progress.length;
  }, [progress]);

  async function touchItemAfterProgressChange() {
    try {
      const nextDate = calculateNextUpdateDate(itemFrequency);
      const db = getFirebaseDb();
      await updateDoc(doc(db, "item", itemId), {
        updatedAt: serverTimestamp(),
        nextUpdateAt: nextDate ? Timestamp.fromDate(nextDate) : null,
      });
    } catch (err) {
      console.error("更新物件時間戳記失敗", err);
    }
  }

  function resetMessages() {
    setError(null);
    setMessage(null);
  }

  function prepareNewFormForOpen() {
    setNewForm((prev) => ({
      ...prev,
      platform: "",
      value: "",
      unit: "",
      note: "",
      link: "",
      isPrimary: progress.length === 0 ? true : prev.isPrimary,
    }));
  }

  function resetNewFormState() {
    setNewForm((prev) => ({
      ...prev,
      platform: "",
      value: "",
      unit: "",
      note: "",
      link: "",
      isPrimary: progress.length === 0,
    }));
  }

  function handleOpenNewForm() {
    resetMessages();
    prepareNewFormForOpen();
    setShowNewForm(true);
  }

  function handleCancelNewForm() {
    resetMessages();
    resetNewFormState();
    setShowNewForm(false);
  }

  async function handleCreate() {
    if (creating) return;
    resetMessages();
    setCreating(true);
    try {
      const valueInput = newForm.value.trim();
      if (!valueInput) {
        throw new ValidationError("請輸入進度數值");
      }
      const parsed = parseProgressForm({
        platform: newForm.platform,
        type: newForm.type,
        value: Number(valueInput),
        unit: newForm.unit || undefined,
        note: newForm.note || undefined,
        link: newForm.link || undefined,
        isPrimary: newForm.isPrimary,
      });
      const db = getFirebaseDb();
      const colRef = collection(db, "item", itemId, "progress");
      const docRef = await addDoc(colRef, {
        platform: parsed.platform,
        type: parsed.type,
        value: parsed.value,
        unit: parsed.unit ?? null,
        note: parsed.note ?? null,
        link: parsed.link ?? null,
        isPrimary: parsed.isPrimary,
        updatedAt: serverTimestamp(),
      });
      if (parsed.isPrimary) {
        await setPrimaryProgress(docRef.id);
      } else {
        await touchItemAfterProgressChange();
      }
      resetNewFormState();
      setMessage("已新增進度");
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message);
      } else {
        console.error("新增進度時發生錯誤", err);
        setError("新增進度時發生錯誤");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleSave(id: string, formState: ProgressFormState) {
    if (savingId) return;
    resetMessages();
    setSavingId(id);
    try {
      const valueInput = formState.value.trim();
      if (!valueInput) {
        throw new ValidationError("請輸入進度數值");
      }
      const parsed: ProgressFormData = parseProgressForm({
        platform: formState.platform,
        type: formState.type,
        value: Number(valueInput),
        unit: formState.unit || undefined,
        note: formState.note || undefined,
        link: formState.link || undefined,
        isPrimary: progress.find((record) => record.id === id)?.isPrimary ?? false,
      });
      const db = getFirebaseDb();
      await updateDoc(doc(db, "item", itemId, "progress", id), {
        platform: parsed.platform,
        type: parsed.type,
        value: parsed.value,
        unit: parsed.unit ?? null,
        note: parsed.note ?? null,
        link: parsed.link ?? null,
        updatedAt: serverTimestamp(),
      });
      await touchItemAfterProgressChange();
      setMessage("已更新進度");
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.message);
      } else {
        console.error("更新進度時發生錯誤", err);
        setError("更新進度時發生錯誤");
      }
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (deletingId) return;
    resetMessages();
    setDeletingId(id);
    try {
      const db = getFirebaseDb();
      await deleteDoc(doc(db, "item", itemId, "progress", id));
      await touchItemAfterProgressChange();
      setMessage("已刪除進度");
    } catch (err) {
      console.error("刪除進度時發生錯誤", err);
      setError("刪除進度時發生錯誤");
    } finally {
      setDeletingId(null);
    }
  }

  async function setPrimaryProgress(progressId: string) {
    if (primaryUpdatingId) return;
    resetMessages();
    setPrimaryUpdatingId(progressId);
    try {
      const db = getFirebaseDb();
      const colRef = collection(db, "item", itemId, "progress");
      const snap = await getDocs(colRef);
      const batch = writeBatch(db);
      let changed = false;
      snap.forEach((docSnap) => {
        const isTarget = docSnap.id === progressId;
        const current = docSnap.get("isPrimary") === true;
        if (current !== isTarget) {
          batch.update(docSnap.ref, { isPrimary: isTarget });
          changed = true;
        }
      });
      if (changed) {
        await batch.commit();
      }
      await touchItemAfterProgressChange();
      setMessage("已更新主進度");
    } catch (err) {
      console.error("設定主進度時發生錯誤", err);
      setError("設定主進度時發生錯誤");
    } finally {
      setPrimaryUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-600">{error}</div>}
      {message && <div className="text-sm text-green-600">{message}</div>}

      {loading ? (
        <p className="text-sm text-gray-500">進度載入中…</p>
      ) : (
        <div className="space-y-4">
          {progress.map((record) => (
            <ProgressRow
              key={record.id}
              record={record}
              onSave={handleSave}
              onDelete={handleDelete}
              onSetPrimary={setPrimaryProgress}
              saving={savingId === record.id}
              deleting={deletingId === record.id}
              primaryUpdatingId={primaryUpdatingId}
            />
          ))}
          {progress.length === 0 && (
            <p className="text-sm text-gray-500">尚未新增進度紀錄。</p>
          )}
        </div>
      )}

      <div className="space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">新增進度</h3>
          {showNewForm && (
            <button
              type="button"
              onClick={handleCancelNewForm}
              disabled={creating}
              className={buttonClass({ variant: "subtle", size: "sm" })}
            >
              收合
            </button>
          )}
        </div>

        {showNewForm ? (
          <div className="space-y-4">
            <ProgressFields
              state={newForm}
              onChange={(key, value) =>
                setNewForm((prev) => ({
                  ...prev,
                  [key]: value,
                }))
              }
              disabled={creating || Boolean(primaryUpdatingId)}
            />
            <label className="flex items-center gap-2 text-sm text-gray-700" htmlFor={primaryCheckboxId}>
              <input
                id={primaryCheckboxId}
                type="checkbox"
                checked={newForm.isPrimary}
                onChange={(event) =>
                  setNewForm((prev) => ({
                    ...prev,
                    isPrimary: event.target.checked,
                  }))
                }
                disabled={creating || Boolean(primaryUpdatingId)}
                className="h-4 w-4"
              />
              設為主進度（僅能有一筆）
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || Boolean(primaryUpdatingId)}
                className={`${buttonClass({ variant: "primary", size: "lg" })} w-full sm:w-auto`}
              >
                {creating ? "新增中…" : "儲存進度"}
              </button>
              <button
                type="button"
                onClick={handleCancelNewForm}
                disabled={creating}
                className={`${buttonClass({ variant: "secondary", size: "lg" })} w-full sm:w-auto`}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleOpenNewForm}
            disabled={Boolean(primaryUpdatingId)}
            className={buttonClass({ variant: "primary", size: "lg" })}
          >
            新增進度
          </button>
        )}
      </div>
    </div>
  );
}
