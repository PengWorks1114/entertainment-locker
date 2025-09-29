import { NextRequest } from "next/server";

const FETCH_TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 512_000; // 約 500 KB，避免下載過大的網頁內容

const BROWSER_REQUEST_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
} as const;

const LEGACY_REQUEST_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (compatible; EntertainmentLockerBot/1.0; +https://github.com/)",
} as const;

const META_IMAGE_PRIORITY = [
  "og:image",
  "og:image:url",
  "og:image:secure_url",
  "og:image:secure-url",
  "og:image:secureurl",
  "twitter:image",
  "twitter:image:src",
  "twitter:image:url",
  "twitter:image0",
  "twitter:image:large",
  "twitter:image:secure",
  "image",
];

const META_TITLE_PRIORITY = [
  "og:title",
  "twitter:title",
  "title",
];

const META_SITE_NAME_KEYS = [
  "og:site_name",
  "site_name",
  "application-name",
  "twitter:app:name:iphone",
  "twitter:app:name:ipad",
  "twitter:app:name:googleplay",
];

const AUTHOR_KEYWORDS = [
  "author",
  "authors",
  "article:author",
  "book:author",
  "byline",
  "creator",
  "dc.creator",
  "dc:creator",
  "twitter:creator",
  "作者",
  "著者",
];

type JsonLdNode = Record<string, unknown>;

interface DocumentSnapshot {
  html: string;
  baseUrl: URL;
  metaTags: Map<string, string>;
  jsonLdNodes: JsonLdNode[];
}

type FetchFailureReason =
  | "timeout"
  | "network"
  | "bad_status"
  | "unsupported"
  | "empty";

class FetchFailure extends Error {
  constructor(readonly reason: FetchFailureReason) {
    super(reason);
  }
}

function extractJsonLdData(html: string): JsonLdNode[] {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const results: JsonLdNode[] = [];

  for (const match of html.matchAll(scriptRegex)) {
    const rawContent = match[1]?.trim();
    if (!rawContent) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            results.push(item as JsonLdNode);
          }
        }
        continue;
      }
      if (parsed && typeof parsed === "object") {
        results.push(parsed as JsonLdNode);
      }
    } catch {
      continue;
    }
  }

  return results;
}

function extractJsonLdUrl(value: unknown, baseUrl: URL): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return normalizeUrl(value, baseUrl);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractJsonLdUrl(item, baseUrl);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      extractJsonLdUrl(record["url"], baseUrl) ??
      extractJsonLdUrl(record["contentUrl"], baseUrl) ??
      extractJsonLdUrl(record["thumbnailUrl"], baseUrl)
    );
  }
  return null;
}

function extractString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractString(item);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    const potential = (value as Record<string, unknown>).name;
    return extractString(potential);
  }
  return null;
}

function pickJsonLdTitle(jsonLdNodes: JsonLdNode[]): string | null {
  for (const node of jsonLdNodes) {
    const headline = extractString(node["headline"]);
    if (headline) {
      return headline;
    }
    const name = extractString(node["name"]);
    if (name) {
      return name;
    }
  }
  return null;
}

function pickJsonLdAuthor(jsonLdNodes: JsonLdNode[]): string | null {
  for (const node of jsonLdNodes) {
    const author = extractString(node["author"] ?? node["creator"]);
    if (author) {
      const candidate = cleanAuthorValue(author);
      if (candidate) {
        return candidate;
      }
    }
  }
  return null;
}

function pickJsonLdSiteName(jsonLdNodes: JsonLdNode[]): string | null {
  for (const node of jsonLdNodes) {
    const publisher = node["publisher"];
    const candidate = extractString(publisher);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function pickJsonLdImage(
  jsonLdNodes: JsonLdNode[],
  baseUrl: URL
): string | null {
  for (const node of jsonLdNodes) {
    const candidate =
      extractJsonLdUrl(node["image"], baseUrl) ??
      extractJsonLdUrl(node["imageUrl"], baseUrl) ??
      extractJsonLdUrl(node["thumbnailUrl"], baseUrl);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function extractAttribute(tag: string, attribute: string): string | null {
  const regex = new RegExp(
    `${attribute}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\"'\s>]+))`,
    "i"
  );
  const match = tag.match(regex);
  if (!match) {
    return null;
  }
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function normalizeUrl(candidate: string, base: URL): string | null {
  try {
    const url = new URL(candidate, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function collectMetaTags(html: string): Map<string, string> {
  const metaTagRegex = /<meta\s+[^>]*>/gi;
  const candidates = new Map<string, string>();

  for (const match of html.matchAll(metaTagRegex)) {
    const tag = match[0];
    const key =
      extractAttribute(tag, "property") ??
      extractAttribute(tag, "name") ??
      extractAttribute(tag, "itemprop");
    if (!key) {
      continue;
    }
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) {
      continue;
    }
    if (candidates.has(normalizedKey)) {
      continue;
    }
    const content = extractAttribute(tag, "content");
    if (!content) {
      continue;
    }
    candidates.set(normalizedKey, content.trim());
  }

  return candidates;
}

function pickMetaImage(
  html: string,
  baseUrl: URL,
  metaTags: Map<string, string>
): string | null {
  for (const key of META_IMAGE_PRIORITY) {
    const value = metaTags.get(key);
    if (!value) {
      continue;
    }
    const resolved = normalizeUrl(value, baseUrl);
    if (resolved) {
      return resolved;
    }
  }

  const imgRegex = /<img\s+[^>]*src\s*=\s*("([^"]*)"|'([^']*)'|([^"'\s>]+))/i;
  const imgMatch = html.match(imgRegex);
  if (imgMatch) {
    const src = imgMatch[2] ?? imgMatch[3] ?? imgMatch[4];
    if (src) {
      const resolved = normalizeUrl(src.trim(), baseUrl);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function pickMetaTitle(
  html: string,
  metaTags: Map<string, string>
): string | null {
  for (const key of META_TITLE_PRIORITY) {
    const value = metaTags.get(key);
    if (value) {
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  const titleRegex = /<title[^>]*>([^<]*)<\/title>/i;
  const titleMatch = html.match(titleRegex);
  if (titleMatch) {
    const content = titleMatch[1]?.trim();
    if (content) {
      return content;
    }
  }

  return null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\s\u3000]+/g, " ").trim();
}

function isHostEquivalent(value: string, baseUrl: URL): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const host = baseUrl.hostname.toLowerCase();
  if (normalized === host) {
    return true;
  }
  if (host.startsWith("www.")) {
    const withoutWww = host.slice(4);
    if (normalized === withoutWww) {
      return true;
    }
  }
  return false;
}

function sanitizeTitle(value: string | null, baseUrl: URL): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (isHostEquivalent(normalized, baseUrl)) {
    return null;
  }
  return normalized;
}

function sanitizeSiteName(value: string | null, baseUrl: URL): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (isHostEquivalent(normalized, baseUrl)) {
    return null;
  }
  return normalized;
}

function rememberCandidate(
  list: string[],
  value: string | null | undefined
): string | null {
  if (typeof value === "string" && value) {
    list.push(value);
    return value;
  }
  return null;
}

function isLikelyFavicon(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const lowerPath = pathname.toLowerCase();
    return (
      lowerPath.includes("favicon") ||
      lowerPath.endsWith(".ico") ||
      (lowerPath.endsWith(".svg") &&
        (lowerPath.includes("logo") || lowerPath.includes("icon")))
    );
  } catch {
    return false;
  }
}

function sanitizeImage(url: string | null): string | null {
  if (!url) {
    return null;
  }
  if (isLikelyFavicon(url)) {
    return null;
  }
  return url;
}

function cleanAuthorValue(raw: string): string | null {
  const normalized = normalizeWhitespace(raw);
  if (!normalized) {
    return null;
  }
  const labelPattern = /^(?:作者|著者|author|byline|by)\s*[：:\-]?\s*/i;
  const stripped = normalized.replace(labelPattern, "");
  const [firstSegment] = stripped.split(/[|｜／/\n\r]/, 1);
  const candidate = normalizeWhitespace(firstSegment ?? stripped);
  return candidate || null;
}

function extractAuthorFromContent(content: string): string | null {
  const normalized = normalizeWhitespace(content);
  if (!normalized) {
    return null;
  }
  const pattern = /(?:作者|著者|author)\s*[：:\-]?\s*([^|｜／/\n\r]{1,80})/i;
  const match = normalized.match(pattern);
  if (match) {
    return cleanAuthorValue(match[0]);
  }
  return null;
}

function pickMetaAuthor(
  html: string,
  metaTags: Map<string, string>
): string | null {
  for (const [key, value] of metaTags.entries()) {
    if (AUTHOR_KEYWORDS.some((keyword) => key.includes(keyword))) {
      const candidate = cleanAuthorValue(value);
      if (candidate) {
        return candidate;
      }
    }
  }

  const descriptionKeys = [
    "description",
    "og:description",
    "twitter:description",
  ];
  for (const key of descriptionKeys) {
    const value = metaTags.get(key);
    if (!value) {
      continue;
    }
    const candidate = extractAuthorFromContent(value);
    if (candidate) {
      return candidate;
    }
  }

  const inlinePattern = /(?:作者|著者)\s*[：:\-]\s*([^<\n\r]{1,80})/i;
  const inlineMatch = html.match(inlinePattern);
  if (inlineMatch) {
    const candidate = cleanAuthorValue(inlineMatch[0]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function pickMetaSiteName(metaTags: Map<string, string>): string | null {
  for (const key of META_SITE_NAME_KEYS) {
    const value = metaTags.get(key);
    if (value) {
      const normalized = normalizeWhitespace(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  for (const [key, value] of metaTags.entries()) {
    if (key.includes("site_name") || key.includes("sitename")) {
      const normalized = normalizeWhitespace(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

async function readBodyWithLimit(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let result = "";
  let received = 0;

  while (received < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      break;
    }
    received += value.byteLength;
    result += decoder.decode(value, { stream: true });
    if (received >= MAX_RESPONSE_BYTES) {
      break;
    }
  }
  result += decoder.decode();
  return result;
}

function safeParseUrl(candidate: string | null | undefined): URL | null {
  if (!candidate) {
    return null;
  }
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

async function fetchDocument(
  url: URL,
  headers: HeadersInit
): Promise<DocumentSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new FetchFailure("timeout");
    }
    throw new FetchFailure("network");
  }

  clearTimeout(timeout);

  if (!response.ok) {
    throw new FetchFailure("bad_status");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new FetchFailure("unsupported");
  }

  const html = await readBodyWithLimit(response);
  if (!html) {
    throw new FetchFailure("empty");
  }

  const baseUrl = safeParseUrl(response.url) ?? url;
  const metaTags = collectMetaTags(html);
  const jsonLdNodes = extractJsonLdData(html);

  return { html, baseUrl, metaTags, jsonLdNodes };
}

async function tryFetchDocument(
  url: URL,
  headers: HeadersInit
): Promise<DocumentSnapshot | null> {
  try {
    return await fetchDocument(url, headers);
  } catch (error) {
    if (error instanceof FetchFailure) {
      return null;
    }
    return null;
  }
}

export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get("url");
  if (!urlParam) {
    return Response.json({ error: "缺少 url 參數" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlParam);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    return Response.json({ error: "網址格式錯誤" }, { status: 400 });
  }

  try {
    let primary: DocumentSnapshot | null = null;
    let primaryFailure: FetchFailure | null = null;
    try {
      primary = await fetchDocument(targetUrl, BROWSER_REQUEST_HEADERS);
    } catch (error) {
      if (error instanceof FetchFailure) {
        primaryFailure = error;
      } else {
        throw error;
      }
    }

    let usedLegacyForPrimary = false;
    if (!primary) {
      primary = await tryFetchDocument(targetUrl, LEGACY_REQUEST_HEADERS);
      if (!primary) {
        if (primaryFailure) {
          throw primaryFailure;
        }
        throw new FetchFailure("network");
      }
      usedLegacyForPrimary = true;
    }

    const imageCandidates: string[] = [];
    const titleCandidates: string[] = [];
    const siteNameCandidates: string[] = [];

    let imageUrl = sanitizeImage(
      rememberCandidate(
        imageCandidates,
        pickMetaImage(primary.html, primary.baseUrl, primary.metaTags)
      )
    );
    if (!imageUrl) {
      imageUrl = sanitizeImage(
        rememberCandidate(
          imageCandidates,
          pickJsonLdImage(primary.jsonLdNodes, primary.baseUrl)
        )
      );
    }

    let title = sanitizeTitle(
      rememberCandidate(
        titleCandidates,
        pickMetaTitle(primary.html, primary.metaTags)
      ),
      primary.baseUrl
    );
    if (!title) {
      title = sanitizeTitle(
        rememberCandidate(
          titleCandidates,
          pickJsonLdTitle(primary.jsonLdNodes)
        ),
        primary.baseUrl
      );
    }
    let author =
      pickMetaAuthor(primary.html, primary.metaTags) ??
      pickJsonLdAuthor(primary.jsonLdNodes);
    let siteName = sanitizeSiteName(
      rememberCandidate(
        siteNameCandidates,
        pickMetaSiteName(primary.metaTags)
      ),
      primary.baseUrl
    );
    if (!siteName) {
      siteName = sanitizeSiteName(
        rememberCandidate(
          siteNameCandidates,
          pickJsonLdSiteName(primary.jsonLdNodes)
        ),
        primary.baseUrl
      );
    }

    let fallback: DocumentSnapshot | null = null;
    if (
      !usedLegacyForPrimary &&
      (!imageUrl || !title || !author || !siteName)
    ) {
      fallback = await tryFetchDocument(targetUrl, LEGACY_REQUEST_HEADERS);
    }

    if (fallback) {
      const fallbackMetaImage = rememberCandidate(
        imageCandidates,
        pickMetaImage(fallback.html, fallback.baseUrl, fallback.metaTags)
      );
      if (!imageUrl) {
        imageUrl = sanitizeImage(fallbackMetaImage);
      }
      if (!imageUrl) {
        const fallbackJsonLdImage = rememberCandidate(
          imageCandidates,
          pickJsonLdImage(fallback.jsonLdNodes, fallback.baseUrl)
        );
        imageUrl = sanitizeImage(fallbackJsonLdImage);
      }

      const fallbackMetaTitle = rememberCandidate(
        titleCandidates,
        pickMetaTitle(fallback.html, fallback.metaTags)
      );
      if (!title) {
        title = sanitizeTitle(fallbackMetaTitle, fallback.baseUrl);
      }
      if (!title) {
        const fallbackJsonLdTitle = rememberCandidate(
          titleCandidates,
          pickJsonLdTitle(fallback.jsonLdNodes)
        );
        title = sanitizeTitle(fallbackJsonLdTitle, fallback.baseUrl);
      }
      if (!author) {
        author =
          pickMetaAuthor(fallback.html, fallback.metaTags) ??
          pickJsonLdAuthor(fallback.jsonLdNodes);
      }
      const fallbackMetaSiteName = rememberCandidate(
        siteNameCandidates,
        pickMetaSiteName(fallback.metaTags)
      );
      if (!siteName) {
        siteName = sanitizeSiteName(
          fallbackMetaSiteName,
          fallback.baseUrl
        );
      }
      if (!siteName) {
        const fallbackJsonLdSiteName = rememberCandidate(
          siteNameCandidates,
          pickJsonLdSiteName(fallback.jsonLdNodes)
        );
        siteName = sanitizeSiteName(
          fallbackJsonLdSiteName,
          fallback.baseUrl
        );
      }
    }

    if (!imageUrl) {
      imageUrl = imageCandidates.find((candidate) => Boolean(candidate)) ?? null;
    }
    if (!title) {
      title = titleCandidates.find((candidate) => Boolean(candidate)) ?? null;
    }
    if (!siteName) {
      siteName =
        siteNameCandidates.find((candidate) => Boolean(candidate)) ?? null;
    }

    return Response.json({
      image: imageUrl ?? null,
      title: title ?? null,
      author: author ?? null,
      siteName: siteName ?? null,
    });
  } catch (error) {
    if (error instanceof FetchFailure) {
      switch (error.reason) {
        case "timeout":
          return Response.json({ error: "抓取逾時" }, { status: 504 });
        case "network":
          return Response.json({ error: "抓取失敗" }, { status: 502 });
        case "bad_status":
          return Response.json({ error: "來源回應錯誤" }, { status: 502 });
        case "unsupported":
        case "empty":
          return Response.json({ image: null });
      }
    }
    return Response.json({ error: "抓取失敗" }, { status: 502 });
  }
}

