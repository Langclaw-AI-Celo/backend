import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  keccak256,
  stringToHex,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo as viemCelo } from "viem/chains";

import {
  getProductChain,
  readChainEnv,
  resolveProductChain,
  type ProductChainId,
  type ProductChainConfig,
} from "../chain-config";
import { sanitizeError } from "./openclaw-runner";
import type {
  AgentOutputs,
  DiscoverSignals,
  FinalAnswer,
  FinalConclusion,
  OrchestrationStep,
  ProviderError,
  ResearchReport,
  SourceCard,
  WorkflowChainContext,
  AlphaSignal,
  ZeroGChainProof,
  ZeroGProof,
  ZeroGStorageProof,
} from "./types";

type PersistProofInput = {
  chain?: ProductChainId;
  runId: string;
  topic: string;
  generatedAt: string;
  chainContext: WorkflowChainContext;
  sources: SourceCard[];
  errors: ProviderError[];
  steps: OrchestrationStep[];
  signals: DiscoverSignals;
  report?: ResearchReport;
  finalConclusion: FinalConclusion;
  finalAnswer: FinalAnswer;
  agentOutputs: AgentOutputs;
  alphaSignal?: AlphaSignal;
};

type PersistGenericProductProofInput = {
  chain?: ProductChainId;
  evidence: Record<string, unknown>;
  generatedAt: string;
  runId: string;
  signalType?: string;
  topic: string;
};

const defaultReceiptPollAttempts = 12;
const defaultReceiptPollIntervalMs = 5000;

const langclawRegistryAbi = [
  {
    type: "function",
    name: "recordAgentDecision",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "runId", type: "string" },
      { name: "decisionHash", type: "bytes32" },
      { name: "evidenceUri", type: "string" },
      { name: "signalType", type: "string" },
    ],
    outputs: [{ name: "decisionId", type: "uint256" }],
  },
] as const;

const erc8004ReputationRegistryAbi = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "bytes32" },
      { name: "tag2", type: "bytes32" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export async function persistLangclawProof(
  input: PersistProofInput
): Promise<ZeroGProof> {
  const chainConfig = resolveProductChain(input.chain);
  const evidenceBundle = buildEvidenceBundle(input);
  const canonicalBundle = stableStringify(evidenceBundle);
  const decisionHash = keccak256(toBytes(canonicalBundle));
  const storage = prepareEvidenceBundle({
    decisionHash,
    runId: input.runId,
  });
  const chainProof = await anchorAgentDecision({
    chain: chainConfig.id,
    decisionHash,
    evidenceUri: storage.evidenceUri,
    runId: input.runId,
    signalType: inferSignalType(input.topic, chainConfig),
  });

  return {
    storage,
    chain: chainProof,
  };
}

export async function persistGenericProductProof({
  chain: chainInput = "celo",
  evidence,
  generatedAt,
  runId,
  signalType,
  topic,
}: PersistGenericProductProofInput): Promise<ZeroGProof> {
  const chainConfig = resolveProductChain(chainInput);
  const evidenceBundle = {
    schema: "langclaw.onchain-tools.evidence.v1",
    runId,
    topic,
    generatedAt,
    ...evidence,
  };
  const canonicalBundle = stableStringify(evidenceBundle);
  const decisionHash = keccak256(toBytes(canonicalBundle));
  const storage = prepareEvidenceBundle({
    decisionHash,
    runId,
  });
  const chainProof = await anchorAgentDecision({
    chain: chainConfig.id,
    decisionHash,
    evidenceUri: storage.evidenceUri,
    runId,
    signalType: signalType || inferSignalType(topic, chainConfig),
  });

  return {
    storage,
    chain: chainProof,
  };
}

function buildEvidenceBundle(input: PersistProofInput) {
  return {
    schema: "langclaw.evidence.v1",
    runId: input.runId,
    topic: input.topic,
    generatedAt: input.generatedAt,
    chainContext: input.chainContext,
    sources: input.sources,
    providerErrors: input.errors,
    orchestrationSteps: input.steps,
    signals: input.signals,
    report: input.report,
    alphaSignal: input.alphaSignal,
    agentOutputs: input.agentOutputs,
    finalConclusion: input.finalConclusion,
    finalAnswer: input.finalAnswer,
  };
}

function prepareEvidenceBundle({
  decisionHash,
  runId,
}: {
  decisionHash: Hex;
  runId: string;
}): ZeroGStorageProof {
  const baseUri =
    process.env.LANGCLAW_EVIDENCE_BASE_URI?.trim() || "langclaw://evidence";
  const evidenceUri = `${trimSlash(baseUri)}/${encodeURIComponent(runId)}/${decisionHash}`;

  return {
    status: "prepared",
    evidenceUri,
    rootHash: decisionHash,
  };
}

async function anchorAgentDecision({
  chain,
  decisionHash,
  evidenceUri,
  runId,
  signalType,
}: {
  chain: ProductChainId;
  decisionHash: Hex;
  evidenceUri: string;
  runId: string;
  signalType: string;
}): Promise<ZeroGChainProof> {
  const chainConfig = getProductChain(chain);
  const rpcUrl = readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl)!;
  const chainId = readChainId(chainConfig);
  const explorerBase = trimSlash(
    readChainEnv(chainConfig, "CHAIN_EXPLORER_URL", chainConfig.explorerUrl) ||
      chainConfig.explorerUrl
  );
  const privateKey = readPrivateKey(chainConfig);
  const registryAddress = readRegistryAddress(chainConfig);
  const agentId = readAgentId(chainConfig);
  const chainEnabled =
    readChainEnv(chainConfig, "CHAIN_ENABLED") === "true" ||
    (chainConfig.id === "celo" &&
      readChainEnv(chainConfig, "INTEL_PROOF_ENABLED") === "true");

  if (!chainEnabled) {
    return {
      status: "prepared",
      briefHash: decisionHash,
      chain: chainConfig.id,
      decisionHash,
      agentId: agentId.toString(),
      signalType,
      chainId,
      chainName: chainConfig.name,
      nativeSymbol: chainConfig.nativeCurrency.symbol,
      registryAddress,
      error: `${chainConfig.envPrefix}_CHAIN_ENABLED is not true.`,
    };
  }

  if (!privateKey) {
    return {
      status: "prepared",
      briefHash: decisionHash,
      chain: chainConfig.id,
      decisionHash,
      agentId: agentId.toString(),
      signalType,
      chainId,
      chainName: chainConfig.name,
      nativeSymbol: chainConfig.nativeCurrency.symbol,
      registryAddress,
      error: `Set ${chainConfig.envPrefix}_AGENT_PRIVATE_KEY to record the agent decision.`,
    };
  }

  if (!registryAddress || !isAddress(registryAddress)) {
    return {
      status: "prepared",
      briefHash: decisionHash,
      chain: chainConfig.id,
      decisionHash,
      agentId: agentId.toString(),
      signalType,
      chainId,
      chainName: chainConfig.name,
      nativeSymbol: chainConfig.nativeCurrency.symbol,
      registryAddress,
      error: `Set ${chainConfig.envPrefix}_LANGCLAW_REGISTRY_ADDRESS to the deployed LangclawRegistry address.`,
    };
  }

  const address = getAddress(registryAddress) as Address;
  let submittedTxHash: Hex | undefined;
  let submittedExplorerUrl: string | undefined;

  try {
    const account = privateKeyToAccount(privateKey);
    const viemChain = buildViemChain(chainConfig, rpcUrl, chainId);
    const publicClient = createPublicClient({
      chain: viemChain,
      transport: http(rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain: viemChain,
      transport: http(rpcUrl),
    });
    const { request, result: decisionId } = await publicClient.simulateContract({
      address,
      abi: langclawRegistryAbi,
      functionName: "recordAgentDecision",
      args: [agentId, runId, decisionHash, evidenceUri, signalType],
      account,
    });
    const txHash = await writeContractWithCeloFeeFallback({
      chainConfig,
      request,
      walletClient: walletClient as unknown as WriteContractClient,
    });
    const explorerUrl = `${explorerBase}/tx/${txHash}`;
    submittedTxHash = txHash;
    submittedExplorerUrl = explorerUrl;
    const receipt = await waitForSubmittedTransactionReceipt({
      publicClient,
      txHash,
    });

    if (!receipt) {
      return {
        status: "pending",
        briefHash: decisionHash,
        chain: chainConfig.id,
        decisionHash,
        decisionId: decisionId.toString(),
        agentId: agentId.toString(),
        signalType,
        txHash,
        explorerUrl,
        registryAddress: address,
        chainId,
        chainName: chainConfig.name,
        nativeSymbol: chainConfig.nativeCurrency.symbol,
      };
    }

    if (receipt.status !== "success") {
      throw new Error(
        `${chainConfig.name} decision proof transaction ${txHash} reverted.`
      );
    }

    const reputation = await recordErc8004ReputationFeedback({
      agentId,
      chainConfig,
      chainId,
      decisionHash,
      evidenceUri,
      explorerBase,
      publicClient,
      recorderAddress: account.address,
      signalType,
      viemChain,
    });

    return {
      status: "anchored",
      briefHash: decisionHash,
      chain: chainConfig.id,
      decisionHash,
      decisionId: decisionId.toString(),
      agentId: agentId.toString(),
      signalType,
      txHash,
      explorerUrl,
      registryAddress: address,
      chainId,
      chainName: chainConfig.name,
      nativeSymbol: chainConfig.nativeCurrency.symbol,
      reputation,
    };
  } catch (error) {
    return {
      status: "failed",
      briefHash: decisionHash,
      chain: chainConfig.id,
      decisionHash,
      agentId: agentId.toString(),
      signalType,
      txHash: submittedTxHash,
      explorerUrl: submittedExplorerUrl,
      chainId,
      chainName: chainConfig.name,
      nativeSymbol: chainConfig.nativeCurrency.symbol,
      registryAddress: address,
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function recordErc8004ReputationFeedback({
  agentId,
  chainConfig,
  chainId,
  decisionHash,
  evidenceUri,
  explorerBase,
  publicClient,
  recorderAddress,
  signalType,
  viemChain,
}: {
  agentId: bigint;
  chainConfig: ProductChainConfig;
  chainId: number;
  decisionHash: Hex;
  evidenceUri: string;
  explorerBase: string;
  publicClient: any;
  recorderAddress: Address;
  signalType: string;
  viemChain: ReturnType<typeof buildViemChain>;
}) {
  if (readChainEnv(chainConfig, "ERC8004_REPUTATION_ENABLED") !== "true") {
    return undefined;
  }

  const registryAddress = readReputationRegistryAddress(chainConfig);

  if (!registryAddress || !isAddress(registryAddress)) {
    return {
      status: "prepared" as const,
      agentId: agentId.toString(),
      chainId,
      registryAddress,
      error: `Set ${chainConfig.envPrefix}_ERC8004_REPUTATION_REGISTRY_ADDRESS to the ERC-8004 Reputation Registry address.`,
    };
  }

  const feedbackPrivateKey = readReputationFeedbackPrivateKey(chainConfig);

  if (!feedbackPrivateKey) {
    return {
      status: "prepared" as const,
      agentId: agentId.toString(),
      chainId,
      registryAddress: getAddress(registryAddress),
      error: `Set ${chainConfig.envPrefix}_ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY to submit reputation feedback from a non-agent client wallet.`,
    };
  }

  const feedbackAccount = privateKeyToAccount(feedbackPrivateKey);

  if (feedbackAccount.address.toLowerCase() === recorderAddress.toLowerCase()) {
    return {
      status: "skipped" as const,
      agentId: agentId.toString(),
      chainId,
      registryAddress: getAddress(registryAddress),
      error:
        "Reputation feedback was skipped because the feedback signer matches the agent recorder wallet.",
    };
  }

  const walletClient = createWalletClient({
    account: feedbackAccount,
    chain: viemChain,
    transport: http(
      readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl) ||
        chainConfig.rpcUrl
    ),
  });
  let submittedTxHash: Hex | undefined;
  let submittedExplorerUrl: string | undefined;

  try {
    const address = getAddress(registryAddress) as Address;
    const endpoint =
      readChainEnv(chainConfig, "LANGCLAW_AGENT_WEB_URL") ||
      process.env.LANGCLAW_AGENT_WEB_URL?.trim() ||
      "https://github.com/Langclaw-AI";
    const tag1 = toBytes32Tag("decision-proof");
    const tag2 = toBytes32Tag(signalType);
    const { request } = await publicClient.simulateContract({
      address,
      abi: erc8004ReputationRegistryAbi,
      functionName: "giveFeedback",
      args: [agentId, 100n, 0, tag1, tag2, endpoint, evidenceUri, decisionHash],
      account: feedbackAccount,
    });
    const txHash = await writeContractWithCeloFeeFallback({
      chainConfig,
      request: request as Record<string, unknown>,
      walletClient: walletClient as unknown as WriteContractClient,
    });
    submittedTxHash = txHash;
    submittedExplorerUrl = `${explorerBase}/tx/${txHash}`;
    const receipt = await waitForSubmittedTransactionReceipt({
      publicClient,
      txHash,
    });

    if (!receipt) {
      return {
        status: "pending" as const,
        agentId: agentId.toString(),
        chainId,
        txHash,
        explorerUrl: submittedExplorerUrl,
        registryAddress: address,
        value: "100",
        valueDecimals: 0,
        tag1: "decision-proof",
        tag2: signalType,
      };
    }

    if (receipt.status !== "success") {
      throw new Error(
        `${chainConfig.name} ERC-8004 reputation transaction ${txHash} reverted.`
      );
    }

    return {
      status: "anchored" as const,
      agentId: agentId.toString(),
      chainId,
      txHash,
      explorerUrl: submittedExplorerUrl,
      registryAddress: address,
      value: "100",
      valueDecimals: 0,
      tag1: "decision-proof",
      tag2: signalType,
    };
  } catch (error) {
    return {
      status: "failed" as const,
      agentId: agentId.toString(),
      chainId,
      txHash: submittedTxHash,
      explorerUrl: submittedExplorerUrl,
      registryAddress: getAddress(registryAddress),
      error: sanitizeError(error instanceof Error ? error.message : String(error)),
    };
  }
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
    process.env.CELO_CHAIN_RECEIPT_POLL_ATTEMPTS ??
      process.env.MANTLE_CHAIN_RECEIPT_POLL_ATTEMPTS,
    defaultReceiptPollAttempts
  ),
  intervalMs = readPositiveInt(
    process.env.CELO_CHAIN_RECEIPT_POLL_INTERVAL_MS ??
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

function readReputationFeedbackPrivateKey(
  chain: ProductChainConfig
): Hex | undefined {
  const raw =
    readChainEnv(chain, "ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY") ||
    process.env.ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY?.trim();

  if (!raw) {
    return undefined;
  }

  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;

  return /^0x[a-fA-F0-9]{64}$/.test(prefixed) ? (prefixed as Hex) : undefined;
}

function readChainId(chain: ProductChainConfig) {
  const parsed = Number.parseInt(
    readChainEnv(chain, "CHAIN_ID", String(chain.chainId)) || "",
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : chain.chainId;
}

function readAgentId(chain: ProductChainConfig) {
  const raw =
    readChainEnv(chain, "SELF_AGENT_ID") ||
    readChainEnv(chain, "ERC8004_AGENT_ID") ||
    process.env.LANGCLAW_AGENT_ID?.trim() ||
    "0";

  if (!/^\d+$/.test(raw)) {
    return 0n;
  }

  return BigInt(raw);
}

function readReputationRegistryAddress(chain: ProductChainConfig) {
  const selfAgentId = readChainEnv(chain, "SELF_AGENT_ID");
  const fallback = selfAgentId
    ? readChainEnv(
        chain,
        "SELF_REPUTATION_REGISTRY_ADDRESS",
        chain.erc8004?.selfReputationRegistryAddress
      )
    : chain.erc8004?.reputationRegistryAddress;

  return readChainEnv(chain, "ERC8004_REPUTATION_REGISTRY_ADDRESS", fallback);
}

function inferSignalType(topic: string, chain = getProductChain("celo")) {
  if (/\b(smart[-\s]money|whale|accumulat\w*|holder|flow)\b/i.test(topic)) {
    return "smart-money";
  }

  if (/\b(liquidity|volume|pool|pair|anomal)\b/i.test(topic)) {
    return "liquidity-anomaly";
  }

  if (/\b(tvl|yield|apy|protocol|defi)\b/i.test(topic)) {
    return "tvl-yield-momentum";
  }

  if (/\b(signal|trade|trading|entry|exit|alpha)\b/i.test(topic)) {
    return "alpha-signal";
  }

  return chain.proofSignalFallback;
}

function readRegistryAddress(chain: ProductChainConfig) {
  return (
    readChainEnv(chain, "LANGCLAW_REGISTRY_ADDRESS") ||
    (chain.id === "mantle" ? process.env.LANGCLAW_REGISTRY_ADDRESS?.trim() : "")
  );
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

type WriteContractClient = {
  writeContract: (request: Record<string, unknown>) => Promise<Hex>;
};

export async function writeContractWithCeloFeeFallback<T extends Record<string, unknown>>({
  chainConfig,
  request,
  walletClient,
}: {
  chainConfig: ProductChainConfig;
  request: T;
  walletClient: WriteContractClient;
}) {
  const requestWithFeeCurrency = withCeloFeeCurrency(chainConfig, request);

  try {
    return await walletClient.writeContract(requestWithFeeCurrency);
  } catch (error) {
    if (
      !shouldRetryWithoutCeloFeeCurrency(
        chainConfig,
        requestWithFeeCurrency,
        error
      )
    ) {
      throw error;
    }

    return walletClient.writeContract(request);
  }
}

function shouldRetryWithoutCeloFeeCurrency(
  chainConfig: ProductChainConfig,
  request: Record<string, unknown>,
  error: unknown
) {
  if (chainConfig.id !== "celo" || !("feeCurrency" in request)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);

  return /fee[-\s]?currency|gas required exceeds allowance|allowance \(0\)|insufficient.+fee/i.test(
    message
  );
}

function toBytes32Tag(value: string): Hex {
  if (new TextEncoder().encode(value).length > 32) {
    return keccak256(toBytes(value));
  }

  return stringToHex(value, { size: 32 });
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const item = record[key];

        if (item !== undefined) {
          acc[key] = sortJson(item);
        }

        return acc;
      }, {});
  }

  return value;
}
