import type { ItemLanguage } from "./types";

export type ExternalCreatorSource = "schema" | "meta" | "twitter" | "feed";

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
};
