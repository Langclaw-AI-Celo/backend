import assert from "node:assert/strict";
import test from "node:test";

import { runOnChainToolWorkflow } from "./workflow";
import { jsonResponse, mockFetch, withEnv } from "../../test/helpers";

async function runSmartMoneyWorkflowWithMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  message = "Find smart-money accumulation on Mantle"
) {
  const restore = mockFetch(handler);

  try {
    return await withEnv(
      {
        DUNE_API_KEY: "dune-test-key",
        DUNE_DEFAULT_QUERY_ID: "123456",
        NANSEN_API_KEY: "nansen-test-key",
        NANSEN_ENABLED: "true",
      },
      async () =>
        runOnChainToolWorkflow({
          chain: "mantle",
          context: [],
          message,
        })
    );
  } finally {
    restore();
  }
}

test("Nansen smart-money netflow request omits unsupported fields", async () => {
  const result = await runSmartMoneyWorkflowWithMock((url, init) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.nansen.ai" &&
      parsed.pathname === "/api/v1/smart-money/netflow"
    ) {
      assert.equal(init?.method, "POST");

      const body = JSON.parse(String(init?.body ?? "{}")) as {
        filters?: Record<string, unknown>;
        query?: unknown;
      };

      assert.equal("query" in body, false);
      assert.equal("value_usd" in (body.filters ?? {}), false);
      assert.deepEqual(body.filters?.include_smart_money_labels, [
        "Fund",
        "Smart Trader",
      ]);

      return jsonResponse({
        data: [
          {
            net_flow_7d_usd: 180000,
            symbol: "MNT",
          },
        ],
      });
    }

    return jsonResponse({ ok: true });
  });

  const smartMoney = result.payload.tools.find(
    (tool) => tool.commandId === "smart_money.nansen_smart_money_netflow"
  );

  assert.equal(smartMoney?.provider, "nansen");
  assert.equal(smartMoney?.status, "success");
  assert.ok(
    result.payload.providerTrace?.some(
      (entry) => entry.provider === "nansen" && entry.status === "success"
    )
  );
});

test("on-chain workflow preserves fallback provider attribution", async () => {
  const fallbackResult = await runSmartMoneyWorkflowWithMock((url, init) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.nansen.ai" &&
      parsed.pathname === "/api/v1/smart-money/netflow"
    ) {
      assert.equal(init?.method, "POST");

      return jsonResponse(
        {
          error: "upstream unavailable",
        },
        {
          status: 503,
          statusText: "Service Unavailable",
        }
      );
    }

    if (
      parsed.hostname === "api.dune.com" &&
      parsed.pathname === "/api/v1/query/123456/results"
    ) {
      return jsonResponse({
        result: {
          rows: [
            {
              net_flow_7d_usd: 250000,
              symbol: "MNT",
            },
          ],
        },
      });
    }

    return jsonResponse({ ok: true });
  }, "Find smart-money accumulation on Mantle scenario one");
  const fallbackSmartMoney = fallbackResult.payload.tools.find(
    (tool) => tool.commandId === "smart_money.nansen_smart_money_netflow"
  );

  assert.equal(fallbackSmartMoney?.provider, "dune");
  assert.deepEqual(fallbackSmartMoney?.attemptedProviders, ["nansen", "dune"]);
  assert.match(fallbackSmartMoney?.fallbackReason ?? "", /Nansen/i);
  assert.equal(fallbackSmartMoney?.scope, "legacy-fallback");
  assert.ok(
    fallbackResult.payload.providerTrace?.some(
      (entry) => entry.provider === "nansen" && entry.status === "failed"
    )
  );
  assert.ok(
    fallbackResult.payload.providerTrace?.some(
      (entry) => entry.provider === "dune" && entry.status === "success"
    )
  );

  const failedResult = await runSmartMoneyWorkflowWithMock((url, init) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.nansen.ai" &&
      parsed.pathname === "/api/v1/smart-money/netflow"
    ) {
      assert.equal(init?.method, "POST");

      return jsonResponse(
        {
          error: "invalid request",
          message: "Unknown field",
        },
        {
          status: 422,
          statusText: "Unprocessable Entity",
        }
      );
    }

    if (
      parsed.hostname === "api.dune.com" &&
      parsed.pathname === "/api/v1/query/123456/results"
    ) {
      return jsonResponse(
        {
          error: "query id missing",
        },
        {
          status: 400,
          statusText: "Bad Request",
        }
      );
    }

    return jsonResponse({ ok: true });
  }, "Find smart-money accumulation on Mantle scenario two");
  const failedSmartMoney = failedResult.payload.tools.find(
    (tool) => tool.commandId === "smart_money.nansen_smart_money_netflow"
  );

  assert.equal(failedSmartMoney?.status, "failed");
  assert.equal(failedSmartMoney?.provider, "nansen");
  assert.deepEqual(failedSmartMoney?.attemptedProviders, ["nansen", "dune"]);
  assert.match(failedSmartMoney?.fallbackReason ?? "", /nansen:/i);
  assert.match(failedSmartMoney?.fallbackReason ?? "", /dune:/i);
  assert.equal(failedResult.payload.report?.kind, "smart-money");
  assert.equal(failedResult.payload.report?.tables.length, 0);
});

test("on-chain workflow emits a liquidity anomaly report when pair metrics are available", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname ===
        "/latest/dex/pairs/mantle/0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5"
    ) {
      return jsonResponse({
        pairs: [
          {
            baseToken: { symbol: "BSB" },
            liquidity: { usd: 843200 },
            pairAddress: "0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5",
            priceChange: { h24: 21.6 },
            quoteToken: { symbol: "USDT0" },
            txns: { h24: { buys: 3440, sells: 3440 } },
            volume: { h24: 1870000 },
          },
        ],
      });
    }

    return jsonResponse({ ok: true });
  });

  try {
    const result = await runOnChainToolWorkflow({
      chain: "mantle",
      context: [],
      message:
        "Detect liquidity anomaly on Mantle pair 0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5",
    });

    assert.equal(result.payload.report?.kind, "liquidity-anomaly");
    assert.equal(result.payload.report?.entities[0]?.label, "BSB / USDT0");
    assert.equal(result.payload.report?.tables[0]?.id, "anomaly-table");
  } finally {
    restore();
  }
});

test("on-chain workflow emits a liquidity anomaly report for generic Celo pair scans when GeckoTerminal fails", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.coingecko.com" &&
      parsed.pathname === "/api/v3/onchain/networks"
    ) {
      return jsonResponse({
        data: [
          {
            attributes: {
              name: "Celo",
              coingecko_asset_platform_id: "celo",
            },
            id: "celo",
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.coingecko.com" &&
      (parsed.pathname === "/api/v3/onchain/networks/celo/trending_pools" ||
        parsed.pathname === "/api/v3/onchain/networks/celo/new_pools")
    ) {
      return jsonResponse(
        { error: "missing api key" },
        {
          status: 401,
          statusText: "Unauthorized",
        }
      );
    }

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname === "/latest/dex/search"
    ) {
      assert.equal(parsed.searchParams.get("q"), "Celo");

      return jsonResponse({
        pairs: [
          {
            baseToken: { symbol: "BASE" },
            chainId: "base",
            liquidity: { usd: 999999 },
            pairAddress: "0x0000000000000000000000000000000000000001",
            priceChange: { h24: 80 },
            quoteToken: { symbol: "USDC" },
            txns: { h24: { buys: 3000, sells: 3000 } },
            volume: { h24: 5000000 },
          },
          {
            baseToken: { symbol: "CELO" },
            chainId: "celo",
            liquidity: { usd: 8251.71 },
            pairAddress: "0x2d70cBAbf4d8e61d5317b62cBe912935FD94e0FE",
            priceChange: { h24: -5.76 },
            quoteToken: { symbol: "USDm" },
            txns: { h24: { buys: 1090, sells: 991 } },
            volume: { h24: 51706.63 },
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname === "/token-boosts/latest/v1"
    ) {
      return jsonResponse([]);
    }

    return jsonResponse({ ok: true });
  });

  try {
    const result = await runOnChainToolWorkflow({
      chain: "mantle",
      context: [],
      message: "Detect liquidity anomalies on Celo DEX pairs",
    });

    assert.equal(result.payload.report?.kind, "liquidity-anomaly");
    assert.equal(result.payload.report?.entities[0]?.label, "CELO / USDm");
    assert.equal(result.payload.report?.tables[0]?.id, "anomaly-table");
    assert.ok(
      !result.payload.report?.entities.some((entity) =>
        String(entity.metrics.pairAddress).includes("0000000000000001")
      )
    );
  } finally {
    restore();
  }
});

test("on-chain workflow emits a DeFi yield report for generic Mantle ranking prompts", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.hostname === "api.llama.fi" && parsed.pathname === "/protocols") {
      return jsonResponse([
        {
          chainTvls: {
            Mantle: 136579045.42,
          },
          chains: ["Ethereum", "Mantle"],
          change_1d: -5.42,
          change_7d: -6.36,
          name: "Aave V3",
          slug: "aave-v3",
        },
        {
          chainTvls: {
            Base: 999999999,
          },
          chains: ["Base"],
          name: "Aerodrome",
          slug: "aerodrome",
        },
      ]);
    }

    if (parsed.hostname === "api.llama.fi" && parsed.pathname === "/v2/chains") {
      return jsonResponse([{ name: "Mantle", tvl: 755000000 }]);
    }

    if (parsed.hostname === "stablecoins.llama.fi") {
      return jsonResponse({ peggedAssets: [] });
    }

    if (parsed.hostname === "yields.llama.fi" && parsed.pathname === "/pools") {
      return jsonResponse({
        data: [
          {
            apy: 5.53,
            apyPct1D: -0.4,
            apyPct7D: 0.09,
            chain: "Mantle",
            pool: "aave-v3-usdt0",
            project: "aave-v3",
            symbol: "USDT0",
            tvlUsd: 29030215,
          },
          {
            apy: 30,
            chain: "Base",
            pool: "aerodrome-usdc",
            project: "aerodrome",
            symbol: "USDC",
            tvlUsd: 9000000,
          },
        ],
      });
    }

    return jsonResponse({ ok: true });
  });

  try {
    const result = await runOnChainToolWorkflow({
      chain: "mantle",
      context: [],
      message: "Rank Mantle protocols by TVL and yield momentum",
    });

    assert.equal(result.payload.report?.kind, "defi-yield");
    assert.equal(result.payload.report?.entities[0]?.label, "Aave V3");
    assert.equal(result.payload.report?.tables[0]?.id, "yield-table");
    assert.ok(
      !result.payload.report?.entities.some((entity) =>
        entity.label.toLowerCase().includes("aerodrome")
      )
    );
  } finally {
    restore();
  }
});

test("on-chain workflow emits a token discovery report for generic analysis chains", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname === "/token-boosts/top/v1"
    ) {
      return jsonResponse([
        {
          chainId: "solana",
          tokenAddress: "So11111111111111111111111111111111111111112",
          totalAmount: 800,
          url: "https://dexscreener.com/solana/So11111111111111111111111111111111111111112",
        },
        {
          chainId: "base",
          tokenAddress: "0x0000000000000000000000000000000000000001",
          totalAmount: 9999,
          url: "https://dexscreener.com/base/0x0000000000000000000000000000000000000001",
        },
      ]);
    }

    if (
      parsed.hostname === "api.dexscreener.com" &&
      parsed.pathname === "/token-profiles/latest/v1"
    ) {
      return jsonResponse([
        {
          chainId: "solana",
          tokenAddress: "So11111111111111111111111111111111111111112",
          updatedAt: "2026-05-23T08:00:00.000Z",
          url: "https://dexscreener.com/solana/So11111111111111111111111111111111111111112",
        },
      ]);
    }

    if (parsed.hostname === "api.coingecko.com" && parsed.pathname === "/api/v3/search") {
      return jsonResponse({ coins: [] });
    }

    if (
      parsed.hostname === "api.coingecko.com" &&
      parsed.pathname === "/api/v3/onchain/networks"
    ) {
      return jsonResponse({
        data: [
          {
            attributes: {
              name: "Solana",
              coingecko_asset_platform_id: "solana",
            },
            id: "solana",
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.coingecko.com" &&
      parsed.pathname === "/api/v3/onchain/networks/solana/trending_pools"
    ) {
      return jsonResponse({
        data: [
          {
            attributes: {
              base_token_symbol: "SOLX",
              name: "SOLX / USDC",
              price_change_percentage: {
                h24: "21.5",
              },
              reserve_in_usd: "150000",
              volume_usd: {
                h24: "450000",
              },
            },
            id: "solana_pool_pool-sol",
            relationships: {
              base_token: {
                data: {
                  id: "solana_So11111111111111111111111111111111111111112",
                },
              },
            },
          },
        ],
      });
    }

    if (
      parsed.hostname === "api.coingecko.com" &&
      parsed.pathname === "/api/v3/onchain/networks/solana/new_pools"
    ) {
      return jsonResponse({ data: [] });
    }

    return jsonResponse({ ok: true });
  });

  try {
    const result = await runOnChainToolWorkflow({
      chain: "mantle",
      context: [],
      message: "token Solana yang sedang tren",
    });

    assert.equal(result.payload.report?.kind, "token-discovery");
    assert.equal(result.payload.report?.entities[0]?.label, "SOLX");
    assert.equal(result.payload.report?.tables[0]?.id, "token-discovery-table");
    assert.ok(
      !result.payload.report?.entities.some((entity) =>
        String(entity.metrics.tokenAddress).includes("0000000000000001")
      )
    );
  } finally {
    restore();
  }
});
