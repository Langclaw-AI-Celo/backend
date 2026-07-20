import {
  asRecord,
  buildOnChainReportCaveats,
  compareNumber,
  deriveOnChainConfidence,
  formatPercent,
  formatUsd,
  getDexScreenerChainId,
  percentileRank,
  readArrayFromUnknown,
  readNestedNumber,
  readNestedString,
  readNumberField,
  readString,
  roundNumber,
  weightedAverage,
} from "./core";
import type {
  BuildOnChainResearchReportInput,
  OnChainToolResult,
  ResearchReport,
  ResearchReportEntity,
  ResearchReportTable,
  TokenDiscoveryAggregate,
  TokenDiscoveryRank,
} from "./types";

export function buildTokenDiscoveryReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const tokens = collectTokenDiscoveryRanks(input.tools, input.plan.chain);
  const entities: ResearchReportEntity[] = tokens.map((token, index) => ({
    id: token.id,
    label: token.label,
    category: "token",
    rank: index + 1,
    severity: token.severity,
    summary: token.summary,
    metrics: {
      score: roundNumber(token.score),
      tokenAddress: token.tokenAddress ?? null,
      boostAmount: roundNumber(token.boostAmount),
      liquidityUsd: roundNumber(token.liquidityUsd),
      volume24hUsd: roundNumber(token.volume24hUsd),
      priceChange24h: roundNumber(token.priceChange24h),
      poolCount: token.poolCount,
      coverage: token.coverage,
    },
    sourceIds: [],
    toolIds: token.toolIds,
  }));
  const topToken = tokens[0];
  const coverageSummary = summarizeTokenDiscoveryCoverage(tokens);

  return {
    kind: "token-discovery",
    title: `${input.plan.chainName} Token Discovery Brief`,
    asOfUtc: input.generatedAt,
    executiveSummary: topToken
      ? `This run returned a ranked on-chain shortlist from partial coverage for ${input.plan.chainName}. ${describeTokenDiscoveryLeader(topToken)}`
      : `This run returned token discovery context for ${input.plan.chainName}, but not enough chain-scoped token rows for a ranked shortlist.`,
    bottomLine: entities.length
      ? "Use the ranked on-chain token shortlist as best-effort research, then confirm liquidity, holders, token risk, and provider gaps manually."
      : "Treat this as narrative token discovery context until direct chain-scoped token rows are available.",
    confidence: entities.length ? deriveOnChainConfidence(input.tools) : "low",
    entities,
    tables: entities.length
      ? [
          {
            id: "token-discovery-table",
            title: "Token Discovery Ranking",
            description:
              "Score combines observed boost amount, pool liquidity or activity, provider feed rank, and profile recency when those direct fields are available. Rows are filtered to the requested analysis chain.",
            columns: [
              "rank",
              "token",
              "score",
              "tokenAddress",
              "boostAmount",
              "liquidityUsd",
              "volume24hUsd",
              "priceChange24h",
              "poolCount",
              "coverage",
            ],
            rows: entities.map((entity) => ({
              boostAmount: entity.metrics.boostAmount,
              coverage: entity.metrics.coverage,
              liquidityUsd: entity.metrics.liquidityUsd,
              poolCount: entity.metrics.poolCount,
              priceChange24h: entity.metrics.priceChange24h,
              rank: entity.rank,
              score: entity.metrics.score,
              token: entity.label,
              tokenAddress: entity.metrics.tokenAddress,
              volume24hUsd: entity.metrics.volume24hUsd,
            })),
          },
        ]
      : [],
    sections: [
      {
        id: "signal-summary",
        title: "Signal Summary",
        markdown: entities.length
          ? `Ranked on-chain shortlist from partial coverage. ${coverageSummary}`
          : "No ranked token table was emitted because direct chain-scoped token rows were incomplete.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "data-context",
        title: "Data Context",
        markdown:
          "Token discovery rankings use only observed provider fields: DEX Screener boosts/profiles/search rows and GeckoTerminal trending/new pool rows. Global feeds are filtered to the requested analysis chain. Missing names, symbols, liquidity, or activity fields are left unavailable rather than inferred.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "conclusion",
        title: "Conclusion",
        markdown: entities.length
          ? "The shortlist is usable for discovery triage, but partial provider coverage means each token still needs direct liquidity, holder, and contract-risk review."
          : "The run is informative but not enough for a token shortlist until chain-scoped token rows are available.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
    ],
    caveats: buildOnChainReportCaveats(input),
    recommendations: [input.recommendation],
  };
}

function collectTokenDiscoveryRanks(
  tools: OnChainToolResult[],
  chain: string
) {
  const aggregates = new Map<string, TokenDiscoveryAggregate>();
  const dexChainId = getDexScreenerChainId(chain).toLowerCase();

  for (const tool of tools) {
    if (
      tool.status !== "success" ||
      tool.provider === "local" ||
      tool.domain !== "token_discovery"
    ) {
      continue;
    }

    const records = readDiscoveryRecords(tool.data);

    records.forEach((record, index) => {
      if (tool.provider === "dexscreener") {
        collectDexScreenerTokenRecord({
          aggregates,
          dexChainId,
          feedRank: index + 1,
          record,
          toolId: tool.commandId,
        });
        return;
      }

      if (tool.provider === "geckoterminal") {
        collectGeckoTerminalTokenRecord({
          aggregates,
          dexChainId,
          feedRank: index + 1,
          record,
          toolId: tool.commandId,
        });
      }
    });
  }

  return scoreTokenDiscoveryAggregates(Array.from(aggregates.values()));
}

function collectDexScreenerTokenRecord({
  aggregates,
  dexChainId,
  feedRank,
  record,
  toolId,
}: {
  aggregates: Map<string, TokenDiscoveryAggregate>;
  dexChainId: string;
  feedRank: number;
  record: Record<string, unknown>;
  toolId: string;
}) {
  const rowChainId = readString(record.chainId)?.toLowerCase();

  if (rowChainId !== dexChainId) {
    return;
  }

  const tokenAddress =
    readNestedString(record, ["baseToken", "address"]) ||
    readString(record.tokenAddress);
  const key = buildTokenDiscoveryKey(dexChainId, tokenAddress, record, toolId, feedRank);
  const aggregate = getOrCreateTokenDiscoveryAggregate(aggregates, key, tokenAddress);
  const label =
    readString(record.symbol) ||
    readString(record.name) ||
    readNestedString(record, ["baseToken", "symbol"]) ||
    readNestedString(record, ["baseToken", "name"]);
  const boostAmount = readNumberField(record, [
    "totalAmount",
    "amount",
    "boostAmount",
  ]);
  const liquidityUsd = readNestedNumber(record, ["liquidity", "usd"]);
  const volume24hUsd = readNestedNumber(record, ["volume", "h24"]);
  const priceChange24h = readNestedNumber(record, ["priceChange", "h24"]);
  const updatedAt = readTimestamp(record.updatedAt);
  const hasPoolMetrics =
    liquidityUsd !== undefined ||
    volume24hUsd !== undefined ||
    priceChange24h !== undefined ||
    Boolean(readString(record.pairAddress));

  updateTokenDiscoveryAggregate(aggregate, {
    boostAmount,
    feedRank,
    hasBoost: toolId.includes("boost") || boostAmount !== undefined,
    hasPool: hasPoolMetrics,
    hasProfile: toolId.includes("profile"),
    label,
    liquidityUsd,
    priceChange24h,
    toolId,
    updatedAt,
    volume24hUsd,
  });
}

function collectGeckoTerminalTokenRecord({
  aggregates,
  dexChainId,
  feedRank,
  record,
  toolId,
}: {
  aggregates: Map<string, TokenDiscoveryAggregate>;
  dexChainId: string;
  feedRank: number;
  record: Record<string, unknown>;
  toolId: string;
}) {
  const networkId = readString(record.id)?.split("_")[0]?.toLowerCase();

  if (networkId && networkId !== dexChainId) {
    return;
  }

  const attributes = asRecord(record.attributes) ?? record;
  const tokenAddress = readGeckoTokenAddress(record, attributes);
  const key = buildTokenDiscoveryKey(dexChainId, tokenAddress, record, toolId, feedRank);
  const aggregate = getOrCreateTokenDiscoveryAggregate(aggregates, key, tokenAddress);
  const label =
    readString(attributes.base_token_symbol) ||
    readNestedString(record, ["base_token", "symbol"]) ||
    readString(attributes.name);
  const liquidityUsd =
    readNestedNumber(attributes, ["reserve_in_usd"]) ??
    readNestedNumber(attributes, ["reserve_usd"]);
  const volume24hUsd =
    readNestedNumber(attributes, ["volume_usd", "h24"]) ??
    readNestedNumber(attributes, ["volume_usd", "24h"]) ??
    readNestedNumber(attributes, ["volume_usd"]);
  const priceChange24h =
    readNestedNumber(attributes, ["price_change_percentage", "h24"]) ??
    readNestedNumber(attributes, ["price_change_24h"]);

  updateTokenDiscoveryAggregate(aggregate, {
    feedRank,
    hasPool: true,
    label,
    liquidityUsd,
    priceChange24h,
    toolId,
    volume24hUsd,
  });
}

function readDiscoveryRecords(value: unknown) {
  const candidates = [
    ...(Array.isArray(value) ? value : []),
    ...readArrayFromUnknown(value, "pairs"),
    ...readArrayFromUnknown(value, "data"),
    ...readArrayFromUnknown(value, "results"),
    ...readArrayFromUnknown(value, "items"),
    ...readArrayFromUnknown(value, "attributes.top_pools"),
  ];

  return candidates
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function buildTokenDiscoveryKey(
  chain: string,
  tokenAddress: string | undefined,
  record: Record<string, unknown>,
  toolId: string,
  feedRank: number
) {
  const fallback =
    readString(record.id) ||
    readString(record.url) ||
    readString(record.pairAddress) ||
    `${toolId}-${feedRank}`;

  return `${chain}:${(tokenAddress || fallback).toLowerCase()}`;
}

function getOrCreateTokenDiscoveryAggregate(
  aggregates: Map<string, TokenDiscoveryAggregate>,
  key: string,
  tokenAddress?: string
) {
  const existing = aggregates.get(key);

  if (existing) {
    if (!existing.tokenAddress && tokenAddress) {
      existing.tokenAddress = tokenAddress;
    }

    return existing;
  }

  const aggregate: TokenDiscoveryAggregate = {
    key,
    tokenAddress,
    hasBoost: false,
    hasPool: false,
    hasProfile: false,
    poolCount: 0,
    toolIds: new Set<string>(),
  };
  aggregates.set(key, aggregate);

  return aggregate;
}

function updateTokenDiscoveryAggregate(
  aggregate: TokenDiscoveryAggregate,
  update: {
    boostAmount?: number;
    feedRank: number;
    hasBoost?: boolean;
    hasPool?: boolean;
    hasProfile?: boolean;
    label?: string;
    liquidityUsd?: number;
    priceChange24h?: number;
    toolId: string;
    updatedAt?: number;
    volume24hUsd?: number;
  }
) {
  if (update.label && shouldReplaceTokenLabel(aggregate.label, aggregate.tokenAddress)) {
    aggregate.label = normalizeTokenLabel(update.label);
  }

  if (update.boostAmount !== undefined) {
    aggregate.boostAmount = Math.max(aggregate.boostAmount ?? 0, update.boostAmount);
  }

  if (update.liquidityUsd !== undefined) {
    aggregate.liquidityUsd = Math.max(aggregate.liquidityUsd ?? 0, update.liquidityUsd);
  }

  if (update.volume24hUsd !== undefined) {
    aggregate.volume24hUsd = Math.max(aggregate.volume24hUsd ?? 0, update.volume24hUsd);
  }

  if (
    update.priceChange24h !== undefined &&
    (aggregate.priceChange24h === undefined ||
      Math.abs(update.priceChange24h) > Math.abs(aggregate.priceChange24h))
  ) {
    aggregate.priceChange24h = update.priceChange24h;
  }

  if (update.hasPool) {
    aggregate.hasPool = true;
    aggregate.poolCount += 1;
  }

  aggregate.hasBoost = aggregate.hasBoost || Boolean(update.hasBoost);
  aggregate.hasProfile = aggregate.hasProfile || Boolean(update.hasProfile);
  aggregate.bestFeedRank =
    aggregate.bestFeedRank === undefined
      ? update.feedRank
      : Math.min(aggregate.bestFeedRank, update.feedRank);
  aggregate.latestUpdatedAt =
    update.updatedAt === undefined
      ? aggregate.latestUpdatedAt
      : Math.max(aggregate.latestUpdatedAt ?? 0, update.updatedAt);
  aggregate.toolIds.add(update.toolId);
}

function scoreTokenDiscoveryAggregates(
  aggregates: TokenDiscoveryAggregate[]
) {
  const enriched = aggregates.filter(
    (aggregate) =>
      aggregate.tokenAddress ||
      aggregate.label ||
      aggregate.boostAmount !== undefined ||
      aggregate.poolCount > 0
  );
  const boostValues = enriched
    .map((item) => item.boostAmount)
    .filter((value): value is number => value !== undefined);
  const liquidityValues = enriched
    .map((item) => logMetric(item.liquidityUsd))
    .filter((value): value is number => value !== undefined);
  const volumeValues = enriched
    .map((item) => logMetric(item.volume24hUsd))
    .filter((value): value is number => value !== undefined);
  const priceMoveValues = enriched
    .map((item) =>
      item.priceChange24h === undefined ? undefined : Math.abs(item.priceChange24h)
    )
    .filter((value): value is number => value !== undefined);
  const feedRankValues = enriched
    .map((item) =>
      item.bestFeedRank === undefined ? undefined : -item.bestFeedRank
    )
    .filter((value): value is number => value !== undefined);
  const recencyValues = enriched
    .map((item) => item.latestUpdatedAt)
    .filter((value): value is number => value !== undefined);

  return enriched
    .map((aggregate) => {
      const boostScore =
        aggregate.boostAmount === undefined
          ? undefined
          : percentileRank(boostValues, aggregate.boostAmount);
      const poolScore = weightedAverage([
        {
          value:
            aggregate.liquidityUsd === undefined
              ? undefined
              : percentileRank(liquidityValues, logMetric(aggregate.liquidityUsd) ?? 0),
          weight: 0.45,
        },
        {
          value:
            aggregate.volume24hUsd === undefined
              ? undefined
              : percentileRank(volumeValues, logMetric(aggregate.volume24hUsd) ?? 0),
          weight: 0.35,
        },
        {
          value:
            aggregate.priceChange24h === undefined
              ? undefined
              : percentileRank(priceMoveValues, Math.abs(aggregate.priceChange24h)),
          weight: 0.2,
        },
      ]);
      const sourceRankScore =
        aggregate.bestFeedRank === undefined
          ? undefined
          : percentileRank(feedRankValues, -aggregate.bestFeedRank);
      const recencyScore =
        aggregate.latestUpdatedAt === undefined
          ? undefined
          : percentileRank(recencyValues, aggregate.latestUpdatedAt);
      const score =
        weightedAverage([
          { value: boostScore, weight: 0.35 },
          { value: poolScore, weight: 0.35 },
          { value: sourceRankScore, weight: 0.2 },
          { value: recencyScore, weight: 0.1 },
        ]) ?? 0;
      const coverage = determineTokenDiscoveryCoverage(aggregate);
      const label = aggregate.label || shortTokenAddress(aggregate.tokenAddress);

      return {
        boostAmount: aggregate.boostAmount,
        coverage,
        id: aggregate.key,
        label,
        liquidityUsd: aggregate.liquidityUsd,
        poolCount: aggregate.poolCount,
        priceChange24h: aggregate.priceChange24h,
        score,
        severity: severityForTokenCoverage(coverage),
        summary: describeTokenDiscoveryCandidate({
          aggregate,
          coverage,
        }),
        tokenAddress: aggregate.tokenAddress,
        toolIds: Array.from(aggregate.toolIds),
        volume24hUsd: aggregate.volume24hUsd,
      } satisfies TokenDiscoveryRank;
    })
    .sort(
      (left, right) =>
        compareNumber(right.score, left.score) ||
        compareNumber(right.boostAmount, left.boostAmount) ||
        compareNumber(right.liquidityUsd, left.liquidityUsd) ||
        left.label.localeCompare(right.label)
    )
    .slice(0, 12);
}

function determineTokenDiscoveryCoverage(
  aggregate: TokenDiscoveryAggregate
): TokenDiscoveryRank["coverage"] {
  if (aggregate.hasBoost && aggregate.hasPool) {
    return "boost+pool";
  }

  const sourceCount = [
    aggregate.hasBoost,
    aggregate.hasPool,
    aggregate.hasProfile,
  ].filter(Boolean).length;

  if (sourceCount >= 2 || aggregate.toolIds.size >= 2) {
    return "multi-source";
  }

  return "single-source";
}

function severityForTokenCoverage(coverage: TokenDiscoveryRank["coverage"]) {
  if (coverage === "boost+pool") {
    return "high";
  }

  if (coverage === "multi-source") {
    return "medium";
  }

  return "watch";
}

function describeTokenDiscoveryLeader(token: TokenDiscoveryRank) {
  const parts = [
    `${token.label} leads the current view`,
    token.boostAmount !== undefined
      ? `with ${token.boostAmount.toLocaleString("en-US")} observed boost amount`
      : undefined,
    token.liquidityUsd !== undefined
      ? `${formatUsd(token.liquidityUsd)} liquidity`
      : undefined,
    token.volume24hUsd !== undefined
      ? `${formatUsd(token.volume24hUsd)} 24h volume`
      : undefined,
  ].filter(Boolean);

  return `${parts.join(" and ")}.`;
}

function describeTokenDiscoveryCandidate({
  aggregate,
  coverage,
}: {
  aggregate: TokenDiscoveryAggregate;
  coverage: TokenDiscoveryRank["coverage"];
}) {
  const parts = [
    aggregate.tokenAddress
      ? `Token address ${shortTokenAddress(aggregate.tokenAddress)}`
      : "Token address was unavailable",
    aggregate.boostAmount !== undefined
      ? `boost amount ${aggregate.boostAmount.toLocaleString("en-US")}`
      : undefined,
    aggregate.liquidityUsd !== undefined
      ? `liquidity ${formatUsd(aggregate.liquidityUsd)}`
      : undefined,
    aggregate.volume24hUsd !== undefined
      ? `24h volume ${formatUsd(aggregate.volume24hUsd)}`
      : undefined,
    aggregate.priceChange24h !== undefined
      ? `24h price move ${formatPercent(aggregate.priceChange24h)}`
      : undefined,
  ].filter(Boolean);
  const basis =
    coverage === "boost+pool"
      ? "Ranking used observed boost and pool evidence."
      : coverage === "multi-source"
        ? "Ranking used multiple observed discovery sources."
        : "Ranking used a single observed discovery source.";

  return `${parts.join(", ")}. ${aggregate.poolCount} pool row(s) contributed. ${basis}`;
}

function summarizeTokenDiscoveryCoverage(tokens: TokenDiscoveryRank[]) {
  const coverageCounts = tokens.reduce(
    (counts, token) => {
      counts[token.coverage] += 1;
      return counts;
    },
    {
      "boost+pool": 0,
      "multi-source": 0,
      "single-source": 0,
    } satisfies Record<TokenDiscoveryRank["coverage"], number>
  );
  const parts = [
    coverageCounts["boost+pool"]
      ? `${coverageCounts["boost+pool"]} token(s) used boost+pool coverage`
      : undefined,
    coverageCounts["multi-source"]
      ? `${coverageCounts["multi-source"]} token(s) used multi-source coverage`
      : undefined,
    coverageCounts["single-source"]
      ? `${coverageCounts["single-source"]} token(s) stayed single-source`
      : undefined,
  ].filter(Boolean);

  return parts.length ? `${parts.join("; ")}.` : "Coverage details were limited.";
}

function readTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsedNumber = Number(value);

    if (Number.isFinite(parsedNumber)) {
      return parsedNumber;
    }

    const parsedDate = Date.parse(value);

    if (Number.isFinite(parsedDate)) {
      return parsedDate;
    }
  }

  return undefined;
}

function readGeckoTokenAddress(
  record: Record<string, unknown>,
  attributes: Record<string, unknown>
) {
  return (
    readString(attributes.base_token_address) ||
    stripNetworkPrefix(
      readNestedString(record, ["relationships", "base_token", "data", "id"])
    ) ||
    readNestedString(record, ["base_token", "address"])
  );
}

function stripNetworkPrefix(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const separatorIndex = value.indexOf("_");

  return separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value;
}

function shouldReplaceTokenLabel(
  current: string | undefined,
  tokenAddress: string | undefined
) {
  return (
    !current ||
    current === "Unknown" ||
    (tokenAddress !== undefined && current === shortTokenAddress(tokenAddress))
  );
}

function normalizeTokenLabel(value: string) {
  return value.trim();
}

function shortTokenAddress(value: string | undefined) {
  if (!value) {
    return "Unknown token";
  }

  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function logMetric(value: number | undefined) {
  return value === undefined ? undefined : Math.log10(Math.max(value, 1));
}

