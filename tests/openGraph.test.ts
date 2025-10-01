process.env.OPEN_GRAPH_FETCH_TIMEOUT_MS = "100";

import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

type FetchFactory = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => ReturnType<typeof fetch>;

function createRequest(url: string): NextRequest {
  const requestUrl = new URL(url);
  return { nextUrl: requestUrl } as unknown as NextRequest;
}

async function withMockedFetch(factory: FetchFactory, runAssertions: () => Promise<void>) {
  const originalFetch = global.fetch;
  global.fetch = factory as typeof global.fetch;

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
  const rangeHtml = `<!DOCTYPE html><html><head><meta property="og:image" content="https://example.com/range.jpg" /><meta property="og:title" content="Range Title" /></head><body></body></html>`;
  const defaultNamedHtml = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta property="og:title" content="Home" /><meta property="og:image" content="https://i.ytimg.com/vi/abc123/hqdefault.jpg" /></head><body></body></html>`;

  await withMockedFetch(
    async (input, init) => {
      void input;
      void init;
      return new Response(Buffer.from(latinHtml, "latin1"), {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      });
    },
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
    async (input, init) => {
      void input;
      void init;
      return new Response(Buffer.from(jsonLdHtml, "utf-8"), {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      });
    },
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
    async (input, init) => {
      void input;
      void init;
      return new Response(defaultNamedHtml, {
        status: 200,
        headers: {
          "content-type": "application/xhtml+xml; charset=utf-8",
        },
      });
    },
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/default"
      );
      const result = await GET(request);
      const payload = await result.json();

      assert.equal(payload.title, "Home");
      assert.equal(
        payload.image,
        "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
      );
      console.log("Test passed: default-like assets and XHTML content are parsed.");
    }
  );

  await withMockedFetch(
    (() => {
      let callCount = 0;
      return async (input, init) => {
        void input;
        callCount += 1;
        const headers = new Headers(init?.headers ?? {});
        if (callCount === 1) {
          assert.equal(headers.get("Range"), "bytes=0-65535");
          return new Response("Range Not Satisfiable", {
            status: 416,
            headers: {
              "content-type": "text/html",
            },
          });
        }

        assert.equal(headers.get("Range"), null);
        return new Response(rangeHtml, {
          status: 200,
          headers: {
            "content-type": "text/html",
          },
        });
      };
    })(),
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/range"
      );
      const result = await GET(request);
      const payload = await result.json();

      assert.equal(payload.title, "Range Title");
      assert.equal(payload.image, "https://example.com/range.jpg");
      console.log("Test passed: range requests gracefully retry without Range header.");
    }
  );

  await withMockedFetch(
    async (input, init) => {
      void input;
      void init;
      return new Response("Blocked", {
        status: 403,
        headers: {
          "content-type": "text/html",
        },
      });
    },
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/protected"
      );
      const result = await GET(request);
      assert.equal(result.status, 200);
      const payload = await result.json();

      assert.equal(payload.error, "來源被阻擋");
      assert.equal(payload.title, "example.com");
      assert.equal(
        payload.image,
        "https://www.google.com/s2/favicons?sz=128&domain_url=https%3A%2F%2Fexample.com"
      );
      console.log("Test passed: blocked domains fall back to favicon metadata.");
    }
  );

  await withMockedFetch(
    async (input, init) => {
      void input;
      void init;
      return new Response(
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
      );
    },
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/hanging"
      );
      const result = await GET(request);
      assert.equal(result.status, 504);
      const payload = await result.json();
      assert.equal(payload.error, "抓取逾時");
      assert.equal(payload.title, "example.com");
      assert.equal(
        payload.image,
        "https://www.google.com/s2/favicons?sz=128&domain_url=https%3A%2F%2Fexample.com"
      );
      console.log("Test passed: hanging responses time out cleanly.");
    }
  );

  await withMockedFetch(
    async (input, init) => {
      void input;
      void init;
      throw Object.assign(new Error("network"), { name: "FetchError" });
    },
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/network"
      );
      const result = await GET(request);
      assert.equal(result.status, 502);
      const payload = await result.json();
      assert.equal(payload.error, "抓取失敗");
      assert.equal(payload.title, "example.com");
      assert.equal(
        payload.image,
        "https://www.google.com/s2/favicons?sz=128&domain_url=https%3A%2F%2Fexample.com"
      );
      console.log("Test passed: network failures return fallback metadata.");
    }
  );

  await withMockedFetch(
    async (input, init) => {
      void input;
      void init;
      return new Response("binary", {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
      });
    },
    async () => {
      const request = createRequest(
        "http://localhost/api/open-graph?url=https://example.com/not-html"
      );
      const result = await GET(request);
      assert.equal(result.status, 200);
      const payload = await result.json();
      assert.equal(payload.title, "example.com");
      assert.equal(
        payload.image,
        "https://www.google.com/s2/favicons?sz=128&domain_url=https%3A%2F%2Fexample.com"
      );
      console.log("Test passed: non-HTML responses fall back to domain metadata.");
    }
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
