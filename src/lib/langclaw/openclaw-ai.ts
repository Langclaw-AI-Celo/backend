import {
  isRecord,
  parseLooseJson,
  readPositiveInt,
  readString,
  runOpenClawAgentJson,
} from "./openclaw-runner";
import type {
  AgentOutputs,
  FinalAnswer,
  FinalAnswerMeta,
  OrchestrationRuntime,
  OrchestrationStep,
  ProviderError,
  SourceCard,
} from "./types";

type OpenClawFinalAnswerInput = {
  topic: string;
  sources: SourceCard[];
  errors: ProviderError[];
  runtime: OrchestrationRuntime;
  steps: OrchestrationStep[];
  agentOutputs?: AgentOutputs;
  sessionId?: string;
};

type OpenClawFinalAnswerResult = {
  finalAnswer?: FinalAnswer;
  meta: FinalAnswerMeta;
};

export async function synthesizeFinalAnswerWithOpenClaw(
  input: OpenClawFinalAnswerInput
): Promise<OpenClawFinalAnswerResult> {
  const requestedSessionId =
    input.sessionId ||
    process.env.OPENCLAW_AGENT_SESSION_ID ||
    "langclaw-final-answer";

  if (process.env.OPENCLAW_ENABLED !== "true") {
    return {
      meta: {
        synthesis: "deterministic-fallback",
        execution: "deterministic-fallback",
        sessionId: requestedSessionId,
        error: "OPENCLAW_ENABLED is false.",
      },
    };
  }

  if (process.env.OPENCLAW_AI_SYNTHESIS === "false") {
    return {
      meta: {
        synthesis: "deterministic-fallback",
        execution: "deterministic-fallback",
        sessionId: requestedSessionId,
        error: "OPENCLAW_AI_SYNTHESIS is false.",
      },
    };
  }

  const timeoutSeconds = readPositiveInt(
    process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS,
    90
  );
  const thinking = process.env.OPENCLAW_AGENT_THINKING || "low";
  const model = process.env.OPENCLAW_MODEL?.trim();
  const prompt = buildFinalAnswerPrompt(input);

  const result = await runOpenClawAgentJson({
    prompt,
    sessionId: requestedSessionId,
    model,
    thinking,
    timeoutSeconds,
  });
  const finalAnswer = parseFinalAnswer(result.text);

  if (finalAnswer) {
    return {
      finalAnswer,
      meta: {
        synthesis: "openclaw-ai",
        execution: "openclaw-agent",
        model: result.meta.model,
        sessionId: result.meta.sessionId,
        transport: result.meta.transport,
        fallbackFrom: result.meta.fallbackFrom,
      },
    };
  }

  return {
    meta: {
      synthesis: "deterministic-fallback",
      execution: "deterministic-fallback",
      model: result.meta.model || model || undefined,
      sessionId: result.meta.sessionId,
      error: result.meta.error || "OpenClaw model did not return a valid finalAnswer JSON object.",
    },
  };
}

export function buildFinalAnswerPrompt(input: OpenClawFinalAnswerInput) {
  const evidence = {
    topic: input.topic,
    providerCoverage: summarizeProviderCoverage(input.sources),
    providerErrors: input.errors,
    sources: input.sources.map((source) => ({
      id: source.id,
      type: source.type,
      title: cleanText(source.title),
      url: source.url,
      author: source.author,
      publishedAt: source.publishedAt,
      excerpt: cleanText(source.excerpt).slice(0, 700),
      metrics: source.metrics,
      provider: source.provider,
    })),
    orchestration: {
      runtime: input.runtime,
      steps: input.steps,
    },
    agentOutputs: input.agentOutputs,
  };

  return [
    "You are Langclaw's Final Conclusion Agent.",
    "Write the final answer as a natural AI chat response, not a dashboard card.",
    "Use polished ChatGPT-style structure: one concise opening paragraph, 2-6 scannable bullets, and short recommendation/caveat text.",
    "Do not write dense paragraphs. Do not put markdown tables into JSON string fields unless they are necessary and valid.",
    "Use only the evidence in the input JSON. Do not invent facts, numbers, dates, providers, URLs, or claims.",
    "If a provider failed or evidence is weak, say that clearly in the caveat.",
    "Answer in the same language as the user topic. If the topic mixes Indonesian and English, prefer Indonesian.",
    "Return only valid JSON. Do not wrap it in markdown. Do not add commentary outside JSON.",
    "",
    "Required JSON shape:",
    JSON.stringify(
      {
        title: "short answer title",
        answer: "direct answer to the user's topic or question",
        bullets: ["evidence-grounded reason 1", "evidence-grounded reason 2"],
        recommendation: "practical next step",
        caveat: "quality note based on provider errors and source coverage",
        generatedBy: "Final Conclusion Agent",
      },
      null,
      2
    ),
    "",
    "Input JSON:",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

export function parseFinalAnswer(text: string): FinalAnswer | undefined {
  const parsed = parseLooseJson(text);
  const candidate = isRecord(parsed) && isRecord(parsed.finalAnswer)
    ? parsed.finalAnswer
    : parsed;

  if (!isRecord(candidate)) {
    return undefined;
  }

  const title = readString(candidate.title);
  const answer = readString(candidate.answer);
  const recommendation = readString(candidate.recommendation);
  const caveat = readString(candidate.caveat);
  const bullets = Array.isArray(candidate.bullets)
    ? candidate.bullets.map(readString).filter(Boolean).slice(0, 6)
    : [];

  if (!title || !answer || !recommendation || !caveat) {
    return undefined;
  }

  return {
    title,
    answer,
    bullets,
    recommendation,
    caveat,
    generatedBy: "Final Conclusion Agent",
  };
}

function summarizeProviderCoverage(sources: SourceCard[]) {
  const counts = new Map<SourceCard["provider"], number>();

  for (const source of sources) {
    counts.set(source.provider, (counts.get(source.provider) ?? 0) + 1);
  }

  return ["X", "GitHub", "Tavily", "HackQuest"].map((provider) => ({
    provider,
    count: counts.get(provider as SourceCard["provider"]) ?? 0,
  }));
}

function cleanText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
