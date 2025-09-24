"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";

type RichTextValue = {
  html: string;
  text: string;
};

type RichTextEditorProps = {
  value: string;
  onChange: (value: RichTextValue) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

const HEADING_OPTIONS: Array<{ label: string; value: "p" | "h1" | "h2" | "h3" }> = [
  { label: "正文", value: "p" },
  { label: "標題 1", value: "h1" },
  { label: "標題 2", value: "h2" },
  { label: "標題 3", value: "h3" },
];

const COLOR_OPTIONS: Array<{ label: string; value: string; swatch: string }> = [
  { label: "預設", value: "#1f2937", swatch: "#1f2937" },
  { label: "紅色", value: "#dc2626", swatch: "#dc2626" },
  { label: "橘色", value: "#ea580c", swatch: "#ea580c" },
  { label: "黃色", value: "#d97706", swatch: "#d97706" },
  { label: "綠色", value: "#16a34a", swatch: "#16a34a" },
  { label: "藍色", value: "#2563eb", swatch: "#2563eb" },
  { label: "紫色", value: "#7c3aed", swatch: "#7c3aed" },
];

function createTextFromHtml(html: string): string {
  if (typeof window === "undefined") {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const temp = window.document.createElement("div");
  temp.innerHTML = html;
  const text = temp.textContent ?? temp.innerText ?? "";
  return text.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
}

function normalizeHtml(html: string): string {
  return html
    .replace(/<div>/gi, "<p>")
    .replace(/<div\s([^>]*)>/gi, "<p $1>")
    .replace(/<\/div>/gi, "</p>")
    .replace(/<p><\/p>/g, "")
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<p>(?:&nbsp;|\s|<br\s*\/?>)*<\/p>/gi, "")
    .trim();
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  autoFocus = false,
  disabled = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedSelection = useRef<Range | null>(null);
  const [colorSelectValue, setColorSelectValue] = useState<string>("");
  const [headingSelectValue, setHeadingSelectValue] = useState<string>("");
  const [hasFocus, setHasFocus] = useState(false);

  const plainText = useMemo(() => createTextFromHtml(value), [value]);

  useEffect(() => {
    if (typeof window === "undefined" || !editorRef.current) {
      return;
    }
    if (hasFocus) {
      return;
    }
    const currentHtml = editorRef.current.innerHTML;
    if (currentHtml === value) {
      return;
    }
    editorRef.current.innerHTML = value || "";
  }, [hasFocus, value]);

  useEffect(() => {
    if (!autoFocus || disabled) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    const timer = window.setTimeout(() => {
      const element = editorRef.current;
      if (!element) {
        return;
      }
      element.focus();
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const range = window.document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      savedSelection.current = range.cloneRange();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [autoFocus, disabled]);

  function emitChange() {
    if (!editorRef.current) {
      return;
    }
    const rawHtml = editorRef.current.innerHTML;
    const html = normalizeHtml(rawHtml);
    const text = createTextFromHtml(html);
    onChange({ html, text });
  }

  function saveSelection() {
    if (typeof window === "undefined") {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      savedSelection.current = null;
      return;
    }
    const range = selection.getRangeAt(0);
    const { current } = editorRef;
    if (!current || !current.contains(range.startContainer) || !current.contains(range.endContainer)) {
      savedSelection.current = null;
      return;
    }
    savedSelection.current = range.cloneRange();
  }

  function restoreSelection() {
    if (typeof window === "undefined") {
      return;
    }
    const selection = window.getSelection();
    if (!selection || !savedSelection.current) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(savedSelection.current);
  }

  function focusEditor() {
    if (disabled) {
      return;
    }
    if (typeof window === "undefined" || !editorRef.current) {
      return;
    }
    const selection = window.getSelection();
    const needsFocus =
      !selection ||
      selection.rangeCount === 0 ||
      !editorRef.current.contains(selection.getRangeAt(0).startContainer);
    if (needsFocus) {
      editorRef.current.focus();
    }
    restoreSelection();
  }

  function applyFormat(command: string, valueArg?: string) {
    if (disabled) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    focusEditor();
    const applied = window.document.execCommand(command, false, valueArg ?? "");
    if (!applied && command === "formatBlock" && valueArg) {
      window.document.execCommand("formatBlock", false, valueArg);
    }
    emitChange();
    saveSelection();
  }

  function handleHeadingChange(event: ChangeEvent<HTMLSelectElement>) {
    if (disabled) {
      return;
    }
    const headingValue = event.target.value as "" | "p" | "h1" | "h2" | "h3";
    if (!headingValue) {
      return;
    }
    setHeadingSelectValue(headingValue);
    applyFormat("formatBlock", headingValue === "p" ? "p" : headingValue);
    setHeadingSelectValue("");
    focusEditor();
  }

  function handleColorChange(event: ChangeEvent<HTMLSelectElement>) {
    if (disabled) {
      return;
    }
    const colorValue = event.target.value;
    if (!colorValue) {
      return;
    }
    setColorSelectValue(colorValue);
    applyFormat("foreColor", colorValue);
    setTimeout(() => {
      setColorSelectValue("");
      focusEditor();
    }, 0);
  }

  function handleInput() {
    if (disabled) {
      return;
    }
    emitChange();
    saveSelection();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (typeof window !== "undefined") {
      window.document.execCommand("insertText", false, text);
    }
    emitChange();
    saveSelection();
  }

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar" role="toolbar" aria-label="文字編輯工具">
        <select
          className="rich-text-select"
          value={headingSelectValue}
          onChange={handleHeadingChange}
          aria-label="段落樣式"
          disabled={disabled}
        >
          <option value="" disabled>
            樣式
          </option>
          {HEADING_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rich-text-button"
          onClick={() => applyFormat("bold")}
          aria-label="粗體"
          disabled={disabled}
        >
          B
        </button>
        <button
          type="button"
          className="rich-text-button"
          onClick={() => applyFormat("underline")}
          aria-label="底線"
          disabled={disabled}
        >
          <span className="rich-text-underline">U</span>
        </button>
        <select
          className="rich-text-select"
          value={colorSelectValue}
          onChange={handleColorChange}
          aria-label="文字顏色"
          disabled={disabled}
        >
          <option value="" disabled>
            文字顏色
          </option>
          {COLOR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rich-text-button"
          onClick={() => applyFormat("removeFormat")}
          aria-label="清除格式"
          disabled={disabled}
        >
          清除
        </button>
      </div>
      <div className="rich-text-editor-shell">
        {!plainText && !hasFocus ? (
          <div className="rich-text-placeholder" aria-hidden>
            {placeholder ?? "輸入筆記內容"}
          </div>
        ) : null}
        <div
          ref={editorRef}
          className="rich-text-editable"
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-label="筆記內容"
          aria-disabled={disabled || undefined}
          onInput={handleInput}
          onBlur={() => {
            setHasFocus(false);
            savedSelection.current = null;
            emitChange();
          }}
          onFocus={() => {
            if (disabled) {
              return;
            }
            setHasFocus(true);
            setTimeout(() => {
              saveSelection();
            }, 0);
          }}
          onKeyUp={handleInput}
          onMouseUp={() => {
            saveSelection();
          }}
          onPaste={handlePaste}
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}

export type { RichTextEditorProps, RichTextValue };
export { createTextFromHtml as extractPlainTextFromHtml };
