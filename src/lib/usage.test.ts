import assert from "node:assert/strict";
import test from "node:test";

import { withEnv } from "../test/helpers";
import {
  buildWithdrawRequestForChain,
  UsageHttpError,
  verifyUsageDeposit,
} from "./usage";

const validHash = `0x${"1".repeat(64)}`;
const validVault = "0x1111111111111111111111111111111111111111";

test("deposit verification rejects malformed transaction hashes before RPC access", async () => {
  for (const txHash of [undefined, "0x1234", `0x${"z".repeat(64)}`]) {
    await assert.rejects(
      verifyUsageDeposit({ txHash, wallet: {} }),
      (error: unknown) =>
        error instanceof UsageHttpError &&
        error.status === 400 &&
        error.message === "A valid txHash is required.",
    );
  }
});

test("deposit verification requires a configured vault before RPC access", async () => {
  await withEnv(
    { CELO_LANGCLAW_USAGE_VAULT_ADDRESS: undefined },
    async () => {
      await assert.rejects(
        verifyUsageDeposit({ txHash: validHash, wallet: {} }),
        (error: unknown) =>
          error instanceof UsageHttpError &&
          error.status === 503 &&
          error.message ===
            "CELO_LANGCLAW_USAGE_VAULT_ADDRESS is not configured.",
      );
    },
  );
});

test("deposit verification rejects an invalid configured token address", async () => {
  await withEnv(
    {
      CELO_LANGCLAW_USAGE_VAULT_ADDRESS: validVault,
      CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN: "not-an-address",
    },
    async () => {
      await assert.rejects(
        verifyUsageDeposit({ txHash: validHash, wallet: {} }),
        (error: unknown) =>
          error instanceof UsageHttpError &&
          error.status === 503 &&
          error.message ===
            "CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN is invalid.",
      );
    },
  );
});

test("withdrawal requests require a verified wallet session", async () => {
  for (const wallet of [{}, { address: validVault }]) {
    await assert.rejects(
      buildWithdrawRequestForChain(wallet, "celo"),
      (error: unknown) =>
        error instanceof UsageHttpError &&
        error.status === 401 &&
        error.message === "Wallet signature is required.",
    );
  }
});
