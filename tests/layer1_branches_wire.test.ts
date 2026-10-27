// Rewound branches become lanes with a rewind kind, a fork anchor and revisions below the fork.

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { buildBranchesView, type Layer1WireBranchesView } from "../src/layer1_branches_wire.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { buildStepTimeline } from "../src/reconstruction_steps.ts";
import { createSidecarReader } from "../src/reconstruction_sidecar_backup_path.ts";
import { findSessionId, getFileHistoryRoot } from "../src/reconstruction_sidecar_reader.ts";
import { Path } from "../src/structures/domain.ts";
import { WireRewindKind } from "../webapp/layer1-wire-branches.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { findScenarioJsonl } from "./fixtures.ts";
import { SESSION_A, buildPromptRecord, buildWriteRecordPair, makeSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";

type WireBranchRow = Layer1WireBranchesView["pairs"][number]["branches"][number];

function listScenarioLanes(scenarioDir: string): { path: string; branch: WireBranchRow }[] {
    const jsonl = findScenarioJsonl(scenarioDir);
    const { records } = loadTranscript(jsonl, undefined, true);
    const projectFolder = new Path(records.find((record) => record.cwd !== undefined)!.cwd!.toString());
    const view = buildBranchesView(projectFolder, listTranscriptFiles([dirname(jsonl)]));
    return view.pairs.flatMap((pair) => pair.branches.map((branch) => ({ path: pair.path.toString(), branch })));
}

function listDiskInstants(scenarioDir: string, relativePath: string): number[] {
    const { records } = loadTranscript(findScenarioJsonl(scenarioDir), undefined, true);
    const reader = createSidecarReader(findSessionId(records)!, getFileHistoryRoot(records));
    const history = buildStepTimeline(records, reader).histories.find((candidate) => candidate.target.toString().endsWith(`/${relativePath}`));
    return history!.revisions.map((revision) => revision.timestamp.getTime());
}

for (const scenarioDir of ["s11-write-code-restore-rewrite", "s16-multi-edit-code-restore-re-edit", "s20-user-edit-code-rewind", "s45-rewind-abandoned-branch"]) {
    test(`test_${scenarioDir}_gives_code_lanes_without_rejoin`, () => {
        const lanes = listScenarioLanes(scenarioDir);
        assert.ok(lanes.length > 0);
        for (const { branch } of lanes) {
            assert.equal(branch.rewindKind, WireRewindKind.code);
            assert.equal("rejoinAt" in branch, false);
            assert.equal("keptToEnd" in branch, false);
        }
    });
}

for (const scenarioDir of ["s12-write-conv-only-rewrite", "s17-multi-edit-conv-only-re-edit", "s22-user-edits-conv-rewind"]) {
    test(`test_${scenarioDir}_gives_conversation_lanes_rejoining_a_trunk_revision`, () => {
        const lanes = listScenarioLanes(scenarioDir);
        assert.ok(lanes.length > 0);
        for (const { path, branch } of lanes) {
            assert.equal(branch.rewindKind, WireRewindKind.conversation);
            assert.equal("keptToEnd" in branch, false);
            const laneInstants = branch.nodes.map((node) => node.instant.getTime());
            const trunkInstants = listDiskInstants(scenarioDir, path).filter((instant) => !laneInstants.includes(instant));
            assert.ok(trunkInstants.includes(branch.rejoinAt!.getTime()));
        }
    });
}

for (const scenarioDir of ["s14-multi-edit-conv-only-read", "fork-stitch"]) {
    test(`test_${scenarioDir}_gives_kept_to_end_lanes_without_rejoin`, () => {
        const lanes = listScenarioLanes(scenarioDir);
        assert.ok(lanes.length > 0);
        for (const { branch } of lanes) {
            assert.equal(branch.rewindKind, WireRewindKind.conversation);
            assert.equal(branch.keptToEnd, true);
            assert.equal("rejoinAt" in branch, false);
        }
    });
}

test("test_lane_nodes_carry_change_id_and_event_word_and_follow_the_fork", () => {
    const { branch } = listScenarioLanes("s17-multi-edit-conv-only-re-edit")[0]!;
    assert.ok(branch.nodes.length > 0);
    for (const node of branch.nodes) {
        assert.match(node.changeId.toString(), /^toolu_/);
        assert.match(node.label, /^(edit|write|overwrite|user-edit|delete|rename)$/);
        assert.ok(node.instant.getTime() >= branch.forkAt.getTime());
    }
});

function buildAssistantTextRecord(uuid: string, parentUuid: string, timestamp: string, cwd: string): object {
    return { type: "assistant", uuid, parentUuid, sessionId: SESSION_A, timestamp, cwd, message: { role: "assistant", content: [{ type: "text", text: uuid }] } };
}

function writePairAt(cwd: string, toolId: string, timestamp: string, parentUuid: string, fileName: string, content: string): { records: object[]; lastUuid: string } {
    return buildWriteRecordPair({ sessionId: SESSION_A, cwd, timestamp, toolId, parentUuid }, `${cwd}/${fileName}`, content);
}

test("test_unnamed_main_line_with_a_structural_rewind_gives_exactly_the_structural_lane", () => {
    const tree = makeSourceTree("-unnamed-main-line");
    const cwd = "/tmp/unnamed-main-line";
    const trunkWrite = writePairAt(cwd, "toolu_t0", "2026-07-24T10:00:30.000Z", "p0", "trunk.txt", "trunk\n");
    const abandonedWrite = writePairAt(cwd, "toolu_t1", "2026-07-24T10:02:00.000Z", "p1", "f.txt", "abandoned\n");
    const keptWrite = writePairAt(cwd, "toolu_t2", "2026-07-24T10:06:00.000Z", "p2", "f.txt", "kept\n");
    writeTranscriptFixture(tree.projectDir, "main.jsonl", [
        buildPromptRecord("p0", null, "2026-07-24T10:00:00.000Z", cwd),
        ...trunkWrite.records,
        buildAssistantTextRecord("a0", trunkWrite.lastUuid, "2026-07-24T10:01:00.000Z", cwd),
        buildPromptRecord("p1", "a0", "2026-07-24T10:01:30.000Z", cwd),
        ...abandonedWrite.records,
        buildPromptRecord("p2", "a0", "2026-07-24T10:05:00.000Z", cwd),
        ...keptWrite.records,
        { type: "last-prompt", sessionId: SESSION_A },
    ]);
    const view = buildBranchesView(new Path(cwd), listTranscriptFiles([tree.projectDir]));
    assert.deepEqual(view.pairs.map((pair) => pair.path.toString()), ["f.txt"]);
    const lanes = view.pairs[0]!.branches;
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]!.forkAt.toISOString(), "2026-07-24T10:01:00.000Z");
    assert.deepEqual(lanes[0]!.nodes.map((node) => node.changeId.toString()), ["toolu_t1"]);
    assert.equal(lanes[0]!.rewindKind, WireRewindKind.code);
});

test("test_parallel_tool_call_sibling_is_not_a_lane", () => {
    const tree = makeSourceTree("-parallel-calls");
    const cwd = "/tmp/parallel-calls";
    const first = writePairAt(cwd, "toolu_a", "2026-07-24T10:00:10.000Z", "p0", "a.txt", "a\n");
    const sibling = writePairAt(cwd, "toolu_b", "2026-07-24T10:00:11.000Z", "toolu_a-assistant", "b.txt", "b\n");
    const next = writePairAt(cwd, "toolu_c", "2026-07-24T10:00:20.000Z", first.lastUuid, "c.txt", "c\n");
    const sameMessage = [...first.records, ...sibling.records].map((record: any) =>
        record.type === "assistant" ? { ...record, message: { ...record.message, id: "msg_1" } } : record);
    writeTranscriptFixture(tree.projectDir, "parallel.jsonl", [
        buildPromptRecord("p0", null, "2026-07-24T10:00:00.000Z", cwd),
        ...sameMessage,
        { type: "last-prompt", sessionId: SESSION_A, leafUuid: sibling.lastUuid },
        ...next.records,
        { type: "last-prompt", sessionId: SESSION_A, leafUuid: next.lastUuid },
    ]);
    assert.deepEqual(buildBranchesView(new Path(cwd), listTranscriptFiles([tree.projectDir])), { pairs: [] });
});
