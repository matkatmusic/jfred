import { test } from "node:test";
import assert from "node:assert/strict";
import { readWriteInput } from "../src/structures/tool-result-shapes.ts";
import { BlockType, ToolName } from "../src/structures/vocabulary.ts";
import type { ToolUseBlock } from "../src/structures/content-blocks.ts";
import { Uuid } from "../src/structures/domain.ts";

function buildWriteBlock(input: Record<string, unknown>): ToolUseBlock {
    return { type: BlockType.tool_use, id: new Uuid("toolu_w"), name: ToolName.Write, input, caller: { type: "direct" } };
}

test("test_readWriteInput_reads_the_file_path_and_content_shape", () => {
    const written = readWriteInput(buildWriteBlock({ file_path: "/p/a.ts", content: "a\n" }));
    assert.equal(written.filePath.toString(), "/p/a.ts");
    assert.equal(written.content, "a\n");
});

test("test_readWriteInput_reads_the_path_and_file_text_shape", () => {
    const written = readWriteInput(buildWriteBlock({ path: "/p/a.ts", file_text: "a\n" }));
    assert.equal(written.filePath.toString(), "/p/a.ts");
    assert.equal(written.content, "a\n");
});

test("test_readWriteInput_reads_the_mixed_file_path_and_file_text_shape", () => {
    const written = readWriteInput(buildWriteBlock({ file_path: "/p/a.ts", file_text: "a\n" }));
    assert.equal(written.filePath.toString(), "/p/a.ts");
    assert.equal(written.content, "a\n");
});

test("test_readWriteInput_reads_the_mixed_content_and_path_shape", () => {
    const written = readWriteInput(buildWriteBlock({ content: "a\n", path: "/p/a.ts" }));
    assert.equal(written.filePath.toString(), "/p/a.ts");
    assert.equal(written.content, "a\n");
});

test("test_readWriteInput_throws_naming_the_tool_use_when_the_path_is_missing", () => {
    assert.throws(() => readWriteInput(buildWriteBlock({ content: "a\n" })), /toolu_w/);
});

test("test_readWriteInput_throws_naming_the_tool_use_when_the_content_is_missing", () => {
    assert.throws(() => readWriteInput(buildWriteBlock({ file_path: "/p/a.ts" })), /toolu_w/);
});
