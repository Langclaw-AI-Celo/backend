import {
  createPublicClient,
  getAddress,
  getContract,
  http,
  isAddress,
  parseAbiItem,
  type Address,
} from "viem";
import {
  getProductChain,
  readChainEnv,
  readProductChainId,
} from "../lib/chain-config";
import { buildProofReadinessReport } from "../lib/proof-readiness";

type ProofDecision = {
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

export async function handleProofDecisions(request: Request) {
  let limit = 20;
  let chain = getProductChain("mantle");

  try {
    const body = await request.json().catch(() => ({}));
    chain = getProductChain(readProductChainId((body as { chain?: unknown }).chain));
    const requestedLimit =
      body && typeof body === "object" && "limit" in body
        ? Number((body as { limit?: unknown }).limit)
        : limit;

    if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
      limit = Math.min(Math.trunc(requestedLimit), 100);
    }
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const registryAddress = readChainEnv(chain, "LANGCLAW_REGISTRY_ADDRESS");

  if (!registryAddress || !isAddress(registryAddress)) {
    return Response.json(
      { error: "LANGCLAW_REGISTRY_ADDRESS is not configured." },
      { status: 503 }
    );
  }

  const address = getAddress(registryAddress);
  const rpcUrl = readChainEnv(chain, "CHAIN_RPC_URL", chain.rpcUrl) || chain.rpcUrl;
  const chainId = readChainId(chain);
  const explorerBase = trimSlash(
    readChainEnv(chain, "CHAIN_EXPLORER_URL", chain.explorerUrl) ||
      chain.explorerUrl
  );
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });
  const registry = getContract({
    abi: registryAbi,
    address,
    client: publicClient,
  });

  const nextDecisionId = await registry.read.nextDecisionId();
  const start =
    nextDecisionId > BigInt(limit) ? nextDecisionId - BigInt(limit) : 0n;
  const ids = rangeBigInt(start, nextDecisionId).reverse();
  const logTxByDecisionId = await readDecisionLogTxs({
    address,
    chain,
    publicClient,
  });

  const decisions = await Promise.all(
    ids.map(async (decisionId): Promise<ProofDecision> => {
      const decision = await registry.read.getDecision([decisionId]);
      const txHash = logTxByDecisionId.get(decisionId.toString());

      return {
        agentId: decision.agentId.toString(),
        createdAt: new Date(Number(decision.createdAt) * 1000).toISOString(),
        decisionHash: decision.decisionHash,
        decisionId: decisionId.toString(),
        evidenceUri: decision.evidenceUri,
        explorerUrl: txHash ? `${explorerBase}/tx/${txHash}` : undefined,
        recorder: decision.recorder,
        runId: decision.runId,
        signalType: decision.signalType,
        txHash,
      };
    })
  );

  return Response.json({
    chain: chain.id,
    chainId,
    chainName: chain.name,
    configured: true,
    decisions,
    nativeSymbol: chain.nativeCurrency.symbol,
    nextDecisionId: nextDecisionId.toString(),
    registryAddress: address,
  });
}

export async function handleProofReadiness(request: Request) {
  let body: { chain?: unknown } = {};

  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const report = await buildProofReadinessReport({
    chain: body.chain,
  });

  return Response.json(report, {
    status: report.ready ? 200 : 503,
  });
}

async function readDecisionLogTxs({
  address,
  chain,
  publicClient,
}: {
  address: Address;
  chain: ReturnType<typeof getProductChain>;
  publicClient: ReturnType<typeof createPublicClient>;
}) {
  const txByDecisionId = new Map<string, string>();

  try {
    const logs = await publicClient.getLogs({
      address,
      event: decisionRecordedEvent,
      fromBlock: readRegistryDeployBlock(address, chain),
      toBlock: "latest",
    });

    for (const log of logs) {
      const decisionId = log.args.decisionId?.toString();

      if (decisionId && log.transactionHash) {
        txByDecisionId.set(decisionId, log.transactionHash);
      }
    }
  } catch {
    return txByDecisionId;
  }

  return txByDecisionId;
}

function readRegistryDeployBlock(
  address: Address,
  chain: ReturnType<typeof getProductChain>
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

  return chain.id === "mantle" && address.toLowerCase() ===
    "0xe69755e4249c4978c39fbe847ca9674ce7af3505"
    ? 95522244n
    : 0n;
}

function rangeBigInt(start: bigint, end: bigint) {
  const values: bigint[] = [];

  for (let value = start; value < end; value += 1n) {
    values.push(value);
  }

  return values;
}

function readChainId(chain: ReturnType<typeof getProductChain>) {
  const parsed = Number.parseInt(
    readChainEnv(chain, "CHAIN_ID", String(chain.chainId)) || "",
    10
  );

  return Number.isFinite(parsed) && parsed > 0 ? parsed : chain.chainId;
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}
