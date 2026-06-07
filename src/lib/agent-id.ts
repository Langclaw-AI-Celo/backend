import {
  readChainEnv,
  type ProductChainConfig,
} from "./chain-config";

export type PreferredAgentConfig = {
  id: bigint;
  label: string;
  source: "erc8004" | "self" | "legacy" | "unset";
};

export function readPreferredAgentConfig(
  chain: ProductChainConfig
): PreferredAgentConfig {
  const erc8004AgentId = readNumericAgentId(readChainEnv(chain, "ERC8004_AGENT_ID"));

  if (erc8004AgentId > 0n) {
    return {
      id: erc8004AgentId,
      label: `${chain.envPrefix}_ERC8004_AGENT_ID`,
      source: "erc8004",
    };
  }

  const selfAgentId = readNumericAgentId(readChainEnv(chain, "SELF_AGENT_ID"));

  if (selfAgentId > 0n) {
    return {
      id: selfAgentId,
      label: `${chain.envPrefix}_SELF_AGENT_ID`,
      source: "self",
    };
  }

  const legacyAgentId = readNumericAgentId(process.env.LANGCLAW_AGENT_ID?.trim());

  if (legacyAgentId > 0n) {
    return {
      id: legacyAgentId,
      label: "LANGCLAW_AGENT_ID",
      source: "legacy",
    };
  }

  return {
    id: 0n,
    label: `${chain.envPrefix}_ERC8004_AGENT_ID`,
    source: "unset",
  };
}

export function readPreferredAgentId(chain: ProductChainConfig) {
  return readPreferredAgentConfig(chain).id;
}

function readNumericAgentId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return 0n;
  }

  return BigInt(value);
}
