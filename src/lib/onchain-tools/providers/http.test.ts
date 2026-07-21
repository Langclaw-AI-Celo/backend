import assert from "node:assert/strict";
import test from "node:test";

import { fetchJson } from "./http";

const providerResponseLimit = 5 * 1024 * 1024;

test("provider JSON requests reject malformed success payloads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("{not-json", {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })) as typeof fetch;

  try {
    await assert.rejects(
      fetchJson("https://provider.example/data"),
      (error: unknown) => error instanceof SyntaxError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider JSON requests reject oversized declared responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('{"ok":true}', {
      headers: {
        "Content-Length": String(providerResponseLimit + 1),
        "Content-Type": "application/json",
      },
      status: 200,
    })) as typeof fetch;

  try {
    await assert.rejects(
      fetchJson("https://provider.example/data"),
      /Provider response exceeds the 5242880 byte limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider JSON requests enforce the response limit while streaming", async () => {
  const originalFetch = globalThis.fetch;
  const payload = `"${"a".repeat(providerResponseLimit)}"`;
  const midpoint = Math.floor(payload.length / 2);
  const encoder = new TextEncoder();
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(payload.slice(0, midpoint)));
          controller.enqueue(encoder.encode(payload.slice(midpoint)));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 },
    )) as typeof fetch;

  try {
    await assert.rejects(
      fetchJson("https://provider.example/data"),
      /Provider response exceeds the 5242880 byte limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider JSON requests honor caller abort signals", async () => {
  const originalFetch = globalThis.fetch;
  const caller = new AbortController();
  globalThis.fetch = ((_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    })) as typeof fetch;

  try {
    const request = fetchJson("https://provider.example/data", {
      signal: caller.signal,
      timeoutMs: 1000,
    });
    caller.abort();

    await assert.rejects(
      request,
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider JSON requests do not start after caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const caller = new AbortController();
  let fetchCalls = 0;
  caller.abort();
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return Response.json({ ok: true });
  }) as typeof fetch;

  try {
    await assert.rejects(
      fetchJson("https://provider.example/data", {
        signal: caller.signal,
        timeoutMs: 1000,
      }),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider JSON requests abort after their timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    })) as typeof fetch;

  try {
    await assert.rejects(
      fetchJson("https://provider.example/data", { timeoutMs: 1 }),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
