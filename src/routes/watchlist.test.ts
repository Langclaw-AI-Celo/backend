import assert from "node:assert/strict";
import test from "node:test";

import { handleWatchlist } from "./watchlist";

test("watchlist routes reject malformed JSON before authentication", async () => {
  const response = await handleWatchlist(
    new Request("http://localhost/api/watchlist", {
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
});

test("watchlist routes require account authentication", async () => {
  const response = await handleWatchlist(
    new Request("http://localhost/api/watchlist", {
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

test("watchlist routes reject unsupported actions", async () => {
  const response = await handleWatchlist(
    new Request("http://localhost/api/watchlist", {
      body: JSON.stringify({ action: "replace-all" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    configured: true,
    error: "Unsupported action.",
  });
});
