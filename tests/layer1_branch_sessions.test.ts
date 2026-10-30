// Task 357 step 3: group session files, graft subagents, keep rewound branches with a real tip.

import assert from "node:assert/strict";
import { utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { collectSessionFileGroups, loadSessionRewinds } from "../src/layer1_branch_sessions.ts";
import { Path } from "../src/structures/domain.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { SESSION_A, createSourceTree } from "./multi-source-test-helpers.ts";
import { findScenarioJsonl } from "./scenario-locator.ts";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function buildChatRecord(type: "user" | "assistant", uuid: string, parentUuid: string | null, timestamp: string): object {
    return { type, uuid, parentUuid, sessionId: SESSION_A, timestamp, cwd: "/tmp/x", message: { role: type, content: [{ type: "text", text: uuid }] } };
}

function writeSession(name: string, tail: object[]): Path {
    const tree = createSourceTree("-branch-sessions");
    const chat = [
        buildChatRecord("user", "u1", null, "2026-07-24T10:00:00.000Z"),
        buildChatRecord("assistant", "a1", "u1", "2026-07-24T10:00:01.000Z"),
        ...tail,
    ];
    const sessionFile = join(tree.projectDir, name);
    writeFileSync(sessionFile, chat.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return new Path(sessionFile);
}

test("test_fork_stitch_group_grafts_the_subagent_into_one_rewound_branch", () => {
    const forkStitchDir = dirname(findScenarioJsonl("fork-stitch"));
    const groups = collectSessionFileGroups(listTranscriptFiles([forkStitchDir]));
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.subagentFiles.length, 1);
    const { branches } = loadSessionRewinds(groups[0]!);
    assert.equal(branches.length, 1);
    assert.ok(branches[0]!.tip.toString().startsWith("e7871ce4"));
    assert.ok(branches[0]!.rewindPoint.toString().startsWith("7654d562"));
});

test("test_subagent_file_without_its_parent_is_skipped", () => {
    const forkStitchDir = dirname(findScenarioJsonl("fork-stitch"));
    const subagentOnly = listTranscriptFiles([forkStitchDir]).filter((file) => file.toString().includes("/subagents/"));
    assert.equal(subagentOnly.length, 1);
    assert.deepEqual(collectSessionFileGroups(subagentOnly), []);
});

test("test_last_prompt_without_leaf_uuid_gives_no_rewound_branch", () => {
    const sessionFile = writeSession("leafless.jsonl", [{ type: "last-prompt", sessionId: SESSION_A }]);
    const [group] = collectSessionFileGroups([sessionFile]);
    assert.deepEqual(loadSessionRewinds(group!).branches, []);
});

test("test_zero_uuid_explicit_sentinel_gives_no_rewound_branch", () => {
    const sentinel = { type: "last-prompt", sessionId: SESSION_A, leafUuid: ZERO_UUID, explicit: true };
    const sessionFile = writeSession("sentinel.jsonl", [sentinel]);
    const [group] = collectSessionFileGroups([sessionFile]);
    assert.deepEqual(loadSessionRewinds(group!).branches, []);
});

test("test_group_without_rewound_branches_keeps_no_records", () => {
    const sessionFile = writeSession("norewind.jsonl", []);
    const [group] = collectSessionFileGroups([sessionFile]);
    const rewinds = loadSessionRewinds(group!);
    assert.deepEqual(rewinds.branches, []);
    assert.equal(rewinds.records.length, 0);
});

test("test_load_is_cached_until_a_file_mtime_changes", () => {
    const sessionFile = writeSession("cached.jsonl", []);
    const [group] = collectSessionFileGroups([sessionFile]);
    const first = loadSessionRewinds(group!);
    assert.equal(loadSessionRewinds(group!), first);
    const later = new Date(Date.now() + 60_000);
    utimesSync(sessionFile.toString(), later, later);
    const reloaded = loadSessionRewinds(group!);
    assert.notEqual(reloaded, first);
    assert.equal(reloaded.records.length, first.records.length);
});
