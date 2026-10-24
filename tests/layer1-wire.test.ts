// Task 331: the wire vocabulary is single-sourced in webapp/layer1-wire.ts.  These guard the shared values and the pair-ladder ordering.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CommitTimeSource,
    SourceKind,
    WireConfidence,
    WireEditKind,
    WireEditSide,
    WireRewindKind,
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

test("test_pair_ladder_places_edits_after_snapshots_and_before_script_runs", () => {
    const edit = { instant: "edit-1", axisPx: 2, kind: WireEditKind.edit, changeId: "toolu_1", confidence: WireConfidence.verified,
        sessionId: "s", sessionFile: "f.jsonl" };
    const pair: WirePairOf<string, string, string> = {
        path: "src/a.ts",
        commits: [],
        onDisk: { instant: "onDisk", axisPx: 0 },
        snapshots: [{ instant: "snap-1", axisPx: 1, version: 1, sessionId: "s", sessionFile: "f.jsonl" }],
        edits: [edit],
        scriptRuns: [{ instant: "run-1", axisPx: 3, toolUseId: "toolu_2", executorKind: "python", language: "python", code: "print(1)", sessionId: "s", sessionFile: "f.jsonl" }],
    };
    assert.deepEqual(listPairLadderInstants(pair), ["onDisk", "snap-1", "edit-1", "run-1"]);
});

test("test_edit_kind_and_confidence_values_are_the_wire_spellings", () => {
    assert.deepEqual(Object.values(WireEditKind), ["edit", "write", "read"]);
    assert.deepEqual(Object.values(WireConfidence), ["verified", "derived", "reseeded"]);
});

test("test_edit_side_values_are_the_wire_spellings", () => {
    assert.deepEqual(Object.values(WireEditSide), ["base", "target"]);
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
        scriptRuns: [{ instant: "run-1", axisPx: 2, toolUseId: "toolu_1", executorKind: "python", language: "python", code: "print(1)", sessionId: "s", sessionFile: "f.jsonl" }],
    };
    assert.deepEqual(listPairLadderInstants(pair), ["onDisk", "snap-1", "run-1"]);
});

test("test_pair_ladder_gives_each_branch_a_fork_slot_then_its_nodes_and_rejoin_or_kept_to_end_adds_none", () => {
    const node = (instant: string) => ({ instant, axisPx: 0, changeId: "toolu_1", label: "edit" });
    const pair: WirePairOf<string, string, string> = {
        path: "src/a.ts",
        commits: [{ instant: "commit-1", axisPx: 0, hash: "aaa" }],
        onDisk: { instant: "onDisk", axisPx: 0 },
        branches: [
            { rewindKind: WireRewindKind.conversation, forkAt: { instant: "fork-1", axisPx: 0 }, rejoinAt: { instant: "commit-1", axisPx: 0 }, nodes: [node("b1-n1"), node("b1-n2")] },
            { rewindKind: WireRewindKind.conversation, forkAt: { instant: "fork-2", axisPx: 0 }, keptToEnd: true, nodes: [node("b2-n1")] },
            { rewindKind: WireRewindKind.code, forkAt: { instant: "fork-3", axisPx: 0 }, nodes: [] },
        ],
    };
    assert.deepEqual(listPairLadderInstants(pair), ["commit-1", "onDisk", "fork-1", "b1-n1", "b1-n2", "fork-2", "b2-n1", "fork-3"]);
});

test("test_pair_ladder_gives_a_rejoin_with_no_trunk_node_its_own_slot", () => {
    const pair: WirePairOf<string, string, string> = {
        path: "src/a.ts",
        commits: [{ instant: "commit-1", axisPx: 0, hash: "aaa" }],
        onDisk: { instant: "onDisk", axisPx: 0 },
        branches: [{ rewindKind: WireRewindKind.conversation, forkAt: { instant: "fork-1", axisPx: 0 }, rejoinAt: { instant: "later-edit", axisPx: 0 }, nodes: [] }],
    };
    assert.deepEqual(listPairLadderInstants(pair), ["commit-1", "onDisk", "fork-1", "later-edit"]);
});
