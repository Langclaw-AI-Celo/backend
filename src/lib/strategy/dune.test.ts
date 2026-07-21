import assert from "node:assert/strict";
import test from "node:test";

import { jsonResponse, mockFetch, withEnv } from "../../test/helpers";
import { fetchStrategyBarsFromDune } from "./dune";

const pairAddress = "0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5";

test("Dune strategy fetch rejects oversized provider responses", async () => {
  let requestHeaders: Headers | undefined;
  const restoreFetch = mockFetch((_url, init) => {
    requestHeaders = new Headers(init?.headers);

    return jsonResponse(
      {
        result: {
          rows: [
            {
              liquidity_usd: "100000",
              pair_address: pairAddress,
              price_usd: "1.02",
              timestamp: "2026-05-19T00:00:00Z",
              volume_usd: "25000",
            },
          ],
        },
      },
      { headers: { "Content-Length": String(5 * 1024 * 1024 + 1) } },
    );
  });

  try {
    await withEnv({ DUNE_API_KEY: "dune-test-key" }, async () => {
      await assert.rejects(
        fetchStrategyBarsFromDune({ queryId: "123456" }),
        /Provider response exceeds the 5242880 byte limit/,
      );
    });
    assert.equal(requestHeaders?.get("X-Dune-API-Key"), "dune-test-key");
  } finally {
    restoreFetch();
  }
});
