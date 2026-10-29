// Unit tests for per-file range patch splitting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPatchByFile } from "../webapp/views/timeline-patch-split.ts";

test("splitPatchByFile returns one block per diff header keyed by b/ path", () => {
    const patch = "diff --git a/x.ts b/x.ts\n+one\ndiff --git a/y.ts b/y.ts\n+two";
    assert.deepEqual(splitPatchByFile(patch), [
        { path: "x.ts", block: "diff --git a/x.ts b/x.ts\n+one" },
        { path: "y.ts", block: "diff --git a/y.ts b/y.ts\n+two" },
    ]);
});

test("splitPatchByFile ignores text before the first header", () => {
    assert.deepEqual(splitPatchByFile("preamble"), []);
});
