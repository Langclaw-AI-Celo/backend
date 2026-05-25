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
