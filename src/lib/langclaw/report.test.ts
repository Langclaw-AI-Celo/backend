import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOnChainResearchReport,
  buildWorkflowResearchReport,
  renderResearchReportMarkdown,
} from "./report";
import type {
  DiscoverSignals,
  ProviderError,
  ProviderTraceEntry,
  SourceCard,
} from "./types";
import type { OnChainPlanSummary, OnChainToolResult } from "../onchain-tools/types";

const defaultSignals: DiscoverSignals = {
  combined: {
    providers: ["Surf", "DEX Screener"],
    sourceIds: ["source-1"],
    status: "partial",
    summary: "Combined signal is partial.",
    toolIds: ["pair_liquidity.pair_details"],
  },
  onchain: {
    providers: ["DEX Screener"],
    sourceIds: [],
    status: "success",
    summary: "On-chain signal is usable.",
    toolIds: ["pair_liquidity.pair_details"],
  },
  social: {
    providers: ["Surf"],
    sourceIds: ["source-1"],
    status: "partial",
    summary: "Social signal is partial.",
    toolIds: [],
  },
};

const defaultPlan: OnChainPlanSummary = {
  analysisSource: "prompt",
  chain: "mantle",
  chainId: 5000,
  chainName: "Mantle",
  commands: [],
  domainCount: 14,
  intent: "trading-signal",
  nativeSymbol: "MNT",
  productChain: "mantle",
  productChainId: 5000,
  productChainName: "Mantle",
  query: "Detect liquidity anomalies on Mantle DEX pairs",
  registryCommandCount: 83,
};

test("on-chain liquidity report ranks pairs and computes turnover from DEX Screener data", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: defaultPlan,
    recommendation: "Monitor the top pool for LP movement.",
    tools: [
      {
        commandId: "pair_liquidity.pair_details",
        data: {
          pairs: [
            {
              baseToken: { symbol: "BSB" },
              liquidity: { usd: 843200 },
              pairAddress: "0xdc16",
              priceChange: { h24: 21.6 },
              quoteToken: { symbol: "USDT0" },
              txns: { h24: { buys: 3440, sells: 3440 } },
              volume: { h24: 1870000 },
            },
            {
              baseToken: { symbol: "BILL" },
              liquidity: { usd: 363900 },
              pairAddress: "0x509b",
              priceChange: { h24: 21.3 },
              quoteToken: { symbol: "USDT0" },
              txns: { h24: { buys: 1100, sells: 1115 } },
              volume: { h24: 98100 },
            },
          ],
        },
        domain: "pair_liquidity",
        latencyMs: 12,
        provider: "dexscreener",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched pair-level liquidity data.",
        title: "Pair details",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "liquidity-anomaly");
  assert.equal(report.entities[0]?.label, "BSB / USDT0");
  assert.equal(report.entities[0]?.severity, "high");
  assert.equal(report.entities[0]?.metrics.turnover24h, 2.22);
  assert.ok(report.tables.some((table) => table.id === "anomaly-table"));

  const markdown = renderResearchReportMarkdown(report);

  assert.match(markdown, /Anomaly Table/i);
  assert.match(markdown, /BSB \/ USDT0/i);
});

test("liquidity report ranks chain-filtered DEX Screener search rows despite incidental token discovery commands", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      chain: "celo",
      chainId: 42220,
      chainName: "Celo",
      commands: [
        {
          commandId: "pair_liquidity.geckoterminal_network_trending_pools",
          domain: "pair_liquidity",
          provider: "geckoterminal",
          reason: "Fetch trending pools.",
          title: "GeckoTerminal trending pools",
        },
        {
          commandId: "pair_liquidity.liquidity_pair_search",
          domain: "pair_liquidity",
          provider: "dexscreener",
          reason: "Search Celo pairs.",
          title: "Liquidity pair search",
        },
        {
          commandId: "token_discovery.latest_boosts",
          domain: "token_discovery",
          provider: "dexscreener",
          reason: "Read attention proxy.",
          title: "Latest token boosts",
        },
      ],
      intent: "trading-signal",
      query: "Celo",
      rawQuery: "Detect liquidity anomalies on Celo DEX pairs",
    },
    recommendation: "Confirm the top pair before escalating.",
    tools: [
      {
        commandId: "pair_liquidity.geckoterminal_network_trending_pools",
        domain: "pair_liquidity",
        error: "401 Unauthorized",
        latencyMs: 14,
        provider: "geckoterminal",
        scope: "legacy-default",
        status: "failed",
        summary: "401 Unauthorized",
        title: "GeckoTerminal trending pools",
      },
      {
        commandId: "pair_liquidity.liquidity_pair_search",
        data: {
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
        },
        domain: "pair_liquidity",
        latencyMs: 12,
        provider: "dexscreener",
        scope: "legacy-default",
        status: "success",
        summary: "Searched DEX pairs for Celo.",
        title: "Liquidity pair search",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "liquidity-anomaly");
  assert.equal(report.entities[0]?.label, "CELO / USDm");
  assert.equal(report.entities[0]?.metrics.pairAddress, "0x2d70cBAbf4d8e61d5317b62cBe912935FD94e0FE");
  assert.equal(report.entities[0]?.metrics.turnover24h, 6.27);
  assert.equal(report.tables[0]?.id, "anomaly-table");
  assert.match(report.executiveSummary, /ranked pair shortlist from partial coverage/i);
  assert.ok(
    !report.entities.some((entity) => String(entity.metrics.pairAddress).includes("0000000000000001"))
  );
});

test("liquidity report parses GeckoTerminal network pool rows", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      chain: "celo",
      chainId: 42220,
      chainName: "Celo",
      commands: [
        {
          commandId: "pair_liquidity.geckoterminal_network_trending_pools",
          domain: "pair_liquidity",
          provider: "geckoterminal",
          reason: "Fetch trending pools.",
          title: "GeckoTerminal trending pools",
        },
      ],
      intent: "trading-signal",
      query: "Celo",
      rawQuery: "Detect liquidity anomalies on Celo DEX pairs",
    },
    recommendation: "Confirm the top pair before escalating.",
    tools: [
      {
        commandId: "pair_liquidity.geckoterminal_network_trending_pools",
        data: {
          data: [
            {
              attributes: {
                address: "0xpool",
                name: "MOO / CELO",
                price_change_percentage: { h24: "14.2" },
                reserve_in_usd: "42000",
                transactions: {
                  h24: {
                    buys: 240,
                    sells: 310,
                  },
                },
                volume_usd: {
                  h24: "84000",
                },
              },
              id: "celo_0xpool",
            },
          ],
        },
        domain: "pair_liquidity",
        latencyMs: 12,
        provider: "geckoterminal",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched GeckoTerminal trending pools.",
        title: "GeckoTerminal trending pools",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "liquidity-anomaly");
  assert.equal(report.entities[0]?.label, "MOO / CELO");
  assert.equal(report.entities[0]?.metrics.reserveUsd, 42000);
  assert.equal(report.entities[0]?.metrics.volume24hUsd, 84000);
  assert.equal(report.entities[0]?.metrics.priceChange24h, 14.2);
  assert.equal(report.entities[0]?.metrics.txns24h, 550);
  assert.equal(report.tables[0]?.id, "anomaly-table");
});

test("smart-money report stays narrative-first when only local synthesis succeeds", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      intent: "smart-money",
      query: "Analyze smart-money accumulation for MNT on Mantle",
    },
    recommendation: "Confirm holder flow with a second source.",
    tools: [
      {
        attemptedProviders: ["nansen", "dune"],
        commandId: "smart_money.nansen_smart_money_netflow",
        domain: "smart_money",
        error: "422 Unknown field",
        fallbackReason: "nansen: 422 Unknown field | dune: 400 query id missing",
        latencyMs: 10,
        provider: "nansen",
        scope: "legacy-fallback",
        status: "failed",
        summary: "422 Unknown field",
        title: "Smart money netflow",
      },
      {
        attemptedProviders: ["local"],
        commandId: "smart_money.smart_money_signal_synthesis",
        data: {
          completedTools: 0,
          failedTools: 1,
        },
        domain: "smart_money",
        latencyMs: 1,
        provider: "local",
        scope: "legacy-default",
        status: "success",
        summary: "Synthesized 0 successful tool results and 1 failed tool results into an analysis-only signal.",
        title: "Smart money signal synthesis",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "smart-money");
  assert.equal(report.tables.length, 0);
  assert.equal(report.entities.length, 0);
  assert.match(report.sections.map((section) => section.markdown).join("\n"), /analysis-only/i);
});

test("workflow report omits fabricated quantitative tables for mixed research", () => {
  const sources: SourceCard[] = [
    {
      excerpt: "Mantle AI agents are gaining traction on social feeds.",
      id: "source-1",
      provider: "Surf",
      title: "Mantle AI context",
      type: "docs_page",
      url: "https://surf.test/mantle-ai",
    },
    {
      excerpt: "Builders are discussing Mantle AI projects.",
      id: "source-2",
      provider: "X",
      title: "Mantle X thread",
      type: "x_post",
      url: "https://x.com/example/status/1",
    },
  ];
  const errors: ProviderError[] = [
    {
      message: "402 Payment Required",
      provider: "Surf",
    },
  ];
  const providerTrace: ProviderTraceEntry[] = [
    {
      message: "402 Payment Required",
      provider: "Surf",
      scope: "mantle-premium",
      status: "failed",
    },
  ];

  const report = buildWorkflowResearchReport({
    errors,
    generatedAt: "2026-05-23T04:48:00.000Z",
    providerTrace,
    signals: {
      ...defaultSignals,
      combined: {
        ...defaultSignals.combined,
        status: "partial",
      },
      onchain: {
        ...defaultSignals.onchain,
        status: "failed",
        summary: "On-chain evidence was incomplete.",
      },
    },
    sources,
    topic: "Mantle AI agent market narrative",
  });

  assert.equal(report.kind, "mixed-research");
  assert.equal(report.tables.length, 0);
  assert.equal(report.entities.length, 0);
  assert.match(report.executiveSummary, /Mantle AI agent market narrative/i);
  assert.match(report.caveats.join(" "), /Surf failed/i);
});

test("workflow report caveats do not duplicate combined social partial text", () => {
  const socialPartialCaveat =
    "Social evidence is partial because Elfa failed while other providers still returned source cards.";

  const report = buildWorkflowResearchReport({
    errors: [
      {
        message: "The operation was aborted due to timeout",
        provider: "Elfa",
      },
    ],
    generatedAt: "2026-05-23T04:48:00.000Z",
    signals: {
      combined: {
        providers: ["Surf", "Elfa"],
        sourceIds: ["surf-1"],
        status: "partial",
        summary: "Combined signal is partial.",
        toolIds: [],
        caveat: socialPartialCaveat,
      },
      onchain: {
        providers: [],
        sourceIds: [],
        status: "skipped",
        summary: "On-chain skipped.",
        toolIds: [],
      },
      social: {
        providers: ["Surf"],
        sourceIds: ["surf-1"],
        status: "partial",
        summary: "Social signal is partial.",
        toolIds: [],
        caveat: socialPartialCaveat,
      },
    },
    sources: [
      {
        excerpt: "Mantle market signal",
        id: "surf-1",
        provider: "Surf",
        title: "Surf source",
        type: "docs_page",
        url: "https://surf.test/mantle",
      },
    ],
    topic: "Mantle market narrative",
  });

  const matches = report.caveats.filter((caveat) => caveat === socialPartialCaveat);

  assert.equal(matches.length, 1);
});

test("defi yield report aggregates Mantle protocol TVL and yield rows into a ranked protocol shortlist", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      intent: "defi",
      query: "Rank Mantle protocols by TVL and yield momentum",
    },
    recommendation: "Confirm protocol risk before escalating the shortlist.",
    tools: [
      {
        commandId: "defi_tvl.defillama_protocols",
        data: {
          data: [
            {
              chainTvls: {
                Mantle: {
                  tvl: 1200000,
                },
              },
              change_1d: 11,
              change_7d: 40,
              chains: ["Mantle", "Ethereum"],
              id: "agni-finance",
              name: "Agni Finance",
            },
            {
              chainTvls: {
                Mantle: {
                  tvl: 800000,
                },
              },
              change_1d: -2,
              change_7d: 15,
              chains: ["Mantle"],
              id: "methlab",
              name: "Methlab",
            },
            {
              chainTvls: {
                Base: {
                  tvl: 999999999,
                },
              },
              change_1d: 90,
              change_7d: 140,
              chains: ["Base"],
              id: "aerodrome",
              name: "Aerodrome",
            },
          ],
        },
        domain: "defi_tvl",
        latencyMs: 12,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched DeFiLlama protocol TVL list.",
        title: "DeFi protocols TVL",
      },
      {
        commandId: "yield_pools.yield_pool_list",
        data: {
          data: [
            {
              apy: 12,
              apyPct1D: 4,
              apyPct7D: 12,
              chain: "Mantle",
              pool: "agni-usdt0",
              project: "agni-finance",
              symbol: "USDT0",
              tvlUsd: 300000,
            },
            {
              apy: 9,
              apyPct1D: 2,
              apyPct7D: 8,
              chain: "Mantle",
              pool: "agni-mnt",
              project: "agni-finance",
              symbol: "MNT",
              tvlUsd: 200000,
            },
            {
              apy: 15,
              apyPct1D: 1,
              apyPct7D: 3,
              chain: "Mantle",
              pool: "methlab-cmeth",
              project: "methlab",
              symbol: "cmETH",
              tvlUsd: 150000,
            },
            {
              apy: 30,
              apyPct1D: 21,
              apyPct7D: 70,
              chain: "Base",
              pool: "base-noise",
              project: "aerodrome",
              symbol: "USDC",
              tvlUsd: 9000000,
            },
          ],
        },
        domain: "yield_pools",
        latencyMs: 8,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched 4 yield pools.",
        title: "Yield pool list",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "defi-yield");
  assert.equal(report.entities[0]?.label, "Agni Finance");
  assert.equal(report.entities[0]?.metrics.tvlUsd, 1200000);
  assert.equal(report.entities[0]?.metrics.bestApy, 12);
  assert.equal(report.entities[0]?.metrics.poolCount, 2);
  assert.equal(report.entities[0]?.metrics.coverage, "composite");
  assert.equal(report.tables[0]?.id, "yield-table");
  assert.deepEqual(report.tables[0]?.columns, [
    "rank",
    "protocol",
    "score",
    "tvlUsd",
    "bestApy",
    "momentumScore",
    "poolCount",
    "coverage",
  ]);
  assert.ok(
    !report.entities.some((entity) => entity.label.toLowerCase().includes("aerodrome"))
  );
});

test("defi yield report reads numeric Mantle chain TVL from DeFiLlama protocol rows", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      commands: [
        {
          commandId: "defi_tvl.defillama_protocols",
          domain: "defi_tvl",
          provider: "defillama",
          reason: "Fetch protocol TVL.",
          title: "DeFi protocols TVL",
        },
        {
          commandId: "yield_pools.yield_pool_list",
          domain: "yield_pools",
          provider: "defillama",
          reason: "Fetch yield pools.",
          title: "Yield pool list",
        },
      ],
      intent: "defi",
      query: "by",
      rawQuery: "Rank Mantle protocols by TVL and yield momentum",
    },
    recommendation: "Confirm protocol risk before escalating the shortlist.",
    tools: [
      {
        commandId: "defi_tvl.defillama_protocols",
        data: [
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
        ],
        domain: "defi_tvl",
        latencyMs: 12,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched DeFiLlama protocol TVL list.",
        title: "DeFi protocols TVL",
      },
      {
        commandId: "yield_pools.yield_pool_list",
        data: {
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
          ],
        },
        domain: "yield_pools",
        latencyMs: 8,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched 1 yield pool.",
        title: "Yield pool list",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "defi-yield");
  assert.equal(report.entities[0]?.label, "Aave V3");
  assert.equal(report.entities[0]?.metrics.tvlUsd, 136579045.42);
  assert.equal(report.entities[0]?.metrics.bestApy, 5.53);
  assert.equal(report.tables[0]?.id, "yield-table");
});

test("defi yield report keeps a ranked shortlist when momentum fields are missing", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      intent: "defi",
      query: "Rank Mantle protocols by TVL and yield momentum",
    },
    recommendation: "Confirm protocol risk before escalating the shortlist.",
    tools: [
      {
        commandId: "defi_tvl.defillama_protocols",
        data: {
          data: [
            {
              chainTvls: {
                Mantle: {
                  tvl: 650000,
                },
              },
              chains: ["Mantle"],
              id: "fusionx",
              name: "FusionX",
            },
          ],
        },
        domain: "defi_tvl",
        latencyMs: 12,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched DeFiLlama protocol TVL list.",
        title: "DeFi protocols TVL",
      },
      {
        commandId: "yield_pools.yield_pool_list",
        data: {
          data: [
            {
              apy: 7,
              chain: "Mantle",
              pool: "fusionx-usdt0",
              project: "fusionx",
              symbol: "USDT0",
              tvlUsd: 200000,
            },
          ],
        },
        domain: "yield_pools",
        latencyMs: 8,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched 1 yield pool.",
        title: "Yield pool list",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.entities.length, 1);
  assert.match(report.executiveSummary, /ranked shortlist from partial coverage/i);
  assert.match(report.sections.map((section) => section.markdown).join("\n"), /partial coverage/i);
  assert.equal(report.entities[0]?.metrics.coverage, "tvl+apy");
});

test("workflow report preserves ranked DeFi entities from on-chain report", () => {
  const onChainReport = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      commands: [
        {
          commandId: "defi_tvl.defillama_protocols",
          domain: "defi_tvl",
          provider: "defillama",
          reason: "Fetch protocol TVL.",
          title: "DeFi protocols TVL",
        },
        {
          commandId: "yield_pools.yield_pool_list",
          domain: "yield_pools",
          provider: "defillama",
          reason: "Fetch yield pools.",
          title: "Yield pool list",
        },
      ],
      intent: "defi",
      query: "by",
      rawQuery: "Rank Mantle protocols by TVL and yield momentum",
    },
    recommendation: "Confirm protocol risk before escalating the shortlist.",
    tools: [
      {
        commandId: "defi_tvl.defillama_protocols",
        data: [
          {
            chainTvls: {
              Mantle: 1200000,
            },
            chains: ["Mantle"],
            name: "Agni Finance",
            slug: "agni-finance",
          },
        ],
        domain: "defi_tvl",
        latencyMs: 12,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched DeFiLlama protocol TVL list.",
        title: "DeFi protocols TVL",
      },
      {
        commandId: "yield_pools.yield_pool_list",
        data: {
          data: [
            {
              apy: 12,
              chain: "Mantle",
              pool: "agni-usdt0",
              project: "agni-finance",
              symbol: "USDT0",
              tvlUsd: 300000,
            },
          ],
        },
        domain: "yield_pools",
        latencyMs: 8,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched 1 yield pool.",
        title: "Yield pool list",
      },
    ] satisfies OnChainToolResult[],
  });
  const workflowReport = buildWorkflowResearchReport({
    errors: [],
    generatedAt: "2026-05-23T04:49:00.000Z",
    onChain: {
      answer: onChainReport.executiveSummary,
      bullets: [],
      caveat: "This is analysis-only.",
      generatedAt: "2026-05-23T04:48:00.000Z",
      plan: {
        ...defaultPlan,
        intent: "defi",
        query: "Rank Mantle protocols by TVL and yield momentum",
      },
      recommendation: "Confirm protocol risk before escalating the shortlist.",
      report: onChainReport,
      title: "Mantle Yield and TVL Brief",
      tools: [],
    },
    signals: {
      ...defaultSignals,
      combined: {
        ...defaultSignals.combined,
        status: "success",
        summary: "Social and on-chain signals converged into a usable live research brief.",
      },
      onchain: {
        ...defaultSignals.onchain,
        status: "success",
        summary: "On-chain enrichment produced usable live evidence.",
      },
    },
    sources: [],
    topic: "Rank Mantle protocols by TVL and yield momentum",
  });

  assert.equal(workflowReport.kind, "defi-yield");
  assert.equal(workflowReport.entities[0]?.label, "Agni Finance");
  assert.equal(workflowReport.tables[0]?.id, "yield-table");
  assert.equal(workflowReport.executiveSummary, onChainReport.executiveSummary);
  assert.equal(workflowReport.bottomLine, onChainReport.bottomLine);
});

test("defi yield report falls back to summed Mantle pool TVL when direct protocol TVL is unavailable", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      intent: "defi",
      query: "Rank Mantle protocols by TVL and yield momentum",
    },
    recommendation: "Confirm protocol risk before escalating the shortlist.",
    tools: [
      {
        commandId: "yield_pools.yield_pool_list",
        data: {
          data: [
            {
              apy: 10,
              apyPct1D: 2,
              chain: "Mantle",
              pool: "cleopatra-usdt0",
              project: "cleopatra",
              symbol: "USDT0",
              tvlUsd: 125000,
            },
            {
              apy: 14,
              apyPct1D: 5,
              chain: "Mantle",
              pool: "cleopatra-meth",
              project: "cleopatra",
              symbol: "mETH",
              tvlUsd: 175000,
            },
          ],
        },
        domain: "yield_pools",
        latencyMs: 8,
        provider: "defillama",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched 2 yield pools.",
        title: "Yield pool list",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.entities[0]?.label, "Cleopatra");
  assert.equal(report.entities[0]?.metrics.tvlUsd, 300000);
  assert.equal(report.entities[0]?.metrics.bestApy, 14);
  assert.equal(report.entities[0]?.metrics.poolCount, 2);
  assert.equal(report.entities[0]?.metrics.coverage, "tvl+apy");
});

test("token discovery report builds a chain-filtered ranked shortlist from DEX and Gecko rows", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      chain: "solana",
      chainId: 1,
      chainName: "Solana",
      commands: [
        {
          commandId: "token_discovery.trending_boosted_tokens",
          domain: "token_discovery",
          provider: "dexscreener",
          reason: "Fetch boosts.",
          title: "Trending boosted tokens",
        },
        {
          commandId: "token_discovery.geckoterminal_trending_pools",
          domain: "token_discovery",
          provider: "geckoterminal",
          reason: "Fetch trending pools.",
          title: "GeckoTerminal trending pools",
        },
      ],
      intent: "token-discovery",
      query: "token Solana yang sedang tren",
      rawQuery: "token Solana yang sedang tren",
    },
    recommendation: "Confirm liquidity and token risk before escalating the shortlist.",
    tools: [
      {
        commandId: "token_discovery.trending_boosted_tokens",
        data: [
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
        ],
        domain: "token_discovery",
        latencyMs: 12,
        provider: "dexscreener",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched boosted tokens.",
        title: "Trending boosted tokens",
      },
      {
        commandId: "token_discovery.geckoterminal_trending_pools",
        data: {
          data: [
            {
              attributes: {
                address: "pool-sol",
                base_token_price_usd: "1.23",
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
        },
        domain: "token_discovery",
        latencyMs: 14,
        provider: "geckoterminal",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched GeckoTerminal trending pools.",
        title: "GeckoTerminal trending pools",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "token-discovery");
  assert.equal(report.entities[0]?.label, "SOLX");
  assert.equal(
    report.entities[0]?.metrics.tokenAddress,
    "So11111111111111111111111111111111111111112"
  );
  assert.equal(report.entities[0]?.metrics.boostAmount, 800);
  assert.equal(report.entities[0]?.metrics.liquidityUsd, 150000);
  assert.equal(report.entities[0]?.metrics.volume24hUsd, 450000);
  assert.equal(report.entities[0]?.metrics.priceChange24h, 21.5);
  assert.equal(report.entities[0]?.metrics.poolCount, 1);
  assert.equal(report.entities[0]?.metrics.coverage, "boost+pool");
  assert.equal(report.tables[0]?.id, "token-discovery-table");
  assert.ok(
    !report.entities.some((entity) =>
      String(entity.metrics.tokenAddress).includes("0000000000000001")
    )
  );
});

test("token discovery report still ranks address-only DEX rows when GeckoTerminal fails", () => {
  const report = buildOnChainResearchReport({
    caveat: "This is analysis-only and GeckoTerminal failed.",
    generatedAt: "2026-05-23T04:48:00.000Z",
    plan: {
      ...defaultPlan,
      chain: "base",
      chainId: 8453,
      chainName: "Base",
      intent: "token-discovery",
      query: "Find trending tokens on Base",
      rawQuery: "Find trending tokens on Base",
    },
    recommendation: "Confirm liquidity and token risk before escalating the shortlist.",
    tools: [
      {
        commandId: "token_discovery.trending_boosted_tokens",
        data: [
          {
            chainId: "base",
            tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
            totalAmount: 500,
            url: "https://dexscreener.com/base/0x1234567890abcdef1234567890abcdef12345678",
          },
        ],
        domain: "token_discovery",
        latencyMs: 12,
        provider: "dexscreener",
        scope: "legacy-default",
        status: "success",
        summary: "Fetched boosted tokens.",
        title: "Trending boosted tokens",
      },
      {
        commandId: "token_discovery.geckoterminal_trending_pools",
        domain: "token_discovery",
        error: "401 Unauthorized",
        latencyMs: 14,
        provider: "geckoterminal",
        scope: "legacy-default",
        status: "failed",
        summary: "401 Unauthorized",
        title: "GeckoTerminal trending pools",
      },
    ] satisfies OnChainToolResult[],
  });

  assert.equal(report.kind, "token-discovery");
  assert.equal(report.entities[0]?.label, "0x1234...5678");
  assert.equal(report.entities[0]?.metrics.coverage, "single-source");
  assert.match(report.executiveSummary, /ranked on-chain shortlist from partial coverage/i);
});
