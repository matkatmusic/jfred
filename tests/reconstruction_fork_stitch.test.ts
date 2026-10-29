// Real fork capture in scenarios/executed/fork-stitch; the fixtures.ts import keeps it out of `npm run test:ci`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { Path } from "../src/structures/domain.ts";
import { mergeMultiSourceRecords } from "../src/reconstruction_multi_source.ts";
import { buildBranchedReconstruction } from "../src/reconstruction_engine.ts";
import { buildSidecarReader } from "../src/reconstruction_sidecar_reader.ts";
import { findScenarioDir } from "./scenario-locator.ts";

const SCENARIO_ROOT = fileURLToPath(new URL("../scenarios/executed", import.meta.url));
const FORK_DIR = findScenarioDir([SCENARIO_ROOT], "fork-stitch");
const PARENT_SESSION = "1370c498-2c5d-4160-b186-35050cf1cffa";
const PARENT_JSONL = join(FORK_DIR, `${PARENT_SESSION}.jsonl`);
const SUBAGENT_JSONL = join(FORK_DIR, PARENT_SESSION, "subagents", "agent-a7b575676defea277.jsonl");

test("test_forked_subagent_adds_one_rewound_branch_and_leaves_the_surviving_side_alone", () => {
    // Scenario: the real parent holds no rewound branch; stitching in the fork adds exactly one.
    const parent = loadTranscript(PARENT_JSONL, undefined, true);
    const subagent = loadTranscript(SUBAGENT_JSONL, undefined, true);
    const sources = [{ projectsDir: new Path(FORK_DIR) }];
    const merged = mergeMultiSourceRecords([parent.records, subagent.records], sources);
    const parentOnly = buildBranchedReconstruction(parent.records, buildSidecarReader(parent.records));
    const stitched = buildBranchedReconstruction(merged, buildSidecarReader(merged, sources));
    // One extra non-surviving branch, forked at the parent's last record before the fork.
    assert.equal(stitched.rewound.length, parentOnly.rewound.length + 1);
    const forkBranch = stitched.rewound[stitched.rewound.length - 1]!;
    assert.ok(forkBranch.rewindPoint.toString().startsWith("7654d562"));
    // The surviving side matches the parent-only run.
    assert.equal(stitched.survivingTip!.toString(), parentOnly.survivingTip!.toString());
    assert.deepEqual(stitched.surviving, parentOnly.surviving);
    // The fork's histories include the subagent's edit target.
    const targets = forkBranch.histories.map((history) => history.target.toString());
    assert.ok(targets.some((target) => target.endsWith("task-29/diagram-io.ts")));
});
