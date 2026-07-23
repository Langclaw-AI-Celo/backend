import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAITextResponse,
  getDefaultOpenAIModel,
  streamOpenAITextResponse,
} from "./responses";
import { mockFetch, sseResponse, withEnv } from "../../test/helpers";

function stalledSseResponse(
  signal: AbortSignal | null | undefined,
  releaseAfterMs: number,
) {
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener(
          "abort",
          () => {
            controller.error(
              signal.reason ?? new DOMException("Aborted", "AbortError"),
            );
          },
          { once: true },
        );
        releaseTimer = setTimeout(() => controller.close(), releaseAfterMs);
      },
    }),
    {
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      status: 200,
    },
  );

  return {
    cleanup() {
      if (releaseTimer) {
        clearTimeout(releaseTimer);
      }
    },
    response,
  };
}

test("chat default model falls back to GPT-5.2", async () => {
  await withEnv({}, async () => {
    assert.equal(getDefaultOpenAIModel("chat"), "gpt-5.2");
  });
});

test("OpenAI streaming preserves whitespace in output deltas", async () => {
  const restore = mockFetch(() =>
    sseResponse([
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: "Halo",
      })}`,
      "",
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: " semuanya",
      })}`,
      "",
      `data: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: ".\n\n- Satu",
      })}`,
      "",
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp-test",
          model: "gpt-5-mini",
          usage: {
            input_tokens: 3,
            output_tokens: 5,
            total_tokens: 8,
          },
        },
      })}`,
      "",
    ])
  );
  const deltas: string[] = [];

  try {
    await withEnv(
      {
        OPENAI_API_KEY: "test-key",
      },
      async () => {
        const result = await streamOpenAITextResponse({
          input: "halo",
          model: "gpt-5-mini",
          onDelta: (delta) => deltas.push(delta),
        });

        assert.equal(result.text, "Halo semuanya.\n\n- Satu");
        assert.deepEqual(deltas, ["Halo", " semuanya", ".\n\n- Satu"]);
        assert.equal(result.usage?.totalTokens, 8);
      }
    );
  } finally {
    restore();
  }
});

test("OpenAI streaming reads a trailing completed event without a final separator", async () => {
  const restore = mockFetch(
    () =>
      new Response(
        [
          `data: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "Halo",
          })}`,
          "",
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp-tail",
              model: "gpt-5.2",
              usage: {
                input_tokens: 4,
                output_tokens: 6,
                total_tokens: 10,
              },
            },
          })}`,
        ].join("\n\n"),
        {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: 200,
        }
      )
  );

  try {
    await withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      const result = await streamOpenAITextResponse({
        input: "halo",
        model: "gpt-5-mini",
      });

      assert.equal(result.text, "Halo");
      assert.equal(result.id, "resp-tail");
      assert.equal(result.model, "gpt-5.2");
      assert.equal(result.usage?.totalTokens, 10);
    });
  } finally {
    restore();
  }
});

test("OpenAI streaming accepts CRLF event separators", async () => {
  const restore = mockFetch(
    () =>
      new Response(
        [
          `data: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "Halo",
          })}`,
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp-crlf",
              model: "gpt-5.2",
              usage: {
                input_tokens: 4,
                output_tokens: 6,
                total_tokens: 10,
              },
            },
          })}`,
        ].join("\r\n\r\n"),
        {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          status: 200,
        },
      ),
  );

  try {
    await withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      const result = await streamOpenAITextResponse({
        input: "halo",
        model: "gpt-5-mini",
      });

      assert.equal(result.text, "Halo");
      assert.equal(result.id, "resp-crlf");
      assert.equal(result.model, "gpt-5.2");
      assert.equal(result.usage?.totalTokens, 10);
    });
  } finally {
    restore();
  }
});

test("OpenAI requests do not start after caller cancellation", async () => {
  const caller = new AbortController();
  let fetchCalls = 0;
  caller.abort();
  const restore = mockFetch(() => {
    fetchCalls += 1;
    return sseResponse([]);
  });

  try {
    await withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      await assert.rejects(
        streamOpenAITextResponse({ input: "halo", signal: caller.signal }),
        (error: unknown) =>
          error instanceof DOMException && error.name === "AbortError",
      );
    });
    assert.equal(fetchCalls, 0);
  } finally {
    restore();
  }
});

test("OpenAI caller cancellation remains active while the response streams", async () => {
  const caller = new AbortController();
  let cleanup = () => undefined;
  const restore = mockFetch((_url, init) => {
    const stalled = stalledSseResponse(init?.signal, 100);
    cleanup = stalled.cleanup;
    return stalled.response;
  });

  try {
    await withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      const request = streamOpenAITextResponse({
        input: "halo",
        signal: caller.signal,
      });

      await new Promise((resolve) => setImmediate(resolve));
      caller.abort();

      await assert.rejects(
        request,
        (error: unknown) =>
          error instanceof DOMException && error.name === "AbortError",
      );
    });
  } finally {
    cleanup();
    restore();
  }
});

test("OpenAI timeout remains active while the response streams", async () => {
  let cleanup = () => undefined;
  const restore = mockFetch((_url, init) => {
    const stalled = stalledSseResponse(init?.signal, 1_250);
    cleanup = stalled.cleanup;
    return stalled.response;
  });

  try {
    await withEnv(
      {
        OPENAI_API_KEY: "test-key",
        OPENAI_TIMEOUT_SECONDS: "1",
      },
      async () => {
        await assert.rejects(
          streamOpenAITextResponse({ input: "halo" }),
          (error: unknown) =>
            error instanceof DOMException && error.name === "AbortError",
        );
      },
    );
  } finally {
    cleanup();
    restore();
  }
});

test("OpenAI JSON requests reject oversized provider responses", async () => {
  const restore = mockFetch(() =>
    new Response(
      JSON.stringify({ model: "gpt-5-mini", output_text: "Halo" }),
      {
        headers: {
          "Content-Length": String(5 * 1024 * 1024 + 1),
          "Content-Type": "application/json",
        },
      },
    ),
  );

  try {
    await withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      await assert.rejects(
        createOpenAITextResponse({ input: "halo", model: "gpt-5-mini" }),
        /Provider response exceeds the 5242880 byte limit/,
      );
    });
  } finally {
    restore();
  }
});

test("OpenAI streaming rejects oversized declared responses", async () => {
  const restore = mockFetch(() =>
    sseResponse(
      [
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "Halo",
        })}`,
        "",
      ],
      { headers: { "Content-Length": String(5 * 1024 * 1024 + 1) } },
    ),
  );

  try {
    await withEnv({ OPENAI_API_KEY: "test-key" }, async () => {
      await assert.rejects(
        streamOpenAITextResponse({ input: "halo", model: "gpt-5-mini" }),
        /Provider response exceeds the 5242880 byte limit/,
      );
    });
  } finally {
    restore();
  }
});
