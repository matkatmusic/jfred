// Unit tests for per-revision diff block slicing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDiffBlocks } from "../webapp/views/file-history-diff-blocks.ts";

test("splitDiffBlocks splits on kind headers but not numeric hunk headers", () => {
    const blocks = splitDiffBlocks("ignored\n@@ changed @@\n@@ -1,1 +1,1 @@\n+x\n@@ renamed @@\n-y");
    assert.deepEqual(blocks, ["@@ changed @@\n@@ -1,1 +1,1 @@\n+x", "@@ renamed @@\n-y"]);
});
