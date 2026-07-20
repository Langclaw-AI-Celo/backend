import {
  AutomationHttpError,
  readDecimalString,
  rowToInAppNotification,
  rowToRun,
  rowToTask,
} from "./core";
import type {
  AutomationContext,
  AutomationInAppNotification,
  AutomationNotificationRow,
  AutomationRunRow,
  AutomationStats,
  AutomationTaskRow,
} from "./types";

export {
  createAutomationContextForWalletUser,
  readAutomationTaskRow,
  readUsageAccount,
  readUsageTotalSince,
} from "./core";

export async function readAutomationTaskRows(context: AutomationContext) {
  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return (data ?? []) as AutomationTaskRow[];
}


export async function readAutomationStats(context: AutomationContext): Promise<AutomationStats> {
  const [tasks, runningTaskIds, recentRuns] = await Promise.all([
    readAutomationTaskRows(context),
    readRunningTaskIds(context),
    readRecentRunRows(context, 250),
  ]);
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const runsLast30Days = recentRuns.filter(
    (run) => new Date(run.created_at).getTime() >= thirtyDaysAgo
  );
  const completedRuns = runsLast30Days.filter(
    (run) => run.status === "completed"
  ).length;
  const measuredRuns = runsLast30Days.filter(
    (run) => run.status === "completed" || run.status === "failed"
  ).length;
  const activeTasks = tasks.filter((task) => task.status === "active");
  const nextTask = activeTasks
    .filter((task) => task.next_run_at)
    .sort((left, right) =>
      String(left.next_run_at).localeCompare(String(right.next_run_at))
    )[0];

  return {
    activeTasks: activeTasks.length,
    completedThisWeek: recentRuns.filter(
      (run) =>
        run.status === "completed" &&
        new Date(run.created_at).getTime() >= weekAgo
    ).length,
    eventTasks: activeTasks.filter((task) => task.trigger_type !== "schedule")
      .length,
    nextRunAt: nextTask?.next_run_at ?? undefined,
    nextRunTaskName: nextTask?.name,
    pendingRuns: recentRuns.filter((run) => run.status === "queued").length,
    runningNow: runningTaskIds.size,
    scheduledTasks: activeTasks.filter((task) => task.trigger_type === "schedule")
      .length,
    successRate: measuredRuns ? Math.round((completedRuns / measuredRuns) * 1000) / 10 : 0,
  };
}

export async function readRecentRunRows(context: AutomationContext, limit: number) {
  const { data, error } = await context.supabase
    .from("langclaw_automation_runs")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return (data ?? []) as AutomationRunRow[];
}

export async function readRunningTaskIds(context: AutomationContext) {
  const { data, error } = await context.supabase
    .from("langclaw_automation_runs")
    .select("task_id")
    .eq("wallet_user_id", context.walletUser.id)
    .eq("status", "running");

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return new Set((data ?? []).map((row) => row.task_id));
}

export async function readAutomationTasksForContext(context: AutomationContext) {
  const rows = await readAutomationTaskRows(context);
  const runningTaskIds = await readRunningTaskIds(context);

  return rows.map((row) => rowToTask(row, runningTaskIds.has(row.id)));
}

export async function readAutomationRunsForContext(
  context: AutomationContext,
  taskId?: string
) {
  let query = context.supabase
    .from("langclaw_automation_runs")
    .select(
      "*,langclaw_automation_tasks!inner(name)"
    )
    .eq("wallet_user_id", context.walletUser.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (taskId) {
    query = query.eq("task_id", taskId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return ((data ?? []) as Array<AutomationRunRow & {
    langclaw_automation_tasks?: { name?: string } | null;
  }>).map((row) =>
    rowToRun(row, row.langclaw_automation_tasks?.name)
  );
}

export async function readInAppAutomationNotificationsForContext(
  context: AutomationContext,
  limit = 20
): Promise<AutomationInAppNotification[]> {
  const { data, error } = await context.supabase
    .from("langclaw_automation_notifications")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return ((data ?? []) as AutomationNotificationRow[]).map(
    rowToInAppNotification
  );
}
