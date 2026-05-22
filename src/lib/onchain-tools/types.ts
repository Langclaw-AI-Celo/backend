import type { ModelUsageReceipt, ZeroGProof } from "../langclaw/types";

export const onChainDomains = [
  "token_discovery",
  "market_data",
  "pair_liquidity",
  "wallet_portfolio",
  "wallet_pnl",
  "smart_money",
  "defi_tvl",
  "yield_pools",
  "token_security",
  "honeypot_detection",
  "address_approval_risk",
  "social_sentiment",
  "raw_onchain_query",
  "trading_signal_analysis",
] as const;

export type OnChainDomain = (typeof onChainDomains)[number];

export type OnChainProvider =
  | "alchemy"
  | "defillama"
  | "dexscreener"
  | "dune"
  | "etherscan"
  | "goplus"
  | "local";

export type ProductChainId = "mantle" | "celo";

export type OnChainRiskLevel = "low" | "medium" | "high";

export type OnChainExecutorId =
  | "alchemy.asset_transfers"
  | "alchemy.token_balances"
  | "alchemy.token_metadata"
  | "defillama.chains"
  | "defillama.protocol"
  | "defillama.protocols"
  | "defillama.stablecoins"
  | "defillama.yield_pools"
  | "dexscreener.latest_boosts"
  | "dexscreener.latest_profiles"
  | "dexscreener.orders"
  | "dexscreener.pair_snapshot"
  | "dexscreener.search_pairs"
  | "dexscreener.token_pairs"
  | "dexscreener.token_snapshot"
  | "dexscreener.top_boosts"
  | "dune.latest_result"
  | "etherscan.account_balance"
  | "etherscan.get_code"
  | "etherscan.token_balance"
  | "etherscan.token_transfers"
  | "etherscan.txlist"
  | "goplus.address_security"
  | "goplus.token_security"
  | "local.signal_synthesis";

export type JsonSchema = {
  type: "object";
  properties: Record<
    string,
    {
      description?: string;
      enum?: string[];
      type: "array" | "boolean" | "number" | "object" | "string";
    }
  >;
  required?: string[];
};

export type OnChainCommand = {
  id: string;
  domain: OnChainDomain;
  title: string;
  description: string;
  docsUrl?: string;
  executor: OnChainExecutorId;
  provider: OnChainProvider;
  riskLevel: OnChainRiskLevel;
  cacheTtlSeconds: number;
  paramsSchema: JsonSchema;
};

export type OnChainContextMessage = {
  role: "assistant" | "user";
  content: string;
};

export type OnChainToolMode = "chat" | "onchain" | "research";

export type OnChainPlan = {
  intent: string;
  chain: ProductChainId;
  chainId: number;
  chainName: string;
  commands: OnChainPlannedCommand[];
  domainCount: number;
  nativeSymbol: string;
  providerGaps?: string[];
  query?: string;
  registryCommandCount: number;
  tokenAddress?: string;
  walletAddress?: string;
};

export type OnChainPlannedCommand = {
  command: OnChainCommand;
  reason: string;
};

export type OnChainToolCallEvent = {
  commandId: string;
  domain: OnChainDomain;
  provider: OnChainProvider;
  reason: string;
  title: string;
};

export type OnChainToolStatus = "failed" | "skipped" | "success";

export type OnChainToolResult = {
  commandId: string;
  data?: unknown;
  domain: OnChainDomain;
  error?: string;
  latencyMs: number;
  provider: OnChainProvider;
  sourceUrl?: string;
  status: OnChainToolStatus;
  summary: string;
  title: string;
};

export type OnChainToolFinalPayload = {
  answer: string;
  bullets: string[];
  caveat: string;
  generatedAt: string;
  plan: OnChainPlanSummary;
  recommendation: string;
  title: string;
  tools: OnChainToolResult[];
  proof?: ZeroGProof;
  usage?: ModelUsageReceipt;
};

export type OnChainPlanSummary = Omit<OnChainPlan, "commands"> & {
  commands: Array<{
    commandId: string;
    domain: OnChainDomain;
    provider: OnChainProvider;
    reason: string;
    title: string;
  }>;
};

export type OnChainProviderResponse = {
  data: unknown;
  sourceUrl?: string;
  summary?: string;
};

export type OnChainExecuteInput = {
  chain: ProductChainId;
  chainId: number;
  command: OnChainCommand;
  previousResults: OnChainToolResult[];
  query?: string;
  signal?: AbortSignal;
  tokenAddress?: string;
  walletAddress?: string;
};
