import assert from "node:assert/strict";
import test from "node:test";

import { handleAutomationWebhook } from "./automation";

test("automation webhook rejects oversized payloads before execution", async () => {
  const body = JSON.stringify({ payload: "x".repeat(65 * 1024) });
  const response = await handleAutomationWebhook(
    new Request("http://localhost/api/automation/webhooks/oversized-test", {
      body,
      headers: {
        "Content-Length": String(Buffer.byteLength(body)),
        "X-Forwarded-For": "192.0.2.10",
      },
      method: "POST",
    }),
    "oversized-test"
  );

  assert.equal(response.status, 413);
  assert.match(
    ((await response.json()) as { error: string }).error,
    /too large/i
  );
});

test("automation webhook measures payloads when content length is absent", async () => {
  const response = await handleAutomationWebhook(
    new Request("http://localhost/api/automation/webhooks/streamed-test", {
      body: JSON.stringify({ payload: "x".repeat(65 * 1024) }),
      headers: {
        "X-Forwarded-For": "192.0.2.12",
      },
      method: "POST",
    }),
    "streamed-test",
  );

  assert.equal(response.status, 413);
  assert.match(
    ((await response.json()) as { error: string }).error,
    /too large/i,
  );
});

test("automation webhook rate limits repeated slug attempts", async () => {
  let lastResponse = new Response(null, { status: 500 });

  for (let index = 0; index < 31; index += 1) {
    lastResponse = await handleAutomationWebhook(
      new Request("http://localhost/api/automation/webhooks/rate-test", {
        headers: {
          "X-Forwarded-For": "192.0.2.11",
        },
        method: "POST",
      }),
      "rate-test"
    );
  }

  assert.equal(lastResponse.status, 429);
  assert.equal(lastResponse.headers.has("Retry-After"), true);
});

test("automation webhook rate limits remain isolated by slug", async () => {
  const headers = { "X-Forwarded-For": "192.0.2.13" };

  for (let index = 0; index < 31; index += 1) {
    await handleAutomationWebhook(
      new Request("http://localhost/api/automation/webhooks/isolated-a", {
        headers,
        method: "POST",
      }),
      "isolated-a",
    );
  }

  const response = await handleAutomationWebhook(
    new Request("http://localhost/api/automation/webhooks/isolated-b", {
      headers,
      method: "POST",
    }),
    "isolated-b",
  );

  assert.notEqual(response.status, 429);
});
