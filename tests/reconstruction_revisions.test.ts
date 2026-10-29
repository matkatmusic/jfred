// tests/reconstruction_revisions.test.ts — revision selection by instant and the believed text of a revision.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    findLastRevisionAtOrBefore,
    findLastRevisionStrictlyBefore,
    getLinesText,
} from "../src/reconstruction_revisions.ts";
import type { FileRevision } from "../src/reconstruction_events.ts";

function createRevision(isoInstant: string): FileRevision {
    return { timestamp: new Date(isoInstant), lines: [] } as unknown as FileRevision;
}

test("test_find_last_revision_at_or_before_includes_equal_instant", () => {
    const first = createRevision("2026-01-01T00:00:01Z");
    const second = createRevision("2026-01-01T00:00:02Z");
    const revisions = [first, second];
    assert.equal(findLastRevisionAtOrBefore(revisions, new Date("2026-01-01T00:00:02Z")), second);
    assert.equal(findLastRevisionAtOrBefore(revisions, new Date("2026-01-01T00:00:01.500Z")), first);
    assert.equal(findLastRevisionAtOrBefore(revisions, new Date("2026-01-01T00:00:00Z")), undefined);
});

test("test_find_last_revision_strictly_before_excludes_equal_instant", () => {
    const first = createRevision("2026-01-01T00:00:01Z");
    const second = createRevision("2026-01-01T00:00:02Z");
    const revisions = [first, second];
    assert.equal(findLastRevisionStrictlyBefore(revisions, new Date("2026-01-01T00:00:02Z")), first);
    assert.equal(findLastRevisionStrictlyBefore(revisions, new Date("2026-01-01T00:00:01Z")), undefined);
});

test("test_lines_text_of_returns_latest_value_of_each_line", () => {
    const revision = {
        timestamp: new Date("2026-01-01T00:00:01Z"),
        lines: [
            { values: [{ line: "old" }, { line: "new" }] },
            { values: [{ line: "same" }] },
        ],
    } as unknown as FileRevision;
    assert.deepEqual(getLinesText(revision), ["new", "same"]);
});
