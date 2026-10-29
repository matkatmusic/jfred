// Task 181: collectSessionNodes maps a session's file events into the file -> session -> nodes map.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { LayeredNodeKind } from "../src/structures/vocabulary_views.ts";
import { collectSessionNodes } from "../src/layered_load_nodes.ts";
import type { LineageEvidence } from "../src/layered_lineage.ts";
import type { TimelineNode } from "../src/layered_types.ts";
import {
    SESSION_A,
    createSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";
import { buildWriteRecordPair } from "./tool-call-record-pair-builders.ts";

test("test_collectSessionNodes_write_event_becomes_beacon_under_file_and_session", () => {
    const tree = createSourceTree("-layered-nodes-project");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const alphaPath = join(workspaceRoot, "alpha.py");
    const write = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_nodes_w1", parentUuid: null },
        alphaPath,
        "line one\n",
    );
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", write.records);
    const sessionFile = new Path(join(tree.projectDir, "a.jsonl"));
    const nodesByFileThenSession = new Map<string, Map<string, TimelineNode[]>>();
    const lineageEvidence: LineageEvidence[] = [];
    collectSessionNodes(records, sessionFile, nodesByFileThenSession, lineageEvidence);
    const nodes = nodesByFileThenSession.get(alphaPath)?.get(sessionFile.toString());
    assert.equal(nodes?.length, 1);
    const node = nodes![0]!;
    assert.equal(node.kind, LayeredNodeKind.beacon);
    if (node.kind !== LayeredNodeKind.beacon) {
        return;
    }
    assert.equal(node.content, "line one\n");
    assert.equal(node.evidence?.sessionFile.toString(), sessionFile.toString());
    assert.deepEqual(lineageEvidence, []);
});
