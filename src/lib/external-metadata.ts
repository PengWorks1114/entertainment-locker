import type {
  ExternalItemMetadata,
  ExternalMetadataFact,
  ExternalMetadataFactType,
} from "./external-metadata-types";

function isLikelyHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

type ExternalMetadataResponse = {
  data?: unknown;
  error?: unknown;
};

function normalizeResponseData(input: unknown): ExternalItemMetadata | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Partial<ExternalItemMetadata>;
  const primaryTitle =
    typeof record.primaryTitle === "string" ? record.primaryTitle : null;
  const originalTitle =
    typeof record.originalTitle === "string" ? record.originalTitle : null;
  const alternateTitles = Array.isArray(record.alternateTitles)
    ? record.alternateTitles
        .map((entry) => (typeof entry === "string" ? entry : ""))
        .filter((entry) => entry.trim().length > 0)
    : [];
  const image = typeof record.image === "string" ? record.image : null;
  const language = record.language ?? null;
  const creators = Array.isArray(record.creators)
    ? record.creators
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const data = entry as {
            name?: unknown;
            role?: unknown;
            isOrganization?: unknown;
            confidence?: unknown;
            sources?: unknown;
          };
          const name =
            typeof data.name === "string" ? data.name.trim() : null;
          if (!name) {
            return null;
          }
          const role =
            typeof data.role === "string" ? data.role.trim() || null : null;
          const isOrganization = Boolean(data.isOrganization);
          const confidence =
            typeof data.confidence === "number" && Number.isFinite(data.confidence)
              ? Math.max(0, Math.min(1, data.confidence))
              : 0;
          const sources = Array.isArray(data.sources)
            ? data.sources
                .map((source) =>
                  typeof source === "string" ? source.trim() : ""
                )
                .filter(Boolean)
            : [];
          return {
            name,
            role,
            isOrganization,
            confidence,
            sources,
          };
        })
        .filter(Boolean)
    : [];
  const author = typeof record.author === "string" ? record.author : null;
  const episodeRaw =
    record.episode && typeof record.episode === "object"
      ? (record.episode as { raw?: unknown }).raw
      : null;
  const episodeNumber =
    record.episode && typeof record.episode === "object"
      ? (record.episode as { number?: unknown }).number
      : null;
  const episode =
    (typeof episodeRaw === "string" && episodeRaw.trim()) ||
    (typeof episodeNumber === "number" && Number.isFinite(episodeNumber))
      ? {
          raw: typeof episodeRaw === "string" ? episodeRaw : String(episodeNumber),
          number:
            typeof episodeNumber === "number" && Number.isFinite(episodeNumber)
              ? episodeNumber
              : null,
        }
      : null;
  const feedUrl =
    typeof record.feedUrl === "string" ? record.feedUrl.trim() || null : null;
  const sourceName =
    typeof record.sourceName === "string" ? record.sourceName.trim() || null : null;
  const description =
    typeof record.description === "string"
      ? record.description.trim() || null
      : null;
  const nextUpdateAt =
    typeof record.nextUpdateAt === "string"
      ? record.nextUpdateAt.trim() || null
      : null;
  const publishedAt =
    typeof record.publishedAt === "string"
      ? record.publishedAt.trim() || null
      : null;
  const updatedAt =
    typeof record.updatedAt === "string"
      ? record.updatedAt.trim() || null
      : null;

  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];

  const facts = Array.isArray(record.facts)
    ? record.facts
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const fact = entry as {
            type?: unknown;
            label?: unknown;
            value?: unknown;
          };
          const label =
            typeof fact.label === "string" ? fact.label.trim() : null;
          const value =
            typeof fact.value === "string" ? fact.value.trim() : null;
          const type =
            typeof fact.type === "string"
              ? (fact.type as ExternalMetadataFactType)
              : "other";
          if (!label || !value) {
            return null;
          }
          return { type, label, value } satisfies ExternalMetadataFact;
        })
        .filter((entry): entry is ExternalMetadataFact => Boolean(entry))
    : [];

  return {
    primaryTitle,
    originalTitle,
    alternateTitles,
    image,
    language: language as ExternalItemMetadata["language"],
    creators,
    author,
    episode,
    feedUrl,
    sourceName,
    description,
    nextUpdateAt,
    publishedAt,
    updatedAt,
    keywords,
    facts,
  };
}

export async function fetchExternalItemData(
  url: string
): Promise<ExternalItemMetadata | null> {
  if (!isLikelyHttpUrl(url)) {
    return null;
  }
  try {
    const response = await fetch("/api/external-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      return null;
    }
    const payload: ExternalMetadataResponse = await response.json();
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if ("error" in payload && typeof payload.error === "string") {
      return null;
    }
    if (!("data" in payload)) {
      return null;
    }
    return normalizeResponseData(payload.data ?? null);
  } catch (err) {
    console.debug("fetchExternalItemData failed", err);
    return null;
  }
}
