import assert from "node:assert/strict";
import test from "node:test";

import { persistTradingJournalRecord } from "./journal";
import { withEnv } from "../../test/helpers";

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
