import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  toHex,
  type Address,
  type Hex,
} from "viem";

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
const depositSender = "0x2222222222222222222222222222222222222222";
const depositReference = `0x${"3".repeat(64)}`;
const depositEvent = parseAbiItem(
  "event Deposit(address indexed payer,uint256 amount,bytes32 indexed depositReference)"
);

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

test("verifies native and token deposits before crediting balances", async () => {
  const native = await runDepositVerificationCase({
    amount: 2_000_000n,
    tokenAddress: "0x0000000000000000000000000000000000000000",
    txHash: `0x${"4".repeat(64)}` as Hex,
    value: 2_000_000n,
  });
  const token = await runDepositVerificationCase({
    amount: 25_000_000n,
    tokenAddress: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    txHash: `0x${"5".repeat(64)}` as Hex,
    value: 0n,
  });

  assert.equal(native.result.amountNeuron, "2000000");
  assert.equal(native.result.credited, true);
  assert.equal(native.creditBody.p_amount_neuron, "2000000");
  assert.equal(native.creditBody.p_reference, depositReference);
  assert.equal(native.result.walletSession?.authMethod, "session");

  assert.equal(token.result.amountNeuron, "25000000");
  assert.equal(token.result.credited, true);
  assert.equal(token.creditBody.p_amount_neuron, "25000000");
  assert.equal(token.creditBody.p_wallet_address, depositSender);
  assert.equal(token.result.walletSession?.authMethod, "session");
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

async function runDepositVerificationCase({
  amount,
  tokenAddress,
  txHash,
  value,
}: {
  amount: bigint;
  tokenAddress: Address;
  txHash: Hex;
  value: bigint;
}) {
  let creditBody: Record<string, unknown> = {};
  const topics = encodeEventTopics({
    abi: [depositEvent],
    eventName: "Deposit",
    args: {
      depositReference,
      payer: depositSender,
    },
  });
  const blockHash = `0x${"6".repeat(64)}` as Hex;
  const restoreFetch = mockFetch((url, init) => {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname === "celo-rpc.test") {
      const request = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
      };

      if (request.method === "eth_getTransactionByHash") {
        return Response.json({
          id: request.id,
          jsonrpc: "2.0",
          result: {
            blockHash,
            blockNumber: "0x10",
            from: depositSender,
            gas: "0x5208",
            gasPrice: "0x1",
            hash: txHash,
            input: "0x",
            nonce: "0x1",
            r: `0x${"7".repeat(64)}`,
            s: `0x${"8".repeat(64)}`,
            to: validVault,
            transactionIndex: "0x0",
            type: "0x0",
            v: "0x1b",
            value: toHex(value),
          },
        });
      }

      assert.equal(request.method, "eth_getTransactionReceipt");
      return Response.json({
        id: request.id,
        jsonrpc: "2.0",
        result: {
          blockHash,
          blockNumber: "0x10",
          contractAddress: null,
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          from: depositSender,
          gasUsed: "0x5208",
          logs: [
            {
              address: validVault,
              blockHash,
              blockNumber: "0x10",
              data: encodeAbiParameters([{ type: "uint256" }], [amount]),
              logIndex: "0x0",
              removed: false,
              topics,
              transactionHash: txHash,
              transactionIndex: "0x0",
            },
          ],
          logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1",
          to: validVault,
          transactionHash: txHash,
          transactionIndex: "0x0",
          type: "0x0",
        },
      });
    }

    if (parsedUrl.pathname.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-deposit",
        wallet_address: depositSender,
      });
    }

    assert.match(
      parsedUrl.pathname,
      /\/rpc\/langclaw_usage_credit_deposit$/
    );
    creditBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json([
      {
        balance_after_neuron: amount.toString(),
        balance_before_neuron: "0",
        credited: true,
      },
    ]);
  });

  try {
    const result = await withEnv(
      {
        CELO_CHAIN_RPC_URL: "https://celo-rpc.test",
        CELO_LANGCLAW_USAGE_VAULT_ADDRESS: validVault,
        CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN: tokenAddress,
        LANGCLAW_WALLET_SESSION_SECRET: "usage-deposit-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      () =>
        verifyUsageDeposit({
          reference: depositReference,
          txHash,
          wallet: { address: depositSender },
        })
    );

    return { creditBody, result };
  } finally {
    restoreFetch();
  }
}
