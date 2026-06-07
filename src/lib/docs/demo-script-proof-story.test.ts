import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const demoScriptPath = path.join(backendRoot, "docs", "DEMO_SCRIPT.md");

const expectedClaims = [
  "Agent Decision Proof panel.",
  "Proof Center at `/proofs`.",
  "Self Agent ID `133`.",
  "ERC-8004 agent ID `9109`.",
  "0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211",
  "npm run check:celo-proof",
  "npm run check:eligibility",
  "pnpm typecheck",
  "pnpm build",
  "forge build",
  "forge test",
];

test("demo script keeps the shipped proof story and verification checklist", () => {
  const source = readFileSync(demoScriptPath, "utf8");

  for (const claim of expectedClaims) {
    assert.ok(
      source.includes(claim),
      `Expected DEMO_SCRIPT.md to include ${claim}`
    );
  }
});
