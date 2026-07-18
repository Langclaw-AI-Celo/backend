import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withEnv } from "../../test/helpers";
import {
  createRunId,
  createStepSessionId,
  runEvidenceAgentStep,
  runPlannerAgentStep,
  runTrendAgentStep,
  runVerifierAgentStep,
  shouldRunOpenClawWorkflow,
} from "./openclaw-workflow";
import type { SourceCard } from "./types";

const sources: SourceCard[] = [
  {
    id: "source-x",
    type: "x_post",
    title: "<b>Celo</b> &amp; agent signal",
    url: "https://example.com/x",
    excerpt: "Wallet activity &quot;increased&quot;.",
    provider: "X",
  },
  {
    id: "source-github",
    type: "github_repo",
    title: "Celo agent repository",
    url: "https://example.com/github",
    excerpt: "Implementation evidence",
    provider: "GitHub",
  },
];

test("builds deterministic workflow fallbacks when OpenClaw is disabled", async () => {
  const runId = createRunId();
  const planner = await runPlannerAgentStep("Celo agents", false, runId);
  const trend = await runTrendAgentStep(
    "Celo agents",
    sources,
    [{ provider: "Tavily", message: "timeout" }],
    planner.output,
    false,
    runId
  );
  const evidence = await runEvidenceAgentStep(
    "Celo agents",
    sources,
    [],
    trend.output,
    false,
    runId
  );
  const verifier = await runVerifierAgentStep(
    "Celo agents",
    sources,
    trend.output,
    evidence.output,
    false,
    runId
  );

  assert.equal(planner.meta.execution, "deterministic-fallback");
  assert.equal(planner.output.providerPlan.length, 4);
  assert.equal(trend.output.rankedTrends.length, 2);
  assert.equal(evidence.output.storageStatus, "prepared");
  assert.equal(verifier.output.chainStatus, "prepared");
  assert.match(verifier.output.briefHashInput, /^0x[a-f0-9]{64}$/);
  assert.equal(
    planner.meta.sessionId,
    createStepSessionId(runId, "planner")
  );
});

test("normalizes partial OpenClaw workflow payloads", async () => {
  const fixture = await createWorkflowCliFixture();

  try {
    await withEnv(
      {
        OPENCLAW_CLI_PATH: fixture.path,
        OPENCLAW_MODEL: "fixture-model",
        OPENCLAW_STEP_TIMEOUT_SECONDS: "2",
      },
      async () => {
        const runId = "normalization-run";
        const planner = await runPlannerAgentStep("Celo agents", true, runId);
        const trend = await runTrendAgentStep(
          "Celo agents",
          sources,
          [],
          planner.output,
          true,
          runId
        );
        const evidence = await runEvidenceAgentStep(
          "Celo agents",
          sources,
          [],
          trend.output,
          true,
          runId
        );
        const verifier = await runVerifierAgentStep(
          "Celo agents",
          sources,
          trend.output,
          evidence.output,
          true,
          runId
        );

        assert.equal(planner.meta.execution, "openclaw-agent");
        assert.equal(planner.meta.model, "fixture/provider-model");
        assert.equal(planner.output.providerPlan.length, 1);
        assert.equal(planner.output.providerPlan[0].provider, "X");
        assert.match(planner.output.providerPlan[0].query, /Celo agents/);
        assert.equal(
          planner.output.providerPlan[0].purpose,
          "Collect source-backed signals."
        );
        assert.deepEqual(planner.output.scoringFocus, ["evidence"]);

        assert.equal(trend.output.topTrend, "Wallet activity");
        assert.equal(trend.output.score, 58);
        assert.equal(trend.output.rankedTrends[0].score, 100);
        assert.deepEqual(trend.output.rankedTrends[0].sourceIds, ["source-x"]);

        assert.equal(evidence.output.storageStatus, "prepared");
        assert.match(evidence.output.evidenceUri, /^langclaw:\/\/evidence\//);
        assert.deepEqual(evidence.output.claimMap, [
          { claim: "Wallet activity increased", sourceIds: ["source-x"] },
        ]);

        assert.equal(verifier.output.chainStatus, "prepared");
        assert.equal(verifier.output.storageStatus, "prepared");
        assert.deepEqual(verifier.output.unsupportedClaims, ["Needs proof"]);
        assert.match(verifier.output.briefHashInput, /^0x[a-f0-9]{64}$/);
      }
    );
  } finally {
    await fixture.cleanup();
  }
});

test("honors the OpenClaw workflow enable flag", async () => {
  assert.equal(shouldRunOpenClawWorkflow(false), false);

  await withEnv({ OPENCLAW_WORKFLOW_ENABLED: "false" }, () => {
    assert.equal(shouldRunOpenClawWorkflow(true), false);
  });

  await withEnv({ OPENCLAW_WORKFLOW_ENABLED: "true" }, () => {
    assert.equal(shouldRunOpenClawWorkflow(true), true);
  });
});

async function createWorkflowCliFixture() {
  const directory = await mkdtemp(join(tmpdir(), "langclaw-workflow-"));
  const path = join(directory, "openclaw-fixture.mjs");
  const source = `#!/usr/bin/env node
const messageIndex = process.argv.indexOf("--message");
const prompt = messageIndex >= 0 ? process.argv[messageIndex + 1] : "";
let payload;

if (prompt.includes("Planner Agent")) {
  payload = {
    summary: "",
    providerPlan: [
      { provider: "X", query: "", purpose: "" },
      { provider: "Unknown", query: "ignored", purpose: "ignored" },
      null,
    ],
    scoringFocus: ["evidence", 42],
  };
} else if (prompt.includes("Trend Scorer Agent")) {
  payload = {
    summary: "Normalized trend",
    topTrend: "",
    score: "invalid",
    rankedTrends: [
      { label: "Wallet activity", score: 125, why: "Direct flow", sourceIds: ["source-x", 7] },
      { label: "", score: -10, why: "ignored", sourceIds: [] },
      null,
    ],
  };
} else if (prompt.includes("Evidence Packager Agent")) {
  payload = {
    bundleSummary: "",
    storageStatus: "anchored",
    evidenceUri: "",
    claimMap: [
      { claim: "Wallet activity increased", sourceIds: ["source-x"] },
      { claim: "", sourceIds: [] },
      null,
    ],
  };
} else {
  payload = {
    verificationSummary: "",
    unsupportedClaims: ["Needs proof", 1],
    briefHashInput: "invalid",
    storageStatus: "anchored",
    chainStatus: "anchored",
  };
}

process.stdout.write(JSON.stringify({
  payloads: [{ text: JSON.stringify(payload) }],
  meta: {
    executionTrace: { winnerProvider: "fixture", winnerModel: "provider-model" },
    transport: "fixture-process",
  },
}));
`;

  await writeFile(path, source, { mode: 0o700 });

  return {
    path,
    cleanup: () => rm(directory, { force: true, recursive: true }),
  };
}
