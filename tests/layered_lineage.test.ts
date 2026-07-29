// Task 203 (spec S6): typed rename/copy edges built from the engine's extracted mv/cp events, lineage DERIVED by walking RenameEdges end-to-end (never stored as a group), and a copy's genesis bytes read from the source's merged timeline at the copy instant — with both sides of a copy fork keeping their own, independent lineage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind, LayeredNodeKind } from "../src/structures/vocabulary.ts";
import {
    buildLineageEdges,
    checkEventIsLineageEdge,
    findCopyBornContent,
    lineageOf,
} from "../src/layered_lineage.ts";
import type { LineageEvidence } from "../src/layered_lineage.ts";
import type { CopyEvent, RenameEvent } from "../src/reconstruction_engine.ts";
import type { BeaconNode, ReconstructionEntity } from "../src/layered_types.ts";

const SESSION_FILE = new Path("/fixture/session.jsonl");

function makeEvidence(line: number) {
    return { sessionFile: SESSION_FILE, line };
}

// The engine's mv event shape (reconstruction_bash_events.ts), as extraction emits it.
function makeRenameEvent(from: string, to: string, instantMs: number): RenameEvent {
    return {
        kind: EventKind.rename,
        changeId: new Uuid(`toolu_${from}`),
        from: new Path(from),
        to: new Path(to),
        timestamp: new Date(instantMs),
    };
}

// The engine's cp event shape; seedLines is empty at extraction time (the cp result carries no content) — the layered graph derives the genesis instead.
function makeCopyEvent(from: string, to: string, instantMs: number): CopyEvent {
    return {
        kind: EventKind.copy,
        changeId: new Uuid(`toolu_${to}`),
        from: new Path(from),
        to: new Path(to),
        seedLines: [],
        timestamp: new Date(instantMs),
    };
}

function makeBeacon(instantMs: number, content: string): BeaconNode {
    return {
        kind: LayeredNodeKind.beacon,
        instant: new Date(instantMs),
        content,
        evidence: makeEvidence(1),
    };
}

// One entity holding a single session's beacons — the source of a copy needs verified bytes.
function makeEntity(filename: string, nodes: BeaconNode[]): ReconstructionEntity {
    return {
        filename: new Path(filename),
        sessionTimelines: [{ sessionFile: SESSION_FILE, timeline: { nodes } }],
    };
}

function indexEntities(entities: ReconstructionEntity[]): Map<string, ReconstructionEntity> {
    return new Map(entities.map((entity) => [entity.filename.toString(), entity]));
}

function listLineagePaths(entity: ReconstructionEntity, renames: Parameters<typeof lineageOf>[1]): string {
    return lineageOf(entity, renames).map((step) => step.filename.toString()).join(" -> ");
}

test("test_lineage_edges_carry_timestamps_and_jsonl_evidence", () => {
    const evidence: LineageEvidence[] = [
        { event: makeRenameEvent("/w/a.py", "/w/b.py", 1000), evidence: makeEvidence(7) },
        { event: makeCopyEvent("/w/b.py", "/w/copy.py", 2000), evidence: makeEvidence(9) },
    ];
    const entitiesByPath = indexEntities([]);
    const { renames, copies } = buildLineageEdges(evidence, entitiesByPath);

    assert.equal(renames.length, 1);
    assert.equal(renames[0]!.renamedFrom.filename.toString(), "/w/a.py");
    assert.equal(renames[0]!.renamedTo.filename.toString(), "/w/b.py");
    assert.equal(renames[0]!.timestampOfRename.getTime(), 1000);
    assert.deepEqual(renames[0]!.evidence, makeEvidence(7));

    assert.equal(copies.length, 1);
    assert.equal(copies[0]!.copiedFrom.filename.toString(), "/w/b.py");
    assert.equal(copies[0]!.bornCopy.filename.toString(), "/w/copy.py");
    assert.equal(copies[0]!.timestampOfCopy.getTime(), 2000);
    assert.deepEqual(copies[0]!.evidence, makeEvidence(9));

    // Endpoints with no content evidence of their own still get exactly one entity each, and the rename destination is the SAME object the copy source points at.
    assert.deepEqual([...entitiesByPath.keys()].sort(), ["/w/a.py", "/w/b.py", "/w/copy.py"]);
    assert.equal(renames[0]!.renamedTo, copies[0]!.copiedFrom);
});

test("test_rename_chain_walks_end_to_end_from_any_name", () => {
    const evidence: LineageEvidence[] = [
        { event: makeRenameEvent("/w/a.py", "/w/b.py", 1000), evidence: makeEvidence(1) },
        { event: makeRenameEvent("/w/b.py", "/w/c.py", 2000), evidence: makeEvidence(2) },
        { event: makeRenameEvent("/w/c.py", "/w/d.py", 3000), evidence: makeEvidence(3) },
    ];
    const entitiesByPath = indexEntities([]);
    const { renames } = buildLineageEdges(evidence, entitiesByPath);
    const chain = "/w/a.py -> /w/b.py -> /w/c.py -> /w/d.py";

    // One continuous history, oldest name first, whichever name you ask from.
    assert.equal(listLineagePaths(entitiesByPath.get("/w/a.py")!, renames), chain);
    assert.equal(listLineagePaths(entitiesByPath.get("/w/c.py")!, renames), chain);
    assert.equal(listLineagePaths(entitiesByPath.get("/w/d.py")!, renames), chain);
});

test("test_rename_cycle_terminates", () => {
    // `mv a b; mv b a` is recorded evidence, not a paradox — the walk must stop, not hang.
    const evidence: LineageEvidence[] = [
        { event: makeRenameEvent("/w/a.py", "/w/b.py", 1000), evidence: makeEvidence(1) },
        { event: makeRenameEvent("/w/b.py", "/w/a.py", 2000), evidence: makeEvidence(2) },
    ];
    const entitiesByPath = indexEntities([]);
    const { renames } = buildLineageEdges(evidence, entitiesByPath);

    assert.equal(listLineagePaths(entitiesByPath.get("/w/a.py")!, renames), "/w/b.py -> /w/a.py");
});

test("test_copy_fork_leaves_both_lineages_independent", () => {
    const source = makeEntity("/w/src.py", [makeBeacon(1000, "one")]);
    const entitiesByPath = indexEntities([source]);
    const { renames, copies } = buildLineageEdges(
        [{ event: makeCopyEvent("/w/src.py", "/w/fork.py", 2000), evidence: makeEvidence(4) }],
        entitiesByPath,
    );
    const fork = copies[0]!.bornCopy;

    // A copy is a fork, not a sequence: neither side enters the other's lineage, and no RenameEdge was created for it.
    assert.equal(renames.length, 0);
    assert.deepEqual(lineageOf(source, renames), [source]);
    assert.deepEqual(lineageOf(fork, renames), [fork]);
    // Both entities stay alive in the graph.
    assert.deepEqual([...entitiesByPath.keys()].sort(), ["/w/fork.py", "/w/src.py"]);
});

test("test_copy_born_content_is_the_source_state_at_the_copy_instant", () => {
    const source = makeEntity("/w/src.py", [
        makeBeacon(1000, "one"),
        makeBeacon(2000, "two"),
        makeBeacon(4000, "three"),
    ]);
    const { copies } = buildLineageEdges(
        [{ event: makeCopyEvent("/w/src.py", "/w/fork.py", 3000), evidence: makeEvidence(4) }],
        indexEntities([source]),
    );

    // At or before, never pulling future content backward.
    assert.equal(findCopyBornContent(copies[0]!), "two");
});

test("test_copy_before_any_verified_source_state_has_unknown_genesis", () => {
    const source = makeEntity("/w/src.py", [makeBeacon(5000, "later")]);
    const { copies } = buildLineageEdges(
        [{ event: makeCopyEvent("/w/src.py", "/w/fork.py", 3000), evidence: makeEvidence(4) }],
        indexEntities([source]),
    );

    // Q8: no evidence yet means unknown, never invented.
    assert.equal(findCopyBornContent(copies[0]!), undefined);
});

test("test_only_rename_and_copy_events_become_edges", () => {
    assert.equal(checkEventIsLineageEdge(makeRenameEvent("/w/a.py", "/w/b.py", 1)), true);
    assert.equal(checkEventIsLineageEdge(makeCopyEvent("/w/a.py", "/w/b.py", 1)), true);
    assert.equal(
        checkEventIsLineageEdge({
            kind: EventKind.write,
            changeId: new Uuid("toolu_w"),
            target: new Path("/w/a.py"),
            content: "one",
            timestamp: new Date(1),
        }),
        false,
    );
});
