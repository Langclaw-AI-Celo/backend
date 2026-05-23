import { onChainDomainLabels } from "./registry";
import { summarizePlan } from "./planner";
import { buildOnChainResearchReport } from "../langclaw/report";
import type {
  OnChainPlan,
  OnChainToolFinalPayload,
  OnChainToolResult,
} from "./types";

export function synthesizeOnChainAnswer({
  plan,
  results,
}: {
  plan: OnChainPlan;
  results: OnChainToolResult[];
}): OnChainToolFinalPayload {
  const successful = results.filter((result) => result.status === "success");
  const failed = results.filter((result) => result.status === "failed");
  const domains = Array.from(new Set(results.map((result) => result.domain)));
  const domainText = domains.map((domain) => onChainDomainLabels[domain]).join(", ");
  const chainName = plan.chainName || plan.chain;
  const title = titleFor(plan.intent, chainName);
  const bullets = buildBullets(results, plan);
  const answer =
    successful.length > 0
      ? `I ran ${results.length} ${chainName} intelligence tools across ${domainText || "selected domains"} for ${plan.chain}. ${successful.length} tools returned usable evidence.`
      : `I tried ${results.length} ${chainName} intelligence tools for ${plan.chain}, but no provider returned usable evidence.`;
  const caveat = buildCaveat(failed, plan);
  const recommendation = buildRecommendation(plan.intent, successful, failed, plan);
  const report = buildOnChainResearchReport({
    answer,
    caveat,
    generatedAt: new Date().toISOString(),
    plan: summarizePlan(plan),
    recommendation,
    tools: results,
  });

  return {
    answer,
    bullets,
    caveat,
    generatedAt: report.asOfUtc,
    plan: summarizePlan(plan),
    providerTrace: buildProviderTrace(plan, results),
    recommendation,
    report,
    title,
    tools: results,
  };
}

export function formatOnChainAnswer(payload: OnChainToolFinalPayload) {
  const lines = [
    payload.answer,
    "",
    ...payload.bullets.slice(0, 5).map((bullet) => `- ${bullet}`),
    "",
    `Recommendation: ${payload.recommendation}`,
    "",
    `Caveat: ${payload.caveat}`,
  ];

  return lines.filter(Boolean).join("\n");
}

function titleFor(intent: string, chainName: string) {
  if (intent === "wallet") {
    return `${chainName} wallet intelligence`;
  }

  if (intent === "smart-money") {
    return `${chainName} smart money analysis`;
  }

  if (intent === "security") {
    return `${chainName} security analysis`;
  }

  if (intent === "defi") {
    return `${chainName} DeFi intelligence`;
  }

  if (intent === "trading-signal") {
    return `${chainName} alpha signal analysis`;
  }

  return `${chainName} token intelligence`;
}

function buildBullets(results: OnChainToolResult[], plan: OnChainPlan) {
  const successful = results.filter((result) => result.status === "success");
  const failed = results.filter((result) => result.status === "failed");
  const confidence =
    successful.length >= 4 && !failed.length
      ? "High"
      : successful.length >= 2
        ? "Medium"
        : successful.length === 1
          ? "Low"
          : "Insufficient";
  const evidence = successful.length
    ? successful
        .slice(0, 4)
        .map((result) => `${result.title} (${result.provider})`)
        .join("; ")
    : "No provider returned usable source data.";
  const sourceBullets = results.slice(0, 8).map((result) => {
    const status = result.status === "success" ? "Evidence" : "Source gap";
    const source = result.sourceUrl ? ` Source: ${result.sourceUrl}` : "";

    return `${status}: ${result.title} (${result.provider}) - ${result.summary}${source}`;
  });

  return [
    `Signal: ${summarizeSignal(results)}.`,
    `Evidence: ${evidence}`,
    `Confidence: ${confidence}, based on ${successful.length} successful tool result(s) and ${failed.length} source gap(s).`,
    `Risk note: ${buildRiskNote(failed, plan)}`,
    `Recommended watch/action: ${buildWatchAction(successful, failed, plan)}`,
    ...(sourceBullets.length ? sourceBullets : ["Source gap: No tool output was available."]),
  ];
}

function buildRecommendation(
  intent: string,
  successful: OnChainToolResult[],
  failed: OnChainToolResult[],
  plan: OnChainPlan
) {
  const chainName = plan.chainName || plan.chain;

  if (!successful.length) {
    return `Do not make a decision from this run. Add a ${chainName} token address, wallet address, or configured Dune query and run it again.`;
  }

  if (intent === "smart-money") {
    return `Treat this as directional smart-money research only. Confirm the holder flow with a second on-chain source before framing it as verified accumulation.`;
  }

  if (intent === "trading-signal") {
    return `Use this as analysis only. Confirm ${chainName} liquidity, holder flow, and security flags before any manual trading decision.`;
  }

  if (intent === "security") {
    return "Prioritize high-risk flags first. Treat clean results as preliminary until verified with a second source.";
  }

  if (failed.length) {
    return "Use the successful provider data, then rerun after fixing the failed provider configuration for fuller coverage.";
  }

  return "Use these source-backed results as a starting point for deeper manual review.";
}

function buildCaveat(failed: OnChainToolResult[], plan: OnChainPlan) {
  const providerGap = plan.providerGaps?.length
    ? ` Provider gap: ${plan.providerGaps.join(" ")}`
    : "";

  if (!failed.length) {
    return `This is analysis-only. Langclaw did not sign, send, swap, buy, sell, or execute any transaction.${providerGap}`;
  }

  const providers = Array.from(new Set(failed.map((result) => result.provider))).join(", ");

  return `This is analysis-only and ${failed.length} source gap(s) failed or lacked inputs. Affected providers: ${providers}. Langclaw did not sign, send, swap, buy, sell, or execute any transaction.${providerGap}`;
}

function summarizeSignal(results: OnChainToolResult[]) {
  const successful = results.find((result) => result.status === "success");

  if (!successful) {
    return "insufficient alpha evidence";
  }

  if (results.some((result) => result.domain === "smart_money")) {
    return "smart-money or holder-flow activity needs monitoring";
  }

  if (results.some((result) => result.domain === "pair_liquidity")) {
    return "liquidity and volume conditions need monitoring";
  }

  if (results.some((result) => result.domain === "defi_tvl" || result.domain === "yield_pools")) {
    return "protocol TVL or yield momentum is the main watch area";
  }

  if (results.some((result) => result.domain === "trading_signal_analysis")) {
    return "market, liquidity, and risk evidence can support an alpha watchlist";
  }

  return "token or protocol activity has usable evidence";
}

function buildRiskNote(failed: OnChainToolResult[], plan: OnChainPlan) {
  const providerGap = plan.providerGaps?.length
    ? ` Provider gaps: ${plan.providerGaps.join(" ")}`
    : "";

  if (!failed.length) {
    return `No failed provider calls were reported, but the result is still a point-in-time analysis.${providerGap}`;
  }

  const providers = Array.from(new Set(failed.map((result) => result.provider))).join(", ");

  return `Provider gaps from ${providers} reduce confidence; treat unsupported claims as hypotheses.${providerGap}`;
}

function buildWatchAction(
  successful: OnChainToolResult[],
  failed: OnChainToolResult[],
  plan: OnChainPlan
) {
  const chainName = plan.chainName || plan.chain;

  if (!successful.length) {
    return `rerun with a specific ${chainName} wallet, token, pair, or Dune query.`;
  }

  if (failed.length) {
    return "track the successful evidence now, then rerun after fixing provider inputs for fuller coverage.";
  }

  return `add the strongest signal to the ${chainName} Alpha watchlist and record the decision proof.`;
}

function buildProviderTrace(plan: OnChainPlan, results: OnChainToolResult[]) {
  const traces = [...(plan.providerTrace ?? [])];

  for (const result of results) {
    const attempted = result.attemptedProviders ?? [];
    const failedAttempts = attempted.slice(0, Math.max(0, attempted.length - 1));

    for (const provider of failedAttempts) {
      traces.push({
        message: result.fallbackReason ?? `${provider} fallback was triggered.`,
        provider,
        scope: "legacy-fallback",
        status: "failed",
      });
    }

    traces.push({
      message:
        result.status === "success"
          ? result.summary
          : result.error ?? result.summary,
      provider: result.provider,
      scope: result.scope ?? "legacy-default",
      status: result.status === "success" ? "success" : "failed",
    });
  }

  return traces;
}
