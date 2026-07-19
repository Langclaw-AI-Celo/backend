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

test("strategy routes reject malformed optional identifiers before provider work", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.DUNE_API_KEY;
  const originalQueryId = process.env.DUNE_STRATEGY_QUERY_ID;
  let fetchCalls = 0;

  t.after(() => {
    globalThis.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.DUNE_API_KEY;
    } else {
      process.env.DUNE_API_KEY = originalApiKey;
    }

    if (originalQueryId === undefined) {
      delete process.env.DUNE_STRATEGY_QUERY_ID;
    } else {
      process.env.DUNE_STRATEGY_QUERY_ID = originalQueryId;
    }
  });

  process.env.DUNE_API_KEY = "test-key";
  process.env.DUNE_STRATEGY_QUERY_ID = "123";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("provider should not be called");
  };

  for (const body of [
    { queryId: 123 },
    { queryId: "   " },
    { pairAddress: [] },
    { pairAddress: "" },
  ]) {
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
      error: "queryId and pairAddress must be non-empty strings when provided.",
    });
  }

  assert.equal(fetchCalls, 0);
});

test("strategy routes redact unexpected provider failures", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.DUNE_API_KEY;
  const originalQueryId = process.env.DUNE_STRATEGY_QUERY_ID;

  t.after(() => {
    globalThis.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.DUNE_API_KEY;
    } else {
      process.env.DUNE_API_KEY = originalApiKey;
    }

    if (originalQueryId === undefined) {
      delete process.env.DUNE_STRATEGY_QUERY_ID;
    } else {
      process.env.DUNE_STRATEGY_QUERY_ID = originalQueryId;
    }
  });

  process.env.DUNE_API_KEY = "test-key";
  process.env.DUNE_STRATEGY_QUERY_ID = "123";
  globalThis.fetch = async () =>
    new Response("provider returned private malformed data", { status: 200 });

  const response = await handleStrategyBacktest(
    new Request("http://localhost/api/strategy/backtest", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    configured: false,
    error: "Strategy request failed.",
  });
});
