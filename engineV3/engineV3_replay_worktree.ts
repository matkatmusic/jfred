// Makes the helper worktree that Claude Code made when an Agent call with isolation "worktree" returns.

import { readFileSync } from "node:fs";
import { AgentId, Path, Uuid } from "../src/structures/domain.ts";
import { getRecordSource, type RecordSource } from "../src/parse/loadTranscript.ts";
import { parseRecord } from "../src/parse/parseRecord.ts";
import { getContentBlocks, type ContentBlock, type TextBlock, type ToolResultBlock, type ToolUseBlock } from "../src/structures/content-blocks.ts";
import { BlockType, RecordType } from "../src/structures/vocabulary.ts";
import { executeGit, type JSONLLine } from "./engineV3.ts";

const AGENT_ID_LINE = /^agentId: (\S+)/m;
const AGENT_TOOL_NAME = "Agent";
const WORKTREE_ISOLATION = "worktree";

// The old type says a tool_result's content is a string; real data holds a list of text blocks.
function joinTextParts(toolResult: ToolResultBlock): string {
  if (typeof toolResult.content === "string") {
    return toolResult.content;
  }
  let text = "";
  for (const part of toolResult.content as unknown as TextBlock[]) {
    text += part.text;
  }
  return text;
}

function findToolResultBlock(line: JSONLLine): ToolResultBlock | undefined {
  for (const block of getContentBlocks(line)) {
    if (block.type === BlockType.tool_result) {
      return block;
    }
  }
  return undefined;
}

function parseAgentId(text: string): AgentId | undefined {
  const match = AGENT_ID_LINE.exec(text);
  if (match === null) {
    return undefined;
  }
  return new AgentId(match[1] as string);
}

function isToolUseBlockWithId(block: ContentBlock, toolUseId: Uuid): block is ToolUseBlock {
  if (block.type !== BlockType.tool_use) {
    return false;
  }
  return block.id.equals(toolUseId);
}

function parseToolUseBlock(fileLine: string, toolUseId: Uuid): ToolUseBlock | undefined {
  const mentionsId = fileLine.includes(toolUseId.toString());
  if (!mentionsId) {
    return undefined;
  }
  for (const block of getContentBlocks(parseRecord(fileLine))) {
    const isThisCall = isToolUseBlockWithId(block, toolUseId);
    if (isThisCall) {
      return block;
    }
  }
  return undefined;
}

// Reads only the lines before the result line, so the call must come earlier in the same file.
function findToolUseBefore(source: RecordSource, toolUseId: Uuid): ToolUseBlock {
  const fileLines = readFileSync(source.filePath, "utf8").split("\n");
  for (const fileLine of fileLines.slice(0, source.lineNumber - 1)) {
    const toolUse = parseToolUseBlock(fileLine, toolUseId);
    if (toolUse !== undefined) {
      return toolUse;
    }
  }
  throw new Error(`findToolUseBefore: no tool_use ${toolUseId.toString()} before ${source.filePath}:${source.lineNumber}`);
}

function isWorktreeAgentCall(toolUse: ToolUseBlock): boolean {
  if (toolUse.name !== AGENT_TOOL_NAME) {
    return false;
  }
  return toolUse.input.isolation === WORKTREE_ISOLATION;
}

function findWorktreeAgentIdInResult(toolResult: ToolResultBlock, source: RecordSource | undefined): AgentId | undefined {
  const agentId = parseAgentId(joinTextParts(toolResult));
  if (agentId === undefined) {
    return undefined;
  }
  if (source === undefined) {
    throw new Error(`findWorktreeAgentId: line with agentId ${agentId.toString()} has no source file`);
  }
  const isWorktree = isWorktreeAgentCall(findToolUseBefore(source, toolResult.tool_use_id));
  if (!isWorktree) {
    return undefined;
  }
  return agentId;
}

// Only a user line counts: an api-request-blob line copies the request and repeats the text.
export function findWorktreeAgentId(line: JSONLLine): AgentId | undefined {
  if (line.type !== RecordType.user) {
    return undefined;
  }
  const toolResult = findToolResultBlock(line);
  if (toolResult === undefined) {
    return undefined;
  }
  return findWorktreeAgentIdInResult(toolResult, getRecordSource(line));
}

export function addWorktreeToState(state: Path, line: JSONLLine): Path {
  const agentId = findWorktreeAgentId(line);
  if (agentId === undefined) {
    throw new Error("addWorktreeToState: the line is not a worktree agent result");
  }
  executeGit(state, ["worktree", "add", "-b", `worktree-agent-${agentId.toString()}`, `.claude/worktrees/agent-${agentId.toString()}`, "HEAD"]);
  return state;
}
