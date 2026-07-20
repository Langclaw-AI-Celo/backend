import type { ResearchReport, ResearchReportTable } from "./types";

export function renderResearchReportMarkdown(report: ResearchReport) {
  const lines: string[] = [
    `# ${report.title}`,
    "",
    report.executiveSummary,
    "",
    `- Confidence: ${report.confidence}`,
    `- Report type: ${report.kind}`,
    `- As of: ${formatUtc(report.asOfUtc)}`,
  ];

  if (report.entities.length) {
    lines.push("", "## Ranked Entities", "");

    for (const entity of report.entities) {
      const metrics = formatMetrics(entity.metrics);
      lines.push(
        `- ${entity.rank}. ${entity.label} (${entity.severity})${entity.summary ? `: ${entity.summary}` : ""}${metrics ? ` Metrics: ${metrics}.` : ""}`
      );
    }
  }

  for (const table of report.tables) {
    lines.push("", `## ${table.title}`, "");

    if (table.description) {
      lines.push(table.description, "");
    }

    lines.push(renderMarkdownTable(table));
  }

  for (const section of report.sections) {
    lines.push("", `## ${section.title}`, "", section.markdown);
  }

  lines.push("", "## Bottom Line", "", report.bottomLine);

  if (report.recommendations.length) {
    lines.push("", "## Recommendations", "");
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
  }

  if (report.caveats.length) {
    lines.push("", "## Caveats", "");
    for (const caveat of report.caveats) {
      lines.push(`- ${caveat}`);
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function renderMarkdownTable(table: ResearchReportTable) {
  if (!table.rows.length) {
    return "_No rows available._";
  }

  const columns = table.columns;
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map((row) =>
    `| ${columns
      .map((column) => escapeMarkdownCell(formatCell(row[column])))
      .join(" | ")} |`
  );

  return [header, divider, ...rows].join("\n");
}

function formatMetrics(metrics: Record<string, string | number | null>) {
  return Object.entries(metrics)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatCell(value)}`)
    .join(", ");
}

function formatCell(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return "Not available";
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString("en-US")
      : value.toFixed(2).replace(/\.?0+$/, "");
  }

  return value;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}

function formatUtc(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace(".000Z", " UTC");
}

