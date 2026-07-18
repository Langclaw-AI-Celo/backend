import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAutomationNotifications,
  handleAutomationRuns,
  handleAutomationSettings,
  handleAutomationTasks,
  handleAutomationWebhook,
} from "./automation";

test("automation routes reject unsupported actions before service calls", async () => {
  for (const handler of [
    handleAutomationTasks,
    handleAutomationRuns,
    handleAutomationSettings,
    handleAutomationNotifications,
  ]) {
    const response = await handler(
      new Request("http://localhost/api/automation", {
        body: JSON.stringify({ action: "replace-all" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Unsupported action.",
    });
  }
});

test("automation routes keep every supported action behind account authentication", async () => {
  const cases = [
    {
      actions: [
        undefined,
        "list",
        "create",
        "update",
        "pause",
        "resume",
        "delete",
        "pause-all",
        "resume-all",
      ],
      handler: handleAutomationTasks,
    },
    {
      actions: [undefined, "list", "run", "tick", "event"],
      handler: handleAutomationRuns,
    },
    {
      actions: [undefined, "get", "update"],
      handler: handleAutomationSettings,
    },
    {
      actions: [
        "request-email-link",
        "verify-email-link",
        "unlink-email",
        "create-telegram-link",
        "poll-telegram-link",
        "unlink-telegram",
        "list-in-app",
        "mark-in-app-read",
        "mark-all-in-app-read",
      ],
      handler: handleAutomationNotifications,
    },
  ];

  for (const { actions, handler } of cases) {
    for (const action of actions) {
      const response = await handler(
        new Request("http://localhost/api/automation", {
          body: JSON.stringify(action ? { action } : {}),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );

      assert.equal(response.status, 401, String(action ?? "default"));
      assert.deepEqual(await response.json(), {
        error: "Wallet signature or API key is required.",
      });
    }
  }
});

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
