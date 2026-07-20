import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportDirectory = new URL("./report/", import.meta.url);
const reportFacade = new URL("./report.ts", import.meta.url);

const expectedModules = [
  "types.ts",
  "core.ts",
  "markdown.ts",
  "smart-money.ts",
  "liquidity.ts",
  "defi-yield.ts",
  "token-discovery.ts",
  "market-brief.ts",
];
const featureModules = expectedModules.filter(
  (moduleName) => !["types.ts", "core.ts"].includes(moduleName)
);

test("keeps report decomposition modules present", async () => {
  for (const moduleName of expectedModules) {
    const source = await readFile(new URL(moduleName, reportDirectory), "utf8");
    assert.ok(source.trim().length > 0, `${moduleName} must contain implementation`);
  }
});

test("keeps report features independent from the facade", async () => {
  for (const moduleName of featureModules) {
    const source = await readFile(new URL(moduleName, reportDirectory), "utf8");
    const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g)).map(
      (match) => match[1]
    );

    assert.deepEqual(
      imports.filter((specifier) => !["./types", "./core"].includes(specifier)),
      [],
      `${moduleName} may only import report types and core`
    );
  }
});

test("keeps the public report facade focused on delegation", async () => {
  const source = await readFile(reportFacade, "utf8");

  assert.ok(source.split("\n").length <= 100, "report facade must stay compact");
  assert.doesNotMatch(source, /function (?:infer|normalize|collect|format|derive)/);
});
