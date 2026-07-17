import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

export type OrgProfilePaths = {
  profileReadmePath: string;
  readmePath: string;
  root: string;
};

type FileExists = (filePath: string) => boolean;

const missingOrgProfileMessage =
  "Clone Langclaw-AI-Celo/.github beside backend or set LANGCLAW_ORG_PROFILE_ROOT to run this cross-repository check.";

export function resolveOrgProfilePaths(
  backendRoot: string,
  configuredRoot = process.env.LANGCLAW_ORG_PROFILE_ROOT,
  fileExists: FileExists = existsSync,
): OrgProfilePaths | null {
  const candidateRoots = [
    configuredRoot,
    path.resolve(backendRoot, "../org-profile"),
    path.resolve(backendRoot, "../.github"),
  ];
  const visited = new Set<string>();

  for (const candidateRoot of candidateRoots) {
    if (!candidateRoot) {
      continue;
    }

    const root = path.resolve(candidateRoot);

    if (visited.has(root)) {
      continue;
    }

    visited.add(root);

    const readmePath = path.join(root, "README.md");
    const profileReadmePath = path.join(root, "profile/README.md");

    if (fileExists(readmePath) && fileExists(profileReadmePath)) {
      return {
        profileReadmePath,
        readmePath,
        root,
      };
    }
  }

  return null;
}

export function readOrgProfileSource(
  context: TestContext,
  filePath: string | undefined,
) {
  if (!filePath) {
    context.skip(missingOrgProfileMessage);
    return null;
  }

  return readFileSync(filePath, "utf8");
}
