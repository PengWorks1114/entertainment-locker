process.env.OPEN_GRAPH_FETCH_TIMEOUT_MS = "100";

import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

type FetchFactory = () => Promise<Response>;

function createRequest(url: string): NextRequest {
  const requestUrl = new URL(url);
  return { nextUrl: requestUrl } as unknown as NextRequest;
}

async function withMockedFetch(factory: FetchFactory, runAssertions: () => Promise<void>) {
  const originalFetch = global.fetch;
  global.fetch = factory;

  try {
    await runAssertions();
  } finally {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // @ts-expect-error - allow cleanup when fetch was undefined
      delete global.fetch;
    }
  }
}

async function run() {
  const { GET } = await import("../src/app/api/open-graph/route.ts");

  const latinHtml = `<!DOCTYPE html><html><head><meta charset="iso-8859-1" />\n<title>Caf\u00e9 \u00dcber</title><meta property="og:image" content="https://example.com/preview.jpg" /></head><body></body></html>`;
  const jsonLdHtml = `<!DOCTYPE html><html><head><title>Placeholder</title><script type="application/ld+json">{\n  "@context": "https://schema.org",\n  "@type": "NewsArticle",\n  "headline": "JSON-LD Title",\n  "image": {\n    "@type": "ImageObject",\n    "url": "https://cdn.example.com/card.jpg"\n  }\n}</script></head><body><h1>Story</h1></body></html>`;

  await withMockedFetch(
    async () =>
      new Response(Buffer.from(latinHtml, "latin1"), {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      }),
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/article"
      );
      const result = await GET(request);
      const payload = await result.json();

      assert.equal(payload.title, "Caf\u00e9 \u00dcber");
      assert.equal(payload.image, "https://example.com/preview.jpg");
      console.log("Test passed: non-UTF8 HTML metadata extracted correctly.");
    }
  );

  await withMockedFetch(
    async () =>
      new Response(Buffer.from(jsonLdHtml, "utf-8"), {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      }),
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/jsonld"
      );
      const result = await GET(request);
      const payload = await result.json();

      assert.equal(payload.title, "JSON-LD Title");
      assert.equal(payload.image, "https://cdn.example.com/card.jpg");
      console.log("Test passed: JSON-LD metadata extracted correctly.");
    }
  );

  await withMockedFetch(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode("<!DOCTYPE html><html><head>")
            );
            // leave the stream open to simulate a hanging response
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        }
      ),
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/hanging"
      );
      const result = await GET(request);
      assert.equal(result.status, 504);
      const payload = await result.json();
      assert.equal(payload.error, "抓取逾時");
      console.log("Test passed: hanging responses time out cleanly.");
    }
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
