import assert from "node:assert/strict";
import test from "node:test";

import { fromDataSuffix } from "@celo/attribution-tags";

import {
  buildCeloAttributionTag,
  DEFAULT_CELO_ATTRIBUTION_HOSTNAME,
} from "./celo-attribution";

test("builds the default Celo attribution tag from the production hostname", async () => {
  const attribution = await buildCeloAttributionTag({ env: {} });

  assert.equal(attribution.hostname, DEFAULT_CELO_ATTRIBUTION_HOSTNAME);
  assert.deepEqual(attribution.codes, ["celo_1a98738636db"]);
  assert.deepEqual(fromDataSuffix(attribution.dataSuffix), {
    codes: ["celo_1a98738636db"],
    schemaId: 0,
  });
});

test("places a valid official code after the hostname code", async () => {
  const attribution = await buildCeloAttributionTag({
    env: {
      CELO_ATTRIBUTION_CODE: "langclaw",
      CELO_ATTRIBUTION_HOSTNAME: "example.com",
    },
  });

  assert.equal(attribution.hostname, "example.com");
  assert.equal(attribution.codes[0].startsWith("celo_"), true);
  assert.deepEqual(attribution.codes.slice(1), ["langclaw"]);
  assert.deepEqual(fromDataSuffix(attribution.dataSuffix)?.codes, attribution.codes);
});

test("keeps hostname attribution when the optional official code is invalid", async () => {
  const warnings: string[] = [];
  const attribution = await buildCeloAttributionTag({
    env: { CELO_ATTRIBUTION_CODE: "NOT VALID" },
    onWarning: (warning) => warnings.push(warning),
  });

  assert.deepEqual(attribution.codes, ["celo_1a98738636db"]);
  assert.match(warnings[0] ?? "", /CELO_ATTRIBUTION_CODE/);
});

test("never adds the MiniPay platform code", async () => {
  const warnings: string[] = [];
  const attribution = await buildCeloAttributionTag({
    env: { CELO_ATTRIBUTION_CODE: "minipay" },
    onWarning: (warning) => warnings.push(warning),
  });

  assert.deepEqual(attribution.codes, ["celo_1a98738636db"]);
  assert.match(warnings[0] ?? "", /MiniPay/);
});

test("falls back to the production hostname when configured hostname is invalid", async () => {
  const warnings: string[] = [];
  const attribution = await buildCeloAttributionTag({
    env: { CELO_ATTRIBUTION_HOSTNAME: "https://invalid.example" },
    onWarning: (warning) => warnings.push(warning),
  });

  assert.equal(attribution.hostname, DEFAULT_CELO_ATTRIBUTION_HOSTNAME);
  assert.deepEqual(attribution.codes, ["celo_1a98738636db"]);
  assert.match(warnings[0] ?? "", /CELO_ATTRIBUTION_HOSTNAME/);
});
