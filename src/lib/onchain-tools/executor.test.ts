import assert from "node:assert/strict";
import test from "node:test";

import { executeOnChainPlan } from "./executor";
import { onChainCommandById } from "./registry";
import type { OnChainPlan } from "./types";

test("on-chain result cache evicts its oldest entry at capacity", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return Response.json({ pairs: [] });
  }) as typeof fetch;

  try {
    await executeOnChainPlan({ plan: buildPairSearchPlan("cache-query-0") });

    for (let index = 1; index <= 64; index += 1) {
      await executeOnChainPlan({
        plan: buildPairSearchPlan(`cache-query-${index}`),
      });
    }

    await executeOnChainPlan({ plan: buildPairSearchPlan("cache-query-0") });

    assert.equal(fetchCalls, 66);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function buildPairSearchPlan(query: string): OnChainPlan {
  const command = onChainCommandById.get(
    "pair_liquidity.liquidity_pair_search",
  );

  assert.ok(command);

  return {
    analysisSource: "prompt",
    chain: "celo",
    chainId: 42220,
    chainName: "Celo",
    commands: [{ command, reason: "Exercise bounded provider caching." }],
    domainCount: 1,
    intent: "pair-liquidity",
    nativeSymbol: "CELO",
    productChain: "celo",
    productChainId: 42220,
    productChainName: "Celo",
    query,
    rawQuery: query,
    registryCommandCount: 1,
  };
}
