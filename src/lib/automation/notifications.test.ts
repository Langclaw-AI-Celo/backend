import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlphaSignalNotificationMessage,
  buildAutomationNotificationMessage,
  resolveNotificationChannels,
  sendAlphaSignalNotification,
  sendAutomationEmail,
  sendAutomationRunNotification,
} from "./notifications";
import type { AlphaSignal, ResearchReport } from "../langclaw/types";
import type { OnChainToolFinalPayload } from "../onchain-tools/types";
import { mockFetch, withEnv } from "../../test/helpers";
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
    "Langclaw Celo alert Skipped: Usage digest sync"
  );
  assert.match(message.text, /Project: Langclaw Website/);
  assert.match(message.text, /Reason: Daily automation MNT limit reached\./);
});

test("rich alpha signal notification includes target, warning, proof, and action", () => {
  const alphaSignal = buildTestAlphaSignal();
  const message = buildAlphaSignalNotificationMessage({
    alphaSignal,
    completedAt: "2026-05-24T12:00:00.000Z",
    onChain: buildTestOnChainPayload(),
    project: "Celo Alpha Sentinel",
    proof: {
      chain: {
        chain: "mantle",
        chainName: "Mantle",
        briefHash: "0xbrief",
        decisionId: "194",
        explorerUrl: "https://explorer.mantle.xyz/tx/0xabc",
        status: "anchored",
        txHash: "0xabc",
      },
      storage: {
        evidenceUri: "langclaw://evidence/run/hash",
        status: "prepared",
      },
    },
    report: buildTestReport(),
    runId: "run-alpha-1",
    taskName: "Mantle smart-money scan",
  });

  assert.equal(message.subject, "Langclaw Alpha Alert: Smart Money on Mantle");
  assert.match(message.text, /Target: 0xbdb3\.\.\.47b6, MNT, CEX withdrawal/);
  assert.match(message.text, /Confidence: high, 82\/100/);
  assert.match(message.text, /Why now: Dune returned usable wallet-flow evidence\./);
  assert.match(message.text, /Warnings: 1, provider gap/);
  assert.match(message.text, /Proof: anchored, decision 194/);
  assert.match(message.text, /TX: https:\/\/explorer\.mantle\.xyz\/tx\/0xabc/);
  assert.match(message.text, /Action: Review candidate wallets before escalation\./);
  assert.match(message.text, /Run: run-alpha-1/);
});

test("alpha signal notification falls back to minimal message without report context", () => {
  const message = buildAlphaSignalNotificationMessage({
    alphaSignal: buildTestAlphaSignal(),
    completedAt: "2026-05-24T12:00:00.000Z",
    project: "Celo Alpha Sentinel",
    proof: {
      chain: {
        briefHash: "0xbrief",
        status: "anchored",
      },
      storage: {
        evidenceUri: "langclaw://evidence/run/hash",
        status: "prepared",
      },
    },
    runId: "run-alpha-1",
    taskName: "Mantle smart-money scan",
  });

  assert.equal(message.subject, "Langclaw Alpha Alert: smart-money");
  assert.match(message.text, /Quality score: 82\/100/);
  assert.match(message.text, /Proof: anchored/);
  assert.match(message.text, /Run ID: run-alpha-1/);
});

test("alpha signal Telegram notification is disabled unless the flag is enabled", async () => {
  await withEnv({ LANGCLAW_ALPHA_ALERTS_ENABLED: undefined }, async () => {
    const notification = await sendAlphaSignalNotification({
      alphaSignal: buildTestAlphaSignal(),
      project: "Celo Alpha Sentinel",
      runId: "run-alpha-1",
      settings,
      taskName: "Mantle smart-money scan",
    });

    assert.deepEqual(notification, {
      channel: "none",
      reason: "LANGCLAW_ALPHA_ALERTS_ENABLED is not true.",
      status: "disabled",
    });
  });
});

test("alpha signal Telegram notification posts when enabled", async () => {
  let requestBody: unknown;
  let requestSignal: AbortSignal | null | undefined;
  const restoreFetch = mockFetch((_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    requestSignal = init?.signal;

    return new Response("{}", { status: 200 });
  });

  try {
    await withEnv(
      {
        LANGCLAW_ALPHA_ALERTS_ENABLED: "true",
        LANGCLAW_TELEGRAM_BOT_TOKEN: "test-token",
      },
      async () => {
        const notification = await sendAlphaSignalNotification({
          alphaSignal: buildTestAlphaSignal(),
          project: "Celo Alpha Sentinel",
          runId: "run-alpha-1",
          settings,
          taskName: "Mantle smart-money scan",
        });

        const body = requestBody as {
          chat_id: string;
          disable_web_page_preview: boolean;
          text: string;
        };

        assert.equal(notification.status, "sent");
        assert.equal(body.chat_id, "123");
        assert.equal(body.disable_web_page_preview, true);
        assert.match(body.text, /Langclaw Alpha Alert: smart-money/);
        assert.ok(requestSignal instanceof AbortSignal);
      }
    );
  } finally {
    restoreFetch();
  }
});

test("alpha signal Telegram notification reports provider failures", async () => {
  const restoreFetch = mockFetch(() =>
    new Response("upstream unavailable", { status: 502 }));

  try {
    await withEnv(
      {
        LANGCLAW_ALPHA_ALERTS_ENABLED: "true",
        LANGCLAW_TELEGRAM_BOT_TOKEN: "test-token",
      },
      async () => {
        const notification = await sendAlphaSignalNotification({
          alphaSignal: buildTestAlphaSignal(),
          project: "Celo Alpha Sentinel",
          runId: "run-alpha-failed",
          settings,
          taskName: "Celo smart-money scan",
        });

        assert.equal(notification.status, "failed");
        assert.equal(
          notification.error,
          "Telegram notification failed with 502.",
        );
      }
    );
  } finally {
    restoreFetch();
  }
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

function buildTestAlphaSignal(): AlphaSignal {
  return {
    alertEligible: true,
    generatedAt: "2026-05-24T12:00:00.000Z",
    quality: {
      alertEligible: true,
      evidenceCount: 4,
      falsePositiveChecks: [
        {
          id: "celo_product_chain",
          label: "Celo product chain",
          reason: "The decision is scoped to Celo.",
          status: "pass",
        },
        {
          id: "provider_gap_guard",
          label: "Provider gap guard",
          reason: "No blocking provider gap was detected.",
          status: "warn",
        },
      ],
      label: "high",
      reasons: ["Quality score 82/100 is high."],
      score: 82,
      sourceCoverage: {
        directWalletFlow: true,
        onchain: true,
        proof: true,
        providerCount: 2,
        social: true,
      },
    },
    schema: "langclaw.alpha-signal.v1",
    signalType: "smart-money",
  };
}

function buildTestReport(): ResearchReport {
  return {
    asOfUtc: "2026-05-24T12:00:00.000Z",
    bottomLine: "Direct wallet-flow evidence supports a Mantle alpha watch.",
    caveats: [],
    confidence: "high",
    entities: [
      {
        category: "candidate-smart-money",
        id: "wallet-1",
        label: "0xbdb3...47b6",
        metrics: {
          signal: "CEX withdrawal",
          token: "MNT",
        },
        rank: 1,
        severity: "high",
        sourceIds: [],
        summary: "Candidate smart-money wallet-flow.",
        toolIds: ["smart_money.surf_smart_money_research"],
      },
    ],
    executiveSummary: "Dune returned row-level Mantle wallet-flow evidence.",
    kind: "smart-money",
    recommendations: ["Review candidate wallets before escalation."],
    sections: [],
    tables: [
      {
        columns: ["Wallet", "Token", "Signal"],
        id: "smart-money-table",
        rows: [
          {
            Signal: "CEX withdrawal",
            Token: "MNT",
            Wallet: "0xbdb3...47b6",
          },
        ],
        title: "Candidate Smart-Money Wallets",
      },
    ],
    title: "Mantle Smart-Money Accumulation Watch",
  };
}

function buildTestOnChainPayload(): OnChainToolFinalPayload {
  return {
    answer: "Dune returned row-level Mantle wallet-flow evidence.",
    bullets: [],
    caveat: "Analysis only.",
    generatedAt: "2026-05-24T12:00:00.000Z",
    plan: {
      analysisSource: "prompt",
      chain: "mantle",
      chainId: 5000,
      chainName: "Mantle",
      commands: [],
      domainCount: 14,
      intent: "smart-money",
      nativeSymbol: "MNT",
      productChain: "mantle",
      productChainId: 5000,
      productChainName: "Mantle",
      registryCommandCount: 84,
    },
    recommendation: "Review candidate wallets before escalation.",
    title: "Mantle smart-money report",
    tools: [
      {
        attemptedProviders: ["surf", "dune"],
        commandId: "smart_money.surf_smart_money_research",
        domain: "smart_money",
        latencyMs: 100,
        provider: "dune",
        status: "success",
        summary: "Dune returned row-level Mantle wallet-flow evidence.",
        title: "Surf smart-money research",
      },
    ],
  };
}

test("sendAutomationEmail posts the requested payload to Resend", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
  let requestBody: unknown;
  let requestSignal: AbortSignal | null | undefined;

  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    requestSignal = init?.signal;

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
    assert.ok(requestSignal instanceof AbortSignal);
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

test("run notifications fail when every configured provider rejects", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.LANGCLAW_AUTOMATION_EMAIL_FROM;
  const originalToken = process.env.LANGCLAW_TELEGRAM_BOT_TOKEN;

  globalThis.fetch = (async () =>
    new Response("provider unavailable", { status: 503 })) as typeof fetch;
  process.env.RESEND_API_KEY = "test-api-key";
  process.env.LANGCLAW_AUTOMATION_EMAIL_FROM = "alerts@example.com";
  process.env.LANGCLAW_TELEGRAM_BOT_TOKEN = "test-token";

  try {
    await assert.rejects(
      sendAutomationRunNotification({
        error: "Scheduled scan failed.",
        project: "Langclaw Website",
        runId: "run-provider-failure",
        settings,
        status: "failed",
        taskName: "Celo smart-money scan",
        triggeredBy: "schedule",
      }),
      /All automation notification channels failed/,
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
    if (originalToken === undefined) {
      delete process.env.LANGCLAW_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.LANGCLAW_TELEGRAM_BOT_TOKEN = originalToken;
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

test("notification formatting covers duration and rich-summary fallbacks", () => {
  const fast = buildAutomationNotificationMessage({
    durationMs: 500,
    project: "Langclaw Website",
    runId: "run-fast",
    status: "failed",
    taskName: "Fast scan",
    triggeredBy: "manual",
  });
  const long = buildAutomationNotificationMessage({
    durationMs: 120000,
    project: "Langclaw Website",
    runId: "run-long",
    status: "failed",
    taskName: "Long scan",
    triggeredBy: "webhook",
  });
  const unknown = buildAutomationNotificationMessage({
    project: "Langclaw Website",
    runId: "run-unknown",
    status: "skipped",
    taskName: "Unknown scan",
    triggeredBy: "event",
  });

  assert.match(fast.text, /Duration: 500ms/);
  assert.match(long.text, /Duration: 2m/);
  assert.match(unknown.text, /Duration: unknown/);
  assert.doesNotMatch(fast.text, /Reason:/);

  const alphaSignal: AlphaSignal = {
    ...buildTestAlphaSignal(),
    quality: {
      ...buildTestAlphaSignal().quality,
      falsePositiveChecks: [
        {
          id: "external_low_confidence_guard",
          label: "External low confidence guard",
          reason: "External context needs review.",
          status: "warn",
        },
        {
          id: "custom_guard",
          label: "CUSTOM GUARD",
          reason: "Custom review is required.",
          status: "warn",
        },
      ],
      sourceCoverage: {
        directWalletFlow: false,
        onchain: false,
        proof: false,
        providerCount: 1,
        social: false,
      },
    },
    signalType: "liquidity-anomaly",
  };
  const tableReport: ResearchReport = {
    ...buildTestReport(),
    entities: [],
    recommendations: ["Review ".repeat(40)],
  };
  const fallbackTool: OnChainToolFinalPayload = {
    ...buildTestOnChainPayload(),
    tools: [
      {
        commandId: "smart-money-failed",
        domain: "smart_money",
        latencyMs: 1,
        provider: "surf",
        status: "failed",
        summary: "No result.",
        title: "Failed smart money",
      },
      {
        commandId: "market-success",
        domain: "market",
        latencyMs: 1,
        provider: "geckoterminal",
        status: "success",
        summary: "Market result.",
        title: "Market result",
      },
    ],
  };
  const tableMessage = buildAlphaSignalNotificationMessage({
    alphaSignal,
    onChain: fallbackTool,
    project: "Celo Alpha Sentinel",
    proof: {
      chain: {
        briefHash: "0xbrief",
        chain: "celo",
        status: "prepared",
        txHash: "0xtx",
      },
      storage: { evidenceUri: "langclaw://evidence/run/hash", status: "prepared" },
    },
    report: tableReport,
    runId: "run-table",
    taskName: "Celo market scan",
  });

  assert.match(tableMessage.subject, /Liquidity Anomaly on Celo/);
  assert.match(tableMessage.text, /Target: 0xbdb3\.\.\.47b6, MNT, CEX withdrawal/);
  assert.match(tableMessage.text, /Geckoterminal returned usable on-chain evidence/);
  assert.match(tableMessage.text, /limited coverage/);
  assert.match(tableMessage.text, /supplemental external context and custom guard/);
  assert.match(tableMessage.text, /TX: 0xtx/);
  assert.match(tableMessage.text, /Action: .*\.\.\./);

  const emptyReport: ResearchReport = {
    ...buildTestReport(),
    bottomLine: "",
    entities: [],
    executiveSummary: "",
    recommendations: [],
    tables: [],
  };
  const emptyMessage = buildAlphaSignalNotificationMessage({
    alphaSignal: {
      ...buildTestAlphaSignal(),
      quality: {
        ...buildTestAlphaSignal().quality,
        falsePositiveChecks: [],
      },
    },
    onChain: { ...buildTestOnChainPayload(), tools: [] },
    project: "Celo Alpha Sentinel",
    report: emptyReport,
    runId: "run-empty",
    taskName: "Celo empty scan",
  });
  assert.match(emptyMessage.text, /Target: Mantle alpha candidate/);
  assert.match(emptyMessage.text, /Warnings: 0/);
  assert.match(emptyMessage.text, /Proof: unknown/);
  assert.match(emptyMessage.text, /Review candidate wallets before escalation/);
  assert.match(emptyMessage.text, /alpha quality gate passed/);
});

test("alpha notifications skip ineligible and incomplete Telegram targets", async () => {
  await withEnv(
    {
      LANGCLAW_ALPHA_ALERTS_ENABLED: "true",
      LANGCLAW_AUTOMATION_TELEGRAM_CHAT_ID: undefined,
      LANGCLAW_TELEGRAM_BOT_TOKEN: undefined,
    },
    async () => {
    const ineligible = await sendAlphaSignalNotification({
      alphaSignal: {
        ...buildTestAlphaSignal(),
        alertEligible: false,
        quality: {
          ...buildTestAlphaSignal().quality,
          reasons: [],
        },
      },
      project: "Celo Alpha Sentinel",
      runId: "run-ineligible",
      settings,
      taskName: "Celo scan",
    });
    const incomplete = await sendAlphaSignalNotification({
      alphaSignal: buildTestAlphaSignal(),
      project: "Celo Alpha Sentinel",
      runId: "run-incomplete",
      settings: {
        ...settings,
        telegramChatId: undefined,
        telegramVerified: false,
      },
      taskName: "Celo scan",
    });

    assert.equal(ineligible.status, "skipped");
    assert.equal(ineligible.reason, "Alpha signal is not alert eligible.");
    assert.equal(incomplete.status, "skipped");
    assert.match(incomplete.reason ?? "", /bot token or chat id is not configured/);
    }
  );
});

test("run notification and email guards cover empty channels and provider details", async () => {
  await sendAutomationRunNotification({
    project: "Langclaw Website",
    runId: "run-success",
    settings,
    status: "success",
    taskName: "Successful scan",
    triggeredBy: "manual",
  });
  await sendAutomationRunNotification({
    project: "Langclaw Website",
    runId: "run-empty-channels",
    settings: {
      ...settings,
      notificationChannels: ["in-app"],
    },
    status: "failed",
    taskName: "No channel scan",
    triggeredBy: "manual",
  });
  assert.deepEqual(
    resolveNotificationChannels({ ...settings, notificationChannels: [] }),
    ["email"]
  );

  await withEnv(
    {
      LANGCLAW_AUTOMATION_EMAIL_FROM: undefined,
      RESEND_API_KEY: undefined,
      RESEND_EMAIL_FROM: undefined,
      RESEND_FROM_EMAIL: undefined,
    },
    async () => {
    await assert.rejects(
      sendAutomationEmail({
        requireConfigured: true,
        subject: "Missing API key",
        text: "test",
        to: "user@example.com",
      }),
      /RESEND_API_KEY is not configured/
    );

    process.env.RESEND_API_KEY = "test-api-key";
    process.env.RESEND_EMAIL_FROM = "fallback@example.com";
    await assert.rejects(
      sendAutomationEmail({
        requireConfigured: true,
        subject: "Missing recipient",
        text: "test",
      }),
      /verified notification email is required/
    );

    const responses = [
      new Response(JSON.stringify({ error: "provider error" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }),
      new Response("{invalid", {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }),
      new Response("", { status: 500 }),
    ];
    let responseIndex = 0;
    const restoreProviderFetch = mockFetch(async () => {
      const response = responses[responseIndex];
      responseIndex += 1;
      return response;
    });

    try {
      await assert.rejects(
        sendAutomationEmail({ subject: "JSON error", text: "test", to: "user@example.com" }),
        /Email notification failed with 500: provider error/
      );
      await assert.rejects(
        sendAutomationEmail({ subject: "Invalid JSON", text: "test", to: "user@example.com" }),
        /Email notification failed with 500: \{invalid/
      );
      await assert.rejects(
        sendAutomationEmail({ subject: "Empty error", text: "test", to: "user@example.com" }),
        /Email notification failed with 500\./
      );
    } finally {
      restoreProviderFetch();
    }

    delete process.env.RESEND_EMAIL_FROM;
    process.env.RESEND_FROM_EMAIL = "legacy@example.com";
    const restoreSuccessFetch = mockFetch(() => new Response("{}", { status: 200 }));

    try {
      await sendAutomationEmail({ subject: "Legacy sender", text: "test", to: "user@example.com" });
    } finally {
      restoreSuccessFetch();
    }
    }
  );
});

test("notification summaries cover compact entity, table, warning, and proof variants", () => {
  const minimalSignal: AlphaSignal = {
    ...buildTestAlphaSignal(),
    quality: {
      ...buildTestAlphaSignal().quality,
      falsePositiveChecks: [
        {
          id: "failed_guard",
          label: "Failed guard",
          reason: "Guard failed.",
          status: "fail",
        },
      ],
      reasons: [],
    },
  };
  const minimal = buildAlphaSignalNotificationMessage({
    alphaSignal: minimalSignal,
    project: "Celo Alpha Sentinel",
    runId: "run-minimal-variants",
    taskName: "Celo scan",
  });
  assert.match(minimal.text, /0 pass, 0 warn, 1 fail/);
  assert.doesNotMatch(minimal.text, /Reason:/);
  assert.match(minimal.text, /Proof: unknown/);

  const entityReport: ResearchReport = {
    ...buildTestReport(),
    entities: [
      {
        ...buildTestReport().entities[0],
        label: "wallet-only",
        metrics: {},
      },
    ],
  };
  const entityMessage = buildAlphaSignalNotificationMessage({
    alphaSignal: buildTestAlphaSignal(),
    onChain: {
      ...buildTestOnChainPayload(),
      tools: [{ ...buildTestOnChainPayload().tools[0], provider: "surf" }],
    },
    project: "Celo Alpha Sentinel",
    proof: {
      chain: { briefHash: "0xbrief", chain: "mantle", status: "prepared" },
      storage: { evidenceUri: "langclaw://evidence/run/hash", status: "prepared" },
    },
    report: entityReport,
    runId: "run-entity-variants",
    taskName: "Mantle scan",
  });
  assert.match(entityMessage.text, /Target: wallet-only/);
  assert.match(entityMessage.text, /Surf returned usable wallet-flow evidence/);
  assert.match(entityMessage.subject, /on Mantle/);

  const tableReport: ResearchReport = {
    ...buildTestReport(),
    entities: [],
    tables: [
      {
        columns: ["wallet", "token", "signal"],
        id: "smart-money-table",
        rows: [{ signal: "DEX buy", token: "CELO", wallet: "0xwallet" }],
        title: "Candidate wallets",
      },
    ],
  };
  const threeWarnings: AlphaSignal = {
    ...buildTestAlphaSignal(),
    quality: {
      ...buildTestAlphaSignal().quality,
      falsePositiveChecks: [
        { id: "one", label: "FIRST", reason: "One.", status: "warn" },
        { id: "two", label: "SECOND", reason: "Two.", status: "warn" },
        { id: "three", label: "THIRD", reason: "Three.", status: "warn" },
      ],
    },
  };
  const tableMessage = buildAlphaSignalNotificationMessage({
    alphaSignal: threeWarnings,
    onChain: { ...buildTestOnChainPayload(), tools: [] },
    project: "Celo Alpha Sentinel",
    proof: {
      chain: { briefHash: "0xbrief", chain: "arbitrum", status: "prepared" },
      storage: { evidenceUri: "langclaw://evidence/run/hash", status: "prepared" },
    },
    report: tableReport,
    runId: "run-table-variants",
    taskName: "Arbitrum scan",
  });
  assert.match(tableMessage.text, /Target: 0xwallet, CELO, DEX buy/);
  assert.match(tableMessage.text, /Warnings: 3, first, second, and third/);
  assert.match(tableMessage.subject, /on Arbitrum/);
});

test("alpha and email providers normalize non-Error and text failures", async () => {
  await withEnv(
    {
      LANGCLAW_ALPHA_ALERTS_ENABLED: "true",
      LANGCLAW_AUTOMATION_EMAIL_FROM: "alerts@example.com",
      LANGCLAW_AUTOMATION_TELEGRAM_CHAT_ID: "fallback-chat",
      LANGCLAW_TELEGRAM_BOT_TOKEN: "test-token",
      RESEND_API_KEY: "test-api-key",
    },
    async () => {
    const restoreTelegramFetch = mockFetch(async () => {
      throw "telegram failed";
    });

    try {
      const notification = await sendAlphaSignalNotification({
        alphaSignal: buildTestAlphaSignal(),
        project: "Celo Alpha Sentinel",
        runId: "run-string-error",
        settings: { ...settings, telegramChatId: undefined, telegramVerified: false },
        taskName: "Celo scan",
      });
      assert.equal(notification.error, "Telegram alpha alert failed.");
    } finally {
      restoreTelegramFetch();
    }

    const responses = [
      new Response(JSON.stringify({ name: "provider_name_error" }), {
        headers: { "Content-Type": "application/json" },
        status: 429,
      }),
      new Response("plain provider failure", { status: 502 }),
    ];
    let responseIndex = 0;
    const restoreEmailFetch = mockFetch(async () => {
      const response = responses[responseIndex];
      responseIndex += 1;
      return response;
    });

    try {
      await assert.rejects(
        sendAutomationEmail({ subject: "Named error", text: "test", to: "user@example.com" }),
        /Email notification failed with 429: provider_name_error/
      );
      await assert.rejects(
        sendAutomationEmail({ subject: "Text error", text: "test", to: "user@example.com" }),
        /Email notification failed with 502: plain provider failure/
      );
    } finally {
      restoreEmailFetch();
    }
    }
  );
});
