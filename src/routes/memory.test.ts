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

test("memory routes reject non-object JSON before authentication", async () => {
  for (const handler of [handleMemory, handleMemorySettings]) {
    for (const body of [null, [], "invalid"]) {
      const response = await handler(
        new Request("http://localhost/api/memory", {
          body: JSON.stringify(body),
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

test("memory routes reject unsupported actions before service calls", async () => {
  for (const handler of [handleMemory, handleMemorySettings]) {
    const response = await handler(
      new Request("http://localhost/api/memory", {
        body: JSON.stringify({ action: "replace-all" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: true,
      error: "Unsupported action.",
    });
  }
});

test("memory routes keep every supported action behind account authentication", async () => {
  const cases = [
    {
      actions: [
        undefined,
        "list",
        "create",
        "status",
        "bulk-status",
        "delete",
        "bulk-delete",
      ],
      handler: handleMemory,
    },
    {
      actions: [undefined, "get", "update"],
      handler: handleMemorySettings,
    },
  ];

  for (const { actions, handler } of cases) {
    for (const action of actions) {
      const response = await handler(
        new Request("http://localhost/api/memory", {
          body: JSON.stringify(action ? { action } : {}),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      assert.equal(response.status, 401, String(action ?? "default"));
      assert.deepEqual(await response.json(), {
        configured: true,
        error: "Wallet signature or API key is required.",
      });
    }
  }
});
