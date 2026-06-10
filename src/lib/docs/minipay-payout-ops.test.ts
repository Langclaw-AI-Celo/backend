import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const payoutOpsPath = path.join(backendRoot, "docs", "MINIPAY_PAYOUT_OPS.md");

const expectedClaims = [
  "window.ethereum.isMiniPay",
  "Celo mainnet `42220`",
  "0x837a2948586de4e7638c742f99e520ffc049bcf7",
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  "Proof Center screenshot showing Celo records.",
  "Project Leader",
  "https://langclawcelo.vercel.app",
  "Do not use a desktop wallet-only screenshot as MiniPay evidence.",
  "transaction hash or absence of transaction hash",
];

test("MiniPay payout ops doc keeps current Celo claim essentials", () => {
  const source = readFileSync(payoutOpsPath, "utf8");

  for (const claim of expectedClaims) {
    assert.ok(
      source.includes(claim),
      `Expected MINIPAY_PAYOUT_OPS to include ${claim}`
    );
  }
});
