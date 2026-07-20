import assert from "node:assert/strict";
import test from "node:test";

import { handleDiscover } from "./discover";
import {
  handleDiscoverStream,
  readDiscoverStreamError,
} from "./discover-stream";

test("discovery streams hide internal workflow failures", () => {
  assert.equal(
    readDiscoverStreamError(
      new Error("postgres://internal-user:secret@database.test failed"),
    ),
    "Discovery failed.",
  );
  assert.equal(readDiscoverStreamError("unknown failure"), "Discovery failed.");
});

test("discovery routes reject non-object JSON before workflow access", async () => {
  for (const handler of [handleDiscover, handleDiscoverStream]) {
    for (const body of [null, [], "invalid"]) {
      const response = await handler(
        new Request("http://localhost/api/discover", {
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
});

test("discovery routes reject oversized topics before authentication", async () => {
  for (const handler of [handleDiscover, handleDiscoverStream]) {
    const response = await handler(
      new Request("http://localhost/api/discover", {
        body: JSON.stringify({ topic: "x".repeat(4_001) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Topic must be at most 4000 characters.",
    });
  }
});
