import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  RequestBodyTooLargeError,
  readLimitedRequestBody,
} from "./request-body";

test("request body combines chunks within the byte limit", async () => {
  const body = await readLimitedRequestBody(
    Readable.from([Buffer.from("hello"), Buffer.from(" world")]),
    "11",
    11,
  );

  assert.equal(body.toString("utf8"), "hello world");
});

test("request body rejects an oversized declared length before reading", async () => {
  async function* unreadBody() {
    throw new Error("body should not be consumed");
  }

  await assert.rejects(
    readLimitedRequestBody(unreadBody(), "12", 11),
    RequestBodyTooLargeError,
  );
});

test("request body enforces the limit when length is absent", async () => {
  await assert.rejects(
    readLimitedRequestBody(
      Readable.from([Buffer.alloc(6), Buffer.alloc(6)]),
      undefined,
      11,
    ),
    RequestBodyTooLargeError,
  );
});
