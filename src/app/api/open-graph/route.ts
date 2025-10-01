import { NextRequest } from "next/server";

const FETCH_TIMEOUT_MS = (() => {
  const raw = process.env.OPEN_GRAPH_FETCH_TIMEOUT_MS;
  if (!raw) {
    return 7000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7000;
})();
const MAX_RESPONSE_BYTES = 512_000; // 約 500 KB，避免下載過大的網頁內容

// Header policy:
// 1. Mimic a modern desktop Chrome request so that more sites return their full HTML.
// 2. If that precise UA is blocked, retry once with a simpler legacy UA instead of
//    falling back to a bot signature. Please keep both attempts aligned with common
//    browser headers to avoid being throttled by anti-bot systems.
const PRIMARY_BROWSER_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-CH-UA": '"Google Chrome";v="125", "Chromium";v="125", "Not:A-Brand";v="24"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
};

const FALLBACK_BROWSER_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
};

const BLOCKED_STATUS_CODES = new Set([401, 403, 406, 429]);

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

function collectJsonLdPayloads(html: string): unknown[] {
  const scriptRegex =
    /<script[^>]*type\s*=\s*("|')application\/ld\+json(?:;[^"']*)?\1[^>]*>([\s\S]*?)<\/script>/gi;
  const payloads: unknown[] = [];

  for (const match of html.matchAll(scriptRegex)) {
    const raw = match[2]?.trim();
    if (!raw) {
      continue;
    }
    try {
      payloads.push(JSON.parse(raw));
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }

  return payloads;
}

function extractImageStrings(value: unknown): string[] {
  const results: string[] = [];
  const queue: unknown[] = [value];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (typeof current === "string") {
      const normalized = current.trim();
      if (normalized) {
        results.push(normalized);
      }
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current === "object") {
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const candidateObject = current as Record<string, unknown>;
      const possibleKeys = ["url", "@id", "contentUrl", "thumbnailUrl"];
      for (const key of possibleKeys) {
        const candidate = candidateObject[key];
        if (typeof candidate === "string") {
          const normalized = candidate.trim();
          if (normalized) {
            results.push(normalized);
          }
        }
      }
      for (const nested of Object.values(candidateObject)) {
        if (Array.isArray(nested)) {
          queue.push(...nested);
        } else if (nested && typeof nested === "object") {
          queue.push(nested);
        }
      }
    }
  }

  return results;
}

function extractTitleStrings(value: unknown): string[] {
  const results: string[] = [];
  const queue: unknown[] = [value];

  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current === "string") {
      const normalized = normalizeWhitespace(current);
      if (normalized) {
        results.push(normalized);
      }
      continue;
    }
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (current && typeof current === "object") {
      const candidateObject = current as Record<string, unknown>;
      const possibleKeys = ["text", "value"]; // Schema.org literals sometimes live here
      for (const key of possibleKeys) {
        const candidate = candidateObject[key];
        if (typeof candidate === "string") {
          const normalized = normalizeWhitespace(candidate);
          if (normalized) {
            results.push(normalized);
          }
        }
      }
      for (const nested of Object.values(candidateObject)) {
        if (Array.isArray(nested)) {
          queue.push(...nested);
        } else if (nested && typeof nested === "object") {
          queue.push(nested);
        }
      }
    }
  }

  return results;
}

function collectJsonLdMetadata(payloads: unknown[]): {
  images: string[];
  titles: string[];
} {
  const imageSet = new Set<string>();
  const titleSet = new Set<string>();

  const visit = (node: unknown) => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === "image" || normalizedKey === "thumbnailurl") {
        for (const candidate of extractImageStrings(value)) {
          if (candidate) {
            imageSet.add(candidate);
          }
        }
      }
      if (normalizedKey === "headline" || normalizedKey === "name") {
        for (const candidate of extractTitleStrings(value)) {
          if (candidate) {
            titleSet.add(candidate);
          }
        }
      }
      if (Array.isArray(value)) {
        visit(value);
      } else if (value && typeof value === "object") {
        visit(value);
      }
    }
  };

  for (const payload of payloads) {
    visit(payload);
  }

  return {
    images: Array.from(imageSet),
    titles: Array.from(titleSet),
  };
}

function isLikelyPlaceholderImage(candidate: string): boolean {
  const normalized = candidate.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith("data:")) {
    return true;
  }
  const placeholderPatterns = [
    /\/favicon\.(?:ico|png|gif|jpg)$/, // favicon style assets rarely help for link previews
    /spacer\.(?:gif|png)$/,
    /pixel\.(?:gif|png)$/,
    /blank\.(?:gif|png)$/,
    /placeholder/,
    /default/,
  ];
  return placeholderPatterns.some((pattern) => pattern.test(normalized));
}

function isLikelyPlaceholderTitle(candidate: string): boolean {
  const normalized = normalizeWhitespace(candidate).toLowerCase();
  if (!normalized) {
    return true;
  }
  const placeholderTitles = new Set([
    "untitled",
    "home",
    "index",
    "default",
    "default title",
    "undefined",
    "null",
  ]);
  return placeholderTitles.has(normalized);
}

function pickMetaImage(
  html: string,
  baseUrl: URL,
  metaTags: Map<string, string>,
  jsonLdImages: readonly string[] = []
): string | null {
  let placeholderCandidate: string | null = null;
  for (const key of META_IMAGE_PRIORITY) {
    const value = metaTags.get(key);
    if (!value) {
      continue;
    }
    const resolved = normalizeUrl(value, baseUrl);
    if (resolved) {
      if (!isLikelyPlaceholderImage(resolved)) {
        return resolved;
      }
      placeholderCandidate ??= resolved;
    }
  }

  for (const candidate of jsonLdImages) {
    const resolved = normalizeUrl(candidate, baseUrl);
    if (!resolved) {
      continue;
    }
    if (!isLikelyPlaceholderImage(resolved)) {
      return resolved;
    }
    placeholderCandidate ??= resolved;
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

  return placeholderCandidate;
}

function pickMetaTitle(
  html: string,
  metaTags: Map<string, string>,
  jsonLdTitles: readonly string[] = []
): string | null {
  let placeholderCandidate: string | null = null;
  for (const key of META_TITLE_PRIORITY) {
    const value = metaTags.get(key);
    if (value) {
      const normalized = value.trim();
      if (normalized) {
        if (!isLikelyPlaceholderTitle(normalized)) {
          return normalized;
        }
        placeholderCandidate ??= normalized;
      }
    }
  }

  for (const candidate of jsonLdTitles) {
    if (!candidate) {
      continue;
    }
    if (!isLikelyPlaceholderTitle(candidate)) {
      return candidate;
    }
    placeholderCandidate ??= candidate;
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

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "AbortError"
  );
}

async function readBodyWithLimit(
  response: Response,
  encoding: string,
  signal?: AbortSignal
): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = createTextDecoder(encoding);
  let result = "";
  let received = 0;
  let abortPromise: Promise<never> | null = null;
  let abortCleanup: (() => void) | null = null;

  if (signal) {
    abortPromise = new Promise<never>((_, reject) => {
      const handleAbort = () => {
        abortCleanup?.();
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };

      if (signal.aborted) {
        handleAbort();
        return;
      }

      const listener = () => handleAbort();
      signal.addEventListener("abort", listener, { once: true });
      abortCleanup = () => {
        signal.removeEventListener("abort", listener);
      };
    });
  }

  try {
    while (received < MAX_RESPONSE_BYTES) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        if (abortPromise) {
          chunk = await Promise.race([reader.read(), abortPromise]);
        } else {
          chunk = await reader.read();
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        break;
      }
      const { done, value } = chunk;
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
  } finally {
    if (abortCleanup) {
      abortCleanup();
    }
    await reader.cancel().catch(() => undefined);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetchWithHeaders = (headers: Record<string, string>) =>
      fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers,
      });

    let response: Response | null = null;
    let lastError: unknown;
    let usedFallback = false;
    try {
      response = await fetchWithHeaders(PRIMARY_BROWSER_HEADERS);
    } catch (error) {
      lastError = error;
      if (!controller.signal.aborted) {
        try {
          response = await fetchWithHeaders(FALLBACK_BROWSER_HEADERS);
          usedFallback = true;
        } catch (fallbackError) {
          lastError = fallbackError;
          response = null;
          usedFallback = true;
        }
      }
    }

    if (
      response &&
      !response.ok &&
      !usedFallback &&
      BLOCKED_STATUS_CODES.has(response.status) &&
      !controller.signal.aborted
    ) {
      if (response.body) {
        try {
          await response.body.cancel();
        } catch {
          // ignore body cancellation failure
        }
      }
      try {
        response = await fetchWithHeaders(FALLBACK_BROWSER_HEADERS);
        usedFallback = true;
      } catch (fallbackError) {
        lastError = fallbackError;
        response = null;
        usedFallback = true;
      }
    }

    if (!response) {
      if (controller.signal.aborted) {
        return Response.json({ error: "抓取逾時" }, { status: 504 });
      }
      if (
        lastError instanceof Error &&
        (lastError.name === "AbortError" || lastError.name === "TimeoutError")
      ) {
        return Response.json({ error: "抓取逾時" }, { status: 504 });
      }
      return Response.json({ error: "抓取失敗" }, { status: 502 });
    }

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

    let html: string;
    try {
      html = await readBodyWithLimit(response, encoding, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        return Response.json({ error: "抓取逾時" }, { status: 504 });
      }
      throw error;
    }

    if (!html) {
      return Response.json({ image: null });
    }

    const metaTags = collectMetaTags(html);
    const jsonLdPayloads = collectJsonLdPayloads(html);
    const jsonLdMetadata = collectJsonLdMetadata(jsonLdPayloads);
    const imageUrl = pickMetaImage(
      html,
      targetUrl,
      metaTags,
      jsonLdMetadata.images
    );
    const title = pickMetaTitle(html, metaTags, jsonLdMetadata.titles);
    const author = pickMetaAuthor(html, metaTags);
    const siteName = pickMetaSiteName(metaTags);
    return Response.json({
      image: imageUrl ?? null,
      title: title ?? null,
      author: author ?? null,
      siteName: siteName ?? null,
    });
  } finally {
    clearTimeout(timeout);
  }
}

