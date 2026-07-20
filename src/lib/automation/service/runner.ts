import {
  AutomationHttpError,
  buildAlphaSignalNotificationMessage,
  buildAutomationNotificationMessage,
  computeNextRunAt,
  createAutomationContextForWalletUser,
  readAlphaSignalFromPayload,
  readAutomationSettingsRow,
  readAutomationTaskRow,
  readDecimalString,
  readEventName,
  readLimit,
  readMaxAttempts,
  readTaskId,
  readUsageAccount,
  readUsageTotalSince,
  readWebhookSlug,
  refundResearchUsage,
  requireAutomationContext,
  requireAutomationSupabaseAdmin,
  reserveResearchUsage,
  rowToRun,
  rowToSettings,
  runLangclawWorkflow,
  sendAlphaSignalNotification,
  sendAutomationRunNotification,
  settleResearchUsage,
  startOfLocalDay,
  startOfLocalMonth,
  updateTaskStatus,
  withAlphaSignalNotification,
  writeAutomationRunMemory,
} from "./core";
import type {
  AccountAuthInput,
  AutomationContext,
  AutomationRun,
  AutomationRunRow,
  AutomationRunStatus,
  AutomationSettings,
  AutomationTaskRow,
  AutomationTriggeredBy,
  GuardrailDecision,
  Json,
  OnChainToolFinalPayload,
  ResearchReport,
  UsageReservation,
  ZeroGProof,
} from "./types";

export async function runAutomationTask(
  authInput: AccountAuthInput,
  taskId: unknown,
  triggeredBy: AutomationTriggeredBy = "manual"
) {
  const context = await requireAutomationContext(authInput);
  const task = await readAutomationTaskRow(context, readTaskId(taskId));

  if (task.status === "archived") {
    throw new AutomationHttpError(404, "Automation task was not found.");
  }

  return runTaskRow(context, task, triggeredBy);
}

export async function runAutomationEvent(
  authInput: AccountAuthInput,
  eventNameInput: unknown,
  payload?: unknown,
  limitInput?: unknown
) {
  const context = await requireAutomationContext(authInput);
  const eventName = readEventName(eventNameInput);
  const limit = readLimit(limitInput, 10);
  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .eq("status", "active")
    .eq("trigger_type", "event")
    .eq("event_name", eventName)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  const runs = [];

  for (const task of (data ?? []) as AutomationTaskRow[]) {
    runs.push(await runTaskRow(context, task, "event", payload));
  }

  return runs;
}

export async function runAutomationWebhook(slugInput: unknown, payload?: unknown) {
  const slug = readWebhookSlug(slugInput);
  const supabase = requireAutomationSupabaseAdmin();
  const { data, error } = await supabase
    .from("langclaw_automation_tasks")
    .select("*")
    .eq("webhook_slug", slug)
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  if (!data) {
    throw new AutomationHttpError(404, "Automation webhook was not found.");
  }

  const task = data as AutomationTaskRow;

  if (task.status !== "active" || task.trigger_type !== "webhook") {
    throw new AutomationHttpError(409, "Automation webhook is not active.");
  }

  const context = await createAutomationContextForWalletUser(
    supabase,
    task.wallet_user_id
  );

  return runTaskRow(context, task, "webhook", payload);
}

export async function runDueAutomationTasks(
  authInput: AccountAuthInput,
  limitInput?: unknown
) {
  const context = await requireAutomationContext(authInput);
  const limit = readLimit(limitInput, 3);
  const now = new Date().toISOString();
  const { data, error } = await context.supabase
    .from("langclaw_automation_tasks")
    .select("*")
    .eq("wallet_user_id", context.walletUser.id)
    .eq("status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  const runs = [];

  for (const task of (data ?? []) as AutomationTaskRow[]) {
    runs.push(await runTaskRow(context, task, "schedule"));
  }

  return runs;
}

async function runTaskRow(
  context: AutomationContext,
  task: AutomationTaskRow,
  triggeredBy: AutomationTriggeredBy,
  triggerPayload?: unknown
) {
  const startedAt = new Date();
  const run = await createRun(context, task, startedAt, triggeredBy);

  try {
    const guardrail = await readGuardrailDecision(context, task);

    if (!guardrail.allowed) {
      if (guardrail.pauseTask) {
        await updateTaskStatus(context, task, "paused");
      }

      return finishRun(context, task, run, {
        error: guardrail.reason,
        result: {
          guardrail: guardrail.reason,
        },
        status: "skipped",
      });
    }

    return runTaskWithRetries(context, task, run, triggerPayload);
  } catch (error) {
    return finishRun(context, task, run, {
      error:
        error instanceof Error ? error.message : "Automation run failed.",
      status: "failed",
    });
  }
}

async function runTaskWithRetries(
  context: AutomationContext,
  task: AutomationTaskRow,
  run: AutomationRunRow,
  triggerPayload?: unknown
) {
  const maxAttempts = readMaxAttempts(task.max_retries);
  const prompt = buildTaskPrompt(task, triggerPayload);
  const attemptErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let reservation: UsageReservation | undefined;

    try {
      reservation = await reserveResearchUsage(
        { account: context },
        {
          model: task.model ?? undefined,
        }
      );
      const payload = await runLangclawWorkflow(prompt, {
        requestedModel: task.model ?? undefined,
      });
      const proof = payload.proof ?? payload.zeroG;
      payload.usage = await settleResearchUsage({
        computeStatus: proof?.compute?.status,
        reservation,
        providerTrace: proof?.compute
          ? {
              billing: proof.compute.billing,
              provider: proof.compute.provider,
              requestId: proof.compute.requestId,
              teeVerified: proof.compute.teeVerified,
            }
          : undefined,
        tokenUsage: proof?.compute?.usage,
        topic: prompt,
      });
      const alphaSignal = readAlphaSignalFromPayload(payload);

      if (alphaSignal) {
        const settings = await readAutomationSettingsRow(context);
        const notification = await sendAlphaSignalNotification({
          alphaSignal,
          onChain: payload.onChain,
          project: task.project,
          proof: proof as ZeroGProof | undefined,
          report: payload.report,
          runId: run.id,
          settings: rowToSettings(settings),
          taskName: task.name,
        });

        payload.alphaSignal = withAlphaSignalNotification(
          alphaSignal,
          notification
        );
      }

      return finishRun(context, task, run, {
        result: withAutomationAttemptMetadata(
          payload as unknown as Json,
          attempt,
          maxAttempts
        ),
        status: "completed",
        usage: (payload.usage ?? null) as unknown as Json,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Automation run failed.";
      attemptErrors.push(message);

      if (reservation) {
        await refundResearchUsage(reservation, message).catch(() => undefined);
      }

      if (attempt === maxAttempts) {
        return finishRun(context, task, run, {
          error: message,
          result: {
            attempts: attemptErrors.map((attemptError, index) => ({
              attempt: index + 1,
              error: attemptError,
            })),
          },
          status: "failed",
        });
      }
    }
  }

  return finishRun(context, task, run, {
    error: "Automation run failed.",
    status: "failed",
  });
}

async function finishRun(
  context: AutomationContext,
  task: AutomationTaskRow,
  run: AutomationRunRow,
  {
    error,
    result,
    status,
    usage,
  }: {
    error?: string;
    result?: Json;
    status: AutomationRunStatus;
    usage?: Json;
  }
) {
  const settings = await readAutomationSettingsRow(context);
  const completedAt = new Date();
  const durationMs = Math.max(
    completedAt.getTime() - new Date(run.started_at || run.created_at).getTime(),
    0
  );
  const consecutiveFailures =
    status === "failed" ? task.consecutive_failures + 1 : 0;
  const shouldAutoPause =
    status === "failed" &&
    settings.auto_pause_repeated_failures &&
    consecutiveFailures >= task.failure_threshold &&
    task.status === "active";
  const nextRunAt =
    task.status === "active" &&
    !shouldAutoPause &&
    task.trigger_type === "schedule" &&
    task.schedule_frequency
      ? computeNextRunAt({
          frequency: task.schedule_frequency,
          from: completedAt,
          scheduleMonthDay: task.schedule_month_day ?? undefined,
          scheduleTime: task.schedule_time,
          scheduleWeekday: task.schedule_weekday ?? undefined,
          timezone: task.timezone,
        })
      : null;

  const { data, error: updateError } = await context.supabase
    .from("langclaw_automation_runs")
    .update({
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
      error: error ?? null,
      result: result ?? null,
      status,
      usage: usage ?? null,
    })
    .eq("id", run.id)
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .single();

  if (updateError || !data) {
    throw new AutomationHttpError(
      500,
      updateError?.message || "Unable to finish automation run."
    );
  }

  await context.supabase
    .from("langclaw_automation_tasks")
    .update({
      consecutive_failures: consecutiveFailures,
      last_run_at: completedAt.toISOString(),
      last_run_status: status,
      next_run_at: nextRunAt,
      status: shouldAutoPause ? "paused" : task.status,
    })
    .eq("id", task.id)
    .eq("wallet_user_id", context.walletUser.id);

  const finishedRun = rowToRun(data as AutomationRunRow, task.name);

  if (settings.write_run_logs_to_memory) {
    await writeAutomationRunMemory(context, {
      completedAt: completedAt.toISOString(),
      error,
      project: task.project,
      runId: finishedRun.id,
      status,
      taskName: task.name,
    }).catch(() => undefined);
  }

  if (status === "failed" || status === "skipped") {
    const notification = {
      completedAt: finishedRun.completedAt,
      durationMs: finishedRun.durationMs,
      error,
      project: task.project,
      runId: finishedRun.id,
      settings: rowToSettings(settings),
      status,
      taskName: task.name,
      triggeredBy: finishedRun.triggeredBy,
    };

    await writeInAppAutomationNotification(context, task, finishedRun, notification)
      .catch(() => undefined);
    await sendAutomationRunNotification(notification).catch(() => undefined);
  }

  if (status === "completed") {
    const alphaSignal = readAlphaSignalFromPayload(result);

    if (
      alphaSignal?.alertEligible &&
      alphaSignal.notification?.status === "sent" &&
      rowToSettings(settings).notificationChannels.includes("in-app")
    ) {
      const message = buildAlphaSignalNotificationMessage({
        alphaSignal,
        completedAt: finishedRun.completedAt,
        onChain: readOnChainFromAutomationResult(result),
        project: task.project,
        proof: readProofFromAutomationResult(result),
        report: readReportFromAutomationResult(result),
        runId: finishedRun.id,
        taskName: task.name,
      });

      await writeInAppAlphaSignalNotification(
        context,
        task,
        finishedRun,
        message,
        alphaSignal
      ).catch(() => undefined);
    }
  }

  return finishedRun;
}

async function writeInAppAutomationNotification(
  context: AutomationContext,
  task: AutomationTaskRow,
  run: AutomationRun,
  notification: {
    completedAt?: string;
    durationMs?: number;
    error?: string;
    project: string;
    runId: string;
    settings: AutomationSettings;
    status: AutomationRunStatus;
    taskName: string;
    triggeredBy: AutomationTriggeredBy;
  }
) {
  if (!shouldWriteInAppNotification(notification.settings)) {
    return;
  }

  const message = buildAutomationNotificationMessage(notification);
  const { error } = await context.supabase
    .from("langclaw_automation_notifications")
    .insert({
      body: message.text,
      metadata: {
        error: notification.error ?? null,
        project: notification.project,
        status: notification.status,
        triggeredBy: notification.triggeredBy,
      },
      run_id: run.id,
      task_id: task.id,
      title: message.subject,
      wallet_user_id: context.walletUser.id,
    });

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }
}

function shouldWriteInAppNotification(settings: AutomationSettings) {
  if (settings.failureNotification === "none") {
    return false;
  }

  return (
    settings.failureNotification === "in-app" ||
    settings.notificationChannels.includes("in-app")
  );
}

async function writeInAppAlphaSignalNotification(
  context: AutomationContext,
  task: AutomationTaskRow,
  run: AutomationRun,
  message: {
    subject: string;
    text: string;
  },
  alphaSignal: ReturnType<typeof readAlphaSignalFromPayload>
) {
  if (!alphaSignal) {
    return;
  }

  const { error } = await context.supabase
    .from("langclaw_automation_notifications")
    .insert({
      body: message.text,
      metadata: {
        falsePositiveChecks: alphaSignal.quality.falsePositiveChecks,
        label: alphaSignal.quality.label,
        score: alphaSignal.quality.score,
        signalType: alphaSignal.signalType,
        type: "alpha_signal",
      },
      run_id: run.id,
      task_id: task.id,
      title: message.subject,
      wallet_user_id: context.walletUser.id,
    });

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }
}

function readProofFromAutomationResult(result?: Json): ZeroGProof | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }

  const record = result as Record<string, unknown>;
  const proof = record.proof ?? record.zeroG;

  if (!proof || typeof proof !== "object") {
    return undefined;
  }

  return proof as ZeroGProof;
}

function readReportFromAutomationResult(result?: Json): ResearchReport | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }

  const report = (result as Record<string, unknown>).report;

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return undefined;
  }

  return report as ResearchReport;
}

function readOnChainFromAutomationResult(
  result?: Json
): OnChainToolFinalPayload | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }

  const onChain = (result as Record<string, unknown>).onChain;

  if (!onChain || typeof onChain !== "object" || Array.isArray(onChain)) {
    return undefined;
  }

  return onChain as OnChainToolFinalPayload;
}

async function createRun(
  context: AutomationContext,
  task: AutomationTaskRow,
  startedAt: Date,
  triggeredBy: AutomationTriggeredBy
) {
  const { data, error } = await context.supabase
    .from("langclaw_automation_runs")
    .insert({
      attempt: task.consecutive_failures + 1,
      scheduled_for: task.next_run_at,
      started_at: startedAt.toISOString(),
      status: "running",
      task_id: task.id,
      triggered_by: triggeredBy,
      wallet_user_id: context.walletUser.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to start automation run."
    );
  }

  return data as AutomationRunRow;
}

async function readGuardrailDecision(
  context: AutomationContext,
  task: AutomationTaskRow
): Promise<GuardrailDecision> {
  const settings = await readAutomationSettingsRow(context);
  const account = await readUsageAccount(context);
  const now = new Date();

  if (!settings.telegram_verified || !settings.telegram_chat_id?.trim()) {
    return {
      allowed: false,
      pauseTask: false,
      reason: "Telegram connection is required.",
    };
  }

  const dailyTotal = await readUsageTotalSince(
    context,
    startOfLocalDay(now, task.timezone)
  );
  const monthlyTotal = await readUsageTotalSince(
    context,
    startOfLocalMonth(now, task.timezone)
  );

  if (
    settings.limit_behavior !== "allow" &&
    BigInt(dailyTotal) >= BigInt(readDecimalString(settings.daily_limit_neuron))
  ) {
    if (settings.limit_behavior === "alert") {
      return {
        allowed: true,
        note: "Daily automation MNT limit reached.",
      };
    }

    return {
      allowed: false,
      pauseTask: true,
      reason: "Daily automation MNT limit reached.",
    };
  }

  if (
    settings.limit_behavior !== "allow" &&
    BigInt(monthlyTotal) >= BigInt(readDecimalString(settings.monthly_cap_neuron))
  ) {
    if (settings.limit_behavior === "alert") {
      return {
        allowed: true,
        note: "Monthly automation MNT cap reached.",
      };
    }

    return {
      allowed: false,
      pauseTask: true,
      reason: "Monthly automation MNT cap reached.",
    };
  }

  if (
    account &&
    settings.threshold_action === "pause" &&
    BigInt(readDecimalString(account.available_neuron)) <
      BigInt(readDecimalString(settings.low_balance_threshold_neuron))
  ) {
    return {
      allowed: false,
      pauseTask: true,
      reason: "MNT balance is below the automation threshold.",
    };
  }

  return { allowed: true };
}

function buildTaskPrompt(task: AutomationTaskRow, triggerPayload?: unknown) {
  const basePrompt = task.prompt || task.name;

  if (triggerPayload === undefined) {
    return basePrompt;
  }

  return [
    basePrompt,
    "",
    "Trigger payload:",
    stringifyTriggerPayload(triggerPayload),
  ].join("\n");
}

function stringifyTriggerPayload(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2).slice(0, 4000);
  } catch {
    return String(payload).slice(0, 4000);
  }
}

function withAutomationAttemptMetadata(
  result: Json,
  attempt: number,
  maxAttempts: number
): Json {
  const automation = { attempt, maxAttempts };

  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...result,
      automation,
    };
  }

  return {
    automation,
    result,
  };
}

