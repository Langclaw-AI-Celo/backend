import assert from "node:assert/strict";
import test from "node:test";

import {
  handleUsageBalance,
  handleUsageDepositVerify,
  handleUsageQuote,
  handleUsageVaultInfo,
  handleUsageWithdrawRequest,
} from "./usage";

test("usage routes reject malformed JSON before service calls", async () => {
  for (const handler of [
    handleUsageBalance,
    handleUsageDepositVerify,
    handleUsageQuote,
    handleUsageVaultInfo,
    handleUsageWithdrawRequest,
  ]) {
    const response = await handler(
      new Request("http://localhost/api/usage", {
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Request body must be valid JSON.",
    });
  }
});

test("usage balance and withdrawal routes require authentication", async () => {
  const balance = await handleUsageBalance(emptyJsonRequest("balance"));
  const withdrawal = await handleUsageWithdrawRequest(
    emptyJsonRequest("withdraw"),
  );

  assert.equal(balance.status, 401);
  assert.deepEqual(await balance.json(), {
    error: "Wallet signature or API key is required.",
  });
  assert.equal(withdrawal.status, 401);
  assert.deepEqual(await withdrawal.json(), {
    error: "Wallet signature is required.",
  });
});

function emptyJsonRequest(route: string) {
  return new Request(`http://localhost/api/usage/${route}`, {
    body: "{}",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
