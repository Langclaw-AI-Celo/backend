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

test("proof routes reject non-object JSON before chain access", async () => {
  await withEnv(
    {
      CELO_CHAIN_RPC_URL: "http://127.0.0.1:1",
      LANGCLAW_REGISTRY_ADDRESS: "",
      MANTLE_LANGCLAW_REGISTRY_ADDRESS: "",
    },
    async () => {
      for (const handler of [handleProofDecisions, handleProofReadiness]) {
        for (const body of [null, [], "invalid"]) {
          const response = await handler(
            new Request("http://localhost/api/proofs", {
              body: JSON.stringify(body),
              headers: { "content-type": "application/json" },
              method: "POST",
            }),
          );

          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), {
            error: "Request body must be a JSON object.",
          });
        }
      }
    },
  );
});

test("proof routes reject unsupported product chains before RPC access", async () => {
  for (const handler of [handleProofDecisions, handleProofReadiness]) {
    for (const chain of ["base", "", 42220]) {
      const response = await handler(
        new Request("http://localhost/api/proofs", {
          body: JSON.stringify({ chain }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: "chain must be celo or mantle.",
      });
    }
  }
});

test("proof decisions reject malformed limits before chain access", async () => {
  for (const limit of ["10", 0, -1, 1.5]) {
    const response = await handleProofDecisions(
      new Request("http://localhost/api/proofs", {
        body: JSON.stringify({ chain: "celo", limit }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "limit must be a positive integer.",
    });
  }
});
