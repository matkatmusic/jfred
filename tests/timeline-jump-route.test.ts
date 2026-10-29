// Tests for computeSnapshotJumpRoute (webapp/views/timeline-changes.ts); fixtures live in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSnapshotJumpRoute } from "../webapp/views/timeline-changes.ts";
import { getFileHistoryRoute } from "../webapp/app-routes.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { s84Document } from "./timeline-test-helpers.ts";

test("test_compute_snapshot_jump_route_targets_the_revisions_1_based_number", () => {
    // A backup-blob changeId routes to the file-history view at that revision's number.
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
        `${getFileHistoryRoute("s84", "/tmp/geo_report.py")}/rev/2`,
    );
});

test("test_compute_snapshot_jump_route_returns_undefined_for_tool_evidenced_changeids", () => {
    // Task 94: a `toolu_…` changeId is tool-evidenced, not snapshot-backed, so the 📷 button must not render.
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
