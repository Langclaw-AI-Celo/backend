import assert from "node:assert/strict";
import test from "node:test";

import { withEnv } from "../../test/helpers";
import {
  AccountAuthError,
  accountAuthErrorResponse,
  requireAccountAuth,
} from "./account-auth";

function isAuthError(status: number, message: string) {
  return (error: unknown) =>
    error instanceof AccountAuthError &&
    error.status === status &&
    error.message === message;
}

test("account auth responses redact internal failures", async () => {
  const denied = accountAuthErrorResponse(
    new AccountAuthError(401, "Valid API key is required."),
  );
  const storage = accountAuthErrorResponse(
    new AccountAuthError(500, "wallet_users relation is missing"),
  );
  const unexpected = accountAuthErrorResponse(new Error("connection refused"));

  assert.deepEqual(await denied.json(), {
    error: "Valid API key is required.",
  });
  assert.deepEqual(await storage.json(), {
    error: "Account authentication failed.",
  });
  assert.deepEqual(await unexpected.json(), {
    error: "Account authentication failed.",
  });
});

test("account auth rejects missing and unrelated bearer credentials", async () => {
  await assert.rejects(
    requireAccountAuth({}),
    isAuthError(401, "Wallet signature or API key is required."),
  );

  for (const authorization of ["Basic abc123", "Bearer external_token"] ) {
    await assert.rejects(
      requireAccountAuth({
        request: new Request("https://api.langclaw.test", {
          headers: { authorization },
        }),
      }),
      isAuthError(401, "Wallet signature or API key is required."),
    );
  }
});

test("account auth reports storage configuration for Langclaw bearer keys", async () => {
  await withEnv(
    { SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_URL: undefined },
    async () => {
      await assert.rejects(
        requireAccountAuth({
          request: new Request("https://api.langclaw.test", {
            headers: { authorization: "Bearer lck_live_missing" },
          }),
        }),
        isAuthError(503, "Supabase URL and service role key are missing."),
      );
    },
  );
});

test("invalid wallet input fails without falling through to bearer auth", async () => {
  await assert.rejects(
    requireAccountAuth({
      request: new Request("https://api.langclaw.test", {
        headers: { authorization: "Bearer lck_live_unused" },
      }),
      wallet: { address: "not-a-wallet" },
    }),
    isAuthError(401, "Wallet signature is required."),
  );
});
