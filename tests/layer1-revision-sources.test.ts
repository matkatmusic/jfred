// Revision sources: each step carries a marker and the params its server route needs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getInputById } from "../webapp/app-dom.ts";
import { createCommitStep, createDiskStep, createSnapshotStep } from "../webapp/layer1-revision-sources.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("commit and disk steps read their repo and dir inputs", () => {
    initLayer1Dom();
    getInputById("repo").value = " /repo ";
    getInputById("dir").value = "/project";
    const commit = createCommitStep("a.ts", "0123456789abcdef");
    assert.equal(commit.marker, "01234567");
    assert.equal(commit.buildParams().get("repo"), "/repo");
    assert.equal(commit.buildParams().get("hash"), "0123456789abcdef");
    assert.equal(createDiskStep("a.ts").buildParams().get("dir"), "/project");
});

test("a snapshot step names its version in the marker", () => {
    initLayer1Dom();
    getInputById("dir").value = "/project";
    const step = createSnapshotStep("a.ts", { sessionFile: "s.jsonl", sessionId: "sid", version: 3 });
    assert.equal(step.marker, "@v3 📸");
    assert.equal(step.buildParams().get("version"), "3");
});
