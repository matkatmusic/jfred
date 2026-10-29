// Tool-flow navigation for the JSON inspector: a tool_use record jumps to its hook and result lines.

import type { WireValue } from "./inspector-links.ts";

type ToolUseIdentity = { toolUseId: string | undefined; recordUuid: string | undefined };

function findLineContaining(rawLines: string[], needle: string): number {
  for (const [index, text] of rawLines.entries()) {
    const isMatch = text.includes(needle);
    if (isMatch)
      return index;
  }
  return -1;
}

function findToolUseIdentity(value: WireValue): ToolUseIdentity | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  if (value.type !== "assistant") {
    return undefined;
  }
  const content = value.message?.content;
  const isBlockList = Array.isArray(content);
  if (!isBlockList) {
    return undefined;
  }
  for (const block of content) {
    if (block.type === "tool_use")
      return { toolUseId: block.id, recordUuid: value.uuid };
  }
  return undefined;
}

// Older transcripts lack sourceToolAssistantUUID, so the tool_result's tool_use_id is the fallback.
export function findToolNavigationTargets(rawLines: string[], value: WireValue): { hookLine: number; resultLine: number } | undefined {
  const toolUse = findToolUseIdentity(value);
  if (toolUse === undefined) {
    return undefined;
  }
  const hookLine = findLineContaining(rawLines, `"toolUseID":"${toolUse.toolUseId}"`);
  let resultLine = findLineContaining(rawLines, `"sourceToolAssistantUUID":"${toolUse.recordUuid}"`);
  if (resultLine < 0) {
    resultLine = findLineContaining(rawLines, `"tool_use_id":"${toolUse.toolUseId}"`);
  }
  return { hookLine, resultLine };
}
