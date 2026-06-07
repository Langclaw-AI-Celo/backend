import assert from "node:assert/strict";
import test from "node:test";

import { buildProofReadinessReport } from "./proof-readiness";
import { withEnv } from "../test/helpers";

const testPrivateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const registryAddress = "0xe69755e4249c4978c39fbe847ca9674ce7af3505";

function buildClient({
  latestAgentId = 94n,
  latestDecisionId = 1n,
  latestTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}: {
  latestAgentId?: bigint;
  latestDecisionId?: bigint;
  latestTxHash?: string;
} = {}) {
  return {
    async getBalance() {
      return 1_000_000_000_000_000_000n;
    },
    async getBlockNumber() {
      return 95522250n;
    },
    async getChainId() {
      return 42220;
    },
    async getLogs() {
      return [
        {
          args: { decisionId: latestDecisionId },
          transactionHash: latestTxHash,
        },
      ];
    },
    async readContract({ functionName }: { functionName: string }) {
      if (functionName === "nextDecisionId") {
        return latestDecisionId + 1n;
      }

      return {
        agentId: latestAgentId,
        createdAt: 1_780_000_000n,
        decisionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        evidenceUri: "langclaw://evidence/run/hash",
        recorder: "0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c",
        runId: "run-1",
        signalType: "smart-money",
      };
    },
  };
}

const readyEnv = {
  CELO_AGENT_PRIVATE_KEY: testPrivateKey,
  CELO_CHAIN_ENABLED: "true",
  CELO_CHAIN_ID: "42220",
  CELO_CHAIN_RPC_URL: "https://forno.celo.test",
  CELO_ERC8004_AGENT_ID: "94",
  CELO_INTEL_PROOF_ENABLED: "true",
  CELO_LANGCLAW_REGISTRY_ADDRESS: registryAddress,
};

test("proof readiness passes when Celo proof env and registry are usable", async () => {
  await withEnv(readyEnv, async () => {
    const report = await buildProofReadinessReport({
      publicClient: buildClient(),
    });

    assert.equal(report.ready, true);
    assert.equal(report.status, "ready");
    assert.equal(report.chain, "celo");
    assert.equal(report.latestDecision?.agentId, "94");
    assert.equal(
      report.latestDecision?.txHash,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert.ok(report.checks.every((check) => check.status === "pass"));
    assert.equal(
      report.checks.find((check) => check.id === "erc8004-agent-id")?.label,
      "CELO_ERC8004_AGENT_ID"
    );
  });
});

test("proof readiness fails when the recorder key is missing", async () => {
  await withEnv(
    {
      ...readyEnv,
      CELO_AGENT_PRIVATE_KEY: undefined,
      CELO_PRIVATE_KEY: undefined,
    },
    async () => {
      const report = await buildProofReadinessReport({
        publicClient: buildClient(),
      });

      assert.equal(report.ready, false);
      assert.equal(report.status, "not_ready");
      assert.equal(
        report.checks.find((check) => check.id === "agent-private-key")?.status,
        "fail"
      );
    }
  );
});

test("proof readiness accepts CELO_PRIVATE_KEY as the recorder fallback", async () => {
  await withEnv(
    {
      ...readyEnv,
      CELO_AGENT_PRIVATE_KEY: undefined,
      CELO_PRIVATE_KEY: testPrivateKey,
    },
    async () => {
      const report = await buildProofReadinessReport({
        publicClient: buildClient(),
      });

      assert.equal(report.ready, true);
      assert.equal(report.status, "ready");
      assert.equal(
        report.checks.find((check) => check.id === "agent-private-key")?.status,
        "pass"
      );
    }
  );
});

test("proof readiness warns when the latest decision belongs to another agent", async () => {
  await withEnv(readyEnv, async () => {
    const report = await buildProofReadinessReport({
      publicClient: buildClient({
        latestAgentId: 9109n,
        latestDecisionId: 2n,
      }),
    });

    assert.equal(report.ready, true);
    assert.equal(report.status, "warning");
    assert.equal(report.latestDecision?.agentId, "9109");
    assert.equal(report.latestDecision?.decisionId, "2");
    assert.equal(
      report.checks.find((check) => check.id === "latest-decision")?.status,
      "warn"
    );
    assert.match(
      report.checks.find((check) => check.id === "latest-decision")?.summary ?? "",
      /configured ERC-8004 agent 94/
    );
  });
});

test("proof readiness prefers the ERC-8004 agent id over the Self agent id", async () => {
  await withEnv(
    {
      ...readyEnv,
      CELO_ERC8004_AGENT_ID: "9109",
      CELO_SELF_AGENT_ID: "133",
    },
    async () => {
      const report = await buildProofReadinessReport({
        publicClient: buildClient({
          latestAgentId: 9109n,
          latestDecisionId: 35n,
        }),
      });

      assert.equal(report.ready, true);
      assert.equal(report.status, "ready");
      assert.equal(
        report.checks.find((check) => check.id === "erc8004-agent-id")?.label,
        "CELO_ERC8004_AGENT_ID"
      );
      assert.equal(
        report.checks.find((check) => check.id === "latest-decision")?.status,
        "pass"
      );
    }
  );
});

test("proof readiness surfaces the Self Agent ID when it is the preferred proof agent", async () => {
  await withEnv(
    {
      ...readyEnv,
      CELO_ERC8004_AGENT_ID: undefined,
      CELO_SELF_AGENT_ID: "133",
    },
    async () => {
      const report = await buildProofReadinessReport({
        publicClient: buildClient({
          latestAgentId: 9109n,
          latestDecisionId: 35n,
        }),
      });

      assert.equal(report.status, "warning");
      assert.equal(
        report.checks.find((check) => check.id === "erc8004-agent-id")?.label,
        "CELO_SELF_AGENT_ID"
      );
      assert.match(
        report.checks.find((check) => check.id === "erc8004-agent-id")?.summary ?? "",
        /Self Agent ID 133/
      );
      assert.match(
        report.checks.find((check) => check.id === "latest-decision")?.summary ?? "",
        /preferred Self Agent ID 133/
      );
    }
  );
});

test("proof readiness keeps the latest decision run metadata in warning output", async () => {
  await withEnv(
    {
      ...readyEnv,
      CELO_SELF_AGENT_ID: "133",
    },
    async () => {
      const report = await buildProofReadinessReport({
        publicClient: buildClient({
          latestAgentId: 9109n,
          latestDecisionId: 35n,
        }),
      });

      assert.equal(report.status, "warning");
      assert.equal(report.latestDecision?.decisionId, "35");
      assert.equal(report.latestDecision?.runId, "run-1");
      assert.equal(
        report.latestDecision?.evidenceUri,
        "langclaw://evidence/run/hash"
      );
      assert.equal(
        report.latestDecision?.txHash,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      assert.equal(
        report.checks.find((check) => check.id === "latest-decision")?.detail?.decisionId,
        "35"
      );
      assert.equal(
        report.checks.find((check) => check.id === "latest-decision")?.detail?.runId,
        "run-1"
      );
      assert.equal(
        report.checks.find((check) => check.id === "latest-decision")?.detail?.txHash,
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
    }
  );
});

test("proof readiness warns when direct on-chain tool proof is disabled", async () => {
  await withEnv(
    {
      ...readyEnv,
      CELO_INTEL_PROOF_ENABLED: "false",
    },
    async () => {
      const report = await buildProofReadinessReport({
        publicClient: buildClient(),
      });

      assert.equal(report.ready, true);
      assert.equal(report.status, "warning");
      assert.equal(
        report.checks.find((check) => check.id === "onchain-tool-proof-enabled")?.status,
        "warn"
      );
    }
  );
});
