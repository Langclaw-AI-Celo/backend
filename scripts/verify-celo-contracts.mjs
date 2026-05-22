import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { encodeAbiParameters, getAddress, isAddress } from "viem";

import {
  deployChains,
  loadBackendEnv,
  readChainEnv,
  rootDir,
  workspaceDir,
} from "./deploy-chain-utils.mjs";

loadBackendEnv();

const celo = deployChains.celo;
const contractsDir = join(workspaceDir, "contracts");
const blockscoutVerifierUrl =
  process.env.CELO_BLOCKSCOUT_VERIFIER_URL?.trim() ||
  "https://celo.blockscout.com/api/";
const etherscanVerifierUrl =
  process.env.CELO_ETHERSCAN_VERIFIER_URL?.trim() ||
  `https://api.etherscan.io/v2/api?chainid=${celo.chainId}`;
const etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim() || "";
const legacyVaultVerificationRoot = join(
  rootDir,
  "verification",
  "celo-legacy-vault"
);
const legacyOpenZeppelinTag = "v5.5.0";
const legacyOpenZeppelinCacheDir = join(
  tmpdir(),
  "langclaw-celo-verify-deps",
  `openzeppelin-contracts-${legacyOpenZeppelinTag}`
);
const verifier =
  process.env.CELO_CONTRACT_VERIFIER?.trim().toLowerCase() ||
  (etherscanApiKey ? "etherscan" : "blockscout");

const options = parseArgs(process.argv.slice(2));
const targets = await hydrateTargets(buildTargets(options.contract));

if (options.standardJsonOnly) {
  exportStandardJsonBundles(targets);
  process.exit(0);
}

let failureCount = 0;

for (const target of targets) {
  if (target.verificationStrategy === "etherscan-standard-json") {
    if (options.dryRun) {
      console.log(`\n# ${target.name}`);
      console.log(`Legacy verification bundle: ${writeStandardJsonBundle(target)}`);
      console.log(
        `POST ${etherscanVerifierUrl} module=contract action=verifysourcecode contractname=${target.identifier} constructorArguments=${target.constructorArgs}`
      );
      continue;
    }

    console.log(`\n==> Verifying ${target.name} with legacy standard JSON`);
    await verifyWithEtherscanStandardJson(target, { watch: options.watch });
    console.log(`Verified ${target.name}: ${target.address}`);
    continue;
  }

  const forgeEnv = buildForgeEnv(target);
  const buildArgs = buildForgeBuildArgs(target);
  const args = buildForgeArgs(target, {
    verify: true,
    verifier,
    watch: options.watch,
  });

  if (options.dryRun) {
    console.log(`\n# ${target.name}`);
    console.log(
      formatEnvCommand(forgeEnv, ["forge", ...buildArgs].map(shellQuote))
    );
    console.log(
      formatEnvCommand(forgeEnv, ["forge", ...args].map(shellQuote))
    );
    continue;
  }

  console.log(`\n==> Building ${target.name} with deploy-matching settings`);
  const buildResult = spawnSync("forge", buildArgs, {
    cwd: contractsDir,
    env: forgeEnv,
    stdio: "inherit",
  });

  if (buildResult.status !== 0) {
    throw new Error(`Unable to build ${target.name} for verification.`);
  }

  console.log(`==> Verifying ${target.name} on Celo via ${verifier}`);
  const result = spawnSync("forge", args, {
    cwd: contractsDir,
    env: forgeEnv,
    stdio: "inherit",
  });

  if (result.status === 0) {
    console.log(`Verified ${target.name}: ${target.address}`);
    continue;
  }

  failureCount += 1;
  const bundlePath = writeStandardJsonBundle(target);
  console.error(`Verification failed for ${target.name}.`);
  console.error(`Standard JSON bundle: ${bundlePath}`);
  if (target.name === "LangclawUsageVault") {
    console.error(
      "Current src/LangclawUsageVault.sol does not match the live vault bytecode. The deployed contract is missing token-deposit selectors present in the current source."
    );
  }
  console.error(
    `Manual Blockscout page: https://celo.blockscout.com/address/${target.address}/contract-verification`
  );
  console.error(
    `Manual Celoscan page: https://celoscan.io/verifyContract?a=${target.address}`
  );
}

if (failureCount > 0) {
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    contract: "all",
    dryRun: false,
    standardJsonOnly: false,
    watch: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--no-watch") {
      options.watch = false;
      continue;
    }

    if (arg === "--standard-json") {
      options.standardJsonOnly = true;
      continue;
    }

    if (arg === "--contract") {
      options.contract = argv[index + 1] || options.contract;
      index += 1;
      continue;
    }

    if (arg.startsWith("--contract=")) {
      options.contract = arg.slice("--contract=".length);
    }
  }

  return options;
}

function buildTargets(contractSelection) {
  const selection = contractSelection.trim().toLowerCase();
  const vaultOwner = readConfiguredAddress(
    readChainEnv(
      celo,
      "LANGCLAW_USAGE_VAULT_OWNER",
      readChainEnv(celo, "AGENT_WALLET", "")
    ),
    "CELO_LANGCLAW_USAGE_VAULT_OWNER"
  );
  const withdrawalAuthority = readConfiguredAddress(
    readChainEnv(
      celo,
      "LANGCLAW_USAGE_VAULT_WITHDRAWAL_AUTHORITY",
      vaultOwner
    ),
    "CELO_LANGCLAW_USAGE_VAULT_WITHDRAWAL_AUTHORITY"
  );
  const depositToken = readConfiguredAddress(
    readChainEnv(
      celo,
      "LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN",
      celo.billingCurrency.tokenAddress
    ),
    "CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN"
  );
  const targets = [
    {
      address: readRequiredAddress(
        readChainEnv(celo, "LANGCLAW_REGISTRY_ADDRESS", ""),
        "CELO_LANGCLAW_REGISTRY_ADDRESS"
      ),
      buildLabel: "registry",
      compilerVersion: "v0.8.35+commit.47b9dedd",
      identifier: "src/LangclawRegistry.sol:LangclawRegistry",
      name: "LangclawRegistry",
      solcVersion: "0.8.35",
      sourcePath: "src/LangclawRegistry.sol",
      viaIr: false,
    },
    {
      address: readRequiredAddress(
        readChainEnv(celo, "LANGCLAW_TRADING_JOURNAL_ADDRESS", ""),
        "CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS"
      ),
      buildLabel: "trading-journal",
      compilerVersion: "v0.8.35+commit.47b9dedd",
      identifier: "src/LangclawTradingJournal.sol:LangclawTradingJournal",
      name: "LangclawTradingJournal",
      solcVersion: "0.8.35",
      sourcePath: "src/LangclawTradingJournal.sol",
      viaIr: true,
    },
    {
      address: readRequiredAddress(
        readChainEnv(celo, "LANGCLAW_USAGE_VAULT_ADDRESS", ""),
        "CELO_LANGCLAW_USAGE_VAULT_ADDRESS"
      ),
      buildLabel: "usage-vault",
      compilerVersion: "v0.8.35+commit.47b9dedd",
      constructorArgs: encodeAbiParameters(
        [
          { name: "initialOwner", type: "address" },
          { name: "initialWithdrawalAuthority", type: "address" },
          { name: "initialDepositToken", type: "address" },
        ],
        [vaultOwner, withdrawalAuthority, depositToken]
      ).slice(2),
      currentConstructorArgs: encodeAbiParameters(
        [
          { name: "initialOwner", type: "address" },
          { name: "initialWithdrawalAuthority", type: "address" },
          { name: "initialDepositToken", type: "address" },
        ],
        [vaultOwner, withdrawalAuthority, depositToken]
      ).slice(2),
      currentVerificationStrategy: "forge",
      currentVariantLabel: "token",
      currentSourcePath: "src/LangclawUsageVault.sol",
      identifier: "src/LangclawUsageVault.sol:LangclawUsageVault",
      legacyConstructorArgs: encodeAbiParameters(
        [
          { name: "initialOwner", type: "address" },
          { name: "initialWithdrawalAuthority", type: "address" },
        ],
        [vaultOwner, withdrawalAuthority]
      ).slice(2),
      legacyVerificationRoot: legacyVaultVerificationRoot,
      legacyVerificationStrategy: "etherscan-standard-json",
      legacyVariantLabel: "legacy-native",
      name: "LangclawUsageVault",
      solcVersion: "0.8.35",
      sourcePath: "src/LangclawUsageVault.sol",
      viaIr: true,
    },
  ];

  if (selection === "all") {
    return targets;
  }

  const filtered = targets.filter(
    (target) =>
      target.name.toLowerCase() === selection ||
      target.name.toLowerCase().replace("langclaw", "") === selection
  );

  if (filtered.length === 0) {
    throw new Error(
      "Unknown --contract value. Use registry, tradingjournal, usagevault, or all."
    );
  }

  return filtered;
}

async function hydrateTargets(targets) {
  for (const target of targets) {
    if (target.name !== "LangclawUsageVault") {
      continue;
    }

    const variant = await detectUsageVaultVariant(target.address);

    if (variant === "token") {
      target.constructorArgs = target.currentConstructorArgs;
      target.sourcePath = target.currentSourcePath;
      target.variantLabel = target.currentVariantLabel;
      target.verificationStrategy = target.currentVerificationStrategy;
      continue;
    }

    target.constructorArgs = target.legacyConstructorArgs;
    target.variantLabel = target.legacyVariantLabel;
    target.verificationStrategy = target.legacyVerificationStrategy;
  }

  return targets;
}

function buildForgeBuildArgs(target) {
  return ["build", target.sourcePath, "--use", target.solcVersion, "--force"];
}

function buildForgeArgs(target, { verify, verifier, watch }) {
  const args = [
    "verify-contract",
    target.address,
    target.identifier,
    "--chain",
    String(celo.chainId),
    "--use",
    target.solcVersion,
    "--compiler-version",
    target.compilerVersion,
    "--num-of-optimizations",
    "200",
    "--no-auto-detect",
    "--skip-is-verified-check",
  ];

  if (target.viaIr) {
    args.push("--via-ir");
  }

  if (target.constructorArgs) {
    args.push("--constructor-args", target.constructorArgs);
  }

  if (verify) {
    if (verifier === "etherscan") {
      if (!etherscanApiKey) {
        throw new Error("Set ETHERSCAN_API_KEY before using the etherscan verifier.");
      }

      args.push(
        "--verifier",
        "etherscan",
        "--verifier-url",
        etherscanVerifierUrl,
        "--etherscan-api-key",
        etherscanApiKey
      );
    } else if (verifier === "blockscout") {
      args.push(
        "--verifier",
        "blockscout",
        "--verifier-url",
        blockscoutVerifierUrl,
        "--no-proxy"
      );
    } else {
      throw new Error("Unsupported verifier. Use CELO_CONTRACT_VERIFIER=etherscan or blockscout.");
    }

    if (watch) {
      args.push("--watch");
    }
  } else {
    args.push("--show-standard-json-input");
  }

  return args;
}

function exportStandardJsonBundles(targets) {
  for (const target of targets) {
    const bundlePath = writeStandardJsonBundle(target);
    console.log(`${target.name}: ${bundlePath}`);
  }
}

function writeStandardJsonBundle(target) {
  if (target.verificationStrategy === "etherscan-standard-json") {
    const { json } = buildLegacyVaultStandardJson(target);
    const outDir = join(tmpdir(), "langclaw-celo-verify");
    const filePath = join(outDir, `${target.name}.standard-input.json`);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(filePath, json);
    writeFileSync(
      join(outDir, `${target.name}.constructor-args.txt`),
      `${target.constructorArgs}\n`
    );

    return filePath;
  }

  const forgeEnv = buildForgeEnv(target);
  const buildResult = spawnSync("forge", buildForgeBuildArgs(target), {
    cwd: contractsDir,
    encoding: "utf8",
    env: forgeEnv,
  });

  if (buildResult.status !== 0) {
    throw new Error(
      `Unable to build ${target.name} for standard JSON export: ${buildResult.stderr || "build failed"}`
    );
  }

  const result = spawnSync("forge", buildForgeArgs(target, { verify: false }), {
    cwd: contractsDir,
    encoding: "utf8",
    env: forgeEnv,
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(
      `Unable to generate standard JSON for ${target.name}: ${result.stderr || "missing stdout"}`
    );
  }

  const outDir = join(tmpdir(), "langclaw-celo-verify");
  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, `${target.name}.standard-input.json`);
  writeFileSync(filePath, result.stdout);

  if (target.constructorArgs) {
    writeFileSync(
      join(outDir, `${target.name}.constructor-args.txt`),
      `${target.constructorArgs}\n`
    );
  }

  return filePath;
}

async function verifyWithEtherscanStandardJson(target, { watch }) {
  if (!etherscanApiKey) {
    throw new Error("Set ETHERSCAN_API_KEY before verifying with standard JSON.");
  }

  if (await isExplorerVerified(target.address)) {
    console.log(`${target.name} is already verified on Celoscan.`);
    return;
  }

  const { json } = buildLegacyVaultStandardJson(target);
  const params = new URLSearchParams();
  params.set("apikey", etherscanApiKey);
  params.set("module", "contract");
  params.set("action", "verifysourcecode");
  params.set("contractaddress", target.address);
  params.set("sourceCode", json);
  params.set("codeformat", "solidity-standard-json-input");
  params.set("contractname", target.identifier);
  params.set("compilerversion", target.compilerVersion);
  params.set("constructorArguments", target.constructorArgs);
  params.set("licenseType", "3");

  const response = await fetch(etherscanVerifierUrl, {
    body: params,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
    },
    method: "POST",
  });
  const payload = await response.json().catch(() => null);
  const resultMessage = String(payload?.result || "");

  if (resultMessage.includes("already verified")) {
    console.log(`${target.name} is already verified on Celoscan.`);
    return;
  }

  if (!response.ok || payload?.status !== "1") {
    throw new Error(
      `Legacy standard JSON submission failed for ${target.name}: ${JSON.stringify(payload || {})}`
    );
  }

  const guid = payload.result;
  console.log(`Submitted ${target.name}: guid ${guid}`);

  if (!watch) {
    return;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) {
      await delay(15_000);
    }

    const statusUrl = `${etherscanVerifierUrl}&apikey=${encodeURIComponent(
      etherscanApiKey
    )}&module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`;
    const statusResponse = await fetch(statusUrl, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    const statusPayload = await statusResponse.json().catch(() => null);
    const result = statusPayload?.result || "";

    if (statusPayload?.status === "1" && result.includes("Pass - Verified")) {
      return;
    }

    if (result.includes("Pending in queue")) {
      console.log(`Verification pending for ${target.name}; retrying...`);
      continue;
    }

    throw new Error(
      `Legacy verification failed for ${target.name}: ${JSON.stringify(statusPayload || {})}`
    );
  }

  throw new Error(`Timed out waiting for ${target.name} verification.`);
}

function buildLegacyVaultStandardJson(target) {
  const openzeppelinRoot = ensureLegacyOpenZeppelinCheckout();
  const sourcePath = join(target.legacyVerificationRoot, "src", "LangclawUsageVault.sol");
  const sources = {
    "src/LangclawUsageVault.sol": {
      content: readFileSync(sourcePath, "utf8"),
    },
  };

  for (const relPath of [
    "access/Ownable.sol",
    "access/Ownable2Step.sol",
    "utils/Context.sol",
    "utils/Pausable.sol",
    "utils/ReentrancyGuard.sol",
    "utils/StorageSlot.sol",
    "utils/introspection/IERC165.sol",
  ]) {
    const sourceKey = `lib/openzeppelin-contracts/contracts/${relPath}`;
    sources[sourceKey] = {
      content: readFileSync(join(openzeppelinRoot, "contracts", relPath), "utf8"),
    };
  }

  const input = {
    language: "Solidity",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
      remappings: [
        "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
        "erc4626-tests/=lib/openzeppelin-contracts/lib/erc4626-tests/",
        "forge-std/=lib/forge-std/src/",
        "halmos-cheatcodes/=lib/openzeppelin-contracts/lib/halmos-cheatcodes/src/",
        "openzeppelin-contracts/=lib/openzeppelin-contracts/",
      ],
      viaIR: true,
    },
    sources,
  };

  return {
    input,
    json: JSON.stringify(input),
  };
}

async function detectUsageVaultVariant(address) {
  const response = await fetch(celo.rpcUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          data: "0xc89039c5",
          to: address,
        },
        "latest",
      ],
    }),
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Unable to inspect usage vault variant: ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  const result = payload?.result;

  if (typeof result === "string" && /^0x[0-9a-fA-F]{64}$/.test(result)) {
    return "token";
  }

  return "legacy-native";
}

function ensureLegacyOpenZeppelinCheckout() {
  if (existsSync(join(legacyOpenZeppelinCacheDir, "contracts"))) {
    return legacyOpenZeppelinCacheDir;
  }

  mkdirSync(join(tmpdir(), "langclaw-celo-verify-deps"), { recursive: true });

  const result = spawnSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      legacyOpenZeppelinTag,
      "https://github.com/OpenZeppelin/openzeppelin-contracts.git",
      legacyOpenZeppelinCacheDir,
    ],
    {
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `Unable to clone OpenZeppelin ${legacyOpenZeppelinTag}: ${result.stderr || "clone failed"}`
    );
  }

  return legacyOpenZeppelinCacheDir;
}

function buildForgeEnv(target) {
  const buildRoot = join(tmpdir(), "langclaw-celo-verify-build", target.buildLabel);

  mkdirSync(buildRoot, { recursive: true });

  return {
    ...process.env,
    FOUNDRY_CACHE_PATH: join(buildRoot, "cache"),
    FOUNDRY_OUT: join(buildRoot, "out"),
    FOUNDRY_VIA_IR: String(target.viaIr),
  };
}

function formatEnvCommand(env, command) {
  const prefixes = ["FOUNDRY_CACHE_PATH", "FOUNDRY_OUT", "FOUNDRY_VIA_IR"]
    .map((key) => `${key}=${shellQuote(env[key])}`)
    .join(" ");

  const sanitized = command.map((part, index) =>
    command[index - 1] === "--etherscan-api-key" ? "<redacted>" : part
  );

  return `${prefixes} ${sanitized.join(" ")}`;
}

async function isExplorerVerified(address) {
  if (!etherscanApiKey) {
    return false;
  }

  const response = await fetch(
    `${etherscanVerifierUrl}&apikey=${encodeURIComponent(
      etherscanApiKey
    )}&module=contract&action=getsourcecode&address=${encodeURIComponent(address)}`,
    {
      headers: { "user-agent": "Mozilla/5.0" },
    }
  );
  const payload = await response.json().catch(() => null);

  return Boolean(payload?.result?.[0]?.ContractName?.trim());
}

function readRequiredAddress(value, envName) {
  if (!value.trim() || !isAddress(value.trim())) {
    throw new Error(`Set ${envName} to a valid address before verifying.`);
  }

  return getAddress(value.trim());
}

function readConfiguredAddress(value, envName) {
  if (!value.trim()) {
    throw new Error(`Set ${envName} before preparing verification artifacts.`);
  }

  return readRequiredAddress(value, envName);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
