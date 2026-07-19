import assert from "node:assert/strict";
import test from "node:test";

import { handleStrategyBacktest } from "./strategy";

test("strategy routes reject malformed JSON before provider work", async () => {
  const response = await handleStrategyBacktest(
    new Request("http://localhost/api/strategy/backtest", {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    configured: false,
    error: "Request body must be valid JSON.",
  });
});

test("strategy routes reject non-object JSON before provider work", async () => {
  for (const body of [null, [], "invalid"]) {
    const response = await handleStrategyBacktest(
      new Request("http://localhost/api/strategy/backtest", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "Request body must be a JSON object.",
    });
  }
});
