import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import solc from "solc";

export const rootDir = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const workspaceDir = resolve(rootDir, "..");
export const envPath = join(rootDir, ".env");

export const deployChains = {
  mantle: {
    billingCurrency: {
      decimals: 18,
      name: "Mantle",
      symbol: "MNT",
    },
    chainId: 5000,
    envPrefix: "MANTLE",
    explorerUrl: "https://explorer.mantle.xyz",
    id: "mantle",
    name: "Mantle Mainnet",
    nativeCurrency: {
      decimals: 18,
      name: "Mantle",
      symbol: "MNT",
    },
    rpcUrl: "https://rpc.mantle.xyz",
  },
  celo: {
    billingCurrency: {
      decimals: 6,
      feeCurrencyAddress: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
      name: "Tether USD",
      symbol: "USDT",
      tokenAddress: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    },
    chainId: 42220,
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
    id: "celo",
    name: "Celo Mainnet",
    nativeCurrency: {
      decimals: 18,
      name: "Celo",
      symbol: "CELO",
    },
    rpcUrl: "https://forno.celo.org",
  },
};

export function loadBackendEnv() {
  for (const path of [join(rootDir, ".env.local"), envPath]) {
    if (existsSync(path)) {
      config({ path, override: false });
    }
  }
}

export function parseDeployArgs(argv = process.argv.slice(2)) {
  let chainId = "mantle";
  let writeEnv = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write-env") {
      writeEnv = true;
      continue;
    }

    if (arg === "--chain") {
      chainId = argv[index + 1] || chainId;
      index += 1;
      continue;
    }

    if (arg.startsWith("--chain=")) {
      chainId = arg.slice("--chain=".length);
    }
  }

  const chain = deployChains[chainId];

  if (!chain) {
    throw new Error("Unsupported deploy chain. Use --chain mantle or --chain celo.");
  }

  return { chain, writeEnv };
}

export function readChainEnv(chain, suffix, fallback = "") {
  const prefixed = process.env[`${chain.envPrefix}_${suffix}`]?.trim();

  if (prefixed) {
    return prefixed;
  }

  if (chain.id === "mantle") {
    const legacy = readLegacyMantleEnv(suffix);

    if (legacy) {
      return legacy;
    }
  }

  return fallback;
}

export function readChainId(chain) {
  const value = readChainEnv(chain, "CHAIN_ID", String(chain.chainId));
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : chain.chainId;
}

export function normalizePrivateKey(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;

  return /^0x[a-fA-F0-9]{64}$/.test(prefixed) ? prefixed : "";
}

export async function waitForReceipt(publicClient, hash) {
  try {
    return await publicClient.waitForTransactionReceipt({
      hash,
      pollingInterval: 2000,
      timeout: 180_000,
    });
  } catch {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const receipt = await publicClient
        .getTransactionReceipt({ hash })
        .catch(() => null);

      if (receipt) {
        return receipt;
      }

      await delay(3000);
    }
  }

  throw new Error(`Deployment receipt was not found. Transaction: ${hash}`);
}

export async function compileContract({
  contractName,
  contractPath,
  evmVersion = "cancun",
  sourceName,
  viaIR = false,
}) {
  const source = await readFile(contractPath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      [sourceName]: {
        content: source,
      },
    },
    settings: {
      evmVersion,
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR,
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: resolveSolidityImport(contractPath) })
  );
  const errors =
    output.errors?.filter((item) => item.severity === "error") || [];

  if (errors.length) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  const compiled = output.contracts?.[sourceName]?.[contractName];

  if (!compiled?.evm?.bytecode?.object) {
    throw new Error(`${contractName} bytecode was not produced.`);
  }

  return {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
  };
}

export function upsertEnvValues(path, values) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const newline = existing.includes("\r\n") ? "\r\n" : "\n";
  const lines = existing.length ? existing.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);

    if (!match || !(match[1] in values)) {
      return line;
    }

    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  writeFileSync(path, nextLines.join(newline).replace(/\s*$/, newline));
}

export function buildAddressEnvUpdates(chain, contractKey, address, deployBlock) {
  const updates = {
    [`${chain.envPrefix}_LANGCLAW_${contractKey}_ADDRESS`]: address,
    [`${chain.envPrefix}_${contractKey}_DEPLOY_BLOCK`]: deployBlock,
  };

  if (chain.id === "mantle") {
    updates[`LANGCLAW_${contractKey}_ADDRESS`] = address;
  }

  return updates;
}

function readLegacyMantleEnv(suffix) {
  if (suffix === "LANGCLAW_REGISTRY_ADDRESS") {
    return process.env.LANGCLAW_REGISTRY_ADDRESS?.trim();
  }

  if (suffix === "LANGCLAW_TRADING_JOURNAL_ADDRESS") {
    return process.env.LANGCLAW_TRADING_JOURNAL_ADDRESS?.trim();
  }

  if (suffix === "LANGCLAW_USAGE_VAULT_ADDRESS") {
    return process.env.LANGCLAW_USAGE_VAULT_ADDRESS?.trim();
  }

  return "";
}

function resolveSolidityImport(contractPath) {
  return (importPath) => {
    const candidates = [
      join(dirname(contractPath), importPath),
      join(workspaceDir, "contracts", "node_modules", importPath),
      join(rootDir, "node_modules", importPath),
    ];

    if (importPath.startsWith("@openzeppelin/contracts/")) {
      candidates.push(
        join(
          workspaceDir,
          "contracts",
          "lib",
          "openzeppelin-contracts",
          "contracts",
          importPath.slice("@openzeppelin/contracts/".length)
        )
      );
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { contents: readFileSync(candidate, "utf8") };
      }
    }

    return { error: `File not found: ${importPath}` };
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
