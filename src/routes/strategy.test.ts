import assert from "node:assert/strict";
import test from "node:test";

import {
  handleStrategyBacktest,
  handleStrategyPaperTrade,
  handleStrategyScanPairs,
  readPositiveNumber,
} from "./strategy";

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

test("strategy routes reject invalid identifier syntax before provider work", async (t) => {
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
    { queryId: "12/path" },
    { pairAddress: "not-an-address" },
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
      error:
        "queryId must be numeric and pairAddress must be an EVM address when provided.",
    });
  }

  assert.equal(fetchCalls, 0);
});

test("strategy routes reject malformed backtest parameters before provider work", async (t) => {
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

  for (const params of [
    null,
    [],
    { minLiquidityUsd: "1000" },
    { minLiquidityUsd: 0 },
    { unsupportedThreshold: 100 },
  ]) {
    const response = await handleStrategyBacktest(
      new Request("http://localhost/api/strategy/backtest", {
        body: JSON.stringify({ params }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "params must contain only supported positive finite numbers.",
    });
  }

  assert.equal(fetchCalls, 0);
});

test("strategy routes reject unsupported chains before provider work", async (t) => {
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

  for (const chain of [42220, "", "solana"]) {
    const response = await handleStrategyBacktest(
      new Request("http://localhost/api/strategy/backtest", {
        body: JSON.stringify({ chain }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "chain must identify a supported product chain when provided.",
    });
  }

  assert.equal(fetchCalls, 0);
});

test("strategy routes reject malformed positive numbers before provider work", async (t) => {
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

  for (const [handler, body] of [
    [handleStrategyScanPairs, { limit: "12rows" }],
    [handleStrategyScanPairs, { limit: 0 }],
    [handleStrategyPaperTrade, { notionalUsd: false }],
    [handleStrategyPaperTrade, { notionalUsd: -1 }],
  ] as const) {
    const response = await handler(
      new Request("http://localhost/api/strategy/test", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error:
        "limit and notionalUsd must be positive finite numbers when provided.",
    });
  }

  assert.equal(fetchCalls, 0);
});

test("paper trades reject malformed backtest inputs before journal work", async () => {
  const valid = paperBacktestInput();
  const invalidBacktests = [
    "invalid",
    {},
    { ...valid, latestSignal: null },
    {
      ...valid,
      latestSignal: { ...valid.latestSignal, action: "transfer" },
    },
    {
      ...valid,
      latestSignal: { ...valid.latestSignal, confidence: 101 },
    },
    {
      ...valid,
      latestSignal: { ...valid.latestSignal, priceUsd: 0 },
    },
    { ...valid, market: "celo:not-an-address", pairAddress: "not-an-address" },
    { ...valid, runId: "" },
  ];

  for (const backtest of invalidBacktests) {
    const response = await handleStrategyPaperTrade(
      new Request("http://localhost/api/strategy/paper-trade", {
        body: JSON.stringify({ backtest }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "backtest must contain valid paper-trade inputs.",
    });
  }
});

test("paper trades reject inconsistent backtest chain metadata", async () => {
  const valid = paperBacktestInput();
  const requests = [
    { backtest: { ...valid, chainId: 5000 } },
    { backtest: { ...valid, chainName: "Mantle" } },
    { backtest: valid, chain: "mantle" },
  ];

  for (const body of requests) {
    const response = await handleStrategyPaperTrade(
      new Request("http://localhost/api/strategy/paper-trade", {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "backtest chain metadata must match the requested product chain.",
    });
  }
});

test("paper trades reject inconsistent market and strategy identities", async () => {
  const valid = paperBacktestInput();
  const invalidBacktests = [
    { ...valid, market: `mantle:${valid.pairAddress}` },
    { ...valid, market: "celo:another-pair" },
    { ...valid, strategyId: "mantle-liquidity-momentum-v1" },
  ];

  for (const backtest of invalidBacktests) {
    const response = await handleStrategyPaperTrade(
      new Request("http://localhost/api/strategy/paper-trade", {
        body: JSON.stringify({ backtest }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: false,
      error: "backtest market and strategy identity must match its chain and pair.",
    });
  }
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

function paperBacktestInput() {
  return {
    chain: "celo",
    chainId: 42220,
    chainName: "Celo",
    latestSignal: {
      action: "buy",
      confidence: 80,
      priceUsd: 1.02,
      rationale: "Liquidity and momentum meet the configured thresholds.",
    },
    market: "celo:0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5",
    pairAddress: "0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5",
    runId: "bt-test",
    strategyId: "celo-liquidity-momentum-v1",
  };
}
