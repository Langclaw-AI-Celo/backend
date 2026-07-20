import {
  asRecord,
  buildOnChainReportCaveats,
  compareNumber,
  deriveOnChainConfidence,
  formatPercent,
  formatUsd,
  percentileRank,
  readArrayFromUnknown,
  readNumberField,
  readNumberValue,
  readString,
  roundNumber,
  weightedAverage,
} from "./core";
import type {
  BuildOnChainResearchReportInput,
  DefiProtocolAggregate,
  DefiProtocolRank,
  OnChainToolResult,
  ResearchReport,
  ResearchReportEntity,
  ResearchReportTable,
} from "./types";

export function buildDefiYieldReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const protocols = collectDefiProtocolRanks(input.tools, input.plan.chain);
  const entities: ResearchReportEntity[] = protocols.map((protocol, index) => ({
    id: protocol.id,
    label: protocol.label,
    category: "defi-protocol",
    rank: index + 1,
    severity: protocol.severity,
    summary: protocol.summary,
    metrics: {
      score: roundNumber(protocol.score),
      tvlUsd: roundNumber(protocol.tvlUsd),
      bestApy: roundNumber(protocol.bestApy),
      momentumScore: roundNumber(protocol.momentumScore),
      poolCount: protocol.poolCount,
      coverage: protocol.coverage,
    },
    sourceIds: [],
    toolIds: protocol.toolIds,
  }));
  const topProtocol = protocols[0];
  const hasPartialCoverage = protocols.some(
    (protocol) => protocol.coverage !== "composite"
  );
  const coverageSummary = summarizeDefiCoverage(protocols);

  return {
    kind: "defi-yield",
    title: `${input.plan.chainName} Yield and TVL Brief`,
    asOfUtc: input.generatedAt,
    executiveSummary: topProtocol
      ? hasPartialCoverage
        ? `This run returned a ranked shortlist from partial coverage for ${input.plan.chainName}. ${describeDefiLeader(topProtocol)}`
        : `This run returned ${entities.length} ranked ${input.plan.chainName} protocols by TVL and yield momentum. ${describeDefiLeader(topProtocol)}`
      : `This run returned narrative DeFi context for ${input.plan.chainName}, but not enough row-level data for a ranked yield table.`,
    bottomLine: entities.length
      ? hasPartialCoverage
        ? "Use the ranked shortlist as best-effort Mantle research, then confirm protocol risk, token mechanics, and missing momentum inputs manually."
        : "Use the ranked yield rows as a shortlist, then confirm pool risk and token mechanics manually."
      : "Treat this as a narrative DeFi brief until direct pool rows are available.",
    confidence: entities.length ? deriveOnChainConfidence(input.tools) : "low",
    entities,
    tables: entities.length
      ? [
          {
            id: "yield-table",
            title: "Yield Ranking",
            description:
              "Score combines Mantle TVL percentile, best APY percentile, and momentum when direct change fields are available. Protocol TVL falls back to summed Mantle pool TVL when direct protocol TVL is missing.",
            columns: [
              "rank",
              "protocol",
              "score",
              "tvlUsd",
              "bestApy",
              "momentumScore",
              "poolCount",
              "coverage",
            ],
            rows: entities.map((entity) => ({
              bestApy: entity.metrics.bestApy,
              coverage: entity.metrics.coverage,
              momentumScore: entity.metrics.momentumScore,
              poolCount: entity.metrics.poolCount,
              protocol: entity.label,
              rank: entity.rank,
              score: entity.metrics.score,
              tvlUsd: entity.metrics.tvlUsd,
            })),
          },
        ]
      : [],
    sections: [
      {
        id: "signal-summary",
        title: "Signal Summary",
        markdown: entities.length
          ? hasPartialCoverage
            ? `Ranked shortlist from partial coverage. ${coverageSummary}`
            : `Direct Mantle protocol TVL and yield rows were aggregated into a composite-ranked shortlist. ${coverageSummary}`
          : "No direct yield pool table was emitted because the run lacked row-level metrics.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "data-context",
        title: "Data Context",
        markdown:
          "Protocol scores combine Mantle TVL percentile, best APY percentile, and momentum when direct change fields are available. When direct protocol TVL is missing, the report falls back to summed Mantle pool TVL. When momentum fields are missing or coverage is incomplete, the shortlist degrades to TVL + APY or context-only instead of fabricating a stronger ranking.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "conclusion",
        title: "Conclusion",
        markdown: entities.length
          ? hasPartialCoverage
            ? "The current shortlist is usable for DeFi triage, but partial coverage means any claim about yield momentum still needs manual confirmation."
            : "The strongest-ranked protocols are usable for research triage, but they still need manual risk review."
          : "This DeFi run is useful for context only until pool-level rows are available.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
    ],
    caveats: buildOnChainReportCaveats(input),
    recommendations: [input.recommendation],
  };
}

function collectDefiProtocolRanks(
  tools: OnChainToolResult[],
  chain: string
) {
  const normalizedChain = chain.toLowerCase();
  const aggregates = new Map<string, DefiProtocolAggregate>();

  for (const tool of tools) {
    if (
      tool.status !== "success" ||
      tool.provider === "local" ||
      (tool.domain !== "defi_tvl" && tool.domain !== "yield_pools")
    ) {
      continue;
    }

    for (const record of readToolRecords(tool.data)) {
      if (tool.domain === "defi_tvl") {
        collectProtocolTvlRecord(aggregates, record, normalizedChain, tool.commandId);
        continue;
      }

      collectYieldPoolRecord(aggregates, record, normalizedChain, tool.commandId);
    }
  }

  return scoreDefiProtocolAggregates(Array.from(aggregates.values())).slice(0, 12);
}

function collectProtocolTvlRecord(
  aggregates: Map<string, DefiProtocolAggregate>,
  record: Record<string, unknown>,
  chain: string,
  toolId: string
) {
  if (!recordMatchesChain(record, chain)) {
    return;
  }

  const rawLabel =
    readString(record.name) ||
    readString(record.slug) ||
    readString(record.project) ||
    readString(record.id);

  if (!rawLabel) {
    return;
  }

  const aggregate = getOrCreateDefiProtocolAggregate(
    aggregates,
    normalizeProtocolKey(rawLabel),
    rawLabel,
    "protocol"
  );
  const tvlUsd =
    readChainTvl(record, chain) ??
    readNumberField(record, ["tvlUsd", "tvl", "totalLiquidityUsd"]);

  if (tvlUsd !== undefined) {
    aggregate.protocolTvlUsd = Math.max(aggregate.protocolTvlUsd ?? 0, tvlUsd);
  }

  aggregate.tvlPct1D =
    firstDefined(
      aggregate.tvlPct1D,
      readNumberField(record, ["change_1d", "change1d", "tvlPct1D", "tvlChange1d"])
    );
  aggregate.tvlPct7D =
    firstDefined(
      aggregate.tvlPct7D,
      readNumberField(record, ["change_7d", "change7d", "tvlPct7D", "tvlChange7d"])
    );
  aggregate.toolIds.add(toolId);
}

function collectYieldPoolRecord(
  aggregates: Map<string, DefiProtocolAggregate>,
  record: Record<string, unknown>,
  chain: string,
  toolId: string
) {
  const poolChain = readString(record.chain)?.toLowerCase();

  if (poolChain !== chain) {
    return;
  }

  const rawLabel =
    readString(record.project) ||
    readString(record.name) ||
    readString(record.protocol) ||
    readString(record.id);

  if (!rawLabel) {
    return;
  }

  const aggregate = getOrCreateDefiProtocolAggregate(
    aggregates,
    normalizeProtocolKey(rawLabel),
    rawLabel,
    "yield"
  );
  const poolTvlUsd = readNumberField(record, ["tvlUsd", "tvl", "totalLiquidityUsd"]);
  const apy = readNumberField(record, ["apy", "apyBase", "apyReward"]);

  aggregate.poolCount += 1;
  aggregate.poolTvlUsdSum += poolTvlUsd ?? 0;
  aggregate.toolIds.add(toolId);

  if (apy !== undefined && (aggregate.bestApy === undefined || apy > aggregate.bestApy)) {
    aggregate.bestApy = apy;
    aggregate.apyPct1D = readNumberField(record, [
      "apyPct1D",
      "apyBase1d",
      "apy1d",
      "apyChange1d",
    ]);
    aggregate.apyPct7D = readNumberField(record, [
      "apyPct7D",
      "apyBase7d",
      "apy7d",
      "apyChange7d",
    ]);
  }
}

function scoreDefiProtocolAggregates(aggregates: DefiProtocolAggregate[]) {
  const enriched = aggregates
    .map((aggregate) => {
      const tvlUsd =
        aggregate.protocolTvlUsd !== undefined
          ? aggregate.protocolTvlUsd
          : aggregate.poolTvlUsdSum > 0
            ? aggregate.poolTvlUsdSum
            : undefined;
      const momentumScore = calculateMomentumScore(aggregate);

      return {
        aggregate,
        bestApy: aggregate.bestApy,
        momentumComponent:
          momentumScore === undefined ? undefined : normalizeMomentumComponent(momentumScore),
        momentumScore,
        tvlUsd,
      };
    })
    .filter(
      (item) =>
        item.tvlUsd !== undefined ||
        item.bestApy !== undefined ||
        item.momentumScore !== undefined
    );
  const tvlValues = enriched
    .map((item) =>
      item.tvlUsd === undefined ? undefined : Math.log10(Math.max(item.tvlUsd, 1))
    )
    .filter((value): value is number => value !== undefined);
  const apyValues = enriched
    .map((item) => item.bestApy)
    .filter((value): value is number => value !== undefined);

  return enriched
    .map((item) => {
      const hasDirectProtocolTvl = item.aggregate.protocolTvlUsd !== undefined;
      const tvlScore =
        item.tvlUsd === undefined
          ? undefined
          : percentileRank(tvlValues, Math.log10(Math.max(item.tvlUsd, 1)));
      const apyScore =
        item.bestApy === undefined ? undefined : percentileRank(apyValues, item.bestApy);
      const coverage = determineDefiCoverage({
        bestApy: item.bestApy,
        hasDirectProtocolTvl,
        momentumScore: item.momentumScore,
        tvlUsd: item.tvlUsd,
      });
      const score = weightedAverage([
        { value: tvlScore, weight: 0.45 },
        { value: apyScore, weight: 0.35 },
        { value: item.momentumComponent, weight: 0.2 },
      ]);

      return {
        bestApy: item.bestApy,
        coverage,
        id: item.aggregate.key,
        label: item.aggregate.label,
        momentumScore: item.momentumScore,
        poolCount: item.aggregate.poolCount,
        score: score ?? 0,
        severity: severityForDefiCoverage(coverage),
        summary: describeDefiProtocol({
          bestApy: item.bestApy,
          coverage,
          hasDirectProtocolTvl,
          momentumScore: item.momentumScore,
          poolCount: item.aggregate.poolCount,
          tvlUsd: item.tvlUsd,
        }),
        toolIds: Array.from(item.aggregate.toolIds),
        tvlUsd: item.tvlUsd,
      } satisfies DefiProtocolRank;
    })
    .sort(
      (left, right) =>
        compareNumber(right.score, left.score) ||
        compareNumber(right.tvlUsd, left.tvlUsd) ||
        compareNumber(right.bestApy, left.bestApy) ||
        left.label.localeCompare(right.label)
    );
}

function getOrCreateDefiProtocolAggregate(
  aggregates: Map<string, DefiProtocolAggregate>,
  key: string,
  rawLabel: string,
  source: "protocol" | "yield"
) {
  const existing = aggregates.get(key);

  if (existing) {
    if (source === "protocol" && existing.labelSource !== "protocol") {
      existing.label = formatProtocolLabel(rawLabel);
      existing.labelSource = source;
    }

    return existing;
  }

  const aggregate: DefiProtocolAggregate = {
    key,
    label: formatProtocolLabel(rawLabel),
    labelSource: source,
    poolCount: 0,
    poolTvlUsdSum: 0,
    toolIds: new Set<string>(),
  };
  aggregates.set(key, aggregate);

  return aggregate;
}

function determineDefiCoverage({
  bestApy,
  hasDirectProtocolTvl,
  momentumScore,
  tvlUsd,
}: {
  bestApy?: number;
  hasDirectProtocolTvl: boolean;
  momentumScore?: number;
  tvlUsd?: number;
}): DefiProtocolRank["coverage"] {
  if (
    hasDirectProtocolTvl &&
    tvlUsd !== undefined &&
    bestApy !== undefined &&
    momentumScore !== undefined
  ) {
    return "composite";
  }

  if (tvlUsd !== undefined && bestApy !== undefined) {
    return "tvl+apy";
  }

  return "context-only";
}

function severityForDefiCoverage(coverage: DefiProtocolRank["coverage"]) {
  if (coverage === "composite") {
    return "high";
  }

  if (coverage === "tvl+apy") {
    return "medium";
  }

  return "watch";
}

function describeDefiProtocol({
  bestApy,
  coverage,
  hasDirectProtocolTvl,
  momentumScore,
  poolCount,
  tvlUsd,
}: {
  bestApy?: number;
  coverage: DefiProtocolRank["coverage"];
  hasDirectProtocolTvl: boolean;
  momentumScore?: number;
  poolCount: number;
  tvlUsd?: number;
}) {
  const tvlText =
    tvlUsd !== undefined
      ? `${formatUsd(tvlUsd)} Mantle TVL${hasDirectProtocolTvl ? "" : " from summed pool coverage"}`
      : "direct Mantle TVL was unavailable";
  const apyText =
    bestApy !== undefined ? `${formatPercent(bestApy)} best APY` : "direct APY was unavailable";
  const momentumText =
    momentumScore !== undefined
      ? `${formatPercent(momentumScore)} momentum`
      : "momentum fields were incomplete";
  const basisText =
    coverage === "composite"
      ? "Composite ranking used TVL, APY, and momentum."
      : coverage === "tvl+apy"
        ? "Ranking fell back to TVL + APY because the full composite inputs were incomplete."
        : "Ranking used limited direct context only.";

  return `${tvlText}, ${apyText}, ${momentumText}. ${poolCount} Mantle pool(s) contributed to this protocol view. ${basisText}`;
}

function describeDefiLeader(protocol: DefiProtocolRank) {
  const parts = [
    `${protocol.label} leads the current view`,
    protocol.tvlUsd !== undefined ? `with ${formatUsd(protocol.tvlUsd)} TVL` : undefined,
    protocol.bestApy !== undefined ? `${formatPercent(protocol.bestApy)} best APY` : undefined,
    protocol.momentumScore !== undefined
      ? `${formatPercent(protocol.momentumScore)} momentum`
      : undefined,
  ].filter(Boolean);

  return `${parts.join(" and ")}.`;
}

function summarizeDefiCoverage(protocols: DefiProtocolRank[]) {
  const coverageCounts = protocols.reduce(
    (counts, protocol) => {
      counts[protocol.coverage] += 1;
      return counts;
    },
    {
      composite: 0,
      "context-only": 0,
      "tvl+apy": 0,
    } satisfies Record<DefiProtocolRank["coverage"], number>
  );
  const parts = [
    coverageCounts.composite
      ? `${coverageCounts.composite} protocol(s) used composite scoring`
      : undefined,
    coverageCounts["tvl+apy"]
      ? `${coverageCounts["tvl+apy"]} protocol(s) fell back to TVL + APY`
      : undefined,
    coverageCounts["context-only"]
      ? `${coverageCounts["context-only"]} protocol(s) stayed context-only`
      : undefined,
  ].filter(Boolean);

  return parts.length ? `${parts.join("; ")}.` : "Coverage details were limited.";
}

function calculateMomentumScore(aggregate: DefiProtocolAggregate) {
  const values = [
    { value: aggregate.apyPct1D, weight: 0.35 },
    { value: aggregate.apyPct7D, weight: 0.35 },
    { value: aggregate.tvlPct1D, weight: 0.15 },
    { value: aggregate.tvlPct7D, weight: 0.15 },
  ].filter((item) => item.value !== undefined);

  if (!values.length) {
    return undefined;
  }

  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  const weightedValue = values.reduce(
    (sum, item) => sum + clampNumber(item.value ?? 0, -100, 100) * item.weight,
    0
  );

  return totalWeight > 0 ? weightedValue / totalWeight : undefined;
}

function normalizeMomentumComponent(value: number) {
  return clampNumber((clampNumber(value, -100, 100) + 100) / 2, 0, 100);
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function readToolRecords(value: unknown) {
  const candidates = [
    ...(Array.isArray(value) ? value : []),
    ...readArrayFromUnknown(value, "rows"),
    ...readArrayFromUnknown(value, "data"),
    ...readArrayFromUnknown(value, "result.rows"),
    ...readArrayFromUnknown(value, "results"),
    ...readArrayFromUnknown(value, "items"),
  ];

  return candidates
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function recordMatchesChain(record: Record<string, unknown>, chain: string) {
  const directChain = readString(record.chain)?.toLowerCase();

  if (directChain === chain) {
    return true;
  }

  if (Array.isArray(record.chains)) {
    return record.chains.some(
      (item) => typeof item === "string" && item.toLowerCase() === chain
    );
  }

  const chainTvls = asRecord(record.chainTvls);

  if (!chainTvls) {
    return false;
  }

  return Object.keys(chainTvls).some((key) => key.toLowerCase() === chain);
}

function readChainTvl(record: Record<string, unknown>, chain: string) {
  const chainTvls = asRecord(record.chainTvls);

  if (!chainTvls) {
    return undefined;
  }

  for (const [key, value] of Object.entries(chainTvls)) {
    if (key.toLowerCase() !== chain) {
      continue;
    }

    const directValue = readNumberValue(value);

    if (directValue !== undefined) {
      return directValue;
    }

    const chainRecord = asRecord(value);

    if (!chainRecord) {
      continue;
    }

    return readNumberField(chainRecord, ["tvl", "tvlUsd", "totalLiquidityUsd"]);
  }

  return undefined;
}

function normalizeProtocolKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatProtocolLabel(value: string) {
  if (/[A-Z]/.test(value) || /\s/.test(value)) {
    return value.trim();
  }

  return value
    .trim()
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function firstDefined<T>(...values: Array<T | undefined>) {
  return values.find((value) => value !== undefined);
}

