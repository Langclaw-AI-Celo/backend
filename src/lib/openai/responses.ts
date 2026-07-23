import {
  assertProviderResponseBytes,
  assertProviderResponseLength,
  readProviderResponseJson,
} from "../provider-response";

export type OpenAITextMessage = {
  role: "assistant" | "developer" | "system" | "user";
  content: string;
};

export type OpenAITokenUsage = {
  cachedInputTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

export type OpenAITextResult = {
  id?: string;
  incomplete?: boolean;
  model: string;
  text: string;
  usage?: OpenAITokenUsage;
};

export type OpenAITextFormat =
  | {
      type: "json_object";
    }
  | {
      type: "json_schema";
      name: string;
      strict?: boolean;
      schema: Record<string, unknown>;
    };

type OpenAIRequestInput = {
  input: OpenAITextMessage[] | string;
  instructions?: string;
  maxOutputTokens?: number;
  model?: string;
  signal?: AbortSignal;
  temperature?: number;
  textFormat?: OpenAITextFormat;
};

type OpenAIStreamInput = OpenAIRequestInput & {
  onDelta?: (delta: string) => void;
};

const defaultOpenAIBaseUrl = "https://api.openai.com/v1";
const defaultChatModel = "gpt-5.2";
const defaultAgentModel = "gpt-5.2";

export function getOpenAIBaseUrl() {
  return trimTrailingSlash(
    process.env.OPENAI_BASE_URL?.trim() || defaultOpenAIBaseUrl
  );
}

export function getDefaultOpenAIModel(kind: "agent" | "chat" = "chat") {
  if (kind === "agent") {
    return process.env.OPENAI_AGENT_MODEL?.trim() || defaultAgentModel;
  }

  return process.env.OPENAI_CHAT_MODEL?.trim() || defaultChatModel;
}

export function hasOpenAIApiKey() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function createOpenAITextResponse({
  input,
  instructions,
  maxOutputTokens,
  model = getDefaultOpenAIModel("chat"),
  signal,
  temperature,
  textFormat,
}: OpenAIRequestInput): Promise<OpenAITextResult> {
  const payload = await openAIJson<Record<string, unknown>>("/responses", {
    body: {
      input,
      instructions,
      max_output_tokens: maxOutputTokens,
      model,
      temperature,
      text: textFormat ? { format: textFormat } : undefined,
    },
    signal,
  });
  const status = readString(payload.status);

  if (status === "failed") {
    throw new Error(readOpenAIResponseError(payload) || "OpenAI response failed.");
  }

  const text = extractOpenAIText(payload);
  const incomplete = status === "incomplete";

  if (incomplete && !text.trim()) {
    throw new Error(
      "OpenAI synthesis response was incomplete with no output text. Increase OPENAI_AGENT_MAX_OUTPUT_TOKENS or shorten the research payload."
    );
  }

  return {
    id: readString(payload.id),
    incomplete,
    model: readString(payload.model) || model,
    text,
    usage: readOpenAIUsage(payload.usage),
  };
}

export async function streamOpenAITextResponse({
  input,
  instructions,
  maxOutputTokens,
  model = getDefaultOpenAIModel("chat"),
  onDelta,
  signal,
  temperature,
}: OpenAIStreamInput): Promise<OpenAITextResult> {
  const request = await openAIFetch("/responses", {
    body: {
      input,
      instructions,
      max_output_tokens: maxOutputTokens,
      model,
      stream: true,
      temperature,
    },
    signal,
  });
  const { response } = request;

  try {
    if (!response.body) {
      throw new Error("OpenAI streaming response was empty.");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let text = "";
    let id: string | undefined;
    let receivedBytes = 0;
    let usedModel = model;
    let usage: OpenAITokenUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      receivedBytes += value.byteLength;

      try {
        assertProviderResponseBytes(receivedBytes);
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/(?:\r\n|\r|\n){2}/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const parsed = parseSseData(event);
        ({ id, text, usage, usedModel } = applySseEvent({
          id,
          onDelta,
          parsed,
          text,
          usage,
          usedModel,
        }));
      }
    }

    if (buffer.trim()) {
      ({ id, text, usage, usedModel } = applySseEvent({
        id,
        onDelta,
        parsed: parseSseData(buffer),
        text,
        usage,
        usedModel,
      }));
    }

    return {
      id,
      model: usedModel,
      text,
      usage,
    };
  } finally {
    request.release();
  }
}

function applySseEvent({
  id,
  onDelta,
  parsed,
  text,
  usage,
  usedModel,
}: {
  id?: string;
  onDelta?: (delta: string) => void;
  parsed: Record<string, unknown> | null;
  text: string;
  usage?: OpenAITokenUsage;
  usedModel: string;
}) {
  if (!parsed) {
    return { id, text, usage, usedModel };
  }

  if (parsed.type === "response.output_text.delta") {
    const delta = readRawString(parsed.delta);

    if (delta) {
      text += delta;
      onDelta?.(delta);
    }

    return { id, text, usage, usedModel };
  }

  if (parsed.type === "response.output_text.done") {
    const doneText = readRawString(parsed.text);

    if (doneText && !text) {
      text = doneText;
    }

    return { id, text, usage, usedModel };
  }

  if (parsed.type === "response.completed" || parsed.type === "response.done") {
    const completed = readRecord(parsed.response);
    id = readString(completed?.id) || id;
    usedModel = readString(completed?.model) || usedModel;
    usage = readOpenAIUsage(completed?.usage) || usage;

    if (!text && completed) {
      text = extractOpenAIText(completed);
    }

    return { id, text, usage, usedModel };
  }

  if (parsed.type === "response.failed" || parsed.type === "error") {
    throw new Error(readOpenAIError(parsed) || "OpenAI response failed.");
  }

  return { id, text, usage, usedModel };
}

export function extractOpenAIText(payload: Record<string, unknown>) {
  const outputText = readString(payload.output_text);

  if (outputText) {
    return outputText;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];

  for (const item of output) {
    const record = readRecord(item);
    const content = Array.isArray(record?.content) ? record.content : [];

    for (const contentItem of content) {
      const contentRecord = readRecord(contentItem);
      const text = readString(contentRecord?.text);

      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join("\n").trim();
}

export function readOpenAIUsage(value: unknown): OpenAITokenUsage | undefined {
  const usage = readRecord(value);

  if (!usage) {
    return undefined;
  }

  const inputDetails = readRecord(usage.input_tokens_details);
  const outputDetails = readRecord(usage.output_tokens_details);
  const result: OpenAITokenUsage = {
    cachedInputTokens: readNumber(inputDetails?.cached_tokens),
    completionTokens: readNumber(usage.output_tokens),
    inputTokens: readNumber(usage.input_tokens),
    outputTokens: readNumber(usage.output_tokens),
    promptTokens: readNumber(usage.input_tokens),
    reasoningTokens: readNumber(outputDetails?.reasoning_tokens),
    totalTokens: readNumber(usage.total_tokens),
  };

  return Object.values(result).some((item) => item !== undefined)
    ? result
    : undefined;
}

async function openAIJson<T>(
  path: string,
  options: { body: Record<string, unknown>; signal?: AbortSignal }
) {
  const request = await openAIFetch(path, options);

  try {
    return await readProviderResponseJson<T>(request.response);
  } finally {
    request.release();
  }
}

async function openAIFetch(
  path: string,
  options: { body: Record<string, unknown>; signal?: AbortSignal }
) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is empty.");
  }

  options.signal?.throwIfAborted();

  const timeoutSeconds = readPositiveInt(
    process.env.OPENAI_TIMEOUT_SECONDS,
    90
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const onAbort = () => controller.abort();

  options.signal?.addEventListener("abort", onAbort, { once: true });

  const release = () => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  };

  try {
    const response = await fetch(`${getOpenAIBaseUrl()}${path}`, {
      body: JSON.stringify(removeUndefined(options.body)),
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    assertProviderResponseLength(response);

    if (!response.ok) {
      throw new Error(await readOpenAIHttpError(response));
    }

    return { release, response };
  } catch (error) {
    release();
    throw error;
  }
}

function parseSseData(event: string) {
  const data = event
    .split(/\r\n|\r|\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readOpenAIHttpError(response: Response) {
  let payload: { error?: { message?: unknown } } | null = null;

  try {
    payload = await readProviderResponseJson<{
      error?: { message?: unknown };
    }>(response);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  return (
    readString(payload?.error?.message) ||
    `OpenAI request failed with status ${response.status}.`
  );
}

function readOpenAIError(value: Record<string, unknown>) {
  const error = readRecord(value.error);

  return readString(error?.message) || readString(value.message);
}

function readOpenAIResponseError(payload: Record<string, unknown>) {
  const error = readRecord(payload.error);

  return readOpenAIError(error ?? payload);
}

function readRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readRawString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
