import assert from "node:assert/strict";
import test from "node:test";

import { createWalletSessionForVerifiedAddress } from "../lib/server/wallet-auth";
import { mockFetch, withEnv } from "../test/helpers";
import {
  handleChatSessions,
  normalizeSession,
  readOptionalTitle,
} from "./chat-sessions";

const sessionOwner = "0x1111111111111111111111111111111111111111";

test("chat session normalization preserves message chains", () => {
  const session = normalizeSession({
    createdAt: "2026-07-19T01:00:00.000Z",
    id: "session-chain",
    messages: [
      {
        chain: "celo",
        content: "Check Celo proof state",
        id: "message-chain",
        role: "user",
      },
    ],
    title: "Chain context",
    updatedAt: "2026-07-19T01:01:00.000Z",
  });

  assert.equal(session?.messages[0]?.chain, "celo");
});

test("chat session normalization rejects partial message payloads", () => {
  const session = normalizeSession({
    createdAt: "2026-07-19T01:00:00.000Z",
    id: "session-partial",
    messages: [
      { content: "Keep me", id: "message-valid", role: "user" },
      { content: "Do not drop me silently", id: "message-invalid", role: "system" },
    ],
    title: "Partial session",
    updatedAt: "2026-07-19T01:01:00.000Z",
  });

  assert.equal(session, null);
});

test("chat session normalization rejects non-boolean pinned state", () => {
  const session = normalizeSession({
    createdAt: "2026-07-19T01:00:00.000Z",
    id: "session-pinned",
    messages: [],
    pinned: "false",
    title: "Pinned state",
    updatedAt: "2026-07-19T01:01:00.000Z",
  });

  assert.equal(session, null);
});

test("chat session normalization rejects empty storage identifiers", () => {
  const baseSession = {
    createdAt: "2026-07-19T01:00:00.000Z",
    id: "session-id",
    messages: [{ content: "Hello", id: "message-id", role: "user" }],
    title: "Stored session",
    updatedAt: "2026-07-19T01:01:00.000Z",
  };

  assert.equal(normalizeSession({ ...baseSession, id: "   " }), null);
  assert.equal(normalizeSession({ ...baseSession, title: "" }), null);
  assert.equal(
    normalizeSession({
      ...baseSession,
      messages: [{ content: "Hello", id: "", role: "user" }],
    }),
    null,
  );
});

test("chat session normalization rejects invalid timestamps", () => {
  const baseSession = {
    createdAt: "2026-07-19T01:00:00.000Z",
    id: "session-time",
    messages: [],
    title: "Session time",
    updatedAt: "2026-07-19T01:01:00.000Z",
  };

  assert.equal(normalizeSession({ ...baseSession, createdAt: "not-a-date" }), null);
  assert.equal(normalizeSession({ ...baseSession, updatedAt: "invalid" }), null);
});

test("chat session normalization rejects unsupported message context", () => {
  const baseSession = {
    createdAt: "2026-07-19T01:00:00.000Z",
    id: "session-context",
    title: "Message context",
    updatedAt: "2026-07-19T01:01:00.000Z",
  };

  for (const message of [
    { chain: "ethereum", content: "Hello", id: "message-chain", role: "user" },
    { content: "Hello", id: "message-mode", mode: "tool", role: "assistant" },
  ]) {
    assert.equal(normalizeSession({ ...baseSession, messages: [message] }), null);
  }
});

test("chat session metadata accepts omitted titles and rejects invalid values", () => {
  assert.deepEqual(readOptionalTitle(undefined), {});
  assert.deepEqual(readOptionalTitle(42), { error: "title must be a string." });
  assert.deepEqual(readOptionalTitle("   \n  "), { error: "title cannot be empty." });
});

test("chat session metadata normalizes and limits titles", () => {
  assert.deepEqual(readOptionalTitle("  CELO\n  proof   status  "), {
    value: "CELO proof status",
  });

  const result = readOptionalTitle("a".repeat(140));
  assert.equal(result.value?.length, 120);
  assert.equal(result.value, `${"a".repeat(117)}...`);
});

test("chat session routes reject malformed JSON and unauthenticated requests", async () => {
  await withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
      SUPABASE_URL: "https://supabase.test",
    },
    async () => {
      const malformed = await handleChatSessions(
        new Request("http://localhost/api/chat/sessions", {
          body: "{not-json",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      );
      const unauthenticated = await handleChatSessions(
        chatSessionRequest({ action: "list" })
      );

      assert.equal(malformed.status, 400);
      assert.deepEqual(await malformed.json(), {
        configured: true,
        error: "Request body must be valid JSON.",
      });
      assert.equal(unauthenticated.status, 401);
      assert.deepEqual(await unauthenticated.json(), {
        configured: true,
        error: "Wallet signature or API key is required.",
      });
    }
  );
});

test("chat session routes reject non-object JSON before authentication", async () => {
  await withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
      SUPABASE_URL: "https://supabase.test",
    },
    async () => {
      for (const body of [null, [], "invalid"]) {
        const response = await handleChatSessions(
          new Request("http://localhost/api/chat/sessions", {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          }),
        );

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          configured: true,
          error: "Request body must be a JSON object.",
        });
      }
    },
  );
});

test("chat session routes validate mutation inputs after authentication", async () => {
  const restoreFetch = mockFetch((url) => {
    assert.match(new URL(url).pathname, /\/langclaw_wallet_users$/);

    return Response.json({
      id: "wallet-user-owner",
      wallet_address: sessionOwner,
    });
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);
        const cases = [
          {
            body: { action: "get", wallet },
            error: "sessionId is required.",
          },
          {
            body: { action: "delete", wallet },
            error: "sessionId is required.",
          },
          {
            body: { action: "update", wallet },
            error: "sessionId is required.",
          },
          {
            body: {
              action: "update",
              sessionId: "session-id",
              title: 42,
              wallet,
            },
            error: "title must be a string.",
          },
          {
            body: {
              action: "update",
              sessionId: "session-id",
              title: "   ",
              wallet,
            },
            error: "title cannot be empty.",
          },
          {
            body: { action: "update", sessionId: "session-id", wallet },
            error: "title or pinned is required.",
          },
          {
            body: { action: "upsert", session: {}, wallet },
            error: "A valid session is required.",
          },
        ];

        for (const testCase of cases) {
          const response = await handleChatSessions(
            chatSessionRequest(testCase.body)
          );

          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), {
            configured: true,
            error: testCase.error,
          });
        }
      }
    );
  } finally {
    restoreFetch();
  }
});

test("chat session routes list owned data and report missing sessions", async () => {
  const restoreFetch = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-owner",
        wallet_address: sessionOwner,
      });
    }

    assert.match(parsed.pathname, /\/langclaw_chat_sessions$/);
    const selected = parsed.searchParams.get("select") ?? "";

    if (selected === "wallet_user_id") {
      return Response.json(null);
    }

    return parsed.searchParams.has("limit")
      ? Response.json([])
      : Response.json(null);
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);
        const listed = await handleChatSessions(
          chatSessionRequest({ action: "list", wallet })
        );
        const read = await handleChatSessions(
          chatSessionRequest({
            action: "get",
            sessionId: "missing-session",
            wallet,
          })
        );
        const updated = await handleChatSessions(
          chatSessionRequest({
            action: "update",
            sessionId: "missing-session",
            title: "Updated title",
            wallet,
          })
        );

        assert.deepEqual(await listed.json(), {
          configured: true,
          sessions: [],
        });
        assert.deepEqual(await read.json(), {
          configured: true,
          session: null,
        });
        assert.equal(updated.status, 404);
        assert.deepEqual(await updated.json(), {
          configured: true,
          error: "Chat session was not found.",
        });
      }
    );
  } finally {
    restoreFetch();
  }
});

test("chat session listing does not expose storage details", async () => {
  const restoreFetch = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-owner",
        wallet_address: sessionOwner,
      });
    }

    return Response.json(
      { message: "relation langclaw_chat_sessions is missing" },
      { status: 500 },
    );
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);
        const response = await handleChatSessions(
          chatSessionRequest({ action: "list", wallet }),
        );

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          configured: true,
          error: "Unable to list chat sessions.",
        });
      },
    );
  } finally {
    restoreFetch();
  }
});

test("chat session deletion fails closed when owner lookup fails", async () => {
  let chatSessionRequests = 0;
  const restoreFetch = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-owner",
        wallet_address: sessionOwner,
      });
    }

    chatSessionRequests += 1;
    return Response.json(
      { message: "database connection failed" },
      { status: 500 },
    );
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);
        const response = await handleChatSessions(
          chatSessionRequest({
            action: "delete",
            sessionId: "session-id",
            wallet,
          }),
        );

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          configured: true,
          error: "Unable to read chat session ownership.",
        });
        assert.equal(chatSessionRequests, 1);
      },
    );
  } finally {
    restoreFetch();
  }
});

test("chat session reads fail instead of returning an empty partial session", async () => {
  const restoreFetch = mockFetch((url) => {
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-owner",
        wallet_address: sessionOwner,
      });
    }

    if (parsed.pathname.endsWith("/langclaw_chat_sessions")) {
      return Response.json({
        created_at: "2026-07-19T01:00:00.000Z",
        id: "session-id",
        pinned: false,
        title: "Stored session",
        updated_at: "2026-07-19T01:05:00.000Z",
      });
    }

    assert.match(parsed.pathname, /\/langclaw_chat_messages$/);
    return Response.json(
      { message: "message storage read failed" },
      { status: 500 },
    );
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);
        const response = await handleChatSessions(
          chatSessionRequest({
            action: "get",
            sessionId: "session-id",
            wallet,
          }),
        );

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
          configured: true,
          error: "Unable to read chat session.",
        });
      },
    );
  } finally {
    restoreFetch();
  }
});

test("chat session mutations reject sessions owned by another wallet", async () => {
  let ownerReads = 0;
  const restoreFetch = mockFetch((url) => {
    const path = new URL(url).pathname;

    if (path.endsWith("/langclaw_wallet_users")) {
      return Response.json({
        id: "wallet-user-owner",
        wallet_address: sessionOwner,
      });
    }

    assert.match(path, /\/langclaw_chat_sessions$/);
    ownerReads += 1;
    return Response.json({ wallet_user_id: "wallet-user-other" });
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);

        for (const body of [
          { action: "delete", sessionId: "session-owned-by-other" },
          {
            action: "update",
            sessionId: "session-owned-by-other",
            title: "New title",
          },
        ]) {
          const response = await handleChatSessions(
            chatSessionRequest({ ...body, wallet })
          );

          assert.equal(response.status, 403);
          assert.deepEqual(await response.json(), {
            configured: true,
            error: "Session belongs to another wallet.",
          });
        }

        assert.equal(ownerReads, 2);
      }
    );
  } finally {
    restoreFetch();
  }
});

test("chat session routes reject unsupported actions after authentication", async () => {
  const restoreFetch = mockFetch((url) => {
    const path = new URL(url).pathname;
    assert.match(path, /\/langclaw_wallet_users$/);

    return Response.json({
      id: "wallet-user-owner",
      wallet_address: sessionOwner,
    });
  });

  try {
    await withEnv(
      {
        LANGCLAW_WALLET_SESSION_SECRET: "chat-route-test-secret",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
        SUPABASE_URL: "https://supabase.test",
      },
      async () => {
        const wallet = createWalletSessionForVerifiedAddress(sessionOwner);
        const response = await handleChatSessions(
          chatSessionRequest({ action: "archive", wallet })
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

function chatSessionRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chat/sessions", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
