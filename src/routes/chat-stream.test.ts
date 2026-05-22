import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildChatWorkflowOptions,
  handleChatStream,
} from "./chat-stream";
import {
  createWalletChallenge,
  verifyWalletSession,
} from "../lib/server/wallet-auth";
import {
  jsonResponse,
  mockFetch,
  readNdjson,
  sseResponse,
  withEnv,
} from "../test/helpers";

const testPrivateKey =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const authEnv = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  SUPABASE_URL: "https://supabase.test",
};

async function buildTestWallet() {
  const account = privateKeyToAccount(testPrivateKey);
  const challenge = createWalletChallenge({
    address: account.address,
    request: new Request("http://localhost/api/wallet/challenge"),
  });
  const signature = await account.signMessage({ message: challenge.message });
  const verified = await verifyWalletSession(
    {
      address: account.address,
      message: challenge.message,
      signature,
    },
    { requiredPurpose: "session" }
  );

  assert.ok(verified?.sessionToken);

  return {
    address: verified.address,
    sessionExpiresAt: verified.sessionExpiresAt,
    sessionToken: verified.sessionToken,
  };
}

function isSupabaseRequest(url: string) {
  return new URL(url).hostname === "supabase.test";
}

function supabaseWalletResponse() {
  return jsonResponse({
    id: "00000000-0000-4000-8000-000000000001",
    wallet_address: privateKeyToAccount(testPrivateKey).address.toLowerCase(),
  });
}

test("direct chat rejects attachments until multimodal contract exists", async () => {
  const response = await handleChatStream(
    new Request("http://localhost/api/chat/stream", {
      body: JSON.stringify({
        attachments: [{ name: "evidence.png" }],
        message: "analyze this",
      }),
      method: "POST",
    })
  );

  assert.equal(response.status, 400);
  assert.match(
    (await response.json() as { error: string }).error,
    /Multimodal attachments are not supported/
  );
});

test("direct chat rejects AI SDK FileUIPart payloads", async () => {
  const response = await handleChatStream(
    new Request("http://localhost/api/chat/stream", {
      body: JSON.stringify({
        message: {
          data: "base64",
          mimeType: "image/png",
          type: "file",
        },
      }),
      method: "POST",
    })
  );

  assert.equal(response.status, 400);
});

test("direct chat requires wallet auth", async () => {
  const response = await handleChatStream(
    new Request("http://localhost/api/chat/stream", {
      body: JSON.stringify({
        message: "halo",
      }),
      method: "POST",
    })
  );

  assert.equal(response.status, 401);
  assert.match((await response.json() as { error: string }).error, /required/);
});

test("on-chain tool mode rejects explicit unsupported chains before wallet auth", async () => {
  const response = await handleChatStream(
    new Request("http://localhost/api/chat/stream", {
      body: JSON.stringify({
        message: "Find trending tokens on Base",
        toolMode: "onchain",
      }),
      method: "POST",
    })
  );
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 400);
  assert.match(payload.error, /supports Mantle and Celo only/);
  assert.match(payload.error, /Base/);
});

test("direct chat honors supported body.model and returns metadata", async () => {
  const restore = mockFetch((url) => {
    if (isSupabaseRequest(url)) {
      return supabaseWalletResponse();
    }

    return jsonResponse({ ok: true });
  });

  try {
    await withEnv(
      {
        ...authEnv,
        OPENAI_API_KEY: "",
        OPENAI_CHAT_MODEL: "default-chat",
      },
      async () => {
        const response = await handleChatStream(
          new Request("http://localhost/api/chat/stream", {
            body: JSON.stringify({
              message: "halo",
              model: "custom-chat",
              wallet: await buildTestWallet(),
            }),
            method: "POST",
          })
        );
        const events = await readNdjson(response);
        const direct = events.find((event) => event.type === "direct");
        const reasoning = events
          .filter((event) => event.type === "direct_reasoning_delta")
          .map((event) => event.delta)
          .join("");
        const payload = direct?.payload as Record<string, unknown>;

        assert.equal(response.status, 200);
        assert.match(reasoning, /Route selected: chat/);
        assert.match(reasoning, /Model: custom-chat/);
        assert.equal(payload.requestedModel, "custom-chat");
        assert.equal(payload.usedModel, "custom-chat");
        assert.equal(payload.model, "custom-chat");
        assert.equal(payload.modelHonored, true);
      }
    );
  } finally {
    restore();
  }
});

test("direct chat streams safe reasoning progress while OpenAI answer streams", async () => {
  const restore = mockFetch((url) => {
    const parsed = new URL(url);

    if (isSupabaseRequest(url)) {
      return supabaseWalletResponse();
    }

    if (parsed.hostname === "api.openai.test") {
      const firstDelta =
        "Halo. Aku akan susun jawaban yang rapi dengan konteks yang sudah ada. ";
      const secondDelta =
        "Pertama, aku cek maksud request dan menjaga bahasa tetap natural. ".repeat(
          5
        );
      const thirdDelta =
        "\n\nBerikut versi finalnya dengan poin yang mudah discan.";

      return sseResponse([
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: firstDelta,
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: secondDelta,
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: thirdDelta,
        })}`,
        "",
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp-chat-test",
            model: "gpt-5-mini",
            usage: {
              input_tokens: 10,
              output_tokens: 40,
              total_tokens: 50,
            },
          },
        })}`,
        "",
      ]);
    }

    return jsonResponse({ ok: true });
  });

  try {
    await withEnv(
      {
        ...authEnv,
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://api.openai.test/v1",
        OPENAI_CHAT_MODEL: "gpt-5-mini",
      },
      async () => {
        const response = await handleChatStream(
          new Request("http://localhost/api/chat/stream", {
            body: JSON.stringify({
              message: "rapikan response AI",
              wallet: await buildTestWallet(),
            }),
            method: "POST",
          })
        );
        const events = await readNdjson(response);
        const reasoningEvents = events.filter(
          (event) => event.type === "direct_reasoning_delta"
        );
        const reasoning = reasoningEvents
          .map((event) => event.delta)
          .join("");
        const firstReasoningIndex = events.findIndex(
          (event) => event.type === "direct_reasoning_delta"
        );
        const firstDeltaIndex = events.findIndex(
          (event) => event.type === "direct_delta"
        );
        const direct = events.find((event) => event.type === "direct");
        const payload = direct?.payload as Record<string, unknown>;

        assert.equal(response.status, 200);
        assert.ok(reasoningEvents.length >= 4);
        assert.ok(firstReasoningIndex > -1);
        assert.ok(firstDeltaIndex > -1);
        assert.ok(firstReasoningIndex < firstDeltaIndex);
        assert.match(reasoning, /Live stream: answer tokens received/);
        assert.match(reasoning, /Output drafted: about/);
        assert.equal(payload.source, "openai");
      }
    );
  } finally {
    restore();
  }
});

test("direct chat uses configured OpenAI default model when none is requested", async () => {
  const restore = mockFetch((url) =>
    isSupabaseRequest(url) ? supabaseWalletResponse() : jsonResponse({ data: [] })
  );

  try {
    await withEnv(
      {
        ...authEnv,
        OPENAI_API_KEY: "",
        OPENAI_CHAT_MODEL: "default-chat",
      },
      async () => {
        const response = await handleChatStream(
          new Request("http://localhost/api/chat/stream", {
            body: JSON.stringify({
              message: "halo",
              wallet: await buildTestWallet(),
            }),
            method: "POST",
          })
        );
        const events = await readNdjson(response);
        const direct = events.find((event) => event.type === "direct");
        const payload = direct?.payload as Record<string, unknown>;

        assert.equal(payload.usedModel, "default-chat");
        assert.equal(payload.model, "default-chat");
        assert.equal(payload.modelHonored, true);
      }
    );
  } finally {
    restore();
  }
});

test("agent mode passes requested model into workflow options", () => {
  const options = buildChatWorkflowOptions("agent-model", () => undefined);

  assert.equal(options.requestedModel, "agent-model");
  assert.equal(typeof options.onEvent, "function");
});

test("on-chain tool mode streams plan, calls, results, and final payload", async () => {
  let reserveCalled = false;
  let finalizeCalled = false;
  let finalizedCharge: unknown;

  const restore = mockFetch((url, init) => {
    const parsed = new URL(url);

    if (isSupabaseRequest(url)) {
      if (parsed.pathname.includes("/rpc/langclaw_usage_reserve_balance")) {
        reserveCalled = true;

        return jsonResponse([
          {
            balance_after_neuron: "999999999999988000",
            balance_before_neuron: "1000000000000000000",
          },
        ]);
      }

      if (parsed.pathname.includes("/rpc/langclaw_usage_finalize_reservation")) {
        finalizeCalled = true;
        finalizedCharge =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>).p_charged_neuron
            : undefined;
        const finalizedPromptTokens =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>).p_prompt_tokens
            : undefined;
        const finalizedCompletionTokens =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
                .p_completion_tokens
            : undefined;

        return jsonResponse([
          {
            balance_after_neuron: "999999999999984400",
            charged_neuron: finalizedCharge,
            completion_tokens: finalizedCompletionTokens,
            prompt_tokens: finalizedPromptTokens,
            released_neuron: "0",
            status: "charged",
          },
        ]);
      }

      return supabaseWalletResponse();
    }

    if (parsed.hostname === "api.dexscreener.com") {
      return jsonResponse({
        pairs: [
          {
            baseToken: { symbol: "MNT" },
            chainId: "mantle",
            dexId: "agni",
            liquidity: { usd: 100000 },
            priceUsd: "1",
          },
        ],
      });
    }

    return jsonResponse({ ok: true });
  });

  try {
    await withEnv(authEnv, async () => {
      const response = await handleChatStream(
        new Request("http://localhost/api/chat/stream", {
          body: JSON.stringify({
            message: "Find trending tokens on Mantle",
            toolMode: "onchain",
            wallet: await buildTestWallet(),
          }),
          method: "POST",
        })
      );
      const events = await readNdjson(response);

      assert.equal(response.status, 200);
      assert.ok(events.some((event) => event.type === "tool_plan"));
      assert.ok(events.some((event) => event.type === "tool_call"));

      const toolResult = events.find((event) => event.type === "tool_result");
      const toolEvent = toolResult?.event as
        | { data?: unknown; sourceUrl?: string; status?: string }
        | undefined;

      assert.equal(toolEvent?.status, "success");
      assert.ok(toolEvent?.sourceUrl);
      assert.ok(toolEvent?.data);

      const toolFinal = events.find((event) => event.type === "tool_final");
      const payload = toolFinal?.payload as
        | {
          tools?: Array<{ data?: unknown }>;
            usage?: {
              chargedNeuron?: string;
              costSource?: string;
              inputTokens?: number;
              outputTokens?: number;
              status?: string;
              totalTokens?: number;
            };
          }
        | undefined;

      assert.ok(payload?.tools?.some((tool) => tool.data));
      assert.equal(payload?.usage?.chargedNeuron, finalizedCharge);
      assert.equal(payload?.usage?.costSource, "token-estimate");
      assert.ok((payload?.usage?.inputTokens ?? 0) > 0);
      assert.ok((payload?.usage?.outputTokens ?? 0) > 0);
      assert.equal(
        payload?.usage?.totalTokens,
        (payload?.usage?.inputTokens ?? 0) + (payload?.usage?.outputTokens ?? 0)
      );
      assert.equal(payload?.usage?.status, "charged");
      assert.equal(reserveCalled, true);
      assert.equal(finalizeCalled, true);
      assert.notEqual(finalizedCharge, "15600");
    });
  } finally {
    restore();
  }
});
