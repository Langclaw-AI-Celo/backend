import assert from "node:assert/strict";
import test from "node:test";

import { handleDiscover } from "./discover";
import { handleDiscoverStream } from "./discover-stream";

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
