// Construction exercise for the layered data model (task 195, spec S1): build a small two-entity graph — every node kind, a rename, a copy, and a script link — and check the discriminants and evidence wiring hold together.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary.ts";
import type {
    JsonlRef,
    ReconstructionEntity,
    ReconstructionGraph,
    ScriptRunNode,
    TimelineNode,
} from "../src/layered_types.ts";

const SESSION_FILE = new Path("a35.jsonl");

function buildEvidence(line: number): JsonlRef {
    return { sessionFile: SESSION_FILE, line };
}

// One entity whose single session timeline holds every node kind, in Instant order.
function buildInventoryEntity(): ReconstructionEntity {
    const nodes: TimelineNode[] = [
        { kind: LayeredNodeKind.preAnchorStub, instant: new Date("2026-04-25T01:00:00.000Z"), evidence: buildEvidence(10) },
        { kind: LayeredNodeKind.beacon, instant: new Date("2026-04-25T01:05:00.000Z"), content: "def load(): ...", evidence: buildEvidence(20) },
        { kind: LayeredNodeKind.presumedUserEdit, instant: new Date("2026-04-25T01:10:00.000Z") },
        { kind: LayeredNodeKind.scriptRun, instant: new Date("2026-04-25T01:15:00.000Z"), code: "python3 fix.py", evidence: buildEvidence(30) },
        { kind: LayeredNodeKind.endState, instant: new Date("2026-04-25T01:20:00.000Z"), content: "def load(): ...  # latest" },
    ];
    return {
        filename: new Path("/repo/inventory.py"),
        sessionTimelines: [{ sessionFile: SESSION_FILE, timeline: { nodes } }],
    };
}

function findScriptRunNode(entity: ReconstructionEntity): ScriptRunNode {
    const node = entity.sessionTimelines[0]!.timeline.nodes.find((candidate) => candidate.kind === LayeredNodeKind.scriptRun);
    assert.ok(node !== undefined);
    return node as ScriptRunNode;
}

test("graph_construction_holds_every_node_kind_and_edge_type", () => {
    const inventory = buildInventoryEntity();
    const renamed: ReconstructionEntity = { filename: new Path("/repo/stock.py"), sessionTimelines: [] };
    const copied: ReconstructionEntity = { filename: new Path("/repo/inventory_backup.py"), sessionTimelines: [] };
    const scriptRun = findScriptRunNode(inventory);
    const graph: ReconstructionGraph = {
        entities: [inventory, renamed, copied],
        renames: [{ renamedFrom: inventory, renamedTo: renamed, timestampOfRename: new Date("2026-04-25T01:18:00.000Z"), evidence: buildEvidence(40) }],
        copies: [{ copiedFrom: inventory, timestampOfCopy: new Date("2026-04-25T01:12:00.000Z"), bornCopy: copied, evidence: buildEvidence(35) }],
        scriptLinks: [{ scriptRun, filesRead: [inventory], filesWritten: [inventory], evidence: buildEvidence(30) }],
    };
    assert.equal(graph.entities.length, 3);
    assert.equal(graph.renames[0]!.renamedTo.filename.toString(), "/repo/stock.py");
    assert.equal(graph.copies[0]!.bornCopy.filename.toString(), "/repo/inventory_backup.py");
    assert.equal(graph.scriptLinks[0]!.scriptRun.code, "python3 fix.py");
});

test("timeline_nodes_carry_their_kind_discriminants_in_instant_order", () => {
    const inventory = buildInventoryEntity();
    const nodes = inventory.sessionTimelines[0]!.timeline.nodes;
    const kinds = nodes.map((node) => node.kind);
    assert.deepEqual(kinds, [
        LayeredNodeKind.preAnchorStub,
        LayeredNodeKind.beacon,
        LayeredNodeKind.presumedUserEdit,
        LayeredNodeKind.scriptRun,
        LayeredNodeKind.endState,
    ]);
    const instants = nodes.map((node) => node.instant.getTime());
    assert.deepEqual(instants, [...instants].sort((a, b) => a - b));
});
