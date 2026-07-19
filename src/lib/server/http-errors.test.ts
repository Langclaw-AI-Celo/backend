import assert from "node:assert/strict";
import test from "node:test";

import { createInternalErrorResponse } from "./http-errors";

test("unexpected server errors use a stable public message", async () => {
  const response = createInternalErrorResponse();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Internal server error.",
  });
});
