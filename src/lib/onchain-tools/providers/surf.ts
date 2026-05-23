import type { OnChainProviderResponse } from "../types";
import { compactText, fetchJson, requireEnv } from "./http";

type SurfOptions = {
  query?: string;
  signal?: AbortSignal;
};

export async function getSurfWebSearch(
  options: SurfOptions
): Promise<OnChainProviderResponse> {
  const query = (options.query || "Mantle crypto market signal").trim();
  const url = new URL("https://api.asksurf.ai/gateway/v1/search/web");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "3");

  const data = await fetchJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${requireEnv("SURF_API_KEY")}`,
    },
    signal: options.signal,
    timeoutMs: readTimeout("SURF_TIMEOUT_MS"),
  });

  return {
    data,
    sourceUrl: url.toString(),
    summary: `Fetched Surf web market context for "${query}". ${compactText(data)}`,
  };
}

function readTimeout(name: string) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? value : 12000;
}
