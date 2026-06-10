import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(testDir, "../../..");
const githubReadmePath = path.resolve(backendRoot, "../.github/README.md");
const githubProfileReadmePath = path.resolve(
  backendRoot,
  "../.github/profile/README.md"
);

const expectedClaims = [
  "0xe69755e4249c4978c39fbe847ca9674ce7af3505",
  "0x69984c20176704685236fd633192d7de1c13a5ec",
  "0x837a2948586de4e7638c742f99e520ffc049bcf7",
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  "9109",
  "133",
  "0xb50e7bd12af0cbca9a6246a80f1976da753d359fbd1553458712b43aa40681b1",
  "0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211",
  "github-backend-433b125-2026-06-08",
  "default proof path prefers",
  "ERC-8004 campaign agent `9109`",
  "linked-proof",
  "human-verification flows",
];

test("GitHub profile docs stay aligned with the live Celo proof story", () => {
  for (const filePath of [githubReadmePath, githubProfileReadmePath]) {
    const source = readFileSync(filePath, "utf8");

    for (const claim of expectedClaims) {
      assert.ok(source.includes(claim), `Expected ${filePath} to include ${claim}`);
    }
  }
});
