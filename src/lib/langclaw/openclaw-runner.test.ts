import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compactProcessOutput,
  extractAnswerText,
  extractModel,
  isRecord,
  parseLooseJson,
  parseOpenClawAgentResponse,
  readPositiveInt,
  readString,
  runOpenClawAgentJson,
  sanitizeError,
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

test("returns a sanitized fallback when the OpenClaw process fails", async () => {
  const fixture = await createCliFixture(`#!/bin/sh
printf '%s\n' 'ghp_fakeToken123 tvly-fake-key sk-12345678901234567890' >&2
printf '%s\n' 'Bearer fake.session.token 0x${"a".repeat(64)}' >&2
exit 7
`);

  try {
    const result = await runOpenClawAgentJson({
      cliPath: fixture.path,
      model: "test-model",
      prompt: "sensitive prompt must not appear in the error",
      sessionId: "runner-failure",
      timeoutSeconds: 1,
    });

    assert.equal(result.meta.execution, "deterministic-fallback");
    assert.equal(result.meta.model, "test-model");
    assert.equal(result.text, "");
    assert.equal(result.payload, undefined);
    assert.doesNotMatch(result.meta.error ?? "", /sensitive prompt/);
    assert.doesNotMatch(result.meta.error ?? "", /ghp_|tvly-|Bearer fake|0xaaaa/);
    assert.match(result.meta.error ?? "", /\[redacted\]/);
  } finally {
    await fixture.cleanup();
  }
});

test("falls back when a successful OpenClaw process returns invalid JSON", async () => {
  const fixture = await createCliFixture(`#!/bin/sh
printf '%s\n' 'gateway returned plain text'
`);

  try {
    const result = await runOpenClawAgentJson({
      cliPath: fixture.path,
      prompt: "return JSON",
      sessionId: "runner-invalid-json",
      timeoutSeconds: 1,
    });

    assert.equal(result.meta.execution, "deterministic-fallback");
    assert.match(result.meta.error ?? "", /parseable JSON/);
  } finally {
    await fixture.cleanup();
  }
});

test("sanitizes supported credentials and bounds process output", () => {
  const sanitized = sanitizeError(
    [
      "ghp_fakeToken123",
      "tvly-fake-key",
      "sk-12345678901234567890",
      "app-sk-12345678901234567890",
      `0x${"b".repeat(64)}`,
      "Bearer fake.session.token",
      `AAAAAAAA${"c".repeat(24)}`,
      `BSA${"d".repeat(24)}`,
    ].join(" ")
  );

  assert.doesNotMatch(sanitized, /fakeToken|fake-key|1234567890|bbbb|cccc|dddd/);
  assert.equal(sanitizeError("x".repeat(900)).length, 800);
  assert.equal(compactProcessOutput("  first\n second  "), "first second");
  assert.equal(compactProcessOutput(undefined), "");
});

test("normalizes OpenClaw primitive helper inputs", () => {
  assert.equal(readPositiveInt("12", 60), 12);
  assert.equal(readPositiveInt("0", 60), 60);
  assert.equal(readPositiveInt("invalid", 60), 60);
  assert.equal(readString("  ready  "), "ready");
  assert.equal(readString(42), "");
  assert.equal(isRecord({ ok: true }), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
});

test("rejects partial positive integer runtime settings", () => {
  for (const value of [
    "12seconds",
    "1e2",
    "12.5",
    " 12 ",
    "+12",
    "012",
    "9007199254740992",
  ]) {
    assert.equal(readPositiveInt(value, 60), 60, value);
  }

  assert.equal(readPositiveInt("9007199254740991", 60), Number.MAX_SAFE_INTEGER);
});

async function createCliFixture(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "langclaw-openclaw-"));
  const path = join(directory, "openclaw-fixture.sh");

  await writeFile(path, source, { mode: 0o700 });

  return {
    path,
    cleanup: () => rm(directory, { force: true, recursive: true }),
  };
}
