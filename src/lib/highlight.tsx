import type { ReactNode } from "react";

const DEFAULT_HIGHLIGHT_CLASS =
  "rounded bg-blue-200/80 px-1 text-gray-900 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.4)]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightMatches(
  text: string,
  query: string,
  highlightClassName: string = DEFAULT_HIGHLIGHT_CLASS
): ReactNode {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return text;
  }
  const escaped = escapeRegExp(trimmedQuery);
  if (!escaped) {
    return text;
  }
  const regex = new RegExp(escaped, "gi");
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (start > lastIndex) {
      segments.push(text.slice(lastIndex, start));
    }
    segments.push(
      <span key={`${start}-${end}`} className={highlightClassName}>
        {text.slice(start, end)}
      </span>
    );
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : text;
}
