import assert from "node:assert/strict";
import test from "node:test";

import { readServerPort } from "./runtime-config";

test("server port keeps valid canonical values", () => {
  assert.equal(readServerPort(undefined, 3001), 3001);
  assert.equal(readServerPort("1", 3001), 1);
  assert.equal(readServerPort("3002", 3001), 3002);
  assert.equal(readServerPort("65535", 3001), 65535);
});

test("server port rejects malformed and out-of-range values", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1e3",
    " 3002 ",
    "3002junk",
    "65536",
    "999999999999999999999999",
  ]) {
    assert.equal(readServerPort(value, 3001), 3001, value);
  }
});
