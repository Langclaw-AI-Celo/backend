import { join } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildAddressEnvUpdates,
  compileContract,
  envPath,
  loadBackendEnv,
  normalizePrivateKey,
  parseDeployArgs,
  readChainEnv,
  readChainId,
  upsertEnvValues,
  waitForReceipt,
  workspaceDir,
} from "./deploy-chain-utils.mjs";

loadBackendEnv();

const { chain: chainConfig, writeEnv } = parseDeployArgs();
const contractPath = join(
  workspaceDir,
  "contracts",
  "src",
  "LangclawUsageVault.sol"
);
const rpcUrl = readChainEnv(chainConfig, "CHAIN_RPC_URL", chainConfig.rpcUrl);
const chainId = readChainId(chainConfig);
const explorerBase = readChainEnv(
  chainConfig,
  "CHAIN_EXPLORER_URL",
  chainConfig.explorerUrl
).replace(/\/$/, "");
const privateKey = normalizePrivateKey(
  readChainEnv(chainConfig, "DEPLOYER_PRIVATE_KEY", "") ||
    readChainEnv(chainConfig, "PRIVATE_KEY", "")
);

if (!privateKey) {
  throw new Error(
    `Set ${chainConfig.envPrefix}_DEPLOYER_PRIVATE_KEY before deploying.`
  );
}

const account = privateKeyToAccount(privateKey);
const owner = readAddress(
  readChainEnv(
    chainConfig,
    "LANGCLAW_USAGE_VAULT_OWNER",
    process.env.LANGCLAW_USAGE_VAULT_OWNER || account.address
  ),
  `${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_OWNER`
);
const withdrawalAuthority = readAddress(
  readChainEnv(
    chainConfig,
    "LANGCLAW_USAGE_VAULT_WITHDRAWAL_AUTHORITY",
    process.env.LANGCLAW_USAGE_VAULT_WITHDRAWAL_AUTHORITY || account.address
  ),
  `${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_WITHDRAWAL_AUTHORITY`
);
const depositToken = readOptionalAddress(
  readChainEnv(
    chainConfig,
    "LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN",
    chainConfig.billingCurrency.tokenAddress || "0x0000000000000000000000000000000000000000"
  ),
  `${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN`
);
const { abi, bytecode } = await compileContract({
  contractName: "LangclawUsageVault",
  contractPath,
  sourceName: "LangclawUsageVault.sol",
  viaIR: true,
});
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
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});
const balance = await publicClient.getBalance({ address: account.address });

console.log(`Deploying LangclawUsageVault to ${chainConfig.name} (${chainId}).`);
console.log(`Deployer: ${account.address}`);
console.log(`Owner: ${owner}`);
console.log(`Withdrawal authority: ${withdrawalAuthority}`);
console.log(`Deposit token: ${depositToken}`);
console.log(
  `Deployer balance: ${formatEther(balance)} ${chainConfig.nativeCurrency.symbol}`
);

const hash = await walletClient.deployContract({
  abi,
  account,
  args: [owner, withdrawalAuthority, depositToken],
  bytecode,
});
console.log(`Deployment tx: ${hash}`);
console.log(`Explorer: ${explorerBase}/tx/${hash}`);

const receipt = await waitForReceipt(publicClient, hash);

if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Deployment failed. Transaction: ${hash}`);
}

console.log(`LangclawUsageVault: ${receipt.contractAddress}`);
console.log(`Deploy block: ${receipt.blockNumber}`);
console.log(
  `${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_ADDRESS=${receipt.contractAddress}`
);
console.log(
  `${chainConfig.envPrefix}_USAGE_VAULT_DEPLOY_BLOCK=${receipt.blockNumber.toString()}`
);

if (writeEnv) {
  upsertEnvValues(envPath, {
    ...buildAddressEnvUpdates(
      chainConfig,
      "USAGE_VAULT",
      receipt.contractAddress,
      receipt.blockNumber.toString()
    ),
    [`${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_OWNER`]: owner,
    [`${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_WITHDRAWAL_AUTHORITY`]:
      withdrawalAuthority,
    [`${chainConfig.envPrefix}_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN`]:
      depositToken,
  });
  console.log(`Updated ${envPath}`);
}

function readAddress(value, envName) {
  const trimmed = value.trim();

  if (!isAddress(trimmed)) {
    throw new Error(`Set ${envName} to a valid EVM address.`);
  }

  return getAddress(trimmed);
}

function readOptionalAddress(value, envName) {
  const trimmed = value.trim();

  if (trimmed === "" || /^0x0{40}$/i.test(trimmed)) {
    return "0x0000000000000000000000000000000000000000";
  }

  return readAddress(trimmed, envName);
}
