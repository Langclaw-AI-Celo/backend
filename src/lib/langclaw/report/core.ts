import {
  isDirectProviderIssue,
  isUsableDirectProviderResult,
} from "../../onchain-tools/evidence";
import type {
  BuildOnChainResearchReportInput,
  NormalizedRow,
  OnChainToolResult,
  ResearchReportConfidence,
} from "./types";

export { isDirectProviderIssue, isUsableDirectProviderResult };

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
