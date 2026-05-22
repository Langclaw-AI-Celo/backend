import {
  defaultProductChain,
  isProductChainId,
  productChains,
  resolveProductChain,
  type ProductChainId,
} from "../chain-config";

type ChainConfig = {
  aliases: string[];
  alchemyNetwork?: string;
  chainId?: number;
  dexScreenerId: string;
  etherscanId: number;
  goPlusId?: number;
  name: string;
  nativeSymbol?: string;
  product?: boolean;
};

export type ResolvedChainConfig = ChainConfig & {
  id: string;
};

export const defaultChain: ProductChainId = defaultProductChain;

const chains: Record<string, ChainConfig> = {
  arbitrum: {
    aliases: ["arb", "arbitrum one"],
    alchemyNetwork: "arb-mainnet",
    dexScreenerId: "arbitrum",
    etherscanId: 42161,
    goPlusId: 42161,
    name: "Arbitrum",
  },
  avalanche: {
    aliases: ["avax", "avalanche c-chain"],
    alchemyNetwork: "avax-mainnet",
    dexScreenerId: "avalanche",
    etherscanId: 43114,
    goPlusId: 43114,
    name: "Avalanche",
  },
  base: {
    aliases: ["base mainnet"],
    alchemyNetwork: "base-mainnet",
    dexScreenerId: "base",
    etherscanId: 8453,
    goPlusId: 8453,
    name: "Base",
  },
  bnb: {
    aliases: ["bsc", "binance", "binance smart chain"],
    dexScreenerId: "bsc",
    etherscanId: 56,
    goPlusId: 56,
    name: "BNB Smart Chain",
  },
  ethereum: {
    aliases: ["eth", "ethereum mainnet"],
    alchemyNetwork: "eth-mainnet",
    dexScreenerId: "ethereum",
    etherscanId: 1,
    goPlusId: 1,
    name: "Ethereum",
  },
  mantle: {
    aliases: productChains.mantle.aliases,
    alchemyNetwork: productChains.mantle.alchemyNetwork,
    chainId: productChains.mantle.chainId,
    dexScreenerId: productChains.mantle.dexScreenerId,
    etherscanId: productChains.mantle.etherscanId,
    goPlusId: productChains.mantle.goPlusId,
    name: productChains.mantle.name,
    nativeSymbol: productChains.mantle.nativeCurrency.symbol,
    product: true,
  },
  celo: {
    aliases: productChains.celo.aliases,
    alchemyNetwork: productChains.celo.alchemyNetwork,
    chainId: productChains.celo.chainId,
    dexScreenerId: productChains.celo.dexScreenerId,
    etherscanId: productChains.celo.etherscanId,
    name: productChains.celo.name,
    nativeSymbol: productChains.celo.nativeCurrency.symbol,
    product: true,
  },
  optimism: {
    aliases: ["op", "optimistic ethereum"],
    alchemyNetwork: "opt-mainnet",
    dexScreenerId: "optimism",
    etherscanId: 10,
    goPlusId: 10,
    name: "Optimism",
  },
  polygon: {
    aliases: ["matic", "polygon pos"],
    alchemyNetwork: "polygon-mainnet",
    dexScreenerId: "polygon",
    etherscanId: 137,
    goPlusId: 137,
    name: "Polygon",
  },
  solana: {
    aliases: ["sol"],
    dexScreenerId: "solana",
    etherscanId: 1,
    goPlusId: 501,
    name: "Solana",
  },
};

export function resolveChain(input: string | undefined): ResolvedChainConfig {
  const normalized = input?.trim().toLowerCase() || defaultChain;

  for (const [key, value] of Object.entries(chains)) {
    if (key === normalized || value.aliases.includes(normalized)) {
      return {
        id: key,
        ...value,
      };
    }
  }

  return {
    id: defaultChain,
    ...chains[defaultChain],
  };
}

export function detectChain(text: string) {
  return detectChainWithFallback(text, defaultChain);
}

export function detectChainWithFallback(
  text: string,
  fallback: string | undefined
) {
  const resolvedFallback = resolveProductChain(fallback).id;

  return detectExplicitChain(text) ?? resolveChain(resolvedFallback);
}

export function detectUnsupportedOnChainChain(text: string) {
  const chain = detectExplicitChain(text);

  if (!chain || isProductChainId(chain.id)) {
    return null;
  }

  return chain;
}

export function isSupportedProductChain(chain: string) {
  return isProductChainId(resolveChain(chain).id);
}

export function isProviderSupportedForChain(
  chain: string,
  provider: string
) {
  const resolved = resolveChain(chain);

  if (provider === "goplus") {
    return Boolean(resolved.goPlusId);
  }

  if (provider === "alchemy") {
    return Boolean(resolved.alchemyNetwork);
  }

  return true;
}

export function getAlchemyNetwork(chain: string) {
  return resolveChain(chain).alchemyNetwork;
}

export function getDexScreenerChainId(chain: string) {
  return resolveChain(chain).dexScreenerId;
}

export function getEtherscanChainId(chain: string) {
  return resolveChain(chain).etherscanId;
}

export function getGoPlusChainId(chain: string) {
  const id = resolveChain(chain).goPlusId;

  if (!id) {
    throw new Error(`GoPlus is not configured for ${chain}.`);
  }

  return id;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectExplicitChain(text: string) {
  const normalized = text.toLowerCase();

  for (const [key, value] of Object.entries(chains)) {
    if (new RegExp(`\\b${escapeRegExp(key)}\\b`, "i").test(normalized)) {
      return resolveChain(key);
    }
  }

  for (const [key, value] of Object.entries(chains)) {
    if (
      value.aliases.some((alias) =>
        new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(normalized)
      )
    ) {
      return resolveChain(key);
    }
  }

  return undefined;
}
