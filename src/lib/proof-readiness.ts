import {
  createPublicClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  readPreferredAgentConfig,
  type PreferredAgentConfig,
} from "./agent-id";
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
    explorerUrl?: string;
    recorder: string;
    runId: string;
    signalType: string;
    txHash?: string;
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
  getLogs?: (args: {
    address: Address;
    event: typeof decisionRecordedEvent;
    fromBlock: bigint;
    toBlock: "latest";
  }) => Promise<Array<{ args?: { decisionId?: bigint | string }; transactionHash?: Hex }>>;
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

const decisionRecordedEvent = parseAbiItem(
  "event AgentDecisionRecorded(uint256 indexed decisionId,uint256 indexed agentId,address indexed recorder,bytes32 decisionHash,string runId,string evidenceUri,string signalType)"
);

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
  const preferredAgent = readPreferredAgentConfig(chain);
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
    label: preferredAgent.label,
    status: preferredAgent.id > 0n ? "pass" : "fail",
    summary: preferredAgent.id > 0n
      ? preferredAgent.source === "self"
        ? `Preferred proof agent is Self Agent ID ${preferredAgent.id.toString()}.`
        : preferredAgent.source === "legacy"
          ? `Preferred proof agent falls back to legacy LANGCLAW_AGENT_ID ${preferredAgent.id.toString()}.`
          : `Preferred proof agent is ERC-8004 agent ID ${preferredAgent.id.toString()}.`
      : `Set ${chain.envPrefix}_ERC8004_AGENT_ID before relying on ${chain.name} proof readiness. ${chain.envPrefix}_SELF_AGENT_ID remains the fallback for Self-linked proof flows.`,
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
        expectedRecorder: account?.address,
        preferredAgent,
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
  expectedRecorder,
  preferredAgent,
  chain,
  checks,
  client,
  registryAddress,
}: {
  expectedRecorder?: Address;
  preferredAgent: PreferredAgentConfig;
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
    const txHash = await readDecisionTxHash({
      address: registryAddress,
      chain,
      client,
      decisionId: latestDecisionId,
    });
    const explorerBase = trimSlash(
      readChainEnv(chain, "CHAIN_EXPLORER_URL", chain.explorerUrl) || chain.explorerUrl
    );
    const latestDecision = {
      agentId: decision.agentId.toString(),
      createdAt: new Date(Number(decision.createdAt) * 1000).toISOString(),
      decisionHash: decision.decisionHash,
      decisionId: latestDecisionId.toString(),
      evidenceUri: decision.evidenceUri,
      explorerUrl: txHash ? `${explorerBase}/tx/${txHash}` : undefined,
      recorder: decision.recorder,
      runId: decision.runId,
      signalType: decision.signalType,
      txHash,
    };
    const matchesAgent =
      preferredAgent.id === 0n || decision.agentId === preferredAgent.id;
    const expectedAgentSummary =
      preferredAgent.source === "self"
        ? `preferred Self Agent ID ${preferredAgent.id.toString()}`
        : `configured ERC-8004 agent ${preferredAgent.id.toString()}`;

    addCheck(checks, {
      id: "latest-decision",
      label: "Latest proof decision",
      status: matchesAgent ? "pass" : "warn",
      summary: matchesAgent
        ? `Latest decision ${latestDecisionId.toString()} belongs to ${expectedAgentSummary}.`
        : `Latest decision ${latestDecisionId.toString()} belongs to agent ${decision.agentId.toString()}, not ${expectedAgentSummary}.`,
      detail: latestDecision,
    });

    if (expectedRecorder) {
      const matchesRecorder =
        isAddress(decision.recorder) &&
        getAddress(decision.recorder) === getAddress(expectedRecorder);

      addCheck(checks, {
        id: "latest-decision-recorder",
        label: "Latest proof recorder",
        status: matchesRecorder ? "pass" : "warn",
        summary: matchesRecorder
          ? `Latest decision ${latestDecisionId.toString()} was recorded by the configured recorder ${expectedRecorder}.`
          : `Latest decision ${latestDecisionId.toString()} was recorded by ${decision.recorder}, not the configured recorder ${expectedRecorder}.`,
        detail: {
          actualRecorder: decision.recorder,
          expectedRecorder,
        },
      });
    }

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

async function readDecisionTxHash({
  address,
  chain,
  client,
  decisionId,
}: {
  address: Address;
  chain: ProductChainConfig;
  client: ProofReadinessClient;
  decisionId: bigint;
}) {
  if (!client.getLogs) {
    return undefined;
  }

  try {
    const logs = await client.getLogs({
      address,
      event: decisionRecordedEvent,
      fromBlock: readRegistryDeployBlock(address, chain),
      toBlock: "latest",
    });

    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const log = logs[index];
      if (String(log.args?.decisionId ?? "") === decisionId.toString()) {
        return log.transactionHash;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
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

function readRegistryDeployBlock(
  address: Address,
  chain: ProductChainConfig
) {
  const configured = BigInt(
    Math.max(
      0,
      Number.parseInt(
        readChainEnv(chain, "REGISTRY_DEPLOY_BLOCK") ||
          readChainEnv(chain, "CHAIN_DEPLOY_BLOCK") ||
          "",
        10
      ) || 0
    )
  );

  if (configured > 0n) {
    return configured;
  }

  const normalizedAddress = address.toLowerCase();

  if (normalizedAddress === "0xe69755e4249c4978c39fbe847ca9674ce7af3505") {
    if (chain.id === "mantle") {
      return 95522244n;
    }

    if (chain.id === "celo") {
      return 67836343n;
    }
  }

  return 0n;
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

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function readError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
