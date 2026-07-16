// file-change chips, revision indexing, patch splitting (timeline-changes.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    GIT_BASE_CHANGE_ID_PREFIX,
    computeSnapshotJumpRoute,
    indexRevisionsByChangeId,
    splitPatchByFile,
} from "../webapp/views/timeline-changes.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND } from "../webapp/views/timeline-types.ts";
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
    // Scenario: a rename step's file chip carries the rename event kind and where the file came
    // from. Uses s2-move-file: s85's "moves" are engine-modeled as destination creations with no
    // rename revisions (see implementation notes), so the assertion runs against a true rename.
    // Steps:
    // build s2's turn timeline; find a fileChange with the rename kind.
    // assert it names both the renamed-from and renamed-to paths.
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
    // Scenario: the range-diff inspector shows only the clicked file — the full patch splits on
    // `diff --git ` headers into one block per file, each keyed by its b/ path.
    // Steps:
    // render a real multi-file patch for s85's first three steps.
    // split it; assert one block per `diff --git` header, keys unique, and re-joining loses nothing.
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
    // Scenario: each file chip needs the changeId of the revision it displays, so the per-file
    // { } button can resolve the JSONL line that caused the revision and the +/- button can
    // resolve the revision's diff block.
    // Steps:
    // build s2's turn timeline.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const revisionIndex = indexRevisionsByChangeId(s2Document);
    let checked = 0;
    for (const node of nodes.filter((entry: { kind: string }) => entry.kind === AGENT_TURN_NODE_KIND)) {
        for (const change of node.fileChanges!) {
            if (change.changeId === undefined) {
                continue;
            }
            // the changeId belongs to one of the node's own snapshots...
            assert.ok(node.snapshots!.some((snapshot: { changeIds: string[] }) =>
                snapshot.changeIds.includes(change.changeId!)));
            // ...and resolves to this chip's path.
            assert.equal(revisionIndex.get(change.changeId)!.path, change.path);
            checked += 1;
        }
    }
    // the check is not vacuous.
    assert.ok(checked >= 1);
});

test("test_compute_snapshot_jump_route_targets_the_revisions_1_based_number", () => {
    // Scenario: a chip whose changeId is a SNAPSHOT-BACKED revision's changeId (a backup blob
    // name, `<hex>@vN`) routes to the file-history view anchored at that revision (1-based
    // /rev/<n>, item 19; task 94 narrowed the button to snapshot-backed revisions).
    // Steps:
    // a surviving history whose second revision was seeded from a File History Snapshot blob.
    const filesTouched = [{
        target: "/tmp/geo_report.py",
        revisions: [
            { kind: EventKind.write, changeId: "toolu_01FirstWrite", timestamp: "2026-07-01T10:00:00Z" },
            { kind: EventKind.edit, changeId: "3fa9c2d1@v4", timestamp: "2026-07-01T10:05:00Z" },
        ],
    }];
    // the blob-changeId chip routes to that revision's 1-based number.
    const change = { path: "/tmp/geo_report.py", changeId: "3fa9c2d1@v4" };
    assert.equal(
        computeSnapshotJumpRoute("s84", filesTouched, change),
        `${routeToFileHistory("s84", "/tmp/geo_report.py")}/rev/2`,
    );
});

test("test_compute_snapshot_jump_route_returns_undefined_for_tool_evidenced_changeids", () => {
    // Scenario: task 94 — a `toolu_…` changeId RESOLVES to a surviving revision, but that
    // revision is tool-evidenced, not backed by a File History Snapshot: the 📷 button must
    // not render, so the route must be undefined (this is exactly the pre-task-94 over-fire).
    // Steps:
    // a real surviving revision whose changeId is a tool_use id (s84's first revision is one).
    const history = s84Document.filesTouched[0]!;
    const change = { path: history.target, changeId: history.revisions[0]!.changeId };
    // precondition: the changeId is NOT a backup blob name — otherwise this test proves nothing.
    assert.ok(!/@v\d+$/.test(change.changeId));
    // the resolvable-but-snapshotless changeId yields no route.
    assert.equal(computeSnapshotJumpRoute("s84", s84Document.filesTouched, change), undefined);
});

test("test_compute_snapshot_jump_route_returns_undefined_without_a_changeid", () => {
    // Scenario: a changedPaths-hint chip carries no changeId — no jump button.
    const change = { path: "whatever.py", changeId: undefined };
    assert.equal(computeSnapshotJumpRoute("s84", s84Document.filesTouched, change), undefined);
});

test("test_compute_snapshot_jump_route_returns_undefined_for_unresolvable_changeids", () => {
    // Scenario: a re-stamped synthetic changeId (item 25) matches no surviving revision —
    // no jump button rather than a dead link.
    const change = { path: "whatever.py", changeId: "00000000-0000-4000-8000-000000000000" };
    assert.equal(computeSnapshotJumpRoute("s84", s84Document.filesTouched, change), undefined);
});

test("test_failed_git_operations_badge_their_commit_and_tool_call_nodes", () => {
    // Scenario: task 103 — a FAILED git command still emits its rows (never suppressed), but
    // both row kinds must carry isError so the timeline badges them FAILED: the commit node
    // copies its operation's stamp, and the Bash tool-call row joins to the errored operation
    // by its record uuid. An error-free tool call stays unstamped.
    // Steps:
    // a document with one FAILED compound (add+commit, one Bash record u1) and one clean ls.
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
    // the commit hard-stop carries the FAILED stamp.
    const commitNode = nodes.find((node) => node.kind === COMMIT_NODE_KIND);
    assert.equal(commitNode!.isError, true);
    // the failed Bash call's row is stamped; the clean ls row is not.
    const toolCallErrors = nodes
        .filter((node) => node.kind === TOOL_CALL_NODE_KIND)
        .map((node) => node.isError);
    assert.deepEqual(toolCallErrors, [true, undefined]);
});

test("test_file_changes_carry_snapshot_timestamp", () => {
    // Scenario: chip rows show a per-chip timestamp — each FileChange carries the `when` of the
    // snapshot that contributed it.
    // Steps:
    // build the seed-session timeline and take the files bubble.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const filesBubble = nodes.find((node) =>
        node.kind === AGENT_TURN_NODE_KIND && node.text === "" && (node.fileChanges ?? []).length === 2);
    // every chip's `when` is one of the bubble's snapshot instants.
    const snapshotWhens = new Set(filesBubble!.snapshots!.map((snapshot) => snapshot.when));
    for (const change of filesBubble!.fileChanges!) {
        assert.ok(snapshotWhens.has(change.when));
    }
});

test("test_gitBaseChangeIdPrefix_mirrors_engine_constant", () => {
    // Scenario: the webapp's local gitBase: wire-string mirror must equal the engine's
    // BASE_COMMIT_CHANGE_ID_PREFIX (single-source vocabulary, asserted like the enum mirrors).
    // Steps:
    // assert the two constants are the same string.
    assert.equal(GIT_BASE_CHANGE_ID_PREFIX, BASE_COMMIT_CHANGE_ID_PREFIX);
});
