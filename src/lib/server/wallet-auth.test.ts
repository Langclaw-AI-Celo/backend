import assert from "node:assert/strict";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import { withEnv } from "../../test/helpers";
import {
  createWalletChallenge,
  MAX_PENDING_WALLET_CHALLENGES,
  verifyWalletSession,
  WalletAuthError,
} from "./wallet-auth";

const testAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945388c9d22d2334a4f12d7873b4d0b08c8756"
);

test("production wallet challenges require a trusted domain", async () => {
  await withEnv(
    {
      LANGCLAW_WALLET_AUTH_DOMAIN: undefined,
      NODE_ENV: "production",
    },
    async () => {
      assert.throws(
        () =>
          createWalletChallenge({
            address: testAccount.address,
            request: new Request(
              "https://attacker.example/api/wallet/challenge"
            ),
          }),
        (error: unknown) => {
          assert.ok(error instanceof WalletAuthError);
          assert.equal(error.status, 503);
          assert.equal(
            error.message,
            "LANGCLAW_WALLET_AUTH_DOMAIN is required in production."
          );
          return true;
        }
      );
    }
  );
});

test("production wallet challenges use the configured HTTPS origin", async () => {
  await withEnv(
    {
      LANGCLAW_WALLET_AUTH_DOMAIN: "AUTH.LANGCLAW.TEST:8443",
      LANGCLAW_WALLET_SESSION_SECRET: "test-wallet-secret",
      NODE_ENV: "production",
    },
    async () => {
      const challenge = createWalletChallenge({
        address: testAccount.address,
        request: new Request(
          "http://attacker.example/api/wallet/challenge"
        ),
      });

      assert.equal(challenge.domain, "auth.langclaw.test:8443");
      assert.equal(challenge.uri, "https://auth.langclaw.test:8443");
      assert.match(
        challenge.message,
        /^auth\.langclaw\.test:8443 wants you to sign in/
      );

      const signature = await testAccount.signMessage({
        message: challenge.message,
      });
      const verified = await verifyWalletSession(
        {
          address: testAccount.address,
          message: challenge.message,
          signature,
        },
        { requiredPurpose: "session" }
      );

      assert.equal(verified?.authMethod, "challenge");
      assert.equal(verified?.address, testAccount.address.toLowerCase());
    }
  );
});

test("wallet challenges reject malformed configured domains", async () => {
  const invalidDomains = [
    " https://api.langclaw.test",
    "https://api.langclaw.test",
    "api.langclaw.test/path",
    "user@api.langclaw.test",
    "api..langclaw.test",
    "-api.langclaw.test",
    "api.langclaw.test:",
    "api.langclaw.test:0",
    "api.langclaw.test:65536",
    "api.langclaw.test:invalid",
  ];

  for (const domain of invalidDomains) {
    await withEnv(
      { LANGCLAW_WALLET_AUTH_DOMAIN: domain },
      async () => {
        assert.throws(
          () =>
            createWalletChallenge({
              address: testAccount.address,
              request: new Request(
                "https://api.langclaw.test/api/wallet/challenge"
              ),
            }),
          (error: unknown) => {
            assert.ok(error instanceof WalletAuthError);
            assert.equal(error.status, 503);
            assert.equal(
              error.message,
              "LANGCLAW_WALLET_AUTH_DOMAIN must be a valid hostname with an optional port."
            );
            return true;
          },
          domain
        );
      }
    );
  }
});

test("development wallet challenges preserve request-origin fallback", async () => {
  await withEnv(
    {
      LANGCLAW_WALLET_AUTH_DOMAIN: undefined,
      NODE_ENV: "development",
    },
    async () => {
      const challenge = createWalletChallenge({
        address: testAccount.address,
        request: new Request(
          "http://localhost:3002/api/wallet/challenge"
        ),
      });

      assert.equal(challenge.domain, "localhost:3002");
      assert.equal(challenge.uri, "http://localhost:3002");
    }
  );
});

test("rejects the legacy reusable Langclaw login message", async () => {
  const message = `Login to Langclaw\nAddress: ${testAccount.address}\nTime: ${new Date().toISOString()}`;
  const signature = await testAccount.signMessage({ message });

  const verified = await verifyWalletSession({
    address: testAccount.address,
    message,
    signature,
  });

  assert.equal(verified, null);
});

test("verifies a nonce challenge once and issues a short session token", async () => {
  await withEnv({ LANGCLAW_WALLET_SESSION_SECRET: "test-wallet-secret" }, async () => {
    const challenge = createWalletChallenge({
      address: testAccount.address,
      request: new Request("https://api.langclaw.test/api/wallet/challenge"),
    });
    const signature = await testAccount.signMessage({
      message: challenge.message,
    });

    const verified = await verifyWalletSession(
      {
        address: testAccount.address,
        message: challenge.message,
        signature,
      },
      { requiredPurpose: "session" }
    );

    assert.equal(verified?.authMethod, "challenge");
    assert.equal(verified?.address, testAccount.address.toLowerCase());
    assert.match(verified?.sessionToken ?? "", /^lws_v1\./);

    const session = await verifyWalletSession({
      address: testAccount.address,
      sessionToken: verified?.sessionToken,
    });

    assert.equal(session?.authMethod, "session");
    assert.equal(session?.address, testAccount.address.toLowerCase());

    const replay = await verifyWalletSession(
      {
        address: testAccount.address,
        message: challenge.message,
        signature,
      },
      { requiredPurpose: "session" }
    );

    assert.equal(replay, null);
  });
});

test("rejects concurrent replay of the same wallet challenge", async () => {
  const challenge = createWalletChallenge({
    address: testAccount.address,
    request: new Request("https://api.langclaw.test/api/wallet/challenge"),
  });
  const signature = await testAccount.signMessage({
    message: challenge.message,
  });
  const wallet = {
    address: testAccount.address,
    message: challenge.message,
    signature,
  };

  const results = await Promise.all([
    verifyWalletSession(wallet),
    verifyWalletSession(wallet),
  ]);

  assert.deepEqual(
    {
      nonNull: results.filter((result) => result !== null).length,
      null: results.filter((result) => result === null).length,
    },
    { nonNull: 1, null: 1 }
  );
});

test("API key creation requires a fresh api-key:create challenge", async () => {
  await withEnv({ LANGCLAW_WALLET_SESSION_SECRET: "test-wallet-secret" }, async () => {
    const sessionChallenge = createWalletChallenge({
      address: testAccount.address,
      request: new Request("https://api.langclaw.test/api/wallet/challenge"),
    });
    const sessionSignature = await testAccount.signMessage({
      message: sessionChallenge.message,
    });
    const sessionWallet = await verifyWalletSession(
      {
        address: testAccount.address,
        message: sessionChallenge.message,
        signature: sessionSignature,
      },
      { requiredPurpose: "session" }
    );

    const sessionAsApiKeyAuth = await verifyWalletSession(
      {
        address: testAccount.address,
        sessionToken: sessionWallet?.sessionToken,
      },
      { requireChallenge: true, requiredPurpose: "api-key:create" }
    );

    assert.equal(sessionAsApiKeyAuth, null);

    const apiKeyChallenge = createWalletChallenge({
      address: testAccount.address,
      purpose: "api-key:create",
      request: new Request("https://api.langclaw.test/api/wallet/challenge"),
    });
    const apiKeySignature = await testAccount.signMessage({
      message: apiKeyChallenge.message,
    });
    const apiKeyAuth = await verifyWalletSession(
      {
        address: testAccount.address,
        message: apiKeyChallenge.message,
        signature: apiKeySignature,
      },
      {
        issueSession: false,
        requireChallenge: true,
        requiredPurpose: "api-key:create",
      }
    );

    assert.equal(apiKeyAuth?.authMethod, "challenge");
    assert.equal(apiKeyAuth?.purpose, "api-key:create");
    assert.equal(apiKeyAuth?.sessionToken, undefined);
  });
});

test("failed challenge verification does not consume a valid nonce", async () => {
  await withEnv({ LANGCLAW_WALLET_SESSION_SECRET: "test-wallet-secret" }, async () => {
    const challenge = createWalletChallenge({
      address: testAccount.address,
      request: new Request("https://api.langclaw.test/api/wallet/challenge"),
    });
    const signature = await testAccount.signMessage({
      message: challenge.message,
    });

    const wrongAddressAttempt = await verifyWalletSession(
      {
        address: privateKeyToAccount(
          "0x8b3a350cf5c34c9194ca3a9d8b9f4f2f6df4b36a1bc017d1f2d3dbed1d5d295d"
        ).address,
        message: challenge.message,
        signature,
      },
      { requiredPurpose: "session" }
    );

    assert.equal(wrongAddressAttempt, null);

    const verified = await verifyWalletSession(
      {
        address: testAccount.address,
        message: challenge.message,
        signature,
      },
      { requiredPurpose: "session" }
    );

    assert.equal(verified?.authMethod, "challenge");
    assert.equal(verified?.address, testAccount.address.toLowerCase());
  });
});

test("rejects a wallet challenge that expires during signature verification", async () => {
  await withEnv({ LANGCLAW_WALLET_SESSION_SECRET: "test-wallet-secret" }, async () => {
    const challenge = createWalletChallenge({
      address: testAccount.address,
      request: new Request("https://api.langclaw.test/api/wallet/challenge"),
    });
    const signature = await testAccount.signMessage({ message: challenge.message });
    const expiresAtMs = Date.parse(challenge.expiresAt);
    const originalNow = Date.now;
    let timeReads = 0;

    Date.now = () => {
      timeReads += 1;
      return timeReads <= 2 ? expiresAtMs - 1 : expiresAtMs;
    };

    try {
      const verified = await verifyWalletSession(
        {
          address: testAccount.address,
          message: challenge.message,
          signature,
        },
        { requiredPurpose: "session" },
      );

      assert.equal(verified, null);
    } finally {
      Date.now = originalNow;
    }
  });
});

test("malformed wallet signatures fail safely without consuming the nonce", async () => {
  const challenge = createWalletChallenge({
    address: testAccount.address,
    request: new Request("https://api.langclaw.test/api/wallet/challenge"),
  });

  const malformed = await verifyWalletSession(
    {
      address: testAccount.address,
      message: challenge.message,
      signature: "0x1234",
    },
    { requiredPurpose: "session" }
  );

  assert.equal(malformed, null);

  const signature = await testAccount.signMessage({ message: challenge.message });
  const verified = await verifyWalletSession(
    {
      address: testAccount.address,
      message: challenge.message,
      signature,
    },
    { requiredPurpose: "session" }
  );

  assert.equal(verified?.authMethod, "challenge");
});

test("wallet challenge storage rejects overflow without evicting pending entries", async () => {
  const request = new Request(
    "https://api.langclaw.test/api/wallet/challenge"
  );
  const oldest = createWalletChallenge({
    address: testAccount.address,
    request,
  });
  const signature = await testAccount.signMessage({ message: oldest.message });

  for (let index = 1; index < MAX_PENDING_WALLET_CHALLENGES; index += 1) {
    createWalletChallenge({ address: testAccount.address, request });
  }

  assert.throws(
    () => createWalletChallenge({ address: testAccount.address, request }),
    (error: unknown) => {
      assert.ok(error instanceof WalletAuthError);
      assert.equal(error.status, 429);
      assert.equal(error.message, "Too many pending wallet challenges. Try again later.");
      return true;
    }
  );

  const verified = await verifyWalletSession(
    {
      address: testAccount.address,
      message: oldest.message,
      signature,
    },
    { requiredPurpose: "session" }
  );

  assert.equal(verified?.authMethod, "challenge");
});
