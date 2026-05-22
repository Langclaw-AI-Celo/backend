import type { OnChainProviderResponse } from "../types";
import { compactText, fetchJson, requireEnv } from "./http";

const baseUrl = "https://api.dune.com/api/v1";

type DuneOptions = {
  query?: string;
  queryId?: string;
  signal?: AbortSignal;
};

export async function getLatestResult(
  options: DuneOptions
): Promise<OnChainProviderResponse> {
  const queryId =
    options.queryId ||
    extractQueryId(options.query) ||
    process.env.DUNE_DEFAULT_QUERY_ID?.trim();

  if (!queryId) {
    throw new Error("A Dune query id is required. Set DUNE_DEFAULT_QUERY_ID or include one in the prompt.");
  }

  const sourceUrl = `${baseUrl}/query/${encodeURIComponent(queryId)}/results`;
  const data = await fetchJson(sourceUrl, {
    headers: {
      "X-Dune-API-Key": requireEnv("DUNE_API_KEY"),
    },
    signal: options.signal,
  });

  return {
    data,
    sourceUrl,
    summary: `Fetched latest Dune query result for query ${queryId}. ${compactText(data)}`,
  };
}

function extractQueryId(query: string | undefined) {
  const match = query?.match(/\b(?:dune\s+)?query\s+(\d{3,12})\b/i);

  return match?.[1];
}
