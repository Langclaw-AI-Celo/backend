import type { WalletAuthInput } from "../lib/server/wallet-auth";
import {
  automationErrorResponse,
  createAutomationTask,
  createTelegramLinkCode,
  deleteAutomationTask,
  pollTelegramLink,
  processTelegramWebhookUpdate,
  readAutomationDashboard,
  readInAppAutomationNotifications,
  readAutomationRuns,
  readAutomationSettings,
  markAllInAppAutomationNotificationsRead,
  markInAppAutomationNotificationRead,
  requestNotificationEmailLink,
  runAutomationEvent,
  runAutomationTask,
  runDueAutomationTasks,
  runAutomationWebhook,
  setAllAutomationStatus,
  unlinkNotificationEmail,
  unlinkTelegramLink,
  updateAutomationSettings,
  updateAutomationTask,
  verifyNotificationEmailLink,
} from "../lib/automation/service";
import type {
  AutomationSettingsInput,
  AutomationTaskInput,
  AutomationTriggeredBy,
} from "../lib/automation/types";

type AutomationBody = {
  action?: unknown;
  code?: unknown;
  email?: unknown;
  eventName?: unknown;
  limit?: unknown;
  notificationId?: unknown;
  payload?: unknown;
  settings?: AutomationSettingsInput;
  task?: AutomationTaskInput;
  taskId?: unknown;
  triggeredBy?: unknown;
  wallet?: WalletAuthInput;
};

const AUTOMATION_WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;
const WEBHOOK_CLIENT_RATE_LIMIT = 120;
const WEBHOOK_SLUG_RATE_LIMIT = 30;
const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const WEBHOOK_RATE_LIMIT_MAX_ENTRIES = 10_000;
type WebhookRateLimitBucket = {
  count: number;
  resetAt: number;
};
const webhookRateLimits = new Map<string, WebhookRateLimitBucket>();

export async function handleAutomationTasks(request: Request) {
  const body = await readAutomationBody(request);

  if ("response" in body) {
    return body.response;
  }

  const auth = { request, wallet: body.wallet ?? {} };

  try {
    if (!body.action || body.action === "list") {
      return Response.json(await readAutomationDashboard(auth));
    }

    if (body.action === "create") {
      return Response.json({
        configured: true,
        task: await createAutomationTask(auth, body.task ?? {}),
      });
    }

    if (body.action === "update") {
      return Response.json({
        configured: true,
        task: await updateAutomationTask(
          auth,
          body.taskId,
          body.task ?? {}
        ),
      });
    }

    if (body.action === "pause") {
      return Response.json({
        configured: true,
        task: await updateAutomationTask(auth, body.taskId, {
          status: "paused",
        }),
      });
    }

    if (body.action === "resume") {
      return Response.json({
        configured: true,
        task: await updateAutomationTask(auth, body.taskId, {
          status: "active",
        }),
      });
    }

    if (body.action === "delete") {
      return Response.json({
        configured: true,
        ...(await deleteAutomationTask(auth, body.taskId)),
      });
    }

    if (body.action === "pause-all") {
      return Response.json({
        configured: true,
        tasks: await setAllAutomationStatus(auth, "paused"),
      });
    }

    if (body.action === "resume-all") {
      return Response.json({
        configured: true,
        tasks: await setAllAutomationStatus(auth, "active"),
      });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function handleAutomationRuns(request: Request) {
  const body = await readAutomationBody(request);

  if ("response" in body) {
    return body.response;
  }

  const auth = { request, wallet: body.wallet ?? {} };

  try {
    if (!body.action || body.action === "list") {
      return Response.json({
        configured: true,
        runs: await readAutomationRuns(auth, body.taskId),
      });
    }

    if (body.action === "run") {
      return Response.json({
        configured: true,
        run: await runAutomationTask(
          auth,
          body.taskId,
          readTriggeredBy(body.triggeredBy)
        ),
      });
    }

    if (body.action === "tick") {
      return Response.json({
        configured: true,
        runs: await runDueAutomationTasks(auth, body.limit),
      });
    }

    if (body.action === "event") {
      return Response.json({
        configured: true,
        runs: await runAutomationEvent(
          auth,
          body.eventName,
          body.payload,
          body.limit
        ),
      });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function handleAutomationSettings(request: Request) {
  const body = await readAutomationBody(request);

  if ("response" in body) {
    return body.response;
  }

  const auth = { request, wallet: body.wallet ?? {} };

  try {
    if (!body.action || body.action === "get") {
      return Response.json({
        configured: true,
        settings: await readAutomationSettings(auth),
      });
    }

    if (body.action === "update") {
      return Response.json({
        configured: true,
        settings: await updateAutomationSettings(
          auth,
          body.settings ?? {}
        ),
      });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function handleAutomationNotifications(request: Request) {
  const body = await readAutomationBody(request);

  if ("response" in body) {
    return body.response;
  }

  const auth = { request, wallet: body.wallet ?? {} };

  try {
    if (body.action === "request-email-link") {
      return Response.json({
        configured: true,
        link: await requestNotificationEmailLink(auth, body.email),
      });
    }

    if (body.action === "verify-email-link") {
      return Response.json({
        configured: true,
        settings: await verifyNotificationEmailLink(
          auth,
          body.code
        ),
      });
    }

    if (body.action === "unlink-email") {
      return Response.json({
        configured: true,
        settings: await unlinkNotificationEmail(auth),
      });
    }

    if (body.action === "create-telegram-link") {
      return Response.json({
        configured: true,
        link: await createTelegramLinkCode(auth),
      });
    }

    if (body.action === "poll-telegram-link") {
      return Response.json({
        configured: true,
        ...(await pollTelegramLink(auth)),
      });
    }

    if (body.action === "unlink-telegram") {
      return Response.json({
        configured: true,
        settings: await unlinkTelegramLink(auth),
      });
    }

    if (body.action === "list-in-app") {
      return Response.json({
        configured: true,
        notifications: await readInAppAutomationNotifications(auth, body.limit),
      });
    }

    if (body.action === "mark-in-app-read") {
      return Response.json({
        configured: true,
        notification: await markInAppAutomationNotificationRead(
          auth,
          body.notificationId
        ),
      });
    }

    if (body.action === "mark-all-in-app-read") {
      return Response.json({
        configured: true,
        ...(await markAllInAppAutomationNotificationsRead(auth)),
      });
    }

    return Response.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function handleAutomationWebhook(request: Request, slug: string) {
  const rateLimitResponse = checkAutomationWebhookRateLimit(request, slug);

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const payload = await readOptionalJsonBody(request);

  if ("response" in payload) {
    return payload.response;
  }

  try {
    return Response.json({
      configured: true,
      run: await runAutomationWebhook(slug, payload.value),
    });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

export async function handleAutomationTelegramWebhook(request: Request) {
  let update: unknown;

  try {
    update = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  try {
    return Response.json({
      configured: true,
      ...(await processTelegramWebhookUpdate(update)),
    });
  } catch (error) {
    return automationErrorResponse(error);
  }
}

async function readAutomationBody(
  request: Request
): Promise<AutomationBody | { response: Response }> {
  try {
    const body = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TypeError("Automation request body must be an object.");
    }

    const record = body as Record<string, unknown>;

    for (const field of ["task", "settings"] as const) {
      if (
        field in record &&
        (!record[field] ||
          typeof record[field] !== "object" ||
          Array.isArray(record[field]))
      ) {
        return {
          response: Response.json(
            { error: `${field} must be a JSON object.` },
            { status: 400 }
          ),
        };
      }
    }

    return body as AutomationBody;
  } catch {
    return {
      response: Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 }
      ),
    };
  }
}

async function readOptionalJsonBody(
  request: Request
): Promise<{ value: unknown } | { response: Response }> {
  const contentLength = Number(request.headers.get("content-length") || "0");

  if (
    Number.isFinite(contentLength) &&
    contentLength > AUTOMATION_WEBHOOK_BODY_LIMIT_BYTES
  ) {
    return {
      response: Response.json(
        { error: "Automation webhook payload is too large." },
        { status: 413 }
      ),
    };
  }

  const text = await request.text();

  if (
    new TextEncoder().encode(text).byteLength >
    AUTOMATION_WEBHOOK_BODY_LIMIT_BYTES
  ) {
    return {
      response: Response.json(
        { error: "Automation webhook payload is too large." },
        { status: 413 }
      ),
    };
  }

  if (!text.trim()) {
    return { value: undefined };
  }

  try {
    return { value: JSON.parse(text) };
  } catch {
    return {
      response: Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 }
      ),
    };
  }
}

function checkAutomationWebhookRateLimit(request: Request, slug: string) {
  const clientId = readWebhookClientId(request);
  const clientLimit = incrementWebhookRateLimit(
    `client:${clientId}`,
    WEBHOOK_CLIENT_RATE_LIMIT
  );

  if (clientLimit) {
    return clientLimit;
  }

  return incrementWebhookRateLimit(
    `client-slug:${clientId}:${slug.toLowerCase()}`,
    WEBHOOK_SLUG_RATE_LIMIT
  );
}

export function incrementWebhookRateLimit(
  key: string,
  limit: number,
  options: {
    buckets?: Map<string, WebhookRateLimitBucket>;
    maxEntries?: number;
    now?: number;
    windowMs?: number;
  } = {}
) {
  const buckets = options.buckets ?? webhookRateLimits;
  const maxEntries = options.maxEntries ?? WEBHOOK_RATE_LIMIT_MAX_ENTRIES;
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? WEBHOOK_RATE_LIMIT_WINDOW_MS;
  const current = buckets.get(key);

  if (!current && buckets.size >= maxEntries) {
    for (const [storedKey, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(storedKey);
      }
    }

    if (buckets.size >= maxEntries) {
      const earliestReset = Math.min(
        ...Array.from(buckets.values(), (bucket) => bucket.resetAt)
      );

      return createWebhookRateLimitResponse(earliestReset, now);
    }
  }

  const bucket =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  if (bucket.count <= limit) {
    return null;
  }

  return createWebhookRateLimitResponse(bucket.resetAt, now);
}

function createWebhookRateLimitResponse(resetAt: number, now: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));

  return Response.json(
    { error: "Too many automation webhook requests." },
    {
      headers: {
        "Retry-After": String(retryAfter),
      },
      status: 429,
    }
  );
}

function readWebhookClientId(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function readTriggeredBy(value: unknown): AutomationTriggeredBy {
  if (
    value === "schedule" ||
    value === "event" ||
    value === "webhook" ||
    value === "manual" ||
    value === "system"
  ) {
    return value;
  }

  return "manual";
}
