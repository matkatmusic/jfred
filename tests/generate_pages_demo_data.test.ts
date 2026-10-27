// Tests the pure helpers of the Pages demo generator; the import must not run the generation itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logGenerationProgress, writeJsonFile } from "../scripts/generate_pages_demo_data.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";

test("test_write_json_file_writes_one_json_line_with_newline_terminator", () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "pages-demo-")), "out.json");
    writeJsonFile(filePath, { alpha: 1, beta: ["x"] });
    assert.equal(readFileSync(filePath, "utf8"), '{"alpha":1,"beta":["x"]}\n');
});

test("test_log_generation_progress_prints_label_with_counter", (context) => {
    const logged = context.mock.method(console, "log", () => undefined);
    logGenerationProgress({ kind: DocumentResponseKind.progress, label: "parsing", current: 2, total: 5 });
    assert.equal(logged.mock.calls[0]!.arguments[0], "   parsing (2/5)");
});

test("test_log_generation_progress_omits_counter_without_current", (context) => {
    const logged = context.mock.method(console, "log", () => undefined);
    logGenerationProgress({ kind: DocumentResponseKind.progress, label: "building" });
    assert.equal(logged.mock.calls[0]!.arguments[0], "   building");
});
