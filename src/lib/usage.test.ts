import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbiItem,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { mockFetch, withEnv } from "../test/helpers";
import type { AuthenticatedAccount } from "./server/account-auth";
import { createWalletSessionForVerifiedAddress } from "./server/wallet-auth";
import {
  buildUsageQuote,
  buildWithdrawRequestForChain,
  readUsageReservation,
  refundResearchUsage,
  reserveResearchUsage,
  settleResearchUsage,
  UsageHttpError,
  usageErrorResponse,
  verifyUsageDeposit,
  type UsageReservation,
} from "./usage";

const validHash = `0x${"1".repeat(64)}`;
const validVault = "0x1111111111111111111111111111111111111111";
const depositSender = "0x2222222222222222222222222222222222222222";
const depositClaimSecret = `0x${"3".repeat(64)}` as Hex;
const depositReference = keccak256(depositClaimSecret);
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

test("usage error responses preserve safe status and messages", async () => {
  const known = usageErrorResponse(new UsageHttpError(402, "Balance required."));
  const storage = usageErrorResponse(
    new UsageHttpError(500, "relation langclaw_usage does not exist"),
  );
  const unexpected = usageErrorResponse(new Error("Storage failed."));
  const unknown = usageErrorResponse({ reason: "unknown" });

  assert.equal(known.status, 402);
  assert.deepEqual(await known.json(), { error: "Balance required." });
  assert.equal(storage.status, 500);
  assert.deepEqual(await storage.json(), { error: "Usage billing failed." });
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), { error: "Usage billing failed." });
  assert.equal(unknown.status, 500);
  assert.deepEqual(await unknown.json(), { error: "Usage billing failed." });
});

test("usage quotes honor explicit, audio, and default estimates", async () => {
  await withEnv(
    {
      LANGCLAW_USAGE_ESTIMATED_AUDIO_COMPLETION_TOKENS: "240",
      LANGCLAW_USAGE_ESTIMATED_COMPLETION_TOKENS: "invalid",
      LANGCLAW_USAGE_ESTIMATED_PROMPT_TOKENS: "invalid",
      OPENAI_COMPLETION_PRICE_NEURON_PER_TOKEN: "5",
      OPENAI_PROMPT_PRICE_NEURON_PER_TOKEN: "2",
    },
    async () => {
      const defaults = await buildUsageQuote();
      const audio = await buildUsageQuote({ service: "audio" });
      const explicit = await buildUsageQuote({
        chain: "mantle",
        estimatedCompletionTokens: 3,
        estimatedPromptTokens: 12,
        model: "gpt-explicit",
      });

      assert.equal(defaults.estimatedPromptTokens, 6000);
      assert.equal(defaults.estimatedCompletionTokens, 1200);
      assert.equal(audio.estimatedCompletionTokens, 240);
      assert.equal(explicit.chain, "mantle");
      assert.equal(explicit.model, "gpt-explicit");
      assert.equal(explicit.estimatedCostNeuron, "39");
      assert.equal(explicit.estimatedCostNative, "0.000000000000000039");
    }
  );

  await withEnv(
    {
      OPENAI_COMPLETION_PRICE_NEURON_PER_TOKEN: "0",
      OPENAI_PROMPT_PRICE_NEURON_PER_TOKEN: "invalid",
    },
    async () => {
      await assert.rejects(
        buildUsageQuote(),
        (error: unknown) =>
          error instanceof UsageHttpError &&
          error.status === 503 &&
          /pricing is not configured/.test(error.message)
      );
    }
  );
});

test("usage reservations map success, balance, storage, and empty results", async () => {
  await withEnv(
    {
      OPENAI_COMPLETION_PRICE_NEURON_PER_TOKEN: "5",
      OPENAI_PROMPT_PRICE_NEURON_PER_TOKEN: "1",
    },
    async () => {
      const quoteInput = {
        estimatedCompletionTokens: 2,
        estimatedPromptTokens: 10,
      };
      const success = await reserveResearchUsage(
        buildAccountAuth({
          async rpc() {
            return {
              data: {
                balance_after_neuron: "980",
                balance_before_neuron: "1000",
              },
              error: null,
            };
          },
        }),
        quoteInput
      );

      assert.equal(success.reservedNeuron, "20");
      assert.equal(success.balanceBefore, "1000");
      assert.equal(success.balanceAfterReserve, "980");

      await assert.rejects(
        reserveResearchUsage(
          buildAccountAuth({
            async rpc() {
              return {
                data: null,
                error: { message: "insufficient_balance" },
              };
            },
          }),
          quoteInput
        ),
        (error: unknown) =>
          error instanceof UsageHttpError &&
          error.status === 402 &&
          error.message === "Insufficient USDT balance."
      );

      await assert.rejects(
        reserveResearchUsage(
          buildAccountAuth({
            async rpc() {
              return { data: null, error: { message: "database offline" } };
            },
          }),
          quoteInput
        ),
        (error: unknown) =>
          error instanceof UsageHttpError &&
          error.status === 500 &&
          error.message === "database offline"
      );

      await assert.rejects(
        reserveResearchUsage(
          buildAccountAuth({
            async rpc() {
              return { data: [], error: null };
            },
          }),
          quoteInput
        ),
        (error: unknown) =>
          error instanceof UsageHttpError &&
          error.status === 500 &&
          error.message === "Usage reservation was not created."
      );
    }
  );
});

test("usage reservation reads normalize stored values and storage failures", async () => {
  const stored = await readUsageReservation(
    buildAccountAuth(
      buildReservationQuery({
        data: {
          balance_after_reserve_neuron: 123,
          balance_before_neuron: Number.NaN,
          completion_price_neuron: 5n,
          estimated_completion_tokens: "20",
          estimated_prompt_tokens: "100",
          id: "reservation-stored",
          model: "gpt-stored",
          native_symbol: "",
          prompt_price_neuron: 2,
          reserved_neuron: "invalid",
          wallet_address: depositSender,
        },
        error: null,
      })
    ),
    "reservation-stored"
  );

  assert.equal(stored.nativeSymbol, "USDT");
  assert.equal(stored.promptPriceNeuron, "2");
  assert.equal(stored.completionPriceNeuron, "5");
  assert.equal(stored.reservedNeuron, "0");
  assert.equal(stored.balanceBefore, "0");
  assert.equal(stored.balanceAfterReserve, "123");

  await assert.rejects(
    readUsageReservation(
      buildAccountAuth(
        buildReservationQuery({
          data: null,
          error: { message: "reservation query failed" },
        })
      ),
      "reservation-error"
    ),
    (error: unknown) =>
      error instanceof UsageHttpError &&
      error.status === 500 &&
      error.message === "reservation query failed"
  );

  await assert.rejects(
    readUsageReservation(
      buildAccountAuth(buildReservationQuery({ data: null, error: null })),
      "reservation-missing"
    ),
    (error: unknown) =>
      error instanceof UsageHttpError &&
      error.status === 404 &&
      error.message === "Usage reservation was not found."
  );
});

test("withdrawal validates wallet ownership and builds a wallet-scoped request", async () => {
  const requests: Array<{ body: Record<string, unknown>; path: string }> = [];
  const restoreFetch = mockFetch((url, init) => {
    const parsedUrl = new URL(url);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ body, path: parsedUrl.pathname });

    if (parsedUrl.pathname.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-withdrawal",
        wallet_address: depositSender,
      });
    }

    assert.match(parsedUrl.pathname, /\/langclaw_usage_accounts$/);
    return Response.json({
      available_neuron: "7500000",
      chain_id: 42220,
      chain_slug: "celo",
      lifetime_charged_neuron: "500000",
      lifetime_deposited_neuron: "8000000",
      native_symbol: "USDT",
      reserved_neuron: "0",
      wallet_address: depositSender,
      wallet_user_id: "wallet-user-withdrawal",
    });
  });

  try {
    await withEnv(
      {
        CELO_LANGCLAW_USAGE_VAULT_ADDRESS: validVault,
        LANGCLAW_WALLET_SESSION_SECRET: "usage-withdrawal-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const walletSession =
          createWalletSessionForVerifiedAddress(depositSender);

        await assert.rejects(
          buildWithdrawRequestForChain(
            {
              address: validVault,
              sessionToken: walletSession.sessionToken,
            },
            "celo"
          ),
          (error: unknown) =>
            error instanceof UsageHttpError &&
            error.status === 401 &&
            error.message === "Wallet signature is required."
        );

        const request = await buildWithdrawRequestForChain(
          {
            address: depositSender,
            sessionToken: walletSession.sessionToken,
          },
          "celo"
        );

        assert.equal(request.functionName, "withdraw");
        assert.equal(request.wallet, depositSender);
        assert.equal(request.vaultAddress, validVault);
        assert.equal(request.billingCurrency.symbol, "USDT");
        assert.equal(request.balance.availableNeuron, "7500000");
        assert.equal(request.balance.availableNative, "7.5");
        assert.equal(requests.length, 2);
        assert.equal(
          requests[1]?.body.wallet_user_id,
          "wallet-user-withdrawal"
        );
      }
    );
  } finally {
    restoreFetch();
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

test("refund rejects an empty storage result instead of inferring released funds", async () => {
  const restoreFetch = mockFetch((url) => {
    assert.match(url, /langclaw_usage_refund_reservation$/);
    return Response.json([]);
  });

  try {
    await withEnv(
      {
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        await assert.rejects(
          refundResearchUsage(buildUsageReservation(), "provider failed"),
          (error: unknown) =>
            error instanceof UsageHttpError &&
            error.status === 500 &&
            error.message === "Usage refund was not finalized."
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

test("deposit verification rejects public proof without a private claim", async () => {
  const storageCalls = { credits: 0, walletUsers: 0 };

  await assert.rejects(
    runDepositVerificationCase({
      amount: 2_000_000n,
      includeClaimSecret: false,
      storageCalls,
      tokenAddress: "0x0000000000000000000000000000000000000000",
      txHash: `0x${"9".repeat(64)}` as Hex,
      value: 2_000_000n,
    }),
    (error: unknown) =>
      error instanceof UsageHttpError &&
      error.status === 401 &&
      error.message ===
        "Private deposit claim or wallet authentication is required.",
  );

  assert.deepEqual(storageCalls, { credits: 0, walletUsers: 0 });
});

test("deposit verification rejects malformed and mismatched private claims", async () => {
  for (const [index, claimSecret] of [
    null,
    "not-a-claim",
    `0x${"4".repeat(64)}`,
  ].entries()) {
    await assert.rejects(
      runDepositVerificationCase({
        amount: 2_000_000n,
        claimSecret,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        txHash: `0x${String(index + 10).padStart(64, "0")}` as Hex,
        value: 2_000_000n,
      }),
      (error: unknown) =>
        error instanceof UsageHttpError &&
        error.status === 401 &&
        error.message ===
          "Private deposit claim or wallet authentication is required.",
    );
  }
});

test("authenticated deposit verification does not require a private claim", async () => {
  const verified = await runDepositVerificationCase({
    amount: 2_000_000n,
    includeClaimSecret: false,
    tokenAddress: "0x0000000000000000000000000000000000000000",
    txHash: `0x${"a".repeat(64)}` as Hex,
    useWalletSession: true,
    value: 2_000_000n,
  });

  assert.equal(verified.result.credited, true);
  assert.equal(verified.result.walletSession, undefined);
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

function buildAccountAuth(supabase: unknown): { account: AuthenticatedAccount } {
  return {
    account: {
      authMethod: "api_key",
      supabase: supabase as AuthenticatedAccount["supabase"],
      walletUser: {
        id: "wallet-user-usage",
        walletAddress: depositSender,
      },
    },
  };
}

function buildReservationQuery(result: {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}) {
  const query = {
    eq() {
      return query;
    },
    async maybeSingle() {
      return result;
    },
    select() {
      return query;
    },
  };

  return {
    from() {
      return query;
    },
  };
}

async function runDepositVerificationCase({
  amount,
  claimSecret = depositClaimSecret,
  includeClaimSecret = true,
  storageCalls,
  tokenAddress,
  txHash,
  useWalletSession = false,
  value,
}: {
  amount: bigint;
  claimSecret?: unknown;
  includeClaimSecret?: boolean;
  storageCalls?: { credits: number; walletUsers: number };
  tokenAddress: Address;
  txHash: Hex;
  useWalletSession?: boolean;
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
      if (storageCalls) {
        storageCalls.walletUsers += 1;
      }

      return Response.json({
        id: "wallet-user-deposit",
        wallet_address: depositSender,
      });
    }

    assert.match(
      parsedUrl.pathname,
      /\/rpc\/langclaw_usage_credit_deposit$/
    );
    if (storageCalls) {
      storageCalls.credits += 1;
    }
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
    const input: Parameters<typeof verifyUsageDeposit>[0] & {
      claimSecret?: unknown;
    } = {
      reference: depositReference,
      txHash,
      wallet: { address: depositSender },
    };

    if (includeClaimSecret) {
      input.claimSecret = claimSecret;
    }

    const result = await withEnv(
      {
        CELO_CHAIN_RPC_URL: "https://celo-rpc.test",
        CELO_LANGCLAW_USAGE_VAULT_ADDRESS: validVault,
        CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN: tokenAddress,
        LANGCLAW_WALLET_SESSION_SECRET: "usage-deposit-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      () => {
        if (useWalletSession) {
          const walletSession =
            createWalletSessionForVerifiedAddress(depositSender);
          input.wallet = {
            address: depositSender,
            sessionToken: walletSession.sessionToken,
          };
        }

        return verifyUsageDeposit(input);
      }
    );

    return { creditBody, result };
  } finally {
    restoreFetch();
  }
}
