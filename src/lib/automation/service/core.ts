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
