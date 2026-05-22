import {
  getAccountBalance,
  getCode,
  getTokenBalance,
  getTokenTransfers,
  getTxList,
} from "./providers/etherscan";
import {
  getAssetTransfers,
  getTokenBalances,
  getTokenMetadata,
} from "./providers/alchemy";
import {
  getAddressSecurity,
  getTokenSecurity,
} from "./providers/goplus";
import {
  getLatestBoostedTokens,
  getLatestTokenProfiles,
  getPaidOrders,
  getPairSnapshot,
  getTokenPairs,
  getTokenSnapshot,
  getTopBoostedTokens,
  searchPairs,
} from "./providers/dexscreener";
import {
  getChains,
  getProtocol,
  getProtocols,
  getStablecoins,
  getYieldPools,
} from "./providers/defillama";
import { getLatestResult } from "./providers/dune";
import type {
  OnChainExecuteInput,
  OnChainExecutorId,
  OnChainPlan,
  OnChainProviderResponse,
  OnChainToolCallEvent,
  OnChainToolResult,
} from "./types";

type Executor = (input: OnChainExecuteInput) => Promise<OnChainProviderResponse>;

const executors: Record<OnChainExecutorId, Executor> = {
  "alchemy.asset_transfers": (input) =>
    getAssetTransfers({
      chain: input.chain,
      signal: input.signal,
      walletAddress: input.walletAddress,
    }),
  "alchemy.token_balances": (input) =>
    getTokenBalances({
      chain: input.chain,
      signal: input.signal,
      walletAddress: input.walletAddress,
    }),
  "alchemy.token_metadata": (input) =>
    getTokenMetadata({
      chain: input.chain,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "defillama.chains": (input) =>
    getChains({ chain: input.chain, query: input.query, signal: input.signal }),
  "defillama.protocol": (input) =>
    getProtocol({ chain: input.chain, query: input.query, signal: input.signal }),
  "defillama.protocols": (input) =>
    getProtocols({ chain: input.chain, query: input.query, signal: input.signal }),
  "defillama.stablecoins": (input) =>
    getStablecoins({ chain: input.chain, query: input.query, signal: input.signal }),
  "defillama.yield_pools": (input) =>
    getYieldPools({ chain: input.chain, query: input.query, signal: input.signal }),
  "dexscreener.latest_boosts": (input) =>
    getLatestBoostedTokens({ chain: input.chain, query: input.query, signal: input.signal }),
  "dexscreener.latest_profiles": (input) =>
    getLatestTokenProfiles({ chain: input.chain, query: input.query, signal: input.signal }),
  "dexscreener.orders": (input) =>
    getPaidOrders({
      chain: input.chain,
      query: input.query,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "dexscreener.pair_snapshot": (input) =>
    getPairSnapshot({
      chain: input.chain,
      pairAddress: input.tokenAddress,
      query: input.query,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "dexscreener.search_pairs": (input) =>
    searchPairs({ chain: input.chain, query: input.query, signal: input.signal }),
  "dexscreener.token_pairs": (input) =>
    getTokenPairs({
      chain: input.chain,
      query: input.query,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "dexscreener.token_snapshot": (input) =>
    getTokenSnapshot({
      chain: input.chain,
      query: input.query,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "dexscreener.top_boosts": (input) =>
    getTopBoostedTokens({ chain: input.chain, query: input.query, signal: input.signal }),
  "dune.latest_result": (input) =>
    getLatestResult({ query: input.query, signal: input.signal }),
  "etherscan.account_balance": (input) =>
    getAccountBalance({
      chain: input.chain,
      signal: input.signal,
      walletAddress: input.walletAddress,
    }),
  "etherscan.get_code": (input) =>
    getCode({
      chain: input.chain,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "etherscan.token_balance": (input) =>
    getTokenBalance({
      chain: input.chain,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
      walletAddress: input.walletAddress,
    }),
  "etherscan.token_transfers": (input) =>
    getTokenTransfers({
      chain: input.chain,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
      walletAddress: input.walletAddress,
    }),
  "etherscan.txlist": (input) =>
    getTxList({
      chain: input.chain,
      signal: input.signal,
      walletAddress: input.walletAddress,
    }),
  "goplus.address_security": (input) =>
    getAddressSecurity({
      chain: input.chain,
      signal: input.signal,
      walletAddress: input.walletAddress,
    }),
  "goplus.token_security": (input) =>
    getTokenSecurity({
      chain: input.chain,
      signal: input.signal,
      tokenAddress: input.tokenAddress,
    }),
  "local.signal_synthesis": async (input) => ({
    data: {
      completedTools: input.previousResults.filter((result) => result.status === "success").length,
      failedTools: input.previousResults.filter((result) => result.status === "failed").length,
      summaries: input.previousResults.map((result) => result.summary),
    },
    summary: summarizePreviousResults(input.previousResults),
  }),
};

const cache = new Map<string, { expiresAt: number; result: OnChainToolResult }>();

export async function executeOnChainPlan({
  onToolCall,
  onToolResult,
  plan,
  signal,
}: {
  onToolCall?: (event: OnChainToolCallEvent) => void | Promise<void>;
  onToolResult?: (event: OnChainToolResult) => void | Promise<void>;
  plan: OnChainPlan;
  signal?: AbortSignal;
}) {
  const results: OnChainToolResult[] = [];

  for (const planned of plan.commands) {
    const { command, reason } = planned;
    await onToolCall?.({
      commandId: command.id,
      domain: command.domain,
      provider: command.provider,
      reason,
      title: command.title,
    });

    const result = await executeCommand({
      chain: plan.chain,
      chainId: plan.chainId,
      command,
      previousResults: results,
      query: plan.query,
      signal,
      tokenAddress: plan.tokenAddress,
      walletAddress: plan.walletAddress,
    });
    results.push(result);
    await onToolResult?.(result);
  }

  return results;
}

export function isExecutorAvailable(executor: OnChainExecutorId) {
  return executor in executors;
}

async function executeCommand(input: OnChainExecuteInput): Promise<OnChainToolResult> {
  const startedAt = Date.now();
  const cacheKey = buildCacheKey(input);
  const cached = readCache(cacheKey);

  if (cached) {
    return {
      ...cached,
      latencyMs: 0,
      summary: `${cached.summary} Cache hit.`,
    };
  }

  try {
    const executor = executors[input.command.executor];

    if (!executor) {
      throw new Error(`Executor ${input.command.executor} is not registered.`);
    }

    const response = await executor(input);
    const result: OnChainToolResult = {
      commandId: input.command.id,
      data: response.data,
      domain: input.command.domain,
      latencyMs: Date.now() - startedAt,
      provider: input.command.provider,
      sourceUrl: response.sourceUrl || input.command.docsUrl,
      status: "success",
      summary: response.summary || "Tool completed.",
      title: input.command.title,
    };

    writeCache(cacheKey, input.command.cacheTtlSeconds, result);

    return result;
  } catch (error) {
    return {
      commandId: input.command.id,
      domain: input.command.domain,
      error: error instanceof Error ? error.message : "Tool execution failed.",
      latencyMs: Date.now() - startedAt,
      provider: input.command.provider,
      sourceUrl: input.command.docsUrl,
      status: "failed",
      summary: error instanceof Error ? error.message : "Tool execution failed.",
      title: input.command.title,
    };
  }
}

function buildCacheKey(input: OnChainExecuteInput) {
  return JSON.stringify({
    chain: input.chain,
    commandId: input.command.id,
    query: input.query,
    tokenAddress: input.tokenAddress,
    walletAddress: input.walletAddress,
  });
}

function readCache(key: string) {
  const cached = cache.get(key);

  if (!cached || cached.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return cached.result;
}

function writeCache(key: string, ttlSeconds: number, result: OnChainToolResult) {
  if (ttlSeconds <= 0 || result.status !== "success") {
    return;
  }

  cache.set(key, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    result,
  });
}

function summarizePreviousResults(results: OnChainToolResult[]) {
  const successes = results.filter((result) => result.status === "success");
  const failures = results.filter((result) => result.status === "failed");

  return `Synthesized ${successes.length} successful tool results and ${failures.length} failed tool results into an analysis-only signal.`;
}
