import {
  isDirectProviderIssue,
  isUsableDirectProviderResult,
} from "../../onchain-tools/evidence";
import { getDexScreenerChainId } from "../../onchain-tools/chains";
import type {
  BuildOnChainResearchReportInput,
  BuildWorkflowResearchReportInput,
  DiscoverSignals,
  NormalizedRow,
  OnChainPlanSummary,
  OnChainToolFinalPayload,
  OnChainToolResult,
  ProviderTraceEntry,
  ResearchReport,
  ResearchReportConfidence,
  ResearchReportKind,
  SourceCard,
} from "./types";

export {
  getDexScreenerChainId,
  isDirectProviderIssue,
  isUsableDirectProviderResult,
};

export function deriveOnChainConfidence(
  tools: OnChainToolResult[]
): ResearchReportConfidence {
  const directSuccesses = tools.filter(isUsableDirectProviderResult).length;
  const directFailures = tools.filter(isDirectProviderIssue).length;

  if (directSuccesses >= 3 && directFailures === 0) {
    return "high";
  }

  if (directSuccesses >= 2) {
    return "medium";
  }

  if (directSuccesses >= 1 || tools.some((tool) => tool.provider === "local" && tool.status === "success")) {
    return "low";
  }

  return "insufficient";
}

export function buildOnChainReportCaveats(
  input: BuildOnChainResearchReportInput
) {
  if (input.plan.intent === "smart-money") {
    const notes = [
      input.tools.some(isDirectProviderIssue)
        ? "Some wallet-level checks were unavailable, so classifications stay provisional."
        : undefined,
      "No transaction was signed or executed.",
    ];

    return uniqueStrings(notes.filter((note): note is string => Boolean(note)));
  }

  const notes = uniqueStrings([
    input.caveat,
    ...input.tools
      .filter(isDirectProviderIssue)
      .map((tool) => formatOnChainProviderIssue(tool)),
  ]);

  return notes.filter(Boolean);
}

export function formatOnChainProviderIssue(tool: OnChainToolResult) {
  if (tool.domain === "smart_money") {
    return `${providerLabel(tool.provider)} row-level wallet-flow coverage was unavailable.`;
  }

  return `${providerLabel(tool.provider)} failed (${normalizeSentence(tool.error || tool.summary)}).`;
}

export function collectStructuredRows(
  tools: OnChainToolResult[],
  predicate: (tool: OnChainToolResult) => boolean
) {
  const rows: NormalizedRow[] = [];

  for (const tool of tools) {
    if (tool.status !== "success" || tool.provider === "local" || !predicate(tool)) {
      continue;
    }

    const candidates = [
      ...readArrayFromUnknown(tool.data, "rows"),
      ...readArrayFromUnknown(tool.data, "data"),
      ...readArrayFromUnknown(tool.data, "result.rows"),
      ...readArrayFromUnknown(tool.data, "results"),
      ...readArrayFromUnknown(tool.data, "items"),
    ];

    for (const item of candidates) {
      const record = asRecord(item);

      if (!record) {
        continue;
      }

      if (tool.domain === "smart_money" && !isSmartMoneyReportRow(record)) {
        continue;
      }

      const label =
        tool.domain === "smart_money"
          ? readString(record.wallet) ||
            readString(record.walletAddress) ||
            readString(record.address) ||
            readString(record.account) ||
            readString(record.owner) ||
            readString(record.from) ||
            readString(record.to) ||
            readString(record.label) ||
            tool.title
          : readString(record.symbol) ||
            readString(record.name) ||
            readString(record.label) ||
            readString(record.wallet) ||
            readString(record.address) ||
            readString(record.token) ||
            tool.title;
      const metrics = normalizeMetrics(record);

      rows.push({
        id: readString(record.id) || readString(record.address) || `${tool.commandId}-${rows.length + 1}`,
        label,
        metrics,
        toolId: tool.commandId,
      });
    }
  }

  const rowLimit = rows.some((row) => row.toolId.startsWith("smart_money."))
    ? 40
    : 12;

  return dedupeRows(rows).slice(0, rowLimit);
}

export function isSmartMoneyReportRow(record: Record<string, unknown>) {
  const wallet =
    readString(record.wallet) ||
    readString(record.walletAddress) ||
    readString(record.address) ||
    readString(record.account) ||
    readString(record.owner) ||
    readString(record.from) ||
    readString(record.to) ||
    readString(record.label);

  if (!wallet) {
    return false;
  }

  const metricKeys = [
    "amount",
    "balance",
    "netAmount",
    "net_flow_7d_usd",
    "net_flow_30d_usd",
    "netFlowUsd",
    "netMnt",
    "netToken",
    "netTokenRaw",
    "netUsd",
    "normalizedTokenAmount",
    "signal",
    "tokenFlow",
    "trades",
    "transfers",
    "txHash",
    "usd",
    "value",
    "window",
  ];

  return metricKeys.some((key) => hasReportRowValue(record[key]));
}

export function hasReportRowValue(value: unknown) {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return String(value).trim().length > 0;
}

export function dedupeRows(rows: NormalizedRow[]) {
  const seen = new Set<string>();
  const output: NormalizedRow[] = [];

  for (const row of rows) {
    const key = `${row.label}::${stableMetricKey(row.metrics)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(row);
  }

  return output;
}

export function stableMetricKey(metrics: Record<string, string | number | null>) {
  return Object.entries(metrics)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

export function normalizeMetrics(record: Record<string, unknown>) {
  const metrics: Record<string, string | number | null> = {};

  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "label" || key === "name") {
      continue;
    }

    if (typeof value === "number") {
      metrics[key] = roundNumber(value);
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      const parsed = Number(value);
      metrics[key] = isHexIdentifier(trimmed) || !Number.isFinite(parsed) || trimmed === ""
        ? value
        : roundNumber(parsed);
    } else if (value == null) {
      metrics[key] = null;
    }
  }

  return metrics;
}

export function isHexIdentifier(value: string) {
  return /^0x[a-f0-9]{8,}$/i.test(value);
}

export function readMetricNumber(
  metrics: Record<string, string | number | null>,
  key: string
) {
  const value = metrics[key];

  return typeof value === "number" ? value : undefined;
}

export function formatCell(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return "Not available";
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString("en-US")
      : value.toFixed(2).replace(/\.?0+$/, "");
  }

  return value;
}

export function providerLabel(provider: string) {
  switch (provider.toLowerCase()) {
    case "defillama":
      return "DeFiLlama";
    case "dexscreener":
      return "DEX Screener";
    case "dune":
      return "Dune";
    case "elfa":
      return "Elfa";
    case "goplus":
      return "GoPlus";
    case "nansen":
      return "Nansen";
    case "surf":
      return "Surf";
    case "tavily":
      return "Docs";
    default:
      return provider;
  }
}

export function readArrayFromUnknown(value: unknown, path: string) {
  const target = readPath(value, path.split("."));

  return Array.isArray(target) ? target : [];
}

export function readPath(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    const record = asRecord(current);

    if (!record) {
      return undefined;
    }

    current = record[key];
  }

  return current;
}

export function readNestedString(record: Record<string, unknown>, path: string[]) {
  const value = readPath(record, path);

  return typeof value === "string" ? value : undefined;
}

export function readNestedNumber(record: Record<string, unknown>, path: string[]) {
  const value = readPath(record, path);

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();

    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

export function normalizeSentence(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function roundNumber(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

export function compareNumber(left?: number, right?: number) {
  return (left ?? Number.NEGATIVE_INFINITY) - (right ?? Number.NEGATIVE_INFINITY);
}

export function formatUsd(value?: number) {
  if (value === undefined) {
    return "unknown reserves";
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1).replace(/\.?0+$/, "")}K`;
  }

  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatRatio(value?: number) {
  return value === undefined ? "unknown" : `${roundNumber(value)}x`;
}

export function formatPercent(value?: number) {
  return value === undefined ? "unknown" : `${value >= 0 ? "+" : ""}${roundNumber(value)}%`;
}

export function percentileRank(values: number[], value: number) {
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

export function weightedAverage(values: Array<{ value?: number; weight: number }>) {
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

export function readNumberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readNumberValue(record[key]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

export function readNumberValue(value: unknown) {
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

export function inferOnChainReportKind(plan: OnChainPlanSummary): ResearchReportKind {
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
