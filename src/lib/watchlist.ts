import {
  AccountAuthError,
  requireAccountAuth,
  type AccountAuthInput,
  type AuthenticatedAccount,
} from "./server/account-auth";
import type { Database } from "./supabase/database.types";

export type AlphaWatchlistItem = {
  addedAt: string;
  agentId?: string;
  caveat: string;
  chain: string;
  decisionHash?: string;
  decisionId?: string;
  evidenceUri?: string;
  explorerUrl?: string;
  gapCount: number;
  id: string;
  intent: string;
  proofTx?: string;
  recommendation: string;
  signalType: string;
  sourceCount: number;
  subject: string;
  summary: string;
  title: string;
};

export type AlphaWatchlistInput = Partial<AlphaWatchlistItem>;

type AlphaWatchlistRow =
  Database["public"]["Tables"]["langclaw_alpha_watchlist"]["Row"];
type AlphaWatchlistContext = AuthenticatedAccount;
const ISO_8601_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const UINT256_MAX = (1n << 256n) - 1n;
const alphaWatchlistInputFields = new Set([
  "addedAt",
  "agentId",
  "caveat",
  "chain",
  "decisionHash",
  "decisionId",
  "evidenceUri",
  "explorerUrl",
  "gapCount",
  "id",
  "intent",
  "proofTx",
  "recommendation",
  "signalType",
  "sourceCount",
  "subject",
  "summary",
  "title",
]);

export class WatchlistHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function watchlistErrorResponse(error: unknown) {
  if (error instanceof WatchlistHttpError || error instanceof AccountAuthError) {
    const message =
      error.status < 500 || error.status === 503
        ? error.message
        : "Watchlist request failed.";

    return Response.json(
      {
        configured: error.status !== 503,
        error: message,
      },
      { status: error.status }
    );
  }

  return Response.json(
    {
      configured: true,
      error: "Watchlist request failed.",
    },
    { status: 500 }
  );
}

export async function listAlphaWatchlist(authInput: AccountAuthInput) {
  const context = await requireWatchlistContext(authInput);
  const { data, error } = await context.supabase
    .from("langclaw_alpha_watchlist")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .order("added_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new WatchlistHttpError(
      500,
      error.message || "Unable to load alpha watchlist."
    );
  }

  return (data ?? []).map((row) => rowToAlphaWatchlistItem(row));
}

export async function upsertAlphaWatchlistItem(
  authInput: AccountAuthInput,
  input: AlphaWatchlistInput
) {
  const context = await requireWatchlistContext(authInput);
  const item = normalizeAlphaWatchlistInput(input);
  const { data, error } = await context.supabase
    .from("langclaw_alpha_watchlist")
    .upsert(
      {
        added_at: item.addedAt,
        agent_id: optionalText(item.agentId),
        caveat: item.caveat,
        chain: item.chain,
        decision_hash: optionalText(item.decisionHash),
        decision_id: optionalText(item.decisionId),
        evidence_uri: optionalText(item.evidenceUri),
        explorer_url: optionalText(item.explorerUrl),
        gap_count: item.gapCount,
        id: item.id,
        intent: item.intent,
        proof_tx: optionalText(item.proofTx),
        recommendation: item.recommendation,
        signal_type: item.signalType,
        source_count: item.sourceCount,
        subject: item.subject,
        summary: item.summary,
        title: item.title,
        wallet_user_id: context.walletUser.id,
      },
      { onConflict: "wallet_user_id,id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new WatchlistHttpError(
      500,
      error?.message || "Unable to save alpha watchlist item."
    );
  }

  return rowToAlphaWatchlistItem(data);
}

export async function deleteAlphaWatchlistItem(
  authInput: AccountAuthInput,
  itemId: unknown
) {
  const context = await requireWatchlistContext(authInput);
  const id = readRequiredText(itemId, "Watchlist item id", 240);
  const { data, error } = await context.supabase
    .from("langclaw_alpha_watchlist")
    .delete()
    .eq("wallet_user_id", context.walletUser.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new WatchlistHttpError(
      500,
      error.message || "Unable to delete alpha watchlist item."
    );
  }

  if (!data) {
    throw new WatchlistHttpError(404, "Watchlist item was not found.");
  }

  return { deleted: true, itemId: id };
}

export async function clearAlphaWatchlist(authInput: AccountAuthInput) {
  const context = await requireWatchlistContext(authInput);
  const { error } = await context.supabase
    .from("langclaw_alpha_watchlist")
    .delete()
    .eq("wallet_user_id", context.walletUser.id);

  if (error) {
    throw new WatchlistHttpError(
      500,
      error.message || "Unable to clear alpha watchlist."
    );
  }

  return { cleared: true };
}

async function requireWatchlistContext(authInput: AccountAuthInput) {
  return requireAccountAuth(authInput);
}

function normalizeAlphaWatchlistInput(
  input: AlphaWatchlistInput
): AlphaWatchlistItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WatchlistHttpError(400, "Watchlist item must be a JSON object.");
  }

  const unsupportedField = Object.keys(input).find(
    (field) => !alphaWatchlistInputFields.has(field),
  );
  if (unsupportedField) {
    throw new WatchlistHttpError(
      400,
      `Watchlist item has unsupported field ${unsupportedField}.`,
    );
  }

  return {
    addedAt: readIsoDate(input.addedAt),
    agentId: readOptionalUint256Text(input.agentId, "agentId"),
    caveat: readRequiredText(input.caveat, "Caveat", 4_000),
    chain: readChain(input.chain),
    decisionHash: readOptionalHash(input.decisionHash, "decisionHash"),
    decisionId: readOptionalUint256Text(input.decisionId, "decisionId"),
    evidenceUri: readOptionalText(input.evidenceUri, "evidenceUri", 1_000),
    explorerUrl: readOptionalHttpsUrl(input.explorerUrl, "explorerUrl"),
    gapCount: readCount(input.gapCount, "gapCount"),
    id: readRequiredText(input.id, "Watchlist item id", 240),
    intent: readRequiredText(input.intent, "Intent", 500),
    proofTx: readOptionalHash(input.proofTx, "proofTx"),
    recommendation: readRequiredText(input.recommendation, "Recommendation", 4_000),
    signalType: readRequiredText(input.signalType, "Signal type", 120),
    sourceCount: readCount(input.sourceCount, "sourceCount"),
    subject: readRequiredText(input.subject, "Subject", 1_000),
    summary: readRequiredText(input.summary, "Summary", 4_000),
    title: readRequiredText(input.title, "Title", 500),
  };
}

function rowToAlphaWatchlistItem(row: AlphaWatchlistRow): AlphaWatchlistItem {
  return {
    addedAt: row.added_at,
    agentId: row.agent_id ?? undefined,
    caveat: row.caveat,
    chain: row.chain,
    decisionHash: row.decision_hash ?? undefined,
    decisionId: row.decision_id ?? undefined,
    evidenceUri: row.evidence_uri ?? undefined,
    explorerUrl: row.explorer_url ?? undefined,
    gapCount: row.gap_count,
    id: row.id,
    intent: row.intent,
    proofTx: row.proof_tx ?? undefined,
    recommendation: row.recommendation,
    signalType: row.signal_type,
    sourceCount: row.source_count,
    subject: row.subject,
    summary: row.summary,
    title: row.title,
  };
}

function readRequiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new WatchlistHttpError(400, `${label} is required.`);
  }

  const text = value.trim().replace(/\s+/g, " ");

  if (!text) {
    throw new WatchlistHttpError(400, `${label} is required.`);
  }

  rejectNullCharacters(text, label);

  if (text.length > maxLength) {
    throw new WatchlistHttpError(
      400,
      `${label} must be at most ${maxLength} characters.`,
    );
  }

  return text;
}

function readChain(value: unknown) {
  if (value === undefined || value === "") {
    return "celo";
  }

  if (typeof value !== "string") {
    throw new WatchlistHttpError(400, "Chain must be a string when provided.");
  }

  return readRequiredText(value, "Chain", 64);
}

function optionalText(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim();

  return text || undefined;
}

function readOptionalText(value: unknown, field: string, maxLength = 500) {
  if (value !== undefined && typeof value !== "string") {
    throw new WatchlistHttpError(400, `${field} must be a string.`);
  }

  const text = optionalText(value);

  if (text) {
    rejectNullCharacters(text, field);
  }

  if (text && text.length > maxLength) {
    throw new WatchlistHttpError(
      400,
      `${field} must be at most ${maxLength} characters.`,
    );
  }

  return text;
}

function rejectNullCharacters(text: string, field: string) {
  if (text.includes("\u0000")) {
    throw new WatchlistHttpError(
      400,
      `${field} must not contain null characters.`,
    );
  }
}

function readOptionalUint256Text(value: unknown, field: string) {
  const text = readOptionalText(value, field, 78);

  if (
    text &&
    (!/^(0|[1-9]\d*)$/.test(text) || BigInt(text) > UINT256_MAX)
  ) {
    throw new WatchlistHttpError(
      400,
      `${field} must be a canonical unsigned 256-bit decimal integer.`,
    );
  }

  return text;
}

function readOptionalHash(value: unknown, field: string) {
  const text = readOptionalText(value, field, 66);

  if (text && !/^0x[0-9a-fA-F]{64}$/.test(text)) {
    throw new WatchlistHttpError(
      400,
      `${field} must be a 32-byte hexadecimal hash.`,
    );
  }

  return text;
}

function readOptionalHttpsUrl(value: unknown, field: string) {
  const text = readOptionalText(value, field, 1_000);

  if (!text) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new WatchlistHttpError(
      400,
      `${field} must be an HTTPS URL without credentials.`,
    );
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new WatchlistHttpError(
      400,
      `${field} must be an HTTPS URL without credentials.`,
    );
  }

  return text;
}

function readCount(value: unknown, field: string) {
  if (value === undefined) {
    return 0;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new WatchlistHttpError(
      400,
      `${field} must be a non-negative integer.`,
    );
  }

  if (value > POSTGRES_INTEGER_MAX) {
    throw new WatchlistHttpError(
      400,
      `${field} must be at most ${POSTGRES_INTEGER_MAX}.`,
    );
  }

  return value;
}

function readIsoDate(value: unknown) {
  if (value === undefined) {
    return new Date().toISOString();
  }

  if (typeof value === "string" && hasValidIsoCalendarDate(value.trim())) {
    const date = new Date(value.trim());

    if (!Number.isNaN(date.getTime())) {
      if (date.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new WatchlistHttpError(400, "Added at cannot be in the future.");
      }

      return date.toISOString();
    }
  }

  throw new WatchlistHttpError(400, "Added at must be a valid date.");
}

function hasValidIsoCalendarDate(value: string) {
  const match = value.match(ISO_8601_DATE_PATTERN);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]!;
}
