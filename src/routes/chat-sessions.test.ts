import assert from "node:assert/strict";
import test from "node:test";

import { readOptionalTitle } from "./chat-sessions";

test("chat session metadata accepts omitted titles and rejects invalid values", () => {
  assert.deepEqual(readOptionalTitle(undefined), {});
  assert.deepEqual(readOptionalTitle(42), { error: "title must be a string." });
  assert.deepEqual(readOptionalTitle("   \n  "), { error: "title cannot be empty." });
});

test("chat session metadata normalizes and limits titles", () => {
  assert.deepEqual(readOptionalTitle("  CELO\n  proof   status  "), {
    value: "CELO proof status",
  });

  const result = readOptionalTitle("a".repeat(140));
  assert.equal(result.value?.length, 120);
  assert.equal(result.value, `${"a".repeat(117)}...`);
});
