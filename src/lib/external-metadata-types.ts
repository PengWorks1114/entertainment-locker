import type { ItemLanguage } from "./types";

export type ExternalCreatorSource = "schema" | "meta" | "twitter" | "feed" | "page";

export type ExternalCreator = {
  name: string;
  role: string | null;
  isOrganization: boolean;
  confidence: number;
  sources: ExternalCreatorSource[];
};

export type ExternalEpisode = {
  raw: string;
  number: number | null;
};

export type ExternalMetadataFactType =
  | "author"
  | "publisher"
  | "pages"
  | "tag"
  | "date"
  | "title"
  | "name"
  | "other";

export type ExternalMetadataFact = {
  type: ExternalMetadataFactType;
  label: string;
  value: string;
};

export type ExternalItemMetadata = {
  primaryTitle: string | null;
  originalTitle: string | null;
  alternateTitles: string[];
  image: string | null;
  language: ItemLanguage | null;
  creators: ExternalCreator[];
  author: string | null;
  episode: ExternalEpisode | null;
  feedUrl: string | null;
  sourceName: string | null;
  description: string | null;
  nextUpdateAt: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  keywords: string[];
  facts: ExternalMetadataFact[];
};
