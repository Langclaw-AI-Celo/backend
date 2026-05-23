import type { OnChainToolFinalPayload, OnChainToolResult } from "../onchain-tools/types";
import type {
  DiscoverSignals,
  FinalAnswer,
  ProviderError,
  ProviderTraceEntry,
  ResearchReport,
} from "./types";

type FinalAnswerGuardrailInput = {
  errors: ProviderError[];
  providerTrace?: ProviderTraceEntry[];
  report?: ResearchReport;
  signals: DiscoverSignals;
  onChain?: OnChainToolFinalPayload;
  onChainSkippedReason?: string;
};

type FinalAnswerGuardrails = {
  structuredCaveat: string;
  proofNarrativePolicy: string;
};

export function buildFinalAnswerGuardrails(
  input: FinalAnswerGuardrailInput
): FinalAnswerGuardrails {
  return {
    structuredCaveat: buildStructuredFinalAnswerCaveat(input),
    proofNarrativePolicy:
      "Do not claim evidenceUri, storage upload, prepared or anchored Mantle proof, Mantle anchoring, chain writes, or transaction submission status in the final answer. Proof state is reported separately by the workflow payload.",
  };
}

export function buildStructuredFinalAnswerCaveat(
  input: FinalAnswerGuardrailInput
) {
  if (input.report?.caveats.length) {
    return input.report.caveats.join(" ");
  }

  const { onChain, onChainSkippedReason, signals } = input;
  const directFailures = getDirectOnChainResults(onChain, "failed");
  const directSuccesses = getDirectOnChainResults(onChain, "success");
  const localSuccesses = onChain?.tools.filter(
    (tool) => tool.provider === "local" && tool.status === "success"
  ) ?? [];
  const failures = collectFailureNotes(input);
  const notes: string[] = [];

  if (failures.length) {
    notes.push(`Coverage gaps reduced confidence in this run: ${failures.join("; ")}.`);
  }

  if (onChainSkippedReason) {
    notes.push(`On-chain enrichment was skipped: ${normalizeSentence(onChainSkippedReason)}.`);
  } else if (onChain) {
    if (!directSuccesses.length && localSuccesses.length) {
      notes.push(
        "The on-chain output stayed analysis-only because direct provider confirmation was incomplete."
      );
    } else if (!directSuccesses.length && directFailures.length) {
      notes.push(
        "No direct on-chain provider returned fully usable confirmation in this run."
      );
    } else if (directSuccesses.length && directFailures.length) {
      notes.push(
        "The on-chain output was mixed because some direct providers failed while others returned usable evidence."
      );
    }
  }

  if (signals.combined.status === "partial") {
    notes.push(
      "The combined signal is partial, so treat this brief as directional research rather than verified accumulation."
    );
  } else if (signals.combined.status === "failed") {
    notes.push(
      "The combined signal failed, so this brief should not be treated as a verified market claim."
    );
  } else if (signals.combined.status === "skipped") {
    notes.push(
      "The combined signal was skipped, so this brief is incomplete and should be treated cautiously."
    );
  } else {
    notes.push(
      "Review this brief manually before treating it as a final market claim."
    );
  }

  notes.push(
    "Langclaw did not buy, sell, swap, or execute market transactions in this run."
  );

  return notes.join(" ");
}

export function applyFinalAnswerGuardrails(
  answer: FinalAnswer,
  input: FinalAnswerGuardrailInput
): FinalAnswer {
  const { structuredCaveat } = buildFinalAnswerGuardrails(input);
  const markdown = stripTrailingCaveatSection(answer.answerMarkdown || answer.answer);
  const answerMarkdown = markdown
    ? `${markdown}\n\nCaveat: ${structuredCaveat}`
    : `Caveat: ${structuredCaveat}`;

  return {
    ...answer,
    caveat: structuredCaveat,
    answerMarkdown,
  };
}

function collectFailureNotes({
  errors,
  onChain,
  providerTrace,
}: Pick<FinalAnswerGuardrailInput, "errors" | "onChain" | "providerTrace">) {
  const seen = new Set<string>();
  const notes: string[] = [];

  for (const entry of providerTrace ?? []) {
    if (entry.status !== "failed") {
      continue;
    }

    pushFailureNote(notes, seen, entry.provider, entry.message);
  }

  for (const error of errors) {
    pushFailureNote(notes, seen, error.provider, error.message);
  }

  for (const tool of onChain?.tools ?? []) {
    if (tool.provider === "local" || tool.status !== "failed") {
      continue;
    }

    pushFailureNote(notes, seen, providerLabel(tool.provider), tool.error || tool.summary);
  }

  return notes;
}

function pushFailureNote(
  notes: string[],
  seen: Set<string>,
  provider: string,
  message: string
) {
  const note = `${providerLabel(provider)} failed (${normalizeFailureMessage(message)})`;
  const key = note.toLowerCase();

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  notes.push(note);
}

function normalizeFailureMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();

  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function normalizeSentence(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

function providerLabel(provider: string) {
  switch (provider.toLowerCase()) {
    case "surf":
      return "Surf";
    case "elfa":
      return "Elfa";
    case "nansen":
      return "Nansen";
    case "dune":
      return "Dune";
    case "alchemy":
      return "Alchemy";
    case "coingecko":
      return "CoinGecko";
    case "defillama":
      return "DeFiLlama";
    case "dexscreener":
      return "DEX Screener";
    case "etherscan":
      return "Etherscan";
    case "geckoterminal":
      return "GeckoTerminal";
    case "goplus":
      return "GoPlus";
    case "x":
      return "X";
    default:
      return provider;
  }
}

function getDirectOnChainResults(
  onChain: OnChainToolFinalPayload | undefined,
  status: OnChainToolResult["status"]
) {
  return onChain?.tools.filter(
    (tool) => tool.provider !== "local" && tool.status === status
  ) ?? [];
}

function stripTrailingCaveatSection(markdown: string) {
  return markdown
    .replace(/\n{2,}#{1,6}\s*Caveats?\s*\n[\s\S]*$/i, "")
    .replace(/\n{2,}Caveat:\s*[\s\S]*$/i, "")
    .replace(/^Caveat:\s*[\s\S]*$/i, "")
    .trim();
}
