type OpenGraphMetadata = {
  image: string | null;
  title: string | null;
  author: string | null;
  siteName: string | null;
};

export async function fetchOpenGraphMetadata(
  url: string
): Promise<OpenGraphMetadata | null> {
  try {
    const endpoint = `/api/open-graph?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    if (data && typeof data === "object") {
      const { image, title, author, siteName } = data as {
        image?: unknown;
        title?: unknown;
        author?: unknown;
        siteName?: unknown;
      };
      const normalizedImage =
        typeof image === "string" ? image.trim() || null : null;
      const normalizedTitle =
        typeof title === "string" ? title.trim() || null : null;
      const normalizedAuthor =
        typeof author === "string" ? author.trim() || null : null;
      const normalizedSiteName =
        typeof siteName === "string" ? siteName.trim() || null : null;
      return {
        image: normalizedImage,
        title: normalizedTitle,
        author: normalizedAuthor,
        siteName: normalizedSiteName,
      };
    }
    return { image: null, title: null, author: null, siteName: null };
  } catch {
    return null;
  }
}

export async function fetchOpenGraphImage(
  url: string
): Promise<string | null> {
  const metadata = await fetchOpenGraphMetadata(url);
  return metadata?.image ?? null;
}

