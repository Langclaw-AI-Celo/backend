import assert from "node:assert/strict";
import test from "node:test";

import { responseMessage } from "./provider-utils";

test("provider error details reject oversized response bodies", async () => {
  const response = new Response("provider failure", {
    headers: { "Content-Length": String(5 * 1024 * 1024 + 1) },
    status: 502,
    statusText: "Bad Gateway",
  });

  await assert.rejects(
    responseMessage(response),
    /Provider response exceeds the 5242880 byte limit/,
  );
});
