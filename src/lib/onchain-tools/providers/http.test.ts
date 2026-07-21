import assert from "node:assert/strict";
import test from "node:test";

import { fetchJson } from "./http";

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
