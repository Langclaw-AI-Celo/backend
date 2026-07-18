import assert from "node:assert/strict";
import test from "node:test";

import {
  extractAnswerText,
  extractModel,
  parseLooseJson,
  parseOpenClawAgentResponse,
} from "./openclaw-runner";

test("parses an OpenClaw response from stdout", () => {
  const response = parseOpenClawAgentResponse(
    JSON.stringify({
      payloads: [{ text: '{"summary":"ready"}' }],
      meta: { agentMeta: { provider: "openai", model: "gpt-5" } },
    }),
    ""
  );

  assert.equal(extractAnswerText(response), '{"summary":"ready"}');
  assert.equal(extractModel(response), "openai/gpt-5");
});

test("parses an OpenClaw response from stderr when stdout is not JSON", () => {
  const response = parseOpenClawAgentResponse(
    "gateway connected",
    JSON.stringify({
      meta: {
        finalAssistantVisibleText: '{"status":"visible"}',
        executionTrace: {
          winnerProvider: "anthropic",
          winnerModel: "claude-sonnet",
        },
      },
    })
  );

  assert.equal(extractAnswerText(response), '{"status":"visible"}');
  assert.equal(extractModel(response), "anthropic/claude-sonnet");
});

test("parses the final JSON object after gateway status lines", () => {
  const response = parseOpenClawAgentResponse(
    [
      "gateway starting",
      "gateway authenticated",
      JSON.stringify({ meta: { finalAssistantRawText: "raw answer" } }),
    ].join("\n"),
    ""
  );

  assert.equal(extractAnswerText(response), "raw answer");
});

test("parses fenced and trailing loose JSON", () => {
  assert.deepEqual(parseLooseJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(
    parseLooseJson('status: retrying\n{"ignored":true}\n{"final":42}'),
    { final: 42 }
  );
});

test("returns undefined for blank and malformed loose JSON", () => {
  assert.equal(parseLooseJson("   "), undefined);
  assert.equal(parseLooseJson("not-json"), undefined);
});

test("extracts model names when only one model field is available", () => {
  assert.equal(
    extractModel({ meta: { agentMeta: { provider: "openai" } } }),
    "openai"
  );
  assert.equal(
    extractModel({ meta: { executionTrace: { winnerModel: "gpt-5" } } }),
    "gpt-5"
  );
  assert.equal(extractModel({}), undefined);
});
