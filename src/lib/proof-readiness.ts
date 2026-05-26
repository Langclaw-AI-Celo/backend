import {
  createPublicClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  getProductChain,
  readChainEnv,
  readProductChainId,
  type ProductChainConfig,
  type ProductChainId,
} from "./chain-config";

type ReadinessCheckStatus = "pass" | "warn" | "fail";

export type ProofReadinessCheck = {
  detail?: Record<string, unknown>;
  id: string;
  label: string;
  status: ReadinessCheckStatus;
  summary: string;
};

export type ProofReadinessReport = {
  chain: ProductChainId;
  chainId: number;
  chainName: string;
  checks: ProofReadinessCheck[];
  latestDecision?: {
    agentId: string;
    createdAt: string;
    decisionHash: string;
    decisionId: string;
    evidenceUri: string;
    recorder: string;
    runId: string;
    signalType: string;
  };
  nativeSymbol: string;
  ready: boolean;
  recorder?: {
    address: string;
    balance: string;
    balanceWei: string;
  };
  registryAddress?: string;
  rpcUrl: string;
  status: "ready" | "warning" | "not_ready";
};

type ProofReadinessClient = {
  getBalance: (args: { address: Address }) => Promise<bigint>;
  getBlockNumber: () => Promise<bigint>;
  getChainId: () => Promise<number>;
  readContract: (args: {
    abi: typeof registryAbi;
    address: Address;
    args?: readonly unknown[];
    functionName: "nextDecisionId" | "getDecision";
  }) => Promise<unknown>;
};

type ProofReadinessOptions = {
  chain?: unknown;
  publicClient?: ProofReadinessClient;
};

const registryAbi = [
  {
    inputs: [],
    name: "nextDecisionId",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "decisionId", type: "uint256" }],
    name: "getDecision",
    outputs: [
      {
        components: [
          { name: "agentId", type: "uint256" },
          { name: "runId", type: "string" },
          { name: "decisionHash", type: "bytes32" },
          { name: "evidenceUri", type: "string" },
          { name: "signalType", type: "string" },
          { name: "recorder", type: "address" },
          { name: "createdAt", type: "uint256" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export async function buildProofReadinessReport({
  chain: chainInput,
  publicClient,
}: ProofReadinessOptions = {}): Promise<ProofReadinessReport> {
  const chain = getProductChain(readProductChainId(chainInput));
  const chainId = readConfiguredChainId(chain);
  const rpcUrl = readChainEnv(chain, "CHAIN_RPC_URL", chain.rpcUrl) || chain.rpcUrl;
  const checks: ProofReadinessCheck[] = [];
  const chainEnabled = readChainEnv(chain, "CHAIN_ENABLED") === "true";
  const proofEnabled = readChainEnv(chain, "INTEL_PROOF_ENABLED") === "true";
  const privateKey = readProofPrivateKey(chain);
  const agentId = readProofAgentId(chain);
  const registryAddress = readProofRegistryAddress(chain);
  let recorder: ProofReadinessReport["recorder"];
  let latestDecision: ProofReadinessReport["latestDecision"];

  addCheck(checks, {
    id: "chain-enabled",
    label: `${chain.envPrefix}_CHAIN_ENABLED`,
    status: chainEnabled ? "pass" : "fail",
    summary: chainEnabled
      ? `${chain.envPrefix}_CHAIN_ENABLED is true.`
      : `Set ${chain.envPrefix}_CHAIN_ENABLED=true so proof writes can anchor on ${chain.name}.`,
  });

  addCheck(checks, {
    id: "onchain-tool-proof-enabled",
    label: `${chain.envPrefix}_INTEL_PROOF_ENABLED`,
    status: proofEnabled ? "pass" : "warn",
    summary: proofEnabled
      ? `${chain.envPrefix}_INTEL_PROOF_ENABLED is true for direct on-chain tool proof payloads.`
      : `Set ${chain.envPrefix}_INTEL_PROOF_ENABLED=true if the demo uses direct on-chain tool mode. Langclaw workflow proof still uses ${chain.envPrefix}_CHAIN_ENABLED.`,
  });

  addCheck(checks, {
    id: "agent-private-key",
    label: `${chain.envPrefix}_AGENT_PRIVATE_KEY`,
    status: privateKey ? "pass" : "fail",
    summary: privateKey
      ? "Agent private key is present and has a valid hex shape."
      : `Set ${chain.envPrefix}_AGENT_PRIVATE_KEY or ${chain.envPrefix}_PRIVATE_KEY with the proof recorder key.`,
  });

  const account = privateKey ? privateKeyToAccount(privateKey) : undefined;

  addCheck(checks, {
    id: "erc8004-agent-id",
    label: `${chain.envPrefix}_ERC8004_AGENT_ID`,
    status: agentId > 0n ? "pass" : "fail",
    summary: agentId > 0n
      ? `Agent ID ${agentId.toString()} is configured.`
      : `Set ${chain.envPrefix}_ERC8004_AGENT_ID to the registered ERC-8004 agent id.`,
  });

  addCheck(checks, {
    id: "registry-address",
    label: `${chain.envPrefix}_LANGCLAW_REGISTRY_ADDRESS`,
    status: registryAddress && isAddress(registryAddress) ? "pass" : "fail",
    summary:
      registryAddress && isAddress(registryAddress)
        ? "LangclawRegistry address is configured and valid."
        : `Set ${chain.envPrefix}_LANGCLAW_REGISTRY_ADDRESS to a valid LangclawRegistry address.`,
    detail: registryAddress ? { registryAddress } : undefined,
  });

  addCheck(checks, {
    id: "rpc-url",
    label: `${chain.envPrefix}_CHAIN_RPC_URL`,
    status: rpcUrl ? "pass" : "fail",
    summary: rpcUrl
      ? `${chain.name} RPC URL is configured.`
      : `Set ${chain.envPrefix}_CHAIN_RPC_URL.`,
    detail: rpcUrl ? { rpcUrl } : undefined,
  });

  if (rpcUrl) {
    const client = publicClient ?? createReadinessClient(chain, rpcUrl, chainId);

    await checkRpc({
      chain,
      chainId,
      checks,
      client,
    });

    if (account) {
      recorder = await checkRecorderBalance({
        accountAddress: account.address,
        chain,
        checks,
        client,
      });
    }

    if (registryAddress && isAddress(registryAddress)) {
      latestDecision = await checkRegistry({
        agentId,
        chain,
        checks,
        client,
        registryAddress: getAddress(registryAddress),
      });
    }
  }

  const status = summarizeStatus(checks);

  return {
    chain: chain.id,
    chainId,
    chainName: chain.name,
    checks,
    latestDecision,
    nativeSymbol: chain.nativeCurrency.symbol,
    ready: status !== "not_ready",
    recorder,
    registryAddress: registryAddress && isAddress(registryAddress)
      ? getAddress(registryAddress)
      : registryAddress || undefined,
    rpcUrl,
    status,
  };
}

function createReadinessClient(
  chain: ProductChainConfig,
  rpcUrl: string,
  chainId: number
): ProofReadinessClient {
  return createPublicClient({
    chain: defineChain({
      id: chainId,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: {
        default: {
          http: [rpcUrl],
        },
      },
    }),
    transport: http(rpcUrl),
  }) as unknown as ProofReadinessClient;
}

async function checkRpc({
  chain,
  chainId,
  checks,
  client,
}: {
  chain: ProductChainConfig;
  chainId: number;
  checks: ProofReadinessCheck[];
  client: ProofReadinessClient;
}) {
  try {
    const liveChainId = await client.getChainId();
    const blockNumber = await client.getBlockNumber();

    addCheck(checks, {
      id: "rpc-chain-id",
      label: "RPC chain id",
      status: liveChainId === chainId ? "pass" : "fail",
      summary: liveChainId === chainId
        ? `RPC returned expected chain id ${chainId}.`
        : `RPC returned chain id ${liveChainId}, expected ${chainId}.`,
      detail: {
        blockNumber: blockNumber.toString(),
        liveChainId,
      },
    });
  } catch (error) {
    addCheck(checks, {
      id: "rpc-chain-id",
      label: "RPC chain id",
      status: "fail",
      summary: `Unable to read ${chain.name} RPC chain id: ${readError(error)}`,
    });
  }
}

async function checkRecorderBalance({
  accountAddress,
  chain,
  checks,
  client,
}: {
  accountAddress: Address;
  chain: ProductChainConfig;
  checks: ProofReadinessCheck[];
  client: ProofReadinessClient;
}) {
  try {
    const balance = await client.getBalance({ address: accountAddress });
    const formatted = `${formatEther(balance)} ${chain.nativeCurrency.symbol}`;

    addCheck(checks, {
      id: "recorder-balance",
      label: "Recorder gas balance",
      status: balance > 0n ? "pass" : "fail",
      summary: balance > 0n
        ? `Recorder ${accountAddress} has ${formatted}.`
        : `Recorder ${accountAddress} has 0 ${chain.nativeCurrency.symbol}; fund it before recording proof.`,
      detail: {
        address: accountAddress,
        balance: formatted,
        balanceWei: balance.toString(),
      },
    });

    return {
      address: accountAddress,
      balance: formatted,
      balanceWei: balance.toString(),
    };
  } catch (error) {
    addCheck(checks, {
      id: "recorder-balance",
      label: "Recorder gas balance",
      status: "fail",
      summary: `Unable to read recorder gas balance: ${readError(error)}`,
      detail: {
        address: accountAddress,
      },
    });
  }
}

async function checkRegistry({
  agentId,
  chain,
  checks,
  client,
  registryAddress,
}: {
  agentId: bigint;
  chain: ProductChainConfig;
  checks: ProofReadinessCheck[];
  client: ProofReadinessClient;
  registryAddress: Address;
}) {
  try {
    const nextDecisionId = await client.readContract({
      abi: registryAbi,
      address: registryAddress,
      functionName: "nextDecisionId",
    }) as bigint;

    addCheck(checks, {
      id: "registry-readable",
      label: "LangclawRegistry readable",
      status: "pass",
      summary: `LangclawRegistry is readable. nextDecisionId is ${nextDecisionId.toString()}.`,
      detail: {
        nextDecisionId: nextDecisionId.toString(),
        registryAddress,
      },
    });

    if (nextDecisionId === 0n) {
      addCheck(checks, {
        id: "latest-decision",
        label: "Latest proof decision",
        status: "warn",
        summary: "Registry has no recorded decisions yet. Record one before the final demo if you need proof history.",
      });
      return undefined;
    }

    const latestDecisionId = nextDecisionId - 1n;
    const decision = normalizeDecision(await client.readContract({
      abi: registryAbi,
      address: registryAddress,
      args: [latestDecisionId],
      functionName: "getDecision",
    }));
    const latestDecision = {
      agentId: decision.agentId.toString(),
      createdAt: new Date(Number(decision.createdAt) * 1000).toISOString(),
      decisionHash: decision.decisionHash,
      decisionId: latestDecisionId.toString(),
      evidenceUri: decision.evidenceUri,
      recorder: decision.recorder,
      runId: decision.runId,
      signalType: decision.signalType,
    };
    const matchesAgent = agentId === 0n || decision.agentId === agentId;

    addCheck(checks, {
      id: "latest-decision",
      label: "Latest proof decision",
      status: matchesAgent ? "pass" : "warn",
      summary: matchesAgent
        ? `Latest decision ${latestDecisionId.toString()} belongs to configured agent ${decision.agentId.toString()}.`
        : `Latest decision ${latestDecisionId.toString()} belongs to agent ${decision.agentId.toString()}, not configured agent ${agentId.toString()}.`,
      detail: latestDecision,
    });

    return latestDecision;
  } catch (error) {
    addCheck(checks, {
      id: "registry-readable",
      label: "LangclawRegistry readable",
      status: "fail",
      summary: `Unable to read LangclawRegistry on ${chain.name}: ${readError(error)}`,
      detail: {
        registryAddress,
      },
    });
  }
}

function normalizeDecision(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const decision = value as Record<string, unknown>;

    return {
      agentId: BigInt(String(decision.agentId ?? "0")),
      createdAt: BigInt(String(decision.createdAt ?? "0")),
      decisionHash: String(decision.decisionHash ?? ""),
      evidenceUri: String(decision.evidenceUri ?? ""),
      recorder: String(decision.recorder ?? ""),
      runId: String(decision.runId ?? ""),
      signalType: String(decision.signalType ?? ""),
    };
  }

  const decision = value as readonly unknown[];

  return {
    agentId: BigInt(String(decision?.[0] ?? "0")),
    runId: String(decision?.[1] ?? ""),
    decisionHash: String(decision?.[2] ?? ""),
    evidenceUri: String(decision?.[3] ?? ""),
    signalType: String(decision?.[4] ?? ""),
    recorder: String(decision?.[5] ?? ""),
    createdAt: BigInt(String(decision?.[6] ?? "0")),
  };
}

function readProofPrivateKey(chain: ProductChainConfig): Hex | undefined {
  const raw =
    readChainEnv(chain, "AGENT_PRIVATE_KEY") ||
    readChainEnv(chain, "PRIVATE_KEY");

  if (!raw) {
    return undefined;
  }

  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;

  return /^0x[a-fA-F0-9]{64}$/.test(prefixed) ? (prefixed as Hex) : undefined;
}

function readProofAgentId(chain: ProductChainConfig) {
  const raw =
    readChainEnv(chain, "SELF_AGENT_ID") ||
    readChainEnv(chain, "ERC8004_AGENT_ID") ||
    process.env.LANGCLAW_AGENT_ID?.trim() ||
    "0";

  return /^\d+$/.test(raw) ? BigInt(raw) : 0n;
}

function readProofRegistryAddress(chain: ProductChainConfig) {
  return (
    readChainEnv(chain, "LANGCLAW_REGISTRY_ADDRESS") ||
    (chain.id === "mantle" ? process.env.LANGCLAW_REGISTRY_ADDRESS?.trim() : "")
  );
}

function readConfiguredChainId(chain: ProductChainConfig) {
  const parsed = Number.parseInt(
    readChainEnv(chain, "CHAIN_ID", String(chain.chainId)) || "",
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : chain.chainId;
}

function addCheck(checks: ProofReadinessCheck[], check: ProofReadinessCheck) {
  checks.push(check);
}

function summarizeStatus(checks: ProofReadinessCheck[]) {
  if (checks.some((check) => check.status === "fail")) {
    return "not_ready" as const;
  }

  if (checks.some((check) => check.status === "warn")) {
    return "warning" as const;
  }

  return "ready" as const;
}

function readError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
