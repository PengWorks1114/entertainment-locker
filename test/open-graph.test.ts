import test from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { GET } from "../src/app/api/open-graph/route";

const TEST_URL = "https://example.com/article";

interface MinimalRequest {
  nextUrl: URL;
}

function createRequest(url: string): MinimalRequest {
  return {
    nextUrl: new URL(
      `http://localhost/api/open-graph?url=${encodeURIComponent(url)}`
    ),
  };
}

test("GET uses JSON-LD metadata as fallback", async () => {
  const originalFetch = globalThis.fetch;

  const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <script type="application/ld+json">{ invalid json }</script>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","headline":"JSON-LD Headline","author":{"@type":"Person","name":"Jane Doe"},"publisher":{"@type":"Organization","name":"Example Publisher"}}
      </script>
    </head>
    <body>
      <h1>Sample Article</h1>
    </body>
  </html>`;

  const requests: RequestInit[] = [];

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init) {
      requests.push(init);
    }
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  };

  try {
    const response = await GET(createRequest(TEST_URL) as unknown as NextRequest);
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.deepEqual(payload, {
      image: null,
      title: "JSON-LD Headline",
      author: "Jane Doe",
      siteName: "Example Publisher",
    });

    assert.ok(requests.length > 0, "fetch should be invoked");
    const [init] = requests;
    const headers = new Headers(init.headers);
    assert.equal(
      headers.get("User-Agent"),
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    assert.equal(headers.get("Accept-Language"), "en-US,en;q=0.9");
    assert.equal(headers.get("Sec-Fetch-Mode"), "navigate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
