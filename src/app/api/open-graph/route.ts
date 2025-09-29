import { NextRequest } from "next/server";

const FETCH_TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 512_000; // 約 500 KB，避免下載過大的網頁內容

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
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
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return Response.json({ error: "抓取逾時" }, { status: 504 });
    }
    return Response.json({ error: "抓取失敗" }, { status: 502 });
  }

  clearTimeout(timeout);

  if (!response.ok) {
    return Response.json({ error: "來源回應錯誤" }, { status: 502 });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return Response.json({ image: null });
  }

  const html = await readBodyWithLimit(response);
  if (!html) {
    return Response.json({ image: null });
  }

  const metaTags = collectMetaTags(html);
  const jsonLdNodes = extractJsonLdData(html);
  const imageUrl = pickMetaImage(html, targetUrl, metaTags);
  const title = pickMetaTitle(html, metaTags) ?? pickJsonLdTitle(jsonLdNodes);
  const author = pickMetaAuthor(html, metaTags) ?? pickJsonLdAuthor(jsonLdNodes);
  const siteName = pickMetaSiteName(metaTags) ?? pickJsonLdSiteName(jsonLdNodes);
  return Response.json({
    image: imageUrl ?? null,
    title: title ?? null,
    author: author ?? null,
    siteName: siteName ?? null,
  });
}

