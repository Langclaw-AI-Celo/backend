import assert from "node:assert/strict";
import test from "node:test";

import { ApiKeyHttpError } from "../lib/server/api-keys";
import { createWalletSessionForVerifiedAddress } from "../lib/server/wallet-auth";
import { mockFetch, withEnv } from "../test/helpers";
import { apiKeyErrorResponse, handleApiKeys } from "./api-keys";

const walletAddress = "0x2222222222222222222222222222222222222222";

test("API key responses redact internal failures", async () => {
  const invalid = apiKeyErrorResponse(
    new ApiKeyHttpError(400, "API key name is required."),
  );
  const storage = apiKeyErrorResponse(
    new ApiKeyHttpError(500, "duplicate key exposes constraint name"),
  );
  const unexpected = apiKeyErrorResponse(new Error("storage connection failed"));

  assert.deepEqual(await invalid.json(), {
    configured: true,
    error: "API key name is required.",
  });
  assert.deepEqual(await storage.json(), {
    configured: true,
    error: "API key request failed.",
  });
  assert.deepEqual(await unexpected.json(), {
    configured: true,
    error: "API key request failed.",
  });
});

test("API key routes reject malformed JSON", async () => {
  const response = await handleApiKeys(
    new Request("http://localhost/api/keys", {
      body: "{not-json",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    configured: true,
    error: "Request body must be valid JSON.",
  });
});

test("API key routes keep supported actions behind wallet authentication", async () => {
  for (const action of [undefined, "list", "create", "revoke"]) {
    const response = await handleApiKeys(
      new Request("http://localhost/api/keys", {
        body: JSON.stringify(action ? { action } : {}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );

    assert.equal(response.status, 401, String(action ?? "default"));
    assert.deepEqual(await response.json(), {
      configured: true,
      error: "Wallet signature is required.",
    });
  }
});

test("API key routes reject unsupported actions after authentication", async () => {
  const restoreFetch = mockFetch((url) => {
    assert.match(new URL(url).pathname, /\/langclaw_wallet_users$/);

    return Response.json({
      id: "wallet-user-api-key",
      wallet_address: walletAddress,
    });
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "api-key-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(walletAddress);
        const response = await handleApiKeys(
          new Request("http://localhost/api/keys", {
            body: JSON.stringify({ action: "rotate-all", wallet }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          })
        );

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          configured: true,
          error: "Unsupported action.",
        });
      }
    );
  } finally {
    restoreFetch();
  }
});
