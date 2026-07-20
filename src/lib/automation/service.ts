import {
  AutomationHttpError,
  computeNextRunAt,
  readAutomationSettingsForContext,
  readAutomationSettingsRow,
  requireAutomationContext,
  requireTelegramLinkedSettings,
  updateTaskStatus,
} from "./service/core";
import {
  createWebhookSlug,
  normalizeSettingsInput,
  normalizeTaskInput,
  readLimit,
  readNotificationId,
  readTaskId,
} from "./service/input";
import { parse0GToNeuron } from "./service/math";
import {
  rowToInAppNotification,
  rowToSettings,
  rowToTask,
} from "./service/mappers";
import {
  readInAppAutomationNotificationsForContext,
  readAutomationRunsForContext,
  readAutomationStats,
  readAutomationTasksForContext,
  readAutomationTaskRow,
  readAutomationTaskRows,
} from "./service/storage";
import type {
  AccountAuthInput,
  AutomationDashboard,
  AutomationNotificationRow,
  AutomationSettingsInput,
  AutomationSettingsRow,
  AutomationTaskInput,
  AutomationTaskRow,
  AutomationTaskStatus,
} from "./service/types";

export { AutomationHttpError, createWebhookSlug };
export {
  createTelegramLinkCode,
  pollTelegramLink,
  processTelegramWebhookUpdate,
  readTelegramCodeFromText,
  requestNotificationEmailLink,
  unlinkNotificationEmail,
  unlinkTelegramLink,
  verifyNotificationEmailLink,
} from "./service/linking";
export {
  runAutomationEvent,
  runAutomationTask,
  runAutomationWebhook,
  runDueAutomationTasks,
} from "./service/runner";

export function automationErrorResponse(error: unknown) {
  if (error instanceof AutomationHttpError) {
    const message =
      error.status < 500 || error.status === 503
        ? error.message
        : "Automation request failed.";

    return Response.json({ error: message }, { status: error.status });
  }

  return Response.json(
    { error: "Automation request failed." },
    { status: 500 }
  );
}

export async function readAutomationDashboard(
  authInput: AccountAuthInput
): Promise<AutomationDashboard> {
  const context = await requireAutomationContext(authInput);
  const [settings, tasks, recentRuns, stats, notifications] = await Promise.all([
    readAutomationSettingsForContext(context),
    readAutomationTasksForContext(context),
    readAutomationRunsForContext(context),
    readAutomationStats(context),
    readInAppAutomationNotificationsForContext(context),
  ]);

  return {
    configured: true,
    notifications,
    recentRuns,
    settings,
    stats,
    tasks,
  };
}

export async function createAutomationTask(
  authInput: AccountAuthInput,
  input: AutomationTaskInput
) {
  const context = await requireAutomationContext(authInput);
  const settings = await readAutomationSettingsForContext(context);
  requireTelegramLinkedSettings(settings);
  const task = normalizeTaskInput(input, {
    requireName: true,
    settings,
  });
  const now = new Date();
  const status = task.status ?? "draft";
  const nextRunAt =
    status === "active" && task.triggerType === "schedule"
      ? computeNextRunAt({
          frequency: task.scheduleFrequency ?? "daily",
          from: now,
          scheduleMonthDay: task.scheduleMonthDay,
          scheduleTime: task.scheduleTime,
          scheduleWeekday: task.scheduleWeekday,
          timezone: task.timezone,
        })
      : null;
  const webhookSlug =
    task.triggerType === "webhook" ? createWebhookSlug(task.name!) : null;

  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .insert({
      event_name: task.eventName,
      failure_threshold: task.failureThreshold,
      max_retries: task.maxRetries,
      metadata: {},
      model: task.model,
      name: task.name!,
      next_run_at: nextRunAt,
      project: task.project,
      prompt: task.prompt,
      schedule_frequency: task.scheduleFrequency,
      schedule_month_day: task.scheduleMonthDay,
      schedule_time: task.scheduleTime,
      schedule_weekday: task.scheduleWeekday,
      status,
      timezone: task.timezone,
      trigger_type: task.triggerType,
      wallet_user_id: context.walletUser.id,
      webhook_slug: webhookSlug,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to create automation task."
    );
  }

  return rowToTask(data as AutomationTaskRow);
}

export async function updateAutomationTask(
  authInput: AccountAuthInput,
  taskId: unknown,
  input: AutomationTaskInput
) {
  const context = await requireAutomationContext(authInput);
  const existing = await readAutomationTaskRow(context, readTaskId(taskId));

  if (existing.status === "archived") {
    throw new AutomationHttpError(404, "Automation task was not found.");
  }

  const settings = await readAutomationSettingsForContext(context);
  const patch = normalizeTaskInput(input, {
    existing,
    requireName: false,
    settings,
  });
  const status = patch.status ?? existing.status;

  if (status === "active") {
    requireTelegramLinkedSettings(settings);
  }

  const triggerType = patch.triggerType ?? existing.trigger_type;
  const scheduleFrequency =
    patch.scheduleFrequency ?? existing.schedule_frequency ?? "daily";
  const scheduleTime = patch.scheduleTime ?? existing.schedule_time;
  const scheduleWeekday =
    patch.scheduleWeekday ?? existing.schedule_weekday ?? undefined;
  const scheduleMonthDay =
    patch.scheduleMonthDay ?? existing.schedule_month_day ?? undefined;
  const timezone = patch.timezone ?? existing.timezone;
  const shouldRecomputeNextRun =
    status === "active" &&
    triggerType === "schedule" &&
    ("status" in input ||
      "triggerType" in input ||
      "scheduleFrequency" in input ||
      "scheduleTime" in input ||
      "scheduleWeekday" in input ||
      "scheduleMonthDay" in input ||
      "timezone" in input);

  const nextRunAt =
    triggerType !== "schedule"
      ? null
      : shouldRecomputeNextRun
        ? computeNextRunAt({
            frequency: scheduleFrequency,
            scheduleMonthDay,
            scheduleTime,
            scheduleWeekday,
            timezone,
          })
        : status === "paused" || status === "draft"
          ? null
          : existing.next_run_at;
  const webhookSlug =
    triggerType === "webhook"
      ? existing.webhook_slug ?? createWebhookSlug(patch.name ?? existing.name)
      : null;

  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .update({
      event_name:
        triggerType === "event" ? patch.eventName ?? existing.event_name : null,
      failure_threshold: patch.failureThreshold ?? existing.failure_threshold,
      max_retries: patch.maxRetries ?? existing.max_retries,
      model: input.model === undefined ? existing.model : patch.model ?? null,
      name: patch.name ?? existing.name,
      next_run_at: nextRunAt,
      project: patch.project ?? existing.project,
      prompt: input.prompt === undefined ? existing.prompt : patch.prompt ?? null,
      schedule_frequency:
        triggerType === "schedule" ? scheduleFrequency : null,
      schedule_month_day:
        triggerType === "schedule" ? scheduleMonthDay ?? null : null,
      schedule_time: scheduleTime,
      schedule_weekday:
        triggerType === "schedule" ? scheduleWeekday ?? null : null,
      status,
      timezone,
      trigger_type: triggerType,
      webhook_slug: webhookSlug,
    })
    .eq("id", existing.id)
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to update automation task."
    );
  }

  return rowToTask(data as AutomationTaskRow);
}

export async function deleteAutomationTask(
  authInput: AccountAuthInput,
  taskId: unknown
) {
  const context = await requireAutomationContext(authInput);
  const id = readTaskId(taskId);
  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .update({ status: "archived", next_run_at: null })
    .eq("id", id)
    .eq("wallet_user_id", context.walletUser.id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  if (!data) {
    throw new AutomationHttpError(404, "Automation task was not found.");
  }

  return { deleted: true };
}

export async function setAllAutomationStatus(
  authInput: AccountAuthInput,
  status: Extract<AutomationTaskStatus, "active" | "paused">
) {
  const context = await requireAutomationContext(authInput);

  if (status === "active") {
    requireTelegramLinkedSettings(await readAutomationSettingsForContext(context));
  }

  const tasks = await readAutomationTaskRows(context);
  const updates = await Promise.all(
    tasks
      .filter((task) => task.status !== "archived")
      .map((task) =>
        updateTaskStatus(context, task, status).catch((error) => {
          throw new AutomationHttpError(
            500,
            error instanceof Error ? error.message : "Unable to update task."
          );
        })
      )
  );

  return updates.map((row) => rowToTask(row));
}

export async function readAutomationSettings(authInput: AccountAuthInput) {
  const context = await requireAutomationContext(authInput);

  return readAutomationSettingsForContext(context);
}

export async function updateAutomationSettings(
  authInput: AccountAuthInput,
  input: AutomationSettingsInput
) {
  const context = await requireAutomationContext(authInput);
  const existing = await readAutomationSettingsRow(context);
  const settings = normalizeSettingsInput(input, rowToSettings(existing));
  const { data, error } = await context.supabase
    .from("langclaw_automation_settings")
    .upsert(
      {
        auto_pause_repeated_failures: settings.autoPauseRepeatedFailures,
        daily_limit_neuron: parse0GToNeuron(settings.dailyLimit0G),
        failure_notification: settings.failureNotification,
        limit_behavior: settings.limitBehavior,
        low_balance_threshold_neuron: parse0GToNeuron(
          settings.lowBalanceThreshold0G
        ),
        monthly_cap_neuron: parse0GToNeuron(settings.monthlyCap0G),
        notification_channels: settings.notificationChannels,
        retry_policy: settings.retryPolicy,
        threshold_action: settings.thresholdAction,
        wallet_user_id: context.walletUser.id,
        write_run_logs_to_memory: settings.writeRunLogsToMemory,
      },
      { onConflict: "wallet_user_id" }
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to update automation settings."
    );
  }

  return rowToSettings(data as AutomationSettingsRow);
}

export async function readAutomationRuns(
  authInput: AccountAuthInput,
  taskId?: unknown
) {
  const context = await requireAutomationContext(authInput);
  const taskFilter = taskId === undefined ? undefined : readTaskId(taskId);

  return readAutomationRunsForContext(context, taskFilter);
}

export async function readInAppAutomationNotifications(
  authInput: AccountAuthInput,
  limitInput?: unknown
) {
  const context = await requireAutomationContext(authInput);

  return readInAppAutomationNotificationsForContext(
    context,
    readLimit(limitInput, 20, 50)
  );
}

export async function markInAppAutomationNotificationRead(
  authInput: AccountAuthInput,
  notificationId: unknown
) {
  const context = await requireAutomationContext(authInput);
  const id = readNotificationId(notificationId);
  const readAt = new Date().toISOString();
  const { data, error } = await context.supabase
    .from("langclaw_automation_notifications")
    .update({
      read_at: readAt,
      status: "read",
    })
    .eq("id", id)
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  if (!data) {
    throw new AutomationHttpError(
      404,
      "Automation notification was not found."
    );
  }

  return rowToInAppNotification(data as AutomationNotificationRow);
}

export async function markAllInAppAutomationNotificationsRead(
  authInput: AccountAuthInput
) {
  const context = await requireAutomationContext(authInput);
  const readAt = new Date().toISOString();
  const { error } = await context.supabase
    .from("langclaw_automation_notifications")
    .update({
      read_at: readAt,
      status: "read",
    })
    .eq("wallet_user_id", context.walletUser.id)
    .eq("status", "unread");

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return { read: true };
}
