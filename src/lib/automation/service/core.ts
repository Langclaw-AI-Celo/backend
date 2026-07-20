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
  AutomationSettings,
  AutomationSettingsRow,
} from "./types";

export {
  AccountAuthError,
  buildAlphaSignalNotificationMessage,
  buildAutomationNotificationMessage,
  buildTriggerLabel,
  computeNextRunAt,
  createHash,
  getZonedParts,
  randomBytes,
  randomInt,
  readAlphaSignalFromPayload,
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
