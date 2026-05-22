import type { UsageMeter } from "../usage-pricing";

export type SourceType =
  | "x_post"
  | "github_repo"
  | "docs_page"
  | "hackquest_hackathon"
  | "hackquest_project";

export type ProviderName = "X" | "GitHub" | "Tavily" | "HackQuest";

export type SourceCard = {
  id: string;
  type: SourceType;
  title: string;
  url: string;
  author?: string;
  publishedAt?: string;
  excerpt: string;
  metrics?: Record<string, string | number | undefined>;
  provider: ProviderName;
};

export type ProviderError = {
  provider: ProviderName;
  message: string;
};

export type ProviderResult = {
  sources: SourceCard[];
  errors: ProviderError[];
};

export type OrchestrationRuntime = "openclaw" | "typescript";

export type StepExecution =
  | "openclaw-agent"
  | "typescript-tool"
  | "openai"
  | "evidence-bundle"
  | "mantle-chain"
  | "deterministic-fallback";

export type OrchestrationStep = {
  agent: string;
  skill: string;
  status: "complete" | "failed";
  summary: string;
  execution?: StepExecution;
  model?: string;
  sessionId?: string;
  error?: string;
};

export type WorkflowProgressEvent = {
  stepId: string;
  agent: string;
  skill: string;
  status: "pending" | "running" | "complete" | "failed";
  summary: string;
  timestamp: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  execution?: StepExecution;
  model?: string;
  sessionId?: string;
  error?: string;
};

export type OrchestrationTrace = {
  runtime: OrchestrationRuntime;
  steps: OrchestrationStep[];
};

export type FinalConclusion = {
  headline: string;
  summary: string;
  keySignals: Array<{
    label: string;
    text: string;
    sourceId?: string;
    sourceIds: string[];
  }>;
  recommendation: string;
  qualityNote: string;
  generatedBy: "Final Conclusion Agent";
};

export type FinalAnswer = {
  title: string;
  answer: string;
  bullets: string[];
  recommendation: string;
  caveat: string;
  generatedBy: "Final Conclusion Agent";
};

export type FinalAnswerMeta = {
  synthesis: "openai" | "openclaw-ai" | "deterministic-fallback";
  execution?: StepExecution;
  model?: string;
  requestedModel?: string;
  usedModel?: string;
  modelHonored?: boolean;
  sessionId?: string;
  transport?: string;
  fallbackFrom?: string;
  error?: string;
};

export type PlannerOutput = {
  summary: string;
  providerPlan: Array<{
    provider: ProviderName;
    query: string;
    purpose: string;
  }>;
  scoringFocus: string[];
};

export type TrendOutput = {
  summary: string;
  topTrend: string;
  score: number;
  rankedTrends: Array<{
    label: string;
    score: number;
    why: string;
    sourceIds: string[];
  }>;
};

export type EvidenceOutput = {
  bundleSummary: string;
  storageStatus: ZeroGStorageStatus;
  evidenceUri: string;
  rootHash?: string;
  storageTxHash?: string;
  storageExplorerUrl?: string;
  error?: string;
  claimMap: Array<{
    claim: string;
    sourceIds: string[];
  }>;
};

export type VerifierOutput = {
  verificationSummary: string;
  unsupportedClaims: string[];
  briefHashInput: string;
  storageStatus: ZeroGStorageStatus;
  chainStatus: ZeroGChainStatus;
  chainTxHash?: string;
  chainExplorerUrl?: string;
  registryAddress?: string;
  error?: string;
};

export type AgentOutputs = {
  planner?: PlannerOutput;
  trend?: TrendOutput;
  evidence?: EvidenceOutput;
  verifier?: VerifierOutput;
};

export type DiscoverPayload = {
  topic: string;
  generatedAt: string;
  sources: SourceCard[];
  errors: ProviderError[];
  orchestration: OrchestrationTrace;
  finalConclusion: FinalConclusion;
  finalAnswer: FinalAnswer;
  finalAnswerMeta?: FinalAnswerMeta;
  agentOutputs?: AgentOutputs;
  proof?: ZeroGProof;
  zeroG?: ZeroGProof;
  usage?: ModelUsageReceipt;
};

export type ZeroGStorageStatus = "prepared" | "uploaded" | "skipped" | "failed";

export type ZeroGChainStatus =
  | "prepared"
  | "pending"
  | "anchored"
  | "skipped"
  | "failed";

export type Erc8004ReputationStatus =
  | "prepared"
  | "pending"
  | "anchored"
  | "skipped"
  | "failed";

export type ZeroGComputeStatus = "used" | "skipped" | "failed";

export type ZeroGStorageProof = {
  status: ZeroGStorageStatus;
  evidenceUri: string;
  rootHash?: string;
  txHash?: string;
  explorerUrl?: string;
  indexerRpc?: string;
  error?: string;
};

export type ZeroGChainProof = {
  status: ZeroGChainStatus;
  briefHash: string;
  chain?: string;
  decisionHash?: string;
  decisionId?: string;
  agentId?: string;
  signalType?: string;
  txHash?: string;
  explorerUrl?: string;
  registryAddress?: string;
  chainId?: number;
  chainName?: string;
  nativeSymbol?: string;
  reputation?: Erc8004ReputationProof;
  error?: string;
};

export type Erc8004ReputationProof = {
  status: Erc8004ReputationStatus;
  agentId: string;
  chainId: number;
  registryAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  value?: string;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  error?: string;
};

export type ZeroGComputeProof = {
  status: ZeroGComputeStatus;
  model?: string;
  requestedModel?: string;
  usedModel?: string;
  modelHonored?: boolean;
  fallbackFrom?: string;
  endpoint?: string;
  chatId?: string;
  requestId?: string;
  provider?: string;
  teeVerified?: boolean | null;
  teeVerification?: ZeroGTeeVerification;
  usage?: ZeroGTokenUsage;
  billing?: ZeroGComputeBilling;
  error?: string;
};

export type ZeroGProof = {
  storage: ZeroGStorageProof;
  chain: ZeroGChainProof;
  compute?: ZeroGComputeProof;
};

export type ZeroGTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  maxTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ZeroGComputeBilling = {
  inputCostNeuron?: string;
  outputCostNeuron?: string;
  totalCostNeuron?: string;
  source: "router-trace" | "token-estimate" | "reserved-estimate";
};

export type ZeroGTeeVerification = {
  requested: boolean;
  routerVerified?: boolean | null;
  independentVerified?: boolean | null;
  status:
    | "not-requested"
    | "router-verified"
    | "router-unverified"
    | "router-missing"
    | "independent-verified"
    | "independent-failed"
    | "independent-unavailable"
    | "independent-error";
  chatId?: string;
  error?: string;
};

export type ModelUsageReceipt = {
  wallet: string;
  chain?: string;
  chainId?: number;
  chainName?: string;
  nativeSymbol?: string;
  model: string;
  requestId?: string;
  provider?: string;
  teeVerified?: boolean | null;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  maxTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptPriceNeuron: string;
  completionPriceNeuron: string;
  reservedNeuron: string;
  rawCostNeuron: string;
  markupBps: number;
  markupNeuron: string;
  chargedNeuron: string;
  releasedNeuron: string;
  balanceBefore: string;
  balanceAfter: string;
  costSource: "router-trace" | "token-estimate" | "reserved-estimate";
  totalCostNeuron?: string;
  meter: UsageMeter;
  status: "charged" | "estimated" | "refunded" | "failed_after_charge";
};
