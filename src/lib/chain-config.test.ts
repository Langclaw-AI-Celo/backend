import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultProductChain,
  productChains,
  readProductChainId,
  resolveProductChain,
} from "./chain-config";

test("chain input fallbacks default to Celo", () => {
  assert.equal(defaultProductChain, "celo");

  for (const input of [undefined, null, "", "unknown", 42220]) {
    assert.equal(resolveProductChain(input), productChains.celo);
    assert.equal(readProductChainId(input), "celo");
  }
});

test("chain input fallbacks honor an explicit supported fallback", () => {
  assert.equal(resolveProductChain("unknown", "mantle"), productChains.mantle);
  assert.equal(readProductChainId({}, "mantle"), "mantle");
});

test("chain inputs normalize identifiers and supported aliases", () => {
  assert.equal(resolveProductChain("  CELO  "), productChains.celo);
  assert.equal(resolveProductChain("MiniPay"), productChains.celo);
  assert.equal(resolveProductChain("MNT"), productChains.mantle);
  assert.equal(resolveProductChain("Mantle Network"), productChains.mantle);
});
