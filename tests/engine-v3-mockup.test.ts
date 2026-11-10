// scripts/visual/engine-v3-mockup.ts boots Chrome at import, so only its npm wiring is testable here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("test_the_engine_v3_mockup_npm_script_runs_a_file_that_exists", () => {
    // Steps: read the npm script, take the file it runs, expect that file on disk.
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    const command = packageJson.scripts["visual:engine-v3-mockup"]!;
    const scriptPath = command.split(" ").at(-1)!;
    assert.equal(scriptPath, "scripts/visual/engine-v3-mockup.ts");
    assert.ok(existsSync(new URL(`../${scriptPath}`, import.meta.url)));
});
