import type { FileRevision, LineEntry } from "../src/reconstruction_engine.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "../src/structures/line-model.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// A line carried forward unchanged from index i of the previous revision.
export function carried(i: number, line: string, when: Date): LineEntry {
    return { oldLineNum: i, values: [{ line, timestamp: when }] };
}

// A line born here (no predecessor).
export function born(line: string, when: Date): LineEntry {
    return { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line, timestamp: when }] };
}

// A minimal two-revision history (create 2 lines, then delete) to render against,
// built from literals so these stay pure unit tests with no transcript.
export function createThenDelete(): FileRevision[] {
    const created = new Date("2026-01-01T00:00:00Z");
    const deleted = new Date("2026-01-01T00:01:00Z");
    const lines = ["def hello():", '    print("hello")'].map((line) => ({
        oldLineNum: DOES_NOT_EXIST_YET,
        values: [{ line, timestamp: created }],
    }));
    return [
        { kind: EventKind.write, changeId: new Uuid("write-id"), timestamp: created, lines },
        { kind: EventKind.delete, changeId: new Uuid("rm-id"), timestamp: deleted, lines: [] },
    ];
}

// A create of one line, then a `>>` append carrying that line and adding a tail.
export function createThenAppendRevs(): FileRevision[] {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    return [
        { kind: EventKind.write, changeId: new Uuid("w1"), timestamp: t0, lines: [born("line one", t0)] },
        { kind: EventKind.append, changeId: new Uuid("a1"), timestamp: t1, lines: [carried(0, "line one", t0), born("line two", t1)] },
    ];
}

// --- s2-move-file: rename entry + oldLineNum-driven edit diffs ----------------

export const FROM = new Path("/abs/s2_original.py");
export const TO = new Path("/abs/s2_moved.py");

// A create -> rename -> edit(add goodbye) history for the moved file, from
// literals so these stay pure unit tests.
export function createRenameEdit(): FileRevision[] {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:01:00Z");
    const t2 = new Date("2026-01-01T00:02:00Z");
    const create: FileRevision = {
        kind: EventKind.write,
        changeId: new Uuid("w"),
        timestamp: t0,
        lines: [born("def hello():", t0), born('    print("hello")', t0)],
    };
    const rename: FileRevision = {
        kind: EventKind.rename,
        changeId: new Uuid("m"),
        timestamp: t1,
        lines: [carried(0, "def hello():", t0), carried(1, '    print("hello")', t0)],
        rename: { from: FROM, to: TO },
    };
    const edit: FileRevision = {
        kind: EventKind.edit,
        changeId: new Uuid("e"),
        timestamp: t2,
        lines: [
            carried(0, "def hello():", t0),
            carried(1, '    print("hello")', t0),
            born("", t2),
            born("", t2),
            born("def goodbye():", t2),
            born('    print("goodbye")', t2),
        ],
    };
    return [create, rename, edit];
}
