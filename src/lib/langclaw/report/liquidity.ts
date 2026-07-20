import {
  asRecord,
  buildOnChainReportCaveats,
  compareNumber,
  deriveOnChainConfidence,
  formatPercent,
  formatRatio,
  formatUsd,
  getDexScreenerChainId,
  readArrayFromUnknown,
  readNestedNumber,
  readNestedString,
  readString,
  roundNumber,
} from "./core";
import type {
  BuildOnChainResearchReportInput,
  NormalizedPair,
  OnChainToolResult,
  ResearchReport,
  ResearchReportEntity,
  ResearchReportSeverity,
  ResearchReportTable,
} from "./types";

export function buildLiquidityAnomalyReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const pairs = collectDexPairs(input.tools, input.plan.chain)
    .map((pair) => ({
      ...pair,
      severity: classifyLiquiditySeverity(pair),
    }))
    .sort(
      (left, right) =>
        compareSeverity(left.severity, right.severity) ||
        compareNumber(right.turnover24h, left.turnover24h) ||
        compareNumber(right.volume24hUsd, left.volume24hUsd)
    );
  const topPair = pairs[0];
  const entities: ResearchReportEntity[] = pairs.map((pair, index) => ({
    id: pair.id,
    label: pair.label,
    category: "dex-pair",
    rank: index + 1,
    severity: pair.severity,
    summary: describeLiquidityPair(pair),
    metrics: {
      pairAddress: pair.pairAddress ?? null,
      priceChange24h: roundNumber(pair.priceChange24h),
      reserveUsd: roundNumber(pair.reserveUsd),
      turnover24h: roundNumber(pair.turnover24h),
      txns24h: pair.txns24h ?? null,
      volume24hUsd: roundNumber(pair.volume24hUsd),
    },
    sourceIds: [],
    toolIds: [pair.toolId],
  }));
  const tables: ResearchReportTable[] = pairs.length
    ? [
        {
          id: "anomaly-table",
          title: "Anomaly Table",
          description:
            "Turnover is computed as 24h volume divided by current pool reserves when both fields are available.",
          columns: [
            "pair",
            "pool",
            "reserveUsd",
            "volume24hUsd",
            "turnover24h",
            "priceChange24h",
            "txns24h",
            "severity",
          ],
          rows: pairs.map((pair) => ({
            pair: pair.label,
            pool: pair.pairAddress ?? "Not available",
            priceChange24h: roundNumber(pair.priceChange24h),
            reserveUsd: roundNumber(pair.reserveUsd),
            severity: classifyLiquiditySeverity(pair),
            turnover24h: roundNumber(pair.turnover24h),
            txns24h: pair.txns24h ?? null,
            volume24hUsd: roundNumber(pair.volume24hUsd),
          })),
        },
      ]
    : [];
  const caveats = buildOnChainReportCaveats(input);

  return {
    kind: "liquidity-anomaly",
    title: `${input.plan.chainName} DEX Pairs - Liquidity Anomaly Screen`,
    asOfUtc: input.generatedAt,
    executiveSummary: topPair
      ? `This run returned a ranked pair shortlist from partial coverage for ${input.plan.chainName}. ${input.plan.chainName}'s clearest liquidity anomaly right now is ${topPair.label}, where the pool shows ${formatUsd(topPair.reserveUsd)} in reserves against ${formatUsd(topPair.volume24hUsd)} of 24h volume and a ${formatRatio(topPair.turnover24h)} turnover ratio.`
      : `${input.plan.chainName} liquidity anomaly screen ran, but this run did not return pair-level metrics strong enough for a ranked anomaly table.`,
    bottomLine: topPair
      ? `Prioritize ${topPair.label} for follow-up because it combines the strongest reserve, turnover, and price-move stress in this run.`
      : "Treat this as a narrative market brief until pair-level metrics are available.",
    confidence: pairs.length ? deriveOnChainConfidence(input.tools) : "insufficient",
    entities,
    tables,
    sections: [
      {
        id: "signal-summary",
        title: "Signal Summary",
        markdown: topPair
          ? `${topPair.label} is the primary anomaly in this run. ${describeLiquidityPair(topPair)}`
          : "No ranked pair-level anomaly could be produced from the current tool outputs.",
        sourceIds: [],
        toolIds: pairs.map((pair) => pair.toolId),
      },
      {
        id: "data-context",
        title: "Data Context",
        markdown:
          "This screen uses current pair reserve, 24h volume, price change, and transaction activity. It highlights liquidity stress and pool fragility, not confirmed LP add/remove flow.",
        sourceIds: [],
        toolIds: pairs.map((pair) => pair.toolId),
      },
      {
        id: "conclusion",
        title: "Conclusion",
        markdown: topPair
          ? `The current anomaly set is concentrated rather than broad. ${topPair.label} is the highest-priority follow-up pool in this run.`
          : "The run did not produce enough pair-level evidence for a strong liquidity anomaly conclusion.",
        sourceIds: [],
        toolIds: pairs.map((pair) => pair.toolId),
      },
    ],
    caveats,
    recommendations: [input.recommendation],
  };
}

function collectDexPairs(tools: OnChainToolResult[], chain: string) {
  const pairs: NormalizedPair[] = [];
  const dexChainId = getDexScreenerChainId(chain).toLowerCase();

  for (const tool of tools) {
    if (tool.status !== "success") {
      continue;
    }

    if (tool.provider === "dexscreener") {
      for (const item of readArrayFromUnknown(tool.data, "pairs")) {
        const record = asRecord(item);

        if (!record) {
          continue;
        }

        const rowChainId = readString(record.chainId)?.toLowerCase();

        if (rowChainId && rowChainId !== dexChainId) {
          continue;
        }

        const baseSymbol = readNestedString(record, ["baseToken", "symbol"]);
        const quoteSymbol = readNestedString(record, ["quoteToken", "symbol"]);
        const reserveUsd = readNestedNumber(record, ["liquidity", "usd"]);
        const volume24hUsd = readNestedNumber(record, ["volume", "h24"]);
        const turnover24h =
          reserveUsd && volume24hUsd ? volume24hUsd / reserveUsd : undefined;
        const priceChange24h = readNestedNumber(record, ["priceChange", "h24"]);
        const buys = readNestedNumber(record, ["txns", "h24", "buys"]) ?? 0;
        const sells = readNestedNumber(record, ["txns", "h24", "sells"]) ?? 0;
        const pairAddress = readString(record.pairAddress);

        pairs.push({
          id: pairAddress || `${baseSymbol}-${quoteSymbol}-${tool.commandId}`,
          label: [baseSymbol || "Unknown", quoteSymbol || "Unknown"].join(" / "),
          pairAddress,
          priceChange24h,
          reserveUsd,
          toolId: tool.commandId,
          turnover24h,
          txns24h: buys + sells || undefined,
          volume24hUsd,
        });
      }
    }

    if (tool.provider === "geckoterminal") {
      const candidates = [
        ...readArrayFromUnknown(tool.data, "data"),
        ...readArrayFromUnknown(tool.data, "attributes.top_pools"),
      ];
      const root = asRecord(tool.data);

      if (root && !candidates.length && root.data) {
        candidates.push(root.data);
      }

      for (const item of candidates) {
        const record = asRecord(item);

        if (!record) {
          continue;
        }

        const networkId = readString(record.id)?.split("_")[0]?.toLowerCase();

        if (networkId && networkId !== dexChainId) {
          continue;
        }

        const attributes = asRecord(record.attributes) ?? record;
        const label =
          readString(attributes.name) ||
          [readString(attributes.base_token_symbol), readString(attributes.quote_token_symbol)]
            .filter(Boolean)
            .join(" / ") ||
          "Unknown / Unknown";
        const pairAddress =
          extractTrailingAddress(readString(record.id)) ||
          readString(attributes.address);
        const reserveUsd =
          readNestedNumber(attributes, ["reserve_in_usd"]) ??
          readNestedNumber(attributes, ["reserve_usd"]);
        const volume24hUsd =
          readNestedNumber(attributes, ["volume_usd", "h24"]) ??
          readNestedNumber(attributes, ["volume_usd", "24h"]) ??
          readNestedNumber(attributes, ["volume_usd"]);
        const turnover24h =
          reserveUsd && volume24hUsd ? volume24hUsd / reserveUsd : undefined;
        const priceChange24h =
          readNestedNumber(attributes, ["price_change_percentage", "h24"]) ??
          readNestedNumber(attributes, ["price_change_24h"]);
        const buys =
          readNestedNumber(attributes, ["transactions", "h24", "buys"]) ?? 0;
        const sells =
          readNestedNumber(attributes, ["transactions", "h24", "sells"]) ?? 0;

        pairs.push({
          id: pairAddress || `${label}-${tool.commandId}`,
          label,
          pairAddress,
          priceChange24h,
          reserveUsd,
          toolId: tool.commandId,
          turnover24h,
          txns24h: buys + sells || undefined,
          volume24hUsd,
        });
      }
    }
  }

  return pairs;
}

function classifyLiquiditySeverity(pair: NormalizedPair): ResearchReportSeverity {
  const reserveUsd = pair.reserveUsd ?? 0;
  const turnover = pair.turnover24h ?? 0;
  const priceMove = Math.abs(pair.priceChange24h ?? 0);
  const txns = pair.txns24h ?? 0;

  if (reserveUsd > 0 && reserveUsd < 50_000) {
    return "fragile";
  }

  if (turnover >= 1 && (priceMove >= 10 || txns >= 1000)) {
    return "high";
  }

  if (turnover >= 0.4 || priceMove >= 10) {
    return "medium";
  }

  if (turnover > 0 || priceMove > 0 || txns > 0) {
    return "watch";
  }

  return "info";
}

function describeLiquidityPair(pair: NormalizedPair) {
  const parts = [
    pair.reserveUsd !== undefined
      ? `Reserves are ${formatUsd(pair.reserveUsd)}`
      : undefined,
    pair.volume24hUsd !== undefined
      ? `24h volume is ${formatUsd(pair.volume24hUsd)}`
      : undefined,
    pair.turnover24h !== undefined
      ? `turnover is ${formatRatio(pair.turnover24h)}`
      : undefined,
    pair.priceChange24h !== undefined
      ? `24h price move is ${formatPercent(pair.priceChange24h)}`
      : undefined,
    pair.txns24h !== undefined ? `24h transactions total ${pair.txns24h.toLocaleString("en-US")}` : undefined,
  ].filter(Boolean);

  return `${parts.join(", ")}.`;
}

function extractTrailingAddress(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const match = value.match(/(0x[a-fA-F0-9]{40})$/);

  return match?.[1];
}

function compareSeverity(
  left: ResearchReportSeverity,
  right: ResearchReportSeverity
) {
  const order: ResearchReportSeverity[] = [
    "high",
    "medium",
    "watch",
    "fragile",
    "info",
  ];

  return order.indexOf(left) - order.indexOf(right);
}
