import {
  AccountAuthError,
  requireAccountAuth,
  type AccountAuthInput,
  type AuthenticatedAccount,
} from "./server/account-auth";
import type { Database, Json } from "./supabase/database.types";

export type MemoryStatus = "active" | "disabled";
export type MemoryCategory =
  | "Preference"
  | "Project"
  | "Workflow"
  | "Personal"
  | "API";

export type MemoryItem = {
  id: string;
  memory: string;
  category: MemoryCategory;
  scope: string;
  status: MemoryStatus;
  source: string;
  lastUsed: string;
  updatedAt: string;
  confidence: number;
};

export type MemoryStats = {
  active: number;
  disabled: number;
  projectScoped: number;
  total: number;
};

export type MemorySettings = {
  autoDisableLowConfidence: boolean;
  captureEnabled: boolean;
  crossChatRecall: boolean;
  projectScopedRecall: boolean;
  retentionDays: number;
  updatedAt: string;
};

export type MemoryDashboard = {
  configured: true;
  memories: MemoryItem[];
  settings: MemorySettings;
  stats: MemoryStats;
};

export type MemoryInput = {
  category?: unknown;
  confidence?: unknown;
  lastUsed?: unknown;
  memory?: unknown;
  scope?: unknown;
  source?: unknown;
  status?: unknown;
};

export type MemorySettingsInput = {
  autoDisableLowConfidence?: unknown;
  captureEnabled?: unknown;
  crossChatRecall?: unknown;
  projectScopedRecall?: unknown;
  retentionDays?: unknown;
};

type MemoryRow = Database["public"]["Tables"]["langclaw_memories"]["Row"];
type MemorySettingsRow =
  Database["public"]["Tables"]["langclaw_memory_settings"]["Row"];
type MemoryContext = AuthenticatedAccount;

const memoryCategories: readonly MemoryCategory[] = [
  "Preference",
  "Project",
  "Workflow",
  "Personal",
  "API",
];
const memoryStatuses: readonly MemoryStatus[] = ["active", "disabled"];

export class MemoryHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function memoryErrorResponse(error: unknown) {
  if (error instanceof MemoryHttpError) {
    const message =
      error.status < 500 || error.status === 503
        ? error.message
        : "Memory request failed.";

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
      error: "Memory request failed.",
    },
    { status: 500 }
  );
}

export async function readMemoryDashboard(
  authInput: AccountAuthInput
): Promise<MemoryDashboard> {
  const context = await requireMemoryContext(authInput);
  const [memories, settings] = await Promise.all([
    readMemoriesForContext(context),
    readMemorySettingsForContext(context),
  ]);

  return {
    configured: true,
    memories,
    settings,
    stats: buildMemoryStats(memories),
  };
}

export async function createMemory(
  authInput: AccountAuthInput,
  input: MemoryInput
) {
  const context = await requireMemoryContext(authInput);
  const memory = normalizeMemoryInput(input);
  const { data, error } = await context.supabase
    .from("langclaw_memories")
    .insert({
      category: memory.category,
      confidence: memory.confidence,
      last_used_at: memory.lastUsed,
      memory: memory.memory,
      metadata: {},
      scope: memory.scope,
      source: memory.source,
      status: memory.status,
      wallet_user_id: context.walletUser.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new MemoryHttpError(
      500,
      error?.message || "Unable to create memory."
    );
  }

  return rowToMemory(data as MemoryRow);
}

export async function updateMemoryStatus(
  authInput: AccountAuthInput,
  memoryId: unknown,
  statusInput: unknown
) {
  const context = await requireMemoryContext(authInput);
  const status = readMemoryStatus(statusInput);
  const { data, error } = await context.supabase
    .from("langclaw_memories")
    .update({ status })
    .eq("id", readMemoryId(memoryId))
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new MemoryHttpError(500, error.message);
  }

  if (!data) {
    throw new MemoryHttpError(404, "Memory was not found.");
  }

  return rowToMemory(data as MemoryRow);
}

export async function updateManyMemoryStatuses(
  authInput: AccountAuthInput,
  memoryIds: unknown,
  statusInput: unknown
) {
  const context = await requireMemoryContext(authInput);
  const ids = readMemoryIds(memoryIds);
  const status = readMemoryStatus(statusInput);
  const { data, error } = await context.supabase
    .from("langclaw_memories")
    .update({ status })
    .eq("wallet_user_id", context.walletUser.id)
    .in("id", ids)
    .select("*");

  if (error) {
    throw new MemoryHttpError(500, error.message);
  }

  return ((data ?? []) as MemoryRow[]).map(rowToMemory);
}

export async function deleteMemory(
  authInput: AccountAuthInput,
  memoryId: unknown
) {
  const context = await requireMemoryContext(authInput);
  const { data, error } = await context.supabase
    .from("langclaw_memories")
    .delete()
    .eq("id", readMemoryId(memoryId))
    .eq("wallet_user_id", context.walletUser.id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new MemoryHttpError(500, error.message);
  }

  if (!data) {
    throw new MemoryHttpError(404, "Memory was not found.");
  }

  return { deleted: true, deletedIds: [data.id] };
}

export async function deleteManyMemories(
  authInput: AccountAuthInput,
  memoryIds: unknown
) {
  const context = await requireMemoryContext(authInput);
  const ids = readMemoryIds(memoryIds);
  const { data, error } = await context.supabase
    .from("langclaw_memories")
    .delete()
    .eq("wallet_user_id", context.walletUser.id)
    .in("id", ids)
    .select("id");

  if (error) {
    throw new MemoryHttpError(500, error.message);
  }

  return {
    deleted: true,
    deletedIds: (data ?? []).map((row) => row.id),
  };
}

export async function readMemorySettings(authInput: AccountAuthInput) {
  const context = await requireMemoryContext(authInput);

  return readMemorySettingsForContext(context);
}

export async function updateMemorySettings(
  authInput: AccountAuthInput,
  input: MemorySettingsInput
) {
  const context = await requireMemoryContext(authInput);
  const current = await readMemorySettingsRow(context);
  const settings = normalizeMemorySettingsInput(input, rowToMemorySettings(current));
  const { data, error } = await context.supabase
    .from("langclaw_memory_settings")
    .update({
      auto_disable_low_confidence: settings.autoDisableLowConfidence,
      capture_enabled: settings.captureEnabled,
      cross_chat_recall: settings.crossChatRecall,
      project_scoped_recall: settings.projectScopedRecall,
      retention_days: settings.retentionDays,
    })
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new MemoryHttpError(
      500,
      error?.message || "Unable to update memory settings."
    );
  }

  return rowToMemorySettings(data as MemorySettingsRow);
}

export async function writeAutomationRunMemory(
  context: MemoryContext,
  input: {
    completedAt: string;
    error?: string;
    project: string;
    runId: string;
    status: string;
    taskName: string;
  }
) {
  const settings = await readMemorySettingsRow(context);
  const confidence = input.status === "completed" ? 82 : 72;

  if (!settings.capture_enabled) {
    return;
  }

  const summary = buildAutomationRunMemory(input);
  const { error } = await context.supabase.from("langclaw_memories").insert({
    category: "Workflow",
    confidence,
    last_used_at: input.completedAt,
    memory: summary,
    metadata: {
      runId: input.runId,
      status: input.status,
      taskName: input.taskName,
    } satisfies Json,
    scope: input.project || "Automation",
    source: "Automation run",
    status:
      settings.auto_disable_low_confidence && confidence < 75
        ? "disabled"
        : "active",
    wallet_user_id: context.walletUser.id,
  });

  if (error) {
    throw new MemoryHttpError(500, error.message);
  }
}

async function readMemoriesForContext(context: MemoryContext) {
  const { data, error } = await context.supabase
    .from("langclaw_memories")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new MemoryHttpError(500, error.message);
  }

  return ((data ?? []) as MemoryRow[]).map(rowToMemory);
}

async function readMemorySettingsForContext(context: MemoryContext) {
  return rowToMemorySettings(await readMemorySettingsRow(context));
}

async function readMemorySettingsRow(context: MemoryContext) {
  const { data, error } = await context.supabase
    .from("langclaw_memory_settings")
    .upsert(
      {
        wallet_user_id: context.walletUser.id,
      },
      { onConflict: "wallet_user_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new MemoryHttpError(
      500,
      error?.message || "Unable to read memory settings."
    );
  }

  return data as MemorySettingsRow;
}

async function requireMemoryContext(
  authInput: AccountAuthInput
): Promise<MemoryContext> {
  try {
    return await requireAccountAuth(authInput);
  } catch (error) {
    if (error instanceof AccountAuthError) {
      throw new MemoryHttpError(error.status, error.message);
    }

    throw error;
  }
}

function rowToMemory(row: MemoryRow): MemoryItem {
  const lastUsed = row.last_used_at ?? row.updated_at ?? row.created_at;

  return {
    category: row.category,
    confidence: row.confidence,
    id: row.id,
    lastUsed: toDateOnly(lastUsed),
    memory: row.memory,
    scope: row.scope,
    source: row.source,
    status: row.status,
    updatedAt: toDateOnly(row.updated_at),
  };
}

function rowToMemorySettings(row: MemorySettingsRow): MemorySettings {
  return {
    autoDisableLowConfidence: row.auto_disable_low_confidence,
    captureEnabled: row.capture_enabled,
    crossChatRecall: row.cross_chat_recall,
    projectScopedRecall: row.project_scoped_recall,
    retentionDays: row.retention_days,
    updatedAt: row.updated_at,
  };
}

function buildMemoryStats(memories: MemoryItem[]): MemoryStats {
  return {
    active: memories.filter((memory) => memory.status === "active").length,
    disabled: memories.filter((memory) => memory.status === "disabled").length,
    projectScoped: memories.filter((memory) => memory.scope !== "Global").length,
    total: memories.length,
  };
}

function normalizeMemoryInput(input: MemoryInput) {
  const memory = readOptionalString(input.memory, 2000);

  if (!memory) {
    throw new MemoryHttpError(400, "Memory text is required.");
  }

  return {
    category: readMemoryCategory(input.category, "Preference"),
    confidence: readConfidence(input.confidence),
    lastUsed: readOptionalDate(input.lastUsed),
    memory,
    scope: readOptionalString(input.scope, 120) ?? "Global",
    source: readOptionalString(input.source, 160) ?? "Manual",
    status: readMemoryStatus(input.status, "active"),
  };
}

function normalizeMemorySettingsInput(
  input: MemorySettingsInput,
  fallback: MemorySettings
): MemorySettings {
  return {
    autoDisableLowConfidence: readBoolean(
      input.autoDisableLowConfidence,
      fallback.autoDisableLowConfidence,
      "autoDisableLowConfidence"
    ),
    captureEnabled: readBoolean(
      input.captureEnabled,
      fallback.captureEnabled,
      "captureEnabled"
    ),
    crossChatRecall: readBoolean(
      input.crossChatRecall,
      fallback.crossChatRecall,
      "crossChatRecall"
    ),
    projectScopedRecall: readBoolean(
      input.projectScopedRecall,
      fallback.projectScopedRecall,
      "projectScopedRecall"
    ),
    retentionDays: readRetentionDays(input.retentionDays, fallback.retentionDays),
    updatedAt: fallback.updatedAt,
  };
}

function readMemoryId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryHttpError(400, "memoryId is required.");
  }

  return value.trim();
}

function readMemoryIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new MemoryHttpError(400, "memoryIds are required.");
  }

  if (value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new MemoryHttpError(
      400,
      "memoryIds must contain only non-empty strings."
    );
  }

  const ids = Array.from(new Set((value as string[]).map((item) => item.trim())));

  if (!ids.length) {
    throw new MemoryHttpError(400, "At least one memory id is required.");
  }

  return ids;
}

function readMemoryCategory(value: unknown, fallback: MemoryCategory) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "string" && memoryCategories.includes(value as MemoryCategory)) {
    return value as MemoryCategory;
  }

  throw new MemoryHttpError(400, "A valid memory category is required.");
}

function readMemoryStatus(value: unknown, fallback?: MemoryStatus) {
  if (value === undefined && fallback) {
    return fallback;
  }

  if (typeof value === "string" && memoryStatuses.includes(value as MemoryStatus)) {
    return value as MemoryStatus;
  }

  throw new MemoryHttpError(400, "A valid memory status is required.");
}

function readBoolean(value: unknown, fallback: boolean, field: string) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  throw new MemoryHttpError(400, `${field} must be a boolean.`);
}

function readRetentionDays(value: unknown, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 3650
  ) {
    throw new MemoryHttpError(
      400,
      "retentionDays must be an integer from 0 to 3650."
    );
  }

  return value;
}

function readConfidence(value: unknown) {
  if (value === undefined) {
    return 80;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new MemoryHttpError(
      400,
      "confidence must be an integer from 0 to 100."
    );
  }

  return value;
}

function readOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

function readOptionalDate(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryHttpError(400, "lastUsed must be a valid timestamp.");
  }

  const date = new Date(value.trim());

  if (Number.isNaN(date.getTime())) {
    throw new MemoryHttpError(400, "lastUsed must be a valid timestamp.");
  }

  if (date.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new MemoryHttpError(400, "lastUsed cannot be in the future.");
  }

  return date.toISOString();
}

function toDateOnly(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function buildAutomationRunMemory(input: {
  error?: string;
  status: string;
  taskName: string;
}) {
  const statusText =
    input.status === "completed"
      ? "completed successfully"
      : `finished with status ${input.status}`;
  const errorText = input.error
    ? ` Latest error: ${input.error.slice(0, 240)}`
    : "";

  return `Automation "${input.taskName}" ${statusText}.${errorText}`;
}
