import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildRenameChain,
    contentPathOf,
    distinctFinalPaths,
    eventBelongsToLineage,
    resolveFinalPath,
} from "../src/reconstruction_lineage.ts";
import type {
    CopyEvent,
    FileEvent,
    WriteEvent,
} from "../src/reconstruction_engine.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const time = new Date("2026-01-01T00:00:00Z");

// A create of /a.py, an mv /a.py -> /b.py, then an edit of /b.py — one lineage.
function createMoveEdit(): FileEvent[] {
    return [
        { kind: EventKind.write, changeId: new Uuid("w"), target: new Path("/a.py"), content: "x\n", timestamp: time },
        { kind: EventKind.rename, changeId: new Uuid("m"), from: new Path("/a.py"), to: new Path("/b.py"), timestamp: time },
        { kind: EventKind.edit, changeId: new Uuid("e"), target: new Path("/b.py"), hunks: [], timestamp: time },
    ];
}

// resolveFinalPath follows the chain from the source to where the file ends.
test("test_resolve_final_path_follows_rename_chain", () => {
    const chain = buildRenameChain(createMoveEdit());
    assert.equal(resolveFinalPath(new Path("/a.py"), chain).toString(), "/b.py");
    // A path with no rename resolves to itself.
    assert.equal(resolveFinalPath(new Path("/b.py"), chain).toString(), "/b.py");
});

// Every event in the create/move/edit sequence belongs to the /b.py lineage.
test("test_every_event_belongs_to_the_final_lineage", () => {
    const events = createMoveEdit();
    const chain = buildRenameChain(events);
    const finalTarget = new Path("/b.py");
    for (const event of events) {
        assert.ok(eventBelongsToLineage(event, finalTarget, chain));
    }
});

// A copy event's content path is the destination it creates (not its source).
test("test_content_path_of_copy_is_its_destination", () => {
    // A copy event moving content into s3_copy.py.
    const copy: CopyEvent = {
        kind: EventKind.copy,
        changeId: new Uuid("toolu_cp"),
        from: new Path("/x/s3_source.py"),
        to: new Path("/x/s3_copy.py"),
        seedLines: [],
        timestamp: new Date("2026-06-18T16:16:27.224Z"),
    };
    // The path a copy touches is the destination it creates.
    assert.ok(contentPathOf(copy).equals(new Path("/x/s3_copy.py")));
});

// A copy is absent from the rename chain, so both source and destination survive as distinct final paths (the opposite of a rename, which collapses its source).
test("test_distinct_final_paths_keeps_copy_source_and_destination", () => {
    // A source write and a copy of it into a new file.
    const write: WriteEvent = {
        kind: EventKind.write,
        changeId: new Uuid("toolu_w"),
        target: new Path("/x/s3_source.py"),
        content: "def hello():\n",
        timestamp: new Date("2026-06-18T16:16:10.514Z"),
    };
    const copy: CopyEvent = {
        kind: EventKind.copy,
        changeId: new Uuid("toolu_cp"),
        from: new Path("/x/s3_source.py"),
        to: new Path("/x/s3_copy.py"),
        seedLines: [],
        timestamp: new Date("2026-06-18T16:16:27.224Z"),
    };
    // A copy is absent from the rename chain, so both paths survive.
    const renameChain = buildRenameChain([write, copy]);
    const finalPaths = distinctFinalPaths([write, copy], renameChain);
    const finals = finalPaths.map((path) => path.toString());
    // Both the source and the copy destination are distinct histories.
    assert.ok(finals.some((path) => path.endsWith("/s3_source.py")));
    assert.ok(finals.some((path) => path.endsWith("/s3_copy.py")));
    assert.equal(finals.length, 2);
});

// The rename source collapses into its destination — one distinct final path.
test("test_distinct_final_paths_collapses_rename_source", () => {
    const events = createMoveEdit();
    const finals = distinctFinalPaths(events, buildRenameChain(events));
    assert.equal(finals.length, 1);
    assert.equal(finals[0]!.toString(), "/b.py");
});

