// The user's block-parent-edits PreToolUse hook saves a blocked call's tool input as a temp JSON file and names it in the denial; recorded Bash calls read that file later.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { ToolResultBlock } from "../src/structures/content-blocks.ts";
import { BlockType } from "../src/structures/vocabulary.ts";
import type { JSONLLine } from "./engineV3.ts";
import { getBlocksOfTimedLine } from "./engineV3_replay_tool_results.ts";

// The hook's denial sentence; the folder comes from the hook's settings, so only the sentence is matched.
const BLOCKED_CALL_SAVED_PATH = /Your blocked tool call is saved at (\S+\.json) \(JSON of the tool input\)/;
const JSON_INDENT_SPACES = 2;

type ToolInput = Record<string, unknown>;
type LineWithWireToolInputs = { wireToolInputs?: Record<string, ToolInput> };

// Keyed by tool_use id text; an input is dropped when the line with its result is replayed.
const hookToolInputsByCallId = new Map<string, ToolInput>();

// The hook got the parsed input: the wire keys in wire order, then the keys the parse added (an Edit's replace_all), with the parsed values.
function getHookToolInput(line: JSONLLine, callId: string, recordedInput: ToolInput): ToolInput {
  const wireToolInputs = (line as unknown as LineWithWireToolInputs).wireToolInputs;
  if (wireToolInputs === undefined) {
    return recordedInput;
  }
  return { ...wireToolInputs[callId], ...recordedInput };
}

function findSavedPath(resultBlock: ToolResultBlock): Path | undefined {
  if (resultBlock.is_error !== true) {
    return undefined;
  }
  if (typeof resultBlock.content !== "string") {
    return undefined;
  }
  const match = resultBlock.content.match(BLOCKED_CALL_SAVED_PATH);
  if (match === null) {
    return undefined;
  }
  return new Path(match[1]!);
}

function writeSavedFileOfResult(resultBlock: ToolResultBlock): void {
  const callId = resultBlock.tool_use_id.toString();
  const hookToolInput = hookToolInputsByCallId.get(callId);
  hookToolInputsByCallId.delete(callId);
  const savedPath = findSavedPath(resultBlock);
  if (savedPath === undefined) {
    return;
  }
  if (hookToolInput === undefined) {
    throw new Error(`writeBlockedCallSavedFiles: the result of ${callId} names the saved file ${savedPath.toString()}, but no replayed line holds the tool_use ${callId}`);
  }
  mkdirSync(dirname(savedPath.toString()), { recursive: true });
  writeFileSync(savedPath.toString(), JSON.stringify(hookToolInput, null, JSON_INDENT_SPACES));
}

// The hook writes the file between the call and its result, so the replay writes it at the result line.
export function writeBlockedCallSavedFiles(line: JSONLLine): void {
  for (const block of getBlocksOfTimedLine(line)) {
    if (block.type === BlockType.tool_use) {
      hookToolInputsByCallId.set(block.id.toString(), getHookToolInput(line, block.id.toString(), block.input));
    }
    if (block.type === BlockType.tool_result) {
      writeSavedFileOfResult(block);
    }
  }
}
