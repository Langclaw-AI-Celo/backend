import assert from "node:assert/strict";
import test from "node:test";

import { isExecutorAvailable } from "./executor";
import {
  detectChain,
  detectChainWithFallback,
  detectUnsupportedOnChainChain,
  resolveChain,
} from "./chains";
import { planOnChainTools } from "./planner";
import { getTokenBalances } from "./providers/alchemy";
import { getYieldPools } from "./providers/defillama";
import { searchPairs } from "./providers/dexscreener";
import { getLatestResult } from "./providers/dune";
import { getAccountBalance } from "./providers/etherscan";
import { getTokenSecurity } from "./providers/goplus";
import { assertRegistryShape, onChainCommands } from "./registry";
import { onChainDomains } from "./types";
import { jsonResponse, mockFetch, withEnv } from "../../test/helpers";

test("on-chain registry exposes at least 83 commands across exactly 14 domains", () => {
  const shape = assertRegistryShape();

  assert.equal(shape.expectedDomainCount, 14);
  assert.equal(shape.domainCount, 14);
  assert.ok(shape.commandCount >= 83);
  assert.equal(onChainDomains.length, 14);
});

test("on-chain registry commands have schemas, executors, providers, and risk levels", () => {
  for (const command of onChainCommands) {
    assert.ok(command.id.includes("."));
    assert.equal(command.paramsSchema.type, "object");
    assert.ok(command.provider);
    assert.ok(command.riskLevel);
    assert.ok(isExecutorAvailable(command.executor), command.executor);
  }
});

test("Mantle is the default on-chain intelligence network", () => {
  const defaultChain = resolveChain(undefined);
  const detected = detectChain("Find smart-money accumulation on Mantle");
  const mainnetDetected = detectChain("Find smart-money on Mantle mainnet");

  assert.equal(defaultChain.id, "mantle");
  assert.equal(defaultChain.etherscanId, 5000);
  assert.equal(defaultChain.dexScreenerId, "mantle");
  assert.equal(detected.id, "mantle");
  assert.equal(detected.etherscanId, 5000);
  assert.equal(mainnetDetected.id, "mantle");
});

test("Celo is a supported on-chain intelligence network", () => {
  const detected = detectChain("Find smart-money accumulation on Celo");
  const aliasDetected = detectChain("Find token flows on cello");
  const resolved = resolveChain("celo");

  assert.equal(detected.id, "celo");
  assert.equal(detected.chainId, 42220);
  assert.equal(detected.dexScreenerId, "celo");
  assert.equal(detected.alchemyNetwork, "celo-mainnet");
  assert.equal(aliasDetected.id, "celo");
  assert.equal(resolved.etherscanId, 42220);
});

test("prompt chain detection prefers explicit chain over UI fallback", () => {
  const explicitCelo = detectChainWithFallback(
    "Find whale flow on Celo",
    "mantle"
  );
  const explicitMantle = detectChainWithFallback(
    "Find whale flow on Mantle",
    "celo"
  );
  const fallbackCelo = detectChainWithFallback(
    "Find whale flow on the selected chain",
    "celo"
  );

  assert.equal(explicitCelo.id, "celo");
  assert.equal(explicitMantle.id, "mantle");
  assert.equal(fallbackCelo.id, "celo");
});

test("on-chain guard allows explicitly supported analysis networks", () => {
  assert.equal(
    detectUnsupportedOnChainChain("Find trending tokens on Base"),
    null
  );
  assert.equal(
    detectUnsupportedOnChainChain("Find smart-money accumulation on Celo"),
    null
  );
  assert.equal(
    detectUnsupportedOnChainChain("Find trending tokens without naming a chain"),
    null
  );
});

test("Celo plans skip GoPlus and include a provider-gap caveat", () => {
  const plan = planOnChainTools({
    chain: "celo",
    context: [],
    message:
      "Check Celo token security and holders for 0x471ece3750da237f93b8e339c536989b8978a438",
  });

  assert.equal(plan.chain, "celo");
  assert.equal(plan.chainId, 42220);
  assert.ok(!plan.commands.some((item) => item.command.provider === "goplus"));
  assert.ok(plan.providerGaps?.some((gap) => /GoPlus/.test(gap)));
});

test("planner routes Mantle alpha prompts into smart-money and yield domains", async () => {
  await withEnv(
    {
      DUNE_DEFAULT_QUERY_ID: "123456",
      NANSEN_API_KEY: "nansen-test-key",
      NANSEN_ENABLED: "true",
    },
    async () => {
    const smartMoneyPlan = planOnChainTools({
      context: [],
      message: "Find smart-money accumulation on Mantle query 123456",
    });
    const yieldPlan = planOnChainTools({
      context: [],
      message: "Rank Mantle protocols by TVL and yield momentum query 123456",
    });

    assert.equal(smartMoneyPlan.chain, "mantle");
    assert.equal(smartMoneyPlan.chainId, 5000);
    assert.ok(
      smartMoneyPlan.commands.some(
        (item) => item.command.domain === "smart_money"
      )
    );
    assert.equal(smartMoneyPlan.commands[0]?.command.provider, "nansen");
    assert.ok(
      yieldPlan.commands.some(
        (item) =>
          item.command.domain === "defi_tvl" ||
          item.command.domain === "yield_pools"
      )
    );
    assert.ok(
      !yieldPlan.commands.some(
        (item) => item.command.id === "defi_tvl.defillama_protocol_detail"
      )
    );
    }
  );
});

test("planner does not classify smart-money token prompts as wallet analysis by default", async () => {
  await withEnv(
    {
      DUNE_DEFAULT_QUERY_ID: "123456",
      NANSEN_API_KEY: "nansen-test-key",
      NANSEN_ENABLED: "true",
    },
    async () => {
      const plan = planOnChainTools({
        context: [],
        message: "Analyze smart-money accumulation for MNT on Mantle",
      });

      assert.equal(plan.chain, "mantle");
      assert.equal(plan.intent, "smart-money");
      assert.match(plan.query ?? "", /\bMNT\b/);
      assert.equal(plan.walletAddress, undefined);
      assert.ok(
        plan.commands.some(
          (item) =>
            item.command.domain === "smart_money" &&
            item.command.provider === "nansen"
        )
      );
    }
  );
});

test("planner routes generic liquidity-anomaly prompts into GeckoTerminal discovery plus chain-scoped DEX search", () => {
  const plan = planOnChainTools({
    chain: "mantle",
    context: [],
    message: "Detect liquidity anomalies on Base DEX pairs",
  });

  assert.equal(plan.chain, "base");
  assert.equal(plan.query, "Base");
  assert.ok(
    plan.commands.some((item) => item.command.provider === "geckoterminal")
  );
  assert.ok(
    plan.commands.some((item) => item.command.id === "pair_liquidity.liquidity_pair_search")
  );
});

test("planner keeps Celo liquidity anomaly intent while adding DEX search fallback", () => {
  const plan = planOnChainTools({
    chain: "mantle",
    context: [],
    message: "Detect liquidity anomalies on Celo DEX pairs",
  });

  assert.equal(plan.chain, "celo");
  assert.equal(plan.intent, "trading-signal");
  assert.equal(plan.query, "Celo");
  assert.ok(
    plan.commands.some(
      (item) => item.command.id === "pair_liquidity.geckoterminal_network_trending_pools"
    )
  );
  assert.ok(
    plan.commands.some((item) => item.command.id === "pair_liquidity.liquidity_pair_search")
  );
});

test("planner records premium provider scope skips for Celo", () => {
  const plan = planOnChainTools({
    chain: "celo",
    context: [],
    message: "Find smart-money accumulation on Celo",
  });

  assert.ok(
    plan.providerTrace?.some(
      (entry) =>
        entry.provider === "nansen" &&
        entry.status === "skipped" &&
        entry.scope === "out-of-scope"
    )
  );
  assert.ok(
    plan.providerTrace?.some(
      (entry) =>
        entry.provider === "surf" &&
        entry.status === "skipped" &&
        entry.scope === "out-of-scope"
    )
  );
  assert.ok(
    plan.providerTrace?.some(
      (entry) =>
        entry.provider === "elfa" &&
        entry.status === "skipped" &&
        entry.scope === "out-of-scope"
    )
  );
});

test("planner only requests DeFiLlama protocol detail when a concrete slug is present", () => {
  const rankingPlan = planOnChainTools({
    context: [],
    message: "Rank Mantle protocols by TVL and yield momentum",
  });
  const protocolPlan = planOnChainTools({
    context: [],
    message: "Show protocol agni-finance TVL detail on Mantle",
  });

  assert.ok(
    !rankingPlan.commands.some(
      (item) => item.command.executor === "defillama.protocol"
    )
  );
  assert.ok(
    protocolPlan.commands.some(
      (item) => item.command.executor === "defillama.protocol"
    )
  );
});

test("planner keeps meaningful DeFi ranking query context", () => {
  const plan = planOnChainTools({
    context: [],
    message: "Rank Mantle protocols by TVL and yield momentum",
  });

  assert.equal(plan.rawQuery, "Rank Mantle protocols by TVL and yield momentum");
  assert.equal(plan.query, plan.rawQuery);
  assert.equal(plan.intent, "defi");
  assert.ok(
    plan.commands.some((item) => item.command.domain === "yield_pools")
  );
});

test("planner prefers explicit addresses in the latest message over prior context", () => {
  const plan = planOnChainTools({
    context: [
      {
        content:
          "Analyze holder flow and smart-money signals on Mantle token 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
        role: "user",
      },
    ],
    message:
      "Detect liquidity anomaly on Mantle pair 0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5",
  });

  assert.equal(
    plan.tokenAddress,
    "0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5"
  );
  assert.equal(plan.intent, "trading-signal");
  assert.ok(
    plan.commands.some(
      (item) => item.command.id === "pair_liquidity.pair_details"
    )
  );
  assert.ok(
    !plan.commands.some(
      (item) => item.command.id === "market_data.token_metadata"
    )
  );
});

test("planner does not let prior non-Mantle context override the latest Mantle prompt", () => {
  const plan = planOnChainTools({
    context: [
      {
        content: "Find trending tokens on Base",
        role: "user",
      },
    ],
    message:
      "Analyze holder flow and smart-money signals on Mantle token 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  });

  assert.equal(plan.chain, "mantle");
  assert.equal(plan.chainId, 5000);
});

test("DEX Screener provider searches pairs", async () => {
  const restore = mockFetch((url) => {
    assert.equal(new URL(url).pathname, "/latest/dex/search");

    return jsonResponse({
      pairs: [
        {
          baseToken: { symbol: "TEST" },
          chainId: "base",
          dexId: "uniswap",
          liquidity: { usd: 1000 },
          priceUsd: "1.23",
        },
      ],
    });
  });

  try {
    const result = await searchPairs({ chain: "base", query: "TEST" });

    assert.match(result.summary ?? "", /1 pairs returned/);
  } finally {
    restore();
  }
});

test("DEX Screener search filters pair results to the requested chain", async () => {
  const restore = mockFetch((url) => {
    assert.equal(new URL(url).pathname, "/latest/dex/search");

    return jsonResponse({
      pairs: [
        {
          baseToken: { symbol: "WRONG" },
          chainId: "solana",
          dexId: "raydium",
          liquidity: { usd: 999999 },
          priceUsd: "9.99",
        },
        {
          baseToken: { symbol: "MNT" },
          chainId: "mantle",
          dexId: "agni",
          liquidity: { usd: 1000 },
          priceUsd: "1.23",
        },
      ],
    });
  });

  try {
    const result = await searchPairs({ chain: "mantle", query: "MNT" });

    assert.match(result.summary ?? "", /filtered to mantle/);
    assert.match(result.summary ?? "", /Top pair: MNT on agni/);
    assert.equal((result.data as { pairs: unknown[] }).pairs.length, 1);
  } finally {
    restore();
  }
});

test("DeFiLlama provider filters yield pools by chain", async () => {
  const restore = mockFetch((url) => {
    assert.equal(new URL(url).pathname, "/pools");

    return jsonResponse({
      data: [
        { chain: "Base", project: "aave", tvlUsd: 100 },
        { chain: "Ethereum", project: "compound", tvlUsd: 200 },
      ],
    });
  });

  try {
    const result = await getYieldPools({ chain: "base" });

    assert.match(result.summary ?? "", /1 yield pools/);
  } finally {
    restore();
  }
});

test("Etherscan provider uses V2 chainid and API key", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    assert.equal(parsed.pathname, "/v2/api");
    assert.equal(parsed.searchParams.get("chainid"), "8453");
    assert.equal(parsed.searchParams.get("module"), "account");
    assert.equal(parsed.searchParams.get("action"), "balance");
    assert.equal(parsed.searchParams.get("apikey"), "etherscan-test-key");

    return jsonResponse({ message: "OK", result: "1", status: "1" });
  });

  try {
    await withEnv({ ETHERSCAN_API_KEY: "etherscan-test-key" }, async () => {
      const result = await getAccountBalance({
        chain: "base",
        walletAddress: "0x1111111111111111111111111111111111111111",
      });

      assert.match(result.summary ?? "", /Fetched native account balance/);
    });
  } finally {
    restore();
  }
});

test("GoPlus provider calls token security endpoint", async () => {
  const restore = mockFetch((url, init) => {
    const parsed = new URL(url);

    assert.equal(parsed.pathname, "/api/v1/token_security/8453");
    assert.equal(init?.headers && typeof init.headers === "object", true);

    return jsonResponse({
      result: {
        "0x2222222222222222222222222222222222222222": {
          buy_tax: "0",
          is_honeypot: "0",
          sell_tax: "0",
        },
      },
    });
  });

  try {
    await withEnv(
      {
        GOPLUS_API_KEY: "goplus-key",
        GOPLUS_API_SECRET: "goplus-secret",
      },
      async () => {
        const result = await getTokenSecurity({
          chain: "base",
          tokenAddress: "0x2222222222222222222222222222222222222222",
        });

        assert.match(result.summary ?? "", /GoPlus token security/);
      }
    );
  } finally {
    restore();
  }
});

test("Alchemy provider posts token balance JSON-RPC request", async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(url, "https://base-mainnet.g.alchemy.com/v2/alchemy-test-key");
    assert.equal(init?.method, "POST");

    const body = JSON.parse(String(init?.body)) as { method: string };
    assert.equal(body.method, "alchemy_getTokenBalances");

    return jsonResponse({ jsonrpc: "2.0", result: { tokenBalances: [] } });
  });

  try {
    await withEnv({ ALCHEMY_API_KEY: "alchemy-test-key" }, async () => {
      const result = await getTokenBalances({
        chain: "base",
        walletAddress: "0x3333333333333333333333333333333333333333",
      });

      assert.match(result.summary ?? "", /Alchemy/);
    });
  } finally {
    restore();
  }
});

test("Dune provider fetches latest configured query result", async () => {
  const restore = mockFetch((url, init) => {
    assert.equal(new URL(url).pathname, "/api/v1/query/123456/results");
    assert.ok(init?.headers);

    return jsonResponse({ result: { rows: [] } });
  });

  try {
    await withEnv({ DUNE_API_KEY: "dune-test-key" }, async () => {
      const result = await getLatestResult({ queryId: "123456" });

      assert.match(result.summary ?? "", /Dune query result/);
    });
  } finally {
    restore();
  }
});
