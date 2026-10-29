// scripts/coverage_sidecar.ts is retired: every line must stay a comment or blank.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the retired coverage_sidecar script holds only comments", () => {
    const lines = readFileSync(new URL("../scripts/coverage_sidecar.ts", import.meta.url), "utf8").split("\n");
    const codeLines = lines.filter((line) => line.trim() !== "" && !line.trim().startsWith("//"));
    assert.deepEqual(codeLines, []);
});
