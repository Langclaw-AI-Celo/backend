import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomationNotificationMessage,
  resolveNotificationChannels,
  sendAutomationEmail,
  sendAutomationRunNotification,
} from "./notifications";
import type { AutomationSettings } from "./types";

const settings: AutomationSettings = {
  autoPauseRepeatedFailures: true,
  dailyLimit0G: "25",
  failureNotification: "email",
  limitBehavior: "pause",
  lowBalanceThreshold0G: "10",
  monthlyCap0G: "500",
  notificationChannels: ["email", "telegram"],
  notificationEmail: "ops@example.com",
  notificationEmailVerified: true,
  retryPolicy: "3-attempts",
  telegramChatId: "123",
  telegramVerified: true,
  thresholdAction: "notify",
  writeRunLogsToMemory: false,
};

test("automation notification message includes run context", () => {
  const message = buildAutomationNotificationMessage({
    completedAt: "2026-05-15T12:00:00.000Z",
    durationMs: 32000,
    error: "Daily automation MNT limit reached.",
    project: "Langclaw Website",
    runId: "run-1",
    status: "skipped",
    taskName: "Usage digest sync",
    triggeredBy: "schedule",
  });

  assert.equal(
    message.subject,
    "Langclaw Mantle alert Skipped: Usage digest sync"
  );
  assert.match(message.text, /Project: Langclaw Website/);
  assert.match(message.text, /Reason: Daily automation MNT limit reached\./);
});

test("notification channels exclude in-app and honor disabled notifications", () => {
  assert.deepEqual(resolveNotificationChannels(settings), ["email", "telegram"]);
  assert.deepEqual(
    resolveNotificationChannels({
      ...settings,
      failureNotification: "none",
    }),
    []
  );
  assert.deepEqual(
    resolveNotificationChannels({
      ...settings,
      notificationChannels: ["in-app", "telegram"],
    }),
    ["telegram"]
  );
});

test("sendAutomationEmail posts the requested payload to Resend", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
  let requestBody: unknown;

  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));

    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  process.env.RESEND_API_KEY = "test-api-key";
  process.env.LANGCLAW_AUTOMATION_EMAIL_FROM = "alerts@example.com";

  try {
    await sendAutomationEmail({
      subject: "Verify your Langclaw automation email",
      text: "123456",
      to: "user@example.com",
    });

    assert.deepEqual(requestBody, {
      from: "alerts@example.com",
      subject: "Verify your Langclaw automation email",
      text: "123456",
      to: "user@example.com",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
    if (originalFrom === undefined) {
      delete process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
    } else {
      process.env.LANGCLAW_AUTOMATION_EMAIL_FROM = originalFrom;
    }
  }
});

test("sendAutomationEmail requires an explicit verified sender for verification mail", async () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
  const originalResendEmailFrom = process.env.RESEND_EMAIL_FROM;
  const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

  process.env.RESEND_API_KEY = "test-api-key";
  delete process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
  delete process.env.RESEND_EMAIL_FROM;
  delete process.env.RESEND_FROM_EMAIL;

  try {
    await assert.rejects(
      sendAutomationEmail({
        requireConfigured: true,
        subject: "Verify your Langclaw automation email",
        text: "123456",
        to: "user@example.com",
      }),
      /LANGCLAW_AUTOMATION_EMAIL_FROM must be set to a verified Resend sender/
    );
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
    if (originalFrom === undefined) {
      delete process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
    } else {
      process.env.LANGCLAW_AUTOMATION_EMAIL_FROM = originalFrom;
    }
    if (originalResendEmailFrom === undefined) {
      delete process.env.RESEND_EMAIL_FROM;
    } else {
      process.env.RESEND_EMAIL_FROM = originalResendEmailFrom;
    }
    if (originalResendFromEmail === undefined) {
      delete process.env.RESEND_FROM_EMAIL;
    } else {
      process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
    }
  }
});

test("sendAutomationEmail includes Resend 403 details and config hint", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        message: "The sender address is not verified.",
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
        status: 403,
      }
    )) as typeof fetch;

  process.env.RESEND_API_KEY = "test-api-key";
  process.env.LANGCLAW_AUTOMATION_EMAIL_FROM = "alerts@example.com";

  try {
    await assert.rejects(
      sendAutomationEmail({
        subject: "Verify your Langclaw automation email",
        text: "123456",
        to: "user@example.com",
      }),
      /Email notification failed with 403: The sender address is not verified.*verified Resend domain/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
    if (originalFrom === undefined) {
      delete process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
    } else {
      process.env.LANGCLAW_AUTOMATION_EMAIL_FROM = originalFrom;
    }
  }
});

test("automation email notifications require a verified linked email", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFallbackTo = process.env.LANGCLAW_AUTOMATION_EMAIL_TO;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount += 1;

    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  process.env.RESEND_API_KEY = "test-api-key";
  process.env.LANGCLAW_AUTOMATION_EMAIL_TO = "fallback@example.com";

  try {
    await sendAutomationRunNotification({
      completedAt: "2026-05-15T12:00:00.000Z",
      durationMs: 1000,
      error: "Daily automation MNT limit reached.",
      project: "Langclaw Website",
      runId: "run-1",
      settings: {
        ...settings,
        notificationEmail: undefined,
        notificationEmailVerified: false,
        notificationChannels: ["email"],
      },
      status: "skipped",
      taskName: "Usage digest sync",
      triggeredBy: "schedule",
    });

    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
    if (originalFallbackTo === undefined) {
      delete process.env.LANGCLAW_AUTOMATION_EMAIL_TO;
    } else {
      process.env.LANGCLAW_AUTOMATION_EMAIL_TO = originalFallbackTo;
    }
  }
});
