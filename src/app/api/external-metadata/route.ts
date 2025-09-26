import { NextRequest, NextResponse } from "next/server";

import {
  type ExternalCreator,
  type ExternalCreatorSource,
  type ExternalEpisode,
  type ExternalItemMetadata,
} from "@/lib/external-metadata-types";
import type { ItemLanguage } from "@/lib/types";

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT =
  "EntertainmentLockerMetadataBot/1.0 (+https://entertainment-locker.example)";

const TITLE_ALIAS_PATTERN = /[\(（［\[]([^\)）］\]]+)[\)）］\]]/g;
const TITLE_SLASH_SEPARATORS = /[\/|｜]/;

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

  const title = titleMatch ? stripCdata(titleMatch[1] ?? "") : "";
  const creator = creatorMatch ? stripCdata(creatorMatch[1] ?? "") : "";
  const image = enclosureMatch
    ? enclosureMatch[2] ?? enclosureMatch[3] ?? ""
    : mediaContentMatch
    ? mediaContentMatch[2] ?? mediaContentMatch[3] ?? ""
    : "";
  const episode = episodeMatch ? stripCdata(episodeMatch[1] ?? "") : "";

  return {
    title: decodeHtmlEntities(title).trim() || null,
    alternateTitles: [],
    author: decodeHtmlEntities(creator).trim() || null,
    language: language || null,
    image: decodeHtmlEntities(image).trim() || null,
    episode: decodeHtmlEntities(episode).trim() || null,
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
    const author = authorField ?? authorsArray[0] ?? null;

    return {
      title: itemTitle ?? title ?? null,
      alternateTitles: title && itemTitle && title !== itemTitle ? [title] : [],
      author,
      language,
      image,
      episode,
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

function normalizeSchemaCreators(value: unknown): SchemaCreator[] {
  if (!value) {
    return [];
  }
  const entries: SchemaCreator[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      entries.push(...normalizeSchemaCreators(entry));
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
        role: "author",
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
        role: jobTitle,
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

  nodes.forEach((node) => {
    const titleCandidates: unknown[] = [];
    if (node.headline) titleCandidates.push(node.headline);
    if (node.name) titleCandidates.push(node.name);
    if (node.title) titleCandidates.push(node.title);
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
    if (node.author) {
      creators.push(...normalizeSchemaCreators(node.author));
    }
    if (node.creator) {
      creators.push(...normalizeSchemaCreators(node.creator));
    }
  });

  return {
    titles,
    alternateTitles,
    language,
    image,
    creators,
    episode,
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
  if (/\p{Script=Han}/u.test(text)) {
    return "zh";
  }
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) {
    return "ja";
  }
  if (/\p{Script=Hangul}/u.test(text)) {
    return "ko";
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
  const ogTitle = metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "og:title")
    .map((tag) => (tag.content ?? "").trim())
    .find((value) => value.length > 0);
  const twitterTitle = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "twitter:title")
    .map((tag) => (tag.content ?? "").trim())
    .find((value) => value.length > 0);
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
  if (feed.data?.title) {
    titleCandidates.push({ value: feed.data.title, priority: 4 });
  }
  titleCandidates.sort((a, b) => a.priority - b.priority);
  const primaryTitle = titleCandidates[0]?.value ?? null;

  const alternateTitleSet = new Set<string>();
  schema.alternateTitles.forEach((title) => {
    const value = title.trim();
    if (value) {
      alternateTitleSet.add(value);
    }
  });
  if (feed.data?.alternateTitles) {
    feed.data.alternateTitles.forEach((title) => {
      const value = title.trim();
      if (value) {
        alternateTitleSet.add(value);
      }
    });
  }
  if (primaryTitle) {
    extractTitleAliases(primaryTitle).forEach((alias) => {
      if (alias && alias !== primaryTitle) {
        alternateTitleSet.add(alias);
      }
    });
  }
  const alternateTitles = Array.from(alternateTitleSet).filter(
    (title) => title !== primaryTitle
  );

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
  if (primaryTitle) {
    const detected = detectLanguageFromText(primaryTitle);
    if (detected) {
      languageCandidates.push({ value: detected, priority: 5 });
    }
  }
  languageCandidates.sort((a, b) => a.priority - b.priority);
  const language = languageCandidates[0]?.value ?? null;

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

  const creators = Array.from(creatorMap.values())
    .map((entry) => entry.creator)
    .sort((a, b) => b.confidence - a.confidence);

  const author = creators[0]?.name ?? null;

  const images: string[] = [];
  if (schema.image) {
    const resolved = resolveUrl(url, schema.image) ?? schema.image;
    images.push(resolved);
  }
  const ogImage = metaTags
    .filter((tag) => (tag.property ?? "").toLowerCase() === "og:image")
    .map((tag) => (tag.content ?? "").trim())
    .find((value) => value.length > 0);
  if (ogImage) {
    images.push(resolveUrl(url, ogImage) ?? ogImage);
  }
  const twitterImage = metaTags
    .filter((tag) => (tag.name ?? "").toLowerCase() === "twitter:image")
    .map((tag) => (tag.content ?? "").trim())
    .find((value) => value.length > 0);
  if (twitterImage) {
    images.push(resolveUrl(url, twitterImage) ?? twitterImage);
  }
  if (feed.data?.image) {
    images.push(resolveUrl(feed.url ?? url, feed.data.image) ?? feed.data.image);
  }
  const image = images.find((value) => Boolean(value)) ?? null;

  const episode =
    schema.episode
      ? { raw: schema.episode, number: Number.parseInt(schema.episode, 10) || null }
      : feed.data?.episode
      ? {
          raw: feed.data.episode,
          number: Number.parseInt(feed.data.episode, 10) || null,
        }
      : extractEpisodeFromTitle(primaryTitle);

  let originalTitle: string | null = null;
  if (primaryTitle) {
    const isPrimaryChinese = /\p{Script=Han}/u.test(primaryTitle);
    if (!isPrimaryChinese) {
      originalTitle = primaryTitle;
    } else {
      originalTitle = alternateTitles.find((title) => !/\p{Script=Han}/u.test(title)) ?? null;
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
