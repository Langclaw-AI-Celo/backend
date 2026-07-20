import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as automationService from "./service";

const serviceDirectory = new URL("./service/", import.meta.url);
const serviceFacade = new URL("./service.ts", import.meta.url);

const expectedModules = [
  "types.ts",
  "core.ts",
  "input.ts",
  "mappers.ts",
  "math.ts",
  "linking.ts",
  "storage.ts",
  "runner.ts",
];
const featureModules = expectedModules.filter(
  (moduleName) => !["types.ts", "core.ts"].includes(moduleName)
);

test("keeps automation service modules present", async () => {
  for (const moduleName of expectedModules) {
    const source = await readFile(new URL(moduleName, serviceDirectory), "utf8");
    assert.ok(source.trim().length > 0, `${moduleName} must contain implementation`);
  }
});

test("keeps automation features independent from the facade", async () => {
  for (const moduleName of featureModules) {
    const source = await readFile(new URL(moduleName, serviceDirectory), "utf8");
    const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map(
      (match) => match[1]
    );

    assert.deepEqual(
      imports.filter((specifier) => !["./types", "./core"].includes(specifier)),
      [],
      `${moduleName} may only import automation service types and core`
    );
  }
});

test("keeps the automation facade focused on public operations", async () => {
  const source = await readFile(serviceFacade, "utf8");

  assert.ok(source.split("\n").length <= 500, "automation facade must stay compact");
  assert.doesNotMatch(source, /^(?:async )?function /m);
});

test("preserves the public automation service exports", () => {
  assert.deepEqual(Object.keys(automationService).sort(), [
    "AutomationHttpError",
    "automationErrorResponse",
    "createAutomationTask",
    "createTelegramLinkCode",
    "createWebhookSlug",
    "deleteAutomationTask",
    "markAllInAppAutomationNotificationsRead",
    "markInAppAutomationNotificationRead",
    "pollTelegramLink",
    "processTelegramWebhookUpdate",
    "readAutomationDashboard",
    "readAutomationRuns",
    "readAutomationSettings",
    "readInAppAutomationNotifications",
    "readTelegramCodeFromText",
    "requestNotificationEmailLink",
    "runAutomationEvent",
    "runAutomationTask",
    "runAutomationWebhook",
    "runDueAutomationTasks",
    "setAllAutomationStatus",
    "unlinkNotificationEmail",
    "unlinkTelegramLink",
    "updateAutomationSettings",
    "updateAutomationTask",
    "verifyNotificationEmailLink",
  ]);
});
