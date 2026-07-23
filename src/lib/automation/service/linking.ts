import {
  AccountAuthError,
  AutomationHttpError,
  createAutomationProviderSignal,
  createHash,
  defaultTelegramBotUsername,
  maskEmail,
  randomBytes,
  randomInt,
  readAutomationSettingsRow,
  readOptionalString,
  readProviderResponseJson,
  requireAutomationContext,
  requireSupabaseAdmin,
  rowToSettings,
  sendAutomationEmail,
} from "./core";
import type {
  AccountAuthInput,
  AutomationContext,
  AutomationSettingsRow,
  TelegramLinkCandidate,
} from "./types";

export async function requestNotificationEmailLink(
  authInput: AccountAuthInput,
  emailInput: unknown
) {
  const context = await requireAutomationContext(authInput);
  const email = readEmail(emailInput);
  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await sendAutomationEmail({
    requireConfigured: true,
    subject: "Verify your Langclaw automation email",
    text: [
      "Use this code to link your email to Langclaw automation alerts.",
      "",
      code,
      "",
      "This code expires in 15 minutes.",
    ].join("\n"),
    to: email,
  });

  const { error } = await context.supabase
    .from("langclaw_automation_settings")
    .upsert(
      {
        notification_email_code_hash: hashLinkCode(code),
        notification_email_expires_at: expiresAt,
        notification_email_pending: email,
        wallet_user_id: context.walletUser.id,
      },
      { onConflict: "wallet_user_id" }
    );

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return {
    email: maskEmail(email),
    expiresAt,
    sent: true,
  };
}

export async function verifyNotificationEmailLink(
  authInput: AccountAuthInput,
  codeInput: unknown
) {
  const context = await requireAutomationContext(authInput);
  const code = readLinkCode(codeInput);
  const settings = await readAutomationSettingsRow(context);
  const email = settings.notification_email_pending;
  const pendingCodeHash = settings.notification_email_code_hash;
  const pendingExpiresAt = settings.notification_email_expires_at;

  if (!email || !pendingCodeHash || !pendingExpiresAt) {
    throw new AutomationHttpError(400, "No email link request is pending.");
  }

  if (new Date(pendingExpiresAt).getTime() < Date.now()) {
    throw new AutomationHttpError(400, "Email link code has expired.");
  }

  if (pendingCodeHash !== hashLinkCode(code)) {
    throw new AutomationHttpError(400, "Email link code is invalid.");
  }

  const linkedAt = new Date(Date.now()).toISOString();
  const { data, error } = await context.supabase
    .from("langclaw_automation_settings")
    .update({
      notification_channels: unionChannels(settings.notification_channels, "email"),
      notification_email: email,
      notification_email_code_hash: null,
      notification_email_expires_at: null,
      notification_email_linked_at: linkedAt,
      notification_email_pending: null,
      notification_email_verified: true,
    })
    .eq("wallet_user_id", context.walletUser.id)
    .eq("notification_email_code_hash", pendingCodeHash)
    .eq("notification_email_pending", email)
    .eq("notification_email_expires_at", pendingExpiresAt)
    .gt("notification_email_expires_at", linkedAt)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(
      500,
      error.message || "Unable to verify automation email."
    );
  }

  if (!data) {
    throw new AutomationHttpError(
      409,
      "Email link code was already used or expired."
    );
  }

  return rowToSettings(data as AutomationSettingsRow);
}

export async function unlinkNotificationEmail(authInput: AccountAuthInput) {
  const context = await requireAutomationContext(authInput);
  const settings = await readAutomationSettingsRow(context);
  const { data, error } = await context.supabase
    .from("langclaw_automation_settings")
    .update({
      failure_notification:
        settings.failure_notification === "email"
          ? "in-app"
          : settings.failure_notification,
      notification_channels: removeChannel(settings.notification_channels, "email"),
      notification_email: null,
      notification_email_code_hash: null,
      notification_email_expires_at: null,
      notification_email_linked_at: null,
      notification_email_pending: null,
      notification_email_verified: false,
    })
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to unlink automation email."
    );
  }

  return rowToSettings(data as AutomationSettingsRow);
}

export async function createTelegramLinkCode(authInput: AccountAuthInput) {
  const context = await requireAutomationContext(authInput);
  const code = randomBytes(5).toString("hex").toUpperCase();
  const botUsername = readTelegramBotUsername();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await context.supabase
    .from("langclaw_automation_settings")
    .upsert(
      {
        telegram_link_code_hash: hashLinkCode(code),
        telegram_link_expires_at: expiresAt,
        wallet_user_id: context.walletUser.id,
      },
      { onConflict: "wallet_user_id" }
    );

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  return {
    botUsername,
    code,
    command: `/link ${code}`,
    deepLink: `https://t.me/${botUsername}?start=${encodeURIComponent(code)}`,
    expiresAt,
  };
}

export async function unlinkTelegramLink(authInput: AccountAuthInput) {
  const context = await requireAutomationContext(authInput);
  const settings = await readAutomationSettingsRow(context);
  const { data, error } = await context.supabase
    .from("langclaw_automation_settings")
    .update({
      notification_channels: removeChannel(
        settings.notification_channels,
        "telegram"
      ),
      telegram_chat_id: null,
      telegram_link_code_hash: null,
      telegram_link_expires_at: null,
      telegram_linked_at: null,
      telegram_username: null,
      telegram_verified: false,
    })
    .eq("wallet_user_id", context.walletUser.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AutomationHttpError(
      500,
      error?.message || "Unable to unlink Telegram chat."
    );
  }

  return rowToSettings(data as AutomationSettingsRow);
}

export async function pollTelegramLink(authInput: AccountAuthInput) {
  const context = await requireAutomationContext(authInput);
  const settings = await readAutomationSettingsRow(context);

  if (!settings.telegram_link_code_hash || !settings.telegram_link_expires_at) {
    throw new AutomationHttpError(400, "No Telegram link code is pending.");
  }

  if (new Date(settings.telegram_link_expires_at).getTime() < Date.now()) {
    throw new AutomationHttpError(400, "Telegram link code has expired.");
  }

  const update = await findTelegramUpdateByCodeHash(
    settings.telegram_link_code_hash
  );

  if (!update) {
    return {
      linked: false,
      status: "pending",
    };
  }

  return {
    linked: true,
    settings: await linkTelegramChat(context.supabase, settings, update),
    status: "linked",
  };
}

export async function processTelegramWebhookUpdate(update: unknown) {
  let supabase: AutomationContext["supabase"];

  try {
    supabase = requireSupabaseAdmin();
  } catch (error) {
    if (error instanceof AccountAuthError) {
      throw new AutomationHttpError(error.status, error.message);
    }

    throw error;
  }

  const candidate = readTelegramUpdateCandidate(update);

  if (!candidate) {
    return {
      linked: false,
      status: "ignored",
    };
  }

  const codeHash = hashLinkCode(candidate.code);
  const { data, error } = await supabase
    .from("langclaw_automation_settings")
    .select("*")
    .eq("telegram_link_code_hash", codeHash)
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(500, error.message);
  }

  if (!data) {
    return {
      linked: false,
      status: "not_found",
    };
  }

  const settings = data as AutomationSettingsRow;

  if (
    !settings.telegram_link_expires_at ||
    new Date(settings.telegram_link_expires_at).getTime() < Date.now()
  ) {
    return {
      linked: false,
      status: "expired",
    };
  }

  return {
    linked: true,
    settings: await linkTelegramChat(supabase, settings, candidate),
    status: "linked",
  };
}

async function findTelegramUpdateByCodeHash(codeHash: string) {
  const token = process.env.LANGCLAW_TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    throw new AutomationHttpError(503, "Telegram bot token is not configured.");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    signal: createAutomationProviderSignal(),
  });

  if (!response.ok) {
    throw new AutomationHttpError(
      502,
      `Telegram getUpdates failed with ${response.status}.`
    );
  }

  let payload: { ok?: boolean; result?: unknown[] } | null = null;

  try {
    payload = await readProviderResponseJson<{
      ok?: boolean;
      result?: unknown[];
    }>(response);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  if (!payload?.ok || !Array.isArray(payload.result)) {
    return null;
  }

  for (const update of payload.result) {
    const candidate = readTelegramUpdateCandidate(update);

    if (candidate && hashLinkCode(candidate.code) === codeHash) {
      return candidate;
    }
  }

  return null;
}

async function linkTelegramChat(
  supabase: AutomationContext["supabase"],
  settings: AutomationSettingsRow,
  candidate: TelegramLinkCandidate
) {
  const pendingCodeHash = settings.telegram_link_code_hash;

  if (!pendingCodeHash) {
    throw new AutomationHttpError(
      409,
      "Telegram link code was already used or expired."
    );
  }

  const linkedAt = new Date(Date.now()).toISOString();
  const { data, error } = await supabase
    .from("langclaw_automation_settings")
    .update({
      notification_channels: unionChannels(
        settings.notification_channels,
        "telegram"
      ),
      telegram_chat_id: candidate.chatId,
      telegram_link_code_hash: null,
      telegram_link_expires_at: null,
      telegram_linked_at: linkedAt,
      telegram_username: candidate.username ?? null,
      telegram_verified: true,
    })
    .eq("wallet_user_id", settings.wallet_user_id)
    .eq("telegram_link_code_hash", pendingCodeHash)
    .gt("telegram_link_expires_at", linkedAt)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AutomationHttpError(
      500,
      error.message || "Unable to link Telegram chat."
    );
  }

  if (!data) {
    throw new AutomationHttpError(
      409,
      "Telegram link code was already used or expired."
    );
  }

  await sendTelegramVerificationSuccess(candidate.chatId).catch(() => undefined);

  return rowToSettings(data as AutomationSettingsRow);
}

async function sendTelegramVerificationSuccess(chatId: string) {
  const token = process.env.LANGCLAW_TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      text: "Verification success. Langclaw automation alerts are now linked.",
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: createAutomationProviderSignal(),
  });

  if (!response.ok) {
    throw new AutomationHttpError(
      502,
      `Telegram verification reply failed with ${response.status}.`
    );
  }
}

function readTelegramUpdateCandidate(update: unknown): TelegramLinkCandidate | null {
  if (!update || typeof update !== "object") {
    return null;
  }

  const message = (update as { message?: unknown }).message;

  if (!message || typeof message !== "object") {
    return null;
  }

  const text = (message as { text?: unknown }).text;
  const chat = (message as { chat?: unknown }).chat;

  if (typeof text !== "string" || !chat || typeof chat !== "object") {
    return null;
  }

  const chatId = (chat as { id?: unknown }).id;
  const code = readTelegramCodeFromText(text);

  if ((typeof chatId !== "string" && typeof chatId !== "number") || !code) {
    return null;
  }

  const from = (message as { from?: unknown }).from;
  const username =
    from && typeof from === "object"
      ? (from as { username?: unknown }).username
      : undefined;

  return {
    chatId: String(chatId),
    code,
    username: typeof username === "string" ? username : undefined,
  };
}

export function readTelegramCodeFromText(text: string) {
  const commandMatch = text.match(
    /(?:^|\s)\/?(?:link|start)\s+([A-Za-z0-9]{6,32})\b/i
  );

  if (commandMatch) {
    return commandMatch[1].toUpperCase();
  }

  const trimmed = text.trim();

  if (/^[A-Za-z0-9]{6,32}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return "";
}

function readTelegramBotUsername() {
  const configured = process.env.LANGCLAW_TELEGRAM_BOT_USERNAME?.trim() || "";
  const normalized = configured.replace(/^@+/, "");

  return /^[A-Za-z0-9_]{5,32}$/.test(normalized)
    ? normalized
    : defaultTelegramBotUsername;
}

function readEmail(value: unknown) {
  const email = readOptionalString(value, 320)?.toLowerCase();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AutomationHttpError(400, "A valid email is required.");
  }

  return email;
}

function readLinkCode(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{4,32}$/.test(value.trim())) {
    throw new AutomationHttpError(400, "A valid link code is required.");
  }

  return value.trim().toUpperCase();
}

function hashLinkCode(value: string) {
  return createHash("sha256")
    .update(value.trim().toUpperCase())
    .digest("hex");
}

function unionChannels(
  current: Array<"email" | "telegram" | "in-app">,
  channel: "email" | "telegram" | "in-app"
) {
  return Array.from(new Set([...current, channel]));
}

function removeChannel(
  current: Array<"email" | "telegram" | "in-app">,
  channel: "email" | "telegram" | "in-app"
) {
  return current.filter((item) => item !== channel);
}
