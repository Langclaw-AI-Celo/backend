import {
  asRecord,
  buildOnChainReportCaveats,
  collectStructuredRows,
  deriveOnChainConfidence,
  formatCell,
  isUsableDirectProviderResult,
  normalizeSentence,
  providerLabel,
  readArrayFromUnknown,
  readPath,
  readString,
  roundNumber,
  uniqueStrings,
} from "./core";
import type {
  BuildOnChainResearchReportInput,
  NormalizedRow,
  OnChainPlanSummary,
  OnChainToolResult,
  ResearchReport,
  ResearchReportEntity,
  ResearchReportSection,
  ResearchReportTable,
} from "./types";

export function buildSmartMoneyReport(
  input: BuildOnChainResearchReportInput
): ResearchReport {
  const rows = collectStructuredRows(input.tools, (tool) => tool.domain === "smart_money");
  const entities: ResearchReportEntity[] = rows.map((row, index) => ({
    id: row.id,
    label: row.label,
    category: classifySmartMoneyReportRow(row),
    rank: index + 1,
    severity: classifySmartMoneyReportRow(row) === "large-flow-watchlist"
      ? "watch"
      : index === 0
        ? "high"
        : "medium",
    summary: summarizeSmartMoneyReportRow(row),
    metrics: row.metrics,
    sourceIds: [],
    toolIds: [row.toolId],
  }));
  const caveats = buildOnChainReportCaveats(input);
  const localOnly =
    !entities.length &&
    input.tools.some((tool) => tool.provider === "local" && tool.status === "success");
  const title = buildSmartMoneyReportTitle(input.plan, input.tools);
  const hasRows = entities.length > 0;
  const surfSummary = readSurfSmartMoneyText(input.tools, "summary");
  const surfBottomLine = readSurfSmartMoneyText(input.tools, "bottomLine");
  const surfSections = readSurfSmartMoneySections(input.tools);
  const confirmedEntities = entities.filter((entity) => entity.category === "confirmed-smart-money");
  const candidateEntities = entities.filter((entity) => entity.category === "candidate-smart-money");
  const watchlistEntities = entities.filter((entity) => entity.category === "large-flow-watchlist");
  const sellPressureEntities = entities.filter((entity) => entity.category === "sell-pressure-watchlist");
  const excludedEntities = entities.filter((entity) => entity.category === "excluded-address");
  const hasConfirmed = entities.some((entity) => entity.category === "confirmed-smart-money");
  const hasCandidate = entities.some((entity) => entity.category === "candidate-smart-money");
  const hasWatchlistOnly = entities.some((entity) => entity.category === "large-flow-watchlist") && !hasConfirmed && !hasCandidate;
  const accumulatorRows = rows.filter(isAccumulatorSmartMoneyRow);
  const smartMoneyTableTitle = hasWatchlistOnly
    ? "Large DEX-Buy Watchlist"
    : hasConfirmed
      ? "Confirmed and Candidate Smart-Money Wallets"
      : "Candidate Smart-Money Wallets";
  const smartMoneyLimits = buildSmartMoneyLimitsMarkdown({
    hasRows,
    plan: input.plan,
    rows,
    tools: input.tools,
  });
  const smartMoneySections = hasRows && surfSections.length
    ? applySmartMoneyContextualLimits(
        surfSections,
        smartMoneyLimits,
        input.tools.map((tool) => tool.commandId)
      )
    : [
        {
          id: "read",
          title: "Read",
          markdown: hasRows
            ? `Headline. ${input.plan.chainName} has smart-money accumulation rows. DEX-only rows are large-flow watchlist entries until labels, CEX flow, retention, and balance deltas are confirmed.`
            : `Headline. Smart-money signal is weak. The output stays ${localOnly ? "analysis-only" : "coverage-limited"} because direct wallet-flow rows are missing.`,
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "evidence",
          title: "Evidence",
          markdown: hasRows
            ? `Evidence. Direct provider rows returned ${entities.length} wallet-flow row(s). The table uses only fields returned by the provider output and does not promote DEX-only rows to confirmed smart money.`
            : "Evidence. No ranked wallet table is emitted because Nansen and Dune-style row-level outputs were empty or unavailable. Social and context signals remain useful for research direction, but they are not direct wallet-flow proof.",
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "confirmed-smart-money",
          title: "Confirmed smart money",
          markdown: confirmedEntities.length
            ? summarizeSmartMoneyCandidates(confirmedEntities)
            : "None. No row had enough label and retention evidence to mark it as confirmed smart money.",
          sourceIds: [],
          toolIds: confirmedEntities.flatMap((entity) => entity.toolIds),
        },
        {
          id: "candidate-smart-money",
          title: "Candidate smart money",
          markdown: candidateEntities.length
            ? summarizeSmartMoneyCandidates(candidateEntities)
            : "None. Rows need wallet labels plus retention, sell pressure, exchange-flow, or second-source checks before promotion.",
          sourceIds: [],
          toolIds: candidateEntities.flatMap((entity) => entity.toolIds),
        },
        {
          id: "large-flow-watchlist",
          title: "Large-flow watchlist",
          markdown: watchlistEntities.length
            ? summarizeSmartMoneyCandidates(watchlistEntities)
            : hasRows
              ? "No DEX-only large-flow rows were classified in this report."
              : "No wallet candidates are ranked. A ranked list needs direct wallet-flow metrics with enough wallet enrichment.",
          sourceIds: [],
          toolIds: watchlistEntities.flatMap((entity) => entity.toolIds),
        },
        ...(sellPressureEntities.length
          ? [
              {
                id: "cex-sell-pressure",
                title: "CEX sell pressure",
                markdown: summarizeSmartMoneyCandidates(sellPressureEntities),
                sourceIds: [],
                toolIds: sellPressureEntities.flatMap((entity) => entity.toolIds),
              },
            ]
          : []),
        {
          id: "excluded-addresses",
          title: "Excluded addresses",
          markdown: excludedEntities.length
            ? summarizeSmartMoneyCandidates(excludedEntities)
            : "None detected from available provider labels and heuristics.",
          sourceIds: [],
          toolIds: excludedEntities.flatMap((entity) => entity.toolIds),
        },
        {
          id: "limits",
          title: "Limits",
          markdown: smartMoneyLimits,
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "data-source-diagnostics",
          title: "Data source diagnostics",
          markdown: buildSmartMoneyDataSourceDiagnostic(input.tools),
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "follow-up-checks-performed",
          title: "Follow-up checks performed",
          markdown: hasRows
            ? "Parsed direct wallet-flow rows, checked available row fields for wallet labels and infrastructure hints, separated DEX-only rows from smart-money classifications, and preserved provider diagnostics."
            : "Checked provider outputs for direct wallet-flow rows. No standard wallet enrichment check could produce a ranking without row-level data.",
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "checks-unavailable",
          title: "Checks unavailable",
          markdown: "Unavailable when providers do not return the fields: wallet label lookup, definitive contract or EOA status, wallet net worth, holder retention after buy, sell pressure after buy, exchange-flow matching, complete wallet history, and second-source validation.",
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "conclusion",
          title: "Conclusion",
          markdown: hasRows
            ? "Confidence is limited unless wallet labels, retention, sell pressure, exchange-flow matching, and a second source are available. Use DEX-only rows as a monitor set."
            : "Confidence is low. Standard smart-money follow-up checks need row-level provider data before they can produce a wallet ranking.",
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
        {
          id: "what-would-improve-confidence",
          title: "What would improve confidence",
          markdown:
            "Confidence would improve with wallet labels, contract or EOA status, wallet net worth, retention after buy, sell pressure after buy, exchange-flow matching, repeated accumulation history, DeFi activity, and second-source validation.",
          sourceIds: [],
          toolIds: input.tools.map((tool) => tool.commandId),
        },
      ];

  return {
    kind: "smart-money",
    title,
    asOfUtc: input.generatedAt,
    executiveSummary: hasRows
      ? surfSummary ||
        `The clearest signal is ${accumulatorRows.length ? (hasWatchlistOnly ? "large DEX-buy flow" : "candidate smart-money flow") : "CEX sell-pressure flow"} on ${input.plan.chainName}. ${entities.length} direct row(s) are available, but DEX-only rows stay as watchlist entries until labels, retention, sell pressure, and second-source checks support a stronger classification.`
      : `Smart-money signal is still weak for ${input.plan.chainName}. Social and context signals can still guide directional research, but they do not create a wallet ranking by themselves.`,
    bottomLine: hasRows
      ? surfBottomLine ||
        "Confidence stays limited until wallet labels, holder retention, sell pressure, exchange-flow matching, wallet net worth, and a second on-chain source are available."
      : "Confidence is low because direct wallet-flow rows were unavailable. Standard follow-up checks were attempted where provider data existed, and unavailable checks are listed in the report.",
    confidence: hasRows ? deriveOnChainConfidence(input.tools) : "low",
    entities,
    tables: hasRows ? buildSmartMoneyTables(rows, accumulatorRows, smartMoneyTableTitle) : [],
    sections: smartMoneySections,
    caveats,
    recommendations: [input.recommendation],
  };
}

export function buildSmartMoneyReportTitle(
  plan: OnChainPlanSummary,
  tools: OnChainToolResult[]
) {
  const target = readSurfSmartMoneyTarget(tools);
  const ticker = formatSmartMoneyTicker(
    shouldShowSmartMoneyTicker(plan, target) ? target.symbol : undefined
  );

  return ticker
    ? `${plan.chainName} (${ticker}) - Smart-Money Accumulation Watch`
    : `${plan.chainName} Smart-Money Accumulation Watch`;
}

function formatSmartMoneyTicker(symbol: string | undefined) {
  const normalized = symbol?.trim().replace(/^\$/, "");

  return normalized ? `$${normalized.toUpperCase()}` : undefined;
}

function shouldShowSmartMoneyTicker(
  plan: OnChainPlanSummary,
  target: ReturnType<typeof readSurfSmartMoneyTarget>
) {
  if (!target.symbol) {
    return false;
  }

  const query = `${plan.rawQuery ?? ""} ${plan.query ?? ""}`;
  const explicitTokenFocus =
    /\$[a-z0-9._-]{2,20}\b/i.test(query) ||
    /\b(?:for|of|token|coin|asset)\s+\$?[a-z0-9._-]{2,20}\b/i.test(query) ||
    /0x[a-f0-9]{40}/i.test(query);
  if (target.externalTokenSignal) {
    return explicitTokenFocus;
  }

  const broadTarget =
    target.mode === "broad-chain" || target.mode === "chain-default";

  return explicitTokenFocus || !broadTarget;
}

type SmartMoneyLimitsInput = {
  hasRows: boolean;
  plan: OnChainPlanSummary;
  rows: NormalizedRow[];
  tools: OnChainToolResult[];
};

function applySmartMoneyContextualLimits(
  sections: ResearchReportSection[],
  limitsMarkdown: string,
  toolIds: string[]
) {
  let replaced = false;
  const nextSections = sections.map((section) => {
    if (!/^limits$/i.test(section.title)) {
      return section;
    }

    replaced = true;
    return {
      ...section,
      id: "limits",
      markdown: limitsMarkdown,
      sourceIds: [],
      title: "Limits",
      toolIds,
    };
  });

  if (replaced) {
    return nextSections;
  }

  const conclusionIndex = nextSections.findIndex((section) =>
    /^conclusion$/i.test(section.title)
  );
  const limitsSection: ResearchReportSection = {
    id: "limits",
    markdown: limitsMarkdown,
    sourceIds: [],
    title: "Limits",
    toolIds,
  };

  if (conclusionIndex === -1) {
    return [...nextSections, limitsSection];
  }

  return [
    ...nextSections.slice(0, conclusionIndex),
    limitsSection,
    ...nextSections.slice(conclusionIndex),
  ];
}

function buildSmartMoneyLimitsMarkdown(input: SmartMoneyLimitsInput) {
  if (!input.hasRows) {
    return "Row-level coverage gap. Direct wallet-flow rows were unavailable, so there is no safe basis for wallet names, token-flow amounts, retention behavior, sell pressure, or a ranked accumulator table.";
  }

  const target = readSurfSmartMoneyTarget(input.tools);
  const requestedChainName =
    target.requestedChainName || input.plan.chainName;
  const sourceChainName =
    target.chainName ||
    firstSmartMoneyMetric(input.rows, "sourceChain") ||
    requestedChainName;
  const targetLabel = target.symbol
    ? `$${target.symbol}`
    : target.mode === "broad-chain"
      ? `${requestedChainName} token flow`
      : "token flow";
  const sourceChains = uniqueSmartMoneyMetrics(input.rows, "sourceChain");
  const sourceTables = uniqueSmartMoneyMetrics(input.rows, "sourceTable");
  const windows = uniqueSmartMoneyMetrics(input.rows, "window");
  const labelsUnavailable = input.rows.some((row) =>
    isUnavailableSmartMoneyMetric(row.metrics.walletLabel)
  );
  const missingChecks = summarizeUnavailableSmartMoneyChecks(input.rows);
  const classification = summarizeSmartMoneyClassification(input.rows);
  const sourceSurface = sourceChains.length
    ? `${joinReadableList(sourceChains)} ${describeSmartMoneySourceSurface(sourceTables)}`
    : `${sourceChainName} ${describeSmartMoneySourceSurface(sourceTables)}`;
  const sourceSuffix = sourceTables.length
    ? ` Source table: ${sourceTables.slice(0, 2).join(", ")}.`
    : "";
  const nativeGap = buildSmartMoneyNativeCoverageGap(target, requestedChainName);
  const externalScope = target.externalTokenSignal
    ? ` External token signal. The token rows came from ${sourceChainName}. They are low-confidence external context for ${requestedChainName}, not ${requestedChainName} chain-level activity.`
    : "";
  const tokenFocus = buildSmartMoneyTokenFocus(target, targetLabel);
  const windowText = windows.length
    ? `${joinReadableList(windows.slice(0, 3))}${windows.length > 3 ? `, plus ${windows.length - 3} more windows` : ""}`
    : "the returned provider window";
  const cexFlowSources = describeSmartMoneyCexFlowSources(sourceTables);
  const exchangeFlowContext = input.rows.some(isCexFlowRow)
    ? `It included CEX withdrawal or deposit matching from ${cexFlowSources}, but did not include complete holder balance deltas, wallet net worth, complete wallet history, or independent second-source validation.`
    : "It did not include complete holder balance deltas, exchange-flow matching, wallet net worth, complete wallet history, or independent second-source validation.";

  return [
    `Coverage gap. This scan used ${sourceSurface} for ${tokenFocus}.${sourceSuffix}${nativeGap ? ` ${nativeGap}` : ""}${externalScope} ${exchangeFlowContext}`,
    `Smart-money labeling gap. ${labelsUnavailable ? "The candidate wallets are mostly unlabeled in the returned rows." : "Wallet labels are only as complete as the returned provider fields."} A large DEX buy can still come from a router, market maker, OTC desk, CEX-related wallet, or internal operational wallet. The correct classification stays ${classification}, not confirmed smart-money accumulation.`,
    `Sample window. The ranking reflects ${windowText}, not a full long-term balance-delta study. Unavailable or incomplete checks: ${missingChecks}. Treat the table as a monitor set until labels and post-buy behavior support a stronger claim.`,
  ].join("\n\n");
}

function describeSmartMoneySourceSurface(sourceTables: string[]) {
  const hasDex = sourceTables.some((table) => /dex/i.test(table));
  const hasCex = sourceTables.some((table) => /cex/i.test(table));

  if (hasDex && hasCex) {
    return "row-level DEX trade and CEX flow surfaces";
  }

  if (hasCex) {
    return "row-level CEX flow surface";
  }

  return "row-level DEX trade surface";
}

function describeSmartMoneyCexFlowSources(sourceTables: string[]) {
  const hasCexFlowTable = sourceTables.some((table) => /cex\.flows/i.test(table));
  const hasLabeledTransferTable = sourceTables.some((table) =>
    /tokens\.transfers|labels\.addresses|cex token transfers/i.test(table)
  );

  if (hasCexFlowTable && hasLabeledTransferTable) {
    return "Dune cex.flows rows and labeled Dune token transfers";
  }

  if (hasLabeledTransferTable) {
    return "labeled Dune token transfers";
  }

  if (hasCexFlowTable) {
    return "Dune cex.flows rows";
  }

  return "the returned CEX-labeled rows";
}

function readSurfSmartMoneyTarget(tools: OnChainToolResult[]) {
  for (const tool of tools) {
    if (tool.domain !== "smart_money" || tool.status !== "success") {
      continue;
    }

    const record = asRecord(tool.data);
    const target = asRecord(record?.target);

    if (!target) {
      continue;
    }

    return {
      chainName: readString(target.chainName),
      externalTokenSignal: target.externalTokenSignal === true,
      mode: readString(target.mode) || readString(target.resolution),
      requestedChainName: readString(target.requestedChainName),
      symbol: readString(target.symbol),
      tokenAddress: readString(target.tokenAddress),
      tokenAddressChainName: readString(target.tokenAddressChainName),
    };
  }

  return {};
}

function buildSmartMoneyTokenFocus(
  target: ReturnType<typeof readSurfSmartMoneyTarget>,
  fallbackLabel: string
) {
  if (target.tokenAddress) {
    const chain = target.tokenAddressChainName
      ? ` on ${target.tokenAddressChainName}`
      : "";
    const scope = target.externalTokenSignal && target.requestedChainName
      ? ` as external token context for ${target.requestedChainName}`
      : "";
    return `${target.symbol ? `$${target.symbol}` : fallbackLabel} contract ${target.tokenAddress}${chain}${scope}`;
  }

  if (target.mode === "broad-chain") {
    return `${fallbackLabel} as a chain-level scan`;
  }

  return fallbackLabel;
}

function buildSmartMoneyNativeCoverageGap(
  target: ReturnType<typeof readSurfSmartMoneyTarget>,
  chainName: string
) {
  if (
    !target.tokenAddress ||
    !target.tokenAddressChainName ||
    sameChainName(target.tokenAddressChainName, chainName)
  ) {
    return "";
  }

  return `${chainName}-native holder and transfer coverage was not confirmed by this row set.`;
}

function summarizeSmartMoneyClassification(rows: NormalizedRow[]) {
  const categories = uniqueStrings(
    rows.map((row) => humanizeSmartMoneyValue(formatCell(row.metrics.smartMoneyStatus)))
  );

  if (!categories.length) {
    return "large-flow watchlist or candidate status";
  }

  if (categories.length === 1) {
    return categories[0];
  }

  return joinReadableList(categories);
}

function summarizeUnavailableSmartMoneyChecks(rows: NormalizedRow[]) {
  const hasCexFlow = rows.some(isCexFlowRow);
  const checks = [
    ["wallet labels", rows.some((row) => isUnavailableSmartMoneyMetric(row.metrics.walletLabel))],
    ["contract or EOA status", rows.some((row) => isUnavailableSmartMoneyMetric(row.metrics.walletType))],
    ["wallet net worth", rows.some((row) => isUnavailableSmartMoneyMetric(row.metrics.walletNetWorth))],
    ["post-buy retention", rows.some((row) => isUnavailableSmartMoneyMetric(row.metrics.retentionAfterBuy))],
    ["post-buy sell pressure", rows.some((row) => isUnavailableSmartMoneyMetric(row.metrics.sellPressureAfterBuy))],
    ["exchange-flow matching", !hasCexFlow],
    ["complete wallet history", true],
    ["second-source validation", true],
  ]
    .filter(([, unavailable]) => unavailable)
    .map(([label]) => label as string);

  return joinReadableList(checks);
}

function uniqueSmartMoneyMetrics(rows: NormalizedRow[], key: string) {
  return uniqueStrings(rows.map((row) => formatSmartMoneyMetricForText(row.metrics[key])));
}

function firstSmartMoneyMetric(rows: NormalizedRow[], key: string) {
  return uniqueSmartMoneyMetrics(rows, key)[0];
}

function formatSmartMoneyMetricForText(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return undefined;
  }

  return humanizeSmartMoneyValue(formatCell(value));
}

function isUnavailableSmartMoneyMetric(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return true;
  }

  return /^unavailable|unknown|not available$/i.test(String(value).trim());
}

function sameChainName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function buildSmartMoneyDataSourceDiagnostic(tools: OnChainToolResult[]) {
  const rows = tools
    .filter((tool) => tool.domain === "smart_money")
    .map((tool) => {
      const status = tool.status === "success" && isUsableDirectProviderResult(tool)
        ? "usable rows"
        : tool.status === "success"
          ? "no usable rows"
          : "unavailable";
      const provider = providerLabel(tool.provider);
      const attempts = tool.attemptedProviders?.length
        ? tool.attemptedProviders.map(providerLabel).join(", ")
        : provider;
      const note = tool.status === "success" && isUsableDirectProviderResult(tool)
        ? "Rows parsed for ranking."
        : tool.status === "success"
          ? "No row-level wallet-flow rows returned."
          : "Source unavailable for this analysis.";

      return `| ${provider} | ${status} | ${attempts} | ${note} |`;
    });

  return [
    "| Provider | Status | Attempts | Notes |",
    "| --- | --- | --- | --- |",
    ...(rows.length
      ? rows
      : ["| on-chain provider | unavailable | n/a | No smart-money tool output was available. |"]),
  ].join("\n");
}

function joinReadableList(values: string[]) {
  if (values.length <= 2) {
    return values.join(" and ");
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function summarizeSmartMoneyCandidates(entities: ResearchReportEntity[]) {
  const top = entities.slice(0, 3);
  const lines = top.map((entity, index) => {
    const metrics = formatSmartMoneyMetrics(entity.metrics);
    const rowLabel =
      entity.category === "large-flow-watchlist"
        ? "watchlist row"
        : entity.category === "confirmed-smart-money"
          ? "confirmed row"
          : "candidate";
    const prefix =
      index === 0
        ? `Best ${rowLabel}`
        : index === 1
          ? `Second ${rowLabel}`
          : `Third ${rowLabel}`;

    return metrics
      ? `${prefix}: ${entity.label}. Retrieved metrics: ${metrics}.`
      : `${prefix}: ${entity.label}.`;
  });

  if (entities.length > top.length) {
    lines.push(
      `${entities.length - top.length} more row(s) are available in the ranking table.`
    );
  }

  return lines.join("\n");
}

function formatSmartMoneyMetrics(metrics: Record<string, string | number | null>) {
  const metricPairs: Array<[string, string]> = [
    ["signal", "signal"],
    ["tokenSymbol", "token"],
    ["netToken", "amount"],
    ["netAmount", "amount"],
    ["amount", "amount"],
    ["netUsd", "USD value"],
    ["usd", "USD value"],
    ["trades", "trades"],
    ["transfers", "transfers"],
    ["sourceCex", "CEX"],
    ["source_cex", "CEX"],
    ["window", "window"],
    ["tokenCategory", "category"],
    ["smartMoneyStatus", "status"],
  ];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const [key, label] of metricPairs) {
    if (seen.has(label)) {
      continue;
    }

    const value = metrics[key];

    if (value == null || value === "") {
      continue;
    }

    values.push(`${label}: ${humanizeSmartMoneyValue(formatCell(value))}`);
    seen.add(label);
  }

  return values.join(", ");
}

function classifySmartMoneyReportRow(row: NormalizedRow) {
  const status = readString(row.metrics.smartMoneyStatus);
  const signal = readString(row.metrics.signal) ?? "";

  if (status === "sell_pressure_watchlist" || /cex deposit/i.test(signal)) {
    return "sell-pressure-watchlist";
  }

  if (status === "confirmed_smart_money") {
    return "confirmed-smart-money";
  }

  if (status === "candidate_smart_money") {
    return "candidate-smart-money";
  }

  if (status === "excluded_address") {
    return "excluded-address";
  }

  const walletLabel = readString(row.metrics.walletLabel) ?? "";
  const retention = readString(row.metrics.retentionAfterBuy) ?? "";
  const sellPressure = readString(row.metrics.sellPressureAfterBuy) ?? "";
  const followUpCheck = retention || sellPressure;
  const hasWalletEvidence =
    walletLabel && !/^unavailable$/i.test(walletLabel) &&
    followUpCheck &&
    !/^unavailable$/i.test(followUpCheck);

  if (/dex buy/i.test(signal) && !hasWalletEvidence) {
    return "large-flow-watchlist";
  }

  if (/cex withdrawal/i.test(signal)) {
    return "candidate-smart-money";
  }

  return "candidate-smart-money";
}

function summarizeSmartMoneyReportRow(row: NormalizedRow) {
  const category = classifySmartMoneyReportRow(row);

  if (category === "confirmed-smart-money") {
    return "Confirmed smart-money wallet-flow from provider labels and follow-up checks.";
  }

  if (category === "candidate-smart-money") {
    return "Candidate smart-money wallet-flow with partial enrichment.";
  }

  if (category === "excluded-address") {
    return "Excluded infrastructure, exchange, router, pool, bridge, or market-maker row.";
  }

  if (category === "sell-pressure-watchlist") {
    return "CEX deposit or exchange inflow row. This is sell-pressure context, not accumulation.";
  }

  if (/cex withdrawal/i.test(readString(row.metrics.signal) ?? "")) {
    return "CEX withdrawal signal. Candidate accumulation only until labels and retention support it.";
  }

  return "Large DEX-buy candidate. Not confirmed smart money without labels, retention, sell-pressure, and second-source checks.";
}

function readSurfSmartMoneyText(
  tools: OnChainToolResult[],
  key: "bottomLine" | "summary"
) {
  for (const tool of tools) {
    if (tool.provider !== "surf" || tool.status !== "success") {
      continue;
    }

    const record = asRecord(tool.data);
    const value = readString(record?.[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function readSurfSmartMoneySections(
  tools: OnChainToolResult[]
): ResearchReportSection[] {
  for (const tool of tools) {
    if (tool.provider !== "surf" || tool.status !== "success") {
      continue;
    }

    const sections: ResearchReportSection[] = [];

    for (const [index, item] of readArrayFromUnknown(
      tool.data,
      "sections"
    ).entries()) {
      const record = asRecord(item);
      const title = readString(record?.title);
      const markdown = readString(record?.markdown);

      if (!title || !markdown) {
        continue;
      }

      sections.push({
        id: normalizeSectionId(title, index),
        title: normalizeSmartMoneySectionTitle(title),
        markdown: sanitizeSmartMoneyMarkdown(markdown),
        sourceIds: [],
        toolIds: [tool.commandId],
      });
    }

    if (sections.length) {
      return sections;
    }
  }

  return [];
}

function normalizeSectionId(title: string, index: number) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `section-${index + 1}`;
}

function buildSmartMoneyTables(
  rows: NormalizedRow[],
  accumulatorRows: NormalizedRow[],
  smartMoneyTableTitle: string
) {
  const tables: ResearchReportTable[] = [];
  const dexTable = buildDexAccumulationTable(rows.filter(isDexBuyRow));
  const cexWithdrawalTable = buildCexWithdrawalTable(rows.filter(isCexWithdrawalRow));
  const cexDepositTable = buildCexDepositTable(rows.filter(isCexDepositRow));

  if (dexTable) {
    tables.push(dexTable);
  }

  if (cexWithdrawalTable) {
    tables.push(cexWithdrawalTable);
  }

  if (cexDepositTable) {
    tables.push(cexDepositTable);
  }

  if (accumulatorRows.length) {
    tables.push(buildSmartMoneyTable(accumulatorRows, smartMoneyTableTitle));
  }

  if (tables.length) {
    return tables;
  }

  return [buildSmartMoneyTable(rows, smartMoneyTableTitle)];
}

function buildDexAccumulationTable(rows: NormalizedRow[]) {
  if (!rows.length) {
    return undefined;
  }

  return {
    id: "dex-accumulation-table",
    title: "DEX Accumulation",
    description:
      "DEX rows are large-flow watchlist entries unless wallet labels, retention, sell pressure, and second-source validation support a stronger classification.",
    columns: ["Wallet", "Signal", "Token", "Net amount", "Net USD", "Trades", "Window"],
    rows: rows.map((row) => ({
      "Net USD": readSmartMoneyUsdMetric(row.metrics) || "Not available",
      "Net amount": readSmartMoneyAmountMetric(row.metrics) || "Not available",
      "Signal": humanizeSmartMoneyValue(readSmartMoneyMetric(row.metrics, "signal") || "DEX buy"),
      "Token": readSmartMoneyTokenMetric(row.metrics) || "Not available",
      "Trades": readSmartMoneyMetric(row.metrics, "trades") || "Not available",
      "Wallet": row.label,
      "Window": readSmartMoneyMetric(row.metrics, "window") || "Not available",
    })),
  };
}

function buildCexWithdrawalTable(rows: NormalizedRow[]) {
  if (!rows.length) {
    return undefined;
  }

  return {
    id: "cex-withdrawal-table",
    title: "CEX Withdrawal Signal",
    description:
      "CEX withdrawals show tokens leaving identified exchange addresses toward recipient wallets. They are stronger accumulation context than DEX-only rows, but still need wallet identity and retention checks.",
    columns: [
      "Wallet",
      "Source CEX",
      "Token",
      "Net amount out",
      "Net USD out",
      "Transfers",
      "Window",
    ],
    rows: rows.map((row) => ({
      "Net USD out": readSmartMoneyUsdMetric(row.metrics) || "Not available",
      "Net amount out": readSmartMoneyAmountMetric(row.metrics) || "Not available",
      "Source CEX": readSmartMoneyMetric(row.metrics, "sourceCex") ||
        readSmartMoneyMetric(row.metrics, "source_cex") ||
        "Not available",
      "Token": readSmartMoneyTokenMetric(row.metrics) || "Not available",
      "Transfers": readSmartMoneyMetric(row.metrics, "transfers") ||
        readSmartMoneyMetric(row.metrics, "trades") ||
        "Not available",
      "Wallet": row.label,
      "Window": readSmartMoneyMetric(row.metrics, "window") || "Not available",
    })),
  };
}

function buildCexDepositTable(rows: NormalizedRow[]) {
  if (!rows.length) {
    return undefined;
  }

  return {
    id: "cex-deposit-table",
    title: "CEX Deposit / Sell Pressure",
    description:
      "CEX deposits show tokens moving from wallets into identified exchange addresses. These rows are sell-pressure context, not accumulation candidates.",
    columns: [
      "Wallet",
      "Destination CEX",
      "Token",
      "Net amount in",
      "Net USD in",
      "Transfers",
      "Window",
    ],
    rows: rows.map((row) => ({
      "Destination CEX": readSmartMoneyMetric(row.metrics, "sourceCex") ||
        readSmartMoneyMetric(row.metrics, "source_cex") ||
        "Not available",
      "Net USD in": readSmartMoneyUsdMetric(row.metrics) || "Not available",
      "Net amount in": readSmartMoneyAmountMetric(row.metrics) || "Not available",
      "Token": readSmartMoneyTokenMetric(row.metrics) || "Not available",
      "Transfers": readSmartMoneyMetric(row.metrics, "transfers") ||
        readSmartMoneyMetric(row.metrics, "trades") ||
        "Not available",
      "Wallet": row.label,
      "Window": readSmartMoneyMetric(row.metrics, "window") || "Not available",
    })),
  };
}

function buildSmartMoneyTable(rows: NormalizedRow[], title: string) {
  const columns = [
    "Wallet",
    "Token",
    "Signal",
    "Amount",
    "USD value",
    "Trades",
    "Window",
    "Category",
    "Status",
  ];

  return {
    id: "smart-money-table",
    title,
    columns,
    rows: rows.map((row) => ({
      "Amount": readSmartMoneyMetric(row.metrics, "netToken") ||
        readSmartMoneyMetric(row.metrics, "netMnt") ||
        readSmartMoneyMetric(row.metrics, "netAmount") ||
        readSmartMoneyMetric(row.metrics, "amount") ||
        "Not available",
      "Category": humanizeSmartMoneyValue(
        readSmartMoneyMetric(row.metrics, "tokenCategory") ||
        readSmartMoneyMetric(row.metrics, "category") ||
        "Not available"
      ),
      "Signal": humanizeSmartMoneyValue(
        readSmartMoneyMetric(row.metrics, "signal") ||
        (readSmartMoneyMetric(row.metrics, "net_flow_7d_usd") ||
          readSmartMoneyMetric(row.metrics, "net_flow_30d_usd") ||
          readSmartMoneyMetric(row.metrics, "netFlowUsd")
          ? "Net flow"
          : "Not available")
      ),
      "Status": humanizeSmartMoneyValue(
        readSmartMoneyMetric(row.metrics, "smartMoneyStatus") ||
        readSmartMoneyMetric(row.metrics, "status") ||
        classifySmartMoneyReportRow(row)
      ),
      "Token": readSmartMoneyMetric(row.metrics, "tokenSymbol") ||
        readSmartMoneyMetric(row.metrics, "token") ||
        readSmartMoneyMetric(row.metrics, "symbol") ||
        "Not available",
      "Trades": readSmartMoneyMetric(row.metrics, "trades") ||
        readSmartMoneyMetric(row.metrics, "transfers") ||
        "Not available",
      "USD value": readSmartMoneyMetric(row.metrics, "netUsd") ||
        readSmartMoneyMetric(row.metrics, "usd") ||
        readSmartMoneyMetric(row.metrics, "usd_value") ||
        readSmartMoneyMetric(row.metrics, "usdValue") ||
        readSmartMoneyMetric(row.metrics, "amount_usd") ||
        readSmartMoneyMetric(row.metrics, "amountUsd") ||
        readSmartMoneyMetric(row.metrics, "net_flow_7d_usd") ||
        readSmartMoneyMetric(row.metrics, "net_flow_30d_usd") ||
        readSmartMoneyMetric(row.metrics, "netFlowUsd") ||
        "Not available",
      "Wallet": row.label,
      "Window": readSmartMoneyMetric(row.metrics, "window") || "Not available",
    })),
  };
}

function readSmartMoneyAmountMetric(metrics: Record<string, string | number | null>) {
  return readSmartMoneyMetric(metrics, "netToken") ||
    readSmartMoneyMetric(metrics, "netMnt") ||
    readSmartMoneyMetric(metrics, "netAmount") ||
    readSmartMoneyMetric(metrics, "amount");
}

function readSmartMoneyTokenMetric(metrics: Record<string, string | number | null>) {
  return readSmartMoneyMetric(metrics, "tokenSymbol") ||
    readSmartMoneyMetric(metrics, "token") ||
    readSmartMoneyMetric(metrics, "symbol");
}

function readSmartMoneyUsdMetric(metrics: Record<string, string | number | null>) {
  return readSmartMoneyMetric(metrics, "netUsd") ||
    readSmartMoneyMetric(metrics, "usd") ||
    readSmartMoneyMetric(metrics, "usd_value") ||
    readSmartMoneyMetric(metrics, "usdValue") ||
    readSmartMoneyMetric(metrics, "amount_usd") ||
    readSmartMoneyMetric(metrics, "amountUsd") ||
    readSmartMoneyMetric(metrics, "net_flow_7d_usd") ||
    readSmartMoneyMetric(metrics, "net_flow_30d_usd") ||
    readSmartMoneyMetric(metrics, "netFlowUsd");
}

function readSmartMoneyMetric(
  metrics: Record<string, string | number | null>,
  key: string
) {
  const value = metrics[key];

  if (value == null || value === "") {
    return "";
  }

  return formatCell(value);
}

function isAccumulatorSmartMoneyRow(row: NormalizedRow) {
  const category = classifySmartMoneyReportRow(row);

  return category !== "sell-pressure-watchlist" && category !== "excluded-address";
}

function isDexBuyRow(row: NormalizedRow) {
  return /dex buy/i.test(readString(row.metrics.signal) ?? "");
}

function isCexWithdrawalRow(row: NormalizedRow) {
  return /cex withdrawal/i.test(readString(row.metrics.signal) ?? "");
}

function isCexDepositRow(row: NormalizedRow) {
  return /cex deposit/i.test(readString(row.metrics.signal) ?? "");
}

function isCexFlowRow(row: NormalizedRow) {
  return isCexWithdrawalRow(row) || isCexDepositRow(row);
}

function normalizeSmartMoneySectionTitle(title: string) {
  const normalized = title.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const titles: Record<string, string> = {
    candidate_smart_money: "Candidate smart money",
    confirmed_smart_money: "Confirmed smart money",
    data_source_diagnostics: "Data source diagnostics",
    excluded_addresses: "Excluded addresses",
    large_flow_watchlist: "Large-flow watchlist",
    limitations: "Limits",
    sell_pressure_watchlist: "CEX sell pressure",
  };

  return titles[normalized] ?? title;
}

function sanitizeSmartMoneyMarkdown(markdown: string) {
  return humanizeSmartMoneyValue(markdown).replace(/\u2014/g, "-");
}

function humanizeSmartMoneyValue(value: string) {
  return value
    .replace(/\bconfirmed_smart_money\b/gi, "confirmed smart money")
    .replace(/\bcandidate_smart_money\b/gi, "candidate smart money")
    .replace(/\blarge_flow_watchlist\b/gi, "large-flow watchlist")
    .replace(/\blarge-flow-watchlist\b/gi, "large-flow watchlist")
    .replace(/\bexcluded_addresses\b/gi, "excluded addresses")
    .replace(/\bexcluded_address\b/gi, "excluded address")
    .replace(/\bsell_pressure_watchlist\b/gi, "sell-pressure watchlist")
    .replace(/\bsell-pressure-watchlist\b/gi, "sell-pressure watchlist")
    .replace(/\bdata_source_diagnostics\b/gi, "data source diagnostics")
    .replace(/\bnon-stable-token-accumulation\b/gi, "non-stable token accumulation")
    .replace(/\bstablecoin-dry-powder-flow\b/gi, "stablecoin dry-powder flow")
    .replace(/\bwrapped-major-asset-flow\b/gi, "wrapped major asset flow")
    .replace(/\bexcluded-infrastructure-flow\b/gi, "excluded infrastructure flow");
}
