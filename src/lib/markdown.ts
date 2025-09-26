function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(raw: string): string {
  let result = escapeHtml(raw);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/`(.+?)`/g, "<code>$1</code>");
  result = result.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return result;
}

export function simpleMarkdownToHtml(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const htmlChunks: string[] = [];
  let inList = false;
  let inOrderedList = false;
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (inList) {
        htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        inList = false;
        inOrderedList = false;
      }
      if (!inCodeBlock) {
        inCodeBlock = true;
        htmlChunks.push("<pre><code>");
      } else {
        inCodeBlock = false;
        htmlChunks.push("</code></pre>");
      }
      continue;
    }

    if (inCodeBlock) {
      htmlChunks.push(`${escapeHtml(rawLine)}\n`);
      continue;
    }

    if (!line.trim()) {
      if (inList) {
        htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        inList = false;
        inOrderedList = false;
      }
      htmlChunks.push("");
      continue;
    }

    if (line.startsWith("# ")) {
      if (inList) {
        htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        inList = false;
        inOrderedList = false;
      }
      htmlChunks.push(`<h1>${formatInlineMarkdown(line.slice(2).trim())}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) {
        htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        inList = false;
        inOrderedList = false;
      }
      htmlChunks.push(`<h2>${formatInlineMarkdown(line.slice(3).trim())}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      if (inList) {
        htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        inList = false;
        inOrderedList = false;
      }
      htmlChunks.push(`<h3>${formatInlineMarkdown(line.slice(4).trim())}</h3>`);
      continue;
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      if (!inList || !inOrderedList) {
        if (inList) {
          htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        }
        htmlChunks.push("<ol>");
        inList = true;
        inOrderedList = true;
      }
      htmlChunks.push(`<li>${formatInlineMarkdown(orderedMatch[2])}</li>`);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList || inOrderedList) {
        if (inList) {
          htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
        }
        htmlChunks.push("<ul>");
        inList = true;
        inOrderedList = false;
      }
      htmlChunks.push(`<li>${formatInlineMarkdown(line.slice(2).trim())}</li>`);
      continue;
    }

    if (inList) {
      htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
      inList = false;
      inOrderedList = false;
    }

    htmlChunks.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  if (inList) {
    htmlChunks.push(inOrderedList ? "</ol>" : "</ul>");
  }

  if (inCodeBlock) {
    htmlChunks.push("</code></pre>");
  }

  return htmlChunks.filter(Boolean).join("");
}

export function markdownPreviewHtml(markdown: string): string {
  const html = simpleMarkdownToHtml(markdown);
  return html || '<p class="text-sm text-gray-500">尚未輸入 Markdown 內容。</p>';
}

export function splitTags(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
