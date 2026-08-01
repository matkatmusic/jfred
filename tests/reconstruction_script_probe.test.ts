import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedPathsForRun, runForTarget } from "../src/reconstruction_script_probe.ts";
import { findScriptExecutionRuns, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

test("test_runForTarget_matches_a_run_that_touches_the_target_without_naming_it", () => {
    // Scenario: glob-found script never names the target's basename; execution still proves the match.
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

test("test_affectedPathsForRun_returns_only_paths_the_runs_source_names", () => {
    // Scenario: two candidate paths, only one basename appears in run.code.
    const run: ScriptRun = { code: 'open("rename_inv.py").read()', timestamp: new Date("2026-01-01T00:00:00Z") };
    const named = new Path("/proj/rename_inv.py");
    const unnamed = new Path("/proj/other.py");
    // static scan finds only the named one.
    assert.deepEqual(affectedPathsForRun(run, [named, unnamed]), [named]);
});

test("test_affectedPathsForRun_excludes_a_glob_matched_path_the_source_never_names", () => {
    // Scenario: static scan must not claim a glob-matched path with no literal basename in source.
    const run: ScriptRun = {
        code: 'import glob\nfor p in glob.glob("core_*.py"):\n    pass\n',
        timestamp: new Date("2026-01-01T00:00:02Z"),
    };
    assert.deepEqual(affectedPathsForRun(run, [new Path("/proj/core_one.py")]), []);
});
