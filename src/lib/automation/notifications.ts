import type {
  AutomationNotificationChannel,
  AutomationRunStatus,
  AutomationSettings,
  AutomationTriggeredBy,
} from "./types";

type NotificationInput = {
  completedAt?: string;
  durationMs?: number;
  error?: string;
  project: string;
  runId: string;
  status: AutomationRunStatus;
  taskName: string;
  triggeredBy: AutomationTriggeredBy;
};

type SendNotificationInput = NotificationInput & {
  settings: AutomationSettings;
};

type NotificationMessage = {
  subject: string;
  text: string;
};

type SendEmailInput = {
  requireConfigured?: boolean;
  subject: string;
  text: string;
  to?: string;
};

const telegramApiBase = "https://api.telegram.org";
const resendApiUrl = "https://api.resend.com/emails";
const maxProviderErrorLength = 500;

export async function sendAutomationRunNotification({
  settings,
  ...input
}: SendNotificationInput) {
  if (!shouldNotifyRun(input.status, settings)) {
    return;
  }

  const message = buildAutomationNotificationMessage(input);
  const channels = resolveNotificationChannels(settings);
  const results = await Promise.allSettled(
    channels.map((channel) => sendChannelNotification(channel, settings, message))
  );
  const failures = results.filter((result) => result.status === "rejected");

  if (failures.length === results.length && results.length > 0) {
    throw new Error("All automation notification channels failed.");
  }
}

export function buildAutomationNotificationMessage({
  completedAt,
  durationMs,
  error,
  project,
  runId,
  status,
  taskName,
  triggeredBy,
}: NotificationInput): NotificationMessage {
  const readableStatus = formatStatus(status);
  const duration = durationMs === undefined ? "unknown" : formatDuration(durationMs);
  const lines = [
    `Task: ${taskName}`,
    `Project: ${project}`,
    `Status: ${readableStatus}`,
    `Triggered by: ${triggeredBy}`,
    `Run ID: ${runId}`,
    `Finished at: ${completedAt || new Date().toISOString()}`,
    `Duration: ${duration}`,
  ];

  if (error) {
    lines.push(`Reason: ${error}`);
  }

  return {
    subject: `Langclaw Mantle alert ${readableStatus}: ${taskName}`,
    text: lines.join("\n"),
  };
}

export function resolveNotificationChannels(
  settings: AutomationSettings
): AutomationNotificationChannel[] {
  if (settings.failureNotification === "none") {
    return [];
  }

  const channels = new Set(settings.notificationChannels);

  if (!channels.size) {
    channels.add(settings.failureNotification);
  }

  channels.delete("in-app");

  return Array.from(channels);
}

function shouldNotifyRun(
  status: AutomationRunStatus,
  settings: AutomationSettings
) {
  if (settings.failureNotification === "none") {
    return false;
  }

  return status === "failed" || status === "skipped";
}

async function sendChannelNotification(
  channel: AutomationNotificationChannel,
  settings: AutomationSettings,
  message: NotificationMessage
) {
  if (channel === "telegram") {
    await sendTelegramNotification(settings, message);
    return;
  }

  if (channel === "email") {
    await sendEmailNotification(settings, message);
  }
}

async function sendTelegramNotification(
  settings: AutomationSettings,
  message: NotificationMessage
) {
  const token = process.env.LANGCLAW_TELEGRAM_BOT_TOKEN?.trim();
  const chatId =
    settings.telegramVerified && settings.telegramChatId?.trim()
      ? settings.telegramChatId.trim()
      : process.env.LANGCLAW_AUTOMATION_TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return;
  }

  const response = await fetch(
    `${telegramApiBase}/bot${token}/sendMessage`,
    {
      body: JSON.stringify({
        chat_id: chatId,
        disable_web_page_preview: true,
        text: `${message.subject}\n\n${message.text}`,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram notification failed with ${response.status}.`);
  }
}

async function sendEmailNotification(
  settings: AutomationSettings,
  message: NotificationMessage
) {
  const to =
    settings.notificationEmailVerified && settings.notificationEmail?.trim()
      ? settings.notificationEmail.trim()
      : undefined;

  await sendAutomationEmail({
    subject: message.subject,
    text: message.text,
    to,
  });
}

export async function sendAutomationEmail({
  requireConfigured = false,
  subject,
  text,
  to,
}: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = readAutomationEmailSender();

  if (!apiKey || !from || !to) {
    if (requireConfigured) {
      throw new Error(buildEmailConfigError(Boolean(apiKey), Boolean(from), Boolean(to)));
    }

    return;
  }

  const response = await fetch(resendApiUrl, {
    body: JSON.stringify({
      from,
      subject,
      text,
      to,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await buildEmailProviderError(response));
  }
}

function readAutomationEmailSender() {
  return (
    process.env.LANGCLAW_AUTOMATION_EMAIL_FROM?.trim() ||
    process.env.RESEND_EMAIL_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim()
  );
}

function buildEmailConfigError(
  hasApiKey: boolean,
  hasFrom: boolean,
  hasTo: boolean
) {
  if (!hasApiKey) {
    return "RESEND_API_KEY is not configured.";
  }

  if (!hasFrom) {
    return "LANGCLAW_AUTOMATION_EMAIL_FROM must be set to a verified Resend sender.";
  }

  if (!hasTo) {
    return "A verified notification email is required.";
  }

  return "Resend email sender is not configured.";
}

async function buildEmailProviderError(response: Response) {
  const detail = await readProviderErrorDetail(response);
  const hint =
    response.status === 401 || response.status === 403
      ? " Check RESEND_API_KEY and make sure LANGCLAW_AUTOMATION_EMAIL_FROM uses a verified Resend domain or sender."
      : "";

  return `Email notification failed with ${response.status}${
    detail ? `: ${detail}` : ""
  }.${hint}`;
}

async function readProviderErrorDetail(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text().catch(() => "");
  const trimmed = raw.trim();

  if (!trimmed) {
    return "";
  }

  if (contentType.includes("application/json")) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      const message = payload.message ?? payload.error ?? payload.name;

      if (typeof message === "string" && message.trim()) {
        return message.trim().slice(0, maxProviderErrorLength);
      }
    } catch {
      return trimmed.slice(0, maxProviderErrorLength);
    }
  }

  return trimmed.slice(0, maxProviderErrorLength);
}

function formatStatus(status: AutomationRunStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60000) {
    return `${Math.round(durationMs / 1000)}s`;
  }

  return `${Math.round(durationMs / 60000)}m`;
}
