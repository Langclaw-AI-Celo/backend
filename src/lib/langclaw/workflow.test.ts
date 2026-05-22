import assert from "node:assert/strict";
import test from "node:test";

import { synthesizeFinalAnswerWithOpenAI } from "./openai-synthesis";
import {
  buildConclusionSignal,
  buildWorkflowProgressEvent,
} from "./workflow";
import type { SourceCard } from "./types";
import { jsonResponse, mockFetch, withEnv } from "../../test/helpers";

test("progress events include standardized timing fields", () => {
  const event = buildWorkflowProgressEvent(
    {
      agent: "Planner Agent",
      pendingSummary: "Waiting",
      skill: "openclaw/skills/planner.md",
      stepId: "planner",
    },
    "complete",
    "Planner completed.",
    {
      execution: "typescript-tool",
      model: "planner-model",
    }
  );

  assert.equal(event.stepId, "planner");
  assert.equal(event.agent, "Planner Agent");
  assert.equal(event.skill, "openclaw/skills/planner.md");
  assert.equal(event.status, "complete");
  assert.equal(event.summary, "Planner completed.");
  assert.equal(event.execution, "typescript-tool");
  assert.equal(event.model, "planner-model");
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(event.startedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.match(event.completedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof event.durationMs, "number");
});

test("final conclusion signals keep sourceId and add sourceIds", () => {
  const source: SourceCard = {
    excerpt: "Evidence",
    id: "source-1",
    provider: "GitHub",
    title: "Repo evidence",
    type: "github_repo",
    url: "https://example.test/repo",
  };

  assert.deepEqual(
    buildConclusionSignal("Builder signal", source, "fallback"),
    {
      label: "Builder signal",
      sourceId: "source-1",
      sourceIds: ["source-1"],
      text: "Repo evidence",
    }
  );
});

test("final answer OpenAI proof includes requested and used model metadata", async () => {
  await withEnv(
    {
      OPENAI_API_KEY: "",
      OPENAI_AGENT_MODEL: "default-agent",
    },
    async () => {
      const result = await synthesizeFinalAnswerWithOpenAI({
        agentOutputs: {},
        errors: [],
        requestedModel: "agent-model",
        runtime: "typescript",
        sources: [],
        steps: [],
        topic: "Mantle agent research",
      });

      assert.equal(result.meta.requestedModel, "agent-model");
      assert.equal(result.meta.usedModel, "agent-model");
      assert.equal(result.meta.modelHonored, true);
      assert.equal(result.compute.requestedModel, "agent-model");
      assert.equal(result.compute.usedModel, "agent-model");
      assert.equal(result.compute.modelHonored, true);
      assert.equal(result.compute.status, "skipped");
      assert.equal(result.compute.provider, "OpenAI");
    }
  );
});

test("final answer OpenAI synthesis records request and usage metadata", async () => {
  let responseBody: Record<string, unknown> | undefined;
  const restore = mockFetch((url, init) => {
    const path = new URL(url).pathname;

    assert.equal(path, "/v1/responses");
    responseBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return jsonResponse(
      {
        id: "resp-agent",
        model: "agent-openai-model",
        output_text: JSON.stringify({
          answer: "OpenAI proof is enabled.",
          bullets: ["Responses API usage was recorded."],
          caveat: "Test response.",
          generatedBy: "Final Conclusion Agent",
          recommendation: "Keep OpenAI configured.",
          title: "Verified answer",
        }),
        usage: {
          input_tokens: 7,
          output_tokens: 5,
          total_tokens: 12,
        },
      }
    );
  });

  try {
    await withEnv(
      {
        OPENAI_API_KEY: "openai-key",
        OPENAI_BASE_URL: "https://api.openai.test/v1",
      },
      async () => {
        const result = await synthesizeFinalAnswerWithOpenAI({
          agentOutputs: {},
          errors: [],
          requestedModel: "agent-openai-model",
          runtime: "typescript",
          sources: [],
          steps: [],
          topic: "Mantle verified research",
        });

        assert.equal(responseBody?.model, "agent-openai-model");
        assert.equal(result.compute.status, "used");
        assert.equal(result.compute.requestId, "resp-agent");
        assert.equal(result.compute.provider, "OpenAI");
        assert.equal(result.compute.usage?.promptTokens, 7);
        assert.equal(result.compute.usage?.completionTokens, 5);
      }
    );
  } finally {
    restore();
  }
});
