import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiKeyHttpError,
  authenticateApiKey,
  generateApiKeySecret,
  hashApiKeySecret,
  maskApiKey,
  verifyApiKeyHash,
} from "./api-keys";
import { withEnv } from "../../test/helpers";

type QueryResult<T> = Promise<{ data: T; error: { message: string } | null }>;

test("generates Langclaw API keys with live prefix", () => {
  const secret = generateApiKeySecret(Buffer.alloc(32, 1));

  assert.match(secret, /^lck_live_[A-Za-z0-9_-]+$/);
});

test("hashes and verifies API keys with a pepper", () => {
  const secret = generateApiKeySecret(Buffer.alloc(32, 2));
  const hash = hashApiKeySecret(secret, "test-pepper");

  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(verifyApiKeyHash(secret, hash, "test-pepper"), true);
  assert.equal(verifyApiKeyHash(`${secret}x`, hash, "test-pepper"), false);
  assert.equal(verifyApiKeyHash(secret, hash, "wrong-pepper"), false);
});

test("masks API keys without exposing the full secret", () => {
  assert.equal(maskApiKey("lck_live_ab1", "9xyz12"), "lck_live_ab1********9xyz12");
});

function createSupabaseMock(options?: {
  keyRow?: {
    id: string;
    key_hash: string;
    name: string;
    status: string;
    wallet_user_id: string;
  } | null;
  keySelectError?: string;
  touchError?: string;
  walletError?: string;
  walletUser?: { id: string; wallet_address: string } | null;
}) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              if (table === "langclaw_api_keys") {
                return {
                  maybeSingle: () =>
                    resolveQuery(
                      value === options?.keyRow?.key_hash
                        ? options?.keyRow ?? null
                        : null,
                      options?.keySelectError
                    ),
                };
              }

              if (table === "langclaw_wallet_users") {
                return {
                  maybeSingle: () =>
                    resolveQuery(options?.walletUser ?? null, options?.walletError),
                };
              }

              throw new Error(`Unexpected select eq table: ${table}`);
            },
          };
        },
        update() {
          return {
            eq() {
              return {
                eq() {
                  return resolveQuery(null, options?.touchError);
                },
              };
            },
          };
        },
      };
    },
  };
}

test("authenticateApiKey returns the linked wallet user for an active key", async () => {
  await withEnv({ LANGCLAW_API_KEY_PEPPER: "test-pepper" }, async () => {
    const secret = generateApiKeySecret(Buffer.alloc(32, 3));
    const keyHash = hashApiKeySecret(secret, "test-pepper");
    const supabase = createSupabaseMock({
      keyRow: {
        id: "key-1",
        key_hash: keyHash,
        name: "Primary key",
        status: "active",
        wallet_user_id: "wallet-user-1",
      },
      walletUser: {
        id: "wallet-user-1",
        wallet_address: "0xabc123",
      },
    });

    const result = await authenticateApiKey(
      new Request("https://api.langclaw.test", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      supabase as never
    );

    assert.deepEqual(result, {
      id: "key-1",
      name: "Primary key",
      walletAddress: "0xabc123",
      walletUserId: "wallet-user-1",
    });
  });
});

test("authenticateApiKey fails when last-used persistence fails", async () => {
  await withEnv({ LANGCLAW_API_KEY_PEPPER: "test-pepper" }, async () => {
    const secret = generateApiKeySecret(Buffer.alloc(32, 4));
    const keyHash = hashApiKeySecret(secret, "test-pepper");
    const supabase = createSupabaseMock({
      keyRow: {
        id: "key-2",
        key_hash: keyHash,
        name: "Primary key",
        status: "active",
        wallet_user_id: "wallet-user-2",
      },
      touchError: "could not persist audit timestamp",
      walletUser: {
        id: "wallet-user-2",
        wallet_address: "0xdef456",
      },
    });

    await assert.rejects(
      authenticateApiKey(
        new Request("https://api.langclaw.test", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        supabase as never
      ),
      (error: unknown) =>
        error instanceof ApiKeyHttpError &&
        error.status === 500 &&
        error.message === "could not persist audit timestamp"
    );
  });
});

test("authenticateApiKey rejects revoked keys", async () => {
  await withEnv({ LANGCLAW_API_KEY_PEPPER: "test-pepper" }, async () => {
    const secret = generateApiKeySecret(Buffer.alloc(32, 5));
    const keyHash = hashApiKeySecret(secret, "test-pepper");
    const supabase = createSupabaseMock({
      keyRow: {
        id: "key-3",
        key_hash: keyHash,
        name: "Revoked key",
        status: "revoked",
        wallet_user_id: "wallet-user-3",
      },
      walletUser: {
        id: "wallet-user-3",
        wallet_address: "0xaaa333",
      },
    });

    await assert.rejects(
      authenticateApiKey(
        new Request("https://api.langclaw.test", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        supabase as never
      ),
      (error: unknown) =>
        error instanceof ApiKeyHttpError &&
        error.status === 401 &&
        error.message === "Valid API key is required."
    );
  });
});

test("authenticateApiKey rejects malformed stored hashes", async () => {
  await withEnv({ LANGCLAW_API_KEY_PEPPER: "test-pepper" }, async () => {
    const secret = generateApiKeySecret(Buffer.alloc(32, 6));
    const supabase = createSupabaseMock({
      keyRow: {
        id: "key-4",
        key_hash: "not-a-sha256-hash",
        name: "Malformed key",
        status: "active",
        wallet_user_id: "wallet-user-4",
      },
      walletUser: {
        id: "wallet-user-4",
        wallet_address: "0xbbb444",
      },
    });

    await assert.rejects(
      authenticateApiKey(
        new Request("https://api.langclaw.test", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        supabase as never
      ),
      (error: unknown) =>
        error instanceof ApiKeyHttpError &&
        error.status === 401 &&
        error.message === "Valid API key is required."
    );
  });
});

test("authenticateApiKey surfaces key lookup persistence failures", async () => {
  await withEnv({ LANGCLAW_API_KEY_PEPPER: "test-pepper" }, async () => {
    const secret = generateApiKeySecret(Buffer.alloc(32, 7));
    const supabase = createSupabaseMock({
      keySelectError: "api key lookup failed",
    });

    await assert.rejects(
      authenticateApiKey(
        new Request("https://api.langclaw.test", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        supabase as never,
      ),
      (error: unknown) =>
        error instanceof ApiKeyHttpError &&
        error.status === 500 &&
        error.message === "api key lookup failed",
    );
  });
});

test("authenticateApiKey surfaces wallet lookup persistence failures", async () => {
  await withEnv({ LANGCLAW_API_KEY_PEPPER: "test-pepper" }, async () => {
    const secret = generateApiKeySecret(Buffer.alloc(32, 8));
    const keyHash = hashApiKeySecret(secret, "test-pepper");
    const supabase = createSupabaseMock({
      keyRow: {
        id: "key-5",
        key_hash: keyHash,
        name: "Primary key",
        status: "active",
        wallet_user_id: "wallet-user-5",
      },
      walletError: "wallet lookup failed",
    });

    await assert.rejects(
      authenticateApiKey(
        new Request("https://api.langclaw.test", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        supabase as never,
      ),
      (error: unknown) =>
        error instanceof ApiKeyHttpError &&
        error.status === 500 &&
        error.message === "wallet lookup failed",
    );
  });
});

function resolveQuery<T>(data: T, errorMessage?: string): QueryResult<T> {
  return Promise.resolve({
    data,
    error: errorMessage ? { message: errorMessage } : null,
  });
}
