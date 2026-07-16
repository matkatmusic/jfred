// The document's scriptRuns[] (task 67): every recorded script run with the files its consented
// sandbox execution changed — captured from executeRunOnce's pre/post states and carried onto
// the wire so the timeline's script-run rows can show what each run did. s25 (multi-file script
// rename) is the fixture: one Bash run rewrites several files in a single execution.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import type { ReconstructionDocument } from "../src/reconstruction_json.ts";
import { setImpureExecutionAllowed } from "../src/reconstruction_exec_gate.ts";
import { Path } from "../src/structures/domain.ts";
import { S25_JSONL } from "./fixtures.ts";

function computeBasename(value: string): string {
    return value.split("/").pop() ?? value;
}

function assertChangedPathsAreDomainPaths(runs: { changedPaths: Path[] }[]): void {
    for (const changed of runs.flatMap((run) => run.changedPaths)) {
        assert.ok(changed instanceof Path);
    }
}

// The viewer's consented-build lifecycle: gate on for the build's own duration, off after.
function buildConsentedS25Document(): ReconstructionDocument {
    setImpureExecutionAllowed(true);
    try {
        return buildProjectDocument([new Path(S25_JSONL)], undefined);
    } finally {
        setImpureExecutionAllowed(false);
    }
}

test("test_declined_build_lists_script_runs_with_empty_changed_paths", () => {
    // Scenario: a declined build (exec gate explicitly off — the gate DEFAULTS ON for CLI/tests,
    // only the viewer server boots it off) still lists every recorded run — the consent dialog
    // needs the code — but reports nothing changed, because nothing may execute.
    // Steps:
    // build the s25 document with the gate forced off, restoring the test-process default after.
    // assert the runs are listed, each with code and a Date timestamp.
    // assert every run's changedPaths is exactly [].
    setImpureExecutionAllowed(false);
    let document: ReconstructionDocument;
    try {
        document = buildProjectDocument([new Path(S25_JSONL)], undefined);
    } finally {
        setImpureExecutionAllowed(true);
    }
    assert.ok(document.scriptRuns.length > 0);
    for (const run of document.scriptRuns) {
        assert.ok(run.code.length > 0);
        assert.ok(run.timestamp instanceof Date);
        assert.deepEqual(run.changedPaths, []);
    }
});

test("test_consented_build_reports_script_changed_paths", () => {
    // Scenario: a consented build executes the runs, so the multi-file rename run reports the
    // files its sandbox execution changed.
    // Steps:
    // build the s25 document under the exec gate (the viewer's consented-build lifecycle).
    // assert at least one run changed 2+ files (s25's script rewrites several in one run).
    // assert every reported path is a Path domain object.
    const document = buildConsentedS25Document();
    const modifyingRuns = document.scriptRuns.filter((run) => run.changedPaths.length >= 2);
    assert.ok(modifyingRuns.length >= 1);
    assertChangedPathsAreDomainPaths(document.scriptRuns);
});

test("test_script_changed_paths_name_files_the_document_tracks", () => {
    // Scenario: the paths a run reports changed are the same files the reconstruction tracks —
    // the webapp joins them to filesTouched, so the two must agree at least by basename (the
    // sandbox's state keys may be cwd-relative before resolution; basename is the stable join).
    // Steps:
    // build the consented s25 document.
    // collect the basenames of every filesTouched target.
    // assert every changedPath's basename is among them.
    const document = buildConsentedS25Document();
    const trackedBasenames = new Set(
        document.filesTouched.map((history) => computeBasename(history.target.toString())),
    );
    const modifyingRun = document.scriptRuns.find((run) => run.changedPaths.length >= 2);
    assert.ok(modifyingRun !== undefined);
    for (const changed of modifyingRun.changedPaths) {
        assert.ok(trackedBasenames.has(computeBasename(changed.toString())));
    }
});
