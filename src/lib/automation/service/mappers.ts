import {
  buildTriggerLabel,
  formatNeuronAs0G,
  maskEmail,
  readDecimalString,
} from "./core";
import type {
  AutomationInAppNotification,
  AutomationNotificationRow,
  AutomationRun,
  AutomationRunRow,
  AutomationSettings,
  AutomationSettingsRow,
  AutomationTask,
  AutomationTaskRow,
} from "./types";

export { rowToSettings } from "./core";

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
