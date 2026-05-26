import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  getContract,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo as viemCelo } from "viem/chains";

import {
  getProductChain,
  readChainEnv,
  type ProductChainConfig,
  type ProductChainId,
} from "../chain-config";
import type {
  StrategyAction,
  StrategyRecordStatus,
  StrategyRunRecord,
  StrategyRunsPayload,
  TradingJournalProof,
} from "./types";

type PersistTradingJournalInput = {
  action: StrategyAction;
  chain?: ProductChainId;
  decisionHash: Hex;
  evidenceUri: string;
  market: string;
  pnlBps: number;
  resultHash: Hex;
  runId: string;
  status: StrategyRecordStatus;
  strategyId: string;
};

const defaultReceiptPollAttempts = 12;
const defaultReceiptPollIntervalMs = 5000;

const tradingJournalAbi = [
  {
    type: "function",
    name: "recordStrategyRun",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "runId", type: "string" },
      { name: "strategyId", type: "string" },
      { name: "market", type: "string" },
      { name: "decisionHash", type: "bytes32" },
      { name: "resultHash", type: "bytes32" },
      { name: "evidenceUri", type: "string" },
      { name: "action", type: "string" },
      { name: "pnlBps", type: "int256" },
      { name: "status", type: "string" },
    ],
    outputs: [{ name: "recordId", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextRecordId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getRecord",
    stateMutability: "view",
    inputs: [{ name: "recordId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agentId", type: "uint256" },
          { name: "runId", type: "string" },
          { name: "strategyId", type: "string" },
          { name: "market", type: "string" },
          { name: "decisionHash", type: "bytes32" },
          { name: "resultHash", type: "bytes32" },
          { name: "evidenceUri", type: "string" },
          { name: "action", type: "string" },
          { name: "pnlBps", type: "int256" },
          { name: "status", type: "string" },
          { name: "recorder", type: "address" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const strategyRecordEvent = parseAbiItem(
  "event StrategyRecordRecorded(uint256 indexed recordId,uint256 indexed agentId,address indexed recorder,bytes32 decisionHash,bytes32 resultHash,string runId,string strategyId,string market,string evidenceUri,string action,int256 pnlBps,string status)"
);

export async function persistTradingJournalRecord(
  input: PersistTradingJournalInput
): Promise<TradingJournalProof> {
  const chainConfig = getProductChain(input.chain ?? "celo");
  const agentId = readAgentId(chainConfig);
  const chainId = readChainId(chainConfig);
  const journalAddress = readJournalAddress(chainConfig);

  if (readChainEnv(chainConfig, "TRADING_JOURNAL_ENABLED") !== "true") {
    return buildPreparedProof({
      ...input,
      agentId,
      chainConfig,
      chainId,
      error: `${chainConfig.envPrefix}_TRADING_JOURNAL_ENABLED is not true.`,
      journalAddress,
    });
  }

  const privateKey = readPrivateKey(chainConfig);

  if (!privateKey) {
    return buildPreparedProof({
      ...input,
      agentId,
      chainConfig,
      chainId,
      error: `Set ${chainConfig.envPrefix}_AGENT_PRIVATE_KEY to record the strategy run.`,
      journalAddress,
    });
  }

  if (!journalAddress || !isAddress(journalAddress)) {
    return buildPreparedProof({
      ...input,
      agentId,
      chainConfig,
      chainId,
      error: `Set ${chainConfig.envPrefix}_LANGCLAW_TRADING_JOURNAL_ADDRESS to the deployed journal address.`,
      journalAddress,
    });
  }

  const address = getAddress(journalAddress) as Address;
  const rpcUrl =
    readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl) ||
    chainConfig.rpcUrl;
  const explorerBase = trimSlash(
    readChainEnv(chainConfig, "CHAIN_EXPLORER_URL", chainConfig.explorerUrl) ||
      chainConfig.explorerUrl
  );
  let submittedTxHash: Hex | undefined;
  let submittedExplorerUrl: string | undefined;

  try {
    const account = privateKeyToAccount(privateKey);
    const chain = buildViemChain(chainConfig, rpcUrl, chainId);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });
    const { request, result: recordId } = await publicClient.simulateContract({
      account,
      address,
      abi: tradingJournalAbi,
      functionName: "recordStrategyRun",
      args: [
        agentId,
        input.runId,
        input.strategyId,
        input.market,
        input.decisionHash,
        input.resultHash,
        input.evidenceUri,
        input.action,
        BigInt(input.pnlBps),
        input.status,
      ],
    });
    const txHash = await walletClient.writeContract(
      withCeloFeeCurrency(chainConfig, request)
    );
    const explorerUrl = `${explorerBase}/tx/${txHash}`;
    submittedTxHash = txHash;
    submittedExplorerUrl = explorerUrl;
    const receipt = await waitForSubmittedTransactionReceipt({
      publicClient,
      txHash,
    });

    if (!receipt) {
      return {
        action: input.action,
        agentId: agentId.toString(),
        chain: chainConfig.id,
        chainId,
        chainName: chainConfig.name,
        decisionHash: input.decisionHash,
        evidenceUri: input.evidenceUri,
        explorerUrl,
        journalAddress: address,
        pnlBps: input.pnlBps,
        recordId: recordId.toString(),
        resultHash: input.resultHash,
        status: "pending",
        strategyStatus: input.status,
        txHash,
      };
    }

    if (receipt.status !== "success") {
      throw new Error(`Mantle strategy journal transaction ${txHash} reverted.`);
    }

    return {
      action: input.action,
      agentId: agentId.toString(),
      chain: chainConfig.id,
      chainId,
      chainName: chainConfig.name,
      decisionHash: input.decisionHash,
      evidenceUri: input.evidenceUri,
      explorerUrl,
      journalAddress: address,
      pnlBps: input.pnlBps,
      recordId: recordId.toString(),
      resultHash: input.resultHash,
      status: "anchored",
      strategyStatus: input.status,
      txHash,
    };
  } catch (error) {
    return {
      action: input.action,
      agentId: agentId.toString(),
      chain: chainConfig.id,
      chainId,
      chainName: chainConfig.name,
      decisionHash: input.decisionHash,
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
      evidenceUri: input.evidenceUri,
      explorerUrl: submittedExplorerUrl,
      journalAddress: address,
      pnlBps: input.pnlBps,
      resultHash: input.resultHash,
      status: "failed",
      strategyStatus: input.status,
      txHash: submittedTxHash,
    };
  }
}

export async function readTradingJournalRuns(
  limit = 25,
  chainInput: ProductChainId = "mantle"
): Promise<StrategyRunsPayload> {
  const chainConfig = getProductChain(chainInput);
  const journalAddress = readJournalAddress(chainConfig);
  const chainId = readChainId(chainConfig);

  if (!journalAddress || !isAddress(journalAddress)) {
    return {
      chain: chainConfig.id,
      chainId,
      chainName: chainConfig.name,
      configured: false,
      error: `${chainConfig.envPrefix}_LANGCLAW_TRADING_JOURNAL_ADDRESS is not configured.`,
      nextRecordId: "0",
      records: [],
    };
  }

  const address = getAddress(journalAddress) as Address;
  const rpcUrl =
    readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl) ||
    chainConfig.rpcUrl;
  const explorerBase = trimSlash(
    readChainEnv(chainConfig, "CHAIN_EXPLORER_URL", chainConfig.explorerUrl) ||
      chainConfig.explorerUrl
  );
  const chain = buildViemChain(chainConfig, rpcUrl, chainId);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const journal = getContract({
    abi: tradingJournalAbi,
    address,
    client: publicClient,
  });
  const nextRecordId = await journal.read.nextRecordId();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const start =
    nextRecordId > BigInt(safeLimit) ? nextRecordId - BigInt(safeLimit) : 0n;
  const ids = rangeBigInt(start, nextRecordId).reverse();
  const txByRecordId = await readRecordLogTxs({
    address,
    chain: chainConfig,
    publicClient,
  });
  const records = await Promise.all(
    ids.map(async (recordId): Promise<StrategyRunRecord> => {
      const record = await journal.read.getRecord([recordId]);
      const txHash = txByRecordId.get(recordId.toString());

      return {
        action: normalizeAction(record.action),
        agentId: record.agentId.toString(),
        chain: chainConfig.id,
        chainId,
        chainName: chainConfig.name,
        createdAt: new Date(Number(record.createdAt) * 1000).toISOString(),
        decisionHash: record.decisionHash,
        evidenceUri: record.evidenceUri,
        explorerUrl: txHash ? `${explorerBase}/tx/${txHash}` : undefined,
        market: record.market,
        pnlBps: Number(record.pnlBps),
        recordId: recordId.toString(),
        recorder: record.recorder,
        resultHash: record.resultHash,
        runId: record.runId,
        status: normalizeStatus(record.status),
        strategyId: record.strategyId,
        txHash,
      };
    })
  );

  return {
    chain: chainConfig.id,
    chainId,
    chainName: chainConfig.name,
    configured: true,
    journalAddress: address,
    nextRecordId: nextRecordId.toString(),
    records,
  };
}

type ReceiptPollingClient = {
  getTransactionReceipt: (args: {
    hash: Hex;
  }) => Promise<{ status: "success" | "reverted" } | null | undefined>;
};

export async function waitForSubmittedTransactionReceipt({
  publicClient,
  txHash,
  attempts = readPositiveInt(
    process.env.MANTLE_CHAIN_RECEIPT_POLL_ATTEMPTS,
    defaultReceiptPollAttempts
  ),
  intervalMs = readPositiveInt(
    process.env.MANTLE_CHAIN_RECEIPT_POLL_INTERVAL_MS,
    defaultReceiptPollIntervalMs
  ),
}: {
  publicClient: ReceiptPollingClient;
  txHash: Hex;
  attempts?: number;
  intervalMs?: number;
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

      if (receipt) {
        return receipt;
      }
    } catch (error) {
      if (!isTransactionReceiptMissingError(error)) {
        throw error;
      }
    }

    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  return undefined;
}

async function readRecordLogTxs({
  address,
  chain,
  publicClient,
}: {
  address: Address;
  chain: ProductChainConfig;
  publicClient: StrategyLogReaderClient;
}) {
  const txByRecordId = new Map<string, string>();

  try {
    const logs = await publicClient.getLogs({
      address,
      event: strategyRecordEvent,
      fromBlock: readJournalDeployBlock(chain),
      toBlock: "latest",
    });

    for (const log of logs) {
      const recordId = log.args?.recordId?.toString();

      if (recordId && log.transactionHash) {
        txByRecordId.set(recordId, log.transactionHash);
      }
    }
  } catch {
    return txByRecordId;
  }

  return txByRecordId;
}

type StrategyLogReaderClient = {
  getLogs: (args: {
    address: Address;
    event: typeof strategyRecordEvent;
    fromBlock: bigint;
    toBlock: "latest";
  }) => Promise<
    Array<{
      args?: {
        recordId?: bigint;
      };
      transactionHash?: Hex;
    }>
  >;
};

function buildPreparedProof({
  action,
  agentId,
  chainConfig,
  chainId,
  decisionHash,
  error,
  evidenceUri,
  journalAddress,
  pnlBps,
  resultHash,
  status,
}: PersistTradingJournalInput & {
  agentId: bigint;
  chainConfig: ProductChainConfig;
  chainId: number;
  error: string;
  journalAddress?: string;
}): TradingJournalProof {
  return {
    action,
    agentId: agentId.toString(),
    chain: chainConfig.id,
    chainId,
    chainName: chainConfig.name,
    decisionHash,
    error,
    evidenceUri,
    journalAddress,
    pnlBps,
    resultHash,
    status: "prepared",
    strategyStatus: status,
  };
}

function buildViemChain(
  chainConfig: ProductChainConfig,
  rpcUrl: string,
  chainId: number
) {
  if (chainConfig.id === "celo" && chainId === 42220) {
    return {
      ...viemCelo,
      rpcUrls: {
        default: {
          http: [rpcUrl],
        },
      },
    };
  }

  return defineChain({
    id: chainId,
    name: chainConfig.name,
    nativeCurrency: chainConfig.nativeCurrency,
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
  });
}

function withCeloFeeCurrency<T extends Record<string, unknown>>(
  chainConfig: ProductChainConfig,
  request: T
): T {
  if (chainConfig.id !== "celo" || !chainConfig.billingCurrency.feeCurrencyAddress) {
    return request;
  }

  return {
    ...request,
    feeCurrency: chainConfig.billingCurrency.feeCurrencyAddress,
  } as T;
}

function readPrivateKey(chain: ProductChainConfig): Hex | undefined {
  const raw =
    readChainEnv(chain, "AGENT_PRIVATE_KEY") ||
    readChainEnv(chain, "PRIVATE_KEY");

  if (!raw) {
    return undefined;
  }

  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;

  return /^0x[a-fA-F0-9]{64}$/.test(prefixed) ? (prefixed as Hex) : undefined;
}

function readAgentId(chain: ProductChainConfig) {
  const raw =
    readChainEnv(chain, "SELF_AGENT_ID") ||
    readChainEnv(chain, "ERC8004_AGENT_ID") ||
    process.env.LANGCLAW_AGENT_ID?.trim() ||
    "0";

  return /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

function readChainId(chain: ProductChainConfig) {
  const parsed = Number.parseInt(
    readChainEnv(chain, "CHAIN_ID", String(chain.chainId)) || "",
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : chain.chainId;
}

function readJournalDeployBlock(chain: ProductChainConfig) {
  const parsed = Number.parseInt(
    readChainEnv(chain, "TRADING_JOURNAL_DEPLOY_BLOCK") || "",
    10
  );

  return BigInt(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
}

function readJournalAddress(chain: ProductChainConfig) {
  return readChainEnv(chain, "LANGCLAW_TRADING_JOURNAL_ADDRESS");
}

function normalizeAction(value: string): StrategyAction {
  return value === "buy" || value === "sell" || value === "exit" ? value : "hold";
}

function normalizeStatus(value: string): StrategyRecordStatus {
  if (
    value === "backtested" ||
    value === "paper-opened" ||
    value === "paper-closed"
  ) {
    return value;
  }

  return "backtested";
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTransactionReceiptMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes("Transaction receipt with hash") &&
    message.includes("could not be found")
  );
}

function rangeBigInt(start: bigint, end: bigint) {
  const values: bigint[] = [];

  for (let value = start; value < end; value += 1n) {
    values.push(value);
  }

  return values;
}

function sanitizeError(message: string) {
  return message
    .replace(/0x[a-fA-F0-9]{64}/g, "0x[redacted-private-key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}
