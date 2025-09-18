"use client";

import { useMemo } from "react";

type ThumbLinkFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onEdit?: () => void;
};

export default function ThumbLinkField({
  value,
  onChange,
  disabled,
  onEdit,
}: ThumbLinkFieldProps) {
  const canOpen = useMemo(() => value.trim().length > 0, [value]);
  const canEdit = useMemo(
    () => Boolean(onEdit) && canOpen && !disabled,
    [onEdit, canOpen, disabled]
  );

  return (
    <div className="space-y-2">
      <label className="space-y-1 block">
        <span className="text-base">縮圖連結</span>
        <div className="flex gap-2">
          <input
            type="url"
            inputMode="url"
            placeholder="https://example.com/thumb.jpg"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="flex-1 h-12 rounded-xl border px-4 text-base"
          />
          <a
            href={canOpen ? value : "#"}
            target={canOpen ? "_blank" : undefined}
            rel={canOpen ? "noopener noreferrer" : undefined}
            className={`h-12 w-[88px] shrink-0 rounded-xl border text-base flex items-center justify-center transition ${
              canOpen
                ? "bg-black text-white"
                : "pointer-events-none text-gray-400"
            }`}
          >
            開啟
          </a>
          <button
            type="button"
            onClick={onEdit}
            disabled={!canEdit}
            className={`h-12 w-[104px] shrink-0 rounded-xl border text-base font-medium transition ${
              canEdit
                ? "bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700"
                : "cursor-not-allowed border-dashed text-gray-400"
            }`}
          >
            圖片編輯
          </button>
        </div>
      </label>
      <p className="text-xs text-gray-500">
        僅儲存外部縮圖網址，列表不會自動載入圖片。
      </p>
    </div>
  );
}
