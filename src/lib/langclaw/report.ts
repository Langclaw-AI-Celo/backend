import type {
  BuildOnChainResearchReportInput,
  BuildWorkflowResearchReportInput,
  DefiProtocolAggregate,
  DefiProtocolRank,
  DiscoverSignals,
  ProviderTraceEntry,
  NormalizedPair,
  NormalizedRow,
  ResearchReport,
  ResearchReportConfidence,
  ResearchReportEntity,
  ResearchReportKind,
  ResearchReportSection,
  ResearchReportSeverity,
  ResearchReportTable,
  SourceCard,
  OnChainPlanSummary,
  OnChainToolFinalPayload,
  OnChainToolResult,
  TokenDiscoveryAggregate,
  TokenDiscoveryRank,
} from "./report/types";
import { getDexScreenerChainId } from "../onchain-tools/chains";
import {
  asRecord,
  buildOnChainReportCaveats,
  collectStructuredRows,
  compareNumber,
  deriveOnChainConfidence,
  formatOnChainProviderIssue,
  formatPercent,
  formatRatio,
  formatUsd,
  isDirectProviderIssue,
  isUsableDirectProviderResult,
  normalizeSentence,
  providerLabel,
  readArrayFromUnknown,
  readMetricNumber,
  readNestedNumber,
  readNestedString,
  readPath,
  readString,
  roundNumber,
  uniqueStrings,
} from "./report/core";
import { buildSmartMoneyReport } from "./report/smart-money";
import { buildLiquidityAnomalyReport } from "./report/liquidity";

export { renderResearchReportMarkdown } from "./report/markdown";

export function buildOnChainResearchReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const kind = inferOnChainReportKind(input.plan);

  if (kind === "liquidity-anomaly") {
    return buildLiquidityAnomalyReport(input);
  }

  if (kind === "smart-money") {
    return buildSmartMoneyReport(input);
  }

  if (kind === "defi-yield") {
    return buildDefiYieldReport(input);
  }

  if (kind === "token-discovery") {
    return buildTokenDiscoveryReport(input);
  }

  return buildMarketBriefReport(input);
}

export function buildWorkflowResearchReport(
  input: BuildWorkflowResearchReportInput
): ResearchReport {
  const baseOnChainReport = input.onChain?.report;
  const kind = inferWorkflowReportKind(input.topic, baseOnChainReport);
  const sourceCounts = summarizeSourceCounts(input.sources);
  const socialSentence = buildSocialEvidenceSentence(input.sources, sourceCounts);
  const onChainSentence = input.signals.onchain.summary;
  const combinedSentence = input.signals.combined.summary;
  const directMetricsAvailable = Boolean(
    baseOnChainReport?.entities.length || baseOnChainReport?.tables.length
  );
  const entities =
    kind === "mixed-research" && !directMetricsAvailable
      ? []
      : (baseOnChainReport?.entities ?? []);
  const tables =
    kind === "mixed-research" && !directMetricsAvailable
      ? []
      : (baseOnChainReport?.tables ?? []);
  const sections = [
    {
      id: "combined-view",
      title: "Combined View",
      markdown: combinedSentence,
      sourceIds: input.signals.combined.sourceIds,
      toolIds: input.signals.combined.toolIds,
    },
    {
      id: "social-view",
      title: "Social Context",
      markdown: socialSentence,
      sourceIds: input.signals.social.sourceIds,
      toolIds: input.signals.social.toolIds,
    },
    {
      id: "onchain-view",
      title: "On-chain View",
      markdown: onChainSentence,
      sourceIds: input.signals.onchain.sourceIds,
      toolIds: input.signals.onchain.toolIds,
    },
    ...(baseOnChainReport?.sections
      ?.filter(
        (section) =>
          section.id !== "signal-summary" &&
          section.id !== "conclusion" &&
          section.id !== "data-context"
      )
      .map((section) => ({
        ...section,
        title:
          kind === "mixed-research" ? `On-chain: ${section.title}` : section.title,
      })) ?? []),
    {
      id: "data-context",
      title: "Data Context",
      markdown: buildWorkflowDataContext({
        onChain: input.onChain,
        onChainSkippedReason: input.onChainSkippedReason,
        sourceCounts,
      }),
      sourceIds: input.sources.map((source) => source.id),
      toolIds: input.onChain?.tools.map((tool) => tool.commandId) ?? [],
    },
    {
      id: "conclusion",
      title: "Conclusion",
      markdown:
        directMetricsAvailable && baseOnChainReport?.kind === kind
          ? baseOnChainReport.bottomLine
          : buildWorkflowBottomLine(kind, input.signals, directMetricsAvailable),
      sourceIds: input.signals.combined.sourceIds,
      toolIds: input.signals.combined.toolIds,
    },
  ];
  const caveats = uniqueStrings([
    ...(baseOnChainReport?.caveats ?? []),
    ...buildWorkflowCaveats(input, kind),
  ]);
  const recommendations = uniqueStrings([
    ...(baseOnChainReport?.recommendations ?? []),
    buildWorkflowRecommendation(input.signals, kind),
  ]);

  return {
    kind,
    title: buildWorkflowReportTitle(kind, input.topic, input.onChain?.plan.chainName),
    asOfUtc: input.generatedAt,
    executiveSummary:
      directMetricsAvailable && baseOnChainReport?.kind === kind
        ? baseOnChainReport.executiveSummary
        : `${input.topic}: ${combinedSentence}`,
    bottomLine:
      directMetricsAvailable && baseOnChainReport?.kind === kind
        ? baseOnChainReport.bottomLine
        : buildWorkflowBottomLine(kind, input.signals, directMetricsAvailable),
    confidence: deriveWorkflowConfidence(input.signals, directMetricsAvailable),
    entities,
    tables,
    sections,
    caveats,
    recommendations,
  };
}
















































function buildDefiYieldReport(
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

function buildTokenDiscoveryReport(
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

function buildMarketBriefReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const caveats = buildOnChainReportCaveats(input);

  return {
    kind: "market-brief",
    title: `${input.plan.chainName} Market Brief`,
    asOfUtc: input.generatedAt,
    executiveSummary:
      input.answer ||
      `This ${input.plan.chainName} market brief summarizes the direct and synthesized on-chain evidence returned in the current run.`,
    bottomLine:
      "Use this brief as a research summary, not as a substitute for direct manual verification.",
    confidence: deriveOnChainConfidence(input.tools),
    entities: [],
    tables: [],
    sections: [
      {
        id: "signal-summary",
        title: "Signal Summary",
        markdown: summarizeToolResults(input.tools),
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "data-context",
        title: "Data Context",
        markdown:
          "This market brief stays narrative-first because the run did not return a compatible ranked-table data shape.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "conclusion",
        title: "Conclusion",
        markdown:
          "The current output is suitable for contextual market monitoring, but not for quantitative ranking.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
    ],
    caveats,
    recommendations: [input.recommendation],
  };
}

function inferOnChainReportKind(plan: OnChainPlanSummary): ResearchReportKind {
  if (plan.intent === "smart-money") {
    return "smart-money";
  }

  if (plan.intent === "defi") {
    const text = [plan.rawQuery, plan.query].filter(Boolean).join(" ");
    const hasQuantitativeDefiText =
      /\b(apy|farm|momentum|pool|pools|protocol|protocols|rank|ranking|tvl|yield)\b/i.test(
        text
      );
    const hasDefiRankingTools = plan.commands.some(
      (command) =>
        command.domain === "yield_pools" ||
        command.commandId.startsWith("yield_pools.") ||
        command.commandId === "defi_tvl.defillama_protocols"
    );

    return hasQuantitativeDefiText || hasDefiRankingTools
      ? "defi-yield"
      : "market-brief";
  }

  if (plan.intent === "trading-signal") {
    return /\b(liquid\w*|anomal\w*|pair|pool|slippage|route)\b/i.test(
      [plan.rawQuery, plan.query].filter(Boolean).join(" ")
    )
      ? "liquidity-anomaly"
      : "market-brief";
  }

  if (
    plan.intent === "token-discovery" ||
    plan.commands.some((command) => command.domain === "token_discovery")
  ) {
    return "token-discovery";
  }

  return "market-brief";
}

function inferWorkflowReportKind(
  topic: string,
  baseOnChainReport?: ResearchReport
): ResearchReportKind {
  if (
    baseOnChainReport?.kind === "token-discovery" &&
    (baseOnChainReport.entities.length || baseOnChainReport.tables.length)
  ) {
    return "token-discovery";
  }

  if (/\bsmart[-\s]money|whale|accumulat\w*|holder flow\b/i.test(topic)) {
    return "smart-money";
  }

  if (/\b(liquid\w*|anomal\w*|pair|pool|slippage|route)\b/i.test(topic)) {
    return "liquidity-anomaly";
  }

  if (/\b(yield|apy|farm)\b/i.test(topic)) {
    return "defi-yield";
  }

  if (baseOnChainReport?.entities.length || baseOnChainReport?.tables.length) {
    return baseOnChainReport.kind;
  }

  return "mixed-research";
}

function buildWorkflowReportTitle(
  kind: ResearchReportKind,
  topic: string,
  chainName?: string
) {
  const prefix = chainName || "Langclaw";

  if (kind === "liquidity-anomaly") {
    return `${prefix} liquidity anomaly report`;
  }

  if (kind === "smart-money") {
    return `${prefix} smart money report`;
  }

  if (kind === "defi-yield") {
    return `${prefix} DeFi yield report`;
  }

  if (kind === "token-discovery") {
    return `${prefix} token discovery report`;
  }

  if (kind === "market-brief") {
    return `${prefix} market brief`;
  }

  return `${prefix} combined research report: ${topic}`;
}


function deriveWorkflowConfidence(
  signals: DiscoverSignals,
  directMetricsAvailable: boolean
): ResearchReportConfidence {
  if (signals.combined.status === "success") {
    return directMetricsAvailable ? "high" : "medium";
  }

  if (signals.combined.status === "partial") {
    return directMetricsAvailable ? "medium" : "low";
  }

  if (signals.combined.status === "failed") {
    return "insufficient";
  }

  return "low";
}


function buildWorkflowCaveats(
  input: BuildWorkflowResearchReportInput,
  kind: ResearchReportKind
) {
  if (kind === "smart-money") {
    const hasSourceGap =
      input.errors.length > 0 ||
      input.signals.combined.status === "partial" ||
      (input.providerTrace ?? []).some((entry) => entry.status === "failed") ||
      Boolean(input.onChainSkippedReason);

    return hasSourceGap
      ? ["Some wallet-level checks were unavailable, so classifications stay provisional."]
      : [];
  }

  const sectionalCaveat =
    input.signals.combined.caveat ||
    [input.signals.social.caveat, input.signals.onchain.caveat]
      .filter(Boolean)
      .join(" ");

  const notes = [
    ...input.errors.map(
      (error) =>
        `${providerLabel(error.provider)} failed (${normalizeSentence(error.message)}).`
    ),
    ...(input.providerTrace ?? [])
      .filter((entry) => entry.status === "failed")
      .map((entry) => formatProviderTraceIssue(entry)),
    sectionalCaveat,
    input.onChainSkippedReason,
  ];

  return uniqueStrings(notes.filter(Boolean));
}


function formatProviderTraceIssue(entry: ProviderTraceEntry) {
  if (/row-level smart-money|wallet-flow coverage/i.test(entry.message)) {
    return `${providerLabel(entry.provider)} row-level wallet-flow coverage was unavailable.`;
  }

  return `${providerLabel(entry.provider)} failed (${normalizeSentence(entry.message)}).`;
}

function buildWorkflowRecommendation(
  signals: DiscoverSignals,
  kind: ResearchReportKind
) {
  if (kind === "smart-money") {
    return "Use confirmed smart-money only when labels, retention, sell pressure, and second-source checks support it. Keep DEX-only rows in the large-flow watchlist.";
  }

  if (kind === "liquidity-anomaly") {
    return "Follow up on the top-ranked pair with holder, large-swap, and LP-change checks before escalating the anomaly.";
  }

  if (kind === "token-discovery") {
    return "Use the ranked token shortlist for discovery triage, then confirm liquidity, holders, and token risk with direct checks.";
  }

  if (signals.combined.status === "partial") {
    return "Use the current report as directional research and rerun once the failed providers are fixed or replaced.";
  }

  return "Use the report as a research starting point, then confirm the strongest signal manually before making a final claim.";
}

function buildWorkflowBottomLine(
  kind: ResearchReportKind,
  signals: DiscoverSignals,
  directMetricsAvailable: boolean
) {
  if (kind === "smart-money") {
    return directMetricsAvailable
      ? "Social and on-chain evidence can support a smart-money watchlist, but DEX-only rows are not confirmed smart money."
      : "Social and context signals can still guide directional research, but wallet-flow rows are needed before ranking accumulation wallets.";
  }

  if (kind === "liquidity-anomaly") {
    return directMetricsAvailable
      ? "The top-ranked pool is the best follow-up target, but this remains a pool-stress screen rather than a confirmed LP migration report."
      : "No direct pair-level table was available, so treat the anomaly brief as narrative-only.";
  }

  if (kind === "defi-yield") {
    return directMetricsAvailable
      ? "Use the ranked DeFi shortlist as best-effort research, then confirm protocol risk and missing momentum fields manually."
      : "No direct protocol-level ranking table was available, so treat the DeFi brief as narrative-only.";
  }

  if (kind === "token-discovery") {
    return directMetricsAvailable
      ? "Use the ranked on-chain token shortlist as best-effort research, then confirm liquidity, holders, and token risk manually."
      : "No direct chain-scoped token ranking table was available, so treat the discovery brief as narrative-only.";
  }

  if (signals.combined.status === "success") {
    return "The combined social and on-chain brief is usable, but it should still be reviewed manually before becoming a final market claim.";
  }

  if (signals.combined.status === "partial") {
    return "The combined brief is partial, so treat it as directional research rather than a verified conclusion.";
  }

  return "The current run did not produce a dependable combined view.";
}

function buildWorkflowDataContext({
  onChain,
  onChainSkippedReason,
  sourceCounts,
}: {
  onChain?: OnChainToolFinalPayload;
  onChainSkippedReason?: string;
  sourceCounts: Record<string, number>;
}) {
  const sourceText = Object.entries(sourceCounts)
    .filter(([, count]) => count > 0)
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(", ");
  const onChainText = onChain
    ? `On-chain enrichment returned ${onChain.tools.length} tool result(s) on ${onChain.plan.chain}.`
    : onChainSkippedReason || "On-chain enrichment was not available for this run.";

  return [
    sourceText ? `Source coverage: ${sourceText}.` : "Source coverage was limited in this run.",
    onChainText,
    "Quantitative tables appear only when the current run includes direct row-level metrics from tools or providers.",
  ].join(" ");
}

function buildSocialEvidenceSentence(
  sources: SourceCard[],
  sourceCounts: Record<string, number>
) {
  if (!sources.length) {
    return "No source-backed social or public context evidence was collected in this run.";
  }

  const parts: string[] = [];

  if (sourceCounts.X) {
    parts.push(`${sourceCounts.X} X post(s)`);
  }

  if (sourceCounts.Surf) {
    parts.push(`${sourceCounts.Surf} Surf item(s)`);
  }

  if (sourceCounts.Docs) {
    parts.push(`${sourceCounts.Docs} docs/reference page(s)`);
  }

  if (sourceCounts.HackQuest) {
    parts.push(`${sourceCounts.HackQuest} HackQuest item(s)`);
  }

  if (sourceCounts.GitHub) {
    parts.push(`${sourceCounts.GitHub} GitHub repo or builder reference(s)`);
  }

  return `Social and public context evidence included ${parts.join(", ")}.`;
}

function summarizeSourceCounts(sources: SourceCard[]) {
  const counts: Record<string, number> = {
    Docs: 0,
    Elfa: 0,
    GitHub: 0,
    HackQuest: 0,
    Surf: 0,
    X: 0,
  };

  for (const source of sources) {
    if (source.provider === "Tavily") {
      counts.Docs += 1;
      continue;
    }

    if (source.provider === "HackQuest") {
      counts.HackQuest += 1;
      continue;
    }

    counts[source.provider] = (counts[source.provider] ?? 0) + 1;
  }

  return counts;
}





function collectYieldRows(tools: OnChainToolResult[]) {
  const rows = collectStructuredRows(
    tools,
    (tool) => tool.domain === "yield_pools" || tool.domain === "defi_tvl"
  );

  return rows.sort((left, right) => compareNumber(readMetricNumber(right.metrics, "apy"), readMetricNumber(left.metrics, "apy")) || compareNumber(readMetricNumber(right.metrics, "tvlUsd"), readMetricNumber(left.metrics, "tvlUsd")));
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

function percentileRank(values: number[], value: number) {
  if (!values.length) {
    return undefined;
  }

  if (values.length === 1) {
    return 100;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const firstIndex = sorted.findIndex((item) => item === value);
  const lastIndex = sorted.length - 1 - [...sorted].reverse().findIndex((item) => item === value);
  const averageIndex = firstIndex >= 0 ? (firstIndex + lastIndex) / 2 : sorted.findIndex((item) => item > value);
  const normalizedIndex =
    averageIndex >= 0 ? averageIndex : sorted.length - 1;

  return (normalizedIndex / (sorted.length - 1)) * 100;
}

function weightedAverage(values: Array<{ value?: number; weight: number }>) {
  const available = values.filter((item) => item.value !== undefined);

  if (!available.length) {
    return undefined;
  }

  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const weightedValue = available.reduce(
    (sum, item) => sum + (item.value ?? 0) * item.weight,
    0
  );

  return totalWeight > 0 ? weightedValue / totalWeight : undefined;
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

function readNumberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readNumberValue(record[key]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
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



function summarizeToolResults(tools: OnChainToolResult[]) {
  const successful = tools.filter(isUsableDirectProviderResult);
  const failed = tools.filter(isDirectProviderIssue);

  if (!successful.length) {
    return "Direct provider rows were not available in this run.";
  }

  return `The run returned ${successful.length} usable direct provider result(s) and ${failed.length} source gap(s).`;
}

function deriveColumnsFromRows(rows: NormalizedRow[]) {
  const metricKeys = Array.from(
    rows.reduce((set, row) => {
      for (const key of Object.keys(row.metrics)) {
        set.add(key);
      }

      return set;
    }, new Set<string>())
  );

  return ["label", ...metricKeys];
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
