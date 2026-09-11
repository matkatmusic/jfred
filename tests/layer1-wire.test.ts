// Task 331: the wire vocabulary is single-sourced in webapp/layer1-wire.ts.  These guard the shared values and the pair-ladder ordering.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CommitTimeSource,
    SourceKind,
    WireScriptExecutorKind,
    listPairLadderInstants,
    type WirePairOf,
} from "../webapp/layer1-wire.ts";

test("test_committer_leads_the_time_source_values", () => {
    // committer is the toggle's default; Object.values order feeds that toggle.
    assert.equal(Object.values(CommitTimeSource)[0], "committer");
});

test("test_source_kind_values_are_the_wire_spellings", () => {
    // The values ARE the `kind=` query-param spelling — no translation table.
    assert.equal(SourceKind.jsonl, "jsonl");
    assert.equal(SourceKind.fileHistory, "filehistory");
});

test("test_pair_ladder_orders_created_commits_disk_then_snapshots", () => {
    // A pair carrying all four node kinds, commits oldest-first.
    const pair: WirePairOf<string, string, string> = {
        path: "src/a.ts",
        created: { instant: "created", axisPx: 0 },
        commits: [
            { instant: "commit-old", axisPx: 1, hash: "aaa" },
            { instant: "commit-new", axisPx: 2, hash: "bbb" },
        ],
        onDisk: { instant: "onDisk", axisPx: 3 },
        snapshots: [
            { instant: "snap-1", axisPx: 4, version: 1, sessionId: "s", sessionFile: "f.jsonl" },
            { instant: "snap-2", axisPx: 5, version: 2, sessionId: "s", sessionFile: "f.jsonl" },
        ],
    };
    // created → commits (oldest first) → onDisk → snapshots appended.
    assert.deepEqual(listPairLadderInstants(pair), ["created", "commit-old", "commit-new", "onDisk", "snap-1", "snap-2"]);
});

test("test_wire_script_executor_kind_values_are_the_wire_spellings", () => {
    assert.equal(WireScriptExecutorKind.python, "python");
    assert.equal(WireScriptExecutorKind.bash, "bash");
});

test("test_pair_ladder_appends_script_runs_after_snapshots", () => {
    const pair: WirePairOf<string, string, string> = {
        path: "src/a.ts",
        commits: [],
        onDisk: { instant: "onDisk", axisPx: 0 },
        snapshots: [{ instant: "snap-1", axisPx: 1, version: 1, sessionId: "s", sessionFile: "f.jsonl" }],
        scriptRuns: [{ instant: "run-1", axisPx: 2, toolUseId: "toolu_1", executorKind: "python", code: "print(1)" }],
    };
    assert.deepEqual(listPairLadderInstants(pair), ["onDisk", "snap-1", "run-1"]);
});
