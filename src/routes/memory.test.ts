import assert from "node:assert/strict";
import test from "node:test";

import { handleMemory, handleMemorySettings } from "./memory";

test("memory routes reject malformed JSON before authentication", async () => {
  for (const handler of [handleMemory, handleMemorySettings]) {
    const response = await handler(
      new Request("http://localhost/api/memory", {
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: true,
      error: "Request body must be valid JSON.",
    });
  }
});

test("memory routes require account authentication", async () => {
  const response = await handleMemory(
    new Request("http://localhost/api/memory", {
      body: JSON.stringify({ action: "list" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    configured: true,
    error: "Wallet signature or API key is required.",
  });
});
