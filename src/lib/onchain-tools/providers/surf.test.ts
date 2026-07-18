import assert from "node:assert/strict";
import test from "node:test";

import {
  getSurfSmartMoneyCoverage,
  normalizeRawTokenAmount,
} from "./surf";

test("normalizes common token raw amounts with token decimals", () => {
  assert.equal(normalizeRawTokenAmount("123456789", 6), 123.456789);
  assert.equal(normalizeRawTokenAmount("1000000", 6), 1);
  assert.equal(normalizeRawTokenAmount("123456789", 8), 1.23456789);
  assert.equal(normalizeRawTokenAmount("1500000000000000000", 18), 1.5);
});

test("does not treat thousands as millions after normalization", () => {
  assert.equal(normalizeRawTokenAmount("29797832970000", 6), 29797832.97);
  assert.equal(normalizeRawTokenAmount("2979783297", 6), 2979.783297);
});

test("rejects invalid token amounts and handles numeric fallbacks", () => {
  assert.equal(normalizeRawTokenAmount(undefined, 6), undefined);
  assert.equal(normalizeRawTokenAmount("1", -1), undefined);
  assert.equal(normalizeRawTokenAmount("1", 1.5), undefined);
  assert.equal(normalizeRawTokenAmount("not-a-number", 6), undefined);
  assert.equal(normalizeRawTokenAmount("1e6", "6"), 1);
  assert.equal(normalizeRawTokenAmount("100.0", 2), 1);
  assert.equal(normalizeRawTokenAmount("42", 0), 42);
  assert.equal(normalizeRawTokenAmount("1e309", 6), undefined);
  assert.equal(normalizeRawTokenAmount("9".repeat(400), 0), undefined);
  assert.equal(normalizeRawTokenAmount("9".repeat(400), 1), undefined);
});

test("describes smart-money coverage across mapped chain scopes", () => {
  assert.deepEqual(getSurfSmartMoneyCoverage({}), {
    chain: "celo",
    chainName: "Celo",
    hasSqlFallback: false,
    mode: "ability-only",
  });

  assert.deepEqual(
    getSurfSmartMoneyCoverage({
      chain: "cello",
      tokenAddress: "0x1111111111111111111111111111111111111111",
    }),
    {
      chain: "celo",
      chainName: "Celo",
      hasSqlFallback: false,
      mode: "explicit-address",
      priceTable: undefined,
      sqlTable: undefined,
      symbol: undefined,
      tokenAddress: "0x1111111111111111111111111111111111111111",
      tokenAddressChainName: "Celo",
    }
  );

  const arbitrum = getSurfSmartMoneyCoverage({
    chain: "arb",
    query: "Track $ARB accumulation",
  });
  assert.equal(arbitrum.chain, "arbitrum");
  assert.equal(arbitrum.mode, "explicit-symbol");
  assert.equal(arbitrum.hasSqlFallback, true);
  assert.equal(arbitrum.sqlTable, "arbitrum_dex_trades");
  assert.equal(arbitrum.symbol, "ARB");

  const mantle = getSurfSmartMoneyCoverage({
    chain: "mantle",
    query: "Track $MNT accumulation",
  });
  assert.equal(mantle.chain, "ethereum");
  assert.equal(mantle.mode, "external-token-signal");
  assert.equal(mantle.hasSqlFallback, false);
  assert.equal(mantle.tokenAddressChainName, "Ethereum mainnet");

  const base = getSurfSmartMoneyCoverage({
    chain: "base",
    query: "Track token DEGEN",
  });
  assert.equal(base.chain, "base");
  assert.equal(base.mode, "explicit-symbol");
  assert.equal(base.hasSqlFallback, true);
  assert.equal(base.symbol, "DEGEN");

  const bnb = getSurfSmartMoneyCoverage({ chain: "bsc" });
  assert.equal(bnb.chain, "bnb");
  assert.equal(bnb.chainName, "BNB Smart Chain");
  assert.equal(bnb.mode, "broad-chain");
  assert.equal(bnb.hasSqlFallback, true);

  const ethereum = getSurfSmartMoneyCoverage({
    query: "Find smart-money for WETH on ethereum",
  });
  assert.equal(ethereum.chain, "ethereum");
  assert.equal(ethereum.mode, "explicit-symbol");
  assert.equal(ethereum.symbol, "WETH");

  assert.deepEqual(getSurfSmartMoneyCoverage({ chain: "unknown" }), {
    chain: "unknown",
    chainName: "Unknown",
    hasSqlFallback: false,
    mode: "ability-only",
  });
});
