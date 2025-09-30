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

function normalizeEncodingName(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "utf8") {
    return "utf-8";
  }
  if (normalized === "shift-jis") {
    return "shift_jis";
  }
  return normalized;
}

function extractEncodingFromContentType(contentType: string | null): string | null {
  if (!contentType) {
    return null;
  }
  const match = contentType.match(/charset\s*=\s*([^"]+?)(?:;|$)/i);
  if (!match) {
    return null;
  }
  const [raw] = match.slice(1);
  return normalizeEncodingName(raw.replace(/["']/g, ""));
}

async function sniffEncodingFromMeta(response: Response): Promise<string | null> {
  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let preview = "";
  const MAX_SNIFF_BYTES = 32_768;

  try {
    while (received < MAX_SNIFF_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      received += value.byteLength;
      preview += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(preview)) {
        break;
      }
      if (received >= MAX_SNIFF_BYTES) {
        break;
      }
    }
    preview += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const directMatch = preview.match(/<meta[^>]*charset\s*=\s*["']?([^"'\s/>]+)/i);
  if (directMatch) {
    return normalizeEncodingName(directMatch[1]);
  }

  const httpEquivMatch = preview.match(
    /<meta[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^"';\s]+)/i
  );
  if (httpEquivMatch) {
    return normalizeEncodingName(httpEquivMatch[1]);
  }

  return null;
}

function createTextDecoder(encoding: string): TextDecoder {
  try {
    return new TextDecoder(encoding, { fatal: false });
  } catch {
    return new TextDecoder("utf-8", { fatal: false });
  }
}

async function readBodyWithLimit(
  response: Response,
  encoding: string
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = createTextDecoder(encoding);
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
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "Mozilla/5.0 (compatible; EntertainmentLockerBot/1.0; +https://github.com/)",
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
  if (!contentType.toLowerCase().includes("text/html")) {
    return Response.json({ image: null });
  }

  let encoding = extractEncodingFromContentType(contentType) ?? "utf-8";
  const metaEncoding = await sniffEncodingFromMeta(response.clone());
  if (metaEncoding) {
    encoding = metaEncoding;
  }

  const html = await readBodyWithLimit(response, encoding);
  if (!html) {
    return Response.json({ image: null });
  }

  const metaTags = collectMetaTags(html);
  const imageUrl = pickMetaImage(html, targetUrl, metaTags);
  const title = pickMetaTitle(html, metaTags);
  const author = pickMetaAuthor(html, metaTags);
  const siteName = pickMetaSiteName(metaTags);
  return Response.json({
    image: imageUrl ?? null,
    title: title ?? null,
    author: author ?? null,
    siteName: siteName ?? null,
  });
}

