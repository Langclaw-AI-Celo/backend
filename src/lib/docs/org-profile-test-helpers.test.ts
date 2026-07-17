import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveOrgProfilePaths } from "./org-profile-test-helpers";

const backendRoot = path.resolve("/workspace/backend");

test("org profile resolver prefers an explicitly configured checkout", () => {
  const configuredRoot = path.resolve("/external/langclaw-profile");
  const existingFiles = new Set([
    path.join(configuredRoot, "README.md"),
    path.join(configuredRoot, "profile/README.md"),
  ]);

  assert.deepEqual(
    resolveOrgProfilePaths(
      backendRoot,
      configuredRoot,
      (filePath) => existingFiles.has(filePath),
    ),
    {
      profileReadmePath: path.join(configuredRoot, "profile/README.md"),
      readmePath: path.join(configuredRoot, "README.md"),
      root: configuredRoot,
    },
  );
});

test("org profile resolver supports the repository's .github name", () => {
  const githubRoot = path.resolve(backendRoot, "../.github");
  const existingFiles = new Set([
    path.join(githubRoot, "README.md"),
    path.join(githubRoot, "profile/README.md"),
  ]);

  assert.equal(
    resolveOrgProfilePaths(
      backendRoot,
      undefined,
      (filePath) => existingFiles.has(filePath),
    )?.root,
    githubRoot,
  );
});

test("org profile resolver returns null when no complete checkout exists", () => {
  assert.equal(
    resolveOrgProfilePaths(backendRoot, undefined, () => false),
    null,
  );
});
