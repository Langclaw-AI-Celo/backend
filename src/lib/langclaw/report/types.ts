import type {
  DiscoverSignals,
  ProviderError,
  ProviderTraceEntry,
  ResearchReport,
  ResearchReportConfidence,
  ResearchReportEntity,
  ResearchReportKind,
  ResearchReportSection,
  ResearchReportSeverity,
  ResearchReportTable,
  SourceCard,
} from "../types";
import type {
  OnChainPlanSummary,
  OnChainToolFinalPayload,
  OnChainToolResult,
} from "../../onchain-tools/types";

export type {
  DiscoverSignals,
  OnChainPlanSummary,
  OnChainToolFinalPayload,
  OnChainToolResult,
  ProviderError,
  ProviderTraceEntry,
  ResearchReport,
  ResearchReportConfidence,
  ResearchReportEntity,
  ResearchReportKind,
  ResearchReportSection,
  ResearchReportSeverity,
  ResearchReportTable,
  SourceCard,
};

export type BuildOnChainResearchReportInput = {
  answer?: string;
  caveat: string;
  generatedAt: string;
  plan: OnChainPlanSummary;
  recommendation: string;
  tools: OnChainToolResult[];
};

export type BuildWorkflowResearchReportInput = {
  errors: ProviderError[];
  generatedAt: string;
  onChain?: OnChainToolFinalPayload;
  onChainSkippedReason?: string;
  providerTrace?: ProviderTraceEntry[];
  signals: DiscoverSignals;
  sources: SourceCard[];
  topic: string;
};

export type NormalizedPair = {
  id: string;
  label: string;
  pairAddress?: string;
  reserveUsd?: number;
  volume24hUsd?: number;
  turnover24h?: number;
  priceChange24h?: number;
  txns24h?: number;
  toolId: string;
};

export type NormalizedRow = {
  id: string;
  label: string;
  metrics: Record<string, string | number | null>;
  toolId: string;
};

export type DefiProtocolAggregate = {
  key: string;
  label: string;
  labelSource: "protocol" | "yield";
  toolIds: Set<string>;
  protocolTvlUsd?: number;
  poolTvlUsdSum: number;
  bestApy?: number;
  apyPct1D?: number;
  apyPct7D?: number;
  tvlPct1D?: number;
  tvlPct7D?: number;
  poolCount: number;
};

export type DefiProtocolRank = {
  id: string;
  label: string;
  coverage: "composite" | "context-only" | "tvl+apy";
  momentumScore?: number;
  poolCount: number;
  score: number;
  severity: ResearchReportSeverity;
  summary: string;
  toolIds: string[];
  tvlUsd?: number;
  bestApy?: number;
};

export type TokenDiscoveryAggregate = {
  key: string;
  label?: string;
  tokenAddress?: string;
  boostAmount?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  priceChange24h?: number;
  poolCount: number;
  bestFeedRank?: number;
  latestUpdatedAt?: number;
  hasBoost: boolean;
  hasPool: boolean;
  hasProfile: boolean;
  toolIds: Set<string>;
};

export type TokenDiscoveryRank = {
  id: string;
  label: string;
  coverage: "boost+pool" | "multi-source" | "single-source";
  score: number;
  severity: ResearchReportSeverity;
  summary: string;
  toolIds: string[];
  tokenAddress?: string;
  boostAmount?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  priceChange24h?: number;
  poolCount: number;
};
