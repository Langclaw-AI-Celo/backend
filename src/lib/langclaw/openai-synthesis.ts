import {
  createOpenAITextResponse,
  getDefaultOpenAIModel,
  getOpenAIBaseUrl,
  hasOpenAIApiKey,
} from "../openai/responses";
import { resolveOpenAIModelSelection } from "../openai-direct-chat";
import { buildFinalAnswerPrompt, parseFinalAnswer } from "./openclaw-ai";
import { sanitizeError } from "./openclaw-runner";
import type {
  AgentOutputs,
  FinalAnswer,
  FinalAnswerMeta,
  OrchestrationRuntime,
  OrchestrationStep,
  ProviderError,
  SourceCard,
  ZeroGComputeProof,
} from "./types";

type OpenAISynthesisInput = {
  topic: string;
  sources: SourceCard[];
  errors: ProviderError[];
  runtime: OrchestrationRuntime;
  steps: OrchestrationStep[];
  agentOutputs?: AgentOutputs;
  requestedModel?: unknown;
};

type OpenAISynthesisResult = {
  finalAnswer?: FinalAnswer;
  meta: FinalAnswerMeta;
  compute: ZeroGComputeProof;
};

export async function synthesizeFinalAnswerWithOpenAI(
  input: OpenAISynthesisInput
): Promise<OpenAISynthesisResult> {
  const endpoint = getOpenAIBaseUrl();
  const selection = resolveOpenAIModelSelection(
    input.requestedModel ?? process.env.OPENAI_AGENT_MODEL?.trim(),
    "agent"
  );
  const model = selection.usedModel || getDefaultOpenAIModel("agent");

  if (!hasOpenAIApiKey()) {
    return skippedSynthesis(selection, endpoint, "OPENAI_API_KEY is empty.");
  }

  try {
    const result = await createOpenAITextResponse({
      input: buildFinalAnswerPrompt(input),
      instructions:
        "You are Langclaw's Final Conclusion Agent. Return only valid JSON.",
      maxOutputTokens: readPositiveInt(
        process.env.OPENAI_AGENT_MAX_OUTPUT_TOKENS,
        2200
      ),
      model,
    });
    const finalAnswer = parseFinalAnswer(result.text);

    if (!finalAnswer) {
      throw new Error("OpenAI did not return a valid finalAnswer JSON object.");
    }

    return {
      finalAnswer,
      meta: {
        synthesis: "openai",
        execution: "openai",
        fallbackFrom: selection.fallbackFrom,
        model: result.model || model,
        modelHonored: selection.modelHonored,
        requestedModel: selection.requestedModel,
        transport: "openai-responses",
        usedModel: result.model || model,
      },
      compute: {
        status: "used",
        endpoint,
        fallbackFrom: selection.fallbackFrom,
        model: result.model || model,
        modelHonored: selection.modelHonored,
        provider: "OpenAI",
        requestId: result.id,
        requestedModel: selection.requestedModel,
        usedModel: result.model || model,
        usage: result.usage,
      },
    };
  } catch (error) {
    const detail = sanitizeError(
      error instanceof Error ? error.message : String(error)
    );

    return {
      meta: {
        synthesis: "deterministic-fallback",
        execution: "deterministic-fallback",
        fallbackFrom: selection.fallbackFrom,
        model,
        modelHonored: selection.modelHonored,
        requestedModel: selection.requestedModel,
        transport: "openai-responses",
        error: detail || "OpenAI request failed.",
        usedModel: model,
      },
      compute: {
        status: "failed",
        endpoint,
        error: detail || "OpenAI request failed.",
        fallbackFrom: selection.fallbackFrom,
        model,
        modelHonored: selection.modelHonored,
        provider: "OpenAI",
        requestedModel: selection.requestedModel,
        usedModel: model,
      },
    };
  }
}

function skippedSynthesis(
  selection: ReturnType<typeof resolveOpenAIModelSelection>,
  endpoint: string,
  error: string
): OpenAISynthesisResult {
  const model = selection.usedModel;

  return {
    meta: {
      synthesis: "deterministic-fallback",
      execution: "deterministic-fallback",
      fallbackFrom: selection.fallbackFrom,
      model,
      modelHonored: selection.modelHonored,
      requestedModel: selection.requestedModel,
      transport: "openai-responses",
      error,
      usedModel: model,
    },
    compute: {
      status: "skipped",
      endpoint,
      error,
      fallbackFrom: selection.fallbackFrom,
      model,
      modelHonored: selection.modelHonored,
      provider: "OpenAI",
      requestedModel: selection.requestedModel,
      usedModel: model,
    },
  };
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
