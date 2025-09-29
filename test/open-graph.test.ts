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

test("GET merges browser and legacy fetch metadata", async () => {
  const originalFetch = globalThis.fetch;

  const browserHtml = `<!DOCTYPE html>
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

  const legacyHtml = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta property="og:image" content="/legacy-image.jpg" />
      <meta property="og:title" content="Legacy Title" />
    </head>
    <body>
      <img src="/legacy-image.jpg" alt="Legacy" />
    </body>
  </html>`;

  const requests: RequestInit[] = [];
  let callCount = 0;

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init) {
      requests.push(init);
    }
    const html = callCount === 0 ? browserHtml : legacyHtml;
    callCount += 1;
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
      image: "https://example.com/legacy-image.jpg",
      title: "JSON-LD Headline",
      author: "Jane Doe",
      siteName: "Example Publisher",
    });

    assert.equal(callCount, 2, "should perform primary and fallback fetches");
    assert.equal(requests.length, 2);

    const primaryHeaders = new Headers(requests[0]?.headers);
    assert.equal(
      primaryHeaders.get("User-Agent"),
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    assert.equal(primaryHeaders.get("Accept-Language"), "en-US,en;q=0.9");
    assert.equal(primaryHeaders.get("Sec-Fetch-Mode"), "navigate");

    const fallbackHeaders = new Headers(requests[1]?.headers);
    assert.equal(
      fallbackHeaders.get("User-Agent"),
      "Mozilla/5.0 (compatible; EntertainmentLockerBot/1.0; +https://github.com/)"
    );
    assert.equal(fallbackHeaders.get("Accept"), "text/html,application/xhtml+xml");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET recovers metadata when primary response is generic", async () => {
  const originalFetch = globalThis.fetch;

  const browserHtml = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Example.com</title>
      <meta property="og:image" content="/favicon.ico" />
      <meta property="og:site_name" content="example.com" />
    </head>
    <body>
      <h1>Homepage</h1>
    </body>
  </html>`;

  const legacyHtml = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"NewsArticle","headline":"Legacy Title","author":{"@type":"Person","name":"Legacy Reporter"},"publisher":{"@type":"Organization","name":"Example News"},"image":{"@type":"ImageObject","url":"/jsonld-cover.jpg"}}
      </script>
    </head>
    <body>
      <article>
        <h1>Legacy Title</h1>
      </article>
    </body>
  </html>`;

  let callCount = 0;

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.headers && callCount === 0) {
      const headers = new Headers(init.headers);
      if (!headers.get("User-Agent")?.includes("Chrome")) {
        throw new Error("expected primary request to mimic a browser");
      }
    }
    const html = callCount === 0 ? browserHtml : legacyHtml;
    callCount += 1;
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
      image: "https://example.com/jsonld-cover.jpg",
      title: "Legacy Title",
      author: "Legacy Reporter",
      siteName: "Example News",
    });

    assert.equal(callCount, 2, "should fallback when primary metadata is generic");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET falls back to legacy fetch when primary request fails", async () => {
  const originalFetch = globalThis.fetch;

  const legacyHtml = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta property="og:title" content="Legacy Udemy Course" />
      <meta property="og:image" content="/course-cover.jpg" />
      <meta property="og:site_name" content="Udemy" />
      <meta name="author" content="Udemy Instructor" />
    </head>
    <body>
      <h1>Legacy Udemy Course</h1>
    </body>
  </html>`;

  let callCount = 0;

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("Blocked", {
        status: 403,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (init) {
      const headers = new Headers(init.headers);
      if (callCount === 2) {
        if (
          headers.get("User-Agent") !==
          "Mozilla/5.0 (compatible; EntertainmentLockerBot/1.0; +https://github.com/)"
        ) {
          throw new Error("expected legacy fallback headers");
        }
      }
    }

    return new Response(legacyHtml, {
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
      image: "https://example.com/course-cover.jpg",
      title: "Legacy Udemy Course",
      author: "Udemy Instructor",
      siteName: "Udemy",
    });

    assert.equal(callCount, 2, "should retry with legacy headers after failure");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
