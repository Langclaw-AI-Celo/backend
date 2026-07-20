import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportDirectory = new URL("./report/", import.meta.url);

const expectedModules = ["types.ts", "markdown.ts"];

test("keeps report decomposition modules present", async () => {
  for (const moduleName of expectedModules) {
    const source = await readFile(new URL(moduleName, reportDirectory), "utf8");
    assert.ok(source.trim().length > 0, `${moduleName} must contain implementation`);
  }
});
