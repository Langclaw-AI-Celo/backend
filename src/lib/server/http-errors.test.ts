import assert from "node:assert/strict";
import test from "node:test";

import {
  createInternalErrorResponse,
  createRequestErrorResponse,
} from "./http-errors";
import { RequestBodyTooLargeError } from "./request-body";

test("unexpected server errors use a stable public message", async () => {
  const response = createInternalErrorResponse();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Internal server error.",
  });
});

test("oversized request errors return a stable 413 response", async () => {
  const response = createRequestErrorResponse(
    new RequestBodyTooLargeError(1_048_577, 1_048_576),
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "Request body is too large.",
  });
});
