import assert from "node:assert/strict";
import test from "node:test";

import { handleStrategyBacktest, readPositiveNumber } from "./strategy";

test("strategy numbers reject partially numeric strings", () => {
  assert.equal(readPositiveNumber("100abc", 25), 25);
  assert.equal(readPositiveNumber(" 12.5 ", 25), 12.5);
  assert.equal(readPositiveNumber(8, 25), 8);
});

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
