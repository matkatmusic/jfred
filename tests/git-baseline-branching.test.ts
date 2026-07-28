// Cross-session branch attribution for the git-baseline family: a session whose baseline state equals the previous session's final state CONTINUES that branch — its edits are surviving, not rewound. Pinned against s39 ground truth (.step_states/step-003..006/orders.py all contain `def count`, proving the second session's edit is the surviving tip, not an orphan).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { stripTrailingNewline } from "../src/reconstruction_steps.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { S39_JSONL_PATHS, S39_PROJECT_DIR } from "./fixtures.ts";

// A revision's current full text: each line entry's latest sighted value, newline-joined (the engine's line model omits the trailing newline that on-disk ground truth keeps).
function renderRevisionText(revision: { lines: { values: { line: string }[] }[] }): string {
    return revision.lines.map((entry) => entry.values[entry.values.length - 1]!.line).join("\n");
}

test("test_s39_second_session_edit_survives_on_the_main_branch", () => {
    // Scenario: s39 session 1 writes orders.py; session 2 (spawned via EndCurrentAgentAndSpawnNewAgent --excludeJSONL) edits it, adding `def count`. Ground truth (.step_states/step-006/orders.py) proves the edit is the surviving tip — the engine must not fork it onto a rewound branch.  Steps: build the two-session project document.
    const document = buildProjectDocument(S39_JSONL_PATHS, undefined);
    // find orders.py's surviving history.
    const orders = document.filesTouched.find((history) => history.target.toString().endsWith("/orders.py"));
    assert.ok(orders !== undefined);
    // assert its surviving history ends in the session-2 edit revision...
    const lastRevision = orders.revisions[orders.revisions.length - 1]!;
    assert.equal(lastRevision.kind, EventKind.edit);
    // ...whose content reproduces the step-006 ground truth byte-for-byte.
    const groundTruth = readFileSync(join(S39_PROJECT_DIR.toString(), ".step_states", "step-006", "orders.py"), "utf8");
    assert.equal(renderRevisionText(lastRevision), stripTrailingNewline(groundTruth));
});

test("test_s39_has_no_rewound_branches", () => {
    // Scenario: s39 contains no rewinds — only a session boundary. Any rewound history in its document is a misattributed branch (the defect: session 2's baseline forks from the snapshot-backup blob instead of continuing session 1's final state).  Steps: build the two-session project document; assert no rewound histories exist.
    const document = buildProjectDocument(S39_JSONL_PATHS, undefined);
    assert.deepEqual(document.rewoundFilesTouched, []);
});

