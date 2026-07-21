import { createHash, randomBytes, randomInt } from "node:crypto";

import {
  AccountAuthError,
  requireAccountAuth,
  requireSupabaseAdmin,
} from "../../server/account-auth";
import { writeAutomationRunMemory } from "../../memory";
import {
  readAlphaSignalFromPayload,
  withAlphaSignalNotification,
} from "../../langclaw/alpha-quality";
import { runLangclawWorkflow } from "../../langclaw/workflow";
import { readProviderResponseJson } from "../../provider-response";
import { createAutomationProviderSignal } from "../provider-http";
import {
  refundResearchUsage,
  reserveResearchUsage,
  settleResearchUsage,
} from "../../usage";
import { buildTriggerLabel, computeNextRunAt, getZonedParts } from "../schedule";
import {
  buildAlphaSignalNotificationMessage,
  buildAutomationNotificationMessage,
  sendAutomationEmail,
  sendAlphaSignalNotification,
  sendAutomationRunNotification,
} from "../notifications";
import type {
  AccountAuthInput,
  AutomationContext,
  AutomationInAppNotification,
  AutomationNotificationRow,
  AutomationRun,
  AutomationRunRow,
  AutomationSettings,
  AutomationSettingsRow,
  AutomationTask,
  AutomationTaskRow,
  AutomationTaskStatus,
} from "./types";

export {
  AccountAuthError,
  buildAlphaSignalNotificationMessage,
  buildAutomationNotificationMessage,
  buildTriggerLabel,
  computeNextRunAt,
  createAutomationProviderSignal,
  createHash,
  getZonedParts,
  randomBytes,
  randomInt,
  readAlphaSignalFromPayload,
  readProviderResponseJson,
  refundResearchUsage,
  requireAccountAuth,
  requireSupabaseAdmin,
  reserveResearchUsage,
  runLangclawWorkflow,
  sendAlphaSignalNotification,
  sendAutomationEmail,
  sendAutomationRunNotification,
  settleResearchUsage,
  withAlphaSignalNotification,
  writeAutomationRunMemory,
};

export const defaultTimezone = "Asia/Jakarta";
export const neuronPer0G = 1_000_000_000_000_000_000n;
export const maxStoredNeuron = 10n ** 78n - 1n;
export const defaultTelegramBotUsername = "langclawaibot";

export class AutomationHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  const maskedName =
    name.length <= 2 ? `${name[0] ?? "*"}*` : `${name.slice(0, 2)}***`;

  return `${maskedName}@${domain}`;
}

export function formatNeuronAs0G(value: bigint) {
  const whole = value / neuronPer0G;
  const fraction = (value % neuronPer0G).toString().padStart(18, "0");
  const trimmed = fraction.replace(/0+$/, "");

  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function readDecimalString(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : "0";
  }

  if (typeof value !== "string") {
    return "0";
  }

  return /^\d+$/.test(value) ? value : "0";
}

export function read0GAmount(value: unknown, fallback: string, field: string) {
  if (value === undefined) {
    return fallback;
  }

  const raw =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";

  if (!/^\d+(\.\d{1,18})?$/.test(raw)) {
    throw new AutomationHttpError(
      400,
      `${field} must be a non-negative decimal with up to 18 fractional digits.`
    );
  }

  if (BigInt(parse0GToNeuron(raw)) > maxStoredNeuron) {
    throw new AutomationHttpError(
      400,
      `${field} exceeds the supported 0G amount.`,
    );
  }

  return raw;
}

export function parse0GToNeuron(value: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const whole = BigInt(wholePart || "0") * neuronPer0G;
  const fraction = BigInt(fractionPart.padEnd(18, "0").slice(0, 18) || "0");

  return (whole + fraction).toString();
}

export function readOptionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

export function rowToSettings(row: AutomationSettingsRow): AutomationSettings {
  return {
    autoPauseRepeatedFailures: row.auto_pause_repeated_failures,
    dailyLimit0G: formatNeuronAs0G(BigInt(readDecimalString(row.daily_limit_neuron))),
    failureNotification: row.failure_notification,
    limitBehavior: row.limit_behavior,
    lowBalanceThreshold0G: formatNeuronAs0G(
      BigInt(readDecimalString(row.low_balance_threshold_neuron))
    ),
    monthlyCap0G: formatNeuronAs0G(BigInt(readDecimalString(row.monthly_cap_neuron))),
    notificationChannels: row.notification_channels,
    notificationEmail: row.notification_email ?? undefined,
    notificationEmailLinkedAt: row.notification_email_linked_at ?? undefined,
    notificationEmailPending: row.notification_email_pending
      ? maskEmail(row.notification_email_pending)
      : undefined,
    notificationEmailVerified: row.notification_email_verified,
    retryPolicy: row.retry_policy,
    telegramChatId: row.telegram_chat_id ?? undefined,
    telegramLinkedAt: row.telegram_linked_at ?? undefined,
    telegramUsername: row.telegram_username ?? undefined,
    telegramVerified: row.telegram_verified,
    thresholdAction: row.threshold_action,
    writeRunLogsToMemory: row.write_run_logs_to_memory,
  };
}

export async function readAutomationSettingsRow(context: AutomationContext) {
  const { data, error } = await context.supabase
    .from("langclaw_automation_settings")
    .upsert(
      {
        wallet_user_id: context.walletUser.id,
      },
      { onConflict: "wallet_user_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to read automation settings."
    );
  }

  return data as AutomationSettingsRow;
}

export async function requireAutomationContext(
  authInput: AccountAuthInput
): Promise<AutomationContext> {
  try {
    return await requireAccountAuth(authInput);
  } catch (error) {
    if (error instanceof AccountAuthError) {
      throw new AutomationHttpError(error.status, error.message);
    }

    throw error;
  }
}

export function requireAutomationSupabaseAdmin() {
  try {
    return requireSupabaseAdmin();
  } catch (error) {
    if (error instanceof AccountAuthError) {
      throw new AutomationHttpError(error.status, error.message);
    }

    throw error;
  }
}

export async function readAutomationTaskRow(context: AutomationContext, taskId: string) {
  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("wallet_user_id", context.walletUser.id)
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  if (!data) {
    throw new AutomationHttpError(404, "Automation task was not found.");
  }

  return data as AutomationTaskRow;
}

export async function readUsageTotalSince(context: AutomationContext, since: Date) {
  const { data, error } = await context.supabase
    .from("langclaw_usage_charges")
    .select("charged_neuron")
    .eq("wallet_user_id", context.walletUser.id)
    .gte("created_at", since.toISOString());

  if (error) {
    return "0";
  }

  return (data ?? [])
    .reduce((total, row) => total + BigInt(readDecimalString(row.charged_neuron)), 0n)
    .toString();
}

export async function readUsageAccount(context: AutomationContext) {
  const { data } = await context.supabase
    .from("langclaw_usage_accounts")
    .select("available_neuron")
    .eq("wallet_user_id", context.walletUser.id)
    .maybeSingle();

  return data as { available_neuron: string } | null;
}

export async function createAutomationContextForWalletUser(
  supabase: AutomationContext["supabase"],
  walletUserId: string
): Promise<AutomationContext> {
  const { data, error } = await supabase
    .from("langclaw_wallet_users")
    .select("id,wallet_address")
    .eq("id", walletUserId)
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  if (!data) {
    throw new AutomationHttpError(404, "Automation owner was not found.");
  }

  return {
    authMethod: "api_key",
    supabase,
    walletUser: {
      id: data.id,
      walletAddress: data.wallet_address,
    },
  };
}

export function readMaxAttempts(maxRetries: number) {
  if (!Number.isFinite(maxRetries) || maxRetries <= 0) {
    return 1;
  }

  return Math.min(Math.trunc(maxRetries), 5);
}

export function startOfLocalDay(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);

  return localPartsToUtc({
    day: parts.day,
    hour: 0,
    minute: 0,
    month: parts.month,
    year: parts.year,
  }, timezone);
}

export function startOfLocalMonth(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);

  return localPartsToUtc({
    day: 1,
    hour: 0,
    minute: 0,
    month: parts.month,
    year: parts.year,
  }, timezone);
}

export function localPartsToUtc(
  parts: {
    day: number;
    hour: number;
    minute: number;
    month: number;
    year: number;
  },
  timezone: string
) {
  const utcGuess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  );
  const zoned = getZonedParts(utcGuess, timezone);
  const offset =
    Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    ) - utcGuess.getTime();

  return new Date(utcGuess.getTime() - offset);
}

export function rowToRun(row: AutomationRunRow, taskName?: string): AutomationRun {
  return {
    attempt: row.attempt,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    durationMs: row.duration_ms ?? undefined,
    error: row.error ?? undefined,
    id: row.id,
    result: row.result ?? undefined,
    scheduledFor: row.scheduled_for ?? undefined,
    startedAt: row.started_at ?? undefined,
    status: row.status,
    taskId: row.task_id,
    taskName,
    triggeredBy: row.triggered_by,
    usage: row.usage ?? undefined,
  };
}

export async function readAutomationSettingsForContext(context: AutomationContext) {
  return rowToSettings(await readAutomationSettingsRow(context));
}

export function requireTelegramLinkedSettings(settings: AutomationSettings) {
  if (!settings.telegramVerified || !settings.telegramChatId?.trim()) {
    throw new AutomationHttpError(403, "Telegram connection is required.");
  }
}

export async function updateTaskStatus(
  context: AutomationContext,
  task: AutomationTaskRow,
  status: Extract<AutomationTaskStatus, "active" | "paused">
) {
  if (status === "active") {
    requireTelegramLinkedSettings(await readAutomationSettingsForContext(context));
  }

  const nextRunAt =
    status === "active" &&
    task.trigger_type === "schedule" &&
    task.schedule_frequency
      ? computeNextRunAt({
          frequency: task.schedule_frequency,
          scheduleMonthDay: task.schedule_month_day ?? undefined,
          scheduleTime: task.schedule_time,
          scheduleWeekday: task.schedule_weekday ?? undefined,
          timezone: task.timezone,
        })
      : null;
  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .update({
      next_run_at: nextRunAt,
      status,
    })
    .eq("id", task.id)
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to update automation task status."
    );
  }

  return data as AutomationTaskRow;
}

export function readTaskId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AutomationHttpError(400, "taskId is required.");
  }

  return value.trim();
}

export function readEventName(value: unknown) {
  const eventName = typeof value === "string" ? value.trim() : "";

  if (!eventName) {
    throw new AutomationHttpError(400, "eventName is required.");
  }

  if (eventName.length > 160) {
    throw new AutomationHttpError(
      400,
      "eventName must be at most 160 characters."
    );
  }

  return eventName;
}

export function readWebhookSlug(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(value.trim())
  ) {
    throw new AutomationHttpError(400, "A valid webhook slug is required.");
  }

  return value.trim();
}

export function readLimit(value: unknown, fallback: number, max = 10) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AutomationHttpError(400, "limit must be an integer.");
  }

  return Math.min(Math.max(value, 1), max);
}

export function rowToTask(row: AutomationTaskRow, running = false): AutomationTask {
  return {
    consecutiveFailures: row.consecutive_failures,
    createdAt: row.created_at,
    displayStatus: running
      ? "Running"
      : row.status === "active"
        ? "Active"
        : row.status === "paused"
          ? "Paused"
          : "Draft",
    eventName: row.event_name ?? undefined,
    failureThreshold: row.failure_threshold,
    id: row.id,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunStatus: row.last_run_status ?? undefined,
    maxRetries: row.max_retries,
    metadata: row.metadata,
    model: row.model ?? undefined,
    name: row.name,
    nextRunAt: row.next_run_at ?? undefined,
    project: row.project,
    prompt: row.prompt ?? undefined,
    scheduleFrequency: row.schedule_frequency ?? undefined,
    scheduleMonthDay: row.schedule_month_day ?? undefined,
    scheduleTime: row.schedule_time,
    scheduleWeekday: row.schedule_weekday ?? undefined,
    status: row.status,
    timezone: row.timezone,
    triggerLabel: buildTriggerLabel({
      eventName: row.event_name ?? undefined,
      scheduleFrequency: row.schedule_frequency ?? undefined,
      scheduleMonthDay: row.schedule_month_day ?? undefined,
      scheduleTime: row.schedule_time,
      scheduleWeekday: row.schedule_weekday ?? undefined,
      triggerType: row.trigger_type,
    }),
    triggerType: row.trigger_type,
    updatedAt: row.updated_at,
    webhookSlug: row.webhook_slug ?? undefined,
  };
}

export function rowToInAppNotification(
  row: AutomationNotificationRow
): AutomationInAppNotification {
  return {
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    metadata: row.metadata,
    readAt: row.read_at ?? undefined,
    runId: row.run_id ?? undefined,
    status: row.status,
    taskId: row.task_id ?? undefined,
    title: row.title,
  };
}
