import assert from "node:assert/strict";
import test from "node:test";

import { mockFetch, withEnv } from "../../test/helpers";
import {
  AutomationHttpError,
  automationErrorResponse,
  createAutomationTask,
  createTelegramLinkCode,
  createWebhookSlug,
  deleteAutomationTask,
  markAllInAppAutomationNotificationsRead,
  markInAppAutomationNotificationRead,
  pollTelegramLink,
  readAutomationDashboard,
  readAutomationRuns,
  readAutomationSettings,
  readInAppAutomationNotifications,
  readTelegramCodeFromText,
  requestNotificationEmailLink,
  runAutomationTask,
  runAutomationEvent,
  runAutomationWebhook,
  setAllAutomationStatus,
  unlinkNotificationEmail,
  unlinkTelegramLink,
  updateAutomationSettings,
  updateAutomationTask,
  verifyNotificationEmailLink,
} from "./service";

const walletUser = {
  id: "wallet-user-1",
  walletAddress: "0x1111111111111111111111111111111111111111",
};

test("automation webhook slugs use a 128-bit random suffix", () => {
  const first = createWebhookSlug("Daily Usage Digest");
  const second = createWebhookSlug("Daily Usage Digest");

  assert.match(first, /^daily-usage-digest-[a-f0-9]{32}$/);
  assert.match(second, /^daily-usage-digest-[a-f0-9]{32}$/);
  assert.notEqual(first, second);
});

test("Telegram link parser accepts link, start, and bare codes", () => {
  assert.equal(readTelegramCodeFromText("/link 9A3A093A29"), "9A3A093A29");
  assert.equal(readTelegramCodeFromText("/start 9A3A093A29"), "9A3A093A29");
  assert.equal(readTelegramCodeFromText("9a3a093a29"), "9A3A093A29");
});

test("automation task status transitions update schedule state", async () => {
  const paused = buildAutomationStorage("active");
  const pausedTask = await updateAutomationTask(
    buildAccount(paused.supabase),
    "task-1",
    { status: "paused" },
  );

  assert.equal(pausedTask.status, "paused");
  assert.equal(paused.updated?.status, "paused");
  assert.equal(paused.updated?.next_run_at, null);

  const active = buildAutomationStorage("paused");
  const activeTask = await updateAutomationTask(
    buildAccount(active.supabase),
    "task-1",
    { status: "active" },
  );

  assert.equal(activeTask.status, "active");
  assert.equal(active.updated?.status, "active");
  assert.match(String(active.updated?.next_run_at), /^\d{4}-\d{2}-\d{2}T/);
});

test("automation error responses preserve safe HTTP status and messages", async () => {
  const invalid = automationErrorResponse(
    new AutomationHttpError(400, "Invalid automation input.")
  );
  const storage = automationErrorResponse(
    new AutomationHttpError(500, "duplicate key value exposes table name"),
  );
  const failed = automationErrorResponse(new Error("Storage unavailable."));
  const unknown = automationErrorResponse("unexpected");

  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid automation input." });
  assert.equal(storage.status, 500);
  assert.deepEqual(await storage.json(), {
    error: "Automation request failed.",
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Automation request failed." });
  assert.deepEqual(await unknown.json(), {
    error: "Automation request failed.",
  });
});

test("automation task inputs reject missing identifiers and required fields", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);

  await assert.rejects(
    updateAutomationTask(account, " ", { status: "paused" }),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      /taskId/.test(error.message)
  );
  await assert.rejects(
    deleteAutomationTask(account, null),
    (error: unknown) =>
      error instanceof AutomationHttpError && error.status === 400
  );
  await assert.rejects(
    createAutomationTask(account, { name: "   " }),
    (error: unknown) =>
      error instanceof AutomationHttpError && /Task name/.test(error.message)
  );
  await assert.rejects(
    createAutomationTask(account, {
      name: "Event task",
      triggerType: "event",
    }),
    (error: unknown) =>
      error instanceof AutomationHttpError && /eventName/.test(error.message)
  );
});

test("automation tasks reject unsupported trigger types", async () => {
  const storage = buildAutomationStorage("active");

  await assert.rejects(
    createAutomationTask(buildAccount(storage.supabase), {
      name: "Invalid trigger",
      triggerType: "interval",
    }),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      error.message === "triggerType must be one of: schedule, event, webhook.",
  );
});

test("scheduled tasks reject unsupported frequencies", async () => {
  const storage = buildAutomationStorage("active");

  await assert.rejects(
    createAutomationTask(buildAccount(storage.supabase), {
      name: "Invalid frequency",
      scheduleFrequency: "hourly",
      triggerType: "schedule",
    }),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      error.message === "scheduleFrequency must be one of: daily, weekly, monthly.",
  );
});

test("scheduled tasks reject invalid schedule times", async () => {
  for (const scheduleTime of ["24:00", "8:30", 930]) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      createAutomationTask(buildAccount(storage.supabase), {
        name: "Invalid time",
        scheduleTime,
        triggerType: "schedule",
      }),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message === "scheduleTime must use 24-hour HH:MM format.",
    );
  }
});

test("scheduled tasks reject invalid calendar positions", async () => {
  const cases = [
    ["scheduleMonthDay", 32, "scheduleMonthDay must be an integer between 1 and 31."],
    ["scheduleMonthDay", 1.5, "scheduleMonthDay must be an integer between 1 and 31."],
    ["scheduleWeekday", 7, "scheduleWeekday must be an integer between 0 and 6."],
    ["scheduleWeekday", -1, "scheduleWeekday must be an integer between 0 and 6."],
  ] as const;

  for (const [field, value, message] of cases) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      createAutomationTask(buildAccount(storage.supabase), {
        name: "Invalid calendar position",
        [field]: value,
        triggerType: "schedule",
      }),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message === message,
    );
  }
});

test("automation link and trigger inputs reject malformed values", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);

  await assert.rejects(
    requestNotificationEmailLink(account, "not-an-email"),
    (error: unknown) =>
      error instanceof AutomationHttpError && /valid email/.test(error.message)
  );
  await assert.rejects(
    verifyNotificationEmailLink(account, "!"),
    (error: unknown) =>
      error instanceof AutomationHttpError && /valid link code/.test(error.message)
  );
  await assert.rejects(
    runAutomationEvent(account, " "),
    (error: unknown) =>
      error instanceof AutomationHttpError && /eventName/.test(error.message)
  );
  await assert.rejects(
    runAutomationWebhook("not/a/slug"),
    (error: unknown) =>
      error instanceof AutomationHttpError && /valid webhook slug/.test(error.message)
  );

  assert.equal(readTelegramCodeFromText("hello"), "");
  assert.equal(readTelegramCodeFromText("/link short"), "");
});

test("creates and archives an automation webhook task", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);
  const task = await createAutomationTask(account, {
    name: "Celo webhook watcher",
    prompt: "Review the webhook payload",
    status: "active",
    triggerType: "webhook",
  });

  assert.equal(task.name, "Celo webhook watcher");
  assert.equal(task.status, "active");
  assert.equal(task.triggerType, "webhook");
  assert.match(task.webhookSlug ?? "", /^celo-webhook-watcher-[a-f0-9]{32}$/);
  assert.equal(storage.inserted?.wallet_user_id, walletUser.id);
  assert.equal(storage.inserted?.next_run_at, null);

  assert.deepEqual(await deleteAutomationTask(account, task.id), {
    deleted: true,
  });
  assert.equal(storage.updated?.status, "archived");
  assert.equal(storage.updated?.next_run_at, null);
});

test("bulk status changes update every non-archived task", async () => {
  const active = buildAutomationStorage("active");
  const pausedTasks = await setAllAutomationStatus(
    buildAccount(active.supabase),
    "paused"
  );

  assert.equal(pausedTasks.length, 1);
  assert.equal(pausedTasks[0].status, "paused");
  assert.equal(active.updated?.next_run_at, null);

  const paused = buildAutomationStorage("paused");
  const activatedTasks = await setAllAutomationStatus(
    buildAccount(paused.supabase),
    "active"
  );

  assert.equal(activatedTasks.length, 1);
  assert.equal(activatedTasks[0].status, "active");
  assert.match(String(paused.updated?.next_run_at), /^\d{4}-\d{2}-\d{2}T/);

  const archived = buildAutomationStorage("archived");
  const unchanged = await setAllAutomationStatus(
    buildAccount(archived.supabase),
    "paused"
  );
  assert.deepEqual(unchanged, []);
});

test("links verifies and unlinks an automation notification email", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);
  let verificationCode = "";
  const restoreFetch = mockFetch((_url, init) => {
    const body = JSON.parse(String(init?.body)) as { text?: string };
    verificationCode = body.text?.match(/\b\d{6}\b/)?.[0] ?? "";
    return Response.json({ id: "email-1" });
  });

  try {
    await withEnv(
      {
        LANGCLAW_AUTOMATION_EMAIL_FROM: "alerts@langclaw.ai",
        RESEND_API_KEY: "resend-test-key",
      },
      async () => {
        const requested = await requestNotificationEmailLink(
          account,
          "Alerts@Example.com"
        );

        assert.equal(requested.sent, true);
        assert.equal(requested.email, "al***@example.com");
        assert.match(verificationCode, /^\d{6}$/);

        const linked = await verifyNotificationEmailLink(
          account,
          verificationCode
        );
        assert.equal(linked.notificationEmailVerified, true);
        assert.equal(linked.notificationEmail, "alerts@example.com");
        assert.equal(linked.notificationChannels.includes("email"), true);

        const unlinked = await unlinkNotificationEmail(account);
        assert.equal(unlinked.notificationEmailVerified, false);
        assert.equal(unlinked.notificationEmail, undefined);
        assert.equal(unlinked.notificationChannels.includes("email"), false);
        assert.equal(unlinked.failureNotification, "in-app");
      }
    );
  } finally {
    restoreFetch();
  }
});

test("creates polls and unlinks a Telegram automation connection", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);
  let linkCode = "";
  let verificationReply: Record<string, unknown> | undefined;
  const restoreFetch = mockFetch((url, init) => {
    if (url.endsWith("/getUpdates")) {
      return Response.json({
        ok: true,
        result: [
          { message: { text: "ignored", chat: { id: 1 } } },
          {
            message: {
              text: `/link ${linkCode}`,
              chat: { id: 123456 },
              from: { username: "nant361" },
            },
          },
        ],
      });
    }

    verificationReply = JSON.parse(String(init?.body));
    return Response.json({ ok: true, result: { message_id: 9 } });
  });

  try {
    await withEnv(
      {
        LANGCLAW_TELEGRAM_BOT_TOKEN: "telegram-test-token",
        LANGCLAW_TELEGRAM_BOT_USERNAME: "@LangclawBot",
      },
      async () => {
        const created = await createTelegramLinkCode(account);
        linkCode = created.code;

        assert.match(created.code, /^[A-F0-9]{10}$/);
        assert.equal(created.command, `/link ${created.code}`);
        assert.equal(created.botUsername, "LangclawBot");
        assert.match(created.deepLink, /t\.me\/LangclawBot/);

        const linked = await pollTelegramLink(account);
        assert.equal(linked.status, "linked");
        assert.equal(linked.linked, true);
        assert.equal(linked.settings?.telegramVerified, true);
        assert.equal(linked.settings?.telegramChatId, "123456");
        assert.equal(linked.settings?.telegramUsername, "nant361");
        assert.equal(verificationReply?.chat_id, "123456");

        const unlinked = await unlinkTelegramLink(account);
        assert.equal(unlinked.telegramVerified, false);
        assert.equal(unlinked.telegramChatId, undefined);
        assert.equal(unlinked.notificationChannels.includes("telegram"), false);
      }
    );
  } finally {
    restoreFetch();
  }
});

test("reads the automation dashboard, runs, settings, and in-app notifications", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);
  const dashboard = await readAutomationDashboard(account);
  const runs = await readAutomationRuns(account, "task-1");
  const settings = await readAutomationSettings(account);
  const notifications = await readInAppAutomationNotifications(account, 500);

  assert.equal(dashboard.configured, true);
  assert.equal(dashboard.tasks.length, 1);
  assert.equal(dashboard.tasks[0]?.displayStatus, "Running");
  assert.equal(dashboard.recentRuns.length, 2);
  assert.equal(dashboard.stats.activeTasks, 1);
  assert.equal(dashboard.stats.runningNow, 1);
  assert.equal(runs[0]?.taskName, "Daily Celo scan");
  assert.equal(settings.telegramVerified, true);
  assert.equal(settings.dailyLimit0G, "25");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.status, "unread");
});

test("automation run filters reject invalid task identifiers", async () => {
  for (const taskId of [null, "", 42]) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      readAutomationRuns(buildAccount(storage.supabase), taskId),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message === "taskId is required.",
    );
  }
});

test("automation list limits reject non-integer values", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);

  for (const limit of ["20", 2.5]) {
    await assert.rejects(
      readInAppAutomationNotifications(account, limit),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message === "limit must be an integer.",
    );
  }
});

test("updates automation settings with explicit and default guardrails", async () => {
  const explicitStorage = buildAutomationStorage("active");
  const explicit = await updateAutomationSettings(
    buildAccount(explicitStorage.supabase),
    {
      autoPauseRepeatedFailures: false,
      dailyLimit0G: "12.5",
      failureNotification: "none",
      limitBehavior: "allow",
      lowBalanceThreshold0G: "1.25",
      monthlyCap0G: "250.5",
      notificationChannels: ["email", "email", "in-app"],
      notificationEmail: "alerts@example.com",
      retryPolicy: "5-attempts",
      telegramChatId: "789",
      thresholdAction: "continue",
      writeRunLogsToMemory: true,
    }
  );

  assert.equal(explicit.autoPauseRepeatedFailures, false);
  assert.equal(explicit.dailyLimit0G, "12.5");
  assert.equal(explicit.limitBehavior, "allow");
  assert.deepEqual(explicit.notificationChannels, ["email", "in-app"]);
  assert.equal(explicit.retryPolicy, "5-attempts");
  assert.equal(explicit.writeRunLogsToMemory, true);

  const defaultsStorage = buildAutomationStorage("active");
  const defaults = await updateAutomationSettings(
    buildAccount(defaultsStorage.supabase),
    {}
  );

  assert.equal(defaults.autoPauseRepeatedFailures, true);
  assert.equal(defaults.dailyLimit0G, "25");
  assert.deepEqual(defaults.notificationChannels, ["email"]);
  assert.equal(defaults.retryPolicy, "3-attempts");
  assert.equal(defaults.thresholdAction, "notify");
});

test("automation settings reject unsupported option values", async () => {
  for (const field of [
    "failureNotification",
    "limitBehavior",
    "retryPolicy",
    "thresholdAction",
  ] as const) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      updateAutomationSettings(buildAccount(storage.supabase), {
        [field]: "invalid",
      }),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message.startsWith(`${field} must be one of:`),
    );
  }
});

test("automation settings reject malformed notification channels", async () => {
  for (const notificationChannels of [
    "email",
    ["email", "invalid"],
  ]) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      updateAutomationSettings(buildAccount(storage.supabase), {
        notificationChannels,
      }),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message ===
          "notificationChannels must contain only email, telegram, or in-app.",
    );
  }
});

test("automation settings reject non-boolean flags", async () => {
  for (const field of [
    "autoPauseRepeatedFailures",
    "writeRunLogsToMemory",
  ] as const) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      updateAutomationSettings(buildAccount(storage.supabase), {
        [field]: "false",
      }),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message === `${field} must be a boolean.`,
    );
  }
});

test("automation settings reject invalid 0G amounts", async () => {
  for (const field of [
    "dailyLimit0G",
    "lowBalanceThreshold0G",
    "monthlyCap0G",
  ] as const) {
    const storage = buildAutomationStorage("active");

    await assert.rejects(
      updateAutomationSettings(buildAccount(storage.supabase), {
        [field]: "invalid",
      }),
      (error: unknown) =>
        error instanceof AutomationHttpError &&
        error.status === 400 &&
        error.message ===
          `${field} must be a non-negative decimal with up to 18 fractional digits.`,
    );
  }
});

test("marks one or all in-app automation notifications as read", async () => {
  const storage = buildAutomationStorage("active");
  const account = buildAccount(storage.supabase);
  const marked = await markInAppAutomationNotificationRead(
    account,
    "notification-1"
  );
  const all = await markAllInAppAutomationNotificationsRead(account);

  assert.equal(marked.status, "read");
  assert.match(marked.readAt ?? "", /^\d{4}-/);
  assert.deepEqual(all, { read: true });

  await assert.rejects(
    markInAppAutomationNotificationRead(account, " "),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      /notificationId/.test(error.message)
  );
});

test("automation link polling rejects missing and expired requests", async () => {
  const missing = buildAutomationStorage("active");
  missing.settings.telegram_link_code_hash = null;
  missing.settings.telegram_link_expires_at = null;
  await assert.rejects(
    pollTelegramLink(buildAccount(missing.supabase)),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      /No Telegram link code/.test(error.message)
  );

  const expired = buildAutomationStorage("active");
  expired.settings.telegram_link_code_hash = "expired-hash";
  expired.settings.telegram_link_expires_at = "2020-01-01T00:00:00.000Z";
  await assert.rejects(
    pollTelegramLink(buildAccount(expired.supabase)),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      /expired/.test(error.message)
  );

  const email = buildAutomationStorage("active");
  email.settings.notification_email_pending = null;
  email.settings.notification_email_code_hash = null;
  email.settings.notification_email_expires_at = null;
  await assert.rejects(
    verifyNotificationEmailLink(buildAccount(email.supabase), "123456"),
    (error: unknown) =>
      error instanceof AutomationHttpError &&
      error.status === 400 &&
      /No email link request/.test(error.message)
  );
});

test("creates schedule and event tasks with normalized trigger settings", async () => {
  const monthlyStorage = buildAutomationStorage("active");
  const monthly = await createAutomationTask(
    buildAccount(monthlyStorage.supabase),
    {
      name: "Monthly Celo review",
      scheduleFrequency: "monthly",
      scheduleMonthDay: 31,
      scheduleTime: "08:30",
      scheduleWeekday: 2,
      status: "active",
      timezone: "Asia/Jakarta",
      triggerType: "schedule",
    }
  );
  const eventStorage = buildAutomationStorage("active");
  const event = await createAutomationTask(buildAccount(eventStorage.supabase), {
    eventName: "wallet.deposit",
    name: "Deposit review",
    status: "draft",
    triggerType: "event",
  });

  assert.equal(monthly.scheduleFrequency, "monthly");
  assert.equal(monthly.scheduleMonthDay, 31);
  assert.match(monthly.nextRunAt ?? "", /^\d{4}-/);
  assert.equal(event.triggerType, "event");
  assert.equal(event.eventName, "wallet.deposit");
  assert.equal(event.nextRunAt, undefined);
});

test("retries failed automation work and pauses repeated failures", async () => {
  const storage = buildAutomationStorage("active", {
    consecutive_failures: 4,
    failure_threshold: 5,
    max_retries: 3,
  });
  const run = await runAutomationTask(
    buildAccount(storage.supabase),
    "task-1",
    "schedule"
  );

  assert.equal(run.status, "failed");
  assert.equal(storage.rpcCalls, 3);
  assert.deepEqual(run.result, {
    attempts: [
      { attempt: 1, error: "Insufficient USDT balance." },
      { attempt: 2, error: "Insufficient USDT balance." },
      { attempt: 3, error: "Insufficient USDT balance." },
    ],
  });
  assert.equal(storage.updated?.consecutive_failures, 5);
  assert.equal(storage.updated?.last_run_status, "failed");
  assert.equal(storage.updated?.status, "paused");
  assert.equal(storage.updated?.next_run_at, null);
});

function buildAccount(supabase: unknown) {
  return {
    account: {
      authMethod: "wallet" as const,
      supabase: supabase as never,
      walletUser,
    },
  };
}

function buildAutomationStorage(
  initialStatus: "active" | "archived" | "paused",
  taskOverrides: Record<string, unknown> = {}
) {
  let updated: Record<string, unknown> | undefined;
  let inserted: Record<string, unknown> | undefined;
  let rpcCalls = 0;
  const task = {
    consecutive_failures: 0,
    created_at: "2026-07-17T10:00:00.000Z",
    event_name: null,
    failure_threshold: 5,
    id: "task-1",
    last_run_at: null,
    last_run_status: null,
    max_retries: 3,
    metadata: {},
    model: null,
    name: "Daily Celo scan",
    next_run_at: "2026-07-18T02:00:00.000Z",
    project: "Langclaw Website",
    prompt: "Scan Celo activity",
    schedule_frequency: "daily" as const,
    schedule_month_day: 17,
    schedule_time: "09:00",
    schedule_weekday: 5,
    status: initialStatus,
    timezone: "Asia/Jakarta",
    trigger_type: "schedule" as const,
    updated_at: "2026-07-17T10:00:00.000Z",
    wallet_user_id: walletUser.id,
    webhook_slug: null,
    ...taskOverrides,
  };
  const settings = {
    auto_pause_repeated_failures: true,
    created_at: "2026-07-17T10:00:00.000Z",
    daily_limit_neuron: "25000000000000000000",
    failure_notification: "email" as const,
    limit_behavior: "pause" as const,
    low_balance_threshold_neuron: "10000000000000000000",
    monthly_cap_neuron: "500000000000000000000",
    notification_channels: ["telegram" as const],
    notification_email: null,
    notification_email_code_hash: null,
    notification_email_expires_at: null,
    notification_email_linked_at: null,
    notification_email_pending: null,
    notification_email_verified: false,
    retry_policy: "3-attempts" as const,
    telegram_chat_id: "123",
    telegram_link_code_hash: null,
    telegram_link_expires_at: null,
    telegram_linked_at: "2026-07-17T10:00:00.000Z",
    telegram_username: "langclaw",
    telegram_verified: true,
    threshold_action: "notify" as const,
    updated_at: "2026-07-17T10:00:00.000Z",
    wallet_user_id: walletUser.id,
    write_run_logs_to_memory: false,
  };
  const runs = [
    {
      attempt: 1,
      completed_at: null,
      created_at: new Date().toISOString(),
      duration_ms: null,
      error: null,
      id: "run-dashboard-running",
      langclaw_automation_tasks: { name: task.name },
      result: null,
      scheduled_for: task.next_run_at,
      started_at: new Date().toISOString(),
      status: "running",
      task_id: task.id,
      triggered_by: "schedule",
      usage: null,
      wallet_user_id: walletUser.id,
    },
    {
      attempt: 1,
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      duration_ms: 1250,
      error: null,
      id: "run-dashboard-completed",
      langclaw_automation_tasks: { name: task.name },
      result: { answer: "done" },
      scheduled_for: null,
      started_at: new Date().toISOString(),
      status: "completed",
      task_id: task.id,
      triggered_by: "manual",
      usage: { chargedNeuron: "10" },
      wallet_user_id: walletUser.id,
    },
  ];
  const notifications = [
    {
      body: "Automation run needs attention.",
      created_at: new Date().toISOString(),
      id: "notification-1",
      metadata: { status: "failed" },
      read_at: null,
      run_id: "run-dashboard-completed",
      status: "unread",
      task_id: task.id,
      title: "Automation alert",
      wallet_user_id: walletUser.id,
    },
  ];
  const supabase = {
    rpc() {
      rpcCalls += 1;
      return Promise.resolve({
        data: null,
        error: { message: "insufficient_balance" },
      });
    },
    from(table: string) {
      if (table === "langclaw_automation_settings") {
        return {
          update(payload: Record<string, unknown>) {
            Object.assign(settings, payload);
            const query = {
              eq() {
                return query;
              },
              select() {
                return {
                  single: () => Promise.resolve({ data: settings, error: null }),
                };
              },
            };
            return query;
          },
          upsert(payload: Record<string, unknown>) {
            Object.assign(settings, payload);

            return {
              select() {
                return {
                  single: () => Promise.resolve({ data: settings, error: null }),
                };
              },
            };
          },
        };
      }

      if (table === "langclaw_automation_runs") {
        const run = {
          attempt: 1,
          completed_at: null,
          created_at: "2026-07-18T10:00:00.000Z",
          duration_ms: null,
          error: null,
          id: "run-1",
          result: null,
          scheduled_for: task.next_run_at,
          started_at: "2026-07-18T10:00:00.000Z",
          status: "running",
          task_id: task.id,
          triggered_by: "schedule",
          usage: null,
          wallet_user_id: walletUser.id,
        };

        const query = {
          eq() {
            return query;
          },
          limit() {
            return query;
          },
          order() {
            return query;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: runs, error: null }).then(resolve);
          },
        };

        return {
          insert(payload: Record<string, unknown>) {
            Object.assign(run, payload);

            return {
              select() {
                return {
                  single: () => Promise.resolve({ data: run, error: null }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            Object.assign(run, payload);
            const query = {
              eq() {
                return query;
              },
              select() {
                return {
                  single: () => Promise.resolve({ data: run, error: null }),
                };
              },
            };

            return query;
          },
          select() {
            return query;
          },
        };
      }

      if (table === "langclaw_usage_accounts") {
        return {
          select() {
            const query = {
              eq() {
                return query;
              },
              maybeSingle: () =>
                Promise.resolve({
                  data: { available_neuron: "1000000000000000000000" },
                  error: null,
                }),
            };

            return query;
          },
        };
      }

      if (table === "langclaw_usage_charges") {
        return {
          select() {
            const query = {
              eq() {
                return query;
              },
              gte: () => Promise.resolve({ data: [], error: null }),
            };

            return query;
          },
        };
      }

      if (table === "langclaw_automation_notifications") {
        const readQuery = {
          eq() {
            return readQuery;
          },
          limit() {
            return readQuery;
          },
          order() {
            return readQuery;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: notifications, error: null }).then(
              resolve
            );
          },
        };

        return {
          insert: () => Promise.resolve({ error: null }),
          select() {
            return readQuery;
          },
          update(payload: Record<string, unknown>) {
            Object.assign(notifications[0], payload);
            const updateQuery = {
              eq() {
                return updateQuery;
              },
              maybeSingle: () =>
                Promise.resolve({ data: notifications[0], error: null }),
              select() {
                return updateQuery;
              },
              then(resolve: (value: unknown) => unknown) {
                return Promise.resolve({ data: notifications, error: null }).then(
                  resolve
                );
              },
            };

            return updateQuery;
          },
        };
      }

      assert.equal(table, "langclaw_automation_tasks");
      return {
        insert(payload: Record<string, unknown>) {
          inserted = payload;

          return {
            select() {
              return {
                single: () =>
                  Promise.resolve({
                    data: {
                      ...task,
                      ...payload,
                      id: "task-created",
                      created_at: task.created_at,
                      updated_at: task.updated_at,
                    },
                    error: null,
                  }),
              };
            },
          };
        },
        select() {
          const query = {
            eq() {
              return query;
            },
            neq() {
              return query;
            },
            order() {
              return query;
            },
            limit: () => Promise.resolve({ data: [task], error: null }),
            maybeSingle: () => Promise.resolve({ data: task, error: null }),
          };

          return query;
        },
        update(payload: Record<string, unknown>) {
          updated = payload;
          Object.assign(task, payload);
          const query = {
            eq() {
              return query;
            },
            select() {
              return {
                single: () =>
                  Promise.resolve({
                    data: { ...task, ...payload },
                    error: null,
                  }),
              };
            },
          };

          return query;
        },
      };
    },
  };

  return {
    get inserted() {
      return inserted;
    },
    get rpcCalls() {
      return rpcCalls;
    },
    get updated() {
      return updated;
    },
    settings,
    supabase,
  };
}
