import {
  buildBacktestJournalHashes,
  buildPaperJournalHashes,
  buildPaperTrade,
  runLiquidityMomentumBacktest,
  scanLiquidityMomentumPairs,
} from "../lib/strategy/backtest";
import { fetchStrategyBarsFromDune } from "../lib/strategy/dune";
import {
  persistTradingJournalRecord,
  readTradingJournalRuns,
} from "../lib/strategy/journal";
import { productChains, readProductChainId } from "../lib/chain-config";
import type {
  StrategyBacktestParams,
  StrategyBacktestPayload,
} from "../lib/strategy/types";

type StrategyBody = {
  backtest?: StrategyBacktestPayload;
  chain?: unknown;
  limit?: unknown;
  notionalUsd?: unknown;
  pairAddress?: unknown;
  params?: Partial<StrategyBacktestParams>;
  queryId?: unknown;
};

const strategyParamNames = new Set<keyof StrategyBacktestParams>([
  "initialCapitalUsd",
  "maxHoldHours",
  "minLiquidityUsd",
  "minMomentumBps",
  "minVolumeMultiple",
  "stopLossBps",
  "takeProfitBps",
]);

export async function handleStrategyBacktest(request: Request) {
  const body = await readStrategyBody(request);

  if ("response" in body) {
    return body.response;
  }

  try {
    const queryId = readOptionalString(body.queryId);
    const chain = readProductChainId(body.chain);
    const pairAddress = readOptionalString(body.pairAddress);
    const source = await fetchStrategyBarsFromDune({
      queryId,
      signal: request.signal,
    });
    const backtest = runLiquidityMomentumBacktest({
      bars: source.bars,
      chain,
      pairAddress,
      params: body.params,
      queryId: source.queryId,
      sourceUrl: source.sourceUrl,
    });
    const journal = buildBacktestJournalHashes(backtest);

    backtest.proof = await persistTradingJournalRecord({
      action: backtest.latestSignal.action,
      chain,
      decisionHash: journal.decisionHash,
      evidenceUri: journal.evidenceUri,
      market: backtest.market,
      pnlBps: backtest.metrics.totalPnlBps,
      resultHash: journal.resultHash,
      runId: backtest.runId,
      status: "backtested",
      strategyId: backtest.strategyId,
    });

    return Response.json({
      configured: true,
      backtest,
    });
  } catch (error) {
    return strategyErrorResponse(error);
  }
}

export async function handleStrategyPaperTrade(request: Request) {
  const body = await readStrategyBody(request);

  if ("response" in body) {
    return body.response;
  }

  try {
    const backtest = body.backtest ?? (await createBacktestFromBody(body, request));
    const chain = readProductChainId(body.chain ?? backtest.chain);
    const paperTrade = buildPaperTrade({
      backtest,
      notionalUsd: readPositiveNumber(body.notionalUsd, 1_000),
    });
    const journal = buildPaperJournalHashes(paperTrade);

    paperTrade.proof = await persistTradingJournalRecord({
      action: paperTrade.action,
      chain,
      decisionHash: journal.decisionHash,
      evidenceUri: journal.evidenceUri,
      market: paperTrade.market,
      pnlBps: 0,
      resultHash: journal.resultHash,
      runId: paperTrade.runId,
      status: "paper-opened",
      strategyId: paperTrade.strategyId,
    });

    return Response.json({
      configured: true,
      paperTrade,
    });
  } catch (error) {
    return strategyErrorResponse(error);
  }
}

export async function handleStrategyScanPairs(request: Request) {
  const body = await readStrategyBody(request);

  if ("response" in body) {
    return body.response;
  }

  try {
    const source = await fetchStrategyBarsFromDune({
      queryId: readOptionalString(body.queryId),
      signal: request.signal,
    });
    const chain = readProductChainId(body.chain);
    const scan = scanLiquidityMomentumPairs({
      bars: source.bars,
      chain,
      candidateLimit: readPositiveNumber(body.limit, 12),
      params: body.params,
      queryId: source.queryId,
      sourceUrl: source.sourceUrl,
    });

    return Response.json({
      configured: true,
      scan,
    });
  } catch (error) {
    return strategyErrorResponse(error);
  }
}

export async function handleStrategyRuns(request: Request) {
  const body = await readStrategyBody(request);

  if ("response" in body) {
    return body.response;
  }

  try {
    return Response.json(
      await readTradingJournalRuns(
        readPositiveNumber(body.limit, 25),
        readProductChainId(body.chain)
      )
    );
  } catch (error) {
    return strategyErrorResponse(error);
  }
}

async function createBacktestFromBody(
  body: StrategyBody,
  request: Request
): Promise<StrategyBacktestPayload> {
  const source = await fetchStrategyBarsFromDune({
    queryId: readOptionalString(body.queryId),
    signal: request.signal,
  });

  return runLiquidityMomentumBacktest({
    bars: source.bars,
    chain: readProductChainId(body.chain),
    pairAddress: readOptionalString(body.pairAddress),
    params: body.params,
    queryId: source.queryId,
    sourceUrl: source.sourceUrl,
  });
}

async function readStrategyBody(
  request: Request
): Promise<StrategyBody | { response: Response }> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        response: Response.json(
          { configured: false, error: "Request body must be a JSON object." },
          { status: 400 }
        ),
      };
    }

    const strategyBody = body as StrategyBody;

    if (
      !isValidOptionalString(strategyBody.queryId) ||
      !isValidOptionalString(strategyBody.pairAddress)
    ) {
      return {
        response: Response.json(
          {
            configured: false,
            error:
              "queryId and pairAddress must be non-empty strings when provided.",
          },
          { status: 400 }
        ),
      };
    }

    if (!isValidStrategyParams(strategyBody.params)) {
      return {
        response: Response.json(
          {
            configured: false,
            error:
              "params must contain only supported positive finite numbers.",
          },
          { status: 400 }
        ),
      };
    }

    if (!isValidOptionalChain(strategyBody.chain)) {
      return {
        response: Response.json(
          {
            configured: false,
            error:
              "chain must identify a supported product chain when provided.",
          },
          { status: 400 }
        ),
      };
    }

    return strategyBody;
  } catch {
    return {
      response: Response.json(
        { configured: false, error: "Request body must be valid JSON." },
        { status: 400 }
      ),
    };
  }
}

function isValidOptionalString(value: unknown) {
  return value === undefined || (typeof value === "string" && Boolean(value.trim()));
}

function isValidStrategyParams(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([name, parameter]) =>
      strategyParamNames.has(name as keyof StrategyBacktestParams) &&
      typeof parameter === "number" &&
      Number.isFinite(parameter) &&
      parameter > 0
  );
}

function isValidOptionalChain(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return Object.values(productChains).some(
    (chain) => chain.id === normalized || chain.aliases.includes(normalized)
  );
}

function strategyErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Strategy request failed.";
  const unavailable =
    /DUNE_|Dune strategy query|LANGCLAW_TRADING_JOURNAL_ADDRESS|Set /.test(
      message
    );

  return Response.json(
    {
      configured: false,
      error: unavailable ? message : "Strategy request failed.",
    },
    { status: unavailable ? 503 : 500 }
  );
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readPositiveNumber(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
