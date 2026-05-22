import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { synthesizeFinalAnswerWithOpenAI } from "./openai-synthesis";
import {
  createRunId,
  runEvidenceAgentStep,
  runPlannerAgentStep,
  runTrendAgentStep,
  runVerifierAgentStep,
  shouldRunOpenClawWorkflow,
} from "./openclaw-workflow";
import { runProviderDiscovery } from "./providers";
import { persistLangclawProof } from "./proof";
import { resolveProductChain } from "../chain-config";
import type {
  AgentOutputs,
  DiscoverPayload,
  FinalAnswer,
  FinalAnswerMeta,
  FinalConclusion,
  OrchestrationRuntime,
  OrchestrationStep,
  ProviderError,
  SourceCard,
  StepExecution,
  WorkflowProgressEvent,
  ZeroGChainProof,
  ZeroGComputeProof,
  ZeroGProof,
  ZeroGStorageProof,
} from "./types";

const execFileAsync = promisify(execFile);

type OpenClawProbe = {
  available: boolean;
  summary: string;
};

type WorkflowStepDefinition = {
  stepId: string;
  agent: string;
  skill: string;
  pendingSummary: string;
};

type WorkflowOptions = {
  chain?: string;
  onEvent?: (event: WorkflowProgressEvent) => void | Promise<void>;
  requestedModel?: unknown;
};

type TraceOverrides = Record<string, Partial<OrchestrationStep>>;

const workflowSteps: WorkflowStepDefinition[] = [
  {
    stepId: "runtime",
    agent: "OpenClaw Runtime Adapter",
    skill: "openclaw/runtime-adapter",
    pendingSummary: "Waiting for OpenClaw runtime detection.",
  },
  {
    stepId: "planner",
    agent: "Planner Agent",
    skill: "openclaw/skills/planner.md",
    pendingSummary: "Waiting to create the provider search plan.",
  },
  {
    stepId: "discovery",
    agent: "Discovery Agent",
    skill: "openclaw/skills/discovery.md",
    pendingSummary: "Waiting to collect live X, GitHub, Docs, and HackQuest sources.",
  },
  {
    stepId: "source-normalizer",
    agent: "Source Normalizer Agent",
    skill: "openclaw/skills/source-normalizer.md",
    pendingSummary: "Waiting to normalize source cards.",
  },
  {
    stepId: "trend-scorer",
    agent: "Trend Scorer Agent",
    skill: "openclaw/skills/trend-scorer.md",
    pendingSummary: "Waiting to score repeated patterns.",
  },
  {
    stepId: "evidence-packager",
    agent: "Evidence Packager Agent",
    skill: "openclaw/skills/evidence-packager.md",
    pendingSummary: "Waiting to prepare the evidence bundle.",
  },
  {
    stepId: "verifier",
    agent: "Verifier Agent",
    skill: "openclaw/skills/verifier.md",
    pendingSummary: "Waiting to prepare verification fields.",
  },
  {
    stepId: "final-conclusion",
    agent: "Final Conclusion Agent",
    skill: "openclaw/skills/final-conclusion.md",
    pendingSummary: "Waiting to write the final answer.",
  },
  {
    stepId: "evidence-bundle",
    agent: "Evidence Bundle Commit",
    skill: "evidence/storage",
    pendingSummary: "Waiting to prepare the evidence bundle.",
  },
  {
    stepId: "mantle-chain",
    agent: "Mantle Decision Anchor",
    skill: "contracts/src/LangclawRegistry.sol",
    pendingSummary: "Waiting to record the agent decision proof on Mantle.",
  },
];

export async function runLangclawWorkflow(
  topic: string,
  options: WorkflowOptions = {}
): Promise<DiscoverPayload> {
  const chain = resolveProductChain(options.chain);
  const runId = createRunId();
  const traceOverrides: TraceOverrides = {};

  for (const step of workflowSteps) {
    await emitProgress(options, step, "pending", step.pendingSummary);
  }

  await emitProgress(
    options,
    workflowSteps[0],
    "running",
    "Checking whether OpenClaw CLI is available."
  );
  const openClawProbe = await resolveOpenClawRuntime();
  const runtime: OrchestrationRuntime = openClawProbe.available
    ? "openclaw"
    : "typescript";
  traceOverrides.runtime = {
    execution: openClawProbe.available ? "typescript-tool" : "deterministic-fallback",
    error: openClawProbe.available ? undefined : openClawProbe.summary,
  };
  await emitProgress(options, workflowSteps[0], "complete", openClawProbe.summary);
  const openClawWorkflowEnabled = shouldRunOpenClawWorkflow(openClawProbe.available);

  await emitProgress(
    options,
    workflowSteps[1],
    "running",
    openClawWorkflowEnabled
      ? `Planner Agent is running through OpenClaw for "${topic}".`
      : `Planner Agent is using deterministic fallback for "${topic}".`
  );
  const plannerStep = await runPlannerAgentStep(
    topic,
    openClawWorkflowEnabled,
    runId
  );
  traceOverrides.planner = traceFromMeta(
    plannerStep.output.summary,
    plannerStep.meta
  );
  await emitProgress(
    options,
    workflowSteps[1],
    "complete",
    plannerStep.output.summary,
    plannerStep.meta
  );

  await emitProgress(
    options,
    workflowSteps[2],
    "running",
    "Collecting live source cards from server-side provider tools."
  );
  const providerResult = await runProviderDiscovery(topic);
  const sources = providerResult.sources;
  const errors = providerResult.errors;
  const providerSummary = summarizeProviders(sources);
  const failureSummary = summarizeFailures(errors);
  traceOverrides.discovery = {
    execution: "typescript-tool",
  };
  await emitProgress(
    options,
    workflowSteps[2],
    sources.length ? "complete" : "failed",
    `Collected ${sources.length} live source cards from ${providerSummary}.${failureSummary}`
  );

  await emitProgress(
    options,
    workflowSteps[3],
    "running",
    "Normalizing discovered items into the SourceCard evidence model."
  );
  traceOverrides["source-normalizer"] = {
    execution: "typescript-tool",
  };
  await emitProgress(
    options,
    workflowSteps[3],
    sources.length ? "complete" : "failed",
    "Normalized discovered items into SourceCard records with provider, URL, excerpt, date, author, and metrics."
  );

  await emitProgress(
    options,
    workflowSteps[4],
    "running",
    openClawWorkflowEnabled
      ? "Trend Scorer Agent is ranking source patterns through OpenClaw."
      : "Trend Scorer Agent is using deterministic fallback scoring."
  );
  const trendStep = await runTrendAgentStep(
    topic,
    sources,
    errors,
    plannerStep.output,
    openClawWorkflowEnabled,
    runId
  );
  traceOverrides["trend-scorer"] = traceFromMeta(
    trendStep.output.summary,
    trendStep.meta
  );
  await emitProgress(
    options,
    workflowSteps[4],
    sources.length ? "complete" : "failed",
    trendStep.output.summary,
    trendStep.meta
  );

  await emitProgress(
    options,
    workflowSteps[5],
    "running",
    openClawWorkflowEnabled
      ? "Evidence Packager Agent is preparing claim maps through OpenClaw."
      : "Evidence Packager Agent is using deterministic fallback packaging."
  );
  const evidenceStep = await runEvidenceAgentStep(
    topic,
    sources,
    errors,
    trendStep.output,
    openClawWorkflowEnabled,
    runId
  );
  traceOverrides["evidence-packager"] = traceFromMeta(
    evidenceStep.output.bundleSummary,
    evidenceStep.meta
  );
  await emitProgress(
    options,
    workflowSteps[5],
    sources.length ? "complete" : "failed",
    evidenceStep.output.bundleSummary,
    evidenceStep.meta
  );

  await emitProgress(
    options,
    workflowSteps[6],
    "running",
    openClawWorkflowEnabled
      ? "Verifier Agent is checking claim support through OpenClaw."
      : "Verifier Agent is using deterministic fallback checks."
  );
  const verifierStep = await runVerifierAgentStep(
    topic,
    sources,
    trendStep.output,
    evidenceStep.output,
    openClawWorkflowEnabled,
    runId
  );
  traceOverrides.verifier = traceFromMeta(
    verifierStep.output.verificationSummary,
    verifierStep.meta
  );
  await emitProgress(
    options,
    workflowSteps[6],
    sources.length ? "complete" : "failed",
    verifierStep.output.verificationSummary,
    verifierStep.meta
  );

  await emitProgress(
    options,
    workflowSteps[7],
    "running",
    "Final Conclusion Agent is asking OpenAI Responses API."
  );
  const agentOutputs: AgentOutputs = {
    planner: plannerStep.output,
    trend: trendStep.output,
    evidence: evidenceStep.output,
    verifier: verifierStep.output,
  };
  const finalConclusion = buildFinalConclusion(
    topic,
    sources,
    errors,
    runtime,
    agentOutputs
  );
  const traceBeforeAnswer = buildTraceSteps(
    topic,
    sources,
    errors,
    openClawProbe,
    traceOverrides
  );
  const fallbackAnswer = buildFinalAnswer(topic, sources, errors, runtime);
  const computeSynthesis = await synthesizeFinalAnswerWithOpenAI({
    topic,
    sources,
    errors,
    runtime,
    steps: traceBeforeAnswer,
    agentOutputs,
    requestedModel: options.requestedModel,
  });
  const synthesis = computeSynthesis;
  const finalAnswerMeta = synthesis.meta;
  traceOverrides["final-conclusion"] = traceFromFinalAnswerMeta(
    summarizeFinalAnswerStep(finalAnswerMeta, sources.length),
    finalAnswerMeta
  );
  const finalAnswer = synthesis.finalAnswer
    ? synthesis.finalAnswer
    : withFallbackCaveat(fallbackAnswer, finalAnswerMeta);
  await emitProgress(
    options,
    workflowSteps[7],
    "complete",
    summarizeFinalAnswerProgress(finalAnswerMeta, Boolean(synthesis.finalAnswer)),
    finalAnswerMeta
  );

  await emitProgress(
    options,
    workflowSteps[8],
    "running",
    `Building the canonical evidence bundle for source-backed ${chain.name} alpha proof.`
  );
  await emitProgress(
    options,
    workflowSteps[9],
    "running",
    `Preparing the agent decision hash and submitting it to LangclawRegistry on ${chain.name} when enabled.`
  );
  const generatedAt = new Date().toISOString();
  const proof = await persistLangclawProof({
    chain: chain.id,
    runId,
    topic,
    generatedAt,
    sources,
    errors,
    steps: buildTraceSteps(
      topic,
      sources,
      errors,
      openClawProbe,
      traceOverrides,
      finalAnswerMeta
    ),
    finalConclusion,
    finalAnswer,
    agentOutputs,
  });

  updateAgentOutputsWithProof(agentOutputs, proof);
  traceOverrides["evidence-bundle"] = traceFromStorageProof(proof.storage);
  traceOverrides["mantle-chain"] = traceFromChainProof(proof.chain);
  await emitProgress(
    options,
    workflowSteps[8],
    proof.storage.status === "failed" ? "failed" : "complete",
    summarizeStorageProof(proof.storage),
    proofMetaFromStorage(proof.storage)
  );
  await emitProgress(
    options,
    workflowSteps[9],
    proof.chain.status === "failed" ? "failed" : "complete",
    summarizeChainProof(proof.chain),
    proofMetaFromChain(proof.chain)
  );

  return {
    topic,
    generatedAt,
    sources,
    errors,
    orchestration: {
      runtime,
      steps: buildTraceSteps(
        topic,
        sources,
        errors,
        openClawProbe,
        traceOverrides,
        finalAnswerMeta
      ),
    },
    finalConclusion,
    finalAnswer,
    finalAnswerMeta,
    agentOutputs,
    proof: {
      ...proof,
      compute: computeSynthesis.compute,
    },
    zeroG: {
      ...proof,
      compute: computeSynthesis.compute,
    },
  };
}

async function resolveOpenClawRuntime(): Promise<OpenClawProbe> {
  if (process.env.OPENCLAW_ENABLED !== "true") {
    return {
      available: false,
      summary:
        "OPENCLAW_ENABLED is false. Langclaw used the built-in TypeScript OpenClaw-compatible runtime.",
    };
  }

  const cliPath = process.env.OPENCLAW_CLI_PATH || "openclaw";
  const version = await runOpenClawCommand(cliPath, ["--version"]);

  if (version.available) {
    return {
      available: true,
      summary: `OpenClaw CLI responded through ${cliPath}: ${version.summary}`,
    };
  }

  const help = await runOpenClawCommand(cliPath, ["--help"]);

  if (help.available) {
    return {
      available: true,
      summary: `OpenClaw CLI responded through ${cliPath}. Help output attached as runtime proof.`,
    };
  }

  return {
    available: false,
    summary: `OPENCLAW_ENABLED is true, but ${cliPath} was not callable. ${version.summary}`,
  };
}

async function runOpenClawCommand(
  cliPath: string,
  args: string[]
): Promise<OpenClawProbe> {
  try {
    const result = await execFileAsync(cliPath, args, {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    });
    const output = compactOutput(result.stdout || result.stderr);

    return {
      available: true,
      summary: output || "command completed",
    };
  } catch (error) {
    return {
      available: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildTraceSteps(
  topic: string,
  sources: SourceCard[],
  errors: ProviderError[],
  openClawProbe: OpenClawProbe,
  traceOverrides: TraceOverrides = {},
  finalAnswerMeta?: FinalAnswerMeta
): OrchestrationStep[] {
  const providers = new Set(sources.map((source) => source.provider));
  const failedProviders = Array.from(
    new Set(errors.map((error) => error.provider))
  );
  const providerSummary = providers.size
    ? Array.from(providers).join(", ")
    : "no providers";
  const failureSummary = failedProviders.length
    ? ` Provider issues: ${failedProviders.join(", ")}.`
    : "";

  return [
    withTraceOverride("runtime", traceOverrides, {
      agent: "OpenClaw Runtime Adapter",
      skill: "openclaw/runtime-adapter",
      status: "complete",
      summary: openClawProbe.summary,
      execution: "typescript-tool",
    }),
    withTraceOverride("planner", traceOverrides, {
      agent: "Planner Agent",
      skill: "openclaw/skills/planner.md",
      status: "complete",
      summary: `Created provider search plan for "${topic}" across X, GitHub, Docs, and HackQuest.`,
      execution: "deterministic-fallback",
    }),
    withTraceOverride("discovery", traceOverrides, {
      agent: "Discovery Agent",
      skill: "openclaw/skills/discovery.md",
      status: sources.length ? "complete" : "failed",
      summary: `Collected ${sources.length} live source cards from ${providerSummary}.${failureSummary}`,
      execution: "typescript-tool",
    }),
    withTraceOverride("source-normalizer", traceOverrides, {
      agent: "Source Normalizer Agent",
      skill: "openclaw/skills/source-normalizer.md",
      status: sources.length ? "complete" : "failed",
      summary:
        "Normalized discovered items into SourceCard records with provider, URL, excerpt, date, author, and metrics.",
      execution: "typescript-tool",
    }),
    withTraceOverride("trend-scorer", traceOverrides, {
      agent: "Trend Scorer Agent",
      skill: "openclaw/skills/trend-scorer.md",
      status: sources.length ? "complete" : "failed",
      summary:
        "Prepared trend scoring inputs from repeated agent, infrastructure, launch, and builder signals.",
      execution: "deterministic-fallback",
    }),
    withTraceOverride("evidence-packager", traceOverrides, {
      agent: "Evidence Packager Agent",
      skill: "openclaw/skills/evidence-packager.md",
      status: sources.length ? "complete" : "failed",
      summary:
        "Prepared the discovered source bundle, provider errors, and run trace for the evidence bundle. Upload not submitted yet.",
      execution: "deterministic-fallback",
    }),
    withTraceOverride("verifier", traceOverrides, {
      agent: "Verifier Agent",
      skill: "openclaw/skills/verifier.md",
      status: sources.length ? "complete" : "failed",
      summary:
        "Prepared brief hash inputs and claim support checks for the verification panel. Chain anchoring not submitted yet.",
      execution: "deterministic-fallback",
    }),
    withTraceOverride("final-conclusion", traceOverrides, {
      agent: "Final Conclusion Agent",
      skill: "openclaw/skills/final-conclusion.md",
      status: "complete",
      summary: summarizeFinalAnswerStep(finalAnswerMeta, sources.length),
      execution: finalAnswerMeta?.execution || "deterministic-fallback",
      model: finalAnswerMeta?.model,
      sessionId: finalAnswerMeta?.sessionId,
      error: finalAnswerMeta?.error,
    }),
    withTraceOverride("evidence-bundle", traceOverrides, {
      agent: "Evidence Bundle Commit",
      skill: "evidence/storage",
      status: "complete",
      summary:
        "Prepared the canonical evidence bundle for Mantle alpha evidence.",
      execution: "deterministic-fallback",
    }),
    withTraceOverride("mantle-chain", traceOverrides, {
      agent: "Mantle Decision Anchor",
      skill: "contracts/src/LangclawRegistry.sol",
      status: "complete",
      summary:
        "Prepared the agent decision hash. Set MANTLE_CHAIN_ENABLED=true and LANGCLAW_REGISTRY_ADDRESS to record it.",
      execution: "deterministic-fallback",
    }),
  ];
}

function withTraceOverride(
  stepId: string,
  overrides: TraceOverrides,
  base: OrchestrationStep
): OrchestrationStep {
  const override = overrides[stepId];

  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    summary: override.summary || base.summary,
    status: override.status || base.status,
  };
}

function summarizeFinalAnswerStep(
  finalAnswerMeta: FinalAnswerMeta | undefined,
  sourceCount: number
) {
  if (finalAnswerMeta?.synthesis === "openai") {
    const model = finalAnswerMeta.model ? ` using ${finalAnswerMeta.model}` : "";

    return `Final answer generated by OpenAI${model} from ${sourceCount} source cards.`;
  }

  if (finalAnswerMeta?.synthesis === "openclaw-ai") {
    const model = finalAnswerMeta.model ? ` using ${finalAnswerMeta.model}` : "";

    return `Final answer generated by OpenClaw model${model} from ${sourceCount} source cards.`;
  }

  if (finalAnswerMeta?.synthesis === "deterministic-fallback") {
    return "OpenClaw AI failed, deterministic fallback used.";
  }

  return "Created the final conclusion from discovery, normalization, trend scoring, evidence, and verification outputs.";
}

function summarizeFinalAnswerProgress(
  finalAnswerMeta: FinalAnswerMeta,
  hasModelAnswer: boolean
) {
  if (finalAnswerMeta.synthesis === "openai" && hasModelAnswer) {
    return "Final answer generated by OpenAI.";
  }

  if (finalAnswerMeta.synthesis === "openclaw-ai" && hasModelAnswer) {
    return "Final answer generated by OpenClaw model.";
  }

  return "AI synthesis failed, deterministic fallback used.";
}

async function emitProgress(
  options: WorkflowOptions,
  step: WorkflowStepDefinition,
  status: WorkflowProgressEvent["status"],
  summary: string,
  meta?: {
    execution?: StepExecution;
    model?: string;
    sessionId?: string;
    error?: string;
  }
) {
  if (!options.onEvent) {
    return;
  }

  await options.onEvent(buildWorkflowProgressEvent(step, status, summary, meta));
}

export function buildWorkflowProgressEvent(
  step: WorkflowStepDefinition,
  status: WorkflowProgressEvent["status"],
  summary: string,
  meta?: {
    execution?: StepExecution;
    model?: string;
    sessionId?: string;
    error?: string;
  }
): WorkflowProgressEvent {
  const timestamp = new Date().toISOString();
  const completed =
    status === "complete" || status === "failed" ? timestamp : undefined;

  return {
    stepId: step.stepId,
    agent: step.agent,
    skill: step.skill,
    status,
    summary,
    timestamp,
    startedAt: timestamp,
    completedAt: completed,
    durationMs: completed ? 0 : undefined,
    execution: meta?.execution,
    model: meta?.model,
    sessionId: meta?.sessionId,
    error: meta?.error,
  };
}

function traceFromMeta(
  summary: string,
  meta: {
    execution?: StepExecution;
    model?: string;
    sessionId?: string;
    error?: string;
  }
): Partial<OrchestrationStep> {
  return {
    summary,
    execution: meta.execution,
    model: meta.model,
    sessionId: meta.sessionId,
    error: meta.error,
  };
}

function traceFromFinalAnswerMeta(
  summary: string,
  meta: FinalAnswerMeta
): Partial<OrchestrationStep> {
  return {
    summary,
    execution: meta.execution || "deterministic-fallback",
    model: meta.model,
    sessionId: meta.sessionId,
    error: meta.error,
  };
}

function traceFromStorageProof(
  storage: ZeroGStorageProof
): Partial<OrchestrationStep> {
  return {
    status: storage.status === "failed" ? "failed" : "complete",
    summary: summarizeStorageProof(storage),
    execution: storage.status === "uploaded" || storage.status === "failed"
      ? "evidence-bundle"
      : "deterministic-fallback",
    error: storage.error,
  };
}

function traceFromChainProof(chain: ZeroGChainProof): Partial<OrchestrationStep> {
  return {
    status: chain.status === "failed" ? "failed" : "complete",
    summary: summarizeChainProof(chain),
    execution:
      chain.status === "anchored" ||
      chain.status === "pending" ||
      chain.status === "failed"
      ? "mantle-chain"
      : "deterministic-fallback",
    error: chain.error,
  };
}

function proofMetaFromStorage(storage: ZeroGStorageProof) {
  return {
    execution: storage.status === "uploaded" || storage.status === "failed"
      ? ("evidence-bundle" as const)
      : ("deterministic-fallback" as const),
    error: storage.error,
  };
}

function proofMetaFromChain(chain: ZeroGChainProof) {
  return {
    execution:
      chain.status === "anchored" ||
      chain.status === "pending" ||
      chain.status === "failed"
      ? ("mantle-chain" as const)
      : ("deterministic-fallback" as const),
    error: chain.error,
  };
}

function summarizeStorageProof(storage: ZeroGStorageProof) {
  if (storage.status === "uploaded") {
    const tx = storage.txHash ? ` Transaction: ${storage.txHash}.` : "";

    return `Evidence bundle uploaded at ${storage.evidenceUri}.${tx}`;
  }

  if (storage.status === "failed") {
    return `Evidence bundle upload failed. ${storage.error || "Review evidence storage envs and wallet balance."}`;
  }

  if (storage.status === "skipped") {
    return "Evidence bundle upload skipped.";
  }

  return `Evidence bundle prepared at ${storage.evidenceUri}. ${storage.error || "Upload not submitted."}`;
}

function summarizeChainProof(chain: ZeroGChainProof) {
  if (chain.status === "anchored") {
    return `Agent decision recorded on Mantle through LangclawRegistry. Transaction: ${chain.txHash}.`;
  }

  if (chain.status === "pending") {
    return `Agent decision transaction submitted to Mantle and is waiting for confirmation. Transaction: ${chain.txHash}.`;
  }

  if (chain.status === "failed") {
    return `Mantle decision proof failed. ${chain.error || "Review chain envs and wallet balance."}`;
  }

  if (chain.status === "skipped") {
    return "Mantle decision proof skipped.";
  }

  return `Agent decision hash prepared for Mantle: ${chain.decisionHash ?? chain.briefHash}. ${chain.error || "Anchoring not submitted."}`;
}

function updateAgentOutputsWithProof(
  agentOutputs: AgentOutputs,
  proof: ZeroGProof
) {
  if (agentOutputs.evidence) {
    agentOutputs.evidence = {
      ...agentOutputs.evidence,
      storageStatus: proof.storage.status,
      evidenceUri: proof.storage.evidenceUri,
      rootHash: proof.storage.rootHash,
      storageTxHash: proof.storage.txHash,
      storageExplorerUrl: proof.storage.explorerUrl,
      error: proof.storage.error,
    };
  }

  if (agentOutputs.verifier) {
    agentOutputs.verifier = {
      ...agentOutputs.verifier,
      verificationSummary: summarizeChainProof(proof.chain),
      briefHashInput: proof.chain.decisionHash ?? proof.chain.briefHash,
      storageStatus: proof.storage.status,
      chainStatus: proof.chain.status,
      chainTxHash: proof.chain.txHash,
      chainExplorerUrl: proof.chain.explorerUrl,
      registryAddress: proof.chain.registryAddress,
      error: proof.chain.error,
    };
  }
}

function buildFinalConclusion(
  topic: string,
  sources: SourceCard[],
  errors: ProviderError[],
  runtime: OrchestrationRuntime,
  agentOutputs?: AgentOutputs
): FinalConclusion {
  const activeProviders = Array.from(
    new Set(sources.map((source) => source.provider))
  );
  const providerText = activeProviders.length
    ? activeProviders.map(providerLabel).join(", ")
    : "no live providers";
  const xSource = findSource(sources, "X");
  const githubSource = findSource(sources, "GitHub");
  const docsSource = findSource(sources, "Tavily");
  const hackQuestSource = findSource(sources, "HackQuest");
  const runtimeText = runtime === "openclaw" ? "OpenClaw CLI" : "TypeScript adapter";
  const topTrend =
    agentOutputs?.trend?.topTrend ||
    "a Mantle alpha workflow that connects smart-money movement, protocol momentum, source-backed evidence, and verifiable agent decisions";

  return {
    headline: sources.length
      ? `${topic} shows useful live signal across ${providerText}.`
      : `${topic} did not return enough live signal for a confident conclusion.`,
    summary: sources.length
      ? `Langclaw found ${sources.length} live sources and routed the Mantle Alpha run through ${runtimeText}. The strongest ranked direction is ${topTrend}.`
      : `Langclaw could not build a strong final conclusion because no live source cards were returned. Review provider setup, topic wording, or provider availability before using this run as evidence.`,
    keySignals: [
      buildConclusionSignal("Public signal", xSource, "No X signal returned for this topic."),
      buildConclusionSignal(
        "Builder signal",
        githubSource,
        "No GitHub repository signal returned for this topic."
      ),
      buildConclusionSignal(
        "Reference signal",
        docsSource,
        "No docs or reference page returned for this topic."
      ),
      buildConclusionSignal(
        "HackQuest angle",
        hackQuestSource,
        "No HackQuest hackathon or project page returned for this topic."
      ),
    ],
    recommendation: sources.length
      ? "Frame the demo around a verifiable Mantle on-chain intelligence workflow: Langclaw turns Mantle data and public context into an alpha brief, then records the agent decision hash for proof."
      : "Run discovery again with a more specific topic, then use the final conclusion only after at least one provider returns live evidence.",
    qualityNote: errors.length
      ? `Partial result. ${errors.length} provider issue${errors.length === 1 ? "" : "s"} returned, so treat the conclusion as directional.`
      : "No provider errors returned. The conclusion is still limited to the live sources available during this run.",
    generatedBy: "Final Conclusion Agent",
  };
}

function buildFinalAnswer(
  topic: string,
  sources: SourceCard[],
  errors: ProviderError[],
  runtime: OrchestrationRuntime
): FinalAnswer {
  const activeProviders = Array.from(
    new Set(sources.map((source) => providerLabel(source.provider)))
  );
  const providerText = activeProviders.length
    ? activeProviders.join(", ")
    : "no live providers";
  const runtimeText = runtime === "openclaw" ? "OpenClaw" : "TypeScript adapter";
  const sourceCount = sources.length;
  const hasAllCoreSignals =
    Boolean(findSource(sources, "X")) &&
    Boolean(findSource(sources, "GitHub")) &&
    Boolean(findSource(sources, "Tavily")) &&
    Boolean(findSource(sources, "HackQuest"));

  if (!sourceCount) {
    return {
      title: "Discovery did not find enough evidence",
      answer: `Jawaban singkat: untuk "${topic}", aku belum bisa memberi rekomendasi yang kuat karena discovery tidak menemukan live source yang cukup.`,
      bullets: [
        "Tidak ada source card yang bisa dipakai sebagai evidence.",
        "Workflow agent tetap berjalan, tetapi hasilnya belum layak dijadikan dasar demo.",
        "Coba pakai topic yang lebih spesifik atau cek konfigurasi provider.",
      ],
      recommendation:
        "Jalankan ulang discovery dengan topic yang lebih sempit, lalu gunakan hasilnya hanya jika minimal satu provider mengembalikan evidence.",
      caveat:
        "Kesimpulan ini lemah karena tidak ada live source yang berhasil dikumpulkan.",
      generatedBy: "Final Conclusion Agent",
    };
  }

  return {
    title: "Mantle Alpha brief",
    answer: `Jawaban singkat: "${topic}" layak dipakai sebagai arah Mantle Alpha karena Langclaw menemukan ${sourceCount} live sources dari ${providerText}. Pola terkuatnya adalah AI agent yang mencari sinyal on-chain, merangkum evidence, lalu menyiapkan agent decision proof.`,
    bullets: [
      hasAllCoreSignals
        ? "Sinyalnya lengkap: ada percakapan publik, repo builder, referensi teknis, dan konteks HackQuest."
        : `Sinyalnya cukup, tetapi belum lengkap di semua provider. Provider aktif: ${providerText}.`,
      `Workflow dijalankan lewat ${runtimeText}, jadi proses agent bisa ditampilkan sebagai alur Planner, Discovery, Source, Trend, Evidence, Verifier, dan Final Conclusion.`,
      "Arah project yang paling masuk akal adalah Mantle Alpha Sentinel: agent yang memonitor smart money, liquidity anomaly, dan protocol momentum tanpa mengeksekusi trade.",
    ],
    recommendation:
      "Untuk demo, jelaskan Langclaw sebagai AI Alpha & Data agent: user bertanya satu Mantle topic, Langclaw mencari evidence, lalu decision hash dan evidence URI dicatat sebagai proof.",
    caveat: errors.length
      ? `Ada ${errors.length} provider issue, jadi jawaban ini sebaiknya dianggap directional dan perlu dicek ulang sebelum dipakai sebagai klaim final.`
      : "Tidak ada provider error, tetapi jawaban tetap dibatasi oleh live sources yang ditemukan pada saat run ini.",
    generatedBy: "Final Conclusion Agent",
  };
}

function withFallbackCaveat(answer: FinalAnswer, meta: FinalAnswerMeta) {
  const fallbackNote = meta.error
    ? ` AI synthesis failed, deterministic fallback used. Reason: ${meta.error}`
    : " AI synthesis failed, deterministic fallback used.";

  return {
    ...answer,
    caveat: answer.caveat.includes("AI synthesis failed")
      ? answer.caveat
      : `${answer.caveat}${fallbackNote}`,
  };
}

export function buildConclusionSignal(
  label: string,
  source: SourceCard | undefined,
  fallback: string
) {
  return {
    label,
    text: source ? cleanText(source.title) : fallback,
    sourceId: source?.id,
    sourceIds: source ? [source.id] : [],
  };
}

function findSource(sources: SourceCard[], provider: SourceCard["provider"]) {
  return sources.find((source) => source.provider === provider);
}

function summarizeProviders(sources: SourceCard[]) {
  const providers = new Set(sources.map((source) => providerLabel(source.provider)));

  return providers.size ? Array.from(providers).join(", ") : "no providers";
}

function summarizeFailures(errors: ProviderError[]) {
  const failedProviders = Array.from(
    new Set(errors.map((error) => providerLabel(error.provider)))
  );

  return failedProviders.length
    ? ` Provider issues: ${failedProviders.join(", ")}.`
    : "";
}

function providerLabel(provider: SourceCard["provider"]) {
  return provider === "Tavily" ? "Docs" : provider;
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

function compactOutput(output: string) {
  return output.replace(/\s+/g, " ").trim().slice(0, 180);
}
