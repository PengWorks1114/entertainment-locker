type OpenGraphMetadata = {
  image: string | null;
  title: string | null;
  description: string | null;
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
    if (
      data &&
      typeof data === "object" &&
      "image" in data &&
      "title" in data
    ) {
      const { image, title } = data as {
        image: unknown;
        title: unknown;
      };
      const normalizedImage =
        typeof image === "string" ? image.trim() || null : null;
      const normalizedTitle =
        typeof title === "string" ? title.trim() || null : null;
      const normalizedDescription =
        "description" in data && typeof (data as { description?: unknown }).description === "string"
          ? ((data as { description?: unknown }).description as string).trim() || null
          : null;
      const normalizedSiteName =
        "siteName" in data && typeof (data as { siteName?: unknown }).siteName === "string"
          ? ((data as { siteName?: unknown }).siteName as string).trim() || null
          : null;
      return {
        image: normalizedImage,
        title: normalizedTitle,
        description: normalizedDescription,
        siteName: normalizedSiteName,
      };
    }
    return { image: null, title: null, description: null, siteName: null };
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

