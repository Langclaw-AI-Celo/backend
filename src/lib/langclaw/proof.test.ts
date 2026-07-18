import assert from "node:assert/strict";
import test from "node:test";

import { getProductChain } from "../chain-config";
import {
  waitForSubmittedTransactionReceipt,
  writeContractWithCeloFeeFallback,
} from "./proof";

test("waits for submitted Mantle transaction receipts", async () => {
  let attempts = 0;
  const receipt = await waitForSubmittedTransactionReceipt({
    attempts: 3,
    intervalMs: 1,
    publicClient: {
      async getTransactionReceipt() {
        attempts += 1;

        return attempts === 2 ? { status: "success" as const } : null;
      },
    },
    txHash:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
  });

  assert.deepEqual(receipt, { status: "success" });
  assert.equal(attempts, 2);
});

test("anchoring receipt polling returns reverted transactions immediately", async () => {
  let attempts = 0;
  const receipt = await waitForSubmittedTransactionReceipt({
    attempts: 3,
    intervalMs: 1,
    publicClient: {
      async getTransactionReceipt() {
        attempts += 1;
        return { status: "reverted" as const };
      },
    },
    txHash:
      "0x3333333333333333333333333333333333333333333333333333333333333333",
  });

  assert.deepEqual(receipt, { status: "reverted" });
  assert.equal(attempts, 1);
});

test("anchoring receipt polling surfaces RPC failures", async () => {
  await assert.rejects(
    waitForSubmittedTransactionReceipt({
      attempts: 2,
      intervalMs: 1,
      publicClient: {
        async getTransactionReceipt() {
          throw new Error("Proof registry RPC unavailable.");
        },
      },
      txHash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
    }),
    /Proof registry RPC unavailable/,
  );
});

test("falls back to native Celo gas when the fee currency cannot pay", async () => {
  const calls: Record<string, unknown>[] = [];
  const txHash =
    "0x2222222222222222222222222222222222222222222222222222222222222222";

  const result = await writeContractWithCeloFeeFallback({
    chainConfig: getProductChain("celo"),
    request: {
      account: "0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c",
      address: "0xE69755E4249C4978c39FbE847Ca9674ce7Af3505",
    },
    walletClient: {
      async writeContract(request) {
        calls.push(request);

        if ("feeCurrency" in request) {
          throw new Error("gas required exceeds allowance (0)");
        }

        return txHash;
      },
    },
  });

  assert.equal(result, txHash);
  assert.equal(
    calls[0].feeCurrency,
    getProductChain("celo").billingCurrency.feeCurrencyAddress
  );
  assert.equal("feeCurrency" in calls[1], false);
});

test("preserves Celo attribution through fee currency fallback", async () => {
  const calls: Record<string, unknown>[] = [];
  const dataSuffix =
    "0x63656c6f5f316139383733383633366462110080218021802180218021802180218021";

  await writeContractWithCeloFeeFallback({
    chainConfig: getProductChain("celo"),
    request: {
      address: "0xE69755E4249C4978c39FbE847Ca9674ce7Af3505",
      dataSuffix,
    },
    walletClient: {
      async writeContract(request) {
        calls.push(request);

        if ("feeCurrency" in request) {
          throw new Error("fee currency allowance is zero");
        }

        return "0x2222222222222222222222222222222222222222222222222222222222222222";
      },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].dataSuffix, dataSuffix);
  assert.equal(calls[1].dataSuffix, dataSuffix);
  assert.equal("feeCurrency" in calls[1], false);
});
