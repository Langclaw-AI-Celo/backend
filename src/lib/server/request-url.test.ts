import assert from "node:assert/strict";
import test from "node:test";

import { decodePathSegment, resolveRequestProtocol } from "./request-url";

test("request protocol accepts only HTTP schemes", () => {
  assert.equal(resolveRequestProtocol(undefined), "http");
  assert.equal(resolveRequestProtocol("https"), "https");
  assert.equal(resolveRequestProtocol(["https", "http"]), "https");
  assert.equal(resolveRequestProtocol("https, http"), "https");
});

test("request protocol rejects malformed and executable schemes", () => {
  for (const value of ["javascript", "file", "https:invalid", ""]) {
    assert.equal(resolveRequestProtocol(value), "http", value);
  }
});

test("path segment decoding rejects malformed percent encoding", () => {
  assert.deepEqual(decodePathSegment("daily%20brief"), {
    ok: true,
    value: "daily brief",
  });
  assert.deepEqual(decodePathSegment("broken%"), {
    ok: false,
  });
});
