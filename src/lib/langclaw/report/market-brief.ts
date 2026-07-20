import {
  buildOnChainReportCaveats,
  deriveOnChainConfidence,
  isDirectProviderIssue,
  isUsableDirectProviderResult,
} from "./core";
import type {
  BuildOnChainResearchReportInput,
  OnChainToolResult,
  ResearchReport,
} from "./types";

export function buildMarketBriefReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const caveats = buildOnChainReportCaveats(input);

  return {
    kind: "market-brief",
    title: `${input.plan.chainName} Market Brief`,
    asOfUtc: input.generatedAt,
    executiveSummary:
      input.answer ||
      `This ${input.plan.chainName} market brief summarizes the direct and synthesized on-chain evidence returned in the current run.`,
    bottomLine:
      "Use this brief as a research summary, not as a substitute for direct manual verification.",
    confidence: deriveOnChainConfidence(input.tools),
    entities: [],
    tables: [],
    sections: [
      {
        id: "signal-summary",
        title: "Signal Summary",
        markdown: summarizeToolResults(input.tools),
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "data-context",
        title: "Data Context",
        markdown:
          "This market brief stays narrative-first because the run did not return a compatible ranked-table data shape.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
      {
        id: "conclusion",
        title: "Conclusion",
        markdown:
          "The current output is suitable for contextual market monitoring, but not for quantitative ranking.",
        sourceIds: [],
        toolIds: input.tools.map((tool) => tool.commandId),
      },
    ],
    caveats,
    recommendations: [input.recommendation],
  };
}

function summarizeToolResults(tools: OnChainToolResult[]) {
  const successful = tools.filter(isUsableDirectProviderResult);
  const failed = tools.filter(isDirectProviderIssue);

  if (!successful.length) {
    return "Direct provider rows were not available in this run.";
  }

  return `The run returned ${successful.length} usable direct provider result(s) and ${failed.length} source gap(s).`;
}

