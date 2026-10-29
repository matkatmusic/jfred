// Unit tests for the DOM-free file-history model helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildFileHistoryViewModel,
    computeAnchoredRevisionIndex,
    findLineForChangeId,
    findRevisionForChangeId,
    isChangeIdBackupBlobName,
} from "../webapp/views/file-history-model.ts";

const line = (text: string) => ({ values: [{ line: "old" }, { line: text }] });

test("buildFileHistoryViewModel renders last line values and handles unknown path", () => {
    const document = {
        filesTouched: [{ target: "a.ts", revisions: [{ kind: "changed", changeId: "c1", timestamp: "t1", lines: [line("x"), line("y")] }] }],
    };
    assert.equal(buildFileHistoryViewModel(document, "a.ts").revisions[0]!.content, "x\ny");
    assert.deepEqual(buildFileHistoryViewModel(document, "b.ts").revisions, []);
});

test("computeAnchoredRevisionIndex accepts only in-range integers", () => {
    assert.equal(computeAnchoredRevisionIndex("2", 3), 1);
    assert.equal(computeAnchoredRevisionIndex("0", 3), undefined);
    assert.equal(computeAnchoredRevisionIndex("4", 3), undefined);
    assert.equal(computeAnchoredRevisionIndex("x", 3), undefined);
    assert.equal(computeAnchoredRevisionIndex(undefined, 3), undefined);
});

test("findLineForChangeId returns first matching index or -1", () => {
    assert.equal(findLineForChangeId(["a", "toolu_1 b", "toolu_1"], "toolu_1"), 1);
    assert.equal(findLineForChangeId(["a"], "toolu_1"), -1);
});

test("isChangeIdBackupBlobName detects blob names", () => {
    assert.equal(isChangeIdBackupBlobName("abc@v2"), true);
    assert.equal(isChangeIdBackupBlobName("toolu_1"), false);
});

test("findRevisionForChangeId matches exact id then blob prefix at backup time", () => {
    const filesTouched = [{ target: "a.ts", revisions: [{ changeId: "h@v1", timestamp: "2026-01-01" }, { changeId: "h@v2", timestamp: "2026-01-03" }] }];
    assert.deepEqual(findRevisionForChangeId(filesTouched, "h@v2"), { target: "a.ts", revisionNumber: 2 });
    assert.deepEqual(findRevisionForChangeId(filesTouched, "h@v9", "2026-01-02"), { target: "a.ts", revisionNumber: 1 });
    assert.deepEqual(findRevisionForChangeId(filesTouched, "h@v9"), { target: "a.ts", revisionNumber: undefined });
    assert.equal(findRevisionForChangeId(filesTouched, "toolu_9"), undefined);
});
