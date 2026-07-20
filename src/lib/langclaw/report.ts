import type {
  BuildOnChainResearchReportInput,
  ResearchReport,
} from "./report/types";
import { inferOnChainReportKind } from "./report/core";
import { buildDefiYieldReport } from "./report/defi-yield";
import { buildSmartMoneyReport } from "./report/smart-money";
import { buildLiquidityAnomalyReport } from "./report/liquidity";
import { buildMarketBriefReport } from "./report/market-brief";
import { buildTokenDiscoveryReport } from "./report/token-discovery";

export { renderResearchReportMarkdown } from "./report/markdown";
export { buildWorkflowResearchReport } from "./report/core";

export function buildOnChainResearchReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const kind = inferOnChainReportKind(input.plan);

  if (kind === "liquidity-anomaly") {
    return buildLiquidityAnomalyReport(input);
  }

  if (kind === "smart-money") {
    return buildSmartMoneyReport(input);
  }

  if (kind === "defi-yield") {
    return buildDefiYieldReport(input);
  }

  if (kind === "token-discovery") {
    return buildTokenDiscoveryReport(input);
  }

  return buildMarketBriefReport(input);
}
