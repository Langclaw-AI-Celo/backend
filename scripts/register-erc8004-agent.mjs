import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo as viemCelo } from "viem/chains";

import {
  envPath,
  loadBackendEnv,
  normalizePrivateKey,
  parseDeployArgs,
  readChainEnv,
  readChainId,
  upsertEnvValues,
  waitForReceipt,
} from "./deploy-chain-utils.mjs";

loadBackendEnv();

const defaultIdentityRegistry = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const { selfAgentId, selfUnverified } = parseRegisterArgs();
const { chain: chainConfig, writeEnv } = parseDeployArgs();
const rpcUrl = readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl);
const chainId = readChainId(chainConfig);
const explorerBase = readChainEnv(
  chainConfig,
  "CHAIN_EXPLORER_URL",
  chainConfig.explorerUrl
).replace(/\/$/, "");
const privateKey = normalizePrivateKey(
  readChainEnv(chainConfig, "AGENT_PRIVATE_KEY", "") ||
    readChainEnv(chainConfig, "PRIVATE_KEY", "")
);
const registryEnvSuffix = selfAgentId
  ? "SELF_AGENT_REGISTRY_ADDRESS"
  : "ERC8004_IDENTITY_REGISTRY_ADDRESS";
const defaultRegistryAddress = selfAgentId
  ? chainConfig.erc8004?.selfAgentRegistryAddress
  : chainConfig.erc8004?.identityRegistryAddress ||
    process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS ||
    defaultIdentityRegistry;
const registryAddress =
  readChainEnv(chainConfig, registryEnvSuffix, defaultRegistryAddress) ||
  defaultRegistryAddress;
const agentUri =
  readChainEnv(chainConfig, "LANGCLAW_AGENT_URI", "") ||
  process.env.LANGCLAW_AGENT_URI?.trim() ||
  buildDefaultAgentUri(chainConfig, { selfAgentId });
const selfHumanProofProviderAddress = readChainEnv(
  chainConfig,
  "SELF_HUMAN_PROOF_PROVIDER_ADDRESS",
  chainConfig.erc8004?.selfHumanProofProviderAddress || ""
);
const selfHumanProof = normalizeBytes(
  readChainEnv(chainConfig, "SELF_HUMAN_PROOF") || process.env.SELF_HUMAN_PROOF
);
const selfHumanProviderData = normalizeBytes(
  readChainEnv(chainConfig, "SELF_HUMAN_PROVIDER_DATA") ||
    process.env.SELF_HUMAN_PROVIDER_DATA
);

if (!privateKey) {
  throw new Error(
    `Set ${chainConfig.envPrefix}_AGENT_PRIVATE_KEY before registering.`
  );
}

if (!registryAddress || !isAddress(registryAddress)) {
  throw new Error(
    `${chainConfig.envPrefix}_${registryEnvSuffix} is not a valid address.`
  );
}

const identityRegistryAddress = getAddress(registryAddress);
const account = privateKeyToAccount(privateKey);
const configuredAgentWallet = readChainEnv(chainConfig, "AGENT_WALLET", "");

if (
  configuredAgentWallet &&
  (!isAddress(configuredAgentWallet) ||
    getAddress(configuredAgentWallet) !== account.address)
) {
  throw new Error(
    `${chainConfig.envPrefix}_AGENT_WALLET must match ${chainConfig.envPrefix}_AGENT_PRIVATE_KEY.`
  );
}

const chain = defineChain({
  id: chainId,
  name: chainConfig.name,
  nativeCurrency: chainConfig.nativeCurrency,
  rpcUrls: {
    default: {
      http: [rpcUrl],
    },
  },
});
const viemChain =
  chainConfig.id === "celo" && chainId === 42220
    ? {
        ...viemCelo,
        rpcUrls: {
          default: {
            http: [rpcUrl],
          },
        },
      }
    : chain;
const publicClient = createPublicClient({
  chain: viemChain,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account,
  chain: viemChain,
  transport: http(rpcUrl),
});

const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "registerWithHumanProof",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentURI", type: "string" },
      { name: "proofProvider", type: "address" },
      { name: "proof", type: "bytes" },
      { name: "providerData", type: "bytes" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "Registered",
    anonymous: false,
    inputs: [
      { indexed: true, name: "agentId", type: "uint256" },
      { indexed: false, name: "agentURI", type: "string" },
      { indexed: true, name: "owner", type: "address" },
    ],
  },
];

console.log(
  selfAgentId
    ? `Registering Self Agent ID on ${chainConfig.name} (${chainId}).`
    : `Registering ERC-8004 agent on ${chainConfig.name} (${chainId}).`
);
console.log(
  `${selfAgentId ? "SelfAgentRegistry" : "IdentityRegistry"}: ${identityRegistryAddress}`
);
console.log(`Owner wallet: ${account.address}`);
console.log(
  process.env.LANGCLAW_AGENT_URI ||
    process.env[`${chainConfig.envPrefix}_LANGCLAW_AGENT_URI`]
    ? `Agent URI: ${agentUri}`
    : "Agent URI: generated data URI metadata"
);

if (selfAgentId && !selfUnverified) {
  if (!selfHumanProofProviderAddress || !isAddress(selfHumanProofProviderAddress)) {
    throw new Error(
      `Set ${chainConfig.envPrefix}_SELF_HUMAN_PROOF_PROVIDER_ADDRESS before registering a verified Self Agent ID.`
    );
  }

  if (!selfHumanProof || !selfHumanProviderData) {
    throw new Error(
      `Verified Self Agent ID registration requires ${chainConfig.envPrefix}_SELF_HUMAN_PROOF and ${chainConfig.envPrefix}_SELF_HUMAN_PROVIDER_DATA from the Self proof flow. Re-run with --self-unverified only if you intentionally want an unverified ERC-8004 record in the Self registry.`
    );
  }
}

const functionName =
  selfAgentId && !selfUnverified ? "registerWithHumanProof" : "register";
const args =
  functionName === "registerWithHumanProof"
    ? [
        agentUri,
        getAddress(selfHumanProofProviderAddress),
        selfHumanProof,
        selfHumanProviderData,
      ]
    : [agentUri];
const { request, result: simulatedAgentId } =
  await publicClient.simulateContract({
    address: identityRegistryAddress,
    abi: identityRegistryAbi,
    functionName,
    args,
    account,
  });

const hash = await walletClient.writeContract(
  withCeloFeeCurrency(chainConfig, request)
);
console.log(`Registration tx: ${hash}`);
console.log(`Explorer: ${explorerBase}/tx/${hash}`);

const receipt = await waitForReceipt(publicClient, hash);

if (receipt.status !== "success") {
  throw new Error(`Registration failed. Transaction: ${hash}`);
}

const logs = parseEventLogs({
  abi: identityRegistryAbi,
  eventName: "Registered",
  logs: receipt.logs,
});
const registered = logs[0];
const agentId =
  registered?.args?.agentId?.toString() || simulatedAgentId.toString();

console.log(`${chainConfig.envPrefix}_AGENT_WALLET=${account.address}`);

if (selfAgentId) {
  console.log(`${chainConfig.envPrefix}_SELF_AGENT_ID=${agentId}`);
  console.log(`${chainConfig.envPrefix}_SELF_AGENT_ONCHAIN_TX=${hash}`);
  console.log(
    `${chainConfig.envPrefix}_SELF_AGENT_REGISTRY_ADDRESS=${identityRegistryAddress}`
  );
} else {
  console.log(`${chainConfig.envPrefix}_ERC8004_AGENT_ID=${agentId}`);
  console.log(`${chainConfig.envPrefix}_AGENT_ONCHAIN_TX=${hash}`);
  console.log(
    `${chainConfig.envPrefix}_ERC8004_IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}`
  );
}

if (writeEnv) {
  const updates = {
    [`${chainConfig.envPrefix}_AGENT_WALLET`]: account.address,
  };

  if (selfAgentId) {
    updates[`${chainConfig.envPrefix}_SELF_AGENT_ID`] = agentId;
    updates[`${chainConfig.envPrefix}_SELF_AGENT_ONCHAIN_TX`] = hash;
    updates[`${chainConfig.envPrefix}_SELF_AGENT_REGISTRY_ADDRESS`] =
      identityRegistryAddress;
    updates[`${chainConfig.envPrefix}_SELF_HUMAN_PROOF_PROVIDER_ADDRESS`] =
      selfHumanProofProviderAddress
        ? getAddress(selfHumanProofProviderAddress)
        : "";
  } else {
    updates[`${chainConfig.envPrefix}_AGENT_ONCHAIN_TX`] = hash;
    updates[`${chainConfig.envPrefix}_ERC8004_AGENT_ID`] = agentId;
    updates[`${chainConfig.envPrefix}_ERC8004_IDENTITY_REGISTRY_ADDRESS`] =
      identityRegistryAddress;
  }

  upsertEnvValues(envPath, updates);
  console.log(`Updated ${envPath}`);
}

function parseRegisterArgs(argv = process.argv.slice(2)) {
  let selfAgentId = false;
  let selfUnverified = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--self-agent-id" || arg === "--registry=self") {
      selfAgentId = true;
      continue;
    }

    if (arg === "--registry" && argv[index + 1] === "self") {
      selfAgentId = true;
      index += 1;
      continue;
    }

    if (arg === "--self-unverified") {
      selfAgentId = true;
      selfUnverified = true;
    }
  }

  return { selfAgentId, selfUnverified };
}

function buildDefaultAgentUri(chainConfig, { selfAgentId = false } = {}) {
  const webUrl =
    process.env[`${chainConfig.envPrefix}_LANGCLAW_AGENT_WEB_URL`]?.trim() ||
    process.env.LANGCLAW_AGENT_WEB_URL?.trim() ||
    "https://github.com/Langclaw-AI";
  const walletAddress =
    process.env[`${chainConfig.envPrefix}_AGENT_WALLET`]?.trim() || undefined;
  const metadata = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name:
      process.env[`${chainConfig.envPrefix}_LANGCLAW_AGENT_NAME`]?.trim() ||
      process.env.LANGCLAW_AGENT_NAME?.trim() ||
      `Langclaw ${chainConfig.name.replace(" Mainnet", "")} Alpha Sentinel`,
    description:
      process.env[`${chainConfig.envPrefix}_LANGCLAW_AGENT_DESCRIPTION`]?.trim() ||
      process.env.LANGCLAW_AGENT_DESCRIPTION?.trim() ||
      `AI agent for ${chainConfig.name.replace(" Mainnet", "")} on-chain intelligence, smart-money monitoring, liquidity anomaly detection, and verifiable decision proof.`,
    image:
      process.env[`${chainConfig.envPrefix}_LANGCLAW_AGENT_IMAGE_URL`]?.trim() ||
      process.env.LANGCLAW_AGENT_IMAGE_URL?.trim() ||
      "https://langclaw.ai/favicon.ico",
    endpoints: [
      {
        type: "web",
        url: webUrl,
      },
    ],
    wallets: [
      {
        address: walletAddress,
        chainId: chainConfig.chainId,
        type: "evm",
      },
    ].filter((wallet) => wallet.address),
    active: true,
    supportedTrust: selfAgentId
      ? ["identity", "proof-of-human", "reputation", "validation"]
      : ["identity", "reputation", "validation"],
    selfAgentId: selfAgentId
      ? {
          registry: chainConfig.erc8004?.selfAgentRegistryAddress,
          proofProvider: chainConfig.erc8004?.selfHumanProofProviderAddress,
        }
      : undefined,
  };
  const encoded = Buffer.from(JSON.stringify(metadata), "utf8").toString(
    "base64"
  );

  return `data:application/json;base64,${encoded}`;
}

function normalizeBytes(value) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function withCeloFeeCurrency(chainConfig, request) {
  if (chainConfig.id !== "celo" || !chainConfig.billingCurrency?.feeCurrencyAddress) {
    return request;
  }

  return {
    ...request,
    feeCurrency: chainConfig.billingCurrency.feeCurrencyAddress,
  };
}
