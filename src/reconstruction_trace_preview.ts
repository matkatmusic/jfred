// Kind and short preview of one parsed transcript record, for trace detail rows.

import { BlockType, RecordType, ToolName } from "./structures/vocabulary.ts";
import type { ToolUseBlock } from "./structures/content-blocks.ts";
import { readWriteInput } from "./structures/tool-result-shapes.ts";
import { whitespaceRuns } from "./regex_expressions.ts";

// Shorten a preview to a single line of at most 40 chars, ellipsised when cut.
function trimPreview(value: string): string {
  const single = value.replace(whitespaceRuns, " ").trim();
  return single.length > 40 ? `${single.slice(0, 40)}…` : single;
}

export type KindPreview = { kind: string; preview: string };

// The last part of a path: a shorter and more useful preview than the full path.
function getPathBasename(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

// A kind and preview for one block: a tool_use shows its command or file name, text shows its text.
function getBlockKindPreview(block: Record<string, unknown>, erroredIds: Set<string>): KindPreview | undefined {
  if (block.type === BlockType.tool_use) {
    const input = (block.input ?? {}) as { command?: string; file_path?: string };
    if (input.command !== undefined) {
      return { kind: String(block.name), preview: trimPreview(input.command) };
    }
    if (block.name === ToolName.Write && erroredIds.has(String(block.id))) {
      return { kind: String(block.name), preview: "" };
    }
    if (block.name === ToolName.Write) {
      return { kind: String(block.name), preview: getPathBasename(readWriteInput(block as unknown as ToolUseBlock).filePath.toString()) };
    }
    return { kind: String(block.name), preview: input.file_path ? getPathBasename(input.file_path) : "" };
  }
  if (block.type === BlockType.text) {
    return { kind: "text", preview: trimPreview(String(block.text ?? "")) };
  }
  return undefined;
}

// Kind and preview of a Read, Edit, or Write result, from its shape; the preview is the file name.
function getResultKindPreview(result: Record<string, unknown>): KindPreview {
  const file = result.file as { filePath?: string } | undefined;
  if (typeof file?.filePath === "string") {
    return { kind: "Read", preview: getPathBasename(file.filePath) };
  }
  const filePath = typeof result.filePath === "string" ? getPathBasename(result.filePath) : "";
  if (typeof result.oldString === "string") {
    return { kind: "Edit", preview: filePath };
  }
  if (typeof result.content === "string") {
    return { kind: "Write", preview: filePath };
  }
  return { kind: "-", preview: "" };
}

// A kind + preview for a file-history-snapshot: the files it backed up, each as `<basename>@v<version>`.
function getSnapshotKindPreview(object: Record<string, unknown>): KindPreview {
  const snapshot = object.snapshot as { trackedFileBackups?: Record<string, { version?: number }> } | undefined;
  const backups = snapshot?.trackedFileBackups ?? {};
  const files: string[] = [];
  for (const [name, backup] of Object.entries(backups)) {
    files.push(`${getPathBasename(name)}@v${backup.version}`);
  }
  return { kind: "snapshot", preview: trimPreview(files.join(", ")) };
}

// The kind and preview of a parsed record: an attachment, a snapshot, a content block, or a tool result.
export function getRecordKindPreview(object: Record<string, unknown>, erroredIds: Set<string>): KindPreview {
  const attachment = object.attachment as { type?: string; filename?: string } | undefined;
  if (typeof attachment?.type === "string") {
    return { kind: attachment.type, preview: attachment.filename ? getPathBasename(attachment.filename) : "" };
  }
  if (object.type === RecordType.fileHistorySnapshot) {
    return getSnapshotKindPreview(object);
  }
  const content = (object.message as { content?: unknown })?.content;
  for (const block of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
    const described = getBlockKindPreview(block, erroredIds);
    if (described !== undefined) {
      return described;
    }
  }
  const result = object.toolUseResult as Record<string, unknown> | undefined;
  return result ? getResultKindPreview(result) : { kind: "-", preview: "" };
}
