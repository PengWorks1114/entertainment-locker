import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import { GET } from "../src/app/api/open-graph/route.ts";

async function run() {
  const html = `<!DOCTYPE html><html><head><meta charset="iso-8859-1" />\n<title>Caf\u00e9 \u00dcber</title><meta property="og:image" content="https://example.com/preview.jpg" /></head><body></body></html>`;
  const bodyBytes = Buffer.from(html, "latin1");

  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(Buffer.from(bodyBytes), {
      status: 200,
      headers: {
        "content-type": "text/html",
      },
    });

  try {
    const requestUrl = new URL(
      "http://localhost/api/open-graph?url=https://example.com/article"
    );
    const request = { nextUrl: requestUrl } as unknown as NextRequest;
    const result = await GET(request);
    const payload = await result.json();

    assert.equal(payload.title, "Caf\u00e9 \u00dcber");
    assert.equal(payload.image, "https://example.com/preview.jpg");
    console.log("Test passed: non-UTF8 HTML metadata extracted correctly.");
  } finally {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      // @ts-expect-error - allow cleanup when fetch was undefined
      delete global.fetch;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
