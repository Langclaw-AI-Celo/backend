import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const apiReferencePath = path.join(backendRoot, "docs", "API_REFERENCE.md");

const expectedClaims = [
  "POST /api/proofs/readiness",
  "POST /api/proofs/decisions",
  '"status": "ready"',
  '"ready": true',
  "CELO_CHAIN_RPC_URL=https://forno.celo.org",
  "CELO_CHAIN_ID=42220",
  "CELO_ERC8004_AGENT_ID=9109",
  "CELO_SELF_AGENT_ID=133",
  "CELO_LANGCLAW_REGISTRY_ADDRESS=0xe69755e4249c4978c39fbe847ca9674ce7af3505",
  "CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS=0x69984c20176704685236fd633192d7de1c13a5ec",
  "CELO_LANGCLAW_USAGE_VAULT_ADDRESS=0x837a2948586de4e7638c742f99e520ffc049bcf7",
  "CELO_TRADING_JOURNAL_ENABLED=true",
];

test("API reference keeps the current Celo proof routes and env contract", () => {
  const source = readFileSync(apiReferencePath, "utf8");

  for (const claim of expectedClaims) {
    assert.ok(
      source.includes(claim),
      `Expected API_REFERENCE.md to include ${claim}`
    );
  }
});
