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
  pollTelegramLink,
  readTelegramCodeFromText,
  requestNotificationEmailLink,
  runAutomationEvent,
  runAutomationWebhook,
  setAllAutomationStatus,
  unlinkNotificationEmail,
  unlinkTelegramLink,
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
  const failed = automationErrorResponse(new Error("Storage unavailable."));
  const unknown = automationErrorResponse("unexpected");

  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid automation input." });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Storage unavailable." });
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
  initialStatus: "active" | "archived" | "paused"
) {
  let updated: Record<string, unknown> | undefined;
  let inserted: Record<string, unknown> | undefined;
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
  const supabase = {
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
    get updated() {
      return updated;
    },
    supabase,
  };
}
