import assert from "node:assert/strict";
import test from "node:test";

import { WalletAuthError } from "../lib/server/wallet-auth";
import {
  handleWalletChallenge,
  handleWalletSession,
  walletAuthErrorResponse,
} from "./wallet-auth";

test("wallet auth responses expose only actionable failures", async () => {
  const invalid = walletAuthErrorResponse(
    new WalletAuthError(400, "A valid wallet address is required."),
  );
  const internal = walletAuthErrorResponse(
    new WalletAuthError(500, "session secret appeared in a stack trace"),
  );
  const unexpected = walletAuthErrorResponse(new Error("provider exception"));

  assert.deepEqual(await invalid.json(), {
    configured: true,
    error: "A valid wallet address is required.",
  });
  assert.deepEqual(await internal.json(), {
    configured: true,
    error: "Wallet authentication failed.",
  });
  assert.deepEqual(await unexpected.json(), {
    configured: true,
    error: "Wallet authentication failed.",
  });
});

test("wallet auth routes reject non-object JSON bodies", async () => {
  for (const handler of [handleWalletChallenge, handleWalletSession]) {
    for (const body of [null, [], "invalid"]) {
      const response = await handler(
        new Request("http://localhost/api/wallet/auth", {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        configured: true,
        error: "Request body must be valid JSON.",
      });
    }
  }
});

test("wallet challenges reject coercible non-decimal chain IDs", async () => {
  for (const chainId of [
    true,
    ["42220"],
    { value: 42220 },
    "",
    "042220",
    "0xA4EC",
    "1e3",
    " 42220 ",
  ]) {
    const response = await handleWalletChallenge(
      new Request("http://localhost/api/wallet/challenge", {
        body: JSON.stringify({
          address: "0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c",
          chainId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      configured: true,
      error: "A valid chain id is required.",
    });
  }
});

test("wallet challenges accept omitted and canonical decimal chain IDs", async () => {
  for (const [chainId, expectedChainId] of [
    [undefined, 42220],
    [1, 1],
    ["42220", 42220],
  ] as const) {
    const body =
      chainId === undefined
        ? {
            address: "0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c",
          }
        : {
            address: "0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c",
            chainId,
          };
    const response = await handleWalletChallenge(
      new Request("http://localhost/api/wallet/challenge", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const payload = (await response.json()) as {
      challenge: { chainId: number };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.challenge.chainId, expectedChainId);
  }
});
