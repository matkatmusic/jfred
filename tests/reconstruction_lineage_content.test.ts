import { test } from "node:test";
import assert from "node:assert/strict";
import { getLineageContentBefore } from "../src/reconstruction_lineage_content.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { Path } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { buildToolRecord } from "./script-execution-test-helpers.ts";

const emptyReader: BackupReader = () => "";
const TARGET = new Path("/proj/plate.py");

test("test_getLineageContentBefore_returns_the_seed_text_with_a_trailing_newline", () => {
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
    ];
    const contentBefore = getLineageContentBefore(records, emptyReader);
    assert.equal(contentBefore(TARGET, new Date("2026-01-01T00:00:05Z")), "v1\n");
});

test("test_getLineageContentBefore_returns_undefined_before_the_first_revision", () => {
    const records = [
        buildToolRecord(ToolName.Write, { file_path: "/proj/plate.py", content: "v1\n" }, "2026-01-01T00:00:01Z", "/proj"),
    ];
    const contentBefore = getLineageContentBefore(records, emptyReader);
    assert.equal(contentBefore(TARGET, new Date("2026-01-01T00:00:00Z")), undefined);
});
