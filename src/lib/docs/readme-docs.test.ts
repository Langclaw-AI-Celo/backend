import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const readmePath = path.join(backendRoot, "README.md");

function readReadme() {
  return readFileSync(readmePath, "utf8");
}

test("backend README lists the exact public HTTP routes", () => {
  const source = readReadme();
  const expectedRoutes = [
    "POST /api/usage/balance",
    "POST /api/usage/quote",
    "POST /api/usage/vault",
    "POST /api/usage/deposit/verify",
    "POST /api/usage/withdraw/request",
    "POST /api/automation/tasks",
    "POST /api/automation/runs",
    "POST /api/automation/settings",
    "POST /api/automation/notifications",
    "POST /api/automation/telegram/webhook",
    "POST /api/automation/webhooks/:slug",
    "POST /api/proofs/decisions",
    "POST /api/proofs/readiness",
    "POST /api/strategy/scan-pairs",
    "POST /api/strategy/backtest",
    "POST /api/strategy/paper-trade",
    "POST /api/strategy/runs",
  ];

  for (const route of expectedRoutes) {
    assert.ok(
      source.includes(route),
      `Expected backend README to document route: ${route}`
    );
  }
});

test("backend README deploy helper commands match package script defaults", () => {
  const source = readReadme();

  assert.ok(
    source.includes("npm run deploy:registry -- --chain mantle\\|celo --write-env"),
    "Expected registry deploy docs to keep the explicit --write-env flag."
  );
  assert.ok(
    source.includes("npm run deploy:usage-vault -- --chain mantle\\|celo"),
    "Expected usage-vault deploy docs to use the script's built-in env writer."
  );
  assert.ok(
    !source.includes("npm run deploy:usage-vault -- --chain mantle\\|celo --write-env"),
    "Expected usage-vault deploy docs not to duplicate --write-env."
  );
  assert.ok(
    source.includes("npm run deploy:trading-journal -- --chain mantle\\|celo"),
    "Expected trading-journal deploy docs to use the script's built-in env writer."
  );
  assert.ok(
    !source.includes("npm run deploy:trading-journal -- --chain mantle\\|celo --write-env"),
    "Expected trading-journal deploy docs not to duplicate --write-env."
  );
});
