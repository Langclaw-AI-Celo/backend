import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const repoRoot = path.resolve(backendRoot, "..");
const githubReadmePath = path.join(repoRoot, ".github/README.md");
const githubProfileReadmePath = path.join(repoRoot, ".github/profile/README.md");

const expectedClaims = [
  "0xe69755e4249c4978c39fbe847ca9674ce7af3505",
  "0x69984c20176704685236fd633192d7de1c13a5ec",
  "0x837a2948586de4e7638c742f99e520ffc049bcf7",
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  "0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c",
  "9109",
  "133",
  "0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3",
  "0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6",
  "0x4485061e6e6151bc51c106f025b7d062468121595ca5cb4198f7307ea5ec5f06",
  "0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211",
  "campaign-backend-proof",
  "smart-money",
  "github-backend-650d33c-2026-06-06",
  "https://github.com/Langclaw-AI-Celo/backend/commit/650d33c80a2a54c5a706c79722a6eeeaa5dd4fd8",
];

const maintenanceReadmeClaims = [
  "single git root",
  "git status --short .github backend contracts frontend",
  "git rev-parse --short HEAD",
];

for (const [label, filePath] of [
  [".github README", githubReadmePath],
  [".github profile README", githubProfileReadmePath],
] as const) {
  test(`${label} stays aligned with live public Celo proof references`, () => {
    const source = readFileSync(filePath, "utf8");

    for (const claim of expectedClaims) {
      assert.ok(source.includes(claim), `Expected ${label} to include ${claim}`);
    }
  });
}

test(".github maintenance README documents the current local checkout shape", () => {
  const source = readFileSync(githubReadmePath, "utf8");

  for (const claim of maintenanceReadmeClaims) {
    assert.ok(
      source.includes(claim),
      `Expected .github maintenance README to include ${claim}`
    );
  }
});
