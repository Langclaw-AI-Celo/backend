import assert from "node:assert/strict";
import test from "node:test";

import { fromDataSuffix } from "@celo/attribution-tags";

import { getProductChain } from "../chain-config";
import {
  persistTradingJournalRecord,
  prepareTradingJournalWriteRequest,
  waitForSubmittedTransactionReceipt,
} from "./journal";
import { withEnv } from "../../test/helpers";

const txHash = `0x${"a".repeat(64)}` as `0x${string}`;

test("trading journal proof returns prepared when chain recording is disabled", async () => {
  await withEnv(
    {
      LANGCLAW_TRADING_JOURNAL_ADDRESS: "0x1111111111111111111111111111111111111111",
      CELO_ERC8004_AGENT_ID: "94",
      CELO_TRADING_JOURNAL_ENABLED: "false",
    },
    async () => {
      const proof = await persistTradingJournalRecord({
        action: "buy",
        decisionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        evidenceUri: "langclaw://strategy/run-1",
        market: "celo:0x471ece3750da237f93b8e339c536989b8978a438",
        pnlBps: 120,
        resultHash:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        runId: "run-1",
        status: "backtested",
        strategyId: "celo-liquidity-momentum-v1",
      });

      assert.equal(proof.status, "prepared");
      assert.equal(proof.agentId, "94");
      assert.equal(proof.chainId, 42220);
      assert.match(proof.error ?? "", /CELO_TRADING_JOURNAL_ENABLED/);
    }
  );
});

test("trading journal proof uses selected Celo chain config", async () => {
  await withEnv(
    {
      CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS:
        "0x2222222222222222222222222222222222222222",
      CELO_TRADING_JOURNAL_ENABLED: "false",
    },
    async () => {
      const proof = await persistTradingJournalRecord({
        action: "hold",
        chain: "celo",
        decisionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        evidenceUri: "langclaw://strategy/run-celo",
        market: "celo:0x471ece3750da237f93b8e339c536989b8978a438",
        pnlBps: 0,
        resultHash:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        runId: "run-celo",
        status: "backtested",
        strategyId: "celo-liquidity-momentum-v1",
      });

      assert.equal(proof.status, "prepared");
      assert.equal(proof.chain, "celo");
      assert.equal(proof.chainId, 42220);
      assert.equal(proof.chainName, "Celo");
      assert.match(proof.error ?? "", /CELO_TRADING_JOURNAL_ENABLED/);
    }
  );
});

test("trading journal proof prefers ERC-8004 agent id over Self agent id", async () => {
  await withEnv(
    {
      CELO_ERC8004_AGENT_ID: "9109",
      CELO_SELF_AGENT_ID: "133",
      CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS:
        "0x2222222222222222222222222222222222222222",
      CELO_TRADING_JOURNAL_ENABLED: "false",
    },
    async () => {
      const proof = await persistTradingJournalRecord({
        action: "hold",
        chain: "celo",
        decisionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        evidenceUri: "langclaw://strategy/run-celo",
        market: "celo:0x471ece3750da237f93b8e339c536989b8978a438",
        pnlBps: 0,
        resultHash:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
        runId: "run-celo",
        status: "backtested",
        strategyId: "celo-liquidity-momentum-v1",
      });

      assert.equal(proof.status, "prepared");
      assert.equal(proof.agentId, "9109");
    }
  );
});

test("journal receipt polling expires when the receipt remains missing", async () => {
  let attempts = 0;
  const receipt = await waitForSubmittedTransactionReceipt({
    attempts: 2,
    intervalMs: 1,
    publicClient: {
      async getTransactionReceipt() {
        attempts += 1;
        throw new Error(
          `Transaction receipt with hash ${txHash} could not be found.`,
        );
      },
    },
    txHash,
  });

  assert.equal(receipt, undefined);
  assert.equal(attempts, 2);
});

test("journal receipt polling surfaces RPC failures", async () => {
  await assert.rejects(
    waitForSubmittedTransactionReceipt({
      attempts: 2,
      intervalMs: 1,
      publicClient: {
        async getTransactionReceipt() {
          throw new Error("Journal RPC unavailable.");
        },
      },
      txHash,
    }),
    /Journal RPC unavailable/,
  );
});

test("prepares Celo strategy proof writes with fee currency and attribution", async () => {
  await withEnv(
    {
      CELO_ATTRIBUTION_CODE: undefined,
      CELO_ATTRIBUTION_HOSTNAME: "langclawcelo.vercel.app",
    },
    async () => {
      const request = await prepareTradingJournalWriteRequest(
        getProductChain("celo"),
        { functionName: "recordStrategyRun" }
      );

      assert.equal(
        request.feeCurrency,
        getProductChain("celo").billingCurrency.feeCurrencyAddress
      );
      assert.deepEqual(fromDataSuffix(request.dataSuffix), {
        codes: ["celo_1a98738636db"],
        schemaId: 0,
      });
      assert.equal(request.functionName, "recordStrategyRun");
    }
  );
});
