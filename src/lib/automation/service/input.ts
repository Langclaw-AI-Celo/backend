import {
  AutomationHttpError,
  defaultTimezone,
  getZonedParts,
  randomBytes,
  read0GAmount,
  readEventName,
  readLimit,
  readOptionalString,
  readTaskId,
  readWebhookSlug,
} from "./core";
import type {
  AutomationFrequency,
  AutomationSettings,
  AutomationSettingsInput,
  AutomationTaskInput,
  AutomationTaskRow,
  AutomationTaskStatus,
  AutomationTriggerType,
} from "./types";

export { readEventName, readLimit, readTaskId, readWebhookSlug } from "./core";

export function normalizeTaskInput(
  input: AutomationTaskInput,
  {
    existing,
    requireName,
    settings,
  }: {
    existing?: AutomationTaskRow;
    requireName: boolean;
    settings: AutomationSettings;
  }
) {
  const name = readOptionalInputString(input.name, 120, "name");

  if ((requireName || input.name !== undefined) && !name) {
    throw new AutomationHttpError(400, "Task name is required.");
  }

  const project = readOptionalInputString(input.project, 120, "project");

  if (input.project !== undefined && !project) {
    throw new AutomationHttpError(400, "Project is required.");
  }

  const triggerType = readInputEnum<AutomationTriggerType>(
    input.triggerType,
    ["schedule", "event", "webhook"],
    existing?.trigger_type ?? "schedule",
    "triggerType"
  );
  const scheduleFrequency =
    triggerType === "schedule"
      ? readInputEnum<AutomationFrequency>(
          input.scheduleFrequency,
          ["daily", "weekly", "monthly"],
          existing?.schedule_frequency ?? "daily",
          "scheduleFrequency"
        )
      : undefined;
  const scheduleTime = readScheduleTime(
    input.scheduleTime,
    existing?.schedule_time ?? "09:00"
  );
  const timezone = readTimezone(
    input.timezone,
    existing?.timezone || defaultTimezone
  );
  const nowParts = getZonedParts(new Date(), timezone);
  const eventName =
    triggerType === "event"
      ? readEventName(input.eventName ?? existing?.event_name)
      : readOptionalInputString(input.eventName, 160, "eventName");

  return {
    eventName,
    failureThreshold: existing?.failure_threshold ?? 5,
    maxRetries:
      existing?.max_retries ??
      (settings.retryPolicy === "5-attempts"
        ? 5
        : settings.retryPolicy === "none"
          ? 0
          : 3),
    model: readOptionalInputString(input.model, 120, "model"),
    name,
    project: project ?? existing?.project ?? "Langclaw Website",
    prompt: readOptionalInputString(input.prompt, 2000, "prompt"),
    scheduleFrequency,
    scheduleMonthDay:
      triggerType === "schedule"
        ? readInteger(
            input.scheduleMonthDay,
            existing?.schedule_month_day ?? nowParts.day,
            1,
            31,
            "scheduleMonthDay"
          )
        : undefined,
    scheduleTime,
    scheduleWeekday:
      triggerType === "schedule"
        ? readInteger(
            input.scheduleWeekday,
            existing?.schedule_weekday ?? nowParts.weekday,
            0,
            6,
            "scheduleWeekday"
          )
        : undefined,
    status:
      input.status === undefined
        ? existing?.status
        : readInputEnum<AutomationTaskStatus>(
            input.status,
            ["draft", "active", "paused"],
            existing?.status ?? "draft",
            "status"
          ),
    timezone,
    triggerType,
  };
}

export function normalizeSettingsInput(
  input: AutomationSettingsInput,
  current?: AutomationSettings
): AutomationSettings {

  return {
    autoPauseRepeatedFailures: readSettingsBoolean(
      input.autoPauseRepeatedFailures,
      current?.autoPauseRepeatedFailures ?? true,
      "autoPauseRepeatedFailures"
    ),
    dailyLimit0G: read0GAmount(
      input.dailyLimit0G,
      current?.dailyLimit0G ?? "25",
      "dailyLimit0G"
    ),
    failureNotification: readInputEnum(
      input.failureNotification,
      ["email", "in-app", "none"],
      current?.failureNotification ?? "email",
      "failureNotification"
    ),
    limitBehavior: readInputEnum(
      input.limitBehavior,
      ["pause", "alert", "allow"],
      current?.limitBehavior ?? "pause",
      "limitBehavior"
    ),
    lowBalanceThreshold0G: read0GAmount(
      input.lowBalanceThreshold0G,
      current?.lowBalanceThreshold0G ?? "10",
      "lowBalanceThreshold0G"
    ),
    monthlyCap0G: read0GAmount(
      input.monthlyCap0G,
      current?.monthlyCap0G ?? "500",
      "monthlyCap0G"
    ),
    notificationChannels: readNotificationChannels(
      input.notificationChannels,
      current?.notificationChannels
    ),
    notificationEmail:
      input.notificationEmail === undefined
        ? current?.notificationEmail
        : readOptionalString(input.notificationEmail, 320),
    notificationEmailVerified: current?.notificationEmailVerified ?? false,
    retryPolicy: readInputEnum(
      input.retryPolicy,
      ["none", "3-attempts", "5-attempts"],
      current?.retryPolicy ?? "3-attempts",
      "retryPolicy"
    ),
    telegramChatId:
      input.telegramChatId === undefined
        ? current?.telegramChatId
        : readOptionalString(input.telegramChatId, 120),
    telegramVerified: current?.telegramVerified ?? false,
    thresholdAction: readInputEnum(
      input.thresholdAction,
      ["notify", "pause", "continue"],
      current?.thresholdAction ?? "notify",
      "thresholdAction"
    ),
    writeRunLogsToMemory: readSettingsBoolean(
      input.writeRunLogsToMemory,
      current?.writeRunLogsToMemory ?? false,
      "writeRunLogsToMemory"
    ),
  };
}


export function readNotificationId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AutomationHttpError(400, "notificationId is required.");
  }

  return value.trim();
}





export function readOptionalInputString(
  value: unknown,
  maxLength: number,
  field: string
) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new AutomationHttpError(400, `${field} must be a string.`);
  }

  return readOptionalString(value, maxLength);
}

export function readScheduleTime(value: unknown, fallback: string) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "string" && /^[0-2][0-9]:[0-5][0-9]$/.test(value)) {
    const [hour] = value.split(":").map(Number);

    if (hour <= 23) {
      return value;
    }
  }

  throw new AutomationHttpError(
    400,
    "scheduleTime must use 24-hour HH:MM format."
  );
}

export function readTimezone(value: unknown, fallback: string) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "string") {
    const timezone = value.trim();

    if (timezone && timezone.length <= 80) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
        return timezone;
      } catch {
        // The common validation error below keeps the API response stable.
      }
    }
  }

  throw new AutomationHttpError(
    400,
    "timezone must be a valid IANA time zone."
  );
}

export function readInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string
) {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new AutomationHttpError(
      400,
      `${field} must be an integer between ${min} and ${max}.`
    );
  }

  return value;
}

export function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback?: T
) {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }

  return fallback;
}

export function readInputEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string
) {
  if (value === undefined) {
    return fallback;
  }

  const result = readEnum(value, allowed);

  if (!result) {
    throw new AutomationHttpError(
      400,
      `${field} must be one of: ${allowed.join(", ")}.`
    );
  }

  return result;
}

export function readSettingsBoolean(
  value: unknown,
  fallback: boolean,
  field: string
) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new AutomationHttpError(400, `${field} must be a boolean.`);
  }

  return value;
}

export function readNotificationChannels(
  value: unknown,
  fallback: Array<"email" | "telegram" | "in-app"> = ["email"]
): Array<"email" | "telegram" | "in-app"> {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Array.isArray(value) ||
    !value.every(
      (item) => item === "email" || item === "telegram" || item === "in-app"
    )
  ) {
    throw new AutomationHttpError(
      400,
      "notificationChannels must contain only email, telegram, or in-app."
    );
  }

  const channels = value as Array<"email" | "telegram" | "in-app">;

  return channels.length
    ? Array.from(new Set(channels))
    : ["email"];
}



export function createWebhookSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `${slug || "task"}-${randomBytes(16).toString("hex")}`;
}
