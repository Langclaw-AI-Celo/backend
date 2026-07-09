import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const repoRoot = path.resolve(backendRoot, "..");
const orgProfileRoot = path.join(repoRoot, "org-profile");
const githubReadmePath = path.join(orgProfileRoot, "README.md");
const githubProfileReadmePath = path.join(orgProfileRoot, "profile/README.md");

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
  "0xb50e7bd12af0cbca9a6246a80f1976da753d359fbd1553458712b43aa40681b1",
  "0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211",
  "campaign-backend-proof",
  "smart-money",
  "github-backend-433b125-2026-06-08",
  "https://github.com/Langclaw-AI-Celo/backend/commit/433b12562c6472dae9e3ff5a1286596a0420eaeb",
];

const maintenanceReadmeClaims = [
  "single git root",
  "git status --short org-profile backend contracts frontend",
  "node --import tsx --test src/lib/docs/github-profile-docs.test.ts src/lib/docs/github-profile-readme.test.ts",
  "git rev-parse --short HEAD",
];

const repoLinkClaims = [
  "https://github.com/Langclaw-AI-Celo/frontend",
  "https://github.com/Langclaw-AI-Celo/backend",
  "https://github.com/Langclaw-AI-Celo/contracts",
];

const verificationClaims = [
  "https://langclawcelo.vercel.app",
  "npm run check:eligibility",
  "npm run check:celo-proof",
  "pnpm typecheck",
  "pnpm build",
  "forge build",
  "forge test",
];

for (const [label, filePath] of [
  ["org-profile README", githubReadmePath],
  ["org-profile profile README", githubProfileReadmePath],
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

for (const [label, filePath] of [
  ["org-profile README", githubReadmePath],
  ["org-profile profile README", githubProfileReadmePath],
] as const) {
  test(`${label} keeps the live app URL and public repo links`, () => {
    const source = readFileSync(filePath, "utf8");

    assert.ok(
      source.includes("https://langclawcelo.vercel.app"),
      `Expected ${label} to keep the live app URL.`
    );

    for (const claim of repoLinkClaims) {
      assert.ok(source.includes(claim), `Expected ${label} to include ${claim}`);
    }
  });
}

test("org-profile profile README keeps the public verification commands", () => {
  const source = readFileSync(githubProfileReadmePath, "utf8");

  for (const claim of verificationClaims) {
    assert.ok(
      source.includes(claim),
      `Expected org-profile profile README to include ${claim}`
    );
  }
});
