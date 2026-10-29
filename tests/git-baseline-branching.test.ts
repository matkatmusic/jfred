// A session whose baseline equals the previous session's final state continues that branch (s39).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { trimTrailingNewline } from "../src/reconstruction_step_snapshot.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { S39_JSONL_PATHS, S39_PROJECT_DIR } from "./fixtures.ts";

// A revision's full text: each line entry's latest value, newline-joined, without a trailing newline.
function renderRevisionText(revision: { lines: { values: { line: string }[] }[] }): string {
    return revision.lines.map((entry) => entry.values[entry.values.length - 1]!.line).join("\n");
}

test("test_s39_second_session_edit_survives_on_the_main_branch", () => {
    // Session 2's edit to orders.py is the surviving tip, not a rewound branch.
    const document = buildProjectDocument(S39_JSONL_PATHS, undefined);
    // find orders.py's surviving history.
    const orders = document.filesTouched.find((history) => history.target.toString().endsWith("/orders.py"));
    assert.ok(orders !== undefined);
    // assert its surviving history ends in the session-2 edit revision...
    const lastRevision = orders.revisions[orders.revisions.length - 1]!;
    assert.equal(lastRevision.kind, EventKind.edit);
    // ...whose content reproduces the step-006 ground truth byte-for-byte.
    const groundTruth = readFileSync(join(S39_PROJECT_DIR.toString(), ".step_states", "step-006", "orders.py"), "utf8");
    assert.equal(renderRevisionText(lastRevision), trimTrailingNewline(groundTruth));
});

test("test_s39_has_no_rewound_branches", () => {
    // s39 has no rewinds, so any rewound history is a misattributed branch.
    const document = buildProjectDocument(S39_JSONL_PATHS, undefined);
    assert.deepEqual(document.rewoundFilesTouched, []);
});

