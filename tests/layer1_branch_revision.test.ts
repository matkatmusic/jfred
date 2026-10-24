// A lane node's drawer sides are the session's disk-timeline revisions: after = that revision, before = the previous revision of the path.

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import { buildBranchesView } from "../src/layer1_branches_wire.ts";
import { readEditFileContent } from "../src/viewer_api_layer1_edit_file.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { linesTextOf } from "../src/reconstruction_revisions.ts";
import { createSidecarReader, findSessionId, resolveFileHistoryRoot } from "../src/reconstruction_sidecar_reader.ts";
import { reconstructStepTimeline } from "../src/reconstruction_steps.ts";
import { Path } from "../src/structures/domain.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { findScenarioJsonl } from "./fixtures.ts";

interface LaneNodeSides { changeId: string; path: string; before: string; after: string; query: (side: string) => URLSearchParams }

function listLaneNodeSides(scenarioDir: string): LaneNodeSides[] {
    const jsonl = findScenarioJsonl(scenarioDir);
    const { records } = loadTranscript(jsonl, undefined, true);
    const projectFolder = new Path(records.find((record) => record.cwd !== undefined)!.cwd!.toString());
    const view = buildBranchesView(projectFolder, listTranscriptFiles([dirname(jsonl)]));
    const { histories } = reconstructStepTimeline(records, createSidecarReader(findSessionId(records)!, resolveFileHistoryRoot(records)));
    return view.pairs.flatMap((pair) => pair.branches.flatMap((branch) => branch.nodes.map((node) => {
        const revisions = histories.find((history) => history.target.toString().endsWith(`/${pair.path.toString()}`))!.revisions;
        const index = revisions.findIndex((revision) => revision.changeId.toString() === node.changeId.toString());
        return {
            changeId: node.changeId.toString(),
            path: pair.path.toString(),
            before: index === 0 ? "" : linesTextOf(revisions[index - 1]!).join("\n"),
            after: linesTextOf(revisions[index]!).join("\n"),
            query: (side: string) => new URLSearchParams({
                editChangeId: node.changeId.toString(), side, path: pair.path.toString(), dir: projectFolder.toString(), jsonl: dirname(jsonl), branch: "1",
            }),
        };
    })));
}

// s20's lane holds a user-edit, which has no transcript edit event for the trunk replay to find.
for (const scenarioDir of ["s17-multi-edit-conv-only-re-edit", "s16-multi-edit-code-restore-re-edit", "s20-user-edit-code-rewind"]) {
    test(`test_${scenarioDir}_lane_node_sides_equal_the_disk_timeline_revisions`, () => {
        const nodes = listLaneNodeSides(scenarioDir);
        assert.ok(nodes.length > 0);
        for (const node of nodes) {
            assert.notEqual(node.after, "");
            assert.equal(readEditFileContent(node.query("base")).content, node.before);
            assert.equal(readEditFileContent(node.query("target")).content, node.after);
        }
    });
}

test("test_a_change_id_in_no_lane_throws", () => {
    const node = listLaneNodeSides("s17-multi-edit-conv-only-re-edit")[0]!;
    const query = node.query("target");
    query.set("editChangeId", "toolu_not_in_any_lane");
    assert.throws(() => readEditFileContent(query), /toolu_not_in_any_lane/);
});
