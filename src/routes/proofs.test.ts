import assert from "node:assert/strict";
import test from "node:test";

import { withEnv } from "../test/helpers";
import { handleProofDecisions, handleProofReadiness } from "./proofs";

const malformedRequest = () =>
  new Request("http://localhost/api/proofs", {
    body: "{",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

test("proof decisions reject malformed JSON before chain access", async () => {
  await withEnv(
    {
      LANGCLAW_REGISTRY_ADDRESS: "",
      MANTLE_LANGCLAW_REGISTRY_ADDRESS: "",
    },
    async () => {
      const response = await handleProofDecisions(malformedRequest());

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "Request body must be valid JSON.",
      });
    },
  );
});

test("proof readiness rejects malformed JSON before RPC checks", async () => {
  await withEnv(
    { CELO_CHAIN_RPC_URL: "http://127.0.0.1:1" },
    async () => {
      const response = await handleProofReadiness(malformedRequest());

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "Request body must be valid JSON.",
      });
    },
  );
});
