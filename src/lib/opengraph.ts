export async function fetchOpenGraphImage(
  url: string
): Promise<string | null> {
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
      typeof (data as { image: unknown }).image === "string"
    ) {
      const image = (data as { image: string }).image.trim();
      return image ? image : null;
    }
    return null;
  } catch {
    return null;
  }
}

