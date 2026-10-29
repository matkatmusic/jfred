// Branch view progress lines count groups, then groups that hold a lane.

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { test } from "node:test";
import {
    LAYER1_PROGRESS_LABEL_FINDING_BRANCHES,
    LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES,
    buildBranchesView,
} from "../src/layer1_branches_wire.ts";
import { loadTranscript, type ProgressSink } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import { listTranscriptFiles } from "../src/viewer_api_layer1_sources.ts";
import { findScenarioJsonl } from "./scenario-locator.ts";
import { buildPromptRecord, createSourceTree, writeTranscriptFixture } from "./multi-source-test-helpers.ts";

test("test_progress_counts_groups_then_groups_with_a_lane", () => {
    const tree = createSourceTree("-progress");
    writeTranscriptFixture(tree.projectDir, "empty.jsonl", [buildPromptRecord("p0", null, "2026-07-24T10:00:00.000Z", "/tmp/x")]);
    const files = [...listTranscriptFiles([dirname(findScenarioJsonl("s17-multi-edit-conv-only-re-edit"))]), ...listTranscriptFiles([tree.projectDir])];
    const { records } = loadTranscript(findScenarioJsonl("s17-multi-edit-conv-only-re-edit"), undefined, true);
    const lines: object[] = [];
    const sink: ProgressSink = (line) => lines.push(line);
    buildBranchesView(new Path(records.find((record) => record.cwd !== undefined)!.cwd!.toString()), files, sink);
    const progress = (label: string, current: number, total: number) => ({ kind: "progress", label, current, total });
    assert.deepEqual(lines, [
        progress(LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, 1, 2),
        progress(LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, 2, 2),
        progress(LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, 1, 1),
    ]);
});

test("test_progress_labels_are_the_documented_words", () => {
    assert.equal(LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, "finding branches");
    assert.equal(LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, "reconstructing branches");
});
