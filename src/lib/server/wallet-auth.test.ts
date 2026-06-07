import assert from "node:assert/strict";
import test from "node:test";

import { privateKeyToAccount } from "viem/accounts";

import { withEnv } from "../../test/helpers";
import {
  createWalletChallenge,
  verifyWalletSession,
} from "./wallet-auth";

const testAccount = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945388c9d22d2334a4f12d7873b4d0b08c8756"
);

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

