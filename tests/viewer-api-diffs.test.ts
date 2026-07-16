// Tests for src/viewer_api_diffs.ts: the two diff renderers (revision timeline and vs-base).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import {
    renderRevisionDiff,
    renderDiffVsBase,
} from "../src/viewer_api_diffs.ts";
import { Path } from "../src/structures/domain.ts";
import { S19_JSONL } from "./fixtures.ts";

// -------------------- 2.6 diff renderers --------------------

// s19's reconstructed scenario19.py — the one file the scenario touches.
function buildS19DocumentAndTarget(): { document: ReturnType<typeof buildProjectDocument>; target: Path } {
    const document = buildProjectDocument([new Path(S19_JSONL)], undefined);
    const history = document.filesTouched.find((entry) => entry.target.toString().endsWith("scenario19.py"));
    assert.ok(history !== undefined, "s19 touches scenario19.py");
    return { document, target: history.target };
}

test("test_renderRevisionDiff_shows_consecutive_changes_for_a_file", () => {
    // Scenario: the revision-timeline diff for s19's scenario19.py contains the
    // user's out-of-band tweak line as an addition.
    const { document, target } = buildS19DocumentAndTarget();
    const diffText = renderRevisionDiff(document, target);
    assert.ok(diffText.includes("# user tweak"), "the revision diff carries the scenario's added line");
});

test("test_renderDiffVsBase_diffs_first_revision_against_selected", () => {
    // Scenario: diffing the base (first revision) against the final revision of s19's
    // scenario19.py shows the multiply function that only exists at the end.
    const { document, target } = buildS19DocumentAndTarget();
    const history = document.filesTouched.find((entry) => entry.target.equals(target))!;
    const diffText = renderDiffVsBase(document, target, history.revisions.length - 1);
    assert.ok(diffText.includes("def multiply(a, b):"), "the vs-base diff carries the final-only function");
});
