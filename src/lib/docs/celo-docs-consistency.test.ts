import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const readmePath = path.join(backendRoot, "README.md");
const eligibilityPath = path.join(backendRoot, "docs", "CELO_ELIGIBILITY.md");
const hackathonSubmissionPath = path.join(
  backendRoot,
  "docs",
  "HACKATHON_SUBMISSION.md"
);
const smartContractNotesPath = path.join(
  backendRoot,
  "docs",
  "SMART_CONTRACT_TEAM_NOTES.md"
);
const campaignProgressJune10Path = path.join(
  backendRoot,
  "docs",
  "CAMPAIGN_PROGRESS_2026-06-10.md"
);

const sourceFiles = [
  { label: "README", path: readmePath },
  { label: "CELO_ELIGIBILITY", path: eligibilityPath },
  {
    label: "HACKATHON_SUBMISSION",
    path: hackathonSubmissionPath,
  },
  {
    label: "SMART_CONTRACT_TEAM_NOTES",
    path: smartContractNotesPath,
    extraClaims: [
      "github-backend-433b125-2026-06-08",
      "https://github.com/Langclaw-AI-Celo/backend/commit/433b12562c6472dae9e3ff5a1286596a0420eaeb",
    ],
  },
  {
    label: "CAMPAIGN_PROGRESS_2026-06-10",
    path: campaignProgressJune10Path,
    extraClaims: [
      "Monorepo workspace",
      "5e5417c",
      "single-root local checkout",
      "github-backend-433b125-2026-06-08",
      "https://github.com/Langclaw-AI-Celo/backend/commit/433b12562c6472dae9e3ff5a1286596a0420eaeb",
    ],
  },
];

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
  "Decision `#47`",
  "campaign-backend-proof",
  "Decision `#1`",
  "smart-money",
];

test("backend Celo runbook docs stay aligned on live proof claims", () => {
  for (const file of sourceFiles) {
    const source = readFileSync(file.path, "utf8");

    for (const claim of expectedClaims) {
      assert.ok(
        source.includes(claim),
        `Expected ${file.label} to include ${claim}`
      );
    }

    for (const claim of file.extraClaims ?? []) {
      assert.ok(
        source.includes(claim),
        `Expected ${file.label} to include ${claim}`
      );
    }
  }
});
