import { NextRequest, NextResponse } from "next/server";

import {
  type ExternalCreator,
  type ExternalCreatorSource,
  type ExternalEpisode,
  type ExternalItemMetadata,
  type ExternalMetadataFact,
  type ExternalMetadataFactType,
} from "@/lib/external-metadata-types";
import type { ItemLanguage } from "@/lib/types";

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

const TITLE_ALIAS_PATTERN = /[\(（［\[]([^\)）］\]]+)[\)）］\]]/g;
const TITLE_SLASH_SEPARATORS = /[\/|｜]/;
const TITLE_ROLE_KEYWORDS = [
  "作者",
  "原作",
  "著者",
  "著",
  "文",
  "圖",
  "繪",
  "畫",
  "作畫",
  "漫畫",
  "插畫",
  "出版社",
  "出版",
  "發行",
  "発行",
  "監修",
  "編輯",
  "編",
  "編集",
  "翻譯",
  "翻訳",
  "譯",
  "訳",
  "illustrator",
  "translator",
  "editor",
  "publisher",
  "author",
  "writer",
];
const NEXT_UPDATE_META_KEYS = [
  "next_update",
  "nextupdate",
  "next-release",
  "nextrelease",
  "next_air",
  "nextair",
  "next_episode",
  "next-episode",
  "next-chapter",
  "nextchapter",
  "next-issue",
  "nextissue",
  "next-publication",
  "nextpublication",
  "next-publish",
  "nextpublish",
];
const PUBLISHED_META_KEYS = [
  "article:published_time",
  "og:published_time",
  "publish-date",
  "publish_date",
  "datepublished",
  "date_published",
  "dc.date",
  "dc:date",
  "pubdate",
  "datecreated",
  "date-created",
];
const UPDATED_META_KEYS = [
  "article:modified_time",
  "og:updated_time",
  "og:modified_time",
  "last-modified",
  "last_modified",
  "datemodified",
  "date_modified",
  "updated_time",
  "modified",
  "dateupdated",
];

const BOOK_AUTHOR_META_KEYS = [
  "book:author",
  "books:author",
  "book:authors",
  "books:authors",
  "dcterms:creator",
  "dc.creator",
  "dc:creator",
  "dc.contributor",
  "dcterms:contributor",
];

const BOOK_PUBLISHER_META_KEYS = [
  "book:publisher",
  "books:publisher",
  "dcterms:publisher",
  "dc.publisher",
  "dc:publisher",
];

const BOOK_RELEASE_META_KEYS = [
  "book:release_date",
  "books:release_date",
  "book:publication_date",
  "books:publication_date",
  "release_date",
  "release-date",
  "release date",
  "published_time",
  "publication_date",
  "publication-date",
];

const BOOK_PAGE_META_KEYS = [
  "book:page_count",
  "books:page_count",
  "pagecount",
  "page_count",
  "number_of_pages",
  "number-of-pages",
  "dcterms:extent",
];

type TextFactConfig = {
  type: ExternalMetadataFactType;
  labels: string[];
};

const TEXT_FACT_CONFIG: TextFactConfig[] = [
  {
    type: "author",
    labels: ["作者", "作者名", "著者", "著", "Author", "Written by", "Writer"],
  },
  {
    type: "publisher",
    labels: ["出版社", "出版", "出版者", "発行", "Publisher", "Imprint"],
  },
  {
    type: "pages",
    labels: ["頁數", "页数", "ページ数", "ページ", "Pages", "Page Count"],
  },
  {
    type: "tag",
    labels: ["標籤", "标签", "タグ", "分類", "ジャンル", "Genre", "Category"],
  },
  {
    type: "date",
    labels: [
      "發售日",
      "發行日",
      "発売日",
      "出版日",
      "公開日",
      "更新日",
      "Release Date",
      "Published",
      "Publication Date",
    ],
  },
  {
    type: "title",
    labels: ["作品名", "原題", "タイトル", "書名", "Title", "Product Name"],
  },
  {
    type: "name",
    labels: ["本名", "名稱", "名称", "名前", "Name"],
  },
];

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  '#39': "'",
};

const CREATOR_SOURCE_WEIGHTS: Record<ExternalCreatorSource, number> = {
  schema: 0.9,
  meta: 0.8,
  twitter: 0.6,
  feed: 0.5,
  page: 0.45,
};

type MetaTag = {
  name?: string;
  property?: string;
  content?: string;
};

type LinkTag = {
  rel?: string;
  href?: string;
  type?: string;
  title?: string;
};

type FeedLink = {
  url: string;
  type: string | null;
};

type FeedData = {
  title: string | null;
  alternateTitles: string[];
  author: string | null;
  language: string | null;
  image: string | null;
  episode: string | null;
  summary: string | null;
  siteName: string | null;
  published: string | null;
  updated: string | null;
  nextUpdate: string | null;
};

type SchemaCreator = {
  name: string;
  isOrganization: boolean;
  role: string | null;
};

type SchemaSummary = {
  titles: string[];
  alternateTitles: string[];
  language: string | null;
  image: string | null;
  creators: SchemaCreator[];
  episode: string | null;
  description: string | null;
  siteNames: string[];
  published: string | null;
  updated: string | null;
  nextUpdate: string | null;
  keywords: string[];
  facts: ExternalMetadataFact[];
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
    const lowered = entity.toLowerCase();
    if (HTML_ENTITY_MAP[lowered]) {
      return HTML_ENTITY_MAP[lowered];
    }
    if (lowered.startsWith("#x")) {
      const code = Number.parseInt(lowered.slice(2), 16);
      return Number.isNaN(code) ? "" : String.fromCodePoint(code);
    }
    if (lowered.startsWith("#")) {
      const code = Number.parseInt(lowered.slice(1), 10);
      return Number.isNaN(code) ? "" : String.fromCodePoint(code);
    }
    return "";
  });
}

function stripCdata(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("<![CDATA[") && trimmed.endsWith("]]>")) {
    return trimmed.slice(9, -3).trim();
  }
  if (trimmed.startsWith("<![CDATA[") && trimmed.endsWith("]]>")) {
    return trimmed.slice(9, -3).trim();
  }
  return trimmed;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTextValue(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const stripped = stripHtmlTags(decodeHtmlEntities(stripCdata(input)));
  const cleaned = normalizeWhitespace(stripped);
  return cleaned || null;
}

function splitKeywordString(input: string): string[] {
  return input
    .split(/[;；,，、|｜\/／]+/)
    .map((entry) => cleanTextValue(entry) ?? "")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeDateString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numericOnly = trimmed.replace(/[^0-9]/g, "");
  if (numericOnly.length === 8) {
    const year = Number.parseInt(numericOnly.slice(0, 4), 10);
    const month = Number.parseInt(numericOnly.slice(4, 6), 10);
    const day = Number.parseInt(numericOnly.slice(6, 8), 10);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const iso = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(iso.getTime())) {
        return iso.toISOString();
      }
    }
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectSiteNameTokens(sourceName: string | null, url: string): string[] {
  const tokens = new Set<string>();
  const append = (value: string | null | undefined) => {
    if (!value) return;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;
    tokens.add(normalized);
    normalized
      .replace(/[.]+/g, " ")
      .split(/[\s|｜:/_-]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3)
      .forEach((part) => tokens.add(part.toLowerCase()));
  };
  append(sourceName);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    append(host);
    append(host.replace(/^www\./, ""));
    const parts = host.split(".");
    if (parts.length >= 2) {
      append(parts.slice(0, -1).join("."));
      append(parts[parts.length - 2]);
    }
    parts
      .filter((part) => part.length >= 3)
      .forEach((part) => tokens.add(part.toLowerCase()));
  } catch {
    // ignore URL parsing errors
  }
  return Array.from(tokens);
}

function extractMetaKeywords(metaTags: MetaTag[]): string[] {
  const keywords: string[] = [];
  metaTags.forEach((tag) => {
    const rawKey = (tag.name ?? tag.property ?? "").trim();
    if (!rawKey) {
      return;
    }
    const lowered = rawKey.toLowerCase();
    const shouldCollect =
      lowered === "keywords" ||
      lowered === "news_keywords" ||
      lowered.endsWith(":tag") ||
      lowered.includes("keyword") ||
      lowered.includes("tag") ||
      lowered.includes("genre") ||
      lowered.includes("category") ||
      rawKey.includes("タグ") ||
      rawKey.includes("標籤") ||
      rawKey.includes("分類") ||
      rawKey.includes("ジャンル");
    if (!shouldCollect) {
      return;
    }
    const content = cleanTextValue(tag.content ?? null);
    if (!content) {
      return;
    }
    splitKeywordString(content).forEach((entry) => {
      if (entry) {
        keywords.push(entry);
      }
    });
  });
  return keywords;
}

function sanitizeTitleCandidate(
  value: string,
  tokens: string[]
): string | null {
  const cleaned = cleanTextValue(value);
  if (!cleaned) {
    return null;
  }
  let result = cleaned;
  tokens.forEach((token) => {
    if (!token) return;
    const escaped = escapeRegExp(token);
    const separator = "[\\s]*[:：\\-–—|｜]+[\\s]*";
    result = result.replace(
      new RegExp(`^${escaped}${separator}`, "i"),
      ""
    );
    result = result.replace(
      new RegExp(`${separator}${escaped}$`, "i"),
      ""
    );
    result = result.replace(new RegExp(`\\(${escaped}\\)$`, "i"), "");
    result = result.replace(new RegExp(`^${escaped}$`, "i"), "");
  });
  result = result.replace(/\s+/g, " ").trim();
  return result || null;
}

function isLikelyNonTitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }
  if (/^isbn\s*\d+/i.test(trimmed)) {
    return true;
  }
  if (/^(by|author|writer|publisher|illustrator|translator|edited by|translated by)/i.test(trimmed)) {
    return true;
  }
  if (/[：:\/／]/.test(trimmed)) {
    const segments = trimmed.split(/[：:\/／]/).map((segment) => segment.trim());
    if (segments.length >= 2) {
      const first = segments[0]?.toLowerCase() ?? "";
      if (TITLE_ROLE_KEYWORDS.some((keyword) => keyword.toLowerCase() === first)) {
        return true;
      }
      if (
        TITLE_ROLE_KEYWORDS.some((keyword) =>
          new RegExp(`${keyword}`, "i").test(segments[0] ?? "")
        )
      ) {
        return true;
      }
      if (
        TITLE_ROLE_KEYWORDS.some((keyword) =>
          new RegExp(`${keyword}`, "i").test(segments[1] ?? "")
        )
      ) {
        return true;
      }
    }
  }
  const lowered = trimmed.toLowerCase();
  if (TITLE_ROLE_KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()))) {
    const lengthWithoutKeyword = lowered.replace(
      new RegExp(
        TITLE_ROLE_KEYWORDS.map((keyword) => escapeRegExp(keyword.toLowerCase())).join("|")
      ),
      ""
    ).trim();
    if (!lengthWithoutKeyword) {
      return true;
    }
  }
  return false;
}

type PreferredLanguage = ItemLanguage | "other";

function pickTitleByLanguage(
  list: { value: string; priority: number }[],
  order: PreferredLanguage[]
): string | null {
  for (const language of order) {
    const match = list.find((entry) => {
      const detected = detectLanguageFromText(entry.value);
      if (language === "other") {
        return !detected;
      }
      return detected === language;
    });
    if (match) {
      return match.value;
    }
  }
  return null;
}

function selectPrimaryTitle(
  processed: { value: string; priority: number }[],
  fallback: { value: string; priority: number }[],
  tokens: string[]
): string | null {
  const preference: PreferredLanguage[] = ["zh", "ja", "en", "ko", "other"];
  const processedMatch = pickTitleByLanguage(processed, preference);
  if (processedMatch) {
    return processedMatch;
  }
  if (processed.length > 0) {
    return processed[0].value;
  }
  const filteredFallback = fallback.filter(
    (entry) => !matchesSiteToken(entry.value, tokens)
  );
  const fallbackMatch = pickTitleByLanguage(filteredFallback, preference);
  if (fallbackMatch) {
    return fallbackMatch;
  }
  const firstNonToken = filteredFallback[0] ?? fallback.find(
    (entry) => !matchesSiteToken(entry.value, tokens)
  );
  if (firstNonToken) {
    return firstNonToken.value;
  }
  return fallback[0]?.value ?? null;
}

function matchesSiteToken(value: string, tokens: string[]): boolean {
  const lowered = value.trim().toLowerCase();
  if (!lowered) {
    return false;
  }
  const compact = lowered.replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, "");
  return tokens.some((token) => {
    const normalized = token.toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === lowered) {
      return true;
    }
    if (normalized === compact && normalized.length >= 3) {
      return true;
    }
    if (normalized.length >= 4 && lowered.includes(normalized)) {
      return true;
    }
    return false;
  });
}

function extractHeadingTitle(fullHtml: string): string | null {
  const sanitized = fullHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const pattern = /<(h1|h2)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitized))) {
    const value = cleanTextValue(match[2] ?? "");
    if (value && value.length >= 2 && !isLikelyNonTitle(value)) {
      return value;
    }
  }
  return null;
}

function isLikelyGenericImage(
  candidate: string,
  pageUrl: string,
  tokens: string[]
): boolean {
  try {
    const parsed = new URL(candidate, pageUrl);
    const pathname = parsed.pathname.toLowerCase();
    const filename = pathname.split("/").pop() ?? "";
    const extensionMatch = filename.match(/\.([a-z0-9]+)(?:$|\?)/);
    if (extensionMatch && !["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "avif", "jfif"].includes(extensionMatch[1])) {
      return true;
    }
    const genericKeywords = [
      "logo",
      "favicon",
      "icon",
      "sprite",
      "placeholder",
      "default",
      "opengraph",
      "og-image",
      "twitter",
      "share",
      "social",
      "apple-touch",
    ];
    if (genericKeywords.some((keyword) => pathname.includes(keyword))) {
      return true;
    }
    if (
      filename &&
      tokens.some(
        (token) => token.length >= 4 && filename.includes(token.replace(/[^a-z0-9]/g, ""))
      )
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function selectBestImage(
  candidates: string[],
  pageUrl: string,
  tokens: string[]
): string | null {
  const strong: string[] = [];
  const fallback: string[] = [];
  const seen = new Set<string>();
  candidates.forEach((candidate) => {
    const value = cleanTextValue(candidate);
    if (!value) {
      return;
    }
    const normalized = resolveUrl(pageUrl, value) ?? value;
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    if (isLikelyGenericImage(normalized, pageUrl, tokens)) {
      fallback.push(normalized);
    } else {
      strong.push(normalized);
    }
  });
  return strong[0] ?? fallback[0] ?? null;
}

function resolveUrl(base: string, value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function extractInlineImages(
  html: string,
  pageUrl: string,
  tokens: string[]
): string[] {
  const sanitized = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const pattern = /<img\b([^>]*?)>/gi;
  const results: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitized))) {
    const attrs = parseAttributes(match[1] ?? "");
    const candidates: Array<string | undefined> = [
      attrs.src,
      attrs["data-src"],
      attrs["data-original"],
      attrs["data-lazy-src"],
      attrs["data-zoom-src"],
    ];
    const srcset = attrs.srcset ?? attrs["data-srcset"];
    if (srcset) {
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      if (first) {
        candidates.push(first);
      }
    }
    let candidate: string | null = null;
    for (const item of candidates) {
      if (typeof item === "string" && item.trim()) {
        candidate = item.trim();
        break;
      }
    }
    if (!candidate || candidate.startsWith("data:")) {
      continue;
    }
    const resolved = resolveUrl(pageUrl, candidate) ?? candidate;
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    const alt = attrs.alt ?? "";
    if (alt && /logo|icon|placeholder|transparent|pixel/i.test(alt)) {
      continue;
    }
    if (isLikelyGenericImage(resolved, pageUrl, tokens)) {
      results.push(resolved);
    } else {
      results.unshift(resolved);
    }
    if (results.length >= 30) {
      break;
    }
  }
  return Array.from(new Set(results));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...init.headers,
      },
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function extractHeadSection(html: string): string {
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (match) {
    return match[1];
  }
  return html.slice(0, 20000);
}

function parseAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fragment))) {
    const key = match[1].toLowerCase();
    const value = (match[3] ?? match[4] ?? "").trim();
    attributes[key] = value;
  }
  return attributes;
}

function parseMetaTags(head: string): MetaTag[] {
  const results: MetaTag[] = [];
  const pattern = /<meta\b([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(head))) {
    const attrs = parseAttributes(match[1]);
    if (attrs.name || attrs.property) {
      results.push({
        name: attrs.name,
        property: attrs.property,
        content: attrs.content ?? attrs["value"],
      });
    }
  }
  return results;
}

function parseLinkTags(head: string): LinkTag[] {
  const results: LinkTag[] = [];
  const pattern = /<link\b([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(head))) {
    const attrs = parseAttributes(match[1]);
    results.push({
      rel: attrs.rel,
      href: attrs.href,
      type: attrs.type ?? null,
      title: attrs.title ?? null,
    });
  }
  return results;
}

function parseHtmlTitle(head: string): string | null {
  const match = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }
  return decodeHtmlEntities(stripCdata(match[1] ?? "")).trim() || null;
}

function extractHtmlLang(html: string): string | null {
  const match = html.match(/<html[^>]*\blang\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!match) {
    return null;
  }
  const value = (match[2] ?? match[3] ?? "").trim();
  return value || null;
}

function parseJsonLdBlocks(head: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(head))) {
    const attrs = parseAttributes(match[1]);
    if ((attrs.type ?? "").toLowerCase() !== "application/ld+json") {
      continue;
    }
    const content = match[2] ?? "";
    const sanitized = content
      .replace(/<\!--[\s\S]*?-->/g, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .trim();
    if (!sanitized) {
      continue;
    }
    try {
      const parsed = JSON.parse(sanitized);
      blocks.push(parsed);
    } catch {
      continue;
    }
  }
  return blocks;
}

function extractTextFacts(html: string): ExternalMetadataFact[] {
  const sanitized = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<p\b[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n");
  const text = decodeHtmlEntities(sanitized.replace(/<[^>]+>/g, "\n"));
  const rawLines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const lines = rawLines.slice(0, 800);
  const facts: ExternalMetadataFact[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lowered = line.toLowerCase();
    let matched = false;
    for (const config of TEXT_FACT_CONFIG) {
      for (const label of config.labels) {
        const labelLower = label.toLowerCase();
        let value: string | null = null;
        let consumedNextLine = false;
        const directPattern = new RegExp(
          `^${escapeRegExp(label)}\s*[：:>】\)]*\s*(.+)$`,
          "i"
        );
        const directMatch = line.match(directPattern);
        if (directMatch && directMatch[1]) {
          value = directMatch[1].trim();
        } else if (lowered === labelLower) {
          const nextLine = lines[i + 1] ?? "";
          if (nextLine) {
            value = nextLine.trim();
            consumedNextLine = true;
          }
        }
        if (!value) {
          continue;
        }
        value = value.replace(/^[：:]/, "").trim();
        if (!value) {
          continue;
        }
        if (value.length > 160) {
          value = value.slice(0, 160).trim();
        }
        if (config.type === "tag") {
          const items = splitKeywordString(value);
          if (items.length === 0) {
            continue;
          }
          items.forEach((item) => {
            const key = `${config.type}:${label}:${item}`.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              facts.push({ type: config.type, label, value: item });
            }
          });
        } else {
          const key = `${config.type}:${label}:${value}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            facts.push({ type: config.type, label, value });
          }
        }
        if (consumedNextLine) {
          i += 1;
        }
        matched = true;
        break;
      }
      if (matched) {
        break;
      }
    }
  }

  return facts;
}

function discoverFeedLinks(links: LinkTag[], baseUrl: string): FeedLink[] {
  const feeds: FeedLink[] = [];
  links.forEach((link) => {
    const relValue = (link.rel ?? "").toLowerCase();
    if (!relValue.includes("alternate")) {
      return;
    }
    const typeValue = (link.type ?? "").toLowerCase();
    if (
      !typeValue.includes("xml") &&
      !typeValue.includes("json") &&
      !typeValue.includes("atom") &&
      !typeValue.includes("rss")
    ) {
      return;
    }
    const resolved = resolveUrl(baseUrl, link.href ?? null);
    if (!resolved) {
      return;
    }
    feeds.push({ url: resolved, type: typeValue || null });
  });
  return feeds;
}

function parseXmlFeed(content: string): FeedData | null {
  const channelLangMatch = content.match(/<channel[\s\S]*?<language>([\s\S]*?)<\/language>/i);
  const feedLangMatch = content.match(/<feed[^>]*\bxml:lang\s*=\s*("([^"]*)"|'([^']*)')/i);
  const language =
    stripCdata(channelLangMatch?.[1] ?? "").trim() ||
    (feedLangMatch ? (feedLangMatch[2] ?? feedLangMatch[3] ?? "").trim() : "") ||
    null;

  const channelTitleMatch = content.match(
    /<(?:channel|feed)[^>]*>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i
  );
  const siteName = cleanTextValue(channelTitleMatch?.[1] ?? null);

  const itemMatch = content.match(/<item\b[\s\S]*?<\/item>/i);
  const entryMatch = content.match(/<entry\b[\s\S]*?<\/entry>/i);
  const target = itemMatch?.[0] ?? entryMatch?.[0] ?? "";
  if (!target) {
    return {
      title: null,
      alternateTitles: [],
      author: null,
      language,
      image: null,
      episode: null,
      summary: null,
      siteName,
      published: null,
      updated: null,
      nextUpdate: null,
    };
  }

  const titleMatch = target.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const creatorMatch =
    target.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) ||
    target.match(/<author[^>]*>([\s\S]*?)<\/author>/i);
  const enclosureMatch = target.match(/<enclosure[^>]*\burl\s*=\s*("([^"]*)"|'([^']*)')/i);
  const mediaContentMatch = target.match(/<media:content[^>]*\burl\s*=\s*("([^"]*)"|'([^']*)')/i);
  const episodeMatch =
    target.match(/<episode[^>]*>([\s\S]*?)<\/episode>/i) ||
    target.match(/<episodeNumber[^>]*>([\s\S]*?)<\/episodeNumber>/i);
  const descriptionMatch =
    target.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
    target.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const contentMatch = target.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
  const publishedMatch =
    target.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
    target.match(/<published[^>]*>([\s\S]*?)<\/published>/i);
  const updatedMatch =
    target.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) ||
    target.match(/<lastBuildDate[^>]*>([\s\S]*?)<\/lastBuildDate>/i);
  const nextUpdateMatch =
    target.match(/<nextUpdate[^>]*>([\s\S]*?)<\/nextUpdate>/i) ||
    target.match(/<next_update[^>]*>([\s\S]*?)<\/next_update>/i);

  const title = titleMatch ? stripCdata(titleMatch[1] ?? "") : "";
  const creator = creatorMatch ? stripCdata(creatorMatch[1] ?? "") : "";
  const image = enclosureMatch
    ? enclosureMatch[2] ?? enclosureMatch[3] ?? ""
    : mediaContentMatch
    ? mediaContentMatch[2] ?? mediaContentMatch[3] ?? ""
    : "";
  const episode = episodeMatch ? stripCdata(episodeMatch[1] ?? "") : "";
  const description = descriptionMatch
    ? descriptionMatch[1] ?? ""
    : contentMatch
    ? contentMatch[1] ?? ""
    : "";

  return {
    title: decodeHtmlEntities(title).trim() || null,
    alternateTitles: [],
    author: decodeHtmlEntities(creator).trim() || null,
    language: language || null,
    image: decodeHtmlEntities(image).trim() || null,
    episode: decodeHtmlEntities(episode).trim() || null,
    summary: cleanTextValue(description),
    siteName,
    published: normalizeDateString(publishedMatch?.[1]),
    updated: normalizeDateString(updatedMatch?.[1]),
    nextUpdate: normalizeDateString(nextUpdateMatch?.[1]),
  };
}

function parseJsonFeed(content: string): FeedData | null {
  try {
    const data = JSON.parse(content);
    const title =
      typeof data?.title === "string" ? data.title.trim() : null;
    const items = Array.isArray(data?.items) ? data.items : [];
    const firstItem = items[0] ?? null;
    const itemTitle =
      firstItem && typeof firstItem.title === "string"
        ? firstItem.title.trim()
        : null;
    const authorField =
      firstItem && typeof firstItem.author === "string"
        ? firstItem.author.trim()
        : null;
    const authorsArray =
      firstItem && Array.isArray(firstItem.authors)
        ? firstItem.authors
            .map((entry: unknown) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const name = (entry as { name?: unknown }).name;
              return typeof name === "string" ? name.trim() : null;
            })
            .filter((value: string | null): value is string => Boolean(value))
        : [];
    const image =
      firstItem && typeof firstItem.image === "string"
        ? firstItem.image.trim()
        : typeof data?.image === "string"
        ? (data.image as string).trim()
        : null;
    const language =
      typeof data?.language === "string"
        ? data.language.trim()
        : typeof data?.language === "number"
        ? String(data.language)
        : null;
    const episode =
      firstItem && typeof firstItem.episode === "string"
        ? firstItem.episode.trim()
        : firstItem && typeof firstItem.number === "number"
        ? String(firstItem.number)
        : null;
    const summary =
      firstItem && typeof firstItem.summary === "string"
        ? firstItem.summary
        : firstItem && typeof firstItem.content_text === "string"
        ? firstItem.content_text
        : firstItem && typeof firstItem.content_html === "string"
        ? firstItem.content_html
        : null;
    const published =
      firstItem && typeof firstItem.date_published === "string"
        ? firstItem.date_published
        : typeof data?.date_published === "string"
        ? data.date_published
        : null;
    const updated =
      firstItem && typeof firstItem.date_modified === "string"
        ? firstItem.date_modified
        : typeof data?.date_modified === "string"
        ? data.date_modified
        : null;
    const nextUpdate =
      typeof data?.next_update === "string"
        ? data.next_update
        : typeof data?.nextUpdate === "string"
        ? data.nextUpdate
        : null;
    const author = authorField ?? authorsArray[0] ?? null;

    return {
      title: itemTitle ?? title ?? null,
      alternateTitles: title && itemTitle && title !== itemTitle ? [title] : [],
      author,
      language,
      image,
      episode,
      summary: cleanTextValue(summary),
      siteName: cleanTextValue(title),
      published: normalizeDateString(published),
      updated: normalizeDateString(updated),
      nextUpdate: normalizeDateString(nextUpdate),
    };
  } catch {
    return null;
  }
}

async function loadFeedData(
  feeds: FeedLink[]
): Promise<{ data: FeedData | null; url: string | null }> {
  for (const feed of feeds) {
    try {
      const response = await fetchWithTimeout(feed.url, {
        headers: {
          Accept:
            feed.type && feed.type.includes("json")
              ? "application/json, */*"
              : "application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!response.ok) {
        continue;
      }
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? feed.type;
      const normalizedType = (contentType ?? "").toLowerCase();
      let parsed: FeedData | null = null;
      if (normalizedType.includes("json")) {
        parsed = parseJsonFeed(text);
      } else {
        parsed = parseXmlFeed(text);
      }
      if (parsed) {
        return { data: parsed, url: feed.url };
      }
    } catch (err) {
      console.debug("loadFeedData failed", feed.url, err);
      continue;
    }
  }
  return { data: null, url: null };
}

function collectSchemaNodes(input: unknown, collector: Record<string, unknown>[]) {
  if (!input) {
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((entry) => collectSchemaNodes(entry, collector));
    return;
  }
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (record["@type"] || record["@context"]) {
      collector.push(record);
    }
    if (record["@graph"]) {
      collectSchemaNodes(record["@graph"], collector);
    }
  }
}

function normalizeSchemaCreators(
  value: unknown,
  defaultRole = "author"
): SchemaCreator[] {
  if (!value) {
    return [];
  }
  const entries: SchemaCreator[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      entries.push(...normalizeSchemaCreators(entry, defaultRole));
    });
    return entries;
  }
  if (typeof value === "string") {
    const name = value.trim();
    if (!name) {
      return [];
    }
    return [
      {
        name,
        isOrganization: looksLikeOrganization(name),
        role: defaultRole,
      },
    ];
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nameValue =
      typeof record.name === "string" ? record.name.trim() : null;
    if (!nameValue) {
      return [];
    }
    const typeValue = record["@type"];
    const typeList = Array.isArray(typeValue)
      ? typeValue.map((entry) => String(entry ?? ""))
      : typeof typeValue === "string"
      ? [typeValue]
      : [];
    const isOrganization = typeList.some((type) =>
      ["Organization", "Corporation", "Company"].includes(type)
    );
    const jobTitle =
      typeof record.jobTitle === "string" ? record.jobTitle.trim() : null;
    return [
      {
        name: nameValue,
        isOrganization: isOrganization || looksLikeOrganization(nameValue),
        role: jobTitle || defaultRole,
      },
    ];
  }
  return [];
}

function extractSchemaSummary(blocks: unknown[], baseUrl: string): SchemaSummary {
  const nodes: Record<string, unknown>[] = [];
  blocks.forEach((block) => collectSchemaNodes(block, nodes));
  const titles: string[] = [];
  const alternateTitles: string[] = [];
  let language: string | null = null;
  let image: string | null = null;
  let episode: string | null = null;
  const creators: SchemaCreator[] = [];
  const siteNameSet = new Set<string>();
  let description: string | null = null;
  let published: string | null = null;
  let updated: string | null = null;
  let nextUpdate: string | null = null;
  const keywords: string[] = [];
  const facts: ExternalMetadataFact[] = [];

  const appendCreators = (value: unknown, role: string) => {
    const entries = normalizeSchemaCreators(value, role);
    if (entries.length > 0) {
      creators.push(...entries);
    }
  };

  const appendKeywords = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      keywords.push(...splitKeywordString(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => appendKeywords(entry));
      return;
    }
    if (typeof value === "object") {
      const record = value as { name?: unknown; value?: unknown };
      if (typeof record.name === "string") {
        keywords.push(...splitKeywordString(record.name));
      } else if (typeof record.value === "string") {
        keywords.push(...splitKeywordString(record.value));
      }
    }
  };

  const appendFact = (fact: ExternalMetadataFact) => {
    if (!fact.value) {
      return;
    }
    facts.push(fact);
  };

  nodes.forEach((node) => {
    const titleCandidates: unknown[] = [];
    if (node.headline) titleCandidates.push(node.headline);
    if (node.name) titleCandidates.push(node.name);
    if (node.title) titleCandidates.push(node.title);
    if ((node as { alternativeHeadline?: unknown }).alternativeHeadline) {
      titleCandidates.push((node as { alternativeHeadline?: unknown }).alternativeHeadline);
    }
    titleCandidates.forEach((candidate) => {
      if (typeof candidate === "string") {
        const value = candidate.trim();
        if (value) {
          titles.push(value);
          alternateTitles.push(...extractTitleAliases(value));
        }
      }
    });
    if (node.alternateName) {
      if (typeof node.alternateName === "string") {
        alternateTitles.push(node.alternateName.trim());
      } else if (Array.isArray(node.alternateName)) {
        node.alternateName.forEach((entry) => {
          if (typeof entry === "string") {
            alternateTitles.push(entry.trim());
          }
        });
      }
    }
    if (!language && typeof node.inLanguage === "string") {
      language = node.inLanguage.trim();
    }
    if (!language && typeof node.language === "string") {
      language = node.language.trim();
    }
    if (!episode && typeof node.episodeNumber === "string") {
      episode = node.episodeNumber.trim();
    }
    if (!episode && typeof node.episodeNumber === "number") {
      episode = String(node.episodeNumber);
    }
    const imageField = node.image ?? node.thumbnailUrl;
    if (!image && typeof imageField === "string") {
      image = resolveUrl(baseUrl, imageField) ?? imageField;
    } else if (!image && Array.isArray(imageField)) {
      const firstImage = imageField.find((entry) => typeof entry === "string");
      if (typeof firstImage === "string") {
        image = resolveUrl(baseUrl, firstImage) ?? firstImage;
      }
    } else if (
      !image &&
      imageField &&
      typeof imageField === "object" &&
      (imageField as { url?: unknown }).url
    ) {
      const urlValue = (imageField as { url?: unknown }).url;
      if (typeof urlValue === "string") {
        image = resolveUrl(baseUrl, urlValue) ?? urlValue;
      }
    }

    appendCreators(node.author, "author");
    appendCreators(node.creator, "creator");
    appendCreators((node as { illustrator?: unknown }).illustrator, "illustrator");
    appendCreators((node as { editor?: unknown }).editor, "editor");
    appendCreators((node as { translator?: unknown }).translator, "translator");
    appendCreators((node as { contributor?: unknown }).contributor, "contributor");
    appendCreators((node as { producer?: unknown }).producer, "producer");
    appendCreators((node as { director?: unknown }).director, "director");
    appendCreators((node as { musicBy?: unknown }).musicBy, "music");
    appendCreators((node as { actor?: unknown }).actor, "actor");
    appendCreators((node as { brand?: unknown }).brand, "brand");
    appendCreators((node as { manufacturer?: unknown }).manufacturer, "manufacturer");
    appendCreators((node as { productionCompany?: unknown }).productionCompany, "production");

    if (node.publisher) {
      const publisherEntries = normalizeSchemaCreators(node.publisher, "publisher");
      creators.push(...publisherEntries);
      publisherEntries.forEach((publisher) => {
        siteNameSet.add(publisher.name);
      });
    }

    if (!description && typeof node.description === "string") {
      description = node.description.trim();
    }
    if (!published && typeof node.datePublished === "string") {
      published = node.datePublished.trim();
    }
    if (!updated && typeof node.dateModified === "string") {
      updated = node.dateModified.trim();
    }
    if (!nextUpdate && typeof (node as { endDate?: unknown }).endDate === "string") {
      nextUpdate = ((node as { endDate?: string }).endDate ?? "").trim();
    }
    if (
      !nextUpdate &&
      typeof (node as { availabilityEnds?: unknown }).availabilityEnds === "string"
    ) {
      nextUpdate = (
        (node as { availabilityEnds?: string }).availabilityEnds ?? ""
      ).trim();
    }
    if (!nextUpdate && typeof (node as { expires?: unknown }).expires === "string") {
      nextUpdate = ((node as { expires?: string }).expires ?? "").trim();
    }

    appendKeywords((node as { keywords?: unknown }).keywords);
    appendKeywords((node as { genre?: unknown }).genre);
    appendKeywords((node as { about?: unknown }).about);
    appendKeywords((node as { tag?: unknown }).tag);
    appendKeywords((node as { category?: unknown }).category);

    if ((node as { numberOfPages?: unknown }).numberOfPages !== undefined) {
      const pages = (node as { numberOfPages?: unknown }).numberOfPages;
      if (typeof pages === "number" && Number.isFinite(pages)) {
        appendFact({ type: "pages", label: "頁數", value: String(pages) });
      } else if (typeof pages === "string") {
        const cleaned = cleanTextValue(pages);
        if (cleaned) {
          appendFact({ type: "pages", label: "頁數", value: cleaned });
        }
      }
    }

    if ((node as { award?: unknown }).award) {
      const awardValue = (node as { award?: unknown }).award;
      if (typeof awardValue === "string") {
        appendFact({ type: "other", label: "獎項", value: awardValue.trim() });
      } else if (Array.isArray(awardValue)) {
        awardValue.forEach((entry) => {
          if (typeof entry === "string") {
            appendFact({ type: "other", label: "獎項", value: entry.trim() });
          }
        });
      }
    }

    if ((node as { isbn?: unknown }).isbn) {
      const isbnValue = (node as { isbn?: unknown }).isbn;
      if (typeof isbnValue === "string") {
        appendFact({ type: "other", label: "ISBN", value: isbnValue.trim() });
      } else if (Array.isArray(isbnValue)) {
        isbnValue.forEach((entry) => {
          if (typeof entry === "string") {
            appendFact({ type: "other", label: "ISBN", value: entry.trim() });
          }
        });
      }
    }

    if (node.isPartOf) {
      normalizeSchemaCreators(node.isPartOf).forEach((publisher) => {
        siteNameSet.add(publisher.name);
      });
    }
  });

  return {
    titles,
    alternateTitles,
    language,
    image,
    creators,
    episode,
    description,
    siteNames: Array.from(siteNameSet),
    published,
    updated,
    nextUpdate,
    keywords,
    facts,
  };
}

function extractTitleAliases(title: string): string[] {
  const aliases = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = TITLE_ALIAS_PATTERN.exec(title))) {
    const value = match[1]?.trim();
    if (value) {
      aliases.add(value);
    }
  }
  title.split(TITLE_SLASH_SEPARATORS).forEach((part) => {
    const value = part.trim();
    if (value && value !== title) {
      aliases.add(value);
    }
  });
  return Array.from(aliases);
}

function looksLikeOrganization(name: string): boolean {
  const lowered = name.toLowerCase();
  return /公司|出版|工作室|工作坊|press|studio|製作|動畫|pictures|inc\.?|ltd\.?|有限|社|組/.test(
    lowered
  );
}

function normalizeLanguageCode(value: string): ItemLanguage | null {
  const lowered = value.toLowerCase();
  if (lowered.startsWith("zh")) {
    return "zh";
  }
  if (lowered.startsWith("ja") || lowered.startsWith("jp")) {
    return "ja";
  }
  if (lowered.startsWith("ko") || lowered.startsWith("kr")) {
    return "ko";
  }
  if (lowered.startsWith("en")) {
    return "en";
  }
  return null;
}

function detectLanguageFromText(text: string | null): ItemLanguage | null {
  if (!text) {
    return null;
  }
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  const hasHiragana = /\p{Script=Hiragana}/u.test(normalized);
  const hasKatakana = /\p{Script=Katakana}/u.test(normalized);
  const hasJapaneseMarks = /[の・〜～「」『』【】｢｣]/.test(normalized);
  if (hasHiragana || hasKatakana || hasJapaneseMarks) {
    return "ja";
  }
  if (/\p{Script=Hangul}/u.test(normalized)) {
    return "ko";
  }
  if (/\p{Script=Han}/u.test(normalized)) {
    return "zh";
  }
  const asciiLetters = normalized.match(/[A-Za-z]/g)?.length ?? 0;
  if (asciiLetters >= 3) {
    const nonAscii = normalized.match(/[^\x00-\x7F]/g)?.length ?? 0;
    const asciiWords = normalized.match(/[A-Za-z][A-Za-z'’\-]*/g)?.length ?? 0;
    if (
      asciiWords > 0 &&
      (nonAscii === 0 || asciiLetters / Math.max(1, asciiLetters + nonAscii) >= 0.6)
    ) {
      return "en";
    }
  }
  return null;
}

function extractEpisodeFromTitle(title: string | null): ExternalEpisode | null {
  if (!title) {
    return null;
  }
  const hanMatch = title.match(/第\s*(\d+)\s*(?:話|集|回|章|卷|期)/);
  if (hanMatch) {
    return { raw: hanMatch[0], number: Number.parseInt(hanMatch[1] ?? "", 10) };
  }
  const hashMatch = title.match(/(?:EP|Episode|第)?\s*(\d{1,4})\s*(?:話|集|回|章|卷|期|話)/i);
  if (hashMatch) {
    return {
      raw: hashMatch[0],
      number: Number.parseInt(hashMatch[1] ?? "", 10),
    };
  }
  const sharpMatch = title.match(/[#＃](\d{1,4})/);
  if (sharpMatch) {
    return {
      raw: sharpMatch[0],
      number: Number.parseInt(sharpMatch[1] ?? "", 10),
    };
  }
  return null;
}

function accumulateCreator(
  map: Map<string, { creator: ExternalCreator; sources: Set<ExternalCreatorSource> }>,
  name: string,
  source: ExternalCreatorSource,
  weight: number,
  options: { role?: string | null; isOrganization?: boolean } = {}
) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return;
  }
  const entry = map.get(normalizedName);
  if (!entry) {
    map.set(normalizedName, {
      creator: {
        name: normalizedName,
        role: options.role ?? "author",
        isOrganization:
          options.isOrganization ?? looksLikeOrganization(normalizedName),
        confidence: Math.min(1, Math.max(0, weight)),
        sources: [source],
      },
      sources: new Set([source]),
    });
    return;
  }
  const nextConfidence = Math.min(1, entry.creator.confidence + weight);
  entry.creator.confidence = nextConfidence;
  if (options.role && !entry.creator.role) {
    entry.creator.role = options.role;
  }
  if (options.isOrganization !== undefined) {
    entry.creator.isOrganization = options.isOrganization;
  }
  entry.sources.add(source);
  entry.creator.sources = Array.from(entry.sources);
}

function buildMetadata(
  url: string,
  fullHtml: string,
  head: string,
  metaTags: MetaTag[],
  schema: SchemaSummary,
  feed: { data: FeedData | null; url: string | null }
): ExternalItemMetadata {
  const siteNameCandidates: string[] = [];
  schema.siteNames.forEach((entry) => {
    const cleaned = cleanTextValue(entry);
    if (cleaned) {
      siteNameCandidates.push(cleaned);
    }
  });
  const ogSiteName = metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "og:site_name")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  if (ogSiteName) {
    siteNameCandidates.push(ogSiteName);
  }
  const applicationName = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "application-name")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  if (applicationName) {
    siteNameCandidates.push(applicationName);
  }
  const metaSiteName = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "site_name")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  if (metaSiteName) {
    siteNameCandidates.push(metaSiteName);
  }
  const twitterSite = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "twitter:site")
    .map((tag) => {
      if (!tag.content) return null;
      const value = tag.content.trim().replace(/^@/, "");
      return value ? cleanTextValue(value) : null;
    })
    .find((value) => Boolean(value));
  if (twitterSite) {
    siteNameCandidates.push(twitterSite);
  }
  if (feed.data?.siteName) {
    const cleaned = cleanTextValue(feed.data.siteName);
    if (cleaned) {
      siteNameCandidates.push(cleaned);
    }
  }

  let sourceName: string | null = null;
  for (const candidate of siteNameCandidates) {
    if (candidate) {
      sourceName = candidate;
      break;
    }
  }
  if (!sourceName) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      sourceName = host || parsed.hostname || null;
    } catch {
      sourceName = null;
    }
  }

  const siteTokens = collectSiteNameTokens(sourceName, url);

  const textFacts = extractTextFacts(fullHtml);
  const dateFacts = textFacts.filter((fact) => fact.type === "date");
  const headingTitle = extractHeadingTitle(fullHtml);
  const keywordSet = new Set<string>();
  schema.keywords.forEach((keyword) => {
    if (keyword) {
      keywordSet.add(keyword);
    }
  });
  extractMetaKeywords(metaTags).forEach((keyword) => keywordSet.add(keyword));
  textFacts
    .filter((fact) => fact.type === "tag")
    .forEach((fact) => keywordSet.add(fact.value));

  const factMap = new Map<string, ExternalMetadataFact>();
  const appendFact = (fact: ExternalMetadataFact | null | undefined) => {
    if (!fact || !fact.value) {
      return;
    }
    const key = `${fact.type}:${fact.label}:${fact.value}`.toLowerCase();
    if (!factMap.has(key)) {
      factMap.set(key, fact);
    }
  };

  schema.facts.forEach((fact) => appendFact(fact));
  textFacts.forEach((fact) => appendFact(fact));
  const extraPublishedDates: string[] = [];

  const ogTitle = metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "og:title")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  const twitterTitle = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "twitter:title")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  const htmlTitle = parseHtmlTitle(head);
  const titleCandidates: { value: string; priority: number }[] = [];
  schema.titles.forEach((title, index) => {
    const value = title.trim();
    if (value) {
      titleCandidates.push({ value, priority: 1 + index * 0.01 });
    }
  });
  if (ogTitle) {
    titleCandidates.push({ value: ogTitle, priority: 2 });
  }
  if (twitterTitle) {
    titleCandidates.push({ value: twitterTitle, priority: 2.1 });
  }
  if (htmlTitle) {
    titleCandidates.push({ value: htmlTitle, priority: 3 });
  }
  if (headingTitle) {
    titleCandidates.push({ value: headingTitle, priority: 3.2 });
  }
  if (feed.data?.title) {
    titleCandidates.push({ value: feed.data.title, priority: 4 });
  }
  textFacts
    .filter((fact) => fact.type === "title" || fact.type === "name")
    .forEach((fact) => {
      titleCandidates.push({ value: fact.value, priority: 3.5 });
    });
  titleCandidates.sort((a, b) => a.priority - b.priority);
  const processedTitles: { value: string; priority: number }[] = [];
  const fallbackTitles: { value: string; priority: number }[] = [];
  const seenTitleKeys = new Set<string>();
  titleCandidates.forEach((candidate) => {
    const sanitized = sanitizeTitleCandidate(candidate.value, siteTokens);
    if (sanitized && !isLikelyNonTitle(sanitized)) {
      const key = sanitized.toLowerCase();
      if (!seenTitleKeys.has(key)) {
        processedTitles.push({ value: sanitized, priority: candidate.priority });
        seenTitleKeys.add(key);
      }
      return;
    }
    const fallbackValue = cleanTextValue(candidate.value);
    if (fallbackValue && !isLikelyNonTitle(fallbackValue)) {
      const key = fallbackValue.toLowerCase();
      if (!seenTitleKeys.has(key)) {
        fallbackTitles.push({ value: fallbackValue, priority: candidate.priority });
        seenTitleKeys.add(key);
      }
    }
  });
  let primaryTitle = selectPrimaryTitle(processedTitles, fallbackTitles, siteTokens);
  if (primaryTitle && matchesSiteToken(primaryTitle, siteTokens)) {
    const fallbackTitle = processedTitles
      .concat(fallbackTitles)
      .map((entry) => entry.value)
      .find((value) => value && !matchesSiteToken(value, siteTokens));
    if (fallbackTitle) {
      primaryTitle = fallbackTitle;
    }
  }

  const alternateTitleCandidates: string[] = [];
  schema.alternateTitles.forEach((title) => {
    alternateTitleCandidates.push(title);
  });
  schema.titles.forEach((title) => {
    alternateTitleCandidates.push(title);
  });
  if (feed.data?.alternateTitles) {
    feed.data.alternateTitles.forEach((title) => {
      alternateTitleCandidates.push(title);
    });
  }
  if (primaryTitle) {
    extractTitleAliases(primaryTitle).forEach((alias) => {
      if (alias) {
        alternateTitleCandidates.push(alias);
      }
    });
  }
  textFacts
    .filter((fact) => fact.type === "title" || fact.type === "name")
    .forEach((fact) => {
      alternateTitleCandidates.push(fact.value);
    });
  const alternateTitleSet = new Set<string>();
  alternateTitleCandidates.forEach((title) => {
    const sanitized = sanitizeTitleCandidate(title, siteTokens);
    if (!sanitized || isLikelyNonTitle(sanitized)) {
      return;
    }
    if (primaryTitle && sanitized === primaryTitle) {
      return;
    }
    alternateTitleSet.add(sanitized);
  });
  const alternateTitles = Array.from(alternateTitleSet);
  const alternateTitleEntries = alternateTitles.map((value) => ({
    value,
    language: detectLanguageFromText(value),
  }));

  const languageCandidates: { value: ItemLanguage; priority: number }[] = [];
  const schemaLanguage = schema.language
    ? normalizeLanguageCode(schema.language)
    : null;
  if (schemaLanguage) {
    languageCandidates.push({ value: schemaLanguage, priority: 1 });
  }
  const ogLocale = metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "og:locale")
    .map((tag) => (tag.content ?? "").trim())
    .find((value) => value.length > 0);
  if (ogLocale) {
    const normalized = normalizeLanguageCode(ogLocale);
    if (normalized) {
      languageCandidates.push({ value: normalized, priority: 2 });
    }
  }
  const htmlLang = extractHtmlLang(fullHtml);
  if (htmlLang) {
    const normalized = normalizeLanguageCode(htmlLang);
    if (normalized) {
      languageCandidates.push({ value: normalized, priority: 3 });
    }
  }
  if (feed.data?.language) {
    const normalized = normalizeLanguageCode(feed.data.language);
    if (normalized) {
      languageCandidates.push({ value: normalized, priority: 4 });
    }
  }
  const primaryLanguage = primaryTitle ? detectLanguageFromText(primaryTitle) : null;
  if (primaryLanguage) {
    languageCandidates.push({ value: primaryLanguage, priority: 5 });
  }
  languageCandidates.sort((a, b) => a.priority - b.priority);
  let language: ItemLanguage | null = null;
  let languageSourcePriority = Number.POSITIVE_INFINITY;
  if (languageCandidates.length > 0) {
    language = languageCandidates[0].value;
    languageSourcePriority = languageCandidates[0].priority;
  }

  if (alternateTitleEntries.length > 0 && (!language || languageSourcePriority >= 5)) {
    const preferredAltLanguages: ItemLanguage[] = ["ja", "en", "ko"];
    for (const lang of preferredAltLanguages) {
      const match = alternateTitleEntries.find((entry) => entry.language === lang);
      if (match) {
        language = lang;
        languageSourcePriority = 5.5;
        break;
      }
    }
    if (!language) {
      const fallbackAlt = alternateTitleEntries.find((entry) => entry.language);
      if (fallbackAlt?.language) {
        language = fallbackAlt.language;
        languageSourcePriority = 5.5;
      }
    }
  }

  const creatorMap = new Map<
    string,
    { creator: ExternalCreator; sources: Set<ExternalCreatorSource> }
  >();
  schema.creators.forEach((creator) => {
    accumulateCreator(creatorMap, creator.name, "schema", CREATOR_SOURCE_WEIGHTS.schema, {
      role: creator.role,
      isOrganization: creator.isOrganization,
    });
  });
  metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "author")
    .forEach((tag) => {
      if (!tag.content) return;
      accumulateCreator(
        creatorMap,
        tag.content,
        "meta",
        CREATOR_SOURCE_WEIGHTS.meta
      );
    });
  metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "article:author")
    .forEach((tag) => {
      if (!tag.content) return;
      accumulateCreator(
        creatorMap,
        tag.content,
        "meta",
        CREATOR_SOURCE_WEIGHTS.meta
      );
    });
  metaTags.forEach((tag) => {
    const key = (tag.property ?? tag.name ?? "").toLowerCase();
    if (!key || !tag.content) {
      return;
    }
    if (BOOK_AUTHOR_META_KEYS.includes(key)) {
      accumulateCreator(
        creatorMap,
        tag.content,
        "meta",
        CREATOR_SOURCE_WEIGHTS.meta
      );
    }
    if (BOOK_PUBLISHER_META_KEYS.includes(key)) {
      accumulateCreator(
        creatorMap,
        tag.content,
        "meta",
        CREATOR_SOURCE_WEIGHTS.meta,
        { role: "publisher", isOrganization: true }
      );
    }
    if (BOOK_PAGE_META_KEYS.includes(key)) {
      const cleaned = cleanTextValue(tag.content ?? null);
      if (cleaned) {
        appendFact({ type: "pages", label: "頁數", value: cleaned });
      }
    }
    if (BOOK_RELEASE_META_KEYS.includes(key) && tag.content) {
      extraPublishedDates.push(tag.content);
    }
  });
  const twitterCreators = metaTags.filter(
    (tag) => (tag.name ?? "").toLowerCase() === "twitter:creator"
  );
  twitterCreators.forEach((tag) => {
    if (!tag.content) return;
    const value = tag.content.startsWith("@")
      ? tag.content.slice(1)
      : tag.content;
    accumulateCreator(
      creatorMap,
      value,
      "twitter",
      CREATOR_SOURCE_WEIGHTS.twitter
    );
  });
  if (feed.data?.author) {
    accumulateCreator(
      creatorMap,
      feed.data.author,
      "feed",
      CREATOR_SOURCE_WEIGHTS.feed
    );
  }
  textFacts
    .filter((fact) => fact.type === "author")
    .forEach((fact) => {
      accumulateCreator(
        creatorMap,
        fact.value,
        "page",
        CREATOR_SOURCE_WEIGHTS.page
      );
    });
  textFacts
    .filter((fact) => fact.type === "publisher")
    .forEach((fact) => {
      accumulateCreator(
        creatorMap,
        fact.value,
        "page",
        CREATOR_SOURCE_WEIGHTS.page,
        { role: "publisher", isOrganization: true }
      );
    });

  const creators = Array.from(creatorMap.values())
    .map((entry) => entry.creator)
    .sort((a, b) => b.confidence - a.confidence);

  const author = creators[0]?.name ?? null;

  const images: string[] = [];
  if (schema.image) {
    const resolved = resolveUrl(url, schema.image) ?? schema.image;
    if (resolved) {
      images.push(resolved);
    }
  }
  const ogImage = metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "og:image")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  if (ogImage) {
    images.push(resolveUrl(url, ogImage) ?? ogImage);
  }
  const twitterImage = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "twitter:image")
    .map((tag) => cleanTextValue(tag.content ?? null))
    .find((value) => Boolean(value));
  if (twitterImage) {
    images.push(resolveUrl(url, twitterImage) ?? twitterImage);
  }
  if (feed.data?.image) {
    const resolved = resolveUrl(feed.url ?? url, feed.data.image) ?? feed.data.image;
    if (resolved) {
      images.push(resolved);
    }
  }
  extractInlineImages(fullHtml, url, siteTokens).forEach((candidate) => {
    if (candidate) {
      images.push(candidate);
    }
  });
  const image = selectBestImage(images, url, siteTokens);

  const episode =
    schema.episode
      ? { raw: schema.episode, number: Number.parseInt(schema.episode, 10) || null }
      : feed.data?.episode
      ? {
          raw: feed.data.episode,
          number: Number.parseInt(feed.data.episode, 10) || null,
        }
      : extractEpisodeFromTitle(primaryTitle);

  const descriptionCandidates: string[] = [];
  if (schema.description) {
    const cleaned = cleanTextValue(schema.description);
    if (cleaned) {
      descriptionCandidates.push(cleaned);
    }
  }
  metaTags.forEach((tag) => {
    const key = (tag.name ?? tag.property ?? "").toLowerCase();
    if (
      key === "description" ||
      key === "og:description" ||
      key === "twitter:description" ||
      key === "summary"
    ) {
      const cleaned = cleanTextValue(tag.content ?? null);
      if (cleaned) {
        descriptionCandidates.push(cleaned);
      }
    }
  });
  if (feed.data?.summary) {
    const cleaned = cleanTextValue(feed.data.summary);
    if (cleaned) {
      descriptionCandidates.push(cleaned);
    }
  }
  const descriptionSet = new Set(descriptionCandidates.filter(Boolean));
  let description: string | null = null;
  for (const entry of descriptionSet) {
    if (entry) {
      description = entry;
      break;
    }
  }
  if (description && description.length > 500) {
    description = `${description.slice(0, 497)}...`;
  }

  const nextUpdateCandidates: Array<string | null> = [];
  if (schema.nextUpdate) {
    nextUpdateCandidates.push(schema.nextUpdate);
  }
  if (feed.data?.nextUpdate) {
    nextUpdateCandidates.push(feed.data.nextUpdate);
  }
  metaTags.forEach((tag) => {
    const key = (tag.name ?? tag.property ?? "").toLowerCase();
    if (NEXT_UPDATE_META_KEYS.includes(key)) {
      nextUpdateCandidates.push(tag.content ?? null);
    }
  });
  const nextUpdateAt = nextUpdateCandidates
    .map((value) => normalizeDateString(value))
    .find((value) => Boolean(value)) ?? null;

  const publishedCandidates: Array<string | null> = [];
  if (schema.published) {
    publishedCandidates.push(schema.published);
  }
  if (feed.data?.published) {
    publishedCandidates.push(feed.data.published);
  }
  metaTags.forEach((tag) => {
    const key = (tag.name ?? tag.property ?? "").toLowerCase();
    if (PUBLISHED_META_KEYS.includes(key)) {
      publishedCandidates.push(tag.content ?? null);
    }
  });
  extraPublishedDates.forEach((date) => publishedCandidates.push(date));

  const updatedCandidates: Array<string | null> = [];
  if (schema.updated) {
    updatedCandidates.push(schema.updated);
  }
  if (feed.data?.updated) {
    updatedCandidates.push(feed.data.updated);
  }
  metaTags.forEach((tag) => {
    const key = (tag.name ?? tag.property ?? "").toLowerCase();
    if (UPDATED_META_KEYS.includes(key)) {
      updatedCandidates.push(tag.content ?? null);
    }
  });

  dateFacts.forEach((fact) => {
    if (/更新/.test(fact.label) || /update/i.test(fact.label)) {
      updatedCandidates.push(fact.value);
    } else {
      publishedCandidates.push(fact.value);
    }
  });

  const publishedAt = publishedCandidates
    .map((value) => normalizeDateString(value))
    .find((value) => Boolean(value)) ?? null;

  const updatedAt = updatedCandidates
    .map((value) => normalizeDateString(value))
    .find((value) => Boolean(value)) ?? null;

  factMap.forEach((fact) => {
    if (fact.type === "tag") {
      keywordSet.add(fact.value);
    }
  });
  const keywords = Array.from(keywordSet);
  const facts = Array.from(factMap.values());

  let originalTitle: string | null = null;
  if (primaryTitle) {
    if (primaryLanguage && primaryLanguage !== "zh") {
      originalTitle = primaryTitle;
    } else {
      const preferredOriginalLanguages: ItemLanguage[] = ["ja", "en", "ko"];
      for (const lang of preferredOriginalLanguages) {
        const match = alternateTitleEntries.find((entry) => entry.language === lang);
        if (match) {
          originalTitle = match.value;
          break;
        }
      }
      if (!originalTitle) {
        const nonZh = alternateTitleEntries.find(
          (entry) => entry.language && entry.language !== "zh"
        );
        if (nonZh) {
          originalTitle = nonZh.value;
        }
      }
    }
  }

  if (!originalTitle && primaryTitle) {
    originalTitle = primaryTitle;
  }

  return {
    primaryTitle,
    originalTitle,
    alternateTitles,
    image,
    language,
    creators,
    author,
    episode,
    feedUrl: feed.url,
    sourceName,
    description,
    nextUpdateAt,
    publishedAt,
    updatedAt,
    keywords,
    facts,
  };
}

async function collectMetadata(url: string): Promise<ExternalItemMetadata | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err) {
    console.debug("collectMetadata: fetch failed", url, err);
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const html = await response.text();
  const head = extractHeadSection(html);
  const metaTags = parseMetaTags(head);
  const linkTags = parseLinkTags(head);
  const schemaBlocks = parseJsonLdBlocks(head);
  const schemaSummary = extractSchemaSummary(schemaBlocks, url);
  const feeds = discoverFeedLinks(linkTags, url);
  const feedData = await loadFeedData(feeds);

  return buildMetadata(url, html, head, metaTags, schemaSummary, feedData);
}

export async function POST(request: NextRequest) {
  let urlValue: string | null = null;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (body && typeof body.url === "string") {
      urlValue = body.url.trim();
    }
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON" }, { status: 400 });
  }
  if (!urlValue) {
    return NextResponse.json({ data: null, error: "URL is required" }, { status: 400 });
  }
  let normalizedUrl: string;
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    normalizedUrl = parsed.toString();
  } catch {
    return NextResponse.json(
      { data: null, error: "Invalid URL" },
      { status: 400 }
    );
  }
  try {
    const metadata = await collectMetadata(normalizedUrl);
    return NextResponse.json({ data: metadata });
  } catch (err) {
    console.error("collectMetadata failed", err);
    return NextResponse.json(
      { data: null, error: "Failed to load metadata" },
      { status: 500 }
    );
  }
}
