import assert from "node:assert/strict";
import test from "node:test";

import { mockFetch, withEnv } from "../test/helpers";
import {
  buildWithdrawRequestForChain,
  refundResearchUsage,
  settleResearchUsage,
  UsageHttpError,
  verifyUsageDeposit,
  type UsageReservation,
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

test("settlement and refund calls remain idempotent for one reservation", async () => {
  const rpcBodies: Array<Record<string, unknown>> = [];
  const restoreFetch = mockFetch((url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    rpcBodies.push(body);

    if (url.endsWith("/langclaw_usage_finalize_reservation")) {
      return Response.json([
        {
          balance_after_neuron: "955",
          charged_neuron: "45",
          released_neuron: "55",
          status: "completed",
        },
      ]);
    }

    assert.match(url, /langclaw_usage_refund_reservation$/);
    return Response.json([
      {
        balance_after_neuron: "1000",
        released_neuron: "100",
      },
    ]);
  });

  try {
    await withEnv(
      {
        LANGCLAW_USAGE_MARKUP_BPS: "3000",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const reservation = buildUsageReservation();
        const firstSettlement = await settleResearchUsage({
          reservation,
          tokenUsage: {
            completionTokens: 5,
            promptTokens: 10,
            totalTokens: 15,
          },
          topic: "Celo smart money",
        });
        const secondSettlement = await settleResearchUsage({
          reservation,
          tokenUsage: {
            completionTokens: 5,
            promptTokens: 10,
            totalTokens: 15,
          },
          topic: "Celo smart money",
        });
        const firstRefund = await refundResearchUsage(
          reservation,
          "provider failed"
        );
        const secondRefund = await refundResearchUsage(
          reservation,
          "provider failed"
        );

        assert.equal(firstSettlement.chargedNeuron, "45");
        assert.equal(secondSettlement.chargedNeuron, "45");
        assert.equal(firstRefund.releasedNeuron, "100");
        assert.equal(secondRefund.releasedNeuron, "100");
        assert.equal(rpcBodies.length, 4);
        assert.equal(
          new Set(rpcBodies.map((body) => body.p_reservation_id)).size,
          1
        );
      }
    );
  } finally {
    restoreFetch();
  }
});

function buildUsageReservation(): UsageReservation {
  return {
    balanceAfterReserve: "900",
    balanceBefore: "1000",
    chain: "celo",
    chainId: 42220,
    chainName: "Celo",
    completionPriceNeuron: "5",
    estimatedCompletionTokens: 10,
    estimatedPromptTokens: 50,
    model: "gpt-5-mini",
    nativeSymbol: "USDT",
    promptPriceNeuron: "1",
    reservationId: "reservation-idempotent",
    reservedNeuron: "100",
    wallet: validVault,
  };
}
