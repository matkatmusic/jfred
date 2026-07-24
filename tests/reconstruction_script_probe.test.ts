import { test } from "node:test";
import assert from "node:assert/strict";
import { runForTarget } from "../src/reconstruction_script_probe.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

test("test_runForTarget_matches_a_run_that_touches_the_target_without_naming_it", () => {
    // Scenario: a script renames functions across files found via glob.glob, so the target's
    // basename never appears in the script source; the gate must still match the run because
    // executing it changes the target's content.
    // Steps:
    // build records with a Write of /proj/core_one.py and a run whose script rewrites
    // every core_*.py via glob (no literal "core_one.py" in the source).
    const globScript = 'import glob\nfor p in glob.glob("core_*.py"):\n'
        + '    text = open(p).read()\n'
        + '    open(p, "w").write(text.replace("f_one", "alpha"))\n';
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/core_one.py", content: "def f_one(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: globScript }, "2026-01-01T00:00:02Z"),
    ];
    // resolve the run for target /proj/core_one.py.
    const runs = findScriptExecutionRuns(records);
    const run = runForTarget(runs, new Path("/proj/core_one.py"), new Date("2026-01-01T00:00:10Z"), records, emptyReader);
    // assert the run is found.
    assert.ok(run !== undefined);
});
