// Shared fixtures live in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    GIT_BASE_CHANGE_ID_PREFIX,
    computeSnapshotJumpRoute,
    deriveFileChanges,
    indexRevisionsByChangeId,
    splitPatchByFile,
} from "../webapp/views/timeline-changes.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND, type WireTimelineDocument } from "../webapp/views/timeline-types.ts";
import { routeToFileHistory } from "../webapp/app-routes.ts";
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
    // Uses s2-move-file: s85's "moves" are modeled as destination creations with no rename
    // revisions, so only s2 exercises a true rename.
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
    // The range-diff inspector shows only the clicked file, so the patch splits on `diff --git `
    // headers into one block per file, each keyed by its b/ path.
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
    // Each chip needs the changeId of the revision it displays so the { } and +/- buttons can
    // resolve the causing JSONL line and the diff block.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const revisionIndex = indexRevisionsByChangeId(s2Document);
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

test("test_compute_snapshot_jump_route_targets_the_revisions_1_based_number", () => {
    // A chip whose changeId is a backup blob name (`<hex>@vN`) routes to the file-history view
    // anchored at that revision's 1-based number; task 94 narrowed the button to those.
    const filesTouched = [{
        target: "/tmp/geo_report.py",
        revisions: [
            { kind: EventKind.write, changeId: "toolu_01FirstWrite", timestamp: "2026-07-01T10:00:00Z" },
            { kind: EventKind.edit, changeId: "3fa9c2d1@v4", timestamp: "2026-07-01T10:05:00Z" },
        ],
    }];
    const change = { path: "/tmp/geo_report.py", changeId: "3fa9c2d1@v4" };
    assert.equal(
        computeSnapshotJumpRoute("s84", filesTouched, change),
        `${routeToFileHistory("s84", "/tmp/geo_report.py")}/rev/2`,
    );
});

test("test_compute_snapshot_jump_route_returns_undefined_for_tool_evidenced_changeids", () => {
    // Task 94: a `toolu_…` changeId resolves to a surviving revision that is tool-evidenced, not
    // snapshot-backed, so the 📷 button must not render — the pre-task-94 over-fire.
    const history = s84Document.filesTouched[0]!;
    const change = { path: history.target, changeId: history.revisions[0]!.changeId };
    // precondition: the changeId is NOT a backup blob name — otherwise this test proves nothing.
    assert.ok(!/@v\d+$/.test(change.changeId));
    assert.equal(computeSnapshotJumpRoute("s84", s84Document.filesTouched, change), undefined);
});

test("test_compute_snapshot_jump_route_returns_undefined_without_a_changeid", () => {
    // A changedPaths-hint chip carries no changeId, so there is no jump button.
    const change = { path: "whatever.py", changeId: undefined };
    assert.equal(computeSnapshotJumpRoute("s84", s84Document.filesTouched, change), undefined);
});

test("test_compute_snapshot_jump_route_returns_undefined_for_unresolvable_changeids", () => {
    // A re-stamped synthetic changeId matches no surviving revision — no button beats a dead link.
    const change = { path: "whatever.py", changeId: "00000000-0000-4000-8000-000000000000" };
    assert.equal(computeSnapshotJumpRoute("s84", s84Document.filesTouched, change), undefined);
});

test("test_failed_git_operations_badge_their_commit_and_tool_call_nodes", () => {
    // Task 103: a FAILED git command still emits its rows, but both row kinds must carry isError.
    // The Bash row joins to the errored operation by record uuid.
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
    // Chip rows show a per-chip timestamp: each FileChange carries the `when` of the snapshot that
    // contributed it.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const filesBubble = nodes.find((node) =>
        node.kind === AGENT_TURN_NODE_KIND && node.text === "" && (node.fileChanges ?? []).length === 2);
    const snapshotWhens = new Set(filesBubble!.snapshots!.map((snapshot) => snapshot.when));
    for (const change of filesBubble!.fileChanges!) {
        assert.ok(snapshotWhens.has(change.when));
    }
});

// The minimal shape reproducing the s87 "pre-rename entry shows core_inventory.py" bug (task 127).
const renamedFileDocument: WireTimelineDocument = {
    filesTouched: [{
        target: "/repo/core_inventory.py",
        revisions: [
            { kind: "edit", changeId: "c1", timestamp: "2026-07-20T10:00:00Z" },
            { kind: "rename", changeId: "c2", timestamp: "2026-07-20T10:05:00Z", rename: { from: "/repo/inventory.py", to: "/repo/core_inventory.py" } },
        ],
    }],
    rewoundFilesTouched: [],
    messages: [],
    steps: [],
    commitMarkers: [],
};

test("test_indexRevisionsByChangeId_stamps_entry_time_display_paths", () => {
    // A revision before a rename must display the name the file had THEN, while its lookup path
    // stays the final target.
    const index = indexRevisionsByChangeId(renamedFileDocument);
    assert.equal(index.get("c1")!.displayPath, "/repo/inventory.py");
    assert.equal(index.get("c1")!.path, "/repo/core_inventory.py");
    assert.equal(index.get("c2")!.displayPath, "/repo/core_inventory.py");
});

test("test_deriveFileChanges_copies_the_entry_time_display_path_onto_the_chip", () => {
    // A chip from a pre-rename revision shows the entry-time name but keeps the final path as its
    // lookup key.
    const index = indexRevisionsByChangeId(renamedFileDocument);
    const step = { index: 0, when: "2026-07-20T10:00:00Z", changeIds: ["c1"], changedPaths: [] };
    const changes = deriveFileChanges(step, index);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.displayPath, "/repo/inventory.py");
    assert.equal(changes[0]!.path, "/repo/core_inventory.py");
});

test("test_deriveFileChanges_fallback_chips_display_their_own_path", () => {
    // A changedPaths-hint chip resolves through no revision, so its display name is its path.
    const index = indexRevisionsByChangeId(renamedFileDocument);
    const step = { index: 0, when: "2026-07-20T10:00:00Z", changeIds: [], changedPaths: ["/repo/orders.py"] };
    const changes = deriveFileChanges(step, index);
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.displayPath, "/repo/orders.py");
    assert.equal(changes[0]!.path, "/repo/orders.py");
});

test("test_gitBaseChangeIdPrefix_mirrors_engine_constant", () => {
    // Single-source vocabulary: the webapp's mirror must equal the engine's constant.
    assert.equal(GIT_BASE_CHANGE_ID_PREFIX, BASE_COMMIT_CHANGE_ID_PREFIX);
});
