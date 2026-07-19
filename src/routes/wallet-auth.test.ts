import assert from "node:assert/strict";
import test from "node:test";

import { WalletAuthError } from "../lib/server/wallet-auth";
import { walletAuthErrorResponse } from "./wallet-auth";

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
