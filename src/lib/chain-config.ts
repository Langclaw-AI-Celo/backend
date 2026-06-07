export type ProductChainId = "mantle" | "celo";

export type ProductChainConfig = {
  aliases: string[];
  alchemyNetwork?: string;
  billingCurrency: {
    decimals: number;
    feeCurrencyAddress?: `0x${string}`;
    name: string;
    symbol: string;
    tokenAddress?: `0x${string}`;
  };
  chainId: number;
  dexScreenerId: string;
  envPrefix: "MANTLE" | "CELO";
  erc8004?: {
    identityRegistryAddress?: `0x${string}`;
    reputationRegistryAddress?: `0x${string}`;
    selfAgentRegistryAddress?: `0x${string}`;
    selfHumanProofProviderAddress?: `0x${string}`;
    selfReputationRegistryAddress?: `0x${string}`;
    selfValidationRegistryAddress?: `0x${string}`;
  };
  explorerUrl: string;
  etherscanId: number;
  goPlusId?: number;
  id: ProductChainId;
  name: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  proofSignalFallback: string;
  rpcUrl: string;
};

export const productChainIds = ["celo", "mantle"] as const;

export const productChains: Record<ProductChainId, ProductChainConfig> = {
  mantle: {
    aliases: ["mnt", "mantle mainnet", "mantle network"],
    alchemyNetwork: "mantle-mainnet",
    billingCurrency: {
      decimals: 18,
      name: "Mantle",
      symbol: "MNT",
    },
    chainId: 5000,
    dexScreenerId: "mantle",
    envPrefix: "MANTLE",
    explorerUrl: "https://explorer.mantle.xyz",
    etherscanId: 5000,
    goPlusId: 5000,
    id: "mantle",
    name: "Mantle",
    nativeCurrency: {
      decimals: 18,
      name: "Mantle",
      symbol: "MNT",
    },
    proofSignalFallback: "mantle-alpha",
    rpcUrl: "https://rpc.mantle.xyz",
  },
  celo: {
    aliases: ["cello", "celo mainnet", "celo network", "minipay"],
    alchemyNetwork: "celo-mainnet",
    billingCurrency: {
      decimals: 6,
      feeCurrencyAddress: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
      name: "Tether USD",
      symbol: "USDT",
      tokenAddress: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    },
    chainId: 42220,
    dexScreenerId: "celo",
    envPrefix: "CELO",
    erc8004: {
      identityRegistryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      reputationRegistryAddress: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
      selfAgentRegistryAddress: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
      selfHumanProofProviderAddress: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
      selfReputationRegistryAddress: "0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4",
      selfValidationRegistryAddress: "0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577",
    },
    explorerUrl: "https://celoscan.io",
    etherscanId: 42220,
    id: "celo",
    name: "Celo",
    nativeCurrency: {
      decimals: 18,
      name: "Celo",
      symbol: "CELO",
    },
    proofSignalFallback: "celo-alpha",
    rpcUrl: "https://forno.celo.org",
  },
};

export const defaultProductChain: ProductChainId = "celo";

export function isProductChainId(value: unknown): value is ProductChainId {
  return typeof value === "string" && value in productChains;
}

export function resolveProductChain(
  input: unknown,
  fallback: ProductChainId = defaultProductChain
): ProductChainConfig {
  const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";

  if (isProductChainId(normalized)) {
    return productChains[normalized];
  }

  for (const chain of Object.values(productChains)) {
    if (chain.aliases.includes(normalized)) {
      return chain;
    }
  }

  return productChains[fallback];
}

export function getProductChain(id: ProductChainId) {
  return productChains[id];
}

export function readProductChainId(
  input: unknown,
  fallback: ProductChainId = defaultProductChain
): ProductChainId {
  return resolveProductChain(input, fallback).id;
}

export function envKeyForChain(
  chain: ProductChainConfig,
  suffix: string
) {
  return `${chain.envPrefix}_${suffix}`;
}

export function readChainEnv(
  chain: ProductChainConfig,
  suffix: string,
  fallback?: string
) {
  const value = process.env[envKeyForChain(chain, suffix)]?.trim();

  if (value) {
    return value;
  }

  if (chain.id === "mantle") {
    const legacy = readLegacyMantleEnv(suffix);

    if (legacy) {
      return legacy;
    }
  }

  return fallback;
}

function readLegacyMantleEnv(suffix: string) {
  if (suffix === "PRIVATE_KEY") {
    return process.env.MANTLE_PRIVATE_KEY?.trim();
  }

  if (suffix === "LANGCLAW_REGISTRY_ADDRESS") {
    return process.env.LANGCLAW_REGISTRY_ADDRESS?.trim();
  }

  if (suffix === "LANGCLAW_TRADING_JOURNAL_ADDRESS") {
    return process.env.LANGCLAW_TRADING_JOURNAL_ADDRESS?.trim();
  }

  if (suffix === "LANGCLAW_USAGE_VAULT_ADDRESS") {
    return process.env.LANGCLAW_USAGE_VAULT_ADDRESS?.trim();
  }

  if (suffix === "CHAIN_DEPLOY_BLOCK") {
    return process.env.MANTLE_REGISTRY_DEPLOY_BLOCK?.trim();
  }

  if (suffix === "TRADING_JOURNAL_DEPLOY_BLOCK") {
    return process.env.MANTLE_TRADING_JOURNAL_DEPLOY_BLOCK?.trim();
  }

  return process.env[`MANTLE_${suffix}`]?.trim();
}
