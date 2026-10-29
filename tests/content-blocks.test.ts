import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord } from "../src/parse/parseRecord.ts";
import {
    getContentBlocks,
    UnknownContentBlockTypeError,
    type ToolUseBlock,
} from "../src/structures/content-blocks.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import { readNonEmptyLines } from "./utilities.ts";
import { S1_JSONL } from "./fixtures.ts";

function findWriteToolUseBlockInLine(line: string): ToolUseBlock | undefined {
    const record = parseRecord(line);
    if (record.type !== RecordType.assistant) {
        return undefined;
    }
    for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_use && block.name === ToolName.Write) {
            return block;
        }
    }
    return undefined;
}

test("test_assistant_record_exposes_write_tool_use_block", () => {
    // Scenario: the file-creating assistant turn exposes a typed Write `tool_use` block; scan assistant records for it.
    let writeBlock: ToolUseBlock | undefined;
    for (const line of readNonEmptyLines(S1_JSONL)) {
        writeBlock = writeBlock ?? findWriteToolUseBlockInLine(line);
    }
    // s1 must contain exactly such a block.
    if (!writeBlock) {
        assert.fail("expected a Write tool_use block in s1");
    }
    // the block carries a Uuid id and an input object with file_path + content.
    assert.ok(writeBlock.id instanceof Uuid);
    assert.equal(writeBlock.caller.type, "direct");
    assert.ok("file_path" in writeBlock.input);
    assert.ok("content" in writeBlock.input);
});

test("test_getContentBlocks_throws_on_unknown_block_type", () => {
    // Scenario: a block whose `type` is outside the known vocabulary throws; use a fake record with an unmodeled type.
    const line = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "mystery-block", source: {} }] },
    });
    const record = parseRecord(line);
    // extracting its blocks throws.
    assert.throws(
        () => getContentBlocks(record),
        UnknownContentBlockTypeError,
    );
});

test("test_getContentBlocks_accepts_advisor_blocks", () => {
    // Scenario: the Advisor tool's server_tool_use and advisor_tool_result blocks parse without throwing and come back typed.
    const serverToolUseLine = JSON.stringify({
        type: "assistant",
        message: {
            content: [
                { type: "server_tool_use", id: "srvtoolu_01abc", name: "advisor", input: {} },
            ],
        },
    });
    const advisorResultLine = JSON.stringify({
        type: "user",
        message: {
            content: [
                {
                    type: "advisor_tool_result",
                    tool_use_id: "srvtoolu_01abc",
                    content: { type: "advisor_redacted_result", encrypted_content: "AAAA" },
                },
            ],
        },
    });
    // extracting the blocks succeeds and returns the typed blocks.
    const serverToolUseBlocks = getContentBlocks(parseRecord(serverToolUseLine));
    assert.equal(serverToolUseBlocks[0]?.type, BlockType.server_tool_use);
    const advisorResultBlocks = getContentBlocks(parseRecord(advisorResultLine));
    assert.equal(advisorResultBlocks[0]?.type, BlockType.advisor_tool_result);
});

function buildBase64ImageBlock() {
    return {
        type: "image",
        source: { type: "base64", data: "aGk=", media_type: "image/png" },
    };
}

test("test_getContentBlocks_accepts_image_block", () => {
    // Scenario: a user turn with a pasted image parses without throwing and the block is typed BlockType.image.
    const line = JSON.stringify({
        type: "user",
        message: {
            content: [buildBase64ImageBlock()],
        },
    });
    const record = parseRecord(line);
    // extracting its blocks succeeds and returns the image block.
    const blocks = getContentBlocks(record);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, BlockType.image);
});

