// Shared fixtures live in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    GIT_BASE_CHANGE_ID_PREFIX,
    buildRevisionIndex,
} from "../webapp/views/timeline-changes.ts";
import { splitPatchByFile } from "../webapp/views/timeline-patch-split.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND } from "../webapp/views/timeline-types.ts";
import { buildProjectReconstruction } from "../src/viewer_api.ts";
import { renderRangePatch } from "../src/viewer_api_diffs.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { BASE_COMMIT_CHANGE_ID_PREFIX } from "../src/reconstruction_base_commit.ts";
import { S85_JSONL_PATHS } from "./fixtures.ts";
import {
    s84Document,
    s2Document,
    s39SeedDocument,
} from "./timeline-test-helpers.ts";

test("test_timeline_file_changes_carry_event_kinds", () => {
    // Uses s2-move-file: s85's "moves" model as destination creations, so only s2 exercises a true rename.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const fileChanges = nodes
        .filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND)
        .flatMap((node) => node.fileChanges!);
    const renameChange = fileChanges.find((change: { eventKind: string }) => change.eventKind === EventKind.rename);
    assert.ok(renameChange !== undefined);
    assert.ok(renameChange.renamedFrom !== undefined);
    assert.ok(renameChange.renamedFrom.endsWith("s2_original.py"));
    assert.ok(renameChange.path.endsWith("s2_moved.py"));
});

test("test_split_patch_by_file_returns_one_block_per_file", () => {
    // The patch splits into one block per `diff --git ` header.
    const { document: rawS85Document, stepFileHistories: rawS85Histories } = buildProjectReconstruction(S85_JSONL_PATHS, undefined);
    const patch = renderRangePatch(rawS85Histories, rawS85Document.steps, 1, 3);
    const blocks = splitPatchByFile(patch);
    const headerCount = patch.split("\n").filter((line) => line.startsWith("diff --git ")).length;
    assert.ok(headerCount >= 2);
    assert.equal(blocks.length, headerCount);
    const paths = new Set(blocks.map((block: { path: string }) => block.path));
    assert.equal(paths.size, blocks.length);
    for (const block of blocks) {
        assert.ok(block.block.startsWith(`diff --git a/${block.path} b/${block.path}`));
    }
});

test("test_file_changes_carry_their_change_id", () => {
    // Each chip carries its revision's changeId so its buttons can resolve the line and diff.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const revisionIndex = buildRevisionIndex(s2Document);
    let checked = 0;
    for (const node of nodes.filter((entry: { kind: string }) => entry.kind === AGENT_TURN_NODE_KIND)) {
        for (const change of node.fileChanges!) {
            if (change.changeId === undefined) {
                continue;
            }
            assert.ok(node.snapshots!.some((snapshot: { changeIds: string[] }) =>
                snapshot.changeIds.includes(change.changeId!)));
            assert.equal(revisionIndex.get(change.changeId)!.path, change.path);
            checked += 1;
        }
    }
    // the check is not vacuous.
    assert.ok(checked >= 1);
});

test("test_failed_git_operations_badge_their_commit_and_tool_call_nodes", () => {
    // Task 103: a failed git command still emits its rows; both kinds carry isError, Bash joins by uuid.
    const document = {
        filesTouched: [],
        rewoundFilesTouched: [],
        messages: [],
        steps: [],
        commitMarkers: [],
        gitOperations: [
            { kind: "add", detail: "a.py", command: "git add a.py", timestamp: "2026-07-01T10:00:01Z", uuid: "u1", isError: true },
            { kind: "commit", detail: "x", command: 'git commit -m "x"', timestamp: "2026-07-01T10:00:01Z", uuid: "u1", isError: true },
        ],
        toolCalls: [
            { toolName: "Bash", summary: 'git add a.py && git commit -m "x"', timestamp: "2026-07-01T10:00:01Z", uuid: "u1", toolUseId: "toolu_c1" },
            { toolName: "Bash", summary: "ls", timestamp: "2026-07-01T10:00:05Z", uuid: "u2", toolUseId: "toolu_ls" },
        ],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const commitNode = nodes.find((node) => node.kind === COMMIT_NODE_KIND);
    assert.equal(commitNode!.isError, true);
    const toolCallErrors = nodes
        .filter((node) => node.kind === TOOL_CALL_NODE_KIND)
        .map((node) => node.isError);
    assert.deepEqual(toolCallErrors, [true, undefined]);
});

test("test_file_changes_carry_snapshot_timestamp", () => {
    // Chip rows show a per-chip timestamp: each FileChange carries the `when` of the snapshot that contributed it.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const filesBubble = nodes.find((node) =>
        node.kind === AGENT_TURN_NODE_KIND && node.text === "" && (node.fileChanges ?? []).length === 2);
    const snapshotWhens = new Set(filesBubble!.snapshots!.map((snapshot) => snapshot.when));
    for (const change of filesBubble!.fileChanges!) {
        assert.ok(snapshotWhens.has(change.when));
    }
});

test("test_gitBaseChangeIdPrefix_mirrors_engine_constant", () => {
    // Single-source vocabulary: the webapp's mirror must equal the engine's constant.
    assert.equal(GIT_BASE_CHANGE_ID_PREFIX, BASE_COMMIT_CHANGE_ID_PREFIX);
});
