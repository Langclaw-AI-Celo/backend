import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import {
  deployChains,
  loadBackendEnv,
  readChainEnv,
  rootDir,
  workspaceDir,
} from "./deploy-chain-utils.mjs";

loadBackendEnv();

const celo = deployChains.celo;
const etherscanApiKey = process.env.ETHERSCAN_API_KEY?.trim() || "";
const repos = [
  { name: "backend", path: rootDir },
  { name: "frontend", path: join(workspaceDir, "frontend") },
  { name: "contracts", path: join(workspaceDir, "contracts") },
  { name: ".github", path: join(workspaceDir, ".github") },
];

const contractPages = [
  {
    address: readChainEnv(celo, "LANGCLAW_REGISTRY_ADDRESS", ""),
    label: "LangclawRegistry",
    url: `https://celoscan.io/address/${readChainEnv(celo, "LANGCLAW_REGISTRY_ADDRESS", "")}#code`,
  },
  {
    address: readChainEnv(celo, "LANGCLAW_TRADING_JOURNAL_ADDRESS", ""),
    label: "LangclawTradingJournal",
    url: `https://celoscan.io/address/${readChainEnv(celo, "LANGCLAW_TRADING_JOURNAL_ADDRESS", "")}#code`,
  },
  {
    address: readChainEnv(celo, "LANGCLAW_USAGE_VAULT_ADDRESS", ""),
    label: "LangclawUsageVault",
    url: `https://celoscan.io/address/${readChainEnv(celo, "LANGCLAW_USAGE_VAULT_ADDRESS", "")}#code`,
  },
];

const eligible = [];
const pending = [];
const manual = [];

for (const repo of repos) {
  if (!existsSync(repo.path)) {
    manual.push(
      `${repo.name}: local folder is not present in this split workspace; verify this repo separately if it is part of the public submission.`
    );
    continue;
  }

  const licensePath = join(repo.path, "LICENSE");
  if (existsSync(licensePath)) {
    eligible.push(`${repo.name}: LICENSE present`);
  } else {
    pending.push(`${repo.name}: missing LICENSE`);
  }

  const originUrl = readGitOrigin(repo.path);
  if (originUrl) {
    eligible.push(`${repo.name}: origin ${originUrl}`);
  } else {
    pending.push(`${repo.name}: missing git origin remote`);
  }
}

for (const page of contractPages) {
  if (!page.address) {
    pending.push(`${page.label}: missing Celo contract address in env`);
    continue;
  }

  const code = await rpc("eth_getCode", [page.address, "latest"]).catch(() => "0x");
  if (code && code !== "0x" && code !== "0x0") {
    eligible.push(`${page.label}: bytecode present on Celo`);
  } else {
    pending.push(`${page.label}: no bytecode found on Celo`);
  }

  const verificationStatus = await readExplorerVerificationStatus(page.address);
  if (verificationStatus === "verified") {
    eligible.push(`${page.label}: explorer source code verified`);
  } else if (verificationStatus === "pending") {
    pending.push(`${page.label}: explorer source verification still pending`);
  } else {
    pending.push(`${page.label}: explorer verification status unknown`);
  }
}

const agentWallet = readChainEnv(celo, "AGENT_WALLET", "");
const agentId = readChainEnv(celo, "ERC8004_AGENT_ID", "");
const agentTx = readChainEnv(celo, "AGENT_ONCHAIN_TX", "");

if (agentWallet && agentId && agentTx) {
  const receipt = await rpc("eth_getTransactionReceipt", [agentTx]).catch(() => null);
  if (receipt?.status === "0x1") {
    eligible.push(
      `ERC-8004 agent: wallet ${agentWallet}, agent id ${agentId}, tx ${agentTx}`
    );
  } else {
    pending.push(`ERC-8004 agent: tx receipt missing or failed for ${agentTx}`);
  }
} else {
  pending.push("ERC-8004 agent: missing CELO_AGENT_WALLET, CELO_ERC8004_AGENT_ID, or CELO_AGENT_ONCHAIN_TX");
}

const selfAgentId = readChainEnv(celo, "SELF_AGENT_ID", "");
const selfAgentTx = readChainEnv(celo, "SELF_AGENT_ONCHAIN_TX", "");

if (selfAgentId && selfAgentTx) {
  const receipt = await rpc("eth_getTransactionReceipt", [selfAgentTx]).catch(() => null);
  if (receipt?.status === "0x1") {
    eligible.push(`Self Agent ID: id ${selfAgentId}, tx ${selfAgentTx}`);
  } else {
    pending.push(`Self Agent ID: tx receipt missing or failed for ${selfAgentTx}`);
  }
} else {
  pending.push("Self Agent ID: not registered in current env");
}

if (
  process.env.CELO_SELF_HUMAN_PROOF?.trim() &&
  process.env.CELO_SELF_HUMAN_PROVIDER_DATA?.trim()
) {
  eligible.push("Self human proof inputs are loaded in process env");
} else {
  pending.push("Self human proof inputs are not loaded in process env");
}

manual.push(
  "Project Leader payout claim remains a manual MiniPay operation before next month's rewards distribution."
);
manual.push(
  "Proof of Ship / MiniPay listing evidence is a booster and should be tracked separately from core eligibility."
);

console.log("Eligible now:");
for (const item of eligible) {
  console.log(`- ${item}`);
}

console.log("\nPending or blocked:");
for (const item of pending) {
  console.log(`- ${item}`);
}

console.log("\nManual follow-up:");
for (const item of manual) {
  console.log(`- ${item}`);
}

function readGitOrigin(repoPath) {
  const result = spawnSync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout.trim();
}

async function rpc(method, params) {
  const response = await fetch(celo.rpcUrl, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }),
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`${method} failed with ${response.status}`);
  }

  const payload = await response.json();
  return payload.result;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }

  return response.text();
}

async function readExplorerVerificationStatus(address) {
  if (etherscanApiKey) {
    const response = await fetch(
      `https://api.etherscan.io/v2/api?chainid=${celo.chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${etherscanApiKey}`,
      {
        headers: { "user-agent": "Mozilla/5.0" },
      }
    );

    if (response.ok) {
      const payload = await response.json().catch(() => null);
      const contractName = payload?.result?.[0]?.ContractName?.trim() || "";

      if (contractName) {
        return "verified";
      }

      if (payload?.message === "OK" || payload?.status === "1") {
        return "pending";
      }
    }
  }

  const html = await fetchText(`https://celoscan.io/address/${address}#code`).catch(
    () => ""
  );
  if (html.includes("Verify and Publish")) {
    return "pending";
  }
  if (html.includes("Contract Source Code Verified")) {
    return "verified";
  }
  return "unknown";
}
