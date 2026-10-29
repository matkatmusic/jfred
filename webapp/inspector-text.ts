// Formatted-text mode: the human-readable form of a parsed JSONL record, with real newlines instead of JSON escapes.

import type { WireContentBlock, WireValue } from "./inspector-links.ts";

// A tool_use block's readable form: a name header plus each string input field verbatim under a divider.
function extractToolUseText(block: WireContentBlock): string {
  const lines = [`[tool_use: ${block.name}]`];
  for (const [key, value] of Object.entries(block.input ?? {})) {
    if (typeof value !== "string") {
      continue;
    }
    lines.push(`--- ${key} ---`, value);
  }
  return lines.join("\n");
}

// A tool_result block's readable form: its string content, or its nested blocks joined by blank lines.
function extractToolResultText(block: WireContentBlock): string {
  const resultContent = block.content;
  if (typeof resultContent === "string") {
    return resultContent;
  }
  const hasNestedBlocks = Array.isArray(resultContent);
  if (!hasNestedBlocks) {
    return "[tool_result]";
  }
  const nestedTexts: (string | undefined)[] = [];
  for (const inner of resultContent) {
    nestedTexts.push(inner.type === "text" ? inner.text : `[${inner.type}]`);
  }
  return nestedTexts.join("\n\n");
}

function extractBlockText(block: WireContentBlock): string | undefined {
  if (block.type === "text") {
    return block.text;
  }
  if (block.type === "tool_result") {
    return extractToolResultText(block);
  }
  if (block.type === "tool_use") {
    return extractToolUseText(block);
  }
  return `[${block.type}]`;
}

// Readable text of one parsed record; undefined without message content, so the toggle hides.
export function extractReadableText(value: WireValue): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  const content = value?.message?.content;
  if (content === undefined) {
    return undefined;
  }
  if (typeof content === "string") {
    return content;
  }
  const hasBlocks = Array.isArray(content);
  if (!hasBlocks) {
    return undefined;
  }
  const blockTexts: (string | undefined)[] = [];
  for (const block of content) {
    blockTexts.push(extractBlockText(block));
  }
  return blockTexts.join("\n\n");
}
