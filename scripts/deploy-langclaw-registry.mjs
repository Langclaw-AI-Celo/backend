import { join } from "node:path";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
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
  "LangclawRegistry.sol"
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

const { abi, bytecode } = await compileContract({
  contractName: "LangclawRegistry",
  contractPath,
  sourceName: "LangclawRegistry.sol",
});
const account = privateKeyToAccount(privateKey);
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

console.log(`Deploying LangclawRegistry to ${chainConfig.name} (${chainId}).`);
console.log(`Deployer: ${account.address}`);
console.log(
  `Deployer balance: ${formatEther(balance)} ${chainConfig.nativeCurrency.symbol}`
);

const hash = await walletClient.deployContract({
  abi,
  account,
  bytecode,
});
console.log(`Deployment tx: ${hash}`);
console.log(`Explorer: ${explorerBase}/tx/${hash}`);

const receipt = await waitForReceipt(publicClient, hash);

if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Deployment failed. Transaction: ${hash}`);
}

console.log(`LangclawRegistry: ${receipt.contractAddress}`);
console.log(`Deploy block: ${receipt.blockNumber}`);
console.log(
  `${chainConfig.envPrefix}_LANGCLAW_REGISTRY_ADDRESS=${receipt.contractAddress}`
);
console.log(
  `${chainConfig.envPrefix}_REGISTRY_DEPLOY_BLOCK=${receipt.blockNumber.toString()}`
);

if (writeEnv) {
  upsertEnvValues(envPath, {
    ...buildAddressEnvUpdates(
      chainConfig,
      "REGISTRY",
      receipt.contractAddress,
      receipt.blockNumber.toString()
    ),
    [`${chainConfig.envPrefix}_CHAIN_ENABLED`]: "true",
  });
  console.log(`Updated ${envPath}`);
}
