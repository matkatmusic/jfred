// Spec S5a identity-join ladder tests: same relative path across roots joins when content agrees.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { setPathOverrides } from "../src/reconstruction_overrides.ts";
import { buildFileRevisions, buildAllFileHistories } from "../src/reconstruction_engine.ts";
import type { FileRevision } from "../src/reconstruction_events.ts";
import { mergeMultiSourceRecords } from "../src/reconstruction_multi_source.ts";
import { makeTwoSourceEditFixture, buildEditRecordPair, SESSION_A } from "./multi-source-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

// The believed text of each line in a revision (its latest value), for ladder assertions.
function readRevisionLines(revision: FileRevision): string[] {
    return revision.lines.map((entry) => entry.values[entry.values.length - 1]!.line);
}

test("test_same_relative_path_with_content_agreement_joins_into_one_history", () => {
    // Scenario (§a): A writes <alpha>/app.py at t1; B edits <beta>/app.py at t2 with matching evidence; one ladder.
    const fixture = makeTwoSourceEditFixture("line one\n");
    const merged = mergeMultiSourceRecords([fixture.listA, fixture.listB], fixture.sources);
    // Test action: reconstruct under the PRIMARY (earlier) root's absolute path.
    const revisions = buildFileRevisions(merged, new Path(fixture.alphaPath));
    // Test verification — the ground-truth ladder: write then edit, exactly two revisions.
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]!.kind, EventKind.write);
    assert.equal(revisions[1]!.kind, EventKind.edit);
    // the final content carries B's appended line onto A's line.
    assert.deepEqual(readRevisionLines(revisions[1]!), ["line one", "line two"]);
});

test("test_same_relative_path_with_content_disagreement_keeps_two_histories", () => {
    // Scenario (§a): B's pre-state evidence does not match A's state, so the join is refused.
    const fixture = makeTwoSourceEditFixture("divergent\n");
    const merged = mergeMultiSourceRecords([fixture.listA, fixture.listB], fixture.sources);
    const targets = buildAllFileHistories(merged).map((history) => history.target.toString());
    // Test verification: both absolute paths survive as separate histories.
    assert.ok(targets.includes(fixture.alphaPath));
    assert.ok(targets.includes(fixture.betaPath));
});

test("test_cross_source_interleave_orders_revisions_by_wall_clock", () => {
    // Scenario (§c3 + §d): A writes t1, B edits t2, A edits t3; one strictly time-ordered ladder.
    const fixture = makeTwoSourceEditFixture("line one\n", (locations) =>
        buildEditRecordPair(
            {
                sessionId: SESSION_A,
                cwd: locations.rootA,
                timestamp: "2026-07-22T10:10:00.000Z",
                toolId: "toolu_edit_a2",
                parentUuid: "toolu_write_a1-result",
            },
            locations.alphaPath,
            "line one\nline two\nline three\n",
            "line one\nline two\n",
            { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [" line one", " line two", "+line three"] },
        ).records,
    );
    const merged = mergeMultiSourceRecords([fixture.listA, fixture.listB], fixture.sources);
    const revisions = buildFileRevisions(merged, new Path(fixture.alphaPath));
    // Test verification — the ground-truth ladder: three revisions, strictly time-ordered.
    assert.equal(revisions.length, 3);
    assert.ok(revisions[0]!.timestamp.getTime() < revisions[1]!.timestamp.getTime());
    assert.ok(revisions[1]!.timestamp.getTime() < revisions[2]!.timestamp.getTime());
    assert.deepEqual(readRevisionLines(revisions[2]!), ["line one", "line two", "line three"]);
});
