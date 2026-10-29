import { test } from "node:test";
import assert from "node:assert/strict";
import { filterRenameCandidatesInTimestampOrder, type RenameCandidate } from "../src/reconstruction_script_rename_candidates.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

function buildCandidate(id: string, from: string, to: string, timestamp: string): RenameCandidate {
    return { changeId: new Uuid(id), from: new Path(from), to: new Path(to), timestamp: new Date(timestamp) };
}

test("filterRenameCandidatesInTimestampOrder chains renames in timestamp order and drops unknown sources", () => {
    const candidates = [
        buildCandidate("b", "/r/b.ts", "/r/c.ts", "2026-01-01T00:00:02Z"),
        buildCandidate("a", "/r/a.ts", "/r/b.ts", "2026-01-01T00:00:01Z"),
        buildCandidate("x", "/r/zzz.ts", "/r/y.ts", "2026-01-01T00:00:03Z"),
    ];
    const events = filterRenameCandidatesInTimestampOrder(candidates, new Set(["a.ts"]));
    assert.deepEqual(events.map((event) => event.changeId.toString()), ["a", "b"]);
});

test("filterRenameCandidatesInTimestampOrder drops an exact duplicate candidate", () => {
    const candidate = buildCandidate("a", "/r/a.ts", "/r/b.ts", "2026-01-01T00:00:01Z");
    const events = filterRenameCandidatesInTimestampOrder([candidate, candidate], new Set(["a.ts"]));
    assert.equal(events.length, 1);
});
