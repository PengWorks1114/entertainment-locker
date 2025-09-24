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

export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [colorSelectValue, setColorSelectValue] = useState<string>("");
  const [hasFocus, setHasFocus] = useState(false);

  const plainText = useMemo(() => createTextFromHtml(value), [value]);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }
    const currentHtml = editorRef.current.innerHTML;
    if (currentHtml === value) {
      return;
    }
    editorRef.current.innerHTML = value || "";
  }, [value]);

  function emitChange() {
    if (!editorRef.current) {
      return;
    }
    const rawHtml = editorRef.current.innerHTML;
    const html = normalizeHtml(rawHtml);
    const text = createTextFromHtml(html);
    if (editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
    onChange({ html, text });
  }

  function focusEditor() {
    if (!editorRef.current) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      editorRef.current.focus();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) {
      editorRef.current.focus();
    }
  }

  function applyFormat(command: string, valueArg?: string) {
    if (typeof window === "undefined") {
      return;
    }
    focusEditor();
    const applied = window.document.execCommand(command, false, valueArg ?? "");
    if (!applied && command === "formatBlock" && valueArg) {
      window.document.execCommand("formatBlock", false, valueArg);
    }
    emitChange();
  }

  function handleHeadingChange(event: ChangeEvent<HTMLSelectElement>) {
    const headingValue = event.target.value as "" | "p" | "h1" | "h2" | "h3";
    if (!headingValue) {
      return;
    }
    applyFormat("formatBlock", headingValue === "p" ? "p" : headingValue);
    event.target.value = "";
  }

  function handleColorChange(event: ChangeEvent<HTMLSelectElement>) {
    const colorValue = event.target.value;
    if (!colorValue) {
      return;
    }
    setColorSelectValue(colorValue);
    applyFormat("foreColor", colorValue);
    setTimeout(() => setColorSelectValue(""), 0);
  }

  function handleInput() {
    emitChange();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (typeof window !== "undefined") {
      window.document.execCommand("insertText", false, text);
    }
    emitChange();
  }

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar" role="toolbar" aria-label="文字編輯工具">
        <select
          className="rich-text-select"
          defaultValue=""
          onChange={handleHeadingChange}
          aria-label="段落樣式"
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
        >
          B
        </button>
        <button
          type="button"
          className="rich-text-button"
          onClick={() => applyFormat("underline")}
          aria-label="底線"
        >
          <span className="rich-text-underline">U</span>
        </button>
        <select
          className="rich-text-select"
          value={colorSelectValue}
          onChange={handleColorChange}
          aria-label="文字顏色"
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
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="筆記內容"
          onInput={handleInput}
          onBlur={() => {
            setHasFocus(false);
            emitChange();
          }}
          onFocus={() => setHasFocus(true)}
          onKeyUp={handleInput}
          onMouseUp={handleInput}
          onPaste={handlePaste}
          suppressContentEditableWarning
        />
      </div>
    </div>
  );
}

export type { RichTextEditorProps, RichTextValue };
export { createTextFromHtml as extractPlainTextFromHtml };
