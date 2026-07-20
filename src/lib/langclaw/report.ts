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
  percentileRank,
  providerLabel,
  readArrayFromUnknown,
  readMetricNumber,
  readNumberField,
  readNumberValue,
  readNestedNumber,
  readNestedString,
  readPath,
  readString,
  roundNumber,
  uniqueStrings,
  weightedAverage,
} from "./report/core";
import { buildDefiYieldReport } from "./report/defi-yield";
import { buildSmartMoneyReport } from "./report/smart-money";
import { buildLiquidityAnomalyReport } from "./report/liquidity";
import { buildTokenDiscoveryReport } from "./report/token-discovery";

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
